import { COA, NOTAMFiling } from "@prisma/client";

export type CoaComputedStatus = "ACTIVE" | "EXPIRED" | "PENDING";

export function computeCoaStatus(coa: COA, now: Date = new Date()): CoaComputedStatus {
  if (now < coa.effectiveDate) return "PENDING";
  if (now > coa.expirationDate) return "EXPIRED";
  return "ACTIVE";
}

export type SiteCoaStatus = CoaComputedStatus | "NOT_ON_FILE";

export function computeBestSiteCoaStatus(coas: COA[], now: Date = new Date()): SiteCoaStatus {
  if (coas.length === 0) return "NOT_ON_FILE";
  const statuses = coas.map((c) => computeCoaStatus(c, now));
  if (statuses.includes("ACTIVE")) return "ACTIVE";
  if (statuses.includes("PENDING")) return "PENDING";
  return "EXPIRED";
}

export type NotamComputedStatus = "NOT_FILED" | "FILED" | "OVERDUE";

/**
 * Section 7.3: advance notice must be filed 7 days prior to the targeted
 * launch opportunity. If the window is inside that 7-day horizon and no
 * filing exists yet, the requirement is overdue.
 */
export function computeNotamStatus(
  filing: NOTAMFiling | null | undefined,
  targetedWindowOpen: Date | null | undefined,
  now: Date = new Date()
): NotamComputedStatus {
  if (filing?.filedDate) return "FILED";
  if (!targetedWindowOpen) return "NOT_FILED";
  const sevenDaysBefore = new Date(targetedWindowOpen.getTime() - 7 * 24 * 60 * 60 * 1000);
  if (now >= sevenDaysBefore) return "OVERDUE";
  return "NOT_FILED";
}

export const REQUIRED_NOTIFICATION_TYPES = ["T_MINUS_60", "T_MINUS_15", "TERMINATION"] as const;
