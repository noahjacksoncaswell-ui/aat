// Generalized countdown milestone sequence (Revision Directive v3.0 Section
// 6.2.4). This is the universal structural pattern applicable across AAT
// high-power sounding rocket operations generally, extracted from the
// reference Launch Countdown Procedure's phase/sequence/station/verification
// structure - it intentionally omits vehicle-specific steps (e.g. specific
// charge weights or motor-specific integration procedures), which belong
// with the vehicle's own uploaded LCP (Section 6.2.6) instead.

export interface CountdownSequenceItem {
  phase: "PRE_OPERATION_SETUP" | "COUNTDOWN";
  label: string;
  responsibleStation: string;
  tMinusSeconds: number;
  sortOrder: number;
}

export const COUNTDOWN_MILESTONE_SEQUENCE: CountdownSequenceItem[] = [
  // Pre-operation setup phase (nominally T-1:45:00 to T-0:45:00)
  { phase: "PRE_OPERATION_SETUP", label: "Pad setup", responsibleStation: "Pad", tMinusSeconds: 6300, sortOrder: 0 },
  { phase: "PRE_OPERATION_SETUP", label: "Launch control system setup", responsibleStation: "Ground Systems/LCS", tMinusSeconds: 5400, sortOrder: 1 },
  { phase: "PRE_OPERATION_SETUP", label: "Ground control station setup", responsibleStation: "Ops Support", tMinusSeconds: 4500, sortOrder: 2 },
  { phase: "PRE_OPERATION_SETUP", label: "Telemetry ground systems setup", responsibleStation: "Telemetry", tMinusSeconds: 3600, sortOrder: 3 },
  { phase: "PRE_OPERATION_SETUP", label: "Recovery/chute systems setup", responsibleStation: "Recovery", tMinusSeconds: 3000, sortOrder: 4 },
  { phase: "PRE_OPERATION_SETUP", label: "Countdown clock setup", responsibleStation: "Launch Director", tMinusSeconds: 2700, sortOrder: 5 },

  // Countdown phase (T-0:45:00 to T-0:00:00)
  { phase: "COUNTDOWN", label: "Call to stations", responsibleStation: "Launch Director", tMinusSeconds: 2400, sortOrder: 6 },
  { phase: "COUNTDOWN", label: "Pre-operation verification", responsibleStation: "All Stations", tMinusSeconds: 2100, sortOrder: 7 },
  { phase: "COUNTDOWN", label: "LOT verification", responsibleStation: "Launch Director", tMinusSeconds: 1920, sortOrder: 8 },
  { phase: "COUNTDOWN", label: "T-COUNT initialization", responsibleStation: "Launch Director", tMinusSeconds: 1800, sortOrder: 9 },
  { phase: "COUNTDOWN", label: "TRACON/ARTCC notification (operating window open)", responsibleStation: "Communications", tMinusSeconds: 1680, sortOrder: 10 },
  { phase: "COUNTDOWN", label: "Vehicle/motor integration", responsibleStation: "Propulsion", tMinusSeconds: 1500, sortOrder: 11 },
  { phase: "COUNTDOWN", label: "Vehicle launch configuration", responsibleStation: "Pad", tMinusSeconds: 1200, sortOrder: 12 },
  { phase: "COUNTDOWN", label: "LWCC verification", responsibleStation: "Weather/LWCC", tMinusSeconds: 1020, sortOrder: 13 },
  { phase: "COUNTDOWN", label: "Launch area clear verification", responsibleStation: "Range", tMinusSeconds: 900, sortOrder: 14 },
  { phase: "COUNTDOWN", label: "Igniter installation and connection", responsibleStation: "Propulsion", tMinusSeconds: 720, sortOrder: 15 },
  { phase: "COUNTDOWN", label: "Final pad inspection", responsibleStation: "Pad", tMinusSeconds: 600, sortOrder: 16 },
  { phase: "COUNTDOWN", label: "Launch control system power-on and arming", responsibleStation: "Ground Systems/LCS", tMinusSeconds: 480, sortOrder: 17 },
  { phase: "COUNTDOWN", label: "Telemetry verification", responsibleStation: "Telemetry", tMinusSeconds: 360, sortOrder: 18 },
  { phase: "COUNTDOWN", label: "Launch Status Check", responsibleStation: "Launch Director", tMinusSeconds: 300, sortOrder: 19 },
  { phase: "COUNTDOWN", label: "Terminal count arming", responsibleStation: "Ground Systems/LCS", tMinusSeconds: 180, sortOrder: 20 },
  { phase: "COUNTDOWN", label: "Range/airspace clear verification", responsibleStation: "Range", tMinusSeconds: 120, sortOrder: 21 },
  { phase: "COUNTDOWN", label: "Final status check", responsibleStation: "Launch Director", tMinusSeconds: 60, sortOrder: 22 },
  { phase: "COUNTDOWN", label: "Terminal count", responsibleStation: "Launch Director", tMinusSeconds: 10, sortOrder: 23 },
  { phase: "COUNTDOWN", label: "Ignition/liftoff", responsibleStation: "Propulsion", tMinusSeconds: 0, sortOrder: 24 },
];
