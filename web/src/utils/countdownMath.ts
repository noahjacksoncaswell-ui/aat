import type { CountdownState } from "../types";

/**
 * Ticks T-COUNT locally between polls of /countdown/state. The server
 * snapshot gives currentTMinusSeconds and tCountStatus at fetchedAt; while
 * COUNTING we keep subtracting real elapsed time client-side, while HOLDING
 * the value stays frozen exactly as the server reported it.
 */
export function tickTMinusSeconds(state: CountdownState | undefined, fetchedAt: Date, now: Date): number | null {
  if (!state || state.currentTMinusSeconds == null) return null;
  if (state.tCountStatus === "HOLDING" || state.tCountStatus === "STOPPED" || state.tCountStatus === "COMPLETE") {
    return state.currentTMinusSeconds;
  }
  const elapsedSinceFetch = (now.getTime() - fetchedAt.getTime()) / 1000;
  return state.currentTMinusSeconds - elapsedSinceFetch;
}

export function formatTMinus(seconds: number | null): string {
  if (seconds == null) return "--:--:--";
  const isPast = seconds < 0;
  const abs = Math.abs(seconds);
  const days = Math.floor(abs / 86400);
  const hours = Math.floor((abs % 86400) / 3600);
  const minutes = Math.floor((abs % 3600) / 60);
  const secs = Math.floor(abs % 60);
  const pad = (n: number) => String(n).padStart(2, "0");
  const core = days > 0 ? `${days}d ${pad(hours)}:${pad(minutes)}:${pad(secs)}` : `${pad(hours)}:${pad(minutes)}:${pad(secs)}`;
  return `${isPast ? "T+" : "T-"}${core}`;
}

export function formatMet(liftoffActualTime: string, now: Date): string {
  const { core } = formatMetParts(liftoffActualTime, now);
  return `MET ${core}`;
}

// v7.1 Section 2 - split out so the "MET" label and the "+HH:MM:SS" value
// can be rendered at different font sizes (Range Ops Display only); the
// underlying elapsed-time computation is unchanged from formatMet above.
export function formatMetParts(liftoffActualTime: string, now: Date): { prefix: string; core: string } {
  const seconds = Math.max(0, (now.getTime() - new Date(liftoffActualTime).getTime()) / 1000);
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);
  const pad = (n: number) => String(n).padStart(2, "0");
  const core = days > 0 ? `${days}d ${pad(hours)}:${pad(minutes)}:${pad(secs)}` : `${pad(hours)}:${pad(minutes)}:${pad(secs)}`;
  return { prefix: "MET", core: `+${core}` };
}
