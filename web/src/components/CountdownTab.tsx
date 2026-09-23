import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  addProgrammedHold,
  callHold,
  confirmCofrGate,
  fetchCoas,
  fetchCountdownState,
  fetchDocuments,
  fetchLwccState,
  fetchMilestoneTemplateOptions,
  generateMilestoneSequence,
  markLiftoff,
  recycleCountdown,
  releaseHold,
  removeHold,
  resetMilestoneSequence,
  reviseLot,
  setHoldAutoProceed,
  submitLot,
  updateMilestone,
  uploadDocument,
} from "../api/resources";
import { useAuth } from "../context/AuthContext";
import { usePreferences } from "../context/PreferencesContext";
import { tickTMinusSeconds } from "../utils/countdownMath";
import { formatTimestamp } from "../utils/time";
import { DocumentLink } from "./DocumentLink";
import { COMR_DOCUMENT_CATEGORY, LOT_CERTIFICATION_TEXTS } from "../types";
import type { Mission, MissionHold } from "../types";

export function secondsToHms(totalSeconds: number): string {
  const s = Math.max(0, Math.round(totalSeconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
}

function hmsToSeconds(hms: string): number {
  const [h, m, s] = hms.split(":").map((v) => Number(v) || 0);
  return h * 3600 + m * 60 + s;
}

export default function CountdownTab({ mission, onRequestScrub }: { mission: Mission; onRequestScrub: () => void }) {
  const { isLaunchDirector, isAdmin } = useAuth();
  const [now, setNow] = useState(new Date());
  const [fetchedAt, setFetchedAt] = useState(new Date());

  // v4.1 Item 1 - hold triggering (and Item 2's Auto-Proceed release) is
  // decided entirely server-side by the always-running hold scheduler
  // (server/src/services/holdScheduler.ts), not by this component. This
  // query just displays that state; MissionDetail's websocket subscription
  // invalidates it the instant the scheduler broadcasts a change, so the
  // freeze/banner appears live regardless of whether this tab was ever
  // navigated away from.
  const { data: state } = useQuery({
    queryKey: ["countdown", mission.id],
    queryFn: () => fetchCountdownState(mission.id),
    refetchInterval: 8000,
  });

  useEffect(() => {
    if (state) setFetchedAt(new Date());
  }, [state]);

  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  const tMinus = tickTMinusSeconds(state, fetchedAt, now);

  if (!state) return <div className="p-6 text-slate-400">Loading countdown state...</div>;

  const targeted = mission.launchPeriodEntries.find((e) => e.isTargeted);

  return (
    <div className="space-y-6">
      {!state.lot ? (
        <LotSubmissionForm mission={mission} targeted={targeted} disabled={mission.status !== "TARGETED"} />
      ) : (
        <>
          {state.activeHold?.status === "ACTIVE" && state.activeHold.isCofrComplianceHold && (
            <CofrComplianceGateAlert mission={mission} hold={state.activeHold} />
          )}
          <HoldManagement mission={mission} state={state} isLaunchDirector={isLaunchDirector} tMinus={tMinus} />
          <TimeControls mission={mission} state={state} onRequestScrub={onRequestScrub} />
        </>
      )}

      <MilestoneSequence mission={mission} />
      <VehicleLcpCrossReference mission={mission} isLaunchDirector={isLaunchDirector || isAdmin} />
    </div>
  );
}

// v5.0 Section 7 - full LOT Submission rebuild, governed by the reference
// MOP (IRM2-MOP-001A Section 5). Only launch date/time is load-bearing from
// the old form; the five free-text constraint boxes are gone, replaced by
// a mandatory CoMR selection, eight verbatim certification statements
// (checkbox 8 has real functional teeth - see the CoFR compliance gate
// banner in HoldManagement below), and a typed e-signature of record.
function LotSubmissionForm({ mission, targeted, disabled }: { mission: Mission; targeted: any; disabled: boolean }) {
  const qc = useQueryClient();
  const [lot, setLot] = useState("");
  const [comrDocumentId, setComrDocumentId] = useState("");
  const [certs, setCerts] = useState<boolean[]>(Array(8).fill(false));
  const [signatureName, setSignatureName] = useState("");
  const [signatureRole, setSignatureRole] = useState("");

  const { data: comrDocs } = useQuery({
    queryKey: ["documents", "comr"],
    queryFn: () => fetchDocuments({ category: COMR_DOCUMENT_CATEGORY }),
  });
  const { data: coas } = useQuery({ queryKey: ["coas", mission.siteId], queryFn: () => fetchCoas(mission.siteId) });
  const activeCoa = coas?.find((c) => c.status === "ACTIVE");

  const comrLibraryEmpty = comrDocs != null && comrDocs.length === 0;
  const allCertsAffirmed = certs.every(Boolean);
  const canSubmit = !disabled && !!lot && !!comrDocumentId && allCertsAffirmed && !!signatureName.trim() && !!signatureRole.trim() && !comrLibraryEmpty;

  const mutation = useMutation({
    mutationFn: () =>
      submitLot(mission.id, {
        lot: new Date(lot).toISOString(),
        comrDocumentId,
        certifications: certs,
        signatureName: signatureName.trim(),
        signatureRole: signatureRole.trim(),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["countdown", mission.id] });
      qc.invalidateQueries({ queryKey: ["mission", mission.id] });
    },
  });

  return (
    <section className="card p-5">
      <div className="mb-1 text-xs font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400">Targeted Lift-Off Time (LOT) Submission</div>
      <p className="mb-3 text-xs text-slate-500 dark:text-slate-400">
        Due no later than L-3 days. Must fall within the confirmed launch window
        {targeted ? ` (${new Date(targeted.windowOpen).toISOString()} – ${new Date(targeted.windowClose).toISOString()})` : ""}
        {activeCoa ? ` and the site's active COA Daily Operational Window (${activeCoa.dailyWindowOpen}Z–${activeCoa.dailyWindowClose}Z)` : ""}.
      </p>

      {comrLibraryEmpty && (
        <div className="mb-3 rounded-md border border-aat-nogo/50 bg-aat-nogo/10 p-3 text-xs text-aat-nogo">
          No Certification of Mission Readiness (CoMR) document exists in the Documentation Library. Upload and tag one with the "Certification of
          Mission Readiness (CoMR)" category before a LOT can be submitted.{" "}
          <Link to="/documents" className="font-semibold underline">
            Go to Documentation Library
          </Link>
        </div>
      )}

      <div className="space-y-3">
        <input type="datetime-local" value={lot} onChange={(e) => setLot(e.target.value)} className="input" />

        <div>
          <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-slate-400">
            Certification of Mission Readiness (CoMR)
          </label>
          <select value={comrDocumentId} onChange={(e) => setComrDocumentId(e.target.value)} disabled={comrLibraryEmpty} className="input disabled:opacity-40">
            <option value="">Select the governing CoMR document...</option>
            {comrDocs?.map((d) => (
              <option key={d.id} value={d.id}>
                {d.title}
              </option>
            ))}
          </select>
        </div>

        <div className="space-y-2 rounded-md border border-slate-200 p-3 dark:border-slate-800">
          <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Certification (all eight required)</div>
          {LOT_CERTIFICATION_TEXTS.map((text, i) => (
            <label key={i} className="flex items-start gap-2 text-xs">
              <input
                type="checkbox"
                className="mt-0.5 shrink-0"
                checked={certs[i]}
                onChange={(e) => setCerts(certs.map((c, idx) => (idx === i ? e.target.checked : c)))}
              />
              <span>{text}</span>
            </label>
          ))}
        </div>

        <div className="grid grid-cols-2 gap-2">
          <input placeholder="Typed full legal name" value={signatureName} onChange={(e) => setSignatureName(e.target.value)} className="input" />
          <input placeholder="Role" value={signatureRole} onChange={(e) => setSignatureRole(e.target.value)} className="input" />
        </div>
        <p className="text-[11px] text-slate-400">
          Digitally signed by the name and role entered above, timestamped at submission, as the e-signature of record.
        </p>
      </div>
      <button onClick={() => mutation.mutate()} disabled={!canSubmit || mutation.isPending} className="btn-primary mt-3 disabled:opacity-50">
        Submit LOT
      </button>
      {mutation.isError && <p className="mt-2 text-xs text-aat-nogo">{(mutation.error as any)?.response?.data?.error ?? "Submission failed"}</p>}
    </section>
  );
}

// v5.0 Section 7.4 - mandatory, non-dismissible-without-action alert shown
// whenever the mission's CoFR compliance gate has raised its system-
// triggered hold. There are only two ways out: confirm a CoFR document is
// now on file (which the backend independently verifies before releasing
// the hold), or Postpone Indefinitely from the Overview tab - the button
// here is a plain instruction, not a duplicate action, so there is exactly
// one place Postpone Indefinitely can be executed from.
function CofrComplianceGateAlert({ mission, hold }: { mission: Mission; hold: MissionHold }) {
  const qc = useQueryClient();
  const mutation = useMutation({
    mutationFn: () => confirmCofrGate(mission.id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["countdown", mission.id] });
      qc.invalidateQueries({ queryKey: ["mission", mission.id] });
    },
  });

  return (
    <section className="card border-2 border-aat-nogo bg-aat-nogo/10 p-5">
      <div className="mb-1 text-sm font-bold uppercase tracking-wide text-aat-nogo">CoFR Compliance Deadline Lapsed — T-Count Blocked</div>
      <p className="mb-3 text-xs text-slate-700 dark:text-slate-300">
        This mission's LOT Certification checkbox 8 was affirmed on the basis that a Certification of Flight Readiness (CoFR) would be filed no later
        than twenty-four (24) hours prior to LOT. That deadline has now lapsed with no CoFR document on file for the assigned vehicle (
        {mission.vehicle.name}). Per the LOT Certification, further T-Count progression is blocked until the Launch Director either confirms a CoFR
        document now exists, or executes Postpone Indefinitely.
      </p>
      <div className="flex flex-wrap items-center gap-3">
        <button onClick={() => mutation.mutate()} disabled={mutation.isPending} className="btn-primary disabled:opacity-50">
          Confirm CoFR Now On File &amp; Resume Countdown
        </button>
        <span className="text-xs text-slate-500 dark:text-slate-400">
          — or, from the Overview tab, execute <strong>Postpone Indefinitely</strong>.
        </span>
      </div>
      {mutation.isError && (
        <p className="mt-2 text-xs font-semibold text-aat-nogo">{(mutation.error as any)?.response?.data?.error ?? "Could not resolve the gate"}</p>
      )}
    </section>
  );
}

function HoldManagement({
  mission,
  state,
  isLaunchDirector,
  tMinus,
}: {
  mission: Mission;
  state: any;
  isLaunchDirector: boolean;
  tMinus: number | null;
}) {
  const { useZulu } = usePreferences();
  const qc = useQueryClient();
  const [newHold, setNewHold] = useState({ holdMark: "00:30:00", duration: "00:15:00", reason: "" });
  const [callReason, setCallReason] = useState("");
  const [showCall, setShowCall] = useState(false);

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["countdown", mission.id] });
    qc.invalidateQueries({ queryKey: ["mission", mission.id] });
  };

  // v5.3 Item 1 - both mutations take their payload as a `.mutate()`
  // argument rather than closing over component state, so the LWCC panel's
  // auto-populated buttons below can invoke these exact same mutation
  // objects (same endpoint, zero new hold logic) without the stale-closure
  // bug that would come from calling setState immediately before .mutate().
  const addHold = useMutation({
    mutationFn: (data: { holdMarkSeconds: number; estimatedDurationSeconds: number; reason: string }) => addProgrammedHold(mission.id, data),
    onSuccess: () => {
      invalidate();
      setNewHold({ holdMark: "00:30:00", duration: "00:15:00", reason: "" });
    },
  });
  const removeHoldMutation = useMutation({ mutationFn: (id: string) => removeHold(mission.id, id), onSuccess: invalidate });
  const releaseHoldMutation = useMutation({ mutationFn: (id: string) => releaseHold(mission.id, id), onSuccess: invalidate });
  const callHoldMutation = useMutation({
    mutationFn: (reason: string) => callHold(mission.id, reason),
    onSuccess: () => {
      invalidate();
      setShowCall(false);
      setCallReason("");
    },
  });
  const autoProceedMutation = useMutation({
    mutationFn: ({ holdId, autoProceed }: { holdId: string; autoProceed: boolean }) => setHoldAutoProceed(mission.id, holdId, autoProceed),
    onSuccess: invalidate,
  });
  const [showAutoConfirm, setShowAutoConfirm] = useState(false);

  const activeHold: MissionHold | undefined = state.holds.find((h: MissionHold) => h.status === "ACTIVE");

  // v5.3 Item 1 - reads the exact same LWCC evaluation data the LWCC tab's
  // own compliance banner uses (same query key, same server computation);
  // this panel never re-derives violation status itself.
  const { data: lwcc } = useQuery({
    queryKey: ["lwcc", mission.id],
    queryFn: () => fetchLwccState(mission.id),
    refetchInterval: 30_000,
  });
  const [recNow, setRecNow] = useState(new Date());
  useEffect(() => {
    const t = setInterval(() => setRecNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);
  const [weatherHoldDuration, setWeatherHoldDuration] = useState("00:15:00");

  const violatingRows = lwcc?.violatingRows ?? [];
  // Section 7.4's existing distinction is holdExpiresAt: present only for
  // requirements with a built-in wait period once that hold is active;
  // null for an instantaneous-limit violation with no timer. Used as-is,
  // not re-derived from LWCC_REQUIREMENTS.
  const timedViolations = violatingRows.filter((r) => r.holdExpiresAt);
  const untimedViolations = violatingRows.filter((r) => !r.holdExpiresAt);

  let recommendation: string;
  if (violatingRows.length === 0) {
    recommendation = "NO LWCC VIOLATIONS — NO HOLD RECOMMENDED";
  } else if (untimedViolations.length > 0) {
    // An instantaneous-limit violation (wind, visibility, cloud coverage,
    // etc.) has no known clearance time, so it takes precedence over any
    // simultaneous timed violation - a countdown figure would be
    // misleading when part of the hold has no countdown at all.
    recommendation = "LWCC RECOMMENDS A HOLD UNTIL WEATHER VIOLATIONS CLEAR";
  } else {
    // Every violation present carries a timer; recommend whichever clears
    // last (the binding constraint), live-recalculated every second so it
    // always reflects whichever violation is CURRENTLY longest-remaining.
    const longestRemainingSeconds = Math.max(
      ...timedViolations.map((r) => (new Date(r.holdExpiresAt!).getTime() - recNow.getTime()) / 1000)
    );
    recommendation = `LWCC RECOMMENDS A HOLD OF ${secondsToHms(Math.max(0, longestRemainingSeconds))}`;
  }

  const weatherHoldReason = `Weather — LWCCR ${violatingRows.map((r) => r.no).join(", ")} violated`;

  return (
    <section className="card p-5">
      <div className="mb-3 flex items-center justify-between">
        <div className="text-xs font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400">Hold Management</div>
        {isLaunchDirector && state.tCountStatus === "COUNTING" && (
          <button onClick={() => setShowCall(true)} className="btn-danger text-xs">
            Call Hold / Pause Countdown
          </button>
        )}
      </div>

      {activeHold && (
        <div className="mb-3 rounded-md border border-aat-caution bg-aat-caution/10 p-3">
          <div className="flex items-center justify-between text-sm">
            <div>
              <strong>ACTIVE HOLD</strong> at T-{secondsToHms(activeHold.holdMarkSeconds)} — {activeHold.type}
              {activeHold.reason ? ` — ${activeHold.reason}` : ""}
            </div>
            <div className="flex items-center gap-3">
              {isLaunchDirector && activeHold.type === "PROGRAMMED" && (
                <label className="flex items-center gap-1.5 text-xs">
                  <span className={activeHold.autoProceed ? "text-slate-500" : "font-semibold"}>Manual-Proceed</span>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={activeHold.autoProceed}
                    onClick={() => {
                      if (activeHold.autoProceed) {
                        // Auto -> Manual: immediate, no confirmation.
                        autoProceedMutation.mutate({ holdId: activeHold.id, autoProceed: false });
                      } else {
                        // Manual -> Auto: lightweight single confirmation.
                        setShowAutoConfirm(true);
                      }
                    }}
                    className={`relative h-4 w-8 shrink-0 rounded-full transition-colors ${activeHold.autoProceed ? "bg-aat-accent" : "bg-slate-600"}`}
                  >
                    {/* v5.0 Item 1 - explicit left-0.5 base position (rather
                        than relying on the button's ambiguous CSS "left:
                        auto" static-position, which rendered the knob on
                        the wrong side and let it overflow past the track
                        at the "on" position) makes both states fully
                        deterministic and contained within the track. */}
                    <span
                      className={`absolute left-0.5 top-0.5 h-3 w-3 rounded-full bg-white transition-transform ${activeHold.autoProceed ? "translate-x-4" : "translate-x-0"}`}
                    />
                  </button>
                  <span className={activeHold.autoProceed ? "font-semibold text-aat-accent" : "text-slate-500"}>Auto-Proceed</span>
                </label>
              )}
              {isLaunchDirector && !activeHold.isCofrComplianceHold && (
                <button onClick={() => releaseHoldMutation.mutate(activeHold.id)} className="btn-primary text-xs">
                  Proceed Through Hold
                </button>
              )}
              {activeHold.isCofrComplianceHold && (
                <span className="text-xs font-semibold text-aat-nogo">See CoFR Compliance alert above</span>
              )}
            </div>
          </div>
          {activeHold.actualStartedAt && (
            <ElapsedIndicator startedAt={activeHold.actualStartedAt} estimatedSeconds={activeHold.estimatedDurationSeconds ?? undefined} />
          )}
        </div>
      )}

      {showAutoConfirm && activeHold && (
        <div className="fixed inset-0 z-[2000] flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-sm rounded-xl border border-zinc-800 bg-black p-6">
            <h2 className="mb-2 text-base font-bold">Switch to Auto-Proceed?</h2>
            <p className="mb-4 text-sm text-slate-300">
              The system will automatically release this hold and resume the Test Clock the instant the estimated duration elapses, with
              no further confirmation.
            </p>
            <div className="flex justify-end gap-2">
              <button onClick={() => setShowAutoConfirm(false)} className="btn-secondary">
                Cancel
              </button>
              <button
                onClick={() => {
                  autoProceedMutation.mutate({ holdId: activeHold.id, autoProceed: true });
                  setShowAutoConfirm(false);
                }}
                className="btn-primary"
              >
                Confirm Auto-Proceed
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="space-y-1">
        {state.holds
          .filter((h: MissionHold) => h.status !== "ACTIVE")
          .map((h: MissionHold) => (
            <div key={h.id} className="flex items-center justify-between rounded-md border border-slate-200 px-3 py-1.5 text-xs dark:border-slate-800">
              <span>
                T-{secondsToHms(h.holdMarkSeconds)} · {h.type} · {h.status}
                {h.estimatedDurationSeconds ? ` · est. ${secondsToHms(h.estimatedDurationSeconds)}` : ""}
                {h.actualDurationSeconds != null ? ` · actual ${secondsToHms(h.actualDurationSeconds)}` : ""}
                {h.reason ? ` — ${h.reason}` : ""}
              </span>
              {isLaunchDirector && h.status === "SCHEDULED" && (
                <button onClick={() => removeHoldMutation.mutate(h.id)} className="text-aat-nogo hover:underline">
                  Remove
                </button>
              )}
            </div>
          ))}
        {state.holds.length === 0 && <div className="text-xs text-slate-400">No holds programmed.</div>}
      </div>

      {isLaunchDirector && (
        <div className="mt-3 grid grid-cols-4 gap-2">
          <input value={newHold.holdMark} onChange={(e) => setNewHold({ ...newHold, holdMark: e.target.value })} placeholder="T-mark HH:MM:SS" className="input" />
          <input value={newHold.duration} onChange={(e) => setNewHold({ ...newHold, duration: e.target.value })} placeholder="Est. duration HH:MM:SS" className="input" />
          <input value={newHold.reason} onChange={(e) => setNewHold({ ...newHold, reason: e.target.value })} placeholder="Reason (optional)" className="input" />
          <button
            onClick={() =>
              addHold.mutate({ holdMarkSeconds: hmsToSeconds(newHold.holdMark), estimatedDurationSeconds: hmsToSeconds(newHold.duration), reason: newHold.reason })
            }
            className="btn-secondary text-xs"
          >
            Add programmed hold
          </button>
        </div>
      )}

      {/* v5.3 Item 1 - LWCC Recommendation panel: restates the same LWCC
          compliance data shown on the LWCC tab's own banner (not a
          duplicate evaluation), adds a live-recalculated hold
          recommendation, and offers two pre-populated entry points into
          the exact same hold mutations used above - no new hold mechanics. */}
      <div className="mt-4 border-t border-slate-200 pt-4 dark:border-slate-800">
        <div className="mb-2 flex items-center justify-between">
          <div className="text-xs font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400">LWCC Recommendation</div>
          <span className={`text-xs font-bold uppercase ${violatingRows.length > 0 ? "text-aat-nogo" : "text-aat-go"}`}>
            {violatingRows.length > 0 ? "VIOLATION" : "NO VIOLATION"}
          </span>
        </div>

        {violatingRows.length > 0 && (
          <ul className="mb-3 space-y-1">
            {violatingRows.map((r) => (
              <li key={r.no} className="font-mono text-xs text-slate-600 dark:text-slate-300">
                — LWCCR {r.no} ({r.description})
                {r.holdExpiresAt ? ` — HOLD ACTIVE, expires ${formatTimestamp(r.holdExpiresAt, useZulu)}` : ""}
              </li>
            ))}
          </ul>
        )}

        <div className="mb-3 border border-aat-caution bg-aat-caution/10 px-3 py-2 text-xs font-bold uppercase tracking-wide text-aat-caution">
          {recommendation}
        </div>

        {isLaunchDirector && violatingRows.length > 0 && state.tCountStatus === "COUNTING" && (
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <button onClick={() => callHoldMutation.mutate(weatherHoldReason)} className="btn-danger text-xs">
              Weather Hold (Indefinite)
            </button>
            <div className="flex gap-2">
              <input
                value={weatherHoldDuration}
                onChange={(e) => setWeatherHoldDuration(e.target.value)}
                placeholder="Est. duration HH:MM:SS"
                className="input"
              />
              <button
                onClick={() =>
                  addHold.mutate({
                    // Auto-set to the current countdown position minus a
                    // small safety margin: POST /countdown/holds rejects a
                    // mark that is already >= the server's freshly-computed
                    // T-minus at request time (see that route's validation),
                    // which a mark read at the exact instant of the click
                    // would trip the moment network/processing latency
                    // passes. This is purely a client-side accommodation of
                    // that existing, unmodified check - not a new rule.
                    holdMarkSeconds: Math.max(0, Math.round(tMinus ?? state.currentTMinusSeconds ?? 0) - 3),
                    estimatedDurationSeconds: hmsToSeconds(weatherHoldDuration),
                    reason: weatherHoldReason,
                  })
                }
                className="btn-secondary shrink-0 text-xs"
              >
                Weather Hold (Planned Duration)
              </button>
            </div>
          </div>
        )}
      </div>

      {showCall && (
        <div className="fixed inset-0 z-[2000] flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-md rounded-xl border border-zinc-800 bg-black p-6">
            <h2 className="mb-3 text-lg font-bold">Call Hold</h2>
            <textarea value={callReason} onChange={(e) => setCallReason(e.target.value)} placeholder="Reason (required)" className="input" rows={3} />
            <div className="mt-4 flex justify-end gap-2">
              <button onClick={() => setShowCall(false)} className="btn-secondary">
                Cancel
              </button>
              <button onClick={() => callHoldMutation.mutate(callReason)} disabled={!callReason.trim()} className="btn-danger disabled:opacity-50">
                Confirm hold
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}

export function ElapsedIndicator({
  startedAt,
  estimatedSeconds,
  large,
  textClassName,
}: {
  startedAt: string;
  estimatedSeconds?: number;
  large?: boolean;
  /** v5.4 Section 2 - Range Ops Display only, overrides the size portion of
   * the default large/normal classes to match that page's LWCC banner body
   * text exactly. Every other caller omits this and keeps large/normal. */
  textClassName?: string;
}) {
  const [now, setNow] = useState(new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);
  const elapsed = (now.getTime() - new Date(startedAt).getTime()) / 1000;
  const elapsedText = secondsToHms(elapsed);
  const durationElapsed = estimatedSeconds != null && elapsed >= estimatedSeconds;
  const sizeClassName = textClassName ?? (large ? "mt-2 text-xl" : "mt-1 text-xs");
  return (
    <div className={`${sizeClassName} ${durationElapsed ? "animate-pulse font-bold text-aat-nogo" : "text-slate-500 dark:text-slate-400"}`}>
      Elapsed: {elapsedText}
      {estimatedSeconds != null ? ` / est. ${secondsToHms(estimatedSeconds)}` : ""}
      {durationElapsed ? " — DURATION ELAPSED, AWAITING RELEASE" : ""}
    </div>
  );
}

function TimeControls({ mission, state, onRequestScrub }: { mission: Mission; state: any; onRequestScrub: () => void }) {
  const qc = useQueryClient();
  const { isLaunchDirector } = useAuth();
  const [showRevise, setShowRevise] = useState(false);
  const [showRecycle, setShowRecycle] = useState(false);
  const [reviseForm, setReviseForm] = useState({ lot: "", reason: "" });
  const [recycleForm, setRecycleForm] = useState({ toMark: "00:30:00", reason: "" });

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["countdown", mission.id] });
    qc.invalidateQueries({ queryKey: ["mission", mission.id] });
  };

  const reviseMutation = useMutation({
    mutationFn: () => reviseLot(mission.id, new Date(reviseForm.lot).toISOString(), reviseForm.reason),
    onSuccess: () => {
      invalidate();
      setShowRevise(false);
    },
  });
  const recycleMutation = useMutation({
    mutationFn: () => recycleCountdown(mission.id, hmsToSeconds(recycleForm.toMark), recycleForm.reason),
    onSuccess: () => {
      invalidate();
      setShowRecycle(false);
    },
  });
  const liftoffMutation = useMutation({
    mutationFn: () => markLiftoff(mission.id),
    onSuccess: invalidate,
  });

  if (!isLaunchDirector) return null;

  return (
    <section className="card p-5">
      <div className="mb-3 text-xs font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400">Time Control Actions</div>
      <div className="flex flex-wrap gap-2">
        <button
          onClick={() => {
            if (window.confirm("Establish the actual launch time now? This marks liftoff and cannot be undone from this action.")) {
              liftoffMutation.mutate();
            }
          }}
          disabled={state.tCountStatus === "COMPLETE"}
          className="btn-primary disabled:opacity-50"
        >
          Establish Actual Launch Time (Mark Liftoff)
        </button>
        <button onClick={() => setShowRevise(true)} className="btn-secondary">
          Select New LOT
        </button>
        <button onClick={() => setShowRecycle(true)} disabled={state.tCountStatus !== "COUNTING"} className="btn-secondary disabled:opacity-50">
          Recycle to Mark
        </button>
        <button onClick={onRequestScrub} className="btn-danger">
          Abort / Route to Scrub
        </button>
      </div>

      {showRevise && (
        <div className="fixed inset-0 z-[2000] flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-md rounded-xl border border-zinc-800 bg-black p-6">
            <h2 className="mb-3 text-lg font-bold">Select New LOT</h2>
            <input type="datetime-local" value={reviseForm.lot} onChange={(e) => setReviseForm({ ...reviseForm, lot: e.target.value })} className="input mb-2" />
            <textarea value={reviseForm.reason} onChange={(e) => setReviseForm({ ...reviseForm, reason: e.target.value })} placeholder="Reason (required)" className="input" rows={2} />
            <div className="mt-4 flex justify-end gap-2">
              <button onClick={() => setShowRevise(false)} className="btn-secondary">
                Cancel
              </button>
              <button onClick={() => reviseMutation.mutate()} disabled={!reviseForm.lot || !reviseForm.reason.trim()} className="btn-primary disabled:opacity-50">
                Confirm new LOT
              </button>
            </div>
            {reviseMutation.isError && <p className="mt-2 text-xs text-aat-nogo">{(reviseMutation.error as any)?.response?.data?.error}</p>}
          </div>
        </div>
      )}

      {showRecycle && (
        <div className="fixed inset-0 z-[2000] flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-md rounded-xl border border-zinc-800 bg-black p-6">
            <h2 className="mb-3 text-lg font-bold">Recycle to Mark</h2>
            <input value={recycleForm.toMark} onChange={(e) => setRecycleForm({ ...recycleForm, toMark: e.target.value })} placeholder="Target T-mark HH:MM:SS" className="input mb-2" />
            <textarea value={recycleForm.reason} onChange={(e) => setRecycleForm({ ...recycleForm, reason: e.target.value })} placeholder="Reason (required)" className="input" rows={2} />
            <div className="mt-4 flex justify-end gap-2">
              <button onClick={() => setShowRecycle(false)} className="btn-secondary">
                Cancel
              </button>
              <button onClick={() => recycleMutation.mutate()} disabled={!recycleForm.reason.trim()} className="btn-primary disabled:opacity-50">
                Confirm recycle
              </button>
            </div>
            {recycleMutation.isError && <p className="mt-2 text-xs text-aat-nogo">{(recycleMutation.error as any)?.response?.data?.error}</p>}
          </div>
        </div>
      )}
    </section>
  );
}

function MilestoneSequence({ mission }: { mission: Mission }) {
  const qc = useQueryClient();
  const { isLaunchDirector, isAdmin } = useAuth();
  const [selectedTemplateId, setSelectedTemplateId] = useState<string>("standard");
  const [showResetConfirm, setShowResetConfirm] = useState(false);

  const { data: templateOptions } = useQuery({
    queryKey: ["milestone-templates", mission.id],
    queryFn: () => fetchMilestoneTemplateOptions(mission.id),
  });

  const generateMutation = useMutation({
    mutationFn: () => generateMilestoneSequence(mission.id, selectedTemplateId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["mission", mission.id] });
      qc.invalidateQueries({ queryKey: ["milestone-templates", mission.id] });
    },
  });
  const resetMutation = useMutation({
    mutationFn: () => resetMilestoneSequence(mission.id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["mission", mission.id] });
      qc.invalidateQueries({ queryKey: ["milestone-templates", mission.id] });
      setShowResetConfirm(false);
    },
  });
  const updateMutation = useMutation({
    mutationFn: ({ id, status }: { id: string; status: string }) => updateMilestone(mission.id, id, { status }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["mission", mission.id] }),
  });

  const milestones = mission.milestones ?? [];
  const canResetSequence = isAdmin || isLaunchDirector;

  return (
    <section className="card p-5">
      <div className="mb-3 flex items-center justify-between">
        <div>
          <div className="text-xs font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400">Countdown Milestone Sequence</div>
          {milestones.length > 0 && (
            <div className="mt-1 text-[11px] text-slate-400">
              Applied VLCP Milestone Template: <span className="text-slate-300">{mission.appliedMilestoneTemplateName ?? "Unknown"}</span>
            </div>
          )}
        </div>
        <div className="flex items-center gap-2">
          {isLaunchDirector && milestones.length === 0 && (
            <>
              <select
                value={selectedTemplateId}
                onChange={(e) => setSelectedTemplateId(e.target.value)}
                className="rounded-md border border-slate-300 bg-transparent px-2 py-1 text-xs dark:border-slate-700"
              >
                {templateOptions?.options.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.name} ({o.itemCount})
                  </option>
                ))}
              </select>
              <button onClick={() => generateMutation.mutate()} className="btn-secondary text-xs">
                Generate Countdown Sequence
              </button>
            </>
          )}
          {canResetSequence && milestones.length > 0 && (
            <button onClick={() => setShowResetConfirm(true)} className="rounded-md border border-red-800 px-2 py-1 text-xs font-semibold text-red-400 hover:bg-red-950/40">
              Reset Countdown Sequence
            </button>
          )}
        </div>
      </div>
      {showResetConfirm && (
        <div className="fixed inset-0 z-[2000] flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-md rounded-xl border border-red-900 bg-black p-6">
            <h2 className="mb-2 text-lg font-bold text-red-400">Reset Countdown Sequence</h2>
            <p className="mb-4 text-sm text-slate-300">
              This will remove the currently generated milestone sequence for {mission.designator}
              {mission.appliedMilestoneTemplateName ? ` (applied template: "${mission.appliedMilestoneTemplateName}")` : ""} and any recorded
              verification / checkbox progress against it. This action cannot be undone. A new VLCP Milestone Template can be selected and
              generated afterward.
            </p>
            <div className="flex justify-end gap-2">
              <button onClick={() => setShowResetConfirm(false)} className="btn-secondary">
                Cancel
              </button>
              <button
                onClick={() => resetMutation.mutate()}
                disabled={resetMutation.isPending}
                className="rounded-md bg-red-700 px-3 py-1.5 text-sm font-semibold text-white hover:bg-red-600 disabled:opacity-50"
              >
                Confirm Reset
              </button>
            </div>
          </div>
        </div>
      )}
      {["PRE_OPERATION_SETUP", "COUNTDOWN"].map((phase) => {
        const items = milestones.filter((m) => (m.phase ?? "COUNTDOWN") === phase).sort((a, b) => b.tMinusSeconds - a.tMinusSeconds);
        if (items.length === 0) return null;
        return (
          <div key={phase} className="mb-3">
            <div className="mb-1 text-[11px] font-semibold uppercase text-slate-400">{phase.replace(/_/g, " ")}</div>
            <div className="space-y-1">
              {items.map((m) => (
                <div key={m.id} className="flex items-center justify-between rounded-md border border-slate-200 px-3 py-1.5 text-xs dark:border-slate-800">
                  <div>
                    <span className="font-mono text-slate-500">T-{secondsToHms(m.tMinusSeconds)}</span> <span className="ml-2">{m.label}</span>
                    {m.responsibleStation && <span className="ml-2 text-slate-400">({m.responsibleStation})</span>}
                  </div>
                  <select
                    value={m.status}
                    onChange={(e) => updateMutation.mutate({ id: m.id, status: e.target.value })}
                    className="rounded-md border border-slate-300 bg-transparent px-1.5 py-0.5 text-[11px] dark:border-slate-700"
                  >
                    {["UPCOMING", "IN_PROGRESS", "COMPLETE", "HELD"].map((s) => (
                      <option key={s} value={s}>
                        {s.replace("_", " ")}
                      </option>
                    ))}
                  </select>
                </div>
              ))}
            </div>
          </div>
        );
      })}
      {milestones.length === 0 && <div className="text-xs text-slate-400">No milestone sequence generated for this mission yet.</div>}
    </section>
  );
}

function VehicleLcpCrossReference({ mission, isLaunchDirector }: { mission: Mission; isLaunchDirector: boolean }) {
  const qc = useQueryClient();
  const [file, setFile] = useState<File | null>(null);
  const { data: docs } = useQuery({
    queryKey: ["vehicle-lcp", mission.id, mission.vehicleId],
    queryFn: () => fetchDocuments({ missionId: mission.id, category: "Launch Countdown Procedure" }),
  });

  const uploadMutation = useMutation({
    mutationFn: () => {
      const fd = new FormData();
      fd.append("file", file!);
      fd.append("title", `${mission.vehicle.name} LCP — ${mission.designator}`);
      fd.append("category", "Launch Countdown Procedure");
      fd.append("missionId", mission.id);
      fd.append("vehicleId", mission.vehicleId);
      return uploadDocument(fd);
    },
    onSuccess: () => {
      setFile(null);
      qc.invalidateQueries({ queryKey: ["vehicle-lcp", mission.id, mission.vehicleId] });
    },
  });

  return (
    <section className="card p-5">
      <div className="mb-2 text-xs font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400">
        Vehicle-Specific Launch Countdown Procedure
      </div>
      <div className="space-y-1">
        {docs?.map((d) => (
          <DocumentLink
            key={d.id}
            documentId={d.id}
            version={d.currentVersion}
            className="block rounded-md border border-slate-200 px-2 py-1.5 text-xs hover:bg-slate-50 dark:border-slate-800 dark:hover:bg-slate-800/50"
          >
            {d.title} <span className="text-slate-400">v{d.currentVersion}</span>
          </DocumentLink>
        ))}
        {docs?.length === 0 && <div className="text-xs text-slate-400">No vehicle-specific LCP on file for this mission.</div>}
      </div>
      {isLaunchDirector && (
        <div className="mt-2 flex gap-2">
          <input type="file" onChange={(e) => setFile(e.target.files?.[0] ?? null)} className="flex-1 text-xs" />
          <button onClick={() => file && uploadMutation.mutate()} disabled={!file} className="rounded-md bg-white px-2 py-1 text-xs font-semibold text-black disabled:opacity-50">
            Upload LCP
          </button>
        </div>
      )}
    </section>
  );
}
