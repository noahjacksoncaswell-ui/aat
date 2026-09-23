import type { EventName, FlightPhase } from "./types";

export const PHASE_LABELS: Record<FlightPhase, string> = {
  POWERED_ASCENT: "Powered Ascent",
  UNPOWERED_ASCENT: "Unpowered Ascent",
  DESCENT_DROGUE: "Descent — Drogue",
  DESCENT_GUIDED: "Descent — Guided",
  DESCENT_MAIN: "Descent — Main",
  DESCENT_BALLISTIC: "Descent — Ballistic",
  DESCENT_CUSTOM: "Descent — Custom",
};

export const EVENT_LABELS: Record<EventName, string> = {
  LIFTOFF: "Liftoff",
  BURNOUT: "Burnout",
  APOGEE: "Apogee",
  DROGUE_DEPLOY: "Drogue Deploy",
  GUIDED_DESCENT_BEGIN: "Guided Descent Begin",
  GUIDED_DESCENT_END: "Guided Descent End",
  MAIN_DEPLOY: "Main Deploy",
  TOUCHDOWN: "Touchdown",
};
