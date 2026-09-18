import React, { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  addLaunchPeriodEntry,
  addLogEntry,
  cancelMission,
  fetchLaunchDayNotifications,
  fetchMission,
  fetchNotamStatus,
  fetchSiteWeather,
  fileNotam,
  logDisposition,
  postponeMission,
  removeLaunchPeriodEntry,
  scrubMission,
  targetLaunchOpportunity,
  updateGoNoGo,
  updateLaunchDayNotification,
  updateMilestone,
} from "../api/resources";
import { useAuth } from "../context/AuthContext";
import { usePreferences } from "../context/PreferencesContext";
import { formatCountdown, formatTimestamp } from "../utils/time";
import { StatusPill, missionStatusTone, goNoGoTone, weatherStatusTone } from "../components/StatusPill";
import { useMissionSocket } from "../hooks/useSocket";
import type { NotificationType } from "../types";

const TABS = ["Overview", "Countdown & GO/NO-GO", "FAA & NOTAM", "Log", "History"] as const;

export default function MissionDetail() {
  const { missionId } = useParams<{ missionId: string }>();
  const { useZulu } = usePreferences();
  const qc = useQueryClient();
  const [tab, setTab] = useState<(typeof TABS)[number]>("Overview");

  const { data: mission, isLoading } = useQuery({
    queryKey: ["mission", missionId],
    queryFn: () => fetchMission(missionId!),
    enabled: !!missionId,
  });

  useMissionSocket(missionId, () => {
    qc.invalidateQueries({ queryKey: ["mission", missionId] });
    qc.invalidateQueries({ queryKey: ["notam", missionId] });
    qc.invalidateQueries({ queryKey: ["notifications", missionId] });
  });

  if (isLoading || !mission) return <div className="p-8 text-slate-400">Loading mission...</div>;

  const targeted = mission.launchPeriodEntries.find((e) => e.isTargeted);

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
        <StatusPill tone={missionStatusTone(mission.status)}>{mission.status.replace("_", " ")}</StatusPill>
      </header>

      <div className="flex gap-1 border-b border-slate-200 dark:border-slate-800">
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

      {tab === "Overview" && <OverviewTab mission={mission} missionId={missionId!} useZulu={useZulu} targeted={targeted} />}
      {tab === "Countdown & GO/NO-GO" && <CountdownTab mission={mission} missionId={missionId!} useZulu={useZulu} targeted={targeted} />}
      {tab === "FAA & NOTAM" && <FaaTab missionId={missionId!} targeted={targeted} useZulu={useZulu} />}
      {tab === "Log" && <LogTab mission={mission} missionId={missionId!} useZulu={useZulu} />}
      {tab === "History" && <HistoryTab mission={mission} useZulu={useZulu} />}
    </div>
  );
}

function ActionButtons({ mission, missionId }: { mission: any; missionId: string }) {
  const { isLaunchDirector } = useAuth();
  const qc = useQueryClient();
  const [modal, setModal] = useState<"postpone" | "cancel" | "scrub" | "disposition" | "target" | null>(null);
  const [notes, setNotes] = useState("");

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["mission", missionId] });
    qc.invalidateQueries({ queryKey: ["missions"] });
    qc.invalidateQueries({ queryKey: ["dashboard"] });
  };

  const postpone = useMutation({ mutationFn: () => postponeMission(missionId, notes), onSuccess: () => (invalidate(), close()) });
  const cancel = useMutation({ mutationFn: () => cancelMission(missionId, notes), onSuccess: () => (invalidate(), close()) });
  const scrub = useMutation({ mutationFn: () => scrubMission(missionId, notes), onSuccess: () => (invalidate(), close()) });

  function close() {
    setModal(null);
    setNotes("");
  }

  if (!isLaunchDirector) return null;

  const untargeted = mission.launchPeriodEntries.filter((e: any) => !e.consumed && !e.isTargeted);
  const canTarget = !["SCRUBBED", "CANCELLED", "SUCCESSFUL"].includes(mission.status) && untargeted.length > 0;
  const canPostponeOrCancel = mission.status === "TARGETED" || mission.status === "PENDING_WINDOW" || mission.status === "HOLD";
  const canScrub = mission.status === "TARGETED";
  const canDisposition = mission.status === "TARGETED";

  return (
    <div className="flex flex-wrap gap-2">
      {canTarget && (
        <button onClick={() => setModal("target")} className="btn-primary">
          Select Target Launch Opportunity
        </button>
      )}
      {canPostponeOrCancel && (
        <button onClick={() => setModal("postpone")} className="btn-secondary">
          Postpone
        </button>
      )}
      {canPostponeOrCancel && (
        <button onClick={() => setModal("cancel")} className="btn-danger">
          Cancel
        </button>
      )}
      {canScrub && (
        <button onClick={() => setModal("scrub")} className="btn-danger">
          Scrub
        </button>
      )}
      {canDisposition && (
        <button onClick={() => setModal("disposition")} className="btn-primary">
          Mark Successful / Log Disposition
        </button>
      )}

      {modal === "target" && <TargetModal missionId={missionId} entries={untargeted} onClose={close} onDone={invalidate} />}

      {(modal === "postpone" || modal === "cancel" || modal === "scrub") && (
        <div className="fixed inset-0 z-[2000] flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-md rounded-xl bg-white p-6 dark:bg-slate-900">
            <h2 className="mb-1 text-lg font-bold capitalize">{modal} Mission</h2>
            <p className="mb-3 text-xs text-slate-500 dark:text-slate-400">A reason/notes entry is required and is logged to mission history.</p>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={3}
              placeholder="Reason / notes"
              className="input"
            />
            <div className="mt-4 flex justify-end gap-2">
              <button onClick={close} className="rounded-md border border-slate-300 px-4 py-2 text-sm dark:border-slate-700">
                Back
              </button>
              <button
                onClick={() => {
                  if (modal === "postpone") postpone.mutate();
                  if (modal === "cancel") cancel.mutate();
                  if (modal === "scrub") scrub.mutate();
                }}
                disabled={!notes.trim()}
                className="rounded-md bg-aat-nogo px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
              >
                Confirm {modal}
              </button>
            </div>
          </div>
        </div>
      )}

      {modal === "disposition" && <DispositionModal missionId={missionId} onClose={close} onDone={invalidate} />}
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
      <div className="w-full max-w-md rounded-xl bg-white p-6 dark:bg-slate-900">
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
              <button onClick={onClose} className="rounded-md border border-slate-300 px-4 py-2 text-sm dark:border-slate-700">
                Cancel
              </button>
              <button
                onClick={() => setConfirming(true)}
                disabled={!selected}
                className="rounded-md bg-aat-accent px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
              >
                Continue
              </button>
            </div>
          </>
        ) : (
          <>
            <p className="text-sm">
              Confirm mission will target{" "}
              <strong>
                {formatTimestamp(entry.windowOpen, useZulu)} – {formatTimestamp(entry.windowClose, useZulu)}
              </strong>
              ? This will lock in FAA/ATC notification requirements.
            </p>
            <div className="mt-4 flex justify-end gap-2">
              <button onClick={() => setConfirming(false)} className="rounded-md border border-slate-300 px-4 py-2 text-sm dark:border-slate-700">
                Back
              </button>
              <button
                onClick={() => mutation.mutate()}
                disabled={mutation.isPending}
                className="rounded-md bg-aat-accent px-4 py-2 text-sm font-semibold text-white"
              >
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
    apogeeAltitudeMeters: "",
    flightDurationSeconds: "",
    vehiclePerformanceNotes: "",
    payloadOutcome: "",
    recoveryStatus: "",
    anomaliesNotes: "",
  });
  const mutation = useMutation({
    mutationFn: () =>
      logDisposition(missionId, {
        ...form,
        actualLiftoffTime: form.actualLiftoffTime ? new Date(form.actualLiftoffTime).toISOString() : null,
        apogeeAltitudeMeters: form.apogeeAltitudeMeters ? Number(form.apogeeAltitudeMeters) : null,
        flightDurationSeconds: form.flightDurationSeconds ? Number(form.flightDurationSeconds) : null,
      }),
    onSuccess: () => {
      onDone();
      onClose();
    },
  });

  return (
    <div className="fixed inset-0 z-[2000] flex items-center justify-center bg-black/40 p-4">
      <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-xl bg-white p-6 dark:bg-slate-900">
        <h2 className="mb-4 text-lg font-bold">Flight Disposition</h2>
        <div className="space-y-3">
          <input
            type="datetime-local"
            value={form.actualLiftoffTime}
            onChange={(e) => setForm({ ...form, actualLiftoffTime: e.target.value })}
            className="input"
          />
          <div className="grid grid-cols-2 gap-2">
            <input
              placeholder="Apogee (m)"
              value={form.apogeeAltitudeMeters}
              onChange={(e) => setForm({ ...form, apogeeAltitudeMeters: e.target.value })}
              className="input"
            />
            <input
              placeholder="Flight duration (s)"
              value={form.flightDurationSeconds}
              onChange={(e) => setForm({ ...form, flightDurationSeconds: e.target.value })}
              className="input"
            />
          </div>
          <textarea
            placeholder="Vehicle performance notes"
            value={form.vehiclePerformanceNotes}
            onChange={(e) => setForm({ ...form, vehiclePerformanceNotes: e.target.value })}
            className="input"
            rows={2}
          />
          <input
            placeholder="Payload outcome"
            value={form.payloadOutcome}
            onChange={(e) => setForm({ ...form, payloadOutcome: e.target.value })}
            className="input"
          />
          <input
            placeholder="Recovery status"
            value={form.recoveryStatus}
            onChange={(e) => setForm({ ...form, recoveryStatus: e.target.value })}
            className="input"
          />
          <textarea
            placeholder="Anomalies noted post-flight"
            value={form.anomaliesNotes}
            onChange={(e) => setForm({ ...form, anomaliesNotes: e.target.value })}
            className="input"
            rows={2}
          />
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <button onClick={onClose} className="rounded-md border border-slate-300 px-4 py-2 text-sm dark:border-slate-700">
            Cancel
          </button>
          <button onClick={() => mutation.mutate()} className="rounded-md bg-aat-accent px-4 py-2 text-sm font-semibold text-white">
            Log Disposition
          </button>
        </div>
      </div>
    </div>
  );
}

function OverviewTab({ mission, missionId, useZulu, targeted }: any) {
  const { isLaunchDirector } = useAuth();
  const qc = useQueryClient();
  const [newEntry, setNewEntry] = useState({ date: "", windowOpen: "", windowClose: "" });

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
                className="rounded-md bg-aat-accent px-3 py-2 text-xs font-semibold text-white disabled:opacity-50"
              >
                Add window
              </button>
            </div>
          )}
        </section>

        <section className="card p-5">
          <div className="mb-2 text-xs font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400">Launch Director Actions</div>
          <ActionButtons mission={mission} missionId={missionId} />
        </section>

        {mission.disposition && (
          <section className="card p-5">
            <div className="mb-2 text-xs font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400">Flight Disposition</div>
            <div className="grid grid-cols-2 gap-3 text-sm">
              <Field label="Liftoff" value={formatTimestamp(mission.disposition.actualLiftoffTime, useZulu)} />
              <Field label="Apogee" value={mission.disposition.apogeeAltitudeMeters ? `${mission.disposition.apogeeAltitudeMeters} m` : "--"} />
              <Field
                label="Flight duration"
                value={mission.disposition.flightDurationSeconds ? `${mission.disposition.flightDurationSeconds} s` : "--"}
              />
              <Field label="Recovery" value={mission.disposition.recoveryStatus || "--"} />
              <Field label="Payload outcome" value={mission.disposition.payloadOutcome || "--"} span2 />
              <Field label="Vehicle performance notes" value={mission.disposition.vehiclePerformanceNotes || "--"} span2 />
              <Field label="Anomalies" value={mission.disposition.anomaliesNotes || "--"} span2 />
            </div>
          </section>
        )}
      </div>

      <div className="space-y-6">
        <section className="card p-5">
          <div className="mb-2 text-xs font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400">Payload</div>
          <p className="text-sm">{mission.payloadDescription || "No payload description on file."}</p>
        </section>
        <section className="card p-5">
          <div className="mb-2 text-xs font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400">Assigned Personnel</div>
          <div className="space-y-1 text-sm">
            {mission.assignedUsers?.length ? (
              mission.assignedUsers.map((a: any) => (
                <div key={a.user.id} className="flex justify-between">
                  <span>{a.user.name}</span>
                  <span className="text-xs text-slate-500 dark:text-slate-400">{a.role || a.user.role}</span>
                </div>
              ))
            ) : (
              <span className="text-slate-400">No personnel assigned.</span>
            )}
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
      <div>Wind: {weather.windSpeedKts?.toFixed(0) ?? "--"} kt {exceeded && <span className="text-aat-nogo font-semibold">(exceeds limit)</span>}</div>
      <div>Ceiling: {weather.cloudCeilingFt?.toFixed(0) ?? "--"} ft</div>
      <div>Temp: {weather.temperatureC?.toFixed(1) ?? "--"} °C</div>
    </div>
  );
}

function CountdownTab({ mission, missionId, useZulu, targeted }: any) {
  const qc = useQueryClient();
  const [now, setNow] = useState(new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  const updateMilestoneMutation = useMutation({
    mutationFn: ({ id, status }: { id: string; status: string }) => updateMilestone(missionId, id, { status }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["mission", missionId] }),
  });
  const updatePoll = useMutation({
    mutationFn: ({ id, status }: { id: string; status: string }) => updateGoNoGo(missionId, id, { status }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["mission", missionId] }),
    onError: (err: any) => alert(err?.response?.data?.error ?? "Failed to update poll"),
  });

  const countdown = targeted ? formatCountdown(targeted.windowOpen, now) : null;

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
      <div className="lg:col-span-2 space-y-6">
        <section className="card flex flex-col items-center justify-center bg-aat-navy p-8 text-white">
          <div className="text-xs uppercase tracking-widest text-slate-400">{targeted ? "Countdown to window open" : "No targeted opportunity"}</div>
          <div className="font-mono text-5xl font-bold tabular-nums">{countdown?.text ?? "--:--:--"}</div>
        </section>

        <section className="card p-5">
          <div className="mb-3 text-xs font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400">Milestone Timeline</div>
          <div className="space-y-1">
            {mission.milestones
              ?.slice()
              .sort((a: any, b: any) => b.tMinusSeconds - a.tMinusSeconds)
              .map((m: any) => (
                <div key={m.id} className="flex items-center justify-between rounded-md border border-slate-200 px-3 py-2 text-sm dark:border-slate-800">
                  <div>
                    <span className="font-mono text-xs text-slate-500">T-{formatDuration(m.tMinusSeconds)}</span>{" "}
                    <span className="ml-2">{m.label}</span>
                  </div>
                  <select
                    value={m.status}
                    onChange={(e) => updateMilestoneMutation.mutate({ id: m.id, status: e.target.value })}
                    className={`rounded-md border px-2 py-1 text-xs ${milestoneColor(m.status)}`}
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
        </section>
      </div>

      <section className="card p-5">
        <div className="mb-3 text-xs font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400">GO / NO-GO Poll</div>
        <div className="space-y-2">
          {mission.goNoGoPolls?.map((poll: any) => (
            <div key={poll.id} className="flex items-center justify-between rounded-md border border-slate-200 px-3 py-2 text-sm dark:border-slate-800">
              <span>{poll.stationName}</span>
              <select
                value={poll.status}
                onChange={(e) => updatePoll.mutate({ id: poll.id, status: e.target.value })}
                className={`rounded-md border px-2 py-1 text-xs font-semibold ${pollColor(poll.status)}`}
              >
                {["UNPOLLED", "GO", "NO_GO", "HOLD"].map((s) => (
                  <option key={s} value={s}>
                    {s.replace("_", " ")}
                  </option>
                ))}
              </select>
            </div>
          ))}
        </div>
        <p className="mt-2 text-[11px] text-slate-400">FAA/Airspace cannot show GO until the launch-day notification checklist is fully satisfied.</p>
      </section>
    </div>
  );
}

function formatDuration(seconds: number) {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

function milestoneColor(status: string) {
  switch (status) {
    case "COMPLETE":
      return "border-aat-go text-aat-go";
    case "IN_PROGRESS":
      return "border-aat-caution text-aat-caution";
    case "HELD":
      return "border-aat-nogo text-aat-nogo";
    default:
      return "border-slate-300 dark:border-slate-700";
  }
}
function pollColor(status: string) {
  switch (status) {
    case "GO":
      return "border-aat-go text-aat-go";
    case "NO_GO":
      return "border-aat-nogo text-aat-nogo";
    case "HOLD":
      return "border-aat-caution text-aat-caution";
    default:
      return "border-slate-300 dark:border-slate-700";
  }
}

const NOTIFICATION_LABELS: Record<NotificationType, string> = {
  T_MINUS_60: "T-60 min: ARTCC / local facility advisory",
  T_MINUS_15: "T-15 min: ARTCC / local facility confirmation",
  TERMINATION: "Termination: airspace clear confirmation",
};

function FaaTab({ missionId, targeted, useZulu }: { missionId: string; targeted: any; useZulu: boolean }) {
  const { isLaunchDirector } = useAuth();
  const qc = useQueryClient();
  const { data: notam } = useQuery({ queryKey: ["notam", missionId], queryFn: () => fetchNotamStatus(missionId) });
  const { data: notifications } = useQuery({ queryKey: ["notifications", missionId], queryFn: () => fetchLaunchDayNotifications(missionId) });
  const [notamForm, setNotamForm] = useState({ leidosConfirmationNumber: "", notamWindowOpen: "", notamWindowClose: "" });

  const fileNotamMutation = useMutation({
    mutationFn: () =>
      fileNotam(missionId, {
        filedDate: new Date().toISOString(),
        leidosConfirmationNumber: notamForm.leidosConfirmationNumber,
        notamWindowOpen: notamForm.notamWindowOpen ? new Date(notamForm.notamWindowOpen).toISOString() : new Date().toISOString(),
        notamWindowClose: notamForm.notamWindowClose ? new Date(notamForm.notamWindowClose).toISOString() : new Date().toISOString(),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["notam", missionId] }),
  });

  const isTargetedToday = targeted && new Date(targeted.date).toDateString() === new Date().toDateString();

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
      <section className="card p-5">
        <div className="mb-2 flex items-center justify-between">
          <div className="text-xs font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400">
            Weekly Advance Notice (Leidos / NOTAM)
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
        {isLaunchDirector && (
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
            <p className="text-[11px] text-slate-400">Default filed window should be broader than the internal launch window (e.g. 6 hrs margin).</p>
            <button onClick={() => fileNotamMutation.mutate()} className="rounded-md bg-aat-accent px-3 py-2 text-xs font-semibold text-white">
              Log NOTAM Filing
            </button>
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
  const mutation = useMutation({
    mutationFn: (data: any) => updateLaunchDayNotification(missionId, item.notificationType, data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["notifications", missionId] }),
  });

  const done = item.satisfied || item.notApplicable;

  return (
    <div className={`rounded-md border p-3 text-sm ${done ? "border-aat-go/50 bg-aat-go/5" : "border-slate-200 dark:border-slate-800"}`}>
      <div className="flex items-center justify-between">
        <span className="font-medium">{NOTIFICATION_LABELS[item.notificationType as NotificationType]}</span>
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
      {!done && isLaunchDirector && (
        <div className="mt-2 space-y-2">
          <input placeholder="Contacted facility" value={facility} onChange={(e) => setFacility(e.target.value)} className="input" />
          <input placeholder="Notes / confirmation" value={notes} onChange={(e) => setNotes(e.target.value)} className="input" />
          <div className="flex gap-2">
            <button
              onClick={() => mutation.mutate({ satisfied: true, contactedFacility: facility, notes })}
              className="rounded-md bg-aat-go px-3 py-1.5 text-xs font-semibold text-white"
            >
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
    </div>
  );
}

function LogTab({ mission, missionId, useZulu }: any) {
  const qc = useQueryClient();
  const [text, setText] = useState("");
  const mutation = useMutation({
    mutationFn: () => addLogEntry(missionId, text),
    onSuccess: () => {
      setText("");
      qc.invalidateQueries({ queryKey: ["mission", missionId] });
    },
  });

  return (
    <div className="card mx-auto max-w-3xl p-5">
      <div className="mb-3 text-xs font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400">Mission Log</div>
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
          className="shrink-0 rounded-md bg-aat-accent px-4 py-2 text-sm font-semibold text-white"
        >
          Log
        </button>
      </div>
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

function HistoryTab({ mission, useZulu }: any) {
  return (
    <div className="card mx-auto max-w-3xl p-5">
      <div className="mb-3 text-xs font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400">
        Mission History (append-only compliance record)
      </div>
      <div className="space-y-3">
        {mission.historyEvents?.map((ev: any) => (
          <div key={ev.id} className="rounded-md border border-slate-200 p-3 text-sm dark:border-slate-800">
            <div className="flex items-center justify-between">
              <span className="font-semibold">{ev.eventType}</span>
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
