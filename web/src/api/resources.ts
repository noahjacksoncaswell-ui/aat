import { api } from "./client";
import type {
  Coa,
  CountdownState,
  DocumentRecord,
  DocumentStatus,
  LaunchStatusCheckState,
  LwccState,
  Mission,
  AviationBriefResponse,
  MetocMefResponse,
  MetocOutlookResponse,
  MetocMonthFavorability,
  MetocPovTrendPoint,
  MilestoneTemplate,
  MilestoneTemplateOptions,
  MissionPersonnelAssignmentRecord,
  MissionPersonnelAuditEntry,
  MissionPersonnelState,
  MissionRole,
  MyStationState,
  PersonnelListEntry,
  PollAuditEntry,
  QualificationRole,
  Site,
  UserRecord,
  Vehicle,
  WeatherSnapshot,
  UnifiedLogResponse,
  CommsActionsResponse,
  CommsRecipient,
  FormalCommsMessage,
} from "../types";

// Dashboard
export const fetchDashboard = () => api.get("/dashboard").then((r) => r.data);

// Sites
export const fetchSites = () => api.get<Site[]>("/sites").then((r) => r.data);
export const fetchSite = (id: string) => api.get<Site>(`/sites/${id}`).then((r) => r.data);
export const fetchSiteWeather = (id: string, refresh = false) =>
  api.get<WeatherSnapshot>(`/sites/${id}/weather${refresh ? "?refresh=true" : ""}`).then((r) => r.data);
export const createSite = (data: Partial<Site>) => api.post("/sites", data).then((r) => r.data);
export const updateSite = (id: string, data: Partial<Site>) => api.patch(`/sites/${id}`, data).then((r) => r.data);
export const updateSiteFacilityContacts = (id: string, data: Partial<Site>) =>
  api.patch(`/sites/${id}/facility-contacts`, data).then((r) => r.data);
// v6.0 Section 9 - a genuine hard delete, blocked server-side if an
// active COA or any mission is still on file for the site.
export const deleteSite = (id: string) => api.delete(`/sites/${id}`);
export const addSitePhoto = (id: string, url: string, caption?: string) =>
  api.post(`/sites/${id}/photos`, { url, caption }).then((r) => r.data);

// Vehicles
export const fetchVehicles = () => api.get<Vehicle[]>("/vehicles").then((r) => r.data);
export const fetchVehicle = (id: string) => api.get<Vehicle>(`/vehicles/${id}`).then((r) => r.data);
export const createVehicle = (data: Partial<Vehicle>) => api.post("/vehicles", data).then((r) => r.data);
export const updateVehicle = (id: string, data: Partial<Vehicle>) => api.patch(`/vehicles/${id}`, data).then((r) => r.data);
export const deleteVehicle = (id: string) => api.delete(`/vehicles/${id}`);
export const createMilestoneTemplate = (vehicleId: string, data: Partial<MilestoneTemplate>) =>
  api.post(`/vehicles/${vehicleId}/templates`, data).then((r) => r.data);
export const deleteMilestoneTemplate = (vehicleId: string, templateId: string) =>
  api.delete(`/vehicles/${vehicleId}/templates/${templateId}`);

// Missions
export interface MissionFilters {
  site?: string;
  status?: string;
  vehicleId?: string;
  search?: string;
}
export const fetchMissions = (filters: MissionFilters = {}) =>
  api.get<Mission[]>("/missions", { params: filters }).then((r) => r.data);
export const fetchMission = (id: string) => api.get<Mission>(`/missions/${id}`).then((r) => r.data);
export const createMission = (data: any) => api.post("/missions", data).then((r) => r.data);
export const addLaunchPeriodEntry = (missionId: string, data: { date: string; windowOpen: string; windowClose: string }) =>
  api.post(`/missions/${missionId}/launch-period`, data).then((r) => r.data);
export const removeLaunchPeriodEntry = (missionId: string, entryId: string) =>
  api.delete(`/missions/${missionId}/launch-period/${entryId}`);

export const targetLaunchOpportunity = (missionId: string, launchPeriodEntryId: string) =>
  api.post(`/missions/${missionId}/actions/target`, { launchPeriodEntryId });
export const postponeMission = (missionId: string, notes: string) =>
  api.post(`/missions/${missionId}/actions/postpone`, { notes });
export const cancelMission = (missionId: string, notes: string, confirmDesignator: string) =>
  api.post(`/missions/${missionId}/actions/cancel`, { notes, confirmDesignator });
export const removeMission = (missionId: string, confirmDesignator: string) =>
  api.delete(`/missions/${missionId}/actions/remove`, { data: { confirmDesignator, attested: true } });
export const scrubMission = (missionId: string, notes: string) =>
  api.post(`/missions/${missionId}/actions/scrub`, { notes }).then((r) => r.data);
export const logDisposition = (missionId: string, data: Record<string, unknown>) =>
  api.post(`/missions/${missionId}/actions/disposition`, data);
export const addDispositionAddendum = (missionId: string, text: string) =>
  api.post(`/missions/${missionId}/disposition/addenda`, { text }).then((r) => r.data);

export const updateMilestone = (missionId: string, milestoneId: string, data: Record<string, unknown>) =>
  api.patch(`/missions/${missionId}/milestones/${milestoneId}`, data).then((r) => r.data);
export const addMilestone = (missionId: string, data: Record<string, unknown>) =>
  api.post(`/missions/${missionId}/milestones`, data).then((r) => r.data);

export const updateGoNoGo = (missionId: string, pollId: string, data: { status: string; notes?: string }) =>
  api.patch(`/missions/${missionId}/gonogo/${pollId}`, data).then((r) => r.data);

export const addLogEntry = (missionId: string, text: string) =>
  api.post(`/missions/${missionId}/log`, { text }).then((r) => r.data);

export const setMissionPersonnel = (missionId: string, assignments: { userId: string; role?: string }[]) =>
  api.put(`/missions/${missionId}/personnel`, { assignments });

// Countdown (Section 6.2)
export const fetchCountdownState = (missionId: string) => api.get<CountdownState>(`/missions/${missionId}/countdown/state`).then((r) => r.data);
export const submitLot = (missionId: string, data: Record<string, unknown>) =>
  api.post(`/missions/${missionId}/countdown/lot`, data);
export const reviseLot = (missionId: string, lot: string, reason: string) =>
  api.patch(`/missions/${missionId}/countdown/lot`, { lot, reason });
export const addProgrammedHold = (
  missionId: string,
  data: { holdMarkSeconds: number; estimatedDurationSeconds: number; reason?: string; pemsgMessageId?: string }
) => api.post(`/missions/${missionId}/countdown/holds`, data).then((r) => r.data);
export const removeHold = (missionId: string, holdId: string) => api.delete(`/missions/${missionId}/countdown/holds/${holdId}`);
export const callHold = (missionId: string, reason: string, pemsgMessageId?: string) =>
  api.post(`/missions/${missionId}/countdown/holds/call`, { reason, pemsgMessageId }).then((r) => r.data);
// v9.6 Section 2 - WAIVE
export const waivePemsgHold = (missionId: string, messageId: string) =>
  api.post(`/missions/${missionId}/countdown/pemsg/${messageId}/waive`);
export const releaseHold = (missionId: string, holdId: string) =>
  api.post(`/missions/${missionId}/countdown/holds/${holdId}/release`);
export const setHoldAutoProceed = (missionId: string, holdId: string, autoProceed: boolean) =>
  api.patch(`/missions/${missionId}/countdown/holds/${holdId}/auto-proceed`, { autoProceed }).then((r) => r.data);
export const pauseCountdown = (missionId: string, reason: string) =>
  api.post(`/missions/${missionId}/countdown/pause`, { reason }).then((r) => r.data);
export const recycleCountdown = (missionId: string, toMarkSeconds: number, reason: string) =>
  api.post(`/missions/${missionId}/countdown/recycle`, { toMarkSeconds, reason });
export const markLiftoff = (missionId: string, timestamp?: string) =>
  api.post(`/missions/${missionId}/countdown/liftoff`, { timestamp });
export const fetchLotCertification = (missionId: string) =>
  api.get<import("../types").LotCertification | null>(`/missions/${missionId}/countdown/lot/certification`).then((r) => r.data);
export const confirmCofrGate = (missionId: string) => api.post(`/missions/${missionId}/countdown/cofr-gate/confirm`);
// v9.3 Section 3.3.3 - CCS Terminal Count Arm
export const armTerminalCount = (missionId: string) => api.post(`/missions/${missionId}/countdown/terminal-count/arm`);
export const revokeTerminalCountArm = (missionId: string) => api.post(`/missions/${missionId}/countdown/terminal-count/revoke`);
export const xmitCcsToVfs = (missionId: string) => api.post(`/missions/${missionId}/countdown/terminal-count/xmit`);
export const fetchMilestoneTemplateOptions = (missionId: string) =>
  api.get<MilestoneTemplateOptions>(`/missions/${missionId}/countdown/milestones/templates`).then((r) => r.data);
export const generateMilestoneSequence = (missionId: string, templateId?: string) =>
  api.post(`/missions/${missionId}/countdown/milestones/generate`, { templateId }).then((r) => r.data);
export const resetMilestoneSequence = (missionId: string) =>
  api.post(`/missions/${missionId}/countdown/milestones/reset`);

// LWCC (Section 7)
export const fetchLwccState = (missionId: string) => api.get<LwccState>(`/missions/${missionId}/lwcc`).then((r) => r.data);
export const submitLwccReport = (missionId: string, data: { requirementNo: number; violation: boolean; data?: Record<string, unknown>; notes?: string }) =>
  api.post(`/missions/${missionId}/lwcc/reports`, data).then((r) => r.data);
export const overrideLwcc = (missionId: string, requirementNo: number, justification: string) =>
  api.post(`/missions/${missionId}/lwcc/overrides`, { requirementNo, justification }).then((r) => r.data);
export const clearLwccOverride = (missionId: string, requirementNo: number) =>
  api.delete(`/missions/${missionId}/lwcc/overrides/${requirementNo}`);
export const clearLwccLog = (missionId: string) => api.post(`/missions/${missionId}/lwcc/log/clear`);

// NOTAM
export const fetchNotamStatus = (missionId: string) => api.get(`/missions/${missionId}/notam`).then((r) => r.data);
export const fileNotam = (
  missionId: string,
  data: { filedDate: string; leidosConfirmationNumber?: string; notamWindowOpen: string; notamWindowClose: string; notes?: string }
) => api.post(`/missions/${missionId}/notam`, data).then((r) => r.data);

// Launch day notifications
export const fetchLaunchDayNotifications = (missionId: string) =>
  api.get(`/missions/${missionId}/notifications`).then((r) => r.data);
export const updateLaunchDayNotification = (
  missionId: string,
  notificationType: string,
  data: { satisfied?: boolean; notApplicable?: boolean; contactedFacility?: string; notes?: string }
) => api.patch(`/missions/${missionId}/notifications/${notificationType}`, data).then((r) => r.data);

// COA
export const fetchCoas = (siteId?: string) => api.get<Coa[]>("/coa", { params: siteId ? { siteId } : {} }).then((r) => r.data);
export const createCoa = (data: Partial<Coa>) => api.post("/coa", data).then((r) => r.data);
export const updateCoa = (id: string, data: Partial<Coa>) => api.patch(`/coa/${id}`, data).then((r) => r.data);
export const deleteCoa = (id: string) => api.delete(`/coa/${id}`);

// FAA summary
export const fetchFaaSummary = () => api.get("/faa/summary").then((r) => r.data);

// Documents
export interface DocumentFilters {
  siteId?: string;
  missionId?: string;
  category?: string;
  status?: DocumentStatus;
  q?: string;
}
export const fetchDocuments = (filters: DocumentFilters = {}) =>
  api.get<DocumentRecord[]>("/documents", { params: filters }).then((r) => r.data);
export const fetchDocument = (id: string) => api.get<DocumentRecord>(`/documents/${id}`).then((r) => r.data);
export const uploadDocument = (formData: FormData) =>
  api.post("/documents", formData, { headers: { "Content-Type": "multipart/form-data" } }).then((r) => r.data);
export const uploadDocumentVersion = (id: string, formData: FormData) =>
  api.post(`/documents/${id}/versions`, formData, { headers: { "Content-Type": "multipart/form-data" } }).then((r) => r.data);
export const updateDocumentMeta = (id: string, data: Record<string, unknown>) =>
  api.patch(`/documents/${id}`, data).then((r) => r.data);
export const deleteDocument = (id: string) => api.delete(`/documents/${id}`);

// METOC Outlook (v8.0/v8.1)
export interface MetocLocationParams {
  siteId?: string;
  lat?: number;
  lon?: number;
}
function metocParams(loc: MetocLocationParams) {
  return loc.siteId ? { siteId: loc.siteId } : { lat: loc.lat, lon: loc.lon };
}
export const fetchMetocOutlook = (loc: MetocLocationParams) =>
  api.get<MetocOutlookResponse>("/metoc/outlook", { params: metocParams(loc) }).then((r) => r.data);
export const fetchMetocPovTrend = (loc: MetocLocationParams, date: string) =>
  api.get<MetocPovTrendPoint[]>("/metoc/pov-trend", { params: { ...metocParams(loc), date } }).then((r) => r.data);
export const fetchMetocFavorability = (loc: MetocLocationParams) =>
  api.get<MetocMonthFavorability[]>("/metoc/favorability", { params: metocParams(loc) }).then((r) => r.data);
export const fetchMetocAviationBrief = (loc: MetocLocationParams) =>
  api.get<AviationBriefResponse>("/metoc/aviation-brief", { params: metocParams(loc) }).then((r) => r.data);
export const generateMetocMef = (body: {
  siteId?: string;
  lat?: number;
  lon?: number;
  mode: "range" | "mission";
  startDate?: string;
  endDate?: string;
  missionId?: string;
}) => api.post<MetocMefResponse>("/metoc/mef/generate", body).then((r) => r.data);

// Users / Admin
export const fetchUsers = () => api.get<UserRecord[]>("/users").then((r) => r.data);
export const createUser = (data: Record<string, unknown>) => api.post("/users", data).then((r) => r.data);
export const updateUser = (id: string, data: Record<string, unknown>) => api.patch(`/users/${id}`, data).then((r) => r.data);
export const deactivateUser = (id: string) => api.delete(`/users/${id}`);
export const fetchActivityLog = (params: Record<string, string | number | undefined> = {}) =>
  api.get("/admin/activity-log", { params }).then((r) => r.data);

// Personnel & Stations (v7.0)
export const fetchPersonnelList = () => api.get<PersonnelListEntry[]>("/personnel").then((r) => r.data);
export const setQualification = (userId: string, role: QualificationRole, expiresAt: string | null) =>
  api.post(`/personnel/${userId}/qualifications`, { role, expiresAt }).then((r) => r.data);
export const removeQualification = (userId: string, role: QualificationRole) =>
  api.delete(`/personnel/${userId}/qualifications/${role}`);
export const fetchMyStation = () => api.get<MyStationState>("/personnel/my-station").then((r) => r.data);

export const fetchMissionPersonnel = (missionId: string) =>
  api.get<MissionPersonnelState>(`/missions/${missionId}/personnel`).then((r) => r.data);
export const fetchMissionPersonnelHistory = (missionId: string) =>
  api.get<MissionPersonnelAuditEntry[]>(`/missions/${missionId}/personnel/history`).then((r) => r.data);
export const assignLd = (missionId: string, data: { userId: string; signatureName: string; signatureRole: string }) =>
  api.post<MissionPersonnelAssignmentRecord>(`/missions/${missionId}/personnel/ld`, data).then((r) => r.data);
export const assignOperator = (missionId: string, data: { userId: string; role: MissionRole }) =>
  api.post<MissionPersonnelAssignmentRecord>(`/missions/${missionId}/personnel/operators`, data).then((r) => r.data);
export const removePersonnelAssignment = (missionId: string, assignmentId: string) =>
  api.delete(`/missions/${missionId}/personnel/${assignmentId}`);
export const toggleOnStation = (missionId: string, assignmentId: string, onStation: boolean) =>
  api.post<MissionPersonnelAssignmentRecord>(`/missions/${missionId}/personnel/${assignmentId}/station`, { onStation }).then((r) => r.data);

// v9.0 Section 3 - Unified Mission Command Log
export const fetchMissionHistoryLog = (missionId: string) =>
  api.get<UnifiedLogResponse>(`/missions/${missionId}/history-log`).then((r) => r.data);

// v9.0 Section 4.4 - Formal Role Communications
export const fetchMissionComms = (missionId: string) => api.get<FormalCommsMessage[]>(`/missions/${missionId}/comms`).then((r) => r.data);
export const fetchMissionCommsActions = (missionId: string) =>
  api.get<CommsActionsResponse>(`/missions/${missionId}/comms/actions`).then((r) => r.data);
export const sendMissionComms = (
  missionId: string,
  data: { recipient: CommsRecipient; actionCode: string; fields?: Record<string, unknown>; detail?: string }
) => api.post<FormalCommsMessage>(`/missions/${missionId}/comms`, data).then((r) => r.data);
export const setOffStationOverride = (missionId: string, assignmentId: string, reason: string) =>
  api.post<MissionPersonnelAssignmentRecord>(`/missions/${missionId}/personnel/${assignmentId}/override`, { reason }).then((r) => r.data);
export const clearOffStationOverride = (missionId: string, assignmentId: string) =>
  api.delete(`/missions/${missionId}/personnel/${assignmentId}/override`);

// Launch Status Check (v7.1)
export const fetchLaunchStatusCheck = (missionId: string) =>
  api.get<LaunchStatusCheckState>(`/missions/${missionId}/polls`).then((r) => r.data);
export const fetchPollHistory = (missionId: string) =>
  api.get<PollAuditEntry[]>(`/missions/${missionId}/polls/history`).then((r) => r.data);
export const setPollItem = (missionId: string, itemKey: string, status: string) =>
  api.post(`/missions/${missionId}/polls/${itemKey}`, { status }).then((r) => r.data);
export const clearPollItemOverride = (missionId: string, itemKey: string) =>
  api.delete(`/missions/${missionId}/polls/${itemKey}`);
export const confirmLaunchCountTime = (missionId: string, enteredTimeZulu: string) =>
  api.post(`/missions/${missionId}/polls/launch-count-time`, { enteredTimeZulu }).then((r) => r.data);
