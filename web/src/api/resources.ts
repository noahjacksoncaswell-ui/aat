import { api } from "./client";
import type {
  Coa,
  DocumentRecord,
  DocumentStatus,
  Mission,
  MilestoneTemplate,
  Site,
  UserRecord,
  Vehicle,
  WeatherSnapshot,
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
export const decommissionSite = (id: string) => api.delete(`/sites/${id}`);
export const addSitePhoto = (id: string, url: string, caption?: string) =>
  api.post(`/sites/${id}/photos`, { url, caption }).then((r) => r.data);

// Vehicles
export const fetchVehicles = () => api.get<Vehicle[]>("/vehicles").then((r) => r.data);
export const createVehicle = (data: Partial<Vehicle>) => api.post("/vehicles", data).then((r) => r.data);
export const createMilestoneTemplate = (vehicleId: string, data: Partial<MilestoneTemplate>) =>
  api.post(`/vehicles/${vehicleId}/templates`, data).then((r) => r.data);

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
export const cancelMission = (missionId: string, notes: string) =>
  api.post(`/missions/${missionId}/actions/cancel`, { notes });
export const scrubMission = (missionId: string, notes: string) =>
  api.post(`/missions/${missionId}/actions/scrub`, { notes }).then((r) => r.data);
export const logDisposition = (missionId: string, data: Record<string, unknown>) =>
  api.post(`/missions/${missionId}/actions/disposition`, data);

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

// Users / Admin
export const fetchUsers = () => api.get<UserRecord[]>("/users").then((r) => r.data);
export const createUser = (data: Record<string, unknown>) => api.post("/users", data).then((r) => r.data);
export const updateUser = (id: string, data: Record<string, unknown>) => api.patch(`/users/${id}`, data).then((r) => r.data);
export const deactivateUser = (id: string) => api.delete(`/users/${id}`);
export const fetchActivityLog = (params: Record<string, string | number | undefined> = {}) =>
  api.get("/admin/activity-log", { params }).then((r) => r.data);
