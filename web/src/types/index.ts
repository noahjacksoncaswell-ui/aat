export type Role = "ADMIN" | "LAUNCH_DIRECTOR" | "OPERATOR" | "VIEWER";
export type UserStatus = "ACTIVE" | "INACTIVE";

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
  reason?: string | null;
  actualStartedAt?: string | null;
  actualEndedAt?: string | null;
  actualDurationSeconds?: number | null;
  enteredBy?: { id: string; name: string } | null;
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
  issuingFacility: string;
  effectiveDate: string;
  expirationDate: string;
  authorizedActivity?: string | null;
  altitudeLimits?: string | null;
  conditions?: string | null;
  status: CoaComputedStatus;
  site?: { id: string; name: string; designator: string };
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

export const DOCUMENT_CATEGORIES = [
  "Mission Operations Plan (MOP)",
  "Range Safety Package",
  "Flight Termination System (FTS) Documentation",
  "Launch/Flight Readiness Review (LRR/FRR)",
  "Environmental/Permitting",
  "Landowner Authorization",
  "Vehicle Certification & Test Data",
  "FAA Correspondence / COA / NOTAM",
  "Weather Waiver Request",
  "Post-Flight/Anomaly Report",
  "Standard Operating Procedure (SOP)",
  "Checklist",
  "Launch Countdown Procedure (LCP)",
  "Other",
];
