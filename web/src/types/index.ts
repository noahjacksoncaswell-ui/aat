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

export interface Site {
  id: string;
  name: string;
  designator: string;
  lat: number;
  lon: number;
  elevationMeters?: number | null;
  status: SiteStatus;
  type: SiteType;
  ownershipNotes?: string | null;
  jurisdictionNotes?: string | null;
  nearestPopulationCenters?: string | null;
  nearestWaterBodies?: string | null;
  terrainType?: string | null;
  countryCode: string;
  coaStatus?: CoaComputedStatus;
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

export interface Vehicle {
  id: string;
  name: string;
  type?: string | null;
  windMaxKts?: number | null;
  ceilingMinFt?: number | null;
  lightningRadiusMi?: number | null;
  maxPrecipProbability?: number | null;
  notes?: string | null;
  templates?: MilestoneTemplate[];
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
  label: string;
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

export type MissionHistoryEventType = "TARGETED" | "POSTPONED" | "CANCELLED" | "SCRUBBED" | "SUCCESSFUL" | "NOTE";

export interface MissionHistoryEvent {
  id: string;
  eventType: MissionHistoryEventType;
  timestamp: string;
  notes?: string | null;
  actor?: { id: string; name: string } | null;
  metadata?: Record<string, unknown> | null;
}

export interface MissionDisposition {
  outcome: string;
  actualLiftoffTime?: string | null;
  apogeeAltitudeMeters?: number | null;
  flightDurationSeconds?: number | null;
  vehiclePerformanceNotes?: string | null;
  payloadOutcome?: string | null;
  recoveryStatus?: string | null;
  anomaliesNotes?: string | null;
}

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
  updatedAt?: string;
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
  versions?: DocumentVersion[];
  auditLog?: DocumentAuditEntry[];
}

export const DOCUMENT_CATEGORIES = [
  "Mission Operations Plan (MOP)",
  "Range Safety Package",
  "Flight Termination System (FTS) Documentation",
  "Launch/Flight Readiness Review (LRR/FRR)",
  "Environmental/Permitting",
  "Vehicle Certification & Test Data",
  "FAA Correspondence / COA / NOTAM",
  "Weather Waiver Request",
  "Post-Flight/Anomaly Report",
  "Standard Operating Procedure (SOP)",
  "Checklist",
  "Other",
];
