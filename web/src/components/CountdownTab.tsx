import React, { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  addProgrammedHold,
  callHold,
  fetchCountdownState,
  fetchDocuments,
  generateMilestoneSequence,
  markLiftoff,
  recycleCountdown,
  releaseHold,
  removeHold,
  reviseLot,
  submitLot,
  triggerHold,
  updateMilestone,
  uploadDocument,
} from "../api/resources";
import { useAuth } from "../context/AuthContext";
import { usePreferences } from "../context/PreferencesContext";
import { tickTMinusSeconds } from "../utils/countdownMath";
import { DocumentLink } from "./DocumentLink";
import type { Mission, MissionHold } from "../types";

function secondsToHms(totalSeconds: number): string {
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
  const qc = useQueryClient();
  const [now, setNow] = useState(new Date());
  const [fetchedAt, setFetchedAt] = useState(new Date());
  const triggeredRef = useRef<Set<string>>(new Set());

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

  const triggerMutation = useMutation({
    mutationFn: (holdId: string) => triggerHold(mission.id, holdId),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["countdown", mission.id] }),
  });

  // Client-driven auto-trigger: fire once when the ticking clock crosses a scheduled hold mark.
  useEffect(() => {
    if (!state || tMinus == null || state.tCountStatus !== "COUNTING") return;
    for (const hold of state.holds) {
      if (hold.status === "SCHEDULED" && tMinus <= hold.holdMarkSeconds && !triggeredRef.current.has(hold.id)) {
        triggeredRef.current.add(hold.id);
        triggerMutation.mutate(hold.id);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tMinus, state?.tCountStatus]);

  if (!state) return <div className="p-6 text-slate-400">Loading countdown state...</div>;

  const targeted = mission.launchPeriodEntries.find((e) => e.isTargeted);

  return (
    <div className="space-y-6">
      {!state.lot ? (
        <LotSubmissionForm missionId={mission.id} targeted={targeted} disabled={mission.status !== "TARGETED"} />
      ) : (
        <>
          <HoldManagement mission={mission} state={state} isLaunchDirector={isLaunchDirector} />
          <TimeControls mission={mission} state={state} onRequestScrub={onRequestScrub} />
        </>
      )}

      <MilestoneSequence mission={mission} />
      <VehicleLcpCrossReference mission={mission} isLaunchDirector={isLaunchDirector || isAdmin} />
    </div>
  );
}

function LotSubmissionForm({ missionId, targeted, disabled }: { missionId: string; targeted: any; disabled: boolean }) {
  const qc = useQueryClient();
  const [form, setForm] = useState({
    lot: "",
    vehicleReadinessNotes: "",
    rangeAvailabilityNotes: "",
    meteorologicalOutlookNotes: "",
    scheduleConstraintsNotes: "",
    safetyRegulatoryNotes: "",
  });

  const mutation = useMutation({
    mutationFn: () => submitLot(missionId, { ...form, lot: new Date(form.lot).toISOString() }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["countdown", missionId] });
      qc.invalidateQueries({ queryKey: ["mission", missionId] });
    },
  });

  return (
    <section className="card p-5">
      <div className="mb-1 text-xs font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400">Targeted Lift-Off Time (LOT) Submission</div>
      <p className="mb-3 text-xs text-slate-500 dark:text-slate-400">
        Due no later than L-3 days. Must fall within the confirmed launch window
        {targeted ? ` (${new Date(targeted.windowOpen).toISOString()} – ${new Date(targeted.windowClose).toISOString()})` : ""}.
      </p>
      <div className="space-y-3">
        <input type="datetime-local" value={form.lot} onChange={(e) => setForm({ ...form, lot: e.target.value })} className="input" />
        <textarea placeholder="Vehicle readiness / CoFR basis" value={form.vehicleReadinessNotes} onChange={(e) => setForm({ ...form, vehicleReadinessNotes: e.target.value })} className="input" rows={2} />
        <textarea placeholder="Range availability" value={form.rangeAvailabilityNotes} onChange={(e) => setForm({ ...form, rangeAvailabilityNotes: e.target.value })} className="input" rows={2} />
        <textarea placeholder="Meteorological outlook" value={form.meteorologicalOutlookNotes} onChange={(e) => setForm({ ...form, meteorologicalOutlookNotes: e.target.value })} className="input" rows={2} />
        <textarea placeholder="Schedule constraints" value={form.scheduleConstraintsNotes} onChange={(e) => setForm({ ...form, scheduleConstraintsNotes: e.target.value })} className="input" rows={2} />
        <textarea placeholder="Safety/regulatory constraints" value={form.safetyRegulatoryNotes} onChange={(e) => setForm({ ...form, safetyRegulatoryNotes: e.target.value })} className="input" rows={2} />
      </div>
      <button
        onClick={() => mutation.mutate()}
        disabled={disabled || !form.lot}
        className="btn-primary mt-3 disabled:opacity-50"
      >
        Submit LOT
      </button>
      {mutation.isError && <p className="mt-2 text-xs text-aat-nogo">{(mutation.error as any)?.response?.data?.error ?? "Submission failed"}</p>}
    </section>
  );
}

function HoldManagement({ mission, state, isLaunchDirector }: { mission: Mission; state: any; isLaunchDirector: boolean }) {
  const { useZulu } = usePreferences();
  const qc = useQueryClient();
  const [newHold, setNewHold] = useState({ holdMark: "00:30:00", duration: "00:15:00", reason: "" });
  const [callReason, setCallReason] = useState("");
  const [showCall, setShowCall] = useState(false);

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["countdown", mission.id] });
    qc.invalidateQueries({ queryKey: ["mission", mission.id] });
  };

  const addHold = useMutation({
    mutationFn: () =>
      addProgrammedHold(mission.id, { holdMarkSeconds: hmsToSeconds(newHold.holdMark), estimatedDurationSeconds: hmsToSeconds(newHold.duration), reason: newHold.reason }),
    onSuccess: () => {
      invalidate();
      setNewHold({ holdMark: "00:30:00", duration: "00:15:00", reason: "" });
    },
  });
  const removeHoldMutation = useMutation({ mutationFn: (id: string) => removeHold(mission.id, id), onSuccess: invalidate });
  const releaseHoldMutation = useMutation({ mutationFn: (id: string) => releaseHold(mission.id, id), onSuccess: invalidate });
  const callHoldMutation = useMutation({
    mutationFn: () => callHold(mission.id, callReason),
    onSuccess: () => {
      invalidate();
      setShowCall(false);
      setCallReason("");
    },
  });

  const activeHold: MissionHold | undefined = state.holds.find((h: MissionHold) => h.status === "ACTIVE");

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
            {isLaunchDirector && (
              <button onClick={() => releaseHoldMutation.mutate(activeHold.id)} className="btn-primary text-xs">
                Proceed Through Hold
              </button>
            )}
          </div>
          {activeHold.actualStartedAt && (
            <ElapsedIndicator startedAt={activeHold.actualStartedAt} estimatedSeconds={activeHold.estimatedDurationSeconds ?? undefined} />
          )}
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
          <button onClick={() => addHold.mutate()} className="btn-secondary text-xs">
            Add programmed hold
          </button>
        </div>
      )}

      {showCall && (
        <div className="fixed inset-0 z-[2000] flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-md rounded-xl border border-zinc-800 bg-black p-6">
            <h2 className="mb-3 text-lg font-bold">Call Hold</h2>
            <textarea value={callReason} onChange={(e) => setCallReason(e.target.value)} placeholder="Reason (required)" className="input" rows={3} />
            <div className="mt-4 flex justify-end gap-2">
              <button onClick={() => setShowCall(false)} className="btn-secondary">
                Cancel
              </button>
              <button onClick={() => callHoldMutation.mutate()} disabled={!callReason.trim()} className="btn-danger disabled:opacity-50">
                Confirm hold
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}

function ElapsedIndicator({ startedAt, estimatedSeconds }: { startedAt: string; estimatedSeconds?: number }) {
  const [now, setNow] = useState(new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);
  const elapsed = (now.getTime() - new Date(startedAt).getTime()) / 1000;
  const elapsedText = secondsToHms(elapsed);
  const durationElapsed = estimatedSeconds != null && elapsed >= estimatedSeconds;
  return (
    <div className={`mt-1 text-xs ${durationElapsed ? "animate-pulse font-bold text-aat-nogo" : "text-slate-500 dark:text-slate-400"}`}>
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
        <button onClick={() => liftoffMutation.mutate()} disabled={state.tCountStatus === "COMPLETE"} className="btn-primary disabled:opacity-50">
          Establish Actual Launch Time (Mark Liftoff)
        </button>
        <button onClick={() => setShowRevise(true)} className="btn-secondary">
          Select New Time Within Window
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
            <h2 className="mb-3 text-lg font-bold">Select New Time Within Window</h2>
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
  const { isLaunchDirector } = useAuth();
  const generateMutation = useMutation({
    mutationFn: () => generateMilestoneSequence(mission.id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["mission", mission.id] }),
  });
  const updateMutation = useMutation({
    mutationFn: ({ id, status }: { id: string; status: string }) => updateMilestone(mission.id, id, { status }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["mission", mission.id] }),
  });

  const milestones = mission.milestones ?? [];

  return (
    <section className="card p-5">
      <div className="mb-3 flex items-center justify-between">
        <div className="text-xs font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400">Countdown Milestone Sequence</div>
        {isLaunchDirector && milestones.length === 0 && (
          <button onClick={() => generateMutation.mutate()} className="btn-secondary text-xs">
            Generate standard sequence
          </button>
        )}
      </div>
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
    queryFn: () => fetchDocuments({ missionId: mission.id, category: "Launch Countdown Procedure (LCP)" }),
  });

  const uploadMutation = useMutation({
    mutationFn: () => {
      const fd = new FormData();
      fd.append("file", file!);
      fd.append("title", `${mission.vehicle.name} LCP — ${mission.designator}`);
      fd.append("category", "Launch Countdown Procedure (LCP)");
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
