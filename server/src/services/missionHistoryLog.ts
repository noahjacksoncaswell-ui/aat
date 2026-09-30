// v9.0 Section 3 - Unified Mission Command Log aggregation.
//
// Reads from every existing per-subsystem log/table (Section 3.2's full
// list) and merges them into one strict chronological feed. This is a
// read-time aggregation layer only - it does not consolidate storage or
// remove any subsystem's own display location (LWCC tab keeps its own
// banner/log, Personnel Assignments keeps its audit history table, the
// Log tab keeps its freeform entry feed, etc. - Section 3.1).
import { prisma } from "../lib/prisma";
import { computeTCountSeconds, computeProjectedLiftoff } from "./countdown";
import { formatCommsLine } from "./commsActions";

export type LogStatus = "PENDING" | "IN PROGRESS" | "CLOSED";

export interface UnifiedLogEntry {
  timestamp: Date;
  source:
    | "MISSION_LIFECYCLE"
    | "LAUNCH_PERIOD"
    | "LWCC"
    | "HOLD"
    | "FAA_NOTAM"
    | "PERSONNEL"
    | "POLLS"
    | "MANUAL_LOG"
    | "COMMS";
  text: string;
  actorName: string | null;
}

const MISSION_HISTORY_LABELS: Record<string, string> = {
  TARGETED: "Targeted Launch Opportunity selected/confirmed",
  POSTPONED: "Mission Postponed",
  CANCELLED: "Mission Cancelled",
  SCRUBBED: "Mission Scrubbed",
  SUCCESSFUL: "Mission Successful",
  LOT_SUBMITTED: "LOT Submitted",
  LOT_REVISED: "LOT Revised",
  HOLD_CALLED: "Hold Called",
  HOLD_RELEASED: "Hold Released",
  RECYCLED: "Mission Recycled",
  LIFTOFF_MARKED: "Liftoff Marked (Actual Launch Time Established)",
  NOTE: "Note",
  COFR_COMPLIANCE_LAPSED: "CoFR Compliance Lapsed",
  COFR_COMPLIANCE_RESOLVED: "CoFR Compliance Resolved",
};

// v9.0 Section 3.2 - LWCC hold recommendations: the v5.3 Recommendation
// Panel text is purely client-side computed each render and never
// persisted server-side, so there is no discrete "recommendation event" to
// pull from. Interpretive choice (documented here per Section 6's
// instruction to flag deviations): recommendation activity is represented
// via the already-logged LwccLogEntry events themselves, rendered with
// recommendation-style phrasing, rather than inventing new persisted state.
const LWCC_EVENT_LABELS: Record<string, string> = {
  REPORT_SUBMITTED: "LWCC manual report submitted",
  VIOLATION_TRIGGERED: "LWCC violation triggered — recommend HOLD",
  HOLD_STARTED: "LWCC-driven hold started",
  HOLD_EXPIRED: "LWCC-driven hold expired",
  OVERRIDE: "LWCC requirement overridden",
  OVERRIDE_CLEARED: "LWCC override cleared",
  LOG_CLEARED: "LWCC log cleared (display marker; underlying rows retained)",
};

const NOTIFICATION_TYPE_LABELS: Record<string, string> = {
  T_MINUS_60: "T-60 FAA/NOTAM notification",
  T_MINUS_15: "T-15 FAA/NOTAM notification",
  TERMINATION: "Termination FAA/NOTAM notification",
};

function fmtSecs(totalSeconds: number): string {
  const sign = totalSeconds < 0 ? "-" : "";
  const abs = Math.abs(totalSeconds);
  const h = Math.floor(abs / 3600);
  const m = Math.floor((abs % 3600) / 60);
  const s = Math.floor(abs % 60);
  return `${sign}${h.toString().padStart(2, "0")}:${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
}

export async function computeLogStatus(missionId: string): Promise<LogStatus> {
  const mission = await prisma.mission.findUnique({
    where: { id: missionId },
    include: { launchPeriodEntries: true },
  });
  if (!mission) return "PENDING";
  if (mission.status === "SUCCESSFUL" || mission.status === "CANCELLED") return "CLOSED";
  const targeted = mission.launchPeriodEntries.find((e) => e.isTargeted);
  if (!targeted) return "PENDING"; // no TLO confirmed yet
  if (new Date() < targeted.windowOpen) return "PENDING"; // window not yet open
  return "IN PROGRESS";
}

/** Full unified feed for one mission, strictly chronologically ordered. */
export async function buildUnifiedLog(missionId: string): Promise<UnifiedLogEntry[]> {
  const [historyEvents, launchPeriodEntries, lwccLog, holds, notamFilings, notifications, personnelAudit, pollAudit, manualLog, commsMessages, mission] =
    await Promise.all([
      prisma.missionHistoryEvent.findMany({ where: { missionId }, include: { actor: { select: { name: true } } } }),
      prisma.launchPeriodEntry.findMany({ where: { missionId } }),
      prisma.lwccLogEntry.findMany({ where: { missionId }, include: { actor: { select: { name: true } } } }),
      prisma.missionHold.findMany({ where: { missionId }, include: { enteredBy: { select: { name: true } } } }),
      prisma.nOTAMFiling.findMany({ where: { missionId }, include: { filedBy: { select: { name: true } } } }),
      prisma.launchDayNotification.findMany({ where: { missionId }, include: { contactedBy: { select: { name: true } } } }),
      prisma.missionPersonnelAuditEntry.findMany({
        where: { missionId },
        include: { actor: { select: { name: true } }, previousUser: { select: { name: true } }, newUser: { select: { name: true } } },
      }),
      prisma.pollAuditEntry.findMany({ where: { missionId }, include: { actor: { select: { name: true } } } }),
      prisma.missionLogEntry.findMany({ where: { missionId }, include: { author: { select: { name: true } } } }),
      prisma.formalCommsMessage.findMany({ where: { missionId }, include: { sender: { select: { name: true } } } }),
      prisma.mission.findUnique({ where: { id: missionId } }),
    ]);

  const entries: UnifiedLogEntry[] = [];

  for (const e of historyEvents) {
    const label = MISSION_HISTORY_LABELS[e.eventType] ?? e.eventType;
    entries.push({
      timestamp: e.timestamp,
      source: "MISSION_LIFECYCLE",
      text: e.notes ? `${label} — ${e.notes}` : label,
      actorName: e.actor?.name ?? null,
    });
  }

  for (const lp of launchPeriodEntries) {
    entries.push({
      timestamp: lp.createdAt,
      source: "LAUNCH_PERIOD",
      text: `Launch Period entry set: ${lp.date.toISOString().slice(0, 10)} window ${lp.windowOpen.toISOString()} – ${lp.windowClose.toISOString()}`,
      actorName: null,
    });
  }

  for (const l of lwccLog) {
    const label = LWCC_EVENT_LABELS[l.eventType] ?? l.eventType;
    entries.push({
      timestamp: l.timestamp,
      source: "LWCC",
      text: l.requirementNo != null ? `${label} (LWCCR ${l.requirementNo})` : label,
      actorName: l.actor?.name ?? null,
    });
  }

  // v9.0 Section 3.2 - every hold, every phase: opened, estimated duration,
  // overage, released, and the resulting clock adjustment. Multiple entries
  // per hold row where the directive lists multiple distinct moments.
  for (const h of holds) {
    const kind = h.type === "PROGRAMMED" ? "Programmed" : "Unscheduled";
    const openedAt = h.actualStartedAt ?? h.createdAt;
    const estText = h.estimatedDurationSeconds != null ? `, estimated duration ${fmtSecs(h.estimatedDurationSeconds)}` : ", indefinite/unscheduled duration";
    entries.push({
      timestamp: openedAt,
      source: "HOLD",
      text: `${kind} hold opened at T-minus ${fmtSecs(h.holdMarkSeconds)}${estText}`,
      actorName: h.enteredBy?.name ?? null,
    });

    if (h.status === "DURATION_ELAPSED" && h.estimatedDurationSeconds != null && h.actualStartedAt) {
      entries.push({
        timestamp: new Date(h.actualStartedAt.getTime() + h.estimatedDurationSeconds * 1000),
        source: "HOLD",
        text: `${kind} hold ran into overage past its ${fmtSecs(h.estimatedDurationSeconds)} estimate (manual Proceed required)`,
        actorName: null,
      });
    }

    if (h.actualEndedAt) {
      const adjustment = h.actualDurationSeconds != null ? `, Launch Clock adjusted +${fmtSecs(h.actualDurationSeconds)}` : "";
      entries.push({
        timestamp: h.actualEndedAt,
        source: "HOLD",
        text: `${kind} hold released${adjustment}`,
        actorName: h.enteredBy?.name ?? null,
      });
    }
  }

  for (const n of notamFilings) {
    if (n.filedDate) {
      entries.push({
        timestamp: n.filedDate,
        source: "FAA_NOTAM",
        text: `NOTAM filed${n.leidosConfirmationNumber ? ` (Leidos confirmation ${n.leidosConfirmationNumber})` : ""}${
          n.notamWindowOpen && n.notamWindowClose ? `, window ${n.notamWindowOpen.toISOString()} – ${n.notamWindowClose.toISOString()}` : ""
        }`,
        actorName: n.filedBy?.name ?? null,
      });
    }
  }

  for (const notif of notifications) {
    if (notif.timestamp) {
      const label = NOTIFICATION_TYPE_LABELS[notif.notificationType] ?? notif.notificationType;
      const outcome = notif.notApplicable ? "N/A" : notif.satisfied ? "completed" : "logged";
      entries.push({
        timestamp: notif.timestamp,
        source: "FAA_NOTAM",
        text: `${label} ${outcome}${notif.contactedFacility ? ` — ${notif.contactedFacility}` : ""}${notif.notes ? ` — ${notif.notes}` : ""}`,
        actorName: notif.contactedBy?.name ?? null,
      });
    }
  }

  for (const p of personnelAudit) {
    let text: string;
    switch (p.action) {
      case "ASSIGNED":
        text = `${p.role} assigned to ${p.newUser?.name ?? "—"}`;
        break;
      case "REASSIGNED":
        text = `${p.role} reassigned: ${p.previousUser?.name ?? "—"} → ${p.newUser?.name ?? "—"}`;
        break;
      case "REMOVED":
        text = `${p.role} assignment removed (was ${p.previousUser?.name ?? "—"})`;
        break;
      case "ON_STATION":
        text = `${p.role} (${p.newUser?.name ?? "—"}) checked ON STATION`;
        break;
      case "OFF_STATION":
        text = `${p.role} (${p.newUser?.name ?? "—"}) checked OFF STATION`;
        break;
      case "OFF_STATION_OVERRIDE":
        text = `${p.role} (${p.newUser?.name ?? "—"}) marked OFF-STATION (OVERRIDDEN)${p.notes ? ` — ${p.notes}` : ""}`;
        break;
      case "OFF_STATION_OVERRIDE_CLEARED":
        text = `${p.role} (${p.newUser?.name ?? "—"}) off-station override cleared`;
        break;
      default:
        text = `${p.role} personnel event: ${p.action}`;
    }
    entries.push({ timestamp: p.timestamp, source: "PERSONNEL", text, actorName: p.actor.name });
  }

  for (const a of pollAudit) {
    const overrideTag = a.isOverride ? " [ADMIN OVERRIDE]" : "";
    entries.push({
      timestamp: a.timestamp,
      source: "POLLS",
      text: `LSC item ${a.itemKey}: ${a.previousValue ?? "—"} → ${a.newValue}${overrideTag}`,
      actorName: a.actor.name,
    });
  }
  if (mission?.launchCountTimeConfirmedAt) {
    entries.push({
      timestamp: mission.launchCountTimeConfirmedAt,
      source: "POLLS",
      text: "Launch Status Check completed — Launch Count Time confirmed",
      actorName: mission.launchCountTimeConfirmedById
        ? (await prisma.user.findUnique({ where: { id: mission.launchCountTimeConfirmedById } }))?.name ?? null
        : null,
    });
  }

  for (const m of manualLog) {
    entries.push({ timestamp: m.timestamp, source: "MANUAL_LOG", text: m.text, actorName: m.author.name });
  }

  // v9.0 Section 3.2/4.4.3 - formal comms messages, PEMSG-prefixed,
  // rendered in the exact same compact format the Stations page composer
  // produces.
  for (const c of commsMessages) {
    const line = formatCommsLine({
      timestamp: c.timestamp,
      senderRole: c.senderRole,
      recipient: c.recipient,
      actionCode: c.actionCode,
      fields: c.fields as Record<string, unknown> | null,
      detail: c.detail,
    });
    entries.push({ timestamp: c.timestamp, source: "COMMS", text: `PEMSG  ${line}`, actorName: c.sender.name });
  }

  entries.sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
  return entries;
}

export interface LogHeaderClocks {
  tCountSeconds: number | null;
  projectedLiftoff: Date | null;
}

/** T- and L- clock readings at the moment of generation, for the header. */
export async function computeHeaderClocks(missionId: string): Promise<LogHeaderClocks> {
  const mission = await prisma.mission.findUnique({ where: { id: missionId }, include: { holds: true } });
  if (!mission) return { tCountSeconds: null, projectedLiftoff: null };
  const now = new Date();
  const activeHold = mission.holds.find((h) => h.status === "ACTIVE") ?? null;
  const tCountSeconds = computeTCountSeconds(mission as any, activeHold as any, now);
  const projectedLiftoff = computeProjectedLiftoff(mission as any, mission.holds as any, now);
  return { tCountSeconds, projectedLiftoff };
}
