import React, { useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createMission, fetchMissions, fetchSites, fetchVehicles } from "../api/resources";
import { usePreferences } from "../context/PreferencesContext";
import { formatDateOnly } from "../utils/time";
import { StatusPill, missionStatusTone } from "../components/StatusPill";
import { RequireRole } from "../components/RequireRole";

const STATUS_OPTIONS = ["PENDING_WINDOW", "TARGETED", "HOLD", "SCRUBBED", "POSTPONED", "CANCELLED", "SUCCESSFUL"];

export default function Missions() {
  const { useZulu } = usePreferences();
  const [filters, setFilters] = useState({ status: "", site: "", search: "" });
  const [showNew, setShowNew] = useState(false);
  const { data: missions, isLoading } = useQuery({
    queryKey: ["missions", filters],
    queryFn: () =>
      fetchMissions({
        status: filters.status || undefined,
        site: filters.site || undefined,
        search: filters.search || undefined,
      }),
  });
  const { data: sites } = useQuery({ queryKey: ["sites"], queryFn: fetchSites });

  return (
    <div className="space-y-6 p-8">
      <header className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Mission Schedule</h1>
        </div>
        <RequireRole roles={["ADMIN", "LAUNCH_DIRECTOR"]}>
          <button
            onClick={() => setShowNew(true)}
            className="rounded-md bg-white px-4 py-2 text-sm font-semibold text-black hover:bg-zinc-200"
          >
            + New Mission
          </button>
        </RequireRole>
      </header>

      <div className="flex flex-wrap gap-3">
        <input
          placeholder="Search mission name / designator"
          value={filters.search}
          onChange={(e) => setFilters({ ...filters, search: e.target.value })}
          className="input max-w-xs"
        />
        <select value={filters.status} onChange={(e) => setFilters({ ...filters, status: e.target.value })} className="input max-w-[200px]">
          <option value="">All statuses</option>
          {STATUS_OPTIONS.map((s) => (
            <option key={s} value={s}>
              {s.replace("_", " ")}
            </option>
          ))}
        </select>
        <select value={filters.site} onChange={(e) => setFilters({ ...filters, site: e.target.value })} className="input max-w-[220px]">
          <option value="">All sites</option>
          {sites?.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
      </div>

      <div className="card overflow-hidden">
        <table className="w-full text-sm">
          <thead className="border-b border-slate-200 bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500 dark:border-slate-800 dark:bg-slate-800/40 dark:text-slate-400">
            <tr>
              <th className="px-4 py-3">Mission</th>
              <th className="px-4 py-3">Vehicle</th>
              <th className="px-4 py-3">Site</th>
              <th className="px-4 py-3">Launch Period</th>
              <th className="px-4 py-3">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
            {isLoading && (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-slate-400">
                  Loading missions...
                </td>
              </tr>
            )}
            {missions?.map((m) => (
              <tr key={m.id} className="cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-800/40">
                <td className="px-4 py-3">
                  <Link to={`/missions/${m.id}`} className="font-medium text-aat-accent hover:underline">
                    {m.name}
                  </Link>
                  <div className="text-xs text-slate-500 dark:text-slate-400">{m.designator}</div>
                </td>
                <td className="px-4 py-3">{m.vehicle?.name}</td>
                <td className="px-4 py-3">{m.site?.name}</td>
                <td className="px-4 py-3 text-xs">
                  {m.launchPeriodEntries?.length
                    ? `${formatDateOnly(m.launchPeriodEntries[0].date, useZulu)} – ${formatDateOnly(
                        m.launchPeriodEntries[m.launchPeriodEntries.length - 1].date,
                        useZulu
                      )}`
                    : "--"}
                </td>
                <td className="px-4 py-3">
                  <StatusPill tone={missionStatusTone(m.status)}>{m.status.replace("_", " ")}</StatusPill>
                </td>
              </tr>
            ))}
            {missions?.length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-slate-400">
                  No missions match these filters.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {showNew && <NewMissionModal onClose={() => setShowNew(false)} />}
    </div>
  );
}

function NewMissionModal({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const { data: sites } = useQuery({ queryKey: ["sites"], queryFn: fetchSites });
  const { data: vehicles } = useQuery({ queryKey: ["vehicles"], queryFn: fetchVehicles });
  const [form, setForm] = useState({ name: "", designator: "", vehicleId: "", siteId: "", payloadDescription: "" });
  const [entries, setEntries] = useState([{ date: "", windowOpen: "", windowClose: "" }]);

  const mutation = useMutation({
    mutationFn: () =>
      createMission({
        ...form,
        launchPeriodEntries: entries
          .filter((e) => e.date && e.windowOpen && e.windowClose)
          .map((e) => ({
            date: new Date(e.date).toISOString(),
            windowOpen: new Date(`${e.date}T${e.windowOpen}:00Z`).toISOString(),
            windowClose: new Date(`${e.date}T${e.windowClose}:00Z`).toISOString(),
          })),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["missions"] });
      onClose();
    },
  });

  return (
    <div className="fixed inset-0 z-[2000] flex items-center justify-center bg-black/40 p-4">
      <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-xl border border-zinc-800 bg-black p-6">
        <h2 className="mb-4 text-lg font-bold">New Mission</h2>
        <div className="space-y-3">
          <input placeholder="Mission name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="input" />
          <input
            placeholder="Designator (e.g. AAT-M002)"
            value={form.designator}
            onChange={(e) => setForm({ ...form, designator: e.target.value })}
            className="input"
          />
          <select value={form.vehicleId} onChange={(e) => setForm({ ...form, vehicleId: e.target.value })} className="input">
            <option value="">Select vehicle</option>
            {vehicles?.map((v) => (
              <option key={v.id} value={v.id}>
                {v.name}
              </option>
            ))}
          </select>
          <select value={form.siteId} onChange={(e) => setForm({ ...form, siteId: e.target.value })} className="input">
            <option value="">Select site</option>
            {sites?.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
          <textarea
            placeholder="Payload description"
            value={form.payloadDescription}
            onChange={(e) => setForm({ ...form, payloadDescription: e.target.value })}
            className="input"
            rows={2}
          />

          <div>
            <div className="mb-1 text-xs font-semibold uppercase text-slate-500">Launch Period (pre-approved dates/windows)</div>
            {entries.map((entry, idx) => (
              <div key={idx} className="mb-2 grid grid-cols-3 gap-2">
                <input
                  type="date"
                  value={entry.date}
                  onChange={(e) => {
                    const next = [...entries];
                    next[idx] = { ...next[idx], date: e.target.value };
                    setEntries(next);
                  }}
                  className="input"
                />
                <input
                  type="time"
                  value={entry.windowOpen}
                  onChange={(e) => {
                    const next = [...entries];
                    next[idx] = { ...next[idx], windowOpen: e.target.value };
                    setEntries(next);
                  }}
                  className="input"
                />
                <input
                  type="time"
                  value={entry.windowClose}
                  onChange={(e) => {
                    const next = [...entries];
                    next[idx] = { ...next[idx], windowClose: e.target.value };
                    setEntries(next);
                  }}
                  className="input"
                />
              </div>
            ))}
            <button
              onClick={() => setEntries([...entries, { date: "", windowOpen: "", windowClose: "" }])}
              className="text-xs font-semibold text-aat-accent hover:underline"
            >
              + Add another window
            </button>
          </div>
        </div>

        <div className="mt-5 flex justify-end gap-2">
          <button onClick={onClose} className="rounded-md border border-slate-300 px-4 py-2 text-sm dark:border-slate-700">
            Cancel
          </button>
          <button
            onClick={() => mutation.mutate()}
            disabled={!form.name || !form.designator || !form.vehicleId || !form.siteId || mutation.isPending}
            className="rounded-md bg-white px-4 py-2 text-sm font-semibold text-black disabled:opacity-50"
          >
            Create Mission
          </button>
        </div>
      </div>
    </div>
  );
}
