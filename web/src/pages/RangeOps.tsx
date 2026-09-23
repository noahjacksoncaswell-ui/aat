import React, { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { fetchCountdownState, fetchLwccState, fetchMission, fetchMissions } from "../api/resources";
import { useMissionSocket } from "../hooks/useSocket";
import { usePreferences } from "../context/PreferencesContext";
import { formatTimestamp } from "../utils/time";
import { goNoGoTone } from "../components/StatusPill";
import PersistentClockHeader from "../components/PersistentClockHeader";
import { ElapsedIndicator, secondsToHms } from "../components/CountdownTab";
import ClassificationFooter from "../components/ClassificationFooter";
import type { GoNoGoStatus, Mission } from "../types";

/**
 * Revision Directive v5.1 - a new, standalone, read-only big-board display
 * for one selected mission's live state, meant to be left running full-
 * screen on a control-room monitor. It performs no writes of any kind
 * beyond the mission selector; every piece of content below is composed
 * from the same data-fetching (React Query keys) and live-update
 * (useMissionSocket / the v4.1 hold scheduler's broadcasts) infrastructure
 * the normal Mission Detail page already uses, just rendered at a much
 * larger scale - nothing here reimplements backend logic or state.
 *
 * Deliberately routed outside the standard <Layout> chrome (see App.tsx) so
 * the sidebar/header collapse entirely, per Section 3's kiosk-mode intent.
 */
export default function RangeOps() {
  const qc = useQueryClient();
  const { useZulu } = usePreferences();
  const [selectedId, setSelectedId] = useState<string>("");
  const [defaulted, setDefaulted] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(!!document.fullscreenElement);

  // Section 3 - actual browser full-screen (hides the browser's own tab
  // strip/address bar too, not just this app's sidebar chrome), the way a
  // control-room kiosk display is meant to run. Browsers only grant
  // fullscreen off a user gesture, so the best this can do unprompted is
  // try once on mount (silently a no-op if refused) - the toggle button is
  // the real, reliable entry point. `fullscreenchange` keeps state in sync
  // when the viewer exits via Esc instead of the button.
  useEffect(() => {
    document.documentElement.requestFullscreen?.().catch(() => {});
    const onChange = () => setIsFullscreen(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, []);

  function toggleFullscreen() {
    if (document.fullscreenElement) {
      document.exitFullscreen().catch(() => {});
    } else {
      document.documentElement.requestFullscreen().catch(() => {});
    }
  }

  const { data: missions } = useQuery({ queryKey: ["missions", {}], queryFn: () => fetchMissions() });

  // Section 4 - every mission not in a terminal, closed-out state. Removed
  // missions (v4.0 Section 1.2) are hard-deleted, so they never appear in
  // this list at all; Cancelled is the only status excluded explicitly.
  const selectable = useMemo(() => (missions ?? []).filter((m) => m.status !== "CANCELLED"), [missions]);

  // Default selection: nearest upcoming/active Targeted Launch Opportunity.
  useEffect(() => {
    if (defaulted || !missions) return;
    setDefaulted(true);
    const targetedWithEntry = selectable
      .map((m) => ({ mission: m, entry: m.launchPeriodEntries.find((e) => e.isTargeted) }))
      .filter((x): x is { mission: Mission; entry: NonNullable<typeof x.entry> } => !!x.entry)
      .sort((a, b) => new Date(a.entry.windowOpen).getTime() - new Date(b.entry.windowOpen).getTime());
    if (targetedWithEntry[0]) setSelectedId(targetedWithEntry[0].mission.id);
  }, [missions, defaulted, selectable]);

  const { data: mission } = useQuery({
    queryKey: ["mission", selectedId],
    queryFn: () => fetchMission(selectedId),
    enabled: !!selectedId,
  });
  const { data: state } = useQuery({
    queryKey: ["countdown", selectedId],
    queryFn: () => fetchCountdownState(selectedId),
    refetchInterval: 8000,
    enabled: !!selectedId,
  });
  const { data: lwcc } = useQuery({
    queryKey: ["lwcc", selectedId],
    queryFn: () => fetchLwccState(selectedId),
    refetchInterval: 30_000,
    enabled: !!selectedId,
  });

  useMissionSocket(selectedId || undefined, () => {
    qc.invalidateQueries({ queryKey: ["mission", selectedId] });
    qc.invalidateQueries({ queryKey: ["countdown", selectedId] });
    qc.invalidateQueries({ queryKey: ["lwcc", selectedId] });
  });

  const activeHold = state?.activeHold?.status === "ACTIVE" ? state.activeHold : null;
  const finalCall = computeFinalCall(mission?.goNoGoPolls);

  return (
    <div className="flex h-screen w-full flex-col overflow-hidden bg-black text-zinc-100">
      <div className="flex shrink-0 items-center justify-between gap-4 border-b border-zinc-800 px-4 py-2">
        <div className="flex items-center gap-3">
          <div className="flex h-7 w-7 items-center justify-center border border-white bg-white text-sm font-bold text-black">A</div>
          <div className="text-sm font-semibold uppercase tracking-wide text-zinc-300">Range Operations Display Board</div>
        </div>
        <div className="flex items-center gap-3">
          <select
            value={selectedId}
            onChange={(e) => setSelectedId(e.target.value)}
            className="input w-auto min-w-[280px] py-1.5 text-sm"
          >
            <option value="">Select a mission...</option>
            {selectable.map((m) => (
              <option key={m.id} value={m.id}>
                {m.designator} — {m.name} ({m.status.replace("_", " ")})
              </option>
            ))}
          </select>
          <button
            onClick={toggleFullscreen}
            className="border border-zinc-700 px-2.5 py-1.5 text-xs font-semibold text-zinc-400 hover:border-zinc-500 hover:text-zinc-200"
          >
            {isFullscreen ? "⤢ Exit Full Screen" : "⛶ Full Screen"}
          </button>
          <Link
            to="/"
            onClick={() => {
              if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
            }}
            className="border border-zinc-700 px-2.5 py-1.5 text-xs font-semibold text-zinc-400 hover:border-zinc-500 hover:text-zinc-200"
          >
            ✕ Exit
          </Link>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-6 py-6">
        {!selectedId || !mission ? (
          <div className="flex h-full flex-col items-center justify-center text-center text-zinc-500">
            <div className="text-2xl font-bold uppercase tracking-wide text-zinc-400">No Mission Selected</div>
            <p className="mt-2 text-sm">Select a mission above to bring up its live status.</p>
          </div>
        ) : (
          <div className="mx-auto max-w-[1600px] space-y-6">
            <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-zinc-800 pb-4">
              <div>
                <div className="text-4xl font-bold uppercase tracking-wide">{mission.name}</div>
                <div className="mt-1 text-lg text-zinc-400">
                  {mission.designator} · {mission.vehicle.name} · {mission.site.name}
                </div>
              </div>
              <div className="text-lg font-semibold uppercase tracking-wide text-zinc-400">{mission.status.replace("_", " ")}</div>
            </div>

            <PersistentClockHeader mission={mission} large />

            {activeHold && (
              <section className="card border-2 border-aat-caution bg-aat-caution/10 p-6">
                <div className="text-2xl">
                  <strong>ACTIVE HOLD</strong> at T-{secondsToHms(activeHold.holdMarkSeconds)} — {activeHold.type}
                  {activeHold.reason ? ` — ${activeHold.reason}` : ""}
                </div>
                {activeHold.actualStartedAt && (
                  <ElapsedIndicator startedAt={activeHold.actualStartedAt} estimatedSeconds={activeHold.estimatedDurationSeconds ?? undefined} large />
                )}
              </section>
            )}

            {lwcc && (
              <section className={`card p-6 ${lwcc.bannerStatus === "VIOLATION" ? "border-2 border-aat-nogo/60 bg-aat-nogo/5" : "border-2 border-aat-go/50 bg-aat-go/5"}`}>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="text-xl font-bold uppercase tracking-wide">
                    LWCC Compliance Status:{" "}
                    <span className={lwcc.bannerStatus === "VIOLATION" ? "text-aat-nogo" : "text-aat-go"}>{lwcc.bannerStatus.replace("_", " ")}</span>
                  </div>
                  {lwcc.notReportedCount > 0 && (
                    <span className="text-sm text-zinc-400">{lwcc.notReportedCount} requirement(s) not yet reported</span>
                  )}
                </div>
                {lwcc.bannerStatus === "VIOLATION" && (
                  <ul className="mt-3 space-y-1.5">
                    {lwcc.violatingRows.map((r) => (
                      <li key={r.no} className="font-mono text-base">
                        — LWCCR {r.no} ({r.description}){r.currentValue != null ? ` — CURRENT: ${r.currentValue.toFixed(1)}` : ""}
                        {r.holdExpiresAt ? ` — HOLD ACTIVE, expires ${formatTimestamp(r.holdExpiresAt, useZulu)}` : ""}
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            )}

            <section className="card p-6">
              <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
                <div className="text-xl font-bold uppercase tracking-wide">Launch Status Check</div>
                <div className={`status-pill ${statusPillClass(finalCall)} border-2 px-4 py-2 text-lg`}>LD Final Call: {finalCall.replace("_", " ")}</div>
              </div>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {mission.goNoGoPolls?.map((poll) => (
                  <div
                    key={poll.id}
                    className={`flex items-center justify-between border px-4 py-3 text-lg ${statusPillClass(poll.status)}`}
                  >
                    <span className="font-semibold">{poll.stationName}</span>
                    <span className="font-bold">{poll.status.replace("_", " ")}</span>
                  </div>
                ))}
                {!mission.goNoGoPolls?.length && <p className="text-zinc-500">No poll stations on record.</p>}
              </div>
            </section>
          </div>
        )}
      </div>

      <ClassificationFooter compact />
    </div>
  );
}

function computeFinalCall(polls: { status: GoNoGoStatus }[] | undefined): GoNoGoStatus {
  if (!polls || polls.length === 0) return "UNPOLLED";
  if (polls.some((p) => p.status === "NO_GO")) return "NO_GO";
  if (polls.some((p) => p.status === "HOLD")) return "HOLD";
  if (polls.every((p) => p.status === "GO")) return "GO";
  return "UNPOLLED";
}

function statusPillClass(status: GoNoGoStatus): string {
  const tone = goNoGoTone(status);
  return `status-${tone}`;
}
