// v5.0 Section 7 - LOT Submission certification, modeled on Blue Horizons
// Aerospace's IRM-2 Mission Operations Plan (IRM2-MOP-001A) Section 5. The
// eight statements below are quoted verbatim from Revision Directive v5.0
// Section 6 (7.4) and must never be paraphrased, shortened, or reworded.

export const COMR_DOCUMENT_CATEGORY = "Certification of Mission Readiness (CoMR)";
export const COFR_DOCUMENT_CATEGORY = "Certification of Flight Readiness (CoFR)";

export const LOT_CERTIFICATION_TEXTS: string[] = [
  "I certify that I have considered the current vehicle readiness status for this mission, including certification thereof under the applicable Certification of Flight Readiness (CoFR), in selecting this Targeted Launch Opportunity.",
  "I certify that I have considered range availability, including personnel, facilities, and range safety resources, in selecting this Targeted Launch Opportunity.",
  "I certify that I have considered the current and forecast meteorological conditions applicable to this Targeted Launch Opportunity, including the Launch Weather Commit Criteria (LWCC) governing this mission.",
  "I certify that I have considered applicable schedule limitations and constraints, including range, facility, and personnel availability, in selecting this Targeted Launch Opportunity.",
  "I certify that I have considered all applicable safety, operational, and regulatory constraints, including those imposed by 14 CFR Part 101, the site's Certificate of Waiver or Authorization (COA), and AAT internal procedures, in selecting this Targeted Launch Opportunity.",
  "I certify that the Certification of Mission Readiness (CoMR) selected above is the correct and applicable CoMR for this specific mission and the Targeted Launch Opportunity being scheduled herein.",
  "I certify that the launch date, launch window, and Targeted Lift-Off Time (LOT) selected herein are confirmed to be in accordance with, and fall within, the launch period and launch windows established in this mission's Mission Operations Plan (MOP), and that this Targeted Launch Opportunity selection is made in accordance with, and follows, the procedure set forth therein.",
  "I attest that a Certification of Flight Readiness (CoFR) has been approved for the vehicle assigned to this mission, or that such CoFR will be filed no later than twenty-four (24) hours prior to the Targeted Lift-Off Time (LOT). I acknowledge and agree that if a Certification of Flight Readiness has not been approved and filed within this twenty-four (24) hour period, this mission shall be postponed indefinitely and new launch opportunities shall be scheduled in accordance with the Postpone Indefinitely process.",
];

export const COFR_COMPLIANCE_WINDOW_HOURS = 24;

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

/**
 * v5.0 Section 7.3 - the submitted LOT must fall within the site's active
 * COA's Daily Operational Window (dailyWindowOpen/dailyWindowClose, "HH:MM"
 * read directly off the COA record), evaluated against the LOT's Zulu
 * time-of-day since the platform works entirely in UTC/Zulu. A window
 * whose close is earlier than its open is treated as spanning midnight.
 */
export function validateDailyOperationalWindow(lot: Date, dailyWindowOpen: string, dailyWindowClose: string): string | null {
  const [openH, openM] = dailyWindowOpen.split(":").map(Number);
  const [closeH, closeM] = dailyWindowClose.split(":").map(Number);
  const lotMinutes = lot.getUTCHours() * 60 + lot.getUTCMinutes();
  const openMinutes = openH * 60 + openM;
  const closeMinutes = closeH * 60 + closeM;

  const withinWindow =
    closeMinutes >= openMinutes ? lotMinutes >= openMinutes && lotMinutes <= closeMinutes : lotMinutes >= openMinutes || lotMinutes <= closeMinutes;

  if (!withinWindow) {
    return `Targeted LOT time (${pad(lot.getUTCHours())}:${pad(lot.getUTCMinutes())}Z) falls outside the site's active COA Daily Operational Window (${dailyWindowOpen}Z–${dailyWindowClose}Z)`;
  }
  return null;
}
