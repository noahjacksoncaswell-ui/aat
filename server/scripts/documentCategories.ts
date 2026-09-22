// Kept in sync with DOCUMENT_CATEGORIES in web/src/types/index.ts. Server
// and web are separate TypeScript projects with no shared package, so this
// is duplicated rather than imported; the category names are also
// duplicated as literal strings in server/src/routes/sites.ts for the same
// reason (Landowner Authorization's "[PC]" badge lookup).
export const DOCUMENT_CATEGORIES = [
  "Mission Operations Plan (MOP)",
  "Certification of Mission Readiness (CoMR)",
  "Certification of Flight Readiness (CoFR)",
  "Landowner Authorization [PC]",
  "Cert. of Waiver or Authorization [PC]",
  "Vehicle Certification & Test Data",
  "Launch Countdown Procedure",
  "Mission Execution Forecast (Weather)",
  "Other",
];
