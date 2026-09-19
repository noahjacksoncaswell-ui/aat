import { Router } from "express";
import { prisma } from "../lib/prisma";
import { computeBestSiteCoaStatus, computeNotamStatus, REQUIRED_NOTIFICATION_TYPES } from "../services/faa";
import { getWeatherForSite, evaluateWeatherAgainstLimits } from "../services/weather";
import { quickLiveComplianceCheck } from "../services/lwcc";
import { MissionStatus } from "@prisma/client";

const router = Router();

router.get("/", async (_req, res) => {
  const now = new Date();

  const activeMissions = await prisma.mission.findMany({
    where: { status: { in: [MissionStatus.TARGETED, MissionStatus.PENDING_WINDOW, MissionStatus.HOLD] } },
    include: {
      vehicle: true,
      site: { include: { coas: true } },
      launchPeriodEntries: true,
      notamFilings: { orderBy: { createdAt: "desc" }, take: 1 },
      launchDayNotifications: true,
      assignedUsers: { include: { user: { select: { id: true, name: true, role: true } } } },
    },
  });

  // Next targeted opportunity across all missions (soonest future window).
  const targetedWithWindow = activeMissions
    .map((m) => ({ mission: m, entry: m.launchPeriodEntries.find((e) => e.isTargeted) }))
    .filter((x) => x.entry)
    .sort((a, b) => a.entry!.windowOpen.getTime() - b.entry!.windowOpen.getTime());

  const next = targetedWithWindow[0];
  let nextOpportunity = null as any;
  let lwccSnapshot = null as any;
  if (next) {
    const weather = await getWeatherForSite({
      siteId: next.mission.siteId,
      lat: next.mission.site.lat,
      lon: next.mission.site.lon,
      countryCode: next.mission.site.countryCode,
    });
    const evaluation = evaluateWeatherAgainstLimits(weather, next.mission.vehicle);
    nextOpportunity = {
      missionId: next.mission.id,
      missionName: next.mission.name,
      designator: next.mission.designator,
      vehicleName: next.mission.vehicle.name,
      siteName: next.mission.site.name,
      windowOpen: next.entry!.windowOpen,
      windowClose: next.entry!.windowClose,
      weatherStatus: evaluation.overallStatus,
      coaStatus: computeBestSiteCoaStatus(next.mission.site.coas),
      personnelOnConsole: next.mission.assignedUsers.map((a) => ({ id: a.user.id, name: a.user.name, role: a.role ?? a.user.role })),
    };
    const lwccCheck = quickLiveComplianceCheck({
      windSpeedKts: weather.windSpeedKts,
      windGustKts: weather.windGustKts,
      temperatureC: weather.temperatureC,
      visibilityMi: weather.visibilityMi,
      precipitationProbabilityPct: weather.precipitationProbabilityPct,
    });
    lwccSnapshot = {
      missionId: next.mission.id,
      status: lwccCheck.status,
      activeViolations: lwccCheck.violating.map((r) => ({ no: r.no, description: r.description })),
    };
  }

  const openActionItems: Array<{ type: string; missionId: string; missionName: string; detail: string }> = [];
  for (const { mission, entry } of targetedWithWindow) {
    const notamStatus = computeNotamStatus(mission.notamFilings[0], entry!.windowOpen, now);
    if (notamStatus === "OVERDUE") {
      openActionItems.push({
        type: "NOTAM_OVERDUE",
        missionId: mission.id,
        missionName: mission.name,
        detail: `Leidos/NOTAM advance notice not yet filed for ${mission.designator} (window opens ${entry!.windowOpen.toISOString()})`,
      });
    }
    const unresolvedChecklist = REQUIRED_NOTIFICATION_TYPES.filter((t) => {
      const item = mission.launchDayNotifications.find((n) => n.notificationType === t);
      return !(item?.satisfied || item?.notApplicable);
    });
    const sameDay =
      entry!.date.getUTCFullYear() === now.getUTCFullYear() &&
      entry!.date.getUTCMonth() === now.getUTCMonth() &&
      entry!.date.getUTCDate() === now.getUTCDate();
    if (sameDay && unresolvedChecklist.length > 0) {
      openActionItems.push({
        type: "FAA_CHECKLIST_OPEN",
        missionId: mission.id,
        missionName: mission.name,
        detail: `${unresolvedChecklist.length} FAA notification checklist item(s) outstanding for ${mission.designator}`,
      });
    }
    if (computeBestSiteCoaStatus(mission.site.coas) !== "ACTIVE") {
      openActionItems.push({
        type: "COA_NOT_ACTIVE",
        missionId: mission.id,
        missionName: mission.name,
        detail: `${mission.site.name} does not have an Active COA on file`,
      });
    }
  }

  const recentDocuments = await prisma.document.findMany({
    orderBy: { updatedAt: "desc" },
    take: 10,
    include: { uploadedBy: { select: { id: true, name: true } } },
  });

  // Fleet status summary (Section 5)
  const vehicles = await prisma.vehicle.findMany({ select: { id: true, name: true, status: true } });
  const fleetStatus = {
    active: vehicles.filter((v) => v.status === "ACTIVE").length,
    inDevelopment: vehicles.filter((v) => v.status === "IN_DEVELOPMENT").length,
    retired: vehicles.filter((v) => v.status === "RETIRED").length,
    nextMissionVehicle: next ? next.mission.vehicle.name : null,
  };

  // Mission pipeline - every non-terminal mission, not just the single "next" one
  const pipeline = await prisma.mission.findMany({
    where: { status: { in: [MissionStatus.PENDING_WINDOW, MissionStatus.TARGETED, MissionStatus.HOLD, MissionStatus.POSTPONED] } },
    orderBy: { updatedAt: "desc" },
    include: { vehicle: { select: { name: true } }, site: { select: { name: true, designator: true } } },
  });

  // Recent history feed across all missions (scrubs, cancellations, successes, etc.)
  const recentHistory = await prisma.missionHistoryEvent.findMany({
    orderBy: { timestamp: "desc" },
    take: 15,
    include: { actor: { select: { id: true, name: true } }, mission: { select: { id: true, name: true, designator: true } } },
  });

  res.json({
    nextOpportunity,
    lwccSnapshot,
    fleetStatus,
    activeMissionCount: activeMissions.length,
    openActionItemCount: openActionItems.length,
    openActionItems,
    missionPipeline: pipeline.map((m) => ({
      id: m.id,
      name: m.name,
      designator: m.designator,
      status: m.status,
      vehicleName: m.vehicle.name,
      siteName: m.site.name,
      updatedAt: m.updatedAt,
    })),
    recentHistory: recentHistory.map((h) => ({
      id: h.id,
      eventType: h.eventType,
      timestamp: h.timestamp,
      notes: h.notes,
      actor: h.actor,
      mission: h.mission,
    })),
    recentDocuments,
  });
});

export default router;
