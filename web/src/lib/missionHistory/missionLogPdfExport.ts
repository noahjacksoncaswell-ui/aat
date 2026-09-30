import { jsPDF } from "jspdf";
import type { Mission, UnifiedLogResponse } from "../../types";

// v9.0 Section 3.5 - the Unified Mission Command Log's document format is
// IDENTICAL to the Unofficial MEF's teletype style, not merely similar: a
// standing visual convention for this application's family of
// auto-generated technical documents. See mefPdfExport.ts for the full
// rationale (draft machine output, not a polished human-authored
// document). Courier only, black-on-white only, ASCII dividers, fixed-
// width space-padded columns, no logo/image/color anywhere.

const MAJOR_RULE = "=".repeat(69);
const HEADER_RULE = "*".repeat(69);

function twoCol(left: string, right: string, leftWidth = 22): string {
  return left.length >= leftWidth ? `${left} ${right}` : left.padEnd(leftWidth, " ") + right;
}

function pad2(n: number): string {
  return n.toString().padStart(2, "0");
}

// Matches the sidebar/PersistentClockHeader convention: T-/T+ and L-/L+
// prefixes with HH:MM:SS (Nd HH:MM:SS past a day).
function formatClockSeconds(totalSeconds: number | null, prefix: string): string {
  if (totalSeconds == null) return "PENDING";
  const isPast = totalSeconds < 0;
  const abs = Math.abs(totalSeconds);
  const days = Math.floor(abs / 86400);
  const hours = Math.floor((abs % 86400) / 3600);
  const minutes = Math.floor((abs % 3600) / 60);
  const seconds = Math.floor(abs % 60);
  const core = days > 0 ? `${days}d ${pad2(hours)}:${pad2(minutes)}:${pad2(seconds)}` : `${pad2(hours)}:${pad2(minutes)}:${pad2(seconds)}`;
  return `${isPast ? prefix.replace("-", "+") : prefix}${core}`;
}

function formatClockFromTarget(targetIso: string | null, now: Date, prefix: string): string {
  if (!targetIso) return "PENDING";
  const target = new Date(targetIso);
  const seconds = (target.getTime() - now.getTime()) / 1000;
  return formatClockSeconds(seconds, prefix);
}

function fmtZulu(d: Date): string {
  return d
    .toISOString()
    .replace("T", " ")
    .replace(/\.\d+Z$/, "Z");
}

function fmtLocal(d: Date): string {
  return d.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "medium" });
}

function fmtEntryTimestamp(iso: string): string {
  const d = new Date(iso);
  const dd = pad2(d.getUTCDate());
  const mm = pad2(d.getUTCMonth() + 1);
  const yyyy = d.getUTCFullYear();
  const hh = pad2(d.getUTCHours());
  const mi = pad2(d.getUTCMinutes());
  const ss = pad2(d.getUTCSeconds());
  return `${dd}-${mm}-${yyyy} ${hh}:${mi}:${ss}`;
}

export function buildMissionLogPdf(mission: Mission, log: UnifiedLogResponse): jsPDF {
  const doc = new jsPDF({ unit: "pt", format: "letter", compress: true });
  const margin = 44;
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const lineHeight = 11;
  const fontSize = 8.5;
  const bottomLimit = pageHeight - 40;

  doc.setFont("courier", "normal");
  doc.setFontSize(fontSize);
  doc.setTextColor(0, 0, 0);

  let y = margin;

  function newPage() {
    doc.addPage();
    y = margin;
  }
  function ensureRoom(lines = 1) {
    if (y + lines * lineHeight > bottomLimit) newPage();
  }
  function printLine(text: string, opts?: { bold?: boolean }) {
    ensureRoom();
    doc.setFont("courier", opts?.bold ? "bold" : "normal");
    doc.text(text, margin, y);
    y += lineHeight;
  }
  function printWrapped(text: string, opts?: { bold?: boolean }) {
    const maxWidth = pageWidth - margin * 2;
    doc.setFont("courier", opts?.bold ? "bold" : "normal");
    const lines: string[] = doc.splitTextToSize(text, maxWidth);
    for (const l of lines) printLine(l, opts);
  }
  function printRule(char: string) {
    printLine(char);
  }

  const now = new Date();

  // --- Header field block ---
  printRule(HEADER_RULE);
  printLine("UNIFIED MISSION COMMAND LOG", { bold: true });
  printRule(HEADER_RULE);
  printLine(twoCol("Mission:", `${mission.name} (${mission.designator})`));
  printLine(twoCol("Vehicle:", mission.vehicle.name));
  printLine(twoCol("Site:", mission.site.name));
  printLine(twoCol("Report Generated (Z):", fmtZulu(now)));
  printLine(twoCol("Report Generated (Local):", fmtLocal(now)));
  printLine(twoCol("T- (Test Clock):", formatClockSeconds(log.tCountSeconds, "T-")));
  printLine(twoCol("L- (Launch Clock):", formatClockFromTarget(log.projectedLiftoff, now, "L-")));
  printLine(twoCol("LOG STATUS:", log.logStatus), { bold: true });
  printRule(HEADER_RULE);
  y += lineHeight / 2;

  // --- Body: strict chronological order, every event, timestamped to the second ---
  if (log.entries.length === 0) {
    printLine("NO EVENTS RECORDED.");
  } else {
    for (const e of log.entries) {
      ensureRoom(2);
      const ts = fmtEntryTimestamp(e.timestamp);
      const actor = e.actorName ? `  (${e.actorName})` : "";
      printWrapped(`${ts}  [${e.source}]  ${e.text}${actor}`);
    }
  }

  ensureRoom(4);
  printRule(MAJOR_RULE);
  printWrapped(`END OF LOG — ${log.entries.length} EVENT(S) — LOG STATUS: ${log.logStatus}`, { bold: true });

  // --- Page header/footer ---
  const totalPages = doc.getNumberOfPages();
  for (let p = 1; p <= totalPages; p++) {
    doc.setPage(p);
    doc.setFont("courier", "normal");
    doc.setFontSize(fontSize);
    doc.setTextColor(0, 0, 0);
    doc.text("AMERICAN AEROSPACE TECHNOLOGIES CORP", margin, 24);
    doc.text(`Page: ${p} of ${totalPages}`, pageWidth - margin, pageHeight - 24, { align: "right" });
  }

  return doc;
}

export function missionLogFileName(mission: Mission): string {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  return `Mission-Command-Log-${mission.designator}-${stamp}.pdf`.replace(/[\\/:*?"<>|]/g, "-");
}
