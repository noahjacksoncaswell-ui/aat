import { jsPDF } from "jspdf";
import type { MetocMefResponse } from "../../types";

// v8.0 Section 4.4 - the Unofficial MEF's document format is a hard
// requirement, not a style preference: it must read as a draft machine
// output (a cockpit printer / teletype weather machine), NOT a polished,
// human-authored document - that visual distinction from AAT's real,
// human-authored MEFs is itself how a reader instantly recognizes this as
// unofficial. Concretely: Courier only (no other font anywhere), black text
// on white with zero color of any kind, no logo/image/graphic of any kind,
// ASCII-character dividers (matching the Launch Countdown Procedure
// reference document's own asterisk-header-block convention), and every
// field/table laid out with fixed-width space padding rather than a
// styled HTML/CSS table - this file deliberately does NOT use
// jspdf-autotable (which draws borders/shading) for exactly that reason.
// This is the one place in the app where the monotone-with-color-accents
// design system (v3.0 Section 1.1) does not apply at all.

const MAJOR_RULE = "=".repeat(69);
const HEADER_RULE = "*".repeat(69);

const DISCLAIMER =
  "DRAFT / UNOFFICIAL MISSION EXECUTION FORECAST (MEF). NOT APPROVED BY THE LAUNCH WEATHER OFFICER (LWO). NOT VALID FOR OFFICIAL USE, MISSION PLANNING RELIANCE, OR LAUNCH WEATHER COMMIT CRITERIA (LWCC) COMPLIANCE DETERMINATION.";

function riskBucket(pct: number | undefined): string {
  if (pct == null) return "N/A";
  if (pct >= 70) return "High";
  if (pct >= 40) return "Moderate";
  if (pct >= 20) return "Low";
  return "None";
}

function twoCol(left: string, right: string, leftWidth = 39): string {
  // A field long enough to exceed leftWidth (e.g. a long shortForecast
  // string) must still keep a visible gap before the right column - without
  // this, padEnd() is a no-op past its target width and the two columns run
  // together illegibly.
  return left.length >= leftWidth ? `${left} ${right}` : left.padEnd(leftWidth, " ") + right;
}

function formatDateLabel(dateStr: string): string {
  const d = new Date(`${dateStr}T00:00:00Z`);
  return d.toLocaleDateString("en-US", { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" }).replace(/ /g, "-");
}

export function buildMefPdf(mef: MetocMefResponse): jsPDF {
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

  function printLine(text: string, opts?: { bold?: boolean; size?: number }) {
    ensureRoom();
    doc.setFont("courier", opts?.bold ? "bold" : "normal");
    doc.setFontSize(opts?.size ?? fontSize);
    doc.text(text, margin, y);
    doc.setFontSize(fontSize);
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

  // --- Header field block, asterisk-bordered per the reference document ---
  printRule(HEADER_RULE);
  printLine("MISSION EXECUTION FORECAST (UNOFFICIAL / DRAFT)", { bold: true });
  printRule(HEADER_RULE);
  printLine(twoCol("Mission:", mef.header.mission, 12));
  printLine(twoCol("Issued:", new Date(mef.header.issuedAt).toUTCString(), 12));
  printLine(twoCol("Valid:", mef.header.valid.map(formatDateLabel).join("; "), 12));
  printLine(twoCol("Duration:", mef.header.duration, 12));
  printLine(twoCol("Site:", mef.header.site, 12));
  printLine(twoCol("Station:", mef.header.station, 12));
  printRule(HEADER_RULE);
  y += lineHeight / 2;

  // --- Disclaimer, prominent, near top, verbatim ---
  printWrapped(DISCLAIMER, { bold: true });
  y += lineHeight / 2;

  // --- Forecast Discussion ---
  printLine("FORECAST DISCUSSION", { bold: true });
  y += lineHeight / 4;
  const discussionParagraphs = mef.forecastDiscussion.split(/\n\s*\n/);
  for (const para of discussionParagraphs) {
    printWrapped(para.replace(/\s+/g, " ").trim());
    y += lineHeight / 3;
  }

  // --- Per-day data blocks ---
  for (const day of mef.days) {
    ensureRoom(14);
    printRule(MAJOR_RULE);
    printLine(formatDateLabel(day.date), { bold: true });
    printLine(`Probability of Violating Weather Constraints: ${day.povPercent}%`);
    const concerns = day.primaryConcerns.length ? day.primaryConcerns.join(", ") : "None";
    printWrapped(`Primary Concerns: ${concerns}`);
    y += lineHeight / 3;

    const precipBucket = riskBucket(day.precipitationProbabilityPct);
    const tempStr = `${day.tempAvgF ?? "-"}F / ${day.tempHighF ?? "-"}F / ${day.tempLowF ?? "-"}F`;
    const dewStr = `${day.dewpointF != null ? Math.round(day.dewpointF) + "F" : "-"} / ${day.humidityPct != null ? day.humidityPct + "%" : "-"}`;
    const windStr = `${day.windDirectionDeg ?? "-"} ${day.windSpeedText ?? "-"}`;

    printLine(twoCol("Weather Conditions", "Additional Risk Criteria"), { bold: true });
    printLine(twoCol(`Temp (A/H/L): ${tempStr}`, `Distributed Weather: ${precipBucket}`));
    printLine(twoCol(`Dew/Humidity: ${dewStr}`, `Precipitation: ${precipBucket}`));
    printLine(twoCol(`Weather/Visibility: ${day.shortForecast ?? "-"} / -`, "Upper-Level Wind-Shear: N/A - Not Sourced"));
    printLine(twoCol(`Launch Winds: ${windStr}`, `Solar Activity: ${day.solarActivity ?? "N/A - Not Sourced"}`));
    printLine(`Coverage: ${day.coverage}`);
    printLine("Type: -");
    printLine("Base (ft): -");
    printLine("Tops (ft): -");
  }

  // --- Notes, mirroring the reference document's own Notes convention ---
  ensureRoom(14);
  printRule(MAJOR_RULE);
  printLine("NOTES", { bold: true });
  printRule(MAJOR_RULE);
  printWrapped(
    "1. The Probability of Violation (PoV) figure above is a forecast-based planning estimate, computed by applying this platform's LWCC threshold definitions to NWS point-forecast data. It is not a certified calculation."
  );
  y += lineHeight / 3;
  printWrapped(
    "2. Cloud Type, Cloud Base, Cloud Tops, and Upper-Level Wind Shear are not carried by the source forecast product and are marked N/A - Not Sourced rather than estimated. Solar Activity, where shown, is sourced from NOAA SWPC's planetary K-index rather than estimated."
  );
  y += lineHeight / 3;
  printWrapped("3. THIS DOCUMENT IS UNOFFICIAL AND AUTO-GENERATED. IT HAS NOT BEEN REVIEWED OR APPROVED BY THE LAUNCH WEATHER OFFICER.", { bold: true });

  // --- Page header (company name, plain text) + footer (Page: X of X) on every page ---
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

export function mefFileName(mef: MetocMefResponse): string {
  const label = mef.header.mission === "NONE/GENERAL MEF" ? "General" : mef.header.mission.split("/")[0]?.trim();
  const first = mef.header.valid[0] ?? "unknown-date";
  return `Unofficial-MEF-${label}-${first}.pdf`.replace(/[\\/:*?"<>|]/g, "-");
}
