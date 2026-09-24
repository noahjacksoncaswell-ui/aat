export type Role = "ADMIN" | "LAUNCH_DIRECTOR" | "OPERATOR" | "VIEWER";
export type UserStatus = "ACTIVE" | "INACTIVE";

// v7.0.2 Section 2 - display-only rename of the Admin website role to
// "LOIS Admin." A label change only: the underlying Role enum value stays
// "ADMIN" everywhere (RBAC checks, API payloads, the DB) - this affects
// only what's rendered to the user. Every place that renders a website
// role as text should go through this helper rather than the raw enum
// value, so the rename applies consistently sitewide.
const WEBSITE_ROLE_LABELS: Record<string, string> = {
  ADMIN: "LOIS ADMIN",
  LAUNCH_DIRECTOR: "LAUNCH DIRECTOR",
  OPERATOR: "OPERATOR",
  VIEWER: "VIEWER",
};
export function websiteRoleLabel(role: string): string {
  return WEBSITE_ROLE_LABELS[role] ?? role.replace(/_/g, " ");
}

export interface AuthUser {
  id: string;
  name: string;
  email: string;
  role: Role;
}

export interface UserRecord extends AuthUser {
  status: UserStatus;
  createdAt?: string;
  assignedSites?: { site: { id: string; name: string; designator: string } }[];
  assignedMissions?: { mission: { id: string; name: string; designator: string }; role?: string | null }[];
}

export type SiteStatus = "ACTIVE" | "STANDBY" | "UNDER_CONSTRUCTION" | "DECOMMISSIONED";
export type SiteType = "FIXED_PAD" | "MOBILE_TEL" | "MARINE_PLATFORM" | "OTHER";
export type CoaComputedStatus = "ACTIVE" | "EXPIRED" | "PENDING" | "NOT_ON_FILE";

export type SiteOwnership = "COMPANY_OWNED" | "THIRD_PARTY_LEASED";
export type LandownerAuthorizationStatus = "ON_FILE" | "NOT_ON_FILE";

export interface Site {
  id: string;
  name: string;
  designator: string;
  lat: number;
  lon: number;
  elevationMeters?: number | null;
  status: SiteStatus;
  type: SiteType;
  ownership: SiteOwnership;
  ownershipNotes?: string | null;
  jurisdictionNotes?: string | null;
  nearestPopulationCenters?: string | null;
  nearestWaterBodies?: string | null;
  terrainType?: string | null;
  countryCode: string;
  traconFacilityName?: string | null;
  traconPhone?: string | null;
  artccFacilityName?: string | null;
  artccPhone?: string | null;
  otherFacilityName?: string | null;
  otherFacilityPhone?: string | null;
  otherFacilityNotApplicable?: boolean;
  coaStatus?: CoaComputedStatus;
  landownerAuthorizationStatus?: LandownerAuthorizationStatus;
  photos?: SitePhoto[];
  coas?: Coa[];
}

export interface SitePhoto {
  id: string;
  url: string;
  caption?: string | null;
}

export interface WeatherSnapshot {
  source: "NWS" | "OpenWeatherMap" | "UNAVAILABLE";
  stationId?: string;
  fetchedAt: string;
  temperatureC?: number;
  windSpeedKts?: number;
  windDirectionDeg?: number;
  windGustKts?: number;
  cloudCeilingFt?: number;
  visibilityMi?: number;
  barometricPressureHpa?: number;
  precipitationProbabilityPct?: number;
  shortForecast?: string;
}

export type VehicleStatus = "ACTIVE" | "IN_DEVELOPMENT" | "RETIRED";

export interface Vehicle {
  id: string;
  name: string;
  description?: string | null;
  type?: string | null;
  designator?: string | null;
  vehicleClass?: string | null;
  program?: string | null;
  status: VehicleStatus;
  configurationNotes?: string | null;

  totalLengthIn?: number | null;
  diameterIn?: number | null;
  finSpanIn?: number | null;
  wetMassKg?: number | null;
  dryMassKg?: number | null;
  massFraction?: number | null;

  motorType?: string | null;
  motorManufacturer?: string | null;
  propellantType?: string | null;
  totalImpulseNs?: number | null;
  burnTimeSeconds?: number | null;
  avgThrustN?: number | null;
  maxThrustN?: number | null;
  specificImpulseS?: number | null;

  stageConfiguration?: string | null;

  drogueChuteSpec?: string | null;
  mainChuteSpec?: string | null;
  deploymentMethod?: string | null;
  ejectionChargeConfig?: string | null;

  flightComputer?: string | null;
  telemetrySystem?: string | null;
  gpsTracking?: string | null;
  avionicsRedundancy?: string | null;

  predictedApogeeM?: number | null;
  predictedMaxVelocityMach?: number | null;
  predictedMaxQPsf?: number | null;

  windMaxKts?: number | null;
  ceilingMinFt?: number | null;
  lightningRadiusMi?: number | null;
  maxPrecipProbability?: number | null;
  notes?: string | null;

  templates?: MilestoneTemplate[];
  documents?: DocumentRecord[];
  missions?: Mission[];
  totalMissionsFlown?: number;
  lastFlightDate?: string | null;
}

export interface MilestoneTemplate {
  id: string;
  vehicleId: string;
  name: string;
  items: { id: string; label: string; tMinusSeconds: number; sortOrder: number }[];
}

export type MissionStatus =
  | "PENDING_WINDOW"
  | "TARGETED"
  | "HOLD"
  | "SCRUBBED"
  | "POSTPONED"
  | "CANCELLED"
  | "SUCCESSFUL";

export interface LaunchPeriodEntry {
  id: string;
  missionId: string;
  date: string;
  windowOpen: string;
  windowClose: string;
  isTargeted: boolean;
  consumed: boolean;
}

export type MilestoneStatus = "UPCOMING" | "IN_PROGRESS" | "COMPLETE" | "HELD";

export interface MissionMilestone {
  id: string;
  phase?: "PRE_OPERATION_SETUP" | "COUNTDOWN" | null;
  label: string;
  responsibleStation?: string | null;
  tMinusSeconds: number;
  status: MilestoneStatus;
  actualTime?: string | null;
  sortOrder: number;
}

export type GoNoGoStatus = "UNPOLLED" | "GO" | "NO_GO" | "HOLD";

export interface GoNoGoPoll {
  id: string;
  missionId: string;
  stationName: string;
  status: GoNoGoStatus;
  notes?: string | null;
  updatedAt: string;
  updatedById?: string | null;
}

export interface MissionLogEntry {
  id: string;
  text: string;
  timestamp: string;
  author: { id: string; name: string };
}

export type MissionHistoryEventType =
  | "TARGETED"
  | "POSTPONED"
  | "CANCELLED"
  | "SCRUBBED"
  | "SUCCESSFUL"
  | "LOT_SUBMITTED"
  | "LOT_REVISED"
  | "HOLD_CALLED"
  | "HOLD_RELEASED"
  | "RECYCLED"
  | "LIFTOFF_MARKED"
  | "NOTE";

export interface MissionHistoryEvent {
  id: string;
  eventType: MissionHistoryEventType;
  timestamp: string;
  notes?: string | null;
  actor?: { id: string; name: string } | null;
  metadata?: Record<string, unknown> | null;
}

export interface DispositionAddendum {
  id: string;
  timestamp: string;
  text: string;
  author: { id: string; name: string };
}

export interface MissionDisposition {
  outcome: string;
  actualLiftoffTime?: string | null;
  flightDurationSeconds?: number | null;
  apogeeAltitudeAglMeters?: number | null;
  apogeeAltitudeMslMeters?: number | null;
  maxVelocityMs?: number | null;
  maxAccelerationG?: number | null;
  actualTotalImpulseNs?: number | null;
  recoveryStatus?: string | null;
  recoveryLocationLat?: number | null;
  recoveryLocationLon?: number | null;
  payloadOutcome?: string | null;
  anomalySummary?: string | null;
  anomalyReferenceNote?: string | null;
  vehiclePerformanceNotes?: string | null;
  missionNotes?: string | null;
  addenda?: DispositionAddendum[];
}

export const DISPOSITION_OUTCOMES = ["Successful", "Partial Success", "Failure", "Anomaly"];

export type NotificationType = "T_MINUS_60" | "T_MINUS_15" | "TERMINATION";

export interface LaunchDayNotification {
  id: string;
  notificationType: NotificationType;
  satisfied: boolean;
  notApplicable: boolean;
  contactedFacility?: string | null;
  contactedBy?: { id: string; name: string } | null;
  timestamp?: string | null;
  notes?: string | null;
}

export interface NotamFiling {
  id: string;
  filedDate?: string | null;
  leidosConfirmationNumber?: string | null;
  notamWindowOpen?: string | null;
  notamWindowClose?: string | null;
  notes?: string | null;
}

// --- Countdown (Section 6.2) ---

export type TCountStatus = "PENDING" | "COUNTING" | "HOLDING" | "STOPPED" | "COMPLETE";
export type HoldType = "PROGRAMMED" | "UNSCHEDULED";
export type HoldStatus = "SCHEDULED" | "ACTIVE" | "DURATION_ELAPSED" | "RELEASED";

export interface MissionHold {
  id: string;
  type: HoldType;
  holdMarkSeconds: number;
  estimatedDurationSeconds?: number | null;
  status: HoldStatus;
  autoProceed: boolean;
  // v5.0 Section 7.4 - true only for the system-triggered hold raised when
  // a LOT Certification's 24-hour CoFR compliance deadline lapses.
  isCofrComplianceHold?: boolean;
  reason?: string | null;
  actualStartedAt?: string | null;
  actualEndedAt?: string | null;
  actualDurationSeconds?: number | null;
  enteredBy?: { id: string; name: string } | null;
}

// v5.0 Section 7.4 - permanent record produced by a LOT Submission.
export interface LotCertification {
  id: string;
  missionId: string;
  comrDocumentId: string;
  comrDocument: { id: string; title: string; category: string };
  certifications: { no: number; text: string }[];
  signatureName: string;
  signatureRole: string;
  signedAt: string;
  signedBy: { id: string; name: string };
  cofrBasis: "APPROVED_ON_FILE" | "WILL_FILE_WITHIN_24H";
  cofrComplianceDeadline?: string | null;
  cofrGateLapsedAt?: string | null;
  cofrGateResolvedAt?: string | null;
  cofrGateResolvedBy?: { id: string; name: string } | null;
}

export interface CountdownState {
  lot?: string | null;
  lotSubmittedAt?: string | null;
  tCountStatus: TCountStatus;
  holdOffsetSeconds: number;
  liftoffActualTime?: string | null;
  currentTMinusSeconds: number | null;
  projectedLiftoff: string | null;
  activeHold: MissionHold | null;
  holds: MissionHold[];
}

export interface Mission {
  id: string;
  name: string;
  designator: string;
  status: MissionStatus;
  payloadDescription?: string | null;
  vehicle: Vehicle;
  site: Site;
  vehicleId: string;
  siteId: string;
  launchPeriodEntries: LaunchPeriodEntry[];
  historyEvents?: MissionHistoryEvent[];
  disposition?: MissionDisposition | null;
  milestones?: MissionMilestone[];
  goNoGoPolls?: GoNoGoPoll[];
  logEntries?: MissionLogEntry[];
  notamFilings?: NotamFiling[];
  launchDayNotifications?: LaunchDayNotification[];
  assignedUsers?: { user: { id: string; name: string; role: Role }; role?: string | null }[];
  holds?: MissionHold[];
  lot?: string | null;
  lotSubmittedAt?: string | null;
  tCountStatus?: TCountStatus;
  holdOffsetSeconds?: number;
  liftoffActualTime?: string | null;
  appliedMilestoneTemplateName?: string | null;
  updatedAt?: string;
}

export interface MilestoneTemplateOption {
  id: string;
  name: string;
  itemCount: number;
}

export interface MilestoneTemplateOptions {
  appliedTemplateName: string | null;
  options: MilestoneTemplateOption[];
}

export interface Coa {
  id: string;
  siteId: string;
  coaNumber: string;
  issuedTo: string;
  issuingFacility: string;
  authorizedOperationRadiusNm: number;
  fixRadialDistance: string;
  effectiveDate: string;
  expirationDate: string;
  dailyWindowOpen: string;
  dailyWindowClose: string;
  authorizedActivity: string;
  altitudeLimits: string;
  // v6.1 Item 6 - structured ceiling value (feet); required going forward,
  // nullable in the type only for defensive handling of any legacy record.
  altitudeLimitFt: number | null;
  conditions: string;
  status: CoaComputedStatus;
  site?: { id: string; name: string; designator: string; lat?: number; lon?: number };
}

// --- LWCC (Section 7) ---

export type LwccRowStatus = "NO_VIOLATION" | "VIOLATION" | "HOLD_ACTIVE" | "OVERRIDDEN" | "NOT_REPORTED";
export type LwccRiskLevel = "NONE" | "LOW" | "MODERATE" | "HIGH" | "ACTIVE" | "MANUAL" | "INSUFFICIENT_DATA";

export interface LwccRow {
  no: number;
  description: string;
  limitText: string;
  mode: "LIVE" | "MANUAL";
  status: LwccRowStatus;
  currentValue: number | null;
  valueAt15Min: number | null;
  risk15: LwccRiskLevel;
  risk30: LwccRiskLevel;
  holdExpiresAt: string | null;
  holdDurationSeconds: number | null;
  lastReport: { id: string; timestamp: string; reportedBy: { id: string; name: string }; data: Record<string, unknown>; notes?: string | null } | null;
  override: { justification: string; by: { id: string; name: string }; timestamp: string } | null;
}

export interface LwccLogEntry {
  id: string;
  eventType: string;
  requirementNo?: number | null;
  actor?: { id: string; name: string } | null;
  timestamp: string;
  details?: Record<string, unknown> | null;
}

export interface LwccState {
  bannerStatus: "NO_VIOLATION" | "VIOLATION";
  violatingRows: { no: number; description: string; currentValue: number | null; holdExpiresAt: string | null }[];
  notReportedCount: number;
  rows: LwccRow[];
  log: LwccLogEntry[];
}

export type DocumentStatus = "DRAFT" | "IN_REVIEW" | "APPROVED" | "ARCHIVED";

export interface DocumentVersion {
  id: string;
  version: number;
  fileName: string;
  mimeType: string;
  fileSizeBytes: number;
  uploadedAt: string;
  uploadedBy: { id: string; name: string };
  notes?: string | null;
}

export interface DocumentAuditEntry {
  id: string;
  action: string;
  timestamp: string;
  user: { id: string; name: string };
  metadata?: Record<string, unknown> | null;
}

export interface DocumentRecord {
  id: string;
  title: string;
  category: string;
  status: DocumentStatus;
  currentVersion: number;
  tags: string[];
  uploadedBy: { id: string; name: string };
  uploadedAt: string;
  updatedAt: string;
  site?: { id: string; name: string; designator: string } | null;
  mission?: { id: string; name: string; designator: string } | null;
  vehicle?: { id: string; name: string; designator?: string | null } | null;
  versions?: DocumentVersion[];
  auditLog?: DocumentAuditEntry[];
}

// Revision Directive v4.1 Section 8.2 - the "[PC]" (Portal Connected)
// suffix marks a category that, once selected, cross-links the document
// elsewhere in the app beyond the Documentation Library itself. This is a
// standing convention for this category system going forward, not a
// one-time naming choice limited to these two entries - exported as
// constants so any future portal-connected category (and the code that
// looks it up) stays in sync with its exact label here.
export const LANDOWNER_AUTHORIZATION_CATEGORY = "Landowner Authorization [PC]";
export const COA_DOCUMENT_CATEGORY = "Cert. of Waiver or Authorization [PC]";
export const COMR_DOCUMENT_CATEGORY = "Certification of Mission Readiness (CoMR)";
export const COFR_DOCUMENT_CATEGORY = "Certification of Flight Readiness (CoFR)";

// v5.0 Section 7.4 - LOT Submission certification statements, quoted
// verbatim from Revision Directive v5.0 Section 6 (modeled on IRM2-MOP-001A
// Section 5). Must match server/src/services/lotCertification.ts exactly -
// the server is the source of truth and stores its own copy of this text
// regardless of what the client sends, but the form must present the same
// wording the record will show.
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

// Full replacement per v4.1 Section 8.1, superseding the category list
// established across v2.0/v3.0/v3.1: Range Safety Package, FTS
// Documentation, LRR/FRR packages, Environmental/Permitting, Weather
// Waiver Request, Post-Flight/Anomaly Report, SOP, and Checklist are
// consolidated into this shorter list. Any document previously tagged
// with one of those removed categories is re-mapped to "Other" by
// server/scripts/remapDocumentCategories.ts - see README for details.
// v6.0 Section 6.5 - "Trajectory Simulation Report" added, no [PC] marker
// (this category does not need to surface elsewhere in the portal beyond
// the Documentation Library itself).
export const TRAJECTORY_SIMULATION_REPORT_CATEGORY = "Trajectory Simulation Report";

export const DOCUMENT_CATEGORIES = [
  "Mission Operations Plan (MOP)",
  "Certification of Mission Readiness (CoMR)",
  "Certification of Flight Readiness (CoFR)",
  LANDOWNER_AUTHORIZATION_CATEGORY,
  COA_DOCUMENT_CATEGORY,
  "Vehicle Certification & Test Data",
  "Launch Countdown Procedure",
  "Mission Execution Forecast (Weather)",
  TRAJECTORY_SIMULATION_REPORT_CATEGORY,
  "Other",
];

// ---------------------------------------------------------------------------
// v7.0 - Personnel & Stations. "Mission role" (this section) is genuinely
// separate from the website Role type at the top of this file - see
// Section 2/10 of the v7.0 directive and the MissionPersonnelAssignment
// schema comment for the full rationale. Never conflate the two.
// ---------------------------------------------------------------------------

export type MissionRole = "LD" | "RC" | "LWO" | "VSE" | "OPS_SUPPORT";
export type QualificationRole = "RC" | "LWO" | "VSE";

export interface PersonnelListEntry {
  id: string;
  name: string;
  websiteRole: Role;
  isOnline: boolean;
  qualifications: { role: QualificationRole; expiresAt: string | null; active: boolean }[];
}

export interface MissionPersonnelAssignmentRecord {
  id: string;
  missionId: string;
  role: MissionRole;
  userId: string;
  userName: string;
  assignedAt: string;
  assignedById: string;
  assignedByName: string;
  attestationSignatureName: string | null;
  attestationSignatureRole: string | null;
  attestationSignedAt: string | null;
  onStationAt: string | null;
  offStationOverride: boolean;
  offStationOverrideReason: string | null;
  offStationOverrideById: string | null;
  offStationOverrideByName: string | null;
  offStationOverrideAt: string | null;
}

export interface MissionPersonnelState {
  assignments: MissionPersonnelAssignmentRecord[];
  missingRoles: MissionRole[];
}

export interface MissionPersonnelAuditEntry {
  id: string;
  role: MissionRole;
  action: string;
  previousUserName: string | null;
  newUserName: string | null;
  notes: string | null;
  actorName: string;
  timestamp: string;
}

export interface MyStationState {
  state: "NO_ASSIGNMENT" | "REPORT_TO_STATION" | "ON_STATION";
  assignmentId?: string;
  missionId?: string;
  missionDesignator?: string;
  missionRole?: MissionRole;
  onStationAt?: string | null;
}

// Section 4.2 - verbatim confirmation/attestation text for LD assignment.
// Kept as an exported constant so the exact wording lives in exactly one
// place, matching the v5.0 LOT_CERTIFICATION_TEXTS convention.
export const LD_ASSIGNMENT_ATTESTATION_TEXT =
  "I certify that I possess the requisite authority under the American Aerospace Technologies Corp Launch Operations Division organizational structure to make this assignment, and that this assignment is accurate to the best of my knowledge. This assignment shall remain in effect until modified or superseded through this same process.";

// Section 8.1 - verbatim off-station override attestation text template.
export function offStationOverrideAttestationText(role: string, assignedName: string, missionDesignator: string): string {
  return `I certify that ${role} — ${assignedName} — is authorized to be off-station for ${missionDesignator} notwithstanding the operational requirement that this role be staffed, and that I possess the requisite authority to make this determination.`;
}
