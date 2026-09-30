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
import { LWCC_REQUIREMENTS } from "./lwcc";

export type LogStatus = "PENDING" | "IN PROGRESS" | "CLOSED";

// v9.2 Section 6 - six-category consolidation, replacing the prior
// tags-per-subsystem scheme with a coherent mental model:
//   LIFECYCLE - mission-level plan/schedule (what the plan is)
//   CCS       - countdown/clock mechanics (holds, LOT revision, recycle,
//               liftoff mark) once a mission is actively counting down
//   LWCC      - weather compliance activity
//   FAA_NOTAM - FAA/NOTAM coordination logging
//   PERUPD    - personnel assignment updates
//   POLLS     - Launch Status Check activity
//   MANUAL_LOG - freeform Log tab entries
//   PEMSG     - formal role communications
export interface UnifiedLogEntry {
  timestamp: Date;
  source: "LIFECYCLE" | "CCS" | "LWCC" | "FAA_NOTAM" | "PERUPD" | "POLLS" | "MANUAL_LOG" | "PEMSG";
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
  LOT_REVISED: "LOT Revised (Select New LOT)",
  HOLD_CALLED: "Hold Called",
  HOLD_RELEASED: "Hold Released",
  RECYCLED: "Countdown Recycled to Mark",
  LIFTOFF_MARKED: "Liftoff Marked (Actual Launch Time Established)",
  NOTE: "Note",
  COFR_COMPLIANCE_LAPSED: "CoFR Compliance Lapsed",
  COFR_COMPLIANCE_RESOLVED: "CoFR Compliance Resolved",
  TERMINAL_COUNT_ARMED: "Terminal Count Armed",
  TERMINAL_COUNT_REVOKED: "Terminal Count Arm Revoked",
  TERMINAL_COUNT_AUTO_HOLD: "Terminal Count Not Authorized - Hold Forced",
  XMIT_CCS_TO_VFS: "CCS Transmitted to VFS",
  LSC_ERROR_HOLD_RAISED: "LSC Verification Error Hold Raised",
  LSC_ERROR_HOLD_RESOLVED: "LSC Verification Error Hold Resolved",
};

// v9.2 Section 6.3 - these MissionHistoryEventTypes are countdown/clock
// mechanics (day-of-operation events), not mission-plan-establishing
// events, so they belong to [CCS] rather than [LIFECYCLE] - matching the
// category's own stated boundary ("not the moment-to-moment mechanics of
// running its clocks") even though the directive's explicit CCS bullet
// list names these by their UI action label (Select New LOT/Recycle-to-
// Mark/Mark Liftoff/hold opened-released) rather than their internal
// MissionHistoryEventType constant names.
const CCS_HISTORY_EVENT_TYPES = new Set([
  "LOT_REVISED",
  "HOLD_CALLED",
  "HOLD_RELEASED",
  "RECYCLED",
  "LIFTOFF_MARKED",
  "TERMINAL_COUNT_ARMED",
  "TERMINAL_COUNT_REVOKED",
  "TERMINAL_COUNT_AUTO_HOLD",
  "XMIT_CCS_TO_VFS",
  "LSC_ERROR_HOLD_RAISED",
  "LSC_ERROR_HOLD_RESOLVED",
]);

// v9.0 Section 3.2 - LWCC hold recommendations: the v5.3 Recommendation
// Panel text is purely client-side computed each render and never
// persisted server-side, so there is no discrete "recommendation event" to
// pull from. Interpretive choice (documented here per Section 6's
// instruction to flag deviations): recommendation activity is represented
// via the already-logged LwccLogEntry events themselves, rendered with
// recommendation-style phrasing, rather than inventing new persisted state.
//
// v9.2 Section 7 [SAFETY-CLARITY FIX] - "LWCC-driven hold started" was a
// real defect: at a glance it reads identically to a real [CCS] countdown
// hold, but an LWCC violation being logged never freezes the Test Clock by
// itself (the LWCC panel only recommends - Section 1 of v5.3). Rewritten
// below (describeLwccEntry) to state explicitly whether the violation is
// time-governed (with its expiry) or indefinite, and that a recommendation
// was transmitted to CCS/LD - never a bare, ambiguous "hold started".
const LWCC_EVENT_LABELS: Record<string, string> = {
  REPORT_SUBMITTED: "LWCC manual report submitted",
  OVERRIDE: "LWCC requirement overridden",
  OVERRIDE_CLEARED: "LWCC override cleared",
  LOG_CLEARED: "LWCC log cleared (display marker; underlying rows retained)",
};

/**
 * v9.2 Section 7 - builds the safety-clarity-corrected LWCC entry text for
 * every event type that represents a violation-driven hold recommendation
 * surfacing or clearing. Time-governed/indefinite is derived from the
 * requirement's own static definition (LWCC_REQUIREMENTS[].holdDurationSeconds)
 * rather than trusting per-row `details` JSON, and the expiry (when
 * time-governed) is reconstructed as timestamp + holdDurationSeconds -
 * exactly how the server itself computes it at the moment the row is
 * written (see server/src/routes/lwcc.ts).
 */
function describeLwccEntry(l: { eventType: string; requirementNo: number | null; timestamp: Date; details: unknown }): string | null {
  const reqDef = l.requirementNo != null ? LWCC_REQUIREMENTS.find((r) => r.no === l.requirementNo) : undefined;
  const isTimeGoverned = reqDef?.holdDurationSeconds != null;

  function holdStartedText(): string {
    if (isTimeGoverned) {
      const expires = new Date(l.timestamp.getTime() + (reqDef!.holdDurationSeconds as number) * 1000);
      return `LWCC violation hold started (LWCCR ${l.requirementNo}) — TIME-GOVERNED, expires ${expires.toISOString()} — hold recommendation transmitted to CCS/LD`;
    }
    return `LWCC violation hold started (LWCCR ${l.requirementNo}) — INDEFINITE — hold recommendation transmitted to CCS/LD`;
  }

  if (l.eventType === "VIOLATION_TRIGGERED" || l.eventType === "HOLD_STARTED") {
    return holdStartedText();
  }
  if (l.eventType === "HOLD_EXPIRED") {
    // Never currently written (no scheduler clears a timed LWCC hold row
    // with its own log entry today), but corrected defensively for the
    // same safety-clarity reason - kept internally consistent in case this
    // is wired up in the future.
    return `LWCC violation hold expired (LWCCR ${l.requirementNo}) — LWCC-side resolution, not a CCS-executed action`;
  }
  if (l.eventType === "REPORT_SUBMITTED") {
    const violation = (l.details as any)?.violation === true;
    if (violation && !isTimeGoverned) {
      // The only signal an indefinite/instantaneous-limit violation ever
      // produces - there is no separate HOLD_STARTED row for these
      // (Section 7.4 of v3.0: untimed requirements have no hold timer).
      return holdStartedText();
    }
    if (violation === false) {
      // A manual report clearing a prior violation - the corresponding
      // "violation cleared/resolved" entry Section 7 also requires.
      return `LWCC violation cleared (LWCCR ${l.requirementNo}) — manual report — LWCC-side resolution, not a CCS-executed action`;
    }
  }
  return null; // fall through to the static LWCC_EVENT_LABELS lookup
}

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
      source: CCS_HISTORY_EVENT_TYPES.has(e.eventType) ? "CCS" : "LIFECYCLE",
      text: e.notes ? `${label} — ${e.notes}` : label,
      actorName: e.actor?.name ?? null,
    });
  }

  // v9.2 Section 6.1 - Launch Period entries fold into [LIFECYCLE]; no
  // longer a distinct category.
  for (const lp of launchPeriodEntries) {
    entries.push({
      timestamp: lp.createdAt,
      source: "LIFECYCLE",
      text: `Launch Period entry set: ${lp.date.toISOString().slice(0, 10)} window ${lp.windowOpen.toISOString()} – ${lp.windowClose.toISOString()}`,
      actorName: null,
    });
  }

  for (const l of lwccLog) {
    const correctedText = describeLwccEntry(l);
    const label = LWCC_EVENT_LABELS[l.eventType] ?? l.eventType;
    entries.push({
      timestamp: l.timestamp,
      source: "LWCC",
      text: correctedText ?? (l.requirementNo != null ? `${label} (LWCCR ${l.requirementNo})` : label),
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
      source: "CCS",
      text: `${kind} hold opened at T-minus ${fmtSecs(h.holdMarkSeconds)}${estText}`,
      actorName: h.enteredBy?.name ?? null,
    });

    if (h.status === "DURATION_ELAPSED" && h.estimatedDurationSeconds != null && h.actualStartedAt) {
      entries.push({
        timestamp: new Date(h.actualStartedAt.getTime() + h.estimatedDurationSeconds * 1000),
        source: "CCS",
        text: `${kind} hold ran into overage past its ${fmtSecs(h.estimatedDurationSeconds)} estimate (manual Proceed required)`,
        actorName: null,
      });
    }

    if (h.actualEndedAt) {
      const adjustment = h.actualDurationSeconds != null ? `, Launch Clock adjusted +${fmtSecs(h.actualDurationSeconds)}` : "";
      entries.push({
        timestamp: h.actualEndedAt,
        source: "CCS",
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
    entries.push({ timestamp: p.timestamp, source: "PERUPD", text, actorName: p.actor.name });
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

  // v9.0 Section 3.2/4.4.3 - formal comms messages, rendered in the exact
  // same compact format the Stations page composer produces.
  //
  // v9.2 Section 6.6 - the bracket tag is now [PEMSG] itself, so the
  // inline "PEMSG " text prefix formerly prepended here is redundant and
  // removed - scoped strictly to this Unified Log view. The CCS escalation
  // banner and the Stations page's own PEMSG Log each build their own
  // display text independently (CountdownTab.tsx / Stations.tsx) and are
  // untouched: both keep the inline "PEMSG" prefix exactly as before.
  for (const c of commsMessages) {
    const line = formatCommsLine({
      timestamp: c.timestamp,
      senderRole: c.senderRole,
      recipient: c.recipient,
      actionCode: c.actionCode,
      fields: c.fields as Record<string, unknown> | null,
      detail: c.detail,
    });
    entries.push({ timestamp: c.timestamp, source: "PEMSG", text: line, actorName: c.sender.name });
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
