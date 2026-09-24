import React, { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  addDispositionAddendum,
  addLaunchPeriodEntry,
  addLogEntry,
  cancelMission,
  clearPollItemOverride,
  confirmLaunchCountTime,
  fetchLaunchDayNotifications,
  fetchLaunchStatusCheck,
  fetchLotCertification,
  fetchLwccState,
  fetchMission,
  fetchMissionPersonnel,
  fetchNotamStatus,
  fetchPollHistory,
  fetchSiteWeather,
  fileNotam,
  logDisposition,
  postponeMission,
  removeLaunchPeriodEntry,
  removeMission,
  scrubMission,
  setPollItem,
  targetLaunchOpportunity,
  updateLaunchDayNotification,
  updateSiteFacilityContacts,
  uploadDocument,
} from "../api/resources";
import { useAuth } from "../context/AuthContext";
import { usePreferences } from "../context/PreferencesContext";
import { formatTimestamp } from "../utils/time";
import { StatusPill, missionStatusTone, goNoGoTone } from "../components/StatusPill";
import { useMissionSocket } from "../hooks/useSocket";
import { useFullscreenChrome } from "../components/Layout";
import PersistentClockHeader from "../components/PersistentClockHeader";
import CountdownTab from "../components/CountdownTab";
import LwccTab from "../components/LwccTab";
import type { LaunchStatusCheckState, NotificationType, PollBoxRole, Site } from "../types";
import { DISPOSITION_OUTCOMES } from "../types";

const TABS = ["Overview", "Countdown", "Polls", "FAA & NOTAM", "Log", "History", "LWCC"] as const;

export default function MissionDetail() {
  const { missionId } = useParams<{ missionId: string }>();
  const navigate = useNavigate();
  const { useZulu } = usePreferences();
  const qc = useQueryClient();
  const [tab, setTab] = useState<(typeof TABS)[number]>("Overview");
  const [scrubModalOpen, setScrubModalOpen] = useState(false);

  const { data: mission, isLoading } = useQuery({
    queryKey: ["mission", missionId],
    queryFn: () => fetchMission(missionId!),
    enabled: !!missionId,
  });

  useMissionSocket(missionId, () => {
    qc.invalidateQueries({ queryKey: ["mission", missionId] });
    qc.invalidateQueries({ queryKey: ["countdown", missionId] });
    qc.invalidateQueries({ queryKey: ["lwcc", missionId] });
    qc.invalidateQueries({ queryKey: ["notam", missionId] });
    qc.invalidateQueries({ queryKey: ["notifications", missionId] });
  });

  // v7.1 Section 4 - on-demand fullscreen: opt-in every visit, never
  // automatic. Reset on unmount so navigating away (a link, the back
  // button, anything other than the Exit button) always restores chrome
  // for whatever page comes next, rather than leaving it stuck hidden.
  // Called unconditionally, before the loading-state early return below,
  // so this component's hook count never varies between renders.
  const { hideChrome, setHideChrome } = useFullscreenChrome();
  useEffect(() => {
    return () => setHideChrome(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (isLoading || !mission) return <div className="p-8 text-slate-400">Loading mission...</div>;

  const targeted = mission.launchPeriodEntries.find((e) => e.isTargeted);
  const cancelled = mission.status === "CANCELLED";
  const cancelledEvent = mission.historyEvents?.find((e: any) => e.eventType === "CANCELLED");
  const cancelledAt = cancelledEvent?.timestamp;

  return (
    <div className="space-y-6 p-8">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <Link to="/missions" className="text-xs text-aat-accent hover:underline">
            ← Mission Schedule
          </Link>
          <h1 className="mt-1 text-2xl font-bold tracking-tight">{mission.name}</h1>
          <div className="text-sm text-slate-500 dark:text-slate-400">
            {mission.designator} · {mission.vehicle.name} · {mission.site.name}
          </div>
        </div>
        <div className="flex items-center gap-3">
          {!hideChrome && (
            <button onClick={() => setHideChrome(true)} className="btn-secondary text-xs">
              Full Screen
            </button>
          )}
          {hideChrome && (
            <button onClick={() => setHideChrome(false)} className="btn-secondary text-xs">
              Exit Full Screen
            </button>
          )}
          <StatusPill tone={missionStatusTone(mission.status)}>{mission.status.replace("_", " ")}</StatusPill>
        </div>
      </header>

      <PersistentClockHeader mission={mission} />

      <div className="flex flex-wrap gap-1 border-b border-slate-200 dark:border-slate-800">
        {TABS.map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`-mb-px border-b-2 px-4 py-2 text-sm font-medium ${
              tab === t
                ? "border-aat-accent text-aat-accent"
                : "border-transparent text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200"
            }`}
          >
            {t}
          </button>
        ))}
      </div>

      {tab === "Overview" &&
        (cancelled ? (
          <div className="space-y-6">
            <LockdownNotice tabName="Overview" cancelledAt={cancelledAt} useZulu={useZulu} />
            <section className="card max-w-md p-5">
              <div className="mb-2 text-xs font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400">Launch Director Actions</div>
              <ActionButtons mission={mission} missionId={missionId!} onRequestScrub={() => setScrubModalOpen(true)} onRemoved={() => navigate("/missions")} />
            </section>
          </div>
        ) : (
          <OverviewTab mission={mission} missionId={missionId!} useZulu={useZulu} onRequestScrub={() => setScrubModalOpen(true)} />
        ))}
      {tab === "Countdown" &&
        (cancelled ? (
          <LockdownNotice tabName="Countdown" cancelledAt={cancelledAt} useZulu={useZulu} />
        ) : (
          <CountdownTab mission={mission} onRequestScrub={() => setScrubModalOpen(true)} />
        ))}
      {tab === "Polls" && (cancelled ? <LockdownNotice tabName="Polls" cancelledAt={cancelledAt} useZulu={useZulu} /> : <PollsTab mission={mission} missionId={missionId!} />)}
      {tab === "FAA & NOTAM" &&
        (cancelled ? (
          <LockdownNotice tabName="FAA & NOTAM" cancelledAt={cancelledAt} useZulu={useZulu} />
        ) : (
          <FaaTab missionId={missionId!} targeted={targeted} useZulu={useZulu} />
        ))}
      {tab === "Log" && <LogTab mission={mission} missionId={missionId!} useZulu={useZulu} cancelledAt={cancelled ? cancelledAt : undefined} />}
      {tab === "History" && <HistoryTab mission={mission} missionId={missionId!} useZulu={useZulu} cancelledAt={cancelled ? cancelledAt : undefined} />}
      {tab === "LWCC" &&
        (cancelled ? <LockdownNotice tabName="LWCC" cancelledAt={cancelledAt} useZulu={useZulu} /> : <LwccTab missionId={missionId!} site={mission.site} />)}

      {scrubModalOpen && <ScrubModal missionId={missionId!} onClose={() => setScrubModalOpen(false)} />}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Cancellation lockdown (Revision Directive v4.0 Section 1)
// ---------------------------------------------------------------------------

function LockdownNotice({ tabName, cancelledAt, useZulu }: { tabName: string; cancelledAt?: string; useZulu: boolean }) {
  return (
    <div className="card border-aat-nogo/60 bg-aat-nogo/5 p-6 text-center">
      <div className="text-sm font-bold uppercase tracking-wide text-aat-nogo">Mission Cancelled</div>
      <p className="mt-2 text-sm text-slate-300">
        This mission was CANCELLED {cancelledAt ? `on ${formatTimestamp(cancelledAt, useZulu)}` : ""}. The {tabName} services on this tab are
        unavailable for a cancelled mission.
      </p>
    </div>
  );
}

function ReadOnlyBanner({ cancelledAt, useZulu }: { cancelledAt?: string; useZulu: boolean }) {
  return (
    <div className="mb-3 border border-aat-nogo/60 bg-aat-nogo/5 px-3 py-2 text-xs text-slate-300">
      This mission was CANCELLED {cancelledAt ? `on ${formatTimestamp(cancelledAt, useZulu)}` : ""}. This tab is retained for archival purposes
      only and is read-only.
    </div>
  );
}

// ---------------------------------------------------------------------------
// Launch Director actions (Section 3; Remove Mission added by v4.0 Section 1.2)
// ---------------------------------------------------------------------------

function ActionButtons({
  mission,
  missionId,
  onRequestScrub,
  onRemoved,
}: {
  mission: any;
  missionId: string;
  onRequestScrub: () => void;
  onRemoved?: () => void;
}) {
  const { isLaunchDirector } = useAuth();
  const qc = useQueryClient();
  const [modal, setModal] = useState<"postpone" | "cancel1" | "cancel2" | "remove1" | "remove2" | "disposition" | "target" | null>(null);
  const [notes, setNotes] = useState("");
  const [confirmDesignator, setConfirmDesignator] = useState("");
  const [attested, setAttested] = useState(false);

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["mission", missionId] });
    qc.invalidateQueries({ queryKey: ["missions"] });
    qc.invalidateQueries({ queryKey: ["dashboard"] });
    qc.invalidateQueries({ queryKey: ["countdown", missionId] });
  };

  const postpone = useMutation({ mutationFn: () => postponeMission(missionId, notes), onSuccess: () => (invalidate(), close()) });
  const cancel = useMutation({
    mutationFn: () => cancelMission(missionId, notes, confirmDesignator),
    onSuccess: () => (invalidate(), close()),
  });
  const remove = useMutation({
    mutationFn: () => removeMission(missionId, confirmDesignator),
    onSuccess: () => {
      close();
      onRemoved?.();
    },
  });

  function close() {
    setModal(null);
    setNotes("");
    setConfirmDesignator("");
    setAttested(false);
  }

  if (!isLaunchDirector) return null;

  const untargeted = mission.launchPeriodEntries.filter((e: any) => !e.consumed && !e.isTargeted);
  const canTarget = !["CANCELLED", "SUCCESSFUL"].includes(mission.status) && untargeted.length > 0;
  const canPostpone = !["CANCELLED", "SUCCESSFUL"].includes(mission.status);
  const canCancel = !["CANCELLED", "SUCCESSFUL"].includes(mission.status);
  const canScrub = mission.status === "TARGETED";
  const canDisposition = mission.status === "TARGETED";
  const canRemove = mission.status === "CANCELLED";

  return (
    <div className="flex flex-wrap gap-2">
      {canTarget && (
        <button onClick={() => setModal("target")} className="btn-primary">
          Select Target Launch Opportunity
        </button>
      )}
      {canPostpone && (
        <button onClick={() => setModal("postpone")} className="btn-secondary">
          Postpone Indefinitely
        </button>
      )}
      {canCancel && (
        <button onClick={() => setModal("cancel1")} className="btn-danger">
          Cancel
        </button>
      )}
      {canScrub && (
        <button onClick={onRequestScrub} className="btn-danger">
          Scrub
        </button>
      )}
      {canDisposition && (
        <button onClick={() => setModal("disposition")} className="btn-primary">
          Mark Successful / Log Disposition
        </button>
      )}
      {canRemove && (
        <button onClick={() => setModal("remove1")} className="btn-danger">
          Remove Mission
        </button>
      )}

      {modal === "target" && <TargetModal missionId={missionId} entries={untargeted} onClose={close} onDone={invalidate} />}

      {modal === "postpone" && (
        <div className="fixed inset-0 z-[2000] flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-md rounded-xl border border-zinc-800 bg-black p-6">
            <h2 className="mb-1 text-lg font-bold">Postpone Indefinitely</h2>
            <p className="mb-3 text-xs text-slate-500 dark:text-slate-400">
              This voids ALL currently defined Launch Period entries for this mission, not just the targeted one. New windows may be
              added afterward, which returns the mission to Pending Window.
            </p>
            <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} placeholder="Reason / notes" className="input" />
            <div className="mt-4 flex justify-end gap-2">
              <button onClick={close} className="btn-secondary">
                Back
              </button>
              <button onClick={() => postpone.mutate()} disabled={!notes.trim()} className="btn-danger disabled:opacity-50">
                Confirm postpone
              </button>
            </div>
          </div>
        </div>
      )}

      {modal === "cancel1" && (
        <div className="fixed inset-0 z-[2000] flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-md rounded-xl border border-zinc-800 bg-black p-6">
            <h2 className="mb-1 text-lg font-bold text-aat-nogo">Cancel Mission</h2>
            <p className="mb-3 text-xs text-slate-500 dark:text-slate-400">
              This cancels the mission in its entirety, not just the current launch opportunity. This action is{" "}
              <strong>irreversible and irrevocable</strong>.
            </p>
            <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} placeholder="Reason / notes" className="input" />
            <div className="mt-4 flex justify-end gap-2">
              <button onClick={close} className="btn-secondary">
                Back
              </button>
              <button onClick={() => setModal("cancel2")} disabled={!notes.trim()} className="btn-danger disabled:opacity-50">
                Continue
              </button>
            </div>
          </div>
        </div>
      )}

      {modal === "cancel2" && (
        <div className="fixed inset-0 z-[2000] flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-md rounded-xl border border-zinc-800 bg-black p-6">
            <h2 className="mb-1 text-lg font-bold text-aat-nogo">Confirm Cancellation — Irreversible</h2>
            <p className="mb-3 text-sm">
              Type the mission designator <strong className="font-mono">{mission.designator}</strong> to confirm. This cannot be undone.
            </p>
            <input
              value={confirmDesignator}
              onChange={(e) => setConfirmDesignator(e.target.value)}
              placeholder={mission.designator}
              className="input font-mono"
            />
            <div className="mt-4 flex justify-end gap-2">
              <button onClick={close} className="btn-secondary">
                Back
              </button>
              <button
                onClick={() => cancel.mutate()}
                disabled={confirmDesignator.trim().toUpperCase() !== mission.designator.toUpperCase()}
                className="btn-danger disabled:opacity-50"
              >
                CONFIRM CANCELLATION
              </button>
            </div>
            {cancel.isError && <p className="mt-2 text-xs text-aat-nogo">{(cancel.error as any)?.response?.data?.error}</p>}
          </div>
        </div>
      )}

      {modal === "remove1" && (
        <div className="fixed inset-0 z-[2000] flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-lg rounded-xl border border-zinc-800 bg-black p-6">
            <h2 className="mb-1 text-lg font-bold text-aat-nogo">Remove Mission — Permanent Deletion</h2>
            <p className="mb-3 text-xs text-slate-500 dark:text-slate-400">
              This permanently deletes mission <strong className="font-mono">{mission.designator}</strong> and every associated record
              (launch period entries, milestones, holds, LWCC data, log entries, history events, disposition, and documents tagged to this
              mission) from the system. It does not appear anywhere in the application afterward. This is separate from, and does not
              undo, the Cancel action already recorded against this mission.
            </p>
            <label className="flex items-start gap-2 border border-zinc-700 p-3 text-left text-xs text-slate-300">
              <input type="checkbox" checked={attested} onChange={(e) => setAttested(e.target.checked)} className="mt-0.5 shrink-0" />
              <span>
                By proceeding, I attest that this mission record is being permanently removed from the American Aerospace Technologies Corp
                Launch Operations Division system solely for the purpose of correcting a data entry error or performing administrative
                record cleanup, and not to conceal, alter, or misrepresent any launch activity, attempt, or outcome. I understand this
                action is irreversible and will permanently delete this mission and all associated records from the system.
              </span>
            </label>
            <div className="mt-4 flex justify-end gap-2">
              <button onClick={close} className="btn-secondary">
                Back
              </button>
              <button onClick={() => setModal("remove2")} disabled={!attested} className="btn-danger disabled:opacity-50">
                Continue
              </button>
            </div>
          </div>
        </div>
      )}

      {modal === "remove2" && (
        <div className="fixed inset-0 z-[2000] flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-md rounded-xl border border-zinc-800 bg-black p-6">
            <h2 className="mb-1 text-lg font-bold text-aat-nogo">Confirm Removal — Irreversible</h2>
            <p className="mb-3 text-sm">
              Type the mission designator <strong className="font-mono">{mission.designator}</strong> to confirm permanent deletion. This
              cannot be undone.
            </p>
            <input
              value={confirmDesignator}
              onChange={(e) => setConfirmDesignator(e.target.value)}
              placeholder={mission.designator}
              className="input font-mono"
            />
            <div className="mt-4 flex justify-end gap-2">
              <button onClick={close} className="btn-secondary">
                Back
              </button>
              <button
                onClick={() => remove.mutate()}
                disabled={confirmDesignator.trim().toUpperCase() !== mission.designator.toUpperCase() || remove.isPending}
                className="btn-danger disabled:opacity-50"
              >
                CONFIRM PERMANENT REMOVAL
              </button>
            </div>
            {remove.isError && <p className="mt-2 text-xs text-aat-nogo">{(remove.error as any)?.response?.data?.error}</p>}
          </div>
        </div>
      )}

      {modal === "disposition" && <DispositionModal missionId={missionId} onClose={close} onDone={invalidate} />}
    </div>
  );
}

function ScrubModal({ missionId, onClose }: { missionId: string; onClose: () => void }) {
  const qc = useQueryClient();
  const [notes, setNotes] = useState("");
  const [result, setResult] = useState<{ remainingOpportunities: number } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["mission", missionId] });
    qc.invalidateQueries({ queryKey: ["missions"] });
    qc.invalidateQueries({ queryKey: ["dashboard"] });
    qc.invalidateQueries({ queryKey: ["countdown", missionId] });
  };

  const scrub = useMutation({
    mutationFn: () => scrubMission(missionId, notes),
    onSuccess: (data) => {
      invalidate();
      setResult(data);
      setError(null);
    },
    onError: (err: any) => setError(err?.response?.data?.error ?? "Scrub failed"),
  });

  if (result) {
    return (
      <div className="fixed inset-0 z-[2000] flex items-center justify-center bg-black/40 p-4">
        <div className="w-full max-w-md rounded-xl border border-zinc-800 bg-black p-6">
          <h2 className="mb-2 text-lg font-bold">Mission Scrubbed</h2>
          <p className="mb-4 text-sm">
            {result.remainingOpportunities > 0
              ? `${result.remainingOpportunities} launch opportunity(ies) remain in this mission's Launch Period. Select a new target from the Overview tab, or Postpone Indefinitely if none are viable.`
              : "No remaining launch opportunities in this mission's Launch Period. Postpone Indefinitely from the Overview tab, or add new windows first."}
          </p>
          <div className="flex justify-end">
            <button onClick={onClose} className="btn-primary">
              Close
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-[2000] flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-md rounded-xl border border-zinc-800 bg-black p-6">
        <h2 className="mb-1 text-lg font-bold text-aat-nogo">Scrub</h2>
        <p className="mb-3 text-xs text-slate-500 dark:text-slate-400">
          Only available with a confirmed Target Launch Opportunity, on the day of that opportunity.
        </p>
        <select
          onChange={(e) => setNotes(e.target.value)}
          defaultValue=""
          className="input mb-2"
        >
          <option value="" disabled>
            Reason category
          </option>
          <option value="Weather">Weather</option>
          <option value="Vehicle">Vehicle</option>
          <option value="Range">Range</option>
          <option value="Personnel">Personnel</option>
          <option value="Other">Other</option>
        </select>
        <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} placeholder="Reason / notes (required)" className="input" />
        {error && <p className="mt-2 text-xs font-semibold text-aat-nogo">{error}</p>}
        <div className="mt-4 flex justify-end gap-2">
          <button onClick={onClose} className="btn-secondary">
            Back
          </button>
          <button onClick={() => scrub.mutate()} disabled={!notes.trim()} className="btn-danger disabled:opacity-50">
            Confirm scrub
          </button>
        </div>
      </div>
    </div>
  );
}

function TargetModal({ missionId, entries, onClose, onDone }: { missionId: string; entries: any[]; onClose: () => void; onDone: () => void }) {
  const { useZulu } = usePreferences();
  const [selected, setSelected] = useState<string>("");
  const [confirming, setConfirming] = useState(false);
  const mutation = useMutation({
    mutationFn: () => targetLaunchOpportunity(missionId, selected),
    onSuccess: () => {
      onDone();
      onClose();
    },
  });
  const entry = entries.find((e) => e.id === selected);

  return (
    <div className="fixed inset-0 z-[2000] flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-md rounded-xl border border-zinc-800 bg-black p-6">
        <h2 className="mb-3 text-lg font-bold">Select Target Launch Opportunity</h2>
        {!confirming ? (
          <>
            <div className="space-y-2">
              {entries.map((e) => (
                <label
                  key={e.id}
                  className="flex cursor-pointer items-center gap-2 rounded-md border border-slate-200 p-2 text-sm dark:border-slate-700"
                >
                  <input type="radio" name="entry" checked={selected === e.id} onChange={() => setSelected(e.id)} />
                  {formatTimestamp(e.windowOpen, useZulu)} – {formatTimestamp(e.windowClose, useZulu)}
                </label>
              ))}
            </div>
            <div className="mt-4 flex justify-end gap-2">
              <button onClick={onClose} className="btn-secondary">
                Cancel
              </button>
              <button
                onClick={() => setConfirming(true)}
                disabled={!selected}
                className="btn-primary disabled:opacity-50"
              >
                Continue
              </button>
            </div>
          </>
        ) : (
          <>
            <p className="text-sm">
              Mission <strong>{missionId.slice(0, 8)}</strong> will target{" "}
              <strong>
                {formatTimestamp(entry.windowOpen, useZulu)} – {formatTimestamp(entry.windowClose, useZulu)}
              </strong>
              . Confirming will lock in FAA/ATC notification requirements and open the LOT submission gate on the Countdown tab.
            </p>
            <div className="mt-4 flex justify-end gap-2">
              <button onClick={() => setConfirming(false)} className="btn-secondary">
                Back
              </button>
              <button onClick={() => mutation.mutate()} disabled={mutation.isPending} className="btn-primary">
                Confirm Target
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function DispositionModal({ missionId, onClose, onDone }: { missionId: string; onClose: () => void; onDone: () => void }) {
  const [form, setForm] = useState({
    outcome: "Successful",
    actualLiftoffTime: "",
    flightDurationSeconds: "",
    apogeeAltitudeAglMeters: "",
    apogeeAltitudeMslMeters: "",
    maxVelocityMs: "",
    maxAccelerationG: "",
    actualTotalImpulseNs: "",
    recoveryStatus: "",
    payloadOutcome: "",
    anomalySummary: "",
    anomalyReferenceNote: "",
    vehiclePerformanceNotes: "",
    missionNotes: "",
  });
  const [file, setFile] = useState<File | null>(null);

  const mutation = useMutation({
    mutationFn: async () => {
      const numeric = (v: string) => (v ? Number(v) : null);
      await logDisposition(missionId, {
        ...form,
        actualLiftoffTime: form.actualLiftoffTime ? new Date(form.actualLiftoffTime).toISOString() : null,
        flightDurationSeconds: numeric(form.flightDurationSeconds),
        apogeeAltitudeAglMeters: numeric(form.apogeeAltitudeAglMeters),
        apogeeAltitudeMslMeters: numeric(form.apogeeAltitudeMslMeters),
        maxVelocityMs: numeric(form.maxVelocityMs),
        maxAccelerationG: numeric(form.maxAccelerationG),
        actualTotalImpulseNs: numeric(form.actualTotalImpulseNs),
      });
      if (file) {
        const fd = new FormData();
        fd.append("file", file);
        fd.append("title", `Post-Flight Report — ${missionId.slice(0, 8)}`);
        // v4.1 Section 8.1 - "Post-Flight/Anomaly Report" was consolidated
        // out of the category list; no replacement category fits this
        // upload, so it falls back to "Other" like any other removed
        // category, per the migration's own stated safe default.
        fd.append("category", "Other");
        fd.append("missionId", missionId);
        await uploadDocument(fd);
      }
    },
    onSuccess: () => {
      onDone();
      onClose();
    },
  });

  return (
    <div className="fixed inset-0 z-[2000] flex items-center justify-center bg-black/40 p-4">
      <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-xl border border-zinc-800 bg-black p-6">
        <h2 className="mb-4 text-lg font-bold">Flight Disposition</h2>
        <div className="space-y-3">
          <select value={form.outcome} onChange={(e) => setForm({ ...form, outcome: e.target.value })} className="input">
            {DISPOSITION_OUTCOMES.map((o) => (
              <option key={o} value={o}>
                {o}
              </option>
            ))}
          </select>
          <input
            type="datetime-local"
            value={form.actualLiftoffTime}
            onChange={(e) => setForm({ ...form, actualLiftoffTime: e.target.value })}
            className="input"
          />
          <p className="text-[10px] text-slate-400">Leave blank to use the liftoff time established via MARK LIFTOFF on the Countdown tab.</p>
          <input placeholder="Total flight time, burnout → recovery (s)" value={form.flightDurationSeconds} onChange={(e) => setForm({ ...form, flightDurationSeconds: e.target.value })} className="input" />
          <div className="grid grid-cols-2 gap-2">
            <input placeholder="Apogee AGL (m)" value={form.apogeeAltitudeAglMeters} onChange={(e) => setForm({ ...form, apogeeAltitudeAglMeters: e.target.value })} className="input" />
            <input placeholder="Apogee MSL (m)" value={form.apogeeAltitudeMslMeters} onChange={(e) => setForm({ ...form, apogeeAltitudeMslMeters: e.target.value })} className="input" />
            <input placeholder="Max velocity (m/s)" value={form.maxVelocityMs} onChange={(e) => setForm({ ...form, maxVelocityMs: e.target.value })} className="input" />
            <input placeholder="Max accel/Q (G)" value={form.maxAccelerationG} onChange={(e) => setForm({ ...form, maxAccelerationG: e.target.value })} className="input" />
          </div>
          <input placeholder="Actual total impulse, as flown (N·s)" value={form.actualTotalImpulseNs} onChange={(e) => setForm({ ...form, actualTotalImpulseNs: e.target.value })} className="input" />
          <input placeholder="Recovery status / location" value={form.recoveryStatus} onChange={(e) => setForm({ ...form, recoveryStatus: e.target.value })} className="input" />
          <input placeholder="Payload outcome" value={form.payloadOutcome} onChange={(e) => setForm({ ...form, payloadOutcome: e.target.value })} className="input" />
          <textarea placeholder="Anomaly summary" value={form.anomalySummary} onChange={(e) => setForm({ ...form, anomalySummary: e.target.value })} className="input" rows={2} />
          <input placeholder="Anomaly investigation reference (doc/case #)" value={form.anomalyReferenceNote} onChange={(e) => setForm({ ...form, anomalyReferenceNote: e.target.value })} className="input" />
          <textarea placeholder="Vehicle performance notes" value={form.vehiclePerformanceNotes} onChange={(e) => setForm({ ...form, vehiclePerformanceNotes: e.target.value })} className="input" rows={2} />
          <textarea placeholder="General mission notes/summary" value={form.missionNotes} onChange={(e) => setForm({ ...form, missionNotes: e.target.value })} className="input" rows={2} />
          <div>
            <label className="mb-1 block text-[10px] font-semibold uppercase text-slate-400">Post-flight report attachment</label>
            <input type="file" onChange={(e) => setFile(e.target.files?.[0] ?? null)} className="w-full text-xs" />
          </div>
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <button onClick={onClose} className="btn-secondary">
            Cancel
          </button>
          <button onClick={() => mutation.mutate()} className="btn-primary">
            Log Disposition
          </button>
        </div>
      </div>
    </div>
  );
}

function OverviewTab({ mission, missionId, useZulu, onRequestScrub }: any) {
  const { isLaunchDirector } = useAuth();
  const qc = useQueryClient();
  const [newEntry, setNewEntry] = useState({ date: "", windowOpen: "", windowClose: "" });
  const [addendumText, setAddendumText] = useState("");

  // v7.0 Section 7 - the Assigned Personnel box now reflects the
  // Personnel & Stations page's assignments (LD/RC/LWO/VSE), not the
  // pre-existing free-text UserMissionAssignment roster this box used to
  // render statically.
  const { data: personnelState } = useQuery({ queryKey: ["mission-personnel", missionId], queryFn: () => fetchMissionPersonnel(missionId) });

  const addEntry = useMutation({
    mutationFn: () =>
      addLaunchPeriodEntry(missionId, {
        date: new Date(newEntry.date).toISOString(),
        windowOpen: new Date(`${newEntry.date}T${newEntry.windowOpen}:00Z`).toISOString(),
        windowClose: new Date(`${newEntry.date}T${newEntry.windowClose}:00Z`).toISOString(),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["mission", missionId] });
      setNewEntry({ date: "", windowOpen: "", windowClose: "" });
    },
  });
  const removeEntry = useMutation({
    mutationFn: (entryId: string) => removeLaunchPeriodEntry(missionId, entryId),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["mission", missionId] }),
  });
  const addendumMutation = useMutation({
    mutationFn: () => addDispositionAddendum(missionId, addendumText),
    onSuccess: () => {
      setAddendumText("");
      qc.invalidateQueries({ queryKey: ["mission", missionId] });
    },
  });

  const openChecklist = mission.launchDayNotifications?.filter((n: any) => !n.satisfied && !n.notApplicable).length ?? 0;

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
      <div className="space-y-6 lg:col-span-2">
        <section className="card p-5">
          <div className="mb-3 text-xs font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400">Launch Period</div>
          <div className="space-y-2">
            {mission.launchPeriodEntries.map((e: any) => (
              <div
                key={e.id}
                className={`flex items-center justify-between rounded-md border px-3 py-2 text-sm ${
                  e.isTargeted ? "border-aat-accent bg-aat-accent/10" : "border-slate-200 dark:border-slate-800"
                }`}
              >
                <div>
                  {formatTimestamp(e.windowOpen, useZulu)} – {formatTimestamp(e.windowClose, useZulu)}
                  {e.isTargeted && <span className="ml-2 text-xs font-semibold text-aat-accent">TARGETED</span>}
                  {e.consumed && !e.isTargeted && <span className="ml-2 text-xs text-slate-400">used</span>}
                </div>
                {isLaunchDirector && !e.isTargeted && !e.consumed && (
                  <button onClick={() => removeEntry.mutate(e.id)} className="text-xs text-aat-nogo hover:underline">
                    Remove
                  </button>
                )}
              </div>
            ))}
            {mission.launchPeriodEntries.length === 0 && <div className="text-sm text-slate-400">No launch period windows defined.</div>}
          </div>
          {isLaunchDirector && (
            <div className="mt-3 grid grid-cols-4 gap-2">
              <input type="date" value={newEntry.date} onChange={(e) => setNewEntry({ ...newEntry, date: e.target.value })} className="input" />
              <input
                type="time"
                value={newEntry.windowOpen}
                onChange={(e) => setNewEntry({ ...newEntry, windowOpen: e.target.value })}
                className="input"
              />
              <input
                type="time"
                value={newEntry.windowClose}
                onChange={(e) => setNewEntry({ ...newEntry, windowClose: e.target.value })}
                className="input"
              />
              <button
                onClick={() => addEntry.mutate()}
                disabled={!newEntry.date || !newEntry.windowOpen || !newEntry.windowClose}
                className="rounded-md bg-white px-3 py-2 text-xs font-semibold text-black disabled:opacity-50"
              >
                Add window
              </button>
            </div>
          )}
        </section>

        <section className="card p-5">
          <div className="mb-2 text-xs font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400">Launch Director Actions</div>
          <ActionButtons mission={mission} missionId={missionId} onRequestScrub={onRequestScrub} />
        </section>

        {mission.disposition && (
          <section className="card p-5">
            <div className="mb-2 flex items-center justify-between">
              <div className="text-xs font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400">Flight Disposition</div>
              <StatusPill tone={mission.disposition.outcome === "Successful" ? "go" : mission.disposition.outcome === "Failure" ? "nogo" : "caution"}>
                {mission.disposition.outcome}
              </StatusPill>
            </div>
            <div className="grid grid-cols-2 gap-3 text-sm">
              <Field label="Liftoff" value={formatTimestamp(mission.disposition.actualLiftoffTime, useZulu)} />
              <Field label="Flight time" value={mission.disposition.flightDurationSeconds ? `${mission.disposition.flightDurationSeconds} s` : "--"} />
              <Field label="Apogee AGL" value={mission.disposition.apogeeAltitudeAglMeters ? `${mission.disposition.apogeeAltitudeAglMeters} m` : "--"} />
              <Field label="Apogee MSL" value={mission.disposition.apogeeAltitudeMslMeters ? `${mission.disposition.apogeeAltitudeMslMeters} m` : "--"} />
              <Field label="Max velocity" value={mission.disposition.maxVelocityMs ? `${mission.disposition.maxVelocityMs} m/s` : "--"} />
              <Field label="Max accel/Q" value={mission.disposition.maxAccelerationG ? `${mission.disposition.maxAccelerationG} G` : "--"} />
              <Field label="Recovery" value={mission.disposition.recoveryStatus || "--"} />
              <Field label="Payload outcome" value={mission.disposition.payloadOutcome || "--"} />
              <Field label="Anomaly summary" value={mission.disposition.anomalySummary || "--"} span2 />
              <Field label="Mission notes" value={mission.disposition.missionNotes || "--"} span2 />
            </div>
            {mission.disposition.addenda?.length > 0 && (
              <div className="mt-3 space-y-2 border-t border-slate-200 pt-3 dark:border-slate-800">
                <div className="text-[10px] font-semibold uppercase text-slate-400">Addenda</div>
                {mission.disposition.addenda.map((a: any) => (
                  <div key={a.id} className="text-xs">
                    <span className="text-slate-400">[{formatTimestamp(a.timestamp, useZulu)}] {a.author.name}:</span> {a.text}
                  </div>
                ))}
              </div>
            )}
            {isLaunchDirector && (
              <div className="mt-3 flex gap-2 border-t border-slate-200 pt-3 dark:border-slate-800">
                <input value={addendumText} onChange={(e) => setAddendumText(e.target.value)} placeholder="Append correction/addendum" className="input" />
                <button onClick={() => addendumText.trim() && addendumMutation.mutate()} className="btn-secondary text-xs">
                  Add
                </button>
              </div>
            )}
          </section>
        )}
      </div>

      <div className="space-y-6">
        <section className="card p-5">
          <div className="mb-2 text-xs font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400">Vehicle</div>
          <Link to={`/vehicles/${mission.vehicle.id}`} className="font-medium text-aat-accent hover:underline">
            {mission.vehicle.name}
          </Link>
          <div className="mt-1 text-xs text-slate-500 dark:text-slate-400">
            {mission.vehicle.vehicleClass || mission.vehicle.type || ""} {mission.vehicle.motorType ? `· ${mission.vehicle.motorType}` : ""}
          </div>
        </section>
        <section className="card p-5">
          <div className="mb-2 text-xs font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400">Payload</div>
          <p className="text-sm">{mission.payloadDescription || "No payload description on file."}</p>
        </section>
        <section className="card p-5">
          <div className="mb-2 text-xs font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400">Assigned Personnel</div>
          <div className="space-y-1 font-mono text-sm">
            {(["LD", "RC", "LWO", "VSE"] as const).map((role) => {
              const assignment = personnelState?.assignments.find((a: any) => a.role === role);
              return (
                <div key={role} className="flex justify-between">
                  <span>{role}:</span>
                  <span className={assignment ? "" : "text-aat-nogo"}>{assignment ? assignment.userName : "UNASSIGNED"}</span>
                </div>
              );
            })}
          </div>
        </section>
        <section className="card p-5">
          <div className="mb-2 text-xs font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400">Status Summary</div>
          <div className="space-y-1 text-xs">
            <div>LWCC: see LWCC tab</div>
            <div>FAA checklist: {openChecklist > 0 ? `${openChecklist} item(s) outstanding` : "satisfied / not yet applicable"}</div>
            <div>Test Clock: see clock header above</div>
          </div>
        </section>
        <section className="card p-5">
          <div className="mb-2 text-xs font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400">Weather (Site)</div>
          <WeatherSummary siteId={mission.site.id} vehicle={mission.vehicle} />
          <Link to={`/sites/${mission.site.id}`} className="mt-2 inline-block text-xs font-semibold text-aat-accent hover:underline">
            View full site weather →
          </Link>
        </section>
        <section className="card p-5">
          <div className="mb-2 text-xs font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400">Documentation</div>
          <Link to={`/documents?missionId=${missionId}`} className="text-xs font-semibold text-aat-accent hover:underline">
            View linked documents →
          </Link>
        </section>
      </div>
    </div>
  );
}

function WeatherSummary({ siteId, vehicle }: { siteId: string; vehicle: any }) {
  const { data: weather } = useQuery({ queryKey: ["site-weather", siteId], queryFn: () => fetchSiteWeather(siteId), refetchInterval: 5 * 60_000 });
  if (!weather || weather.source === "UNAVAILABLE") return <div className="text-sm text-slate-400">Unavailable</div>;
  const exceeded = vehicle?.windMaxKts != null && weather.windSpeedKts != null && weather.windSpeedKts > vehicle.windMaxKts;
  return (
    <div className="space-y-1 text-sm">
      <div>
        Wind: {weather.windSpeedKts?.toFixed(0) ?? "--"} kt {exceeded && <span className="font-semibold text-aat-nogo">(exceeds limit)</span>}
      </div>
      <div>Ceiling: {weather.cloudCeilingFt?.toFixed(0) ?? "--"} ft</div>
      <div>Temp: {weather.temperatureC?.toFixed(1) ?? "--"} °C</div>
    </div>
  );
}

// v7.1 Section 3 - Launch Status Check, a full rebuild of the Polls tab
// owned by the four required mission roles (v7.0's LD/RC/LWO/VSE
// assignment data). Order top to bottom: VSE, LWO, RC, LD - the higher-
// volume technical checklists first, ending with the LD's final synthesis.
const POLL_BOX_LABELS: Record<PollBoxRole, string> = {
  VSE: "VEHICLE SYSTEMS ENGINEER (VSE)",
  LWO: "LAUNCH WEATHER OFFICER (LWO)",
  RC: "RANGE COORDINATOR (RC)",
  LD: "LAUNCH DIRECTOR (LD)",
};
const STANDARD_OPTIONS = ["UNPOLLED", "GO", "NO_GO", "HOLD"];
const WEATHER_OPTIONS = ["UNPOLLED", "CLEAR", "NOT_CLEAR", "HOLD"];
const RANGE_STATUS_OPTIONS = ["UNPOLLED", "CLEAR_TO_PROCEED", "NOT_CLEAR_TO_PROCEED", "HOLD"];
const FINAL_STATUS_OPTIONS = ["UNPOLLED", "GO_FOR_LAUNCH", "NO_GO", "HOLD"];

function pollColor(status: string) {
  if (["GO", "CLEAR", "CLEAR_TO_PROCEED", "GO_FOR_LAUNCH"].includes(status)) return "border-aat-go text-aat-go";
  if (["NO_GO", "NOT_CLEAR", "NOT_CLEAR_TO_PROCEED"].includes(status)) return "border-aat-nogo text-aat-nogo";
  if (status === "HOLD") return "border-aat-caution text-aat-caution";
  return "border-zinc-700 text-zinc-500";
}

function PollsTab({ mission, missionId }: any) {
  const { user, isAdmin } = useAuth();
  const { useZulu } = usePreferences();
  const qc = useQueryClient();

  const { data: personnelState } = useQuery({ queryKey: ["mission-personnel", missionId], queryFn: () => fetchMissionPersonnel(missionId) });
  const { data: check } = useQuery({
    queryKey: ["launch-status-check", missionId],
    queryFn: () => fetchLaunchStatusCheck(missionId),
    refetchInterval: 15_000,
  });
  const { data: lwcc } = useQuery({ queryKey: ["lwcc", missionId], queryFn: () => fetchLwccState(missionId), refetchInterval: 30_000 });
  const { data: history } = useQuery({ queryKey: ["poll-history", missionId], queryFn: () => fetchPollHistory(missionId) });

  function invalidate() {
    qc.invalidateQueries({ queryKey: ["launch-status-check", missionId] });
    qc.invalidateQueries({ queryKey: ["poll-history", missionId] });
  }
  useMissionSocket(missionId, invalidate);

  const setItemMutation = useMutation({
    mutationFn: ({ key, status }: { key: string; status: string }) => setPollItem(missionId, key, status),
    onSuccess: invalidate,
    onError: (err: any) => alert(err?.response?.data?.error ?? "Failed to update"),
  });

  if (!check || !personnelState) return <div className="p-6 text-slate-400">Loading Launch Status Check...</div>;

  const assignmentFor = (role: PollBoxRole) => personnelState.assignments.find((a: any) => a.role === role) ?? null;
  const itemFor = (key: string) => check.items.find((i) => i.key === key)!;

  const targeted = mission.launchPeriodEntries?.find((e: any) => e.isTargeted);
  const now = Date.now();
  const within24h = targeted
    ? (() => {
        const open = new Date(targeted.windowOpen).getTime();
        const close = new Date(targeted.windowClose).getTime();
        return (open <= now + 24 * 3600 * 1000 && open >= now) || (open <= now && close >= now);
      })()
    : false;

  function boxProps(role: PollBoxRole) {
    const assignment = assignmentFor(role);
    const isOwn = !!user && assignment?.userId === user.id;
    return { assignment, isOwn, canEdit: isOwn };
  }
  const vse = boxProps("VSE");
  const lwo = boxProps("LWO");
  const rc = boxProps("RC");
  const ld = boxProps("LD");

  function row(key: string, box: { canEdit: boolean }, options: string[], affirmativeValue: string) {
    const item = itemFor(key);
    return (
      <PollDropdownRow
        key={key}
        label={item.label}
        status={item.status}
        options={options}
        canEdit={box.canEdit}
        isAdmin={isAdmin}
        affirmativeValue={affirmativeValue}
        onSet={(status) => setItemMutation.mutate({ key, status })}
        updatedByName={item.updatedByName}
        updatedAt={item.updatedAt}
        useZulu={useZulu}
      />
    );
  }

  return (
    <div className="mx-auto max-w-4xl space-y-4">
      <CompletionBanner check={check} useZulu={useZulu} />

      <RoleBoxShell
        boxLabel={POLL_BOX_LABELS.VSE}
        assignmentName={vse.assignment?.userName ?? "UNASSIGNED"}
        isOwn={vse.isOwn}
        indicator={<OnStationIndicator assignment={vse.assignment} within24h={within24h} />}
      >
        <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-zinc-500">Vehicle Systems</div>
        {["VSE_PROPULSION", "VSE_AVIONICS", "VSE_TELEMETRY", "VSE_STAGING", "VSE_RECOVERY"].map((key) => row(key, vse, STANDARD_OPTIONS, "GO"))}
        <div className="mb-1 mt-3 text-[11px] font-semibold uppercase tracking-wide text-zinc-500">Ground Systems</div>
        {["VSE_PAD", "VSE_LCS", "VSE_LOIS"].map((key) => row(key, vse, STANDARD_OPTIONS, "GO"))}
      </RoleBoxShell>

      <RoleBoxShell
        boxLabel={POLL_BOX_LABELS.LWO}
        assignmentName={lwo.assignment?.userName ?? "UNASSIGNED"}
        isOwn={lwo.isOwn}
        indicator={<OnStationIndicator assignment={lwo.assignment} within24h={within24h} />}
      >
        <LwccReadoutRow lwcc={lwcc} />
        {row("LWO_WEATHER", lwo, WEATHER_OPTIONS, "CLEAR")}
      </RoleBoxShell>

      <RoleBoxShell
        boxLabel={POLL_BOX_LABELS.RC}
        assignmentName={rc.assignment?.userName ?? "UNASSIGNED"}
        isOwn={rc.isOwn}
        indicator={<OnStationIndicator assignment={rc.assignment} within24h={within24h} />}
      >
        {row("RC_COMMUNICATIONS", rc, STANDARD_OPTIONS, "GO")}
        {row("RC_OPS_SUPPORT", rc, STANDARD_OPTIONS, "GO")}
        <AirspaceRow item={itemFor("RC_AIRSPACE")} checklist={check.airspaceChecklist} isAdmin={isAdmin} missionId={missionId} onChanged={invalidate} />
        {row("RC_RANGE_STATUS", rc, RANGE_STATUS_OPTIONS, "CLEAR_TO_PROCEED")}
      </RoleBoxShell>

      <RoleBoxShell
        boxLabel={POLL_BOX_LABELS.LD}
        assignmentName={ld.assignment?.userName ?? "UNASSIGNED"}
        isOwn={ld.isOwn}
        indicator={<OnStationIndicator assignment={ld.assignment} within24h={within24h} />}
      >
        {row("LD_FINAL_LAUNCH_STATUS", ld, FINAL_STATUS_OPTIONS, "GO_FOR_LAUNCH")}
        <LaunchCountTimeBlock missionId={missionId} check={check} canEdit={ld.canEdit} isAdmin={isAdmin} useZulu={useZulu} onChanged={invalidate} />
      </RoleBoxShell>

      <PollHistoryPanel history={history} useZulu={useZulu} />
    </div>
  );
}

// Section 3.2 - on-station status indicator: green (on station, regardless
// of window proximity), blinking orange (not on station, within 24h of the
// Targeted Launch Opportunity), or grayed "NOT ON STATION" (not on
// station, more than 24h out or no TLO confirmed).
function OnStationIndicator({ assignment, within24h }: { assignment: any; within24h: boolean }) {
  const [blinkOn, setBlinkOn] = useState(true);
  const onStation = !!assignment?.onStationAt;
  const shouldBlink = !onStation && within24h;

  useEffect(() => {
    if (!shouldBlink) return;
    const t = setInterval(() => setBlinkOn((b) => !b), 800);
    return () => clearInterval(t);
  }, [shouldBlink]);

  if (onStation) return <span className="status-pill status-go">ON STATION</span>;
  if (shouldBlink) return <span className={`status-pill ${blinkOn ? "status-caution" : "status-neutral"}`}>NOT ON STATION</span>;
  return <span className="status-pill status-neutral">NOT ON STATION</span>;
}

// Section 3.7 - the box is outlined in the accent color when the viewer is
// its assigned holder; individual controls inside are gated separately
// (grayed/disabled for everyone else, per PollDropdownRow below).
function RoleBoxShell({
  boxLabel,
  assignmentName,
  isOwn,
  indicator,
  children,
}: {
  boxLabel: string;
  assignmentName: string;
  isOwn: boolean;
  indicator: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className={`card p-5 ${isOwn ? "border-2 border-aat-accent" : ""}`}>
      <div className="mb-3 flex items-center justify-between">
        <div>
          <div className="text-sm font-bold uppercase tracking-wide">{boxLabel}</div>
          <div className={`text-xs ${assignmentName === "UNASSIGNED" ? "text-aat-nogo" : "text-zinc-500"}`}>{assignmentName}</div>
        </div>
        {indicator}
      </div>
      <div className="space-y-2">{children}</div>
    </section>
  );
}

// A normal 4(or fewer)-state dropdown, usable only by the box's assigned
// holder; Admin gets a separate one-click "Override" control beside it
// (Section 3.7) that forces the item to its GO/proceed/clear equivalent,
// bypassing the assigned-person-only restriction - logged server-side as
// an override whenever the actor isn't the assigned holder.
function PollDropdownRow({
  label,
  status,
  options,
  canEdit,
  isAdmin,
  affirmativeValue,
  onSet,
  updatedByName,
  updatedAt,
  useZulu,
}: {
  label: string;
  status: string;
  options: string[];
  canEdit: boolean;
  isAdmin: boolean;
  affirmativeValue: string;
  onSet: (status: string) => void;
  updatedByName: string | null;
  updatedAt: string | null;
  useZulu: boolean;
}) {
  return (
    <div className="border border-zinc-800 px-3 py-2 text-sm">
      <div className="flex items-center justify-between">
        <span>{label}</span>
        <div className="flex items-center gap-2">
          <select
            value={status}
            disabled={!canEdit}
            onChange={(e) => onSet(e.target.value)}
            className={`input w-auto py-1 text-xs disabled:opacity-40 ${pollColor(status)}`}
          >
            {options.map((o) => (
              <option key={o} value={o}>
                {o.replace(/_/g, " ")}
              </option>
            ))}
          </select>
          {isAdmin && (
            <button onClick={() => onSet(affirmativeValue)} className="text-[10px] font-semibold text-aat-caution hover:underline" title="Admin override">
              Override
            </button>
          )}
        </div>
      </div>
      {updatedByName && (
        <div className="mt-0.5 text-[10px] text-zinc-600">
          Last set by {updatedByName}
          {updatedAt ? `, ${formatTimestamp(updatedAt, useZulu)}` : ""}
        </div>
      )}
    </div>
  );
}

// Section 3.4 - a live, read-only readout of the LWCC banner (Section
// 7.1/v3.0, as corrected by later revisions) - never a separately-set
// manual value, and matches that banner's own NO VIOLATION/VIOLATION
// format and violation enumeration exactly.
function LwccReadoutRow({ lwcc }: { lwcc: any }) {
  if (!lwcc) return <div className="border border-zinc-800 px-3 py-2 text-sm text-zinc-500">Loading LWCC status...</div>;
  return (
    <div className="border border-zinc-800 px-3 py-2 text-sm">
      <div className="flex items-center justify-between">
        <span>LWCC</span>
        <span className={`status-pill ${lwcc.bannerStatus === "VIOLATION" ? "status-nogo" : "status-go"}`}>{lwcc.bannerStatus.replace("_", " ")}</span>
      </div>
      {lwcc.bannerStatus === "VIOLATION" && (
        <ul className="mt-1 space-y-0.5 text-[11px] text-zinc-400">
          {lwcc.violatingRows.map((r: any) => (
            <li key={r.no} className="font-mono">
              — LWCCR {r.no} ({r.description}){r.currentValue != null ? ` — CURRENT: ${r.currentValue.toFixed(1)}` : ""}
            </li>
          ))}
        </ul>
      )}
      <div className="mt-0.5 text-[10px] text-zinc-600">Live readout from the LWCC tab — not independently editable here.</div>
    </div>
  );
}

// Section 3.5 - Airspace is computed (UNPOLLED more than 24h out; GO once
// the NOTAM/T-60/T-15 checklist is complete within 24h, NO-GO otherwise -
// Termination is deliberately excluded). No one "sets" it normally; an
// Admin override is the only way to force a value, and it persists until
// cleared (reverting to the live-computed value).
function AirspaceRow({
  item,
  checklist,
  isAdmin,
  missionId,
  onChanged,
}: {
  item: { status: string; isOverridden: boolean };
  checklist: { notamFiled: boolean; t60Complete: boolean; t15Complete: boolean };
  isAdmin: boolean;
  missionId: string;
  onChanged: () => void;
}) {
  const setMutation = useMutation({ mutationFn: (status: string) => setPollItem(missionId, "RC_AIRSPACE", status), onSuccess: onChanged });
  const clearMutation = useMutation({ mutationFn: () => clearPollItemOverride(missionId, "RC_AIRSPACE"), onSuccess: onChanged });

  return (
    <div className="border border-zinc-800 px-3 py-2 text-sm">
      <div className="flex items-center justify-between">
        <span>Airspace</span>
        <div className="flex items-center gap-2">
          <span className={`border px-2 py-0.5 text-xs font-semibold ${pollColor(item.status)}`}>{item.status.replace(/_/g, " ")}</span>
          {item.isOverridden && <span className="text-[10px] text-aat-caution">(OVERRIDDEN)</span>}
          {isAdmin && !item.isOverridden && (
            <button onClick={() => setMutation.mutate("GO")} className="text-[10px] font-semibold text-aat-caution hover:underline">
              Override → GO
            </button>
          )}
          {isAdmin && item.isOverridden && (
            <button onClick={() => clearMutation.mutate()} className="text-[10px] text-zinc-400 hover:underline">
              Clear Override
            </button>
          )}
        </div>
      </div>
      <div className="mt-1 text-[10px] text-zinc-600">
        Computed: NOTAM {checklist.notamFiled ? "FILED" : "NOT FILED"} · T-60 {checklist.t60Complete ? "COMPLETE" : "PENDING"} · T-15{" "}
        {checklist.t15Complete ? "COMPLETE" : "PENDING"}
      </div>
    </div>
  );
}

// Section 3.6 - the LD's callout-and-readback confirmation of the Launch
// Clock's current projected liftoff time. A mismatch is rejected outright
// and blocks completion; a match, combined with Final Launch Status
// reading GO FOR LAUNCH, is what completes the check (Section 3.8).
function LaunchCountTimeBlock({
  missionId,
  check,
  canEdit,
  isAdmin,
  useZulu,
  onChanged,
}: {
  missionId: string;
  check: LaunchStatusCheckState;
  canEdit: boolean;
  isAdmin: boolean;
  useZulu: boolean;
  onChanged: () => void;
}) {
  const [entered, setEntered] = useState("");
  const [error, setError] = useState<string | null>(null);
  const mutation = useMutation({
    mutationFn: () => confirmLaunchCountTime(missionId, entered),
    onSuccess: () => {
      setError(null);
      setEntered("");
      onChanged();
    },
    onError: (err: any) => setError(err?.response?.data?.error ?? "Confirmation failed"),
  });
  const disabled = !canEdit && !isAdmin;

  return (
    <div className="border border-zinc-800 p-3">
      <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-zinc-500">Launch Count Time Confirmation</div>
      <div className="mb-2 text-xs text-zinc-400">
        Launch Clock projected liftoff:{" "}
        <span className="font-mono text-zinc-200">
          {check.launchCountTime.projectedLiftoff ? formatTimestamp(check.launchCountTime.projectedLiftoff, true) : "--"}
        </span>
      </div>
      {check.launchCountTime.confirmed ? (
        <div className="text-xs font-semibold text-aat-go">
          CONFIRMED by {check.launchCountTime.confirmedByName}
          {check.launchCountTime.confirmedAt ? `, ${formatTimestamp(check.launchCountTime.confirmedAt, useZulu)}` : ""}
        </div>
      ) : (
        <div className="flex items-center gap-2">
          <input
            value={entered}
            onChange={(e) => setEntered(e.target.value)}
            placeholder="HHMM Zulu"
            disabled={disabled}
            className="input w-32 py-1 text-xs disabled:opacity-40"
          />
          <button
            onClick={() => mutation.mutate()}
            disabled={disabled || !entered.trim() || mutation.isPending}
            className="btn-secondary px-2 py-1 text-xs disabled:opacity-40"
          >
            {mutation.isPending ? "Confirming..." : "Confirm"}
          </button>
        </div>
      )}
      {error && <p className="mt-1 text-[11px] text-aat-nogo">{error}</p>}
    </div>
  );
}

// Section 3.8 - the single completion banner above the four role boxes.
function CompletionBanner({ check, useZulu }: { check: LaunchStatusCheckState; useZulu: boolean }) {
  if (check.completion.isGo && check.completion.completedAt) {
    return (
      <div className="card border-2 border-aat-go bg-aat-go/10 p-4 text-center text-sm font-bold uppercase tracking-wide text-aat-go">
        LAUNCH STATUS CHECK: GO — LSC COMPLETED AT {formatTimestamp(check.completion.completedAt, useZulu)} — PROCEEDING WITH TERMINAL COUNT UPON
        PROGRAMMED LSC HOLD RELEASE
      </div>
    );
  }
  return (
    <div className="card border border-zinc-700 p-4 text-center text-sm font-bold uppercase tracking-wide text-zinc-400">
      LAUNCH STATUS CHECK: IN PROGRESS — NOT YET COMPLETE
    </div>
  );
}

function PollHistoryPanel({ history, useZulu }: { history: any; useZulu: boolean }) {
  return (
    <section className="card p-5">
      <div className="mb-3 text-sm font-bold uppercase tracking-wide text-zinc-300">Launch Status Check Activity Log</div>
      {!history?.length ? (
        <p className="text-sm text-zinc-500">No poll activity on file for this mission.</p>
      ) : (
        <div className="max-h-72 overflow-y-auto">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="border-b border-zinc-800 text-zinc-500">
                <th className="py-1.5 pr-4">When</th>
                <th className="py-1.5 pr-4">Item</th>
                <th className="py-1.5 pr-4">Previous</th>
                <th className="py-1.5 pr-4">New</th>
                <th className="py-1.5 pr-4">By</th>
                <th className="py-1.5 pr-4">Override?</th>
              </tr>
            </thead>
            <tbody className="font-mono">
              {history.map((h: any) => (
                <tr key={h.id} className="border-b border-zinc-900">
                  <td className="py-1.5 pr-4">{formatTimestamp(h.timestamp, useZulu)}</td>
                  <td className="py-1.5 pr-4 font-sans uppercase">{h.itemKey.replace(/_/g, " ")}</td>
                  <td className="py-1.5 pr-4">{h.previousValue ?? "--"}</td>
                  <td className="py-1.5 pr-4">{h.newValue}</td>
                  <td className="py-1.5 pr-4">{h.actorName}</td>
                  <td className="py-1.5 pr-4 font-sans">{h.isOverride ? <span className="text-aat-caution">YES</span> : "No"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

const NOTIFICATION_LABELS: Record<NotificationType, string> = {
  T_MINUS_60: "T-60 min: ARTCC / local facility advisory",
  T_MINUS_15: "T-15 min: ARTCC / local facility confirmation",
  TERMINATION: "Termination: airspace clear confirmation",
};

// v5.0 Section 5 - was "Facility Cross-Reference": read-only, populated only
// for whichever mission happened to have seed data, and hidden entirely for
// every other mission (the box only rendered when TRACON/ARTCC data was
// already present). This data belongs to the site, not the mission (so
// entering it once covers every mission at that site), and is now always
// visible with inline view/edit/delete for TRACON, ARTCC, and Other.
function FacilityNotificationContactsBox({ site }: { site: Site }) {
  const qc = useQueryClient();
  const { isLaunchDirector } = useAuth();
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState({
    traconFacilityName: site.traconFacilityName ?? "",
    traconPhone: site.traconPhone ?? "",
    artccFacilityName: site.artccFacilityName ?? "",
    artccPhone: site.artccPhone ?? "",
    otherFacilityName: site.otherFacilityName ?? "",
    otherFacilityPhone: site.otherFacilityPhone ?? "",
    otherFacilityNotApplicable: site.otherFacilityNotApplicable ?? false,
  });

  const mutation = useMutation({
    mutationFn: () => updateSiteFacilityContacts(site.id, form as any),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["mission"] });
      qc.invalidateQueries({ queryKey: ["sites"] });
      qc.invalidateQueries({ queryKey: ["site", site.id] });
      setEditing(false);
    },
  });

  function startEditing() {
    setForm({
      traconFacilityName: site.traconFacilityName ?? "",
      traconPhone: site.traconPhone ?? "",
      artccFacilityName: site.artccFacilityName ?? "",
      artccPhone: site.artccPhone ?? "",
      otherFacilityName: site.otherFacilityName ?? "",
      otherFacilityPhone: site.otherFacilityPhone ?? "",
      otherFacilityNotApplicable: site.otherFacilityNotApplicable ?? false,
    });
    setEditing(true);
  }

  function clearContact(prefix: "tracon" | "artcc" | "other") {
    if (prefix === "tracon") setForm({ ...form, traconFacilityName: "", traconPhone: "" });
    else if (prefix === "artcc") setForm({ ...form, artccFacilityName: "", artccPhone: "" });
    else setForm({ ...form, otherFacilityName: "", otherFacilityPhone: "" });
  }

  return (
    <section className="card p-5 lg:col-span-2">
      <div className="mb-2 flex items-center justify-between">
        <div className="text-xs font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400">Facility Notification Contacts</div>
        {isLaunchDirector && !editing && (
          <button onClick={startEditing} className="text-xs font-semibold text-aat-accent hover:underline">
            Edit
          </button>
        )}
      </div>

      {!editing ? (
        <div className="grid grid-cols-3 gap-3 text-sm">
          <Field label="TRACON" value={site.traconFacilityName ? `${site.traconFacilityName}${site.traconPhone ? ` — ${site.traconPhone}` : ""}` : "--"} />
          <Field label="ARTCC" value={site.artccFacilityName ? `${site.artccFacilityName}${site.artccPhone ? ` — ${site.artccPhone}` : ""}` : "--"} />
          <Field
            label="Other"
            value={
              site.otherFacilityNotApplicable
                ? "N/A"
                : site.otherFacilityName
                  ? `${site.otherFacilityName}${site.otherFacilityPhone ? ` — ${site.otherFacilityPhone}` : ""}`
                  : "--"
            }
          />
        </div>
      ) : (
        <div className="space-y-3">
          <div className="grid grid-cols-3 gap-3">
            {(
              [
                ["tracon", "TRACON", "traconFacilityName", "traconPhone"],
                ["artcc", "ARTCC", "artccFacilityName", "artccPhone"],
              ] as const
            ).map(([prefix, label, nameKey, phoneKey]) => (
              <div key={prefix} className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">{label}</div>
                  {(form[nameKey] || form[phoneKey]) && (
                    <button onClick={() => clearContact(prefix)} className="text-[10px] font-semibold text-aat-nogo hover:underline">
                      Delete
                    </button>
                  )}
                </div>
                <input
                  placeholder="Facility name"
                  value={form[nameKey]}
                  onChange={(e) => setForm({ ...form, [nameKey]: e.target.value })}
                  className="input"
                />
                <input
                  placeholder="Phone number"
                  value={form[phoneKey]}
                  onChange={(e) => setForm({ ...form, [phoneKey]: e.target.value })}
                  className="input"
                />
              </div>
            ))}
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">Other</div>
                {(form.otherFacilityName || form.otherFacilityPhone) && (
                  <button onClick={() => clearContact("other")} className="text-[10px] font-semibold text-aat-nogo hover:underline">
                    Delete
                  </button>
                )}
              </div>
              <input
                placeholder="Facility name"
                value={form.otherFacilityName}
                onChange={(e) => setForm({ ...form, otherFacilityName: e.target.value })}
                disabled={form.otherFacilityNotApplicable}
                className="input disabled:opacity-40"
              />
              <input
                placeholder="Phone number"
                value={form.otherFacilityPhone}
                onChange={(e) => setForm({ ...form, otherFacilityPhone: e.target.value })}
                disabled={form.otherFacilityNotApplicable}
                className="input disabled:opacity-40"
              />
              <label className="flex items-center gap-1.5 text-[11px] text-slate-400">
                <input
                  type="checkbox"
                  checked={form.otherFacilityNotApplicable}
                  onChange={(e) => setForm({ ...form, otherFacilityNotApplicable: e.target.checked })}
                />
                Not applicable
              </label>
            </div>
          </div>
          <div className="flex justify-end gap-2">
            <button onClick={() => setEditing(false)} className="btn-secondary">
              Cancel
            </button>
            <button onClick={() => mutation.mutate()} disabled={mutation.isPending} className="btn-primary disabled:opacity-50">
              Save
            </button>
          </div>
        </div>
      )}
    </section>
  );
}

function FaaTab({ missionId, targeted, useZulu }: { missionId: string; targeted: any; useZulu: boolean }) {
  const { isLaunchDirector } = useAuth();
  const qc = useQueryClient();
  const { data: notam } = useQuery({ queryKey: ["notam", missionId], queryFn: () => fetchNotamStatus(missionId) });
  const { data: notifications } = useQuery({ queryKey: ["notifications", missionId], queryFn: () => fetchLaunchDayNotifications(missionId) });
  const { data: mission } = useQuery({ queryKey: ["mission", missionId], queryFn: () => fetchMission(missionId) });
  const [notamForm, setNotamForm] = useState({ leidosConfirmationNumber: "", notamWindowOpen: "", notamWindowClose: "" });
  // v5.0 Item 6 - Log NOTAM Filing requires a confirmation step, and must
  // validate required fields aren't blank before that confirmation can proceed.
  const [confirmingNotam, setConfirmingNotam] = useState(false);
  const notamFormValid = Boolean(
    notamForm.leidosConfirmationNumber.trim() && notamForm.notamWindowOpen && notamForm.notamWindowClose
  );

  const fileNotamMutation = useMutation({
    mutationFn: () =>
      fileNotam(missionId, {
        filedDate: new Date().toISOString(),
        leidosConfirmationNumber: notamForm.leidosConfirmationNumber,
        notamWindowOpen: new Date(notamForm.notamWindowOpen).toISOString(),
        notamWindowClose: new Date(notamForm.notamWindowClose).toISOString(),
      }),
    onSuccess: () => {
      setConfirmingNotam(false);
      setNotamForm({ leidosConfirmationNumber: "", notamWindowOpen: "", notamWindowClose: "" });
      qc.invalidateQueries({ queryKey: ["notam", missionId] });
    },
  });

  const isTargetedToday = targeted && new Date(targeted.date).toDateString() === new Date().toDateString();
  const site = mission?.site;

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
      {site && <FacilityNotificationContactsBox site={site} />}

      <section className="card p-5">
        <div className="mb-2 flex items-center justify-between">
          <div className="text-xs font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400">
            Weekly Advance Notice (Leidos / NOTAM) — 14 CFR Part 101
          </div>
          <StatusPill tone={notam?.status === "FILED" ? "go" : notam?.status === "OVERDUE" ? "nogo" : "caution"}>
            {notam?.status?.replace("_", " ") ?? "--"}
          </StatusPill>
        </div>
        {notam?.filings?.length ? (
          <div className="space-y-2">
            {notam.filings.map((f: any) => (
              <div key={f.id} className="rounded-md border border-slate-200 p-2 text-xs dark:border-slate-800">
                Filed {formatTimestamp(f.filedDate, useZulu)} · Ref: {f.leidosConfirmationNumber || "--"} · NOTAM window{" "}
                {formatTimestamp(f.notamWindowOpen, useZulu)} – {formatTimestamp(f.notamWindowClose, useZulu)}
              </div>
            ))}
          </div>
        ) : (
          <p className="text-sm text-slate-500 dark:text-slate-400">Not yet filed.</p>
        )}
        {isLaunchDirector && !confirmingNotam && (
          <div className="mt-3 space-y-2">
            <input
              placeholder="Leidos confirmation number"
              value={notamForm.leidosConfirmationNumber}
              onChange={(e) => setNotamForm({ ...notamForm, leidosConfirmationNumber: e.target.value })}
              className="input"
            />
            <div className="grid grid-cols-2 gap-2">
              <input
                type="datetime-local"
                value={notamForm.notamWindowOpen}
                onChange={(e) => setNotamForm({ ...notamForm, notamWindowOpen: e.target.value })}
                className="input"
              />
              <input
                type="datetime-local"
                value={notamForm.notamWindowClose}
                onChange={(e) => setNotamForm({ ...notamForm, notamWindowClose: e.target.value })}
                className="input"
              />
            </div>
            {!notamFormValid && (
              <p className="text-xs text-aat-nogo">
                Confirmation number and both NOTAM window fields are required before filing can be logged.
              </p>
            )}
            <button
              onClick={() => setConfirmingNotam(true)}
              disabled={!notamFormValid}
              className="rounded-md bg-white px-3 py-2 text-xs font-semibold text-black disabled:opacity-40"
            >
              Log NOTAM Filing
            </button>
          </div>
        )}
        {isLaunchDirector && confirmingNotam && (
          <div className="mt-3 space-y-2 rounded-md border border-slate-300 bg-slate-50 p-3 dark:border-slate-700 dark:bg-slate-900">
            <p className="text-xs">
              Confirm NOTAM filing — Ref: <strong>{notamForm.leidosConfirmationNumber}</strong>, window{" "}
              <strong>{formatTimestamp(new Date(notamForm.notamWindowOpen).toISOString(), useZulu)}</strong> –{" "}
              <strong>{formatTimestamp(new Date(notamForm.notamWindowClose).toISOString(), useZulu)}</strong>.
            </p>
            <div className="flex gap-2">
              <button onClick={() => setConfirmingNotam(false)} className="btn-secondary px-3 py-1.5 text-xs">
                Back
              </button>
              <button
                onClick={() => fileNotamMutation.mutate()}
                disabled={fileNotamMutation.isPending}
                className="rounded-md bg-white px-3 py-2 text-xs font-semibold text-black disabled:opacity-50"
              >
                Confirm Log NOTAM Filing
              </button>
            </div>
          </div>
        )}
      </section>

      <section className={`card p-5 ${isTargetedToday ? "border-aat-caution" : ""}`}>
        <div className="mb-2 text-xs font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400">Launch Day Notification Checklist</div>
        {!isTargetedToday && <p className="mb-2 text-xs text-slate-400">Activates on the day of the targeted launch opportunity.</p>}
        <div className="space-y-3">
          {notifications?.map((n: any) => (
            <ChecklistItem key={n.id} missionId={missionId} item={n} isLaunchDirector={isLaunchDirector} useZulu={useZulu} />
          ))}
        </div>
      </section>
    </div>
  );
}

function ChecklistItem({ missionId, item, isLaunchDirector, useZulu }: any) {
  const qc = useQueryClient();
  const [facility, setFacility] = useState(item.contactedFacility || "");
  const [notes, setNotes] = useState(item.notes || "");
  // v5.0 Item 6 - Log completion requires a confirmation step before it
  // submits; Mark not applicable is explicitly unchanged per the directive.
  const [confirming, setConfirming] = useState(false);
  const mutation = useMutation({
    mutationFn: (data: any) => updateLaunchDayNotification(missionId, item.notificationType, data),
    onSuccess: () => {
      setConfirming(false);
      qc.invalidateQueries({ queryKey: ["notifications", missionId] });
    },
  });

  const done = item.satisfied || item.notApplicable;
  const label = NOTIFICATION_LABELS[item.notificationType as NotificationType];

  return (
    <div className={`rounded-md border p-3 text-sm ${done ? "border-aat-go/50 bg-aat-go/5" : "border-slate-200 dark:border-slate-800"}`}>
      <div className="flex items-center justify-between">
        <span className="font-medium">{label}</span>
        {done ? (
          <StatusPill tone="go">{item.notApplicable ? "N/A" : "Satisfied"}</StatusPill>
        ) : (
          <StatusPill tone="caution">Open</StatusPill>
        )}
      </div>
      {done && item.timestamp && (
        <div className="mt-1 text-xs text-slate-500 dark:text-slate-400">
          {formatTimestamp(item.timestamp, useZulu)} by {item.contactedBy?.name} — {item.contactedFacility}
          {item.notes ? ` · ${item.notes}` : ""}
        </div>
      )}
      {!done && isLaunchDirector && !confirming && (
        <div className="mt-2 space-y-2">
          <input placeholder="Contacted facility" value={facility} onChange={(e) => setFacility(e.target.value)} className="input" />
          <input placeholder="Notes / confirmation" value={notes} onChange={(e) => setNotes(e.target.value)} className="input" />
          <div className="flex gap-2">
            <button onClick={() => setConfirming(true)} className="rounded-md bg-aat-go px-3 py-1.5 text-xs font-semibold text-white">
              Log completion
            </button>
            <button
              onClick={() => mutation.mutate({ notApplicable: true, notes })}
              className="rounded-md border border-slate-300 px-3 py-1.5 text-xs dark:border-slate-700"
            >
              Mark not applicable
            </button>
          </div>
        </div>
      )}
      {!done && isLaunchDirector && confirming && (
        <div className="mt-2 space-y-2 rounded-md border border-aat-go/40 bg-aat-go/5 p-2">
          <p className="text-xs">
            Confirm completion of <strong>{label}</strong>
            {facility ? (
              <>
                {" "}
                — contacted <strong>{facility}</strong>
              </>
            ) : (
              " with no contacted facility recorded"
            )}
            {notes ? ` (${notes})` : ""}.
          </p>
          <div className="flex gap-2">
            <button onClick={() => setConfirming(false)} className="btn-secondary px-3 py-1.5 text-xs">
              Back
            </button>
            <button
              onClick={() => mutation.mutate({ satisfied: true, contactedFacility: facility, notes })}
              disabled={mutation.isPending}
              className="rounded-md bg-aat-go px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50"
            >
              Confirm Log Completion
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function LogTab({ mission, missionId, useZulu, cancelledAt }: any) {
  const qc = useQueryClient();
  const [text, setText] = useState("");
  const mutation = useMutation({
    mutationFn: () => addLogEntry(missionId, text),
    onSuccess: () => {
      setText("");
      qc.invalidateQueries({ queryKey: ["mission", missionId] });
    },
  });
  const readOnly = !!cancelledAt || mission.status === "CANCELLED";

  return (
    <div className="card mx-auto max-w-3xl p-5">
      {readOnly && <ReadOnlyBanner cancelledAt={cancelledAt} useZulu={useZulu} />}
      <div className="mb-3 text-xs font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400">Mission Log</div>
      {!readOnly && (
        <div className="flex gap-2">
          <input
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && text.trim() && mutation.mutate()}
            placeholder="Log entry..."
            className="input"
          />
          <button
            onClick={() => text.trim() && mutation.mutate()}
            className="shrink-0 rounded-md bg-white px-4 py-2 text-sm font-semibold text-black"
          >
            Log
          </button>
        </div>
      )}
      <div className="mt-4 space-y-2 font-mono text-xs">
        {mission.logEntries?.map((entry: any) => (
          <div key={entry.id} className="border-b border-slate-100 pb-2 dark:border-slate-800">
            <span className="text-slate-400">[{formatTimestamp(entry.timestamp, useZulu)}]</span> <span className="font-semibold">{entry.author.name}:</span>{" "}
            {entry.text}
          </div>
        ))}
      </div>
    </div>
  );
}

function HistoryTab({ mission, missionId, useZulu, cancelledAt }: any) {
  const { data: certification } = useQuery({
    queryKey: ["lotCertification", missionId],
    queryFn: () => fetchLotCertification(missionId),
  });

  return (
    <div className="card mx-auto max-w-3xl space-y-6 p-5">
      {(cancelledAt || mission.status === "CANCELLED") && <ReadOnlyBanner cancelledAt={cancelledAt} useZulu={useZulu} />}

      {certification && (
        <div>
          <div className="mb-2 text-xs font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400">
            LOT Certification of Record (v5.0 Section 7.4)
          </div>
          <div className="rounded-md border border-slate-200 p-3 text-sm dark:border-slate-800">
            <div className="mb-2 grid grid-cols-2 gap-2 text-xs">
              <Field label="CoMR Document" value={certification.comrDocument?.title ?? "--"} />
              <Field
                label="CoFR Basis"
                value={certification.cofrBasis === "APPROVED_ON_FILE" ? "Approved & on file at submission" : "To be filed within 24h of LOT"}
              />
            </div>
            <div className="mb-2 text-xs text-slate-500 dark:text-slate-400">
              Digitally signed by <strong>{certification.signatureName}</strong> ({certification.signatureRole}) —{" "}
              {formatTimestamp(certification.signedAt, useZulu)}
            </div>
            {certification.cofrGateLapsedAt && (
              <div className="mb-2 rounded-md border border-aat-nogo/40 bg-aat-nogo/5 p-2 text-xs">
                CoFR compliance deadline lapsed {formatTimestamp(certification.cofrGateLapsedAt, useZulu)}.{" "}
                {certification.cofrGateResolvedAt
                  ? `Resolved ${formatTimestamp(certification.cofrGateResolvedAt, useZulu)} by ${certification.cofrGateResolvedBy?.name ?? "--"}.`
                  : "Unresolved — T-Count remains blocked."}
              </div>
            )}
            <details className="mt-2">
              <summary className="cursor-pointer text-xs font-semibold text-aat-accent">View all 8 certification statements as affirmed</summary>
              <ol className="mt-2 space-y-2 text-xs text-slate-600 dark:text-slate-300">
                {certification.certifications.map((c: any) => (
                  <li key={c.no}>
                    <strong>{c.no}.</strong> {c.text}
                  </li>
                ))}
              </ol>
            </details>
          </div>
        </div>
      )}

      <div className="mb-3 text-xs font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400">
        Mission History (append-only compliance record)
      </div>
      <div className="space-y-3">
        {mission.historyEvents?.map((ev: any) => (
          <div key={ev.id} className="rounded-md border border-slate-200 p-3 text-sm dark:border-slate-800">
            <div className="flex items-center justify-between">
              <span className="font-semibold">{ev.eventType.replace(/_/g, " ")}</span>
              <span className="text-xs text-slate-400">{formatTimestamp(ev.timestamp, useZulu)}</span>
            </div>
            {ev.actor && <div className="text-xs text-slate-500 dark:text-slate-400">by {ev.actor.name}</div>}
            {ev.notes && <div className="mt-1 text-xs">{ev.notes}</div>}
          </div>
        ))}
        {!mission.historyEvents?.length && <p className="text-sm text-slate-400">No history recorded yet.</p>}
      </div>
    </div>
  );
}

function Field({ label, value, span2 }: { label: string; value: React.ReactNode; span2?: boolean }) {
  return (
    <div className={span2 ? "col-span-2" : ""}>
      <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">{label}</div>
      <div>{value}</div>
    </div>
  );
}
