// v9.0 Section 4.4 - Formal Role Communications action catalog.
//
// This is the single source of truth for the "logic gates" the directive's
// Section 4.4.2 tables specify: which action codes each mission role may
// send, and which fields each action requires. The comms POST route
// validates every incoming message against this catalog before writing a
// FormalCommsMessage row - nothing here ever calls into another module's
// state-changing logic (Section 4.4.4/Section 6: this is a communications
// layer, not a control layer).

import { MissionRole } from "@prisma/client";

export type CommsFieldId =
  | "effectiveTime" // Effective Time - seconds-from-now delay; 0/blank = "now"/immediate
  | "duration" // Duration in seconds, or omitted when isIndefinite is set
  | "isIndefinite" // IND - Duration replaced by "indefinite"
  | "system" // VSE poll-item System dropdown (Propulsion/Avionics/.../LOIS)
  | "status" // action-specific status enum (see statusOptions below)
  | "lwccrNumbers" // LWCC Violation Report - one or more LWCCR numbers
  | "estimatedClearTime" // Weather Hold Estimate
  | "detail"; // freeform short text

export interface CommsFieldDef {
  id: CommsFieldId;
  label: string;
  required: boolean;
  /** For "status" fields: the fixed set of values the sender picks from. */
  statusOptions?: string[];
}

export interface CommsActionDef {
  code: string;
  label: string;
  fields: CommsFieldDef[];
  /** REC HOLD / REC TERM - directive Section 4.4.2: recipient locked to LD. */
  recipientLockedToLd?: boolean;
}

// v9.0 Section 4.4.2 - "System" field reuses the existing VSE Polls-box
// system list (Section 3.3 of v7.1), not a new list.
export const COMMS_SYSTEM_OPTIONS = ["Propulsion", "Avionics", "Telemetry", "Staging", "Recovery", "Pad", "VFS", "LOIS"];

const EFFECTIVE_TIME: CommsFieldDef = { id: "effectiveTime", label: "Effective Time", required: false };
const DURATION: CommsFieldDef = { id: "duration", label: "Duration", required: false };
const IS_INDEFINITE: CommsFieldDef = { id: "isIndefinite", label: "Indefinite", required: false };
const SYSTEM: CommsFieldDef = { id: "system", label: "System", required: true };
const SYSTEM_OPTIONAL: CommsFieldDef = { id: "system", label: "System", required: false };
const DETAIL_REQUIRED: CommsFieldDef = { id: "detail", label: "Detail", required: true };
const DETAIL_OPTIONAL: CommsFieldDef = { id: "detail", label: "Detail", required: false };

// Every role gets these in addition to its own list (directive Section 4.4.2).
export const UNIVERSAL_ACTIONS: CommsActionDef[] = [
  { code: "ACK", label: "Acknowledge", fields: [DETAIL_OPTIONAL] },
  { code: "STAT RPT", label: "Status Report", fields: [DETAIL_REQUIRED] },
  { code: "ADVISORY", label: "Advisory", fields: [DETAIL_REQUIRED] },
];

const LD_ACTIONS: CommsActionDef[] = [
  { code: "CTS", label: "Call to Stations", fields: [DETAIL_OPTIONAL] },
  { code: "HOLD APPR", label: "Hold Recommendation — Approve", fields: [DETAIL_OPTIONAL] },
  { code: "HOLD DENY", label: "Hold Recommendation — Deny", fields: [DETAIL_REQUIRED] },
  { code: "TERM APPR", label: "Terminate Recommendation — Approve", fields: [DETAIL_OPTIONAL] },
  { code: "TERM DENY", label: "Terminate Recommendation — Deny", fields: [DETAIL_REQUIRED] },
  { code: "REQ STAT", label: "Request Status", fields: [DETAIL_OPTIONAL] },
  { code: "ADVISORY", label: "Advisory", fields: [DETAIL_REQUIRED] },
];

const RC_ACTIONS: CommsActionDef[] = [
  { code: "REC HOLD", label: "Recommend Hold", fields: [EFFECTIVE_TIME, DURATION, IS_INDEFINITE, DETAIL_REQUIRED], recipientLockedToLd: true },
  { code: "REC TERM", label: "Recommend Terminate", fields: [DETAIL_REQUIRED], recipientLockedToLd: true },
  { code: "RANGE ANOM", label: "Range Anomaly", fields: [DETAIL_REQUIRED] },
  { code: "RANGE CLR", label: "Range Clear", fields: [] },
  { code: "RANGE NCLR", label: "Range Not Clear", fields: [DETAIL_REQUIRED] },
  { code: "PERS CLR", label: "Personnel Clear", fields: [] },
  { code: "TFR CONF", label: "TFR Confirmed", fields: [] },
  { code: "RECOVERY", label: "Recovery Status", fields: [DETAIL_REQUIRED] },
  { code: "COMMS CHK", label: "Comms Check", fields: [{ id: "status", label: "Status", required: true, statusOptions: ["UP", "DOWN"] }] },
  { code: "AIRSPACE", label: "Airspace Status", fields: [DETAIL_REQUIRED] },
];

const LWO_ACTIONS: CommsActionDef[] = [
  { code: "REC HOLD", label: "Recommend Hold (Weather)", fields: [EFFECTIVE_TIME, DURATION, IS_INDEFINITE, DETAIL_REQUIRED], recipientLockedToLd: true },
  { code: "REC TERM", label: "Recommend Terminate", fields: [DETAIL_REQUIRED], recipientLockedToLd: true },
  { code: "LWCC VIOL", label: "LWCC Violation Report", fields: [{ id: "lwccrNumbers", label: "LWCCR Number(s)", required: true }, DETAIL_REQUIRED] },
  { code: "WX CLR", label: "Weather Clear", fields: [] },
  { code: "WX NCLR", label: "Weather Not Clear", fields: [DETAIL_REQUIRED] },
  { code: "WX UPDATE", label: "Weather Update", fields: [DETAIL_REQUIRED] },
  { code: "WX EST", label: "Weather Hold Estimate", fields: [{ id: "estimatedClearTime", label: "Estimated Clear Time", required: true }] },
];

const VSE_ACTIONS: CommsActionDef[] = [
  { code: "SYS ANOM", label: "System Anomaly", fields: [SYSTEM, DETAIL_REQUIRED] },
  { code: "REC HOLD", label: "Recommend Hold", fields: [EFFECTIVE_TIME, DURATION, IS_INDEFINITE, SYSTEM, DETAIL_REQUIRED], recipientLockedToLd: true },
  { code: "REC TERM", label: "Recommend Terminate", fields: [SYSTEM, DETAIL_REQUIRED], recipientLockedToLd: true },
  { code: "SYS NOM", label: "System Nominal", fields: [SYSTEM] },
  {
    code: "TLM STAT",
    label: "Telemetry Status",
    fields: [{ id: "status", label: "Status", required: true, statusOptions: ["NOMINAL", "DEGRADED", "LOST"] }, DETAIL_REQUIRED],
  },
  {
    code: "ARM STAT",
    label: "Arming Status",
    fields: [{ id: "status", label: "Status", required: true, statusOptions: ["SAFE", "ARMED"] }, DETAIL_REQUIRED],
  },
  { code: "VEH READY", label: "Vehicle Ready", fields: [] },
];

// v9.0 Section 4.4.1 - OTHER is available to every role, freeform text only.
export const OTHER_ACTION: CommsActionDef = { code: "OTHER", label: "Other", fields: [{ id: "detail", label: "Detail", required: true }] };

const ROLE_ACTIONS: Record<MissionRole, CommsActionDef[]> = {
  LD: LD_ACTIONS,
  RC: RC_ACTIONS,
  LWO: LWO_ACTIONS,
  VSE: VSE_ACTIONS,
  OPS_SUPPORT: [],
};

/** Full action set for a role: its own list + Universal + OTHER, per Section 4.4.2. */
export function actionsForRole(role: MissionRole): CommsActionDef[] {
  return [...ROLE_ACTIONS[role], ...UNIVERSAL_ACTIONS, OTHER_ACTION];
}

export function findAction(role: MissionRole, code: string): CommsActionDef | undefined {
  return actionsForRole(role).find((a) => a.code === code);
}

// v9.0 Section 4.4.3 - compact METAR-style log line, exact field order per
// the directive's worked example:
//   29-09-2026  19:37:14  VSE > LD  REC HOLD  EFF 00:15:00 / DUR 00:20:00  PROPULSION AR
// Order: EFF time (if present) / DUR duration-or-IND (if present), then
// System value (if present), then status value (if present), then LWCCR
// number(s) (if present), then estimated clear time (if present), then
// Detail text last.
export interface CommsMessageForFormat {
  timestamp: Date;
  senderRole: string;
  recipient: string;
  actionCode: string;
  fields: Record<string, unknown> | null;
  detail: string | null;
}

function pad2(n: number): string {
  return n.toString().padStart(2, "0");
}

function formatDateDDMMYYYY(d: Date): string {
  return `${pad2(d.getUTCDate())}-${pad2(d.getUTCMonth() + 1)}-${d.getUTCFullYear()}`;
}

function formatTimeHHMMSS(d: Date): string {
  return `${pad2(d.getUTCHours())}:${pad2(d.getUTCMinutes())}:${pad2(d.getUTCSeconds())}`;
}

function secondsToHms(totalSeconds: number): string {
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = Math.floor(totalSeconds % 60);
  return `${pad2(h)}:${pad2(m)}:${pad2(s)}`;
}

export function formatCommsLine(msg: CommsMessageForFormat): string {
  const f = (msg.fields ?? {}) as Record<string, unknown>;

  // v9.0 Section 4.4.3 worked example: "EFF 00:15:00 / DUR 00:20:00" pairs
  // Effective Time with Duration in the same HH:MM:SS style, so Effective
  // Time is a relative delay-from-now (seconds), like Duration - not an
  // absolute clock timestamp. 0/blank means "now"/immediate per Section
  // 4.4.2's common-field definition.
  const effDur =
    typeof f.effectiveTime === "number" || f.isIndefinite || typeof f.duration === "number"
      ? [
          typeof f.effectiveTime === "number" ? `EFF ${secondsToHms(f.effectiveTime)}` : null,
          f.isIndefinite ? "DUR IND" : typeof f.duration === "number" ? `DUR ${secondsToHms(f.duration)}` : null,
        ]
          .filter(Boolean)
          .join(" / ")
      : null;

  const segments: string[] = [];
  if (effDur) segments.push(effDur);
  if (typeof f.system === "string" && f.system) segments.push(String(f.system).toUpperCase());
  if (typeof f.status === "string" && f.status) segments.push(String(f.status).toUpperCase());
  if (typeof f.lwccrNumbers === "string" && f.lwccrNumbers) segments.push(`LWCCR ${f.lwccrNumbers}`);
  if (typeof f.estimatedClearTime === "string" && f.estimatedClearTime) segments.push(`EST CLR ${f.estimatedClearTime}`);
  if (msg.detail) segments.push(msg.detail);

  const tail = segments.join("  ");

  return [
    formatDateDDMMYYYY(msg.timestamp),
    formatTimeHHMMSS(msg.timestamp),
    `${msg.senderRole} > ${msg.recipient}`,
    msg.actionCode,
    tail,
  ]
    .filter((s) => s !== "")
    .join("  ");
}
