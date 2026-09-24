// v7.1 Section 3 - the Launch Status Check's fixed catalog of role-owned
// poll items. Status is validated per item here (not at the DB level)
// because different items have different value sets.

export type PollBoxRole = "VSE" | "LWO" | "RC" | "LD";

export interface PollItemDef {
  key: string;
  box: PollBoxRole;
  label: string;
  allowedValues: string[];
  /** The value an Admin's one-click override control forces this item to. */
  affirmativeValue: string;
  /** RC_AIRSPACE only - no normal "assigned person sets it" path; always
   * computed unless an Admin has overridden it (Section 3.5). */
  computed?: boolean;
}

const STANDARD = ["UNPOLLED", "GO", "NO_GO", "HOLD"];

export const POLL_ITEM_CATALOG: PollItemDef[] = [
  { key: "VSE_PROPULSION", box: "VSE", label: "Propulsion", allowedValues: STANDARD, affirmativeValue: "GO" },
  { key: "VSE_AVIONICS", box: "VSE", label: "Avionics", allowedValues: STANDARD, affirmativeValue: "GO" },
  { key: "VSE_TELEMETRY", box: "VSE", label: "Telemetry", allowedValues: STANDARD, affirmativeValue: "GO" },
  { key: "VSE_STAGING", box: "VSE", label: "Staging", allowedValues: STANDARD, affirmativeValue: "GO" },
  { key: "VSE_RECOVERY", box: "VSE", label: "Recovery", allowedValues: STANDARD, affirmativeValue: "GO" },
  { key: "VSE_PAD", box: "VSE", label: "Pad", allowedValues: STANDARD, affirmativeValue: "GO" },
  { key: "VSE_LCS", box: "VSE", label: "LCS (Launch Control System)", allowedValues: STANDARD, affirmativeValue: "GO" },
  { key: "VSE_LOIS", box: "VSE", label: "LOIS", allowedValues: STANDARD, affirmativeValue: "GO" },
  { key: "LWO_WEATHER", box: "LWO", label: "Weather", allowedValues: ["UNPOLLED", "CLEAR", "NOT_CLEAR", "HOLD"], affirmativeValue: "CLEAR" },
  { key: "RC_COMMUNICATIONS", box: "RC", label: "Communications", allowedValues: STANDARD, affirmativeValue: "GO" },
  { key: "RC_OPS_SUPPORT", box: "RC", label: "Ops Support", allowedValues: STANDARD, affirmativeValue: "GO" },
  {
    key: "RC_RANGE_STATUS",
    box: "RC",
    label: "Range Status",
    allowedValues: ["UNPOLLED", "CLEAR_TO_PROCEED", "NOT_CLEAR_TO_PROCEED", "HOLD"],
    affirmativeValue: "CLEAR_TO_PROCEED",
  },
  { key: "RC_AIRSPACE", box: "RC", label: "Airspace", allowedValues: ["UNPOLLED", "GO", "NO_GO"], affirmativeValue: "GO", computed: true },
  {
    key: "LD_FINAL_LAUNCH_STATUS",
    box: "LD",
    label: "Final Launch Status",
    allowedValues: ["UNPOLLED", "GO_FOR_LAUNCH", "NO_GO", "HOLD"],
    affirmativeValue: "GO_FOR_LAUNCH",
  },
];

export function getPollItemDef(key: string): PollItemDef | undefined {
  return POLL_ITEM_CATALOG.find((i) => i.key === key);
}

// v7.1.1 Section 1 - every item in the catalog (including
// LD_FINAL_LAUNCH_STATUS) must read its own affirmative value before the
// Launch Count Time Confirmation becomes available. Returns each
// unsatisfied item's display label ("VSE PROPULSION" etc., matching the
// existing itemKey-as-label convention used in the audit history log).
export function computeUnsatisfiedItems(items: { key: string; status: string }[]): string[] {
  return POLL_ITEM_CATALOG.filter((def) => items.find((i) => i.key === def.key)?.status !== def.affirmativeValue).map((def) =>
    def.key.replace(/_/g, " ")
  );
}
