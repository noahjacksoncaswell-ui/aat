import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma";
import { requireLaunchDirector } from "../middleware/auth";
import { recordAudit } from "../services/audit";
import { broadcastMissionUpdate } from "../websocket";
import { getWeatherForSite } from "../services/weather";
import {
  LWCC_REQUIREMENTS,
  evaluateLiveViolation,
  getLiveValue,
  computeTrendRisk,
  type LwccRowStatus,
} from "../services/lwcc";

const router = Router({ mergeParams: true });

function missionId(req: any): string {
  return (req.params as { missionId: string }).missionId;
}

const SAMPLE_THROTTLE_MS = 55_000;

router.get("/", async (req, res) => {
  const mId = missionId(req);
  const mission = await prisma.mission.findUnique({ where: { id: mId }, include: { site: true } });
  if (!mission) return res.status(404).json({ error: "Mission not found" });

  const snapshot = await getWeatherForSite({
    siteId: mission.site.id,
    lat: mission.site.lat,
    lon: mission.site.lon,
    countryCode: mission.site.countryCode,
  });

  const liveSnapshot = {
    windSpeedKts: snapshot.windSpeedKts,
    windGustKts: snapshot.windGustKts,
    temperatureC: snapshot.temperatureC,
    visibilityMi: snapshot.visibilityMi,
    precipitationProbabilityPct: snapshot.precipitationProbabilityPct,
  };

  // Throttled sample capture for the trend buffer (Section 7.2/7.3).
  const latestSample = await prisma.weatherSample.findFirst({
    where: { siteId: mission.site.id },
    orderBy: { capturedAt: "desc" },
  });
  if (!latestSample || Date.now() - latestSample.capturedAt.getTime() > SAMPLE_THROTTLE_MS) {
    await prisma.weatherSample.create({
      data: {
        siteId: mission.site.id,
        windSpeedKts: liveSnapshot.windSpeedKts,
        windGustKts: liveSnapshot.windGustKts,
        temperatureC: liveSnapshot.temperatureC,
        visibilityMi: liveSnapshot.visibilityMi,
        precipitationProbabilityPct: liveSnapshot.precipitationProbabilityPct,
      },
    });
  }

  const fifteenMinAgo = new Date(Date.now() - 15 * 60 * 1000);
  const sample15 = await prisma.weatherSample.findFirst({
    where: { siteId: mission.site.id, capturedAt: { lte: fifteenMinAgo } },
    orderBy: { capturedAt: "desc" },
  });

  // 24-hr rolling average for LWCCR 14, best-effort from whatever sample
  // history exists (this environment has no 24-hr climatology feed).
  const twentyFourHrAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const dayoSamples = await prisma.weatherSample.findMany({
    where: { siteId: mission.site.id, capturedAt: { gte: twentyFourHrAgo }, temperatureC: { not: null } },
    select: { temperatureC: true },
  });
  const rollingAvgTempC =
    dayoSamples.length > 0 ? dayoSamples.reduce((sum, s) => sum + (s.temperatureC ?? 0), 0) / dayoSamples.length : liveSnapshot.temperatureC;

  const [activeHolds, activeOverrides, allReports] = await Promise.all([
    prisma.lwccHold.findMany({ where: { missionId: mId, active: true } }),
    prisma.lwccOverride.findMany({ where: { missionId: mId, active: true }, include: { overriddenBy: { select: { id: true, name: true } } } }),
    prisma.lwccReport.findMany({
      where: { missionId: mId },
      orderBy: { timestamp: "desc" },
      include: { reportedBy: { select: { id: true, name: true } } },
    }),
  ]);

  const now = new Date();
  const rows = [];
  const holdUpserts: Promise<unknown>[] = [];

  for (const req_ of LWCC_REQUIREMENTS) {
    const override = activeOverrides.find((o) => o.requirementNo === req_.no);
    const existingHold = activeHolds.find((h) => h.requirementNo === req_.no && h.expiresAt > now);
    const staleHold = activeHolds.find((h) => h.requirementNo === req_.no && h.expiresAt <= now);
    if (staleHold) {
      holdUpserts.push(prisma.lwccHold.update({ where: { id: staleHold.id }, data: { active: false } }));
    }

    let status: LwccRowStatus;
    let currentValue: number | null | undefined = null;
    let holdExpiresAt: Date | null = null;
    let lastReport = null as (typeof allReports)[number] | null;

    if (req_.mode === "LIVE") {
      currentValue = req_.no === 14 ? rollingAvgTempC ?? null : getLiveValue(req_, liveSnapshot) ?? null;
      const violatingNow = req_.no === 14 ? (currentValue != null && (currentValue < -9.4 || currentValue > 43.3)) : evaluateLiveViolation(req_, liveSnapshot);

      if (req_.holdDurationSeconds) {
        if (violatingNow) {
          if (existingHold) {
            holdUpserts.push(
              prisma.lwccHold.update({ where: { id: existingHold.id }, data: { expiresAt: new Date(now.getTime() + req_.holdDurationSeconds * 1000) } })
            );
            holdExpiresAt = new Date(now.getTime() + req_.holdDurationSeconds * 1000);
          } else {
            holdExpiresAt = new Date(now.getTime() + req_.holdDurationSeconds * 1000);
            holdUpserts.push(
              prisma.lwccHold.create({
                data: { missionId: mId, requirementNo: req_.no, durationSeconds: req_.holdDurationSeconds, expiresAt: holdExpiresAt },
              })
            );
            holdUpserts.push(
              prisma.lwccLogEntry.create({
                data: { missionId: mId, eventType: "VIOLATION_TRIGGERED", requirementNo: req_.no, details: { currentValue } as any },
              })
            );
          }
          status = "HOLD_ACTIVE";
        } else if (existingHold) {
          status = "HOLD_ACTIVE";
          holdExpiresAt = existingHold.expiresAt;
        } else {
          status = "NO_VIOLATION";
        }
      } else {
        status = violatingNow ? "VIOLATION" : "NO_VIOLATION";
      }
    } else {
      lastReport = allReports.find((r) => r.requirementNo === req_.no) ?? null;
      const reportViolation = (lastReport?.data as any)?.violation === true;
      if (!lastReport) {
        status = "NOT_REPORTED";
      } else if (req_.holdDurationSeconds) {
        if (existingHold) {
          status = "HOLD_ACTIVE";
          holdExpiresAt = existingHold.expiresAt;
        } else {
          status = reportViolation ? "VIOLATION" : "NO_VIOLATION";
        }
      } else {
        status = reportViolation ? "VIOLATION" : "NO_VIOLATION";
      }
    }

    if (override) {
      status = "OVERRIDDEN";
    }

    const trend =
      req_.mode === "LIVE"
        ? computeTrendRisk(req_, currentValue ?? undefined, sample15 ? getLiveValue(req_, sample15 as any) ?? undefined : undefined)
        : { risk15: "MANUAL" as const, risk30: "MANUAL" as const };

    rows.push({
      no: req_.no,
      description: req_.description,
      limitText: req_.limitText,
      mode: req_.mode,
      status,
      currentValue,
      valueAt15Min: req_.mode === "LIVE" && sample15 ? getLiveValue(req_, sample15 as any) ?? null : null,
      risk15: trend.risk15,
      risk30: trend.risk30,
      holdExpiresAt,
      holdDurationSeconds: req_.holdDurationSeconds ?? null,
      lastReport: lastReport
        ? { id: lastReport.id, timestamp: lastReport.timestamp, reportedBy: lastReport.reportedBy, data: lastReport.data, notes: lastReport.notes }
        : null,
      override: override ? { justification: override.justification, by: override.overriddenBy, timestamp: override.timestamp } : null,
    });
  }

  await Promise.all(holdUpserts);

  const violatingRows = rows.filter((r) => r.status === "VIOLATION" || r.status === "HOLD_ACTIVE");
  const notReportedCount = rows.filter((r) => r.status === "NOT_REPORTED").length;

  const log = await prisma.lwccLogEntry.findMany({
    where: { missionId: mId, ...(mission.lwccLogClearedAt ? { timestamp: { gt: mission.lwccLogClearedAt } } : {}) },
    orderBy: { timestamp: "desc" },
    include: { actor: { select: { id: true, name: true } } },
    take: 100,
  });

  res.json({
    bannerStatus: violatingRows.length > 0 ? "VIOLATION" : "NO_VIOLATION",
    violatingRows: violatingRows.map((r) => ({ no: r.no, description: r.description, currentValue: r.currentValue, holdExpiresAt: r.holdExpiresAt })),
    notReportedCount,
    rows,
    log,
  });
});

const reportSchema = z.object({
  requirementNo: z.number(),
  violation: z.boolean(),
  data: z.record(z.any()).optional(),
  notes: z.string().optional(),
});

router.post("/reports", async (req, res) => {
  const mId = missionId(req);
  const parsed = reportSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const { requirementNo, violation, data, notes } = parsed.data;

  const reqDef = LWCC_REQUIREMENTS.find((r) => r.no === requirementNo);
  if (!reqDef || reqDef.mode !== "MANUAL") {
    return res.status(400).json({ error: "Requirement not found or is not manually reportable" });
  }

  const report = await prisma.lwccReport.create({
    data: { missionId: mId, requirementNo, reportedById: req.user!.id, data: { ...data, violation } as any, notes },
  });

  await prisma.lwccLogEntry.create({
    data: { missionId: mId, eventType: "REPORT_SUBMITTED", requirementNo, actorId: req.user!.id, details: { violation, notes } as any },
  });

  if (violation && reqDef.holdDurationSeconds) {
    const expiresAt = new Date(Date.now() + reqDef.holdDurationSeconds * 1000);
    const existing = await prisma.lwccHold.findFirst({ where: { missionId: mId, requirementNo, active: true } });
    if (existing) {
      await prisma.lwccHold.update({ where: { id: existing.id }, data: { expiresAt } });
    } else {
      await prisma.lwccHold.create({ data: { missionId: mId, requirementNo, durationSeconds: reqDef.holdDurationSeconds, expiresAt } });
    }
    await prisma.lwccLogEntry.create({
      data: { missionId: mId, eventType: "HOLD_STARTED", requirementNo, actorId: req.user!.id, details: { expiresAt } as any },
    });
  }

  await recordAudit({ userId: req.user!.id, action: "LWCC_REPORT_SUBMITTED", targetType: "Mission", targetId: mId, metadata: { requirementNo, violation } });
  broadcastMissionUpdate(mId);
  res.status(201).json(report);
});

const overrideSchema = z.object({ requirementNo: z.number(), justification: z.string().min(1) });

router.post("/overrides", requireLaunchDirector, async (req, res) => {
  const mId = missionId(req);
  const parsed = overrideSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  await prisma.lwccOverride.updateMany({ where: { missionId: mId, requirementNo: parsed.data.requirementNo, active: true }, data: { active: false } });
  const override = await prisma.lwccOverride.create({
    data: { missionId: mId, requirementNo: parsed.data.requirementNo, justification: parsed.data.justification, overriddenById: req.user!.id },
  });
  await prisma.lwccLogEntry.create({
    data: {
      missionId: mId,
      eventType: "OVERRIDE",
      requirementNo: parsed.data.requirementNo,
      actorId: req.user!.id,
      details: { justification: parsed.data.justification } as any,
    },
  });

  await recordAudit({
    userId: req.user!.id,
    action: "LWCC_OVERRIDE",
    targetType: "Mission",
    targetId: mId,
    metadata: { requirementNo: parsed.data.requirementNo, justification: parsed.data.justification },
  });
  broadcastMissionUpdate(mId);
  res.status(201).json(override);
});

router.delete("/overrides/:requirementNo", requireLaunchDirector, async (req, res) => {
  const mId = missionId(req);
  const requirementNo = Number(req.params.requirementNo);
  await prisma.lwccOverride.updateMany({ where: { missionId: mId, requirementNo, active: true }, data: { active: false } });
  await prisma.lwccLogEntry.create({
    data: { missionId: mId, eventType: "OVERRIDE_CLEARED", requirementNo, actorId: req.user!.id },
  });
  broadcastMissionUpdate(mId);
  res.status(204).send();
});

router.post("/log/clear", requireLaunchDirector, async (req, res) => {
  const mId = missionId(req);
  const marker = await prisma.lwccLogEntry.create({
    data: { missionId: mId, eventType: "LOG_CLEARED", actorId: req.user!.id },
  });
  // The marker itself stays visible as the first entry of the fresh log -
  // underlying rows before it are retained in the database, never deleted.
  await prisma.mission.update({ where: { id: mId }, data: { lwccLogClearedAt: new Date(marker.timestamp.getTime() - 1) } });
  await recordAudit({ userId: req.user!.id, action: "LWCC_LOG_CLEARED", targetType: "Mission", targetId: mId });
  broadcastMissionUpdate(mId);
  res.status(204).send();
});

export default router;
