import React, { useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createCoa, deleteCoa, fetchCoas, fetchFaaSummary, fetchSites, updateCoa } from "../api/resources";
import { usePreferences } from "../context/PreferencesContext";
import { formatDateOnly, formatTimestamp } from "../utils/time";
import { StatusPill, coaStatusTone } from "../components/StatusPill";
import { RequireRole } from "../components/RequireRole";
import { NOTIFICATION_TYPE_LABELS } from "../constants";

export default function Faa() {
  const { useZulu } = usePreferences();
  const { data: summary } = useQuery({ queryKey: ["faa-summary"], queryFn: fetchFaaSummary, refetchInterval: 60_000 });
  const [showNewCoa, setShowNewCoa] = useState(false);
  const { data: coas, refetch: refetchCoas } = useQuery({ queryKey: ["coas-all"], queryFn: () => fetchCoas() });

  return (
    <div className="space-y-6 p-8">
      <header className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">FAA Coordination &amp; Airspace Authorization</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            COA status, weekly advance notice filings, and launch-day notification checklists.
          </p>
        </div>
        <RequireRole roles={["ADMIN"]}>
          <button onClick={() => setShowNewCoa(true)} className="btn-primary">
            + New COA
          </button>
        </RequireRole>
      </header>

      <section className="card p-5">
        <div className="mb-3 text-xs font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400">
          Certificate of Waiver or Authorization (COA) Tracker
        </div>
        <table className="w-full text-sm">
          <thead className="border-b border-slate-200 text-left text-xs uppercase text-slate-500 dark:border-slate-800 dark:text-slate-400">
            <tr>
              <th className="py-2">Site</th>
              <th className="py-2">COA #</th>
              <th className="py-2">Issuing Facility</th>
              <th className="py-2">Effective</th>
              <th className="py-2">Expires</th>
              <th className="py-2">Status</th>
              <th className="py-2" />
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
            {coas?.map((c) => (
              <tr key={c.id}>
                <td className="py-2">{c.site?.name}</td>
                <td className="py-2 font-mono text-xs">{c.coaNumber}</td>
                <td className="py-2">{c.issuingFacility}</td>
                <td className="py-2 text-xs">{formatDateOnly(c.effectiveDate, useZulu)}</td>
                <td className="py-2 text-xs">{formatDateOnly(c.expirationDate, useZulu)}</td>
                <td className="py-2">
                  <StatusPill tone={coaStatusTone(c.status)}>{c.status}</StatusPill>
                </td>
                <td className="py-2 text-right">
                  <RequireRole roles={["ADMIN"]}>
                    <button
                      onClick={async () => {
                        if (confirm(`Delete COA ${c.coaNumber}?`)) {
                          await deleteCoa(c.id);
                          refetchCoas();
                        }
                      }}
                      className="text-xs text-aat-nogo hover:underline"
                    >
                      Delete
                    </button>
                  </RequireRole>
                </td>
              </tr>
            ))}
            {summary?.siteCoaStatus
              ?.filter((s: any) => s.status === "NOT_ON_FILE")
              .map((s: any) => (
                <tr key={s.siteId}>
                  <td className="py-2">{s.siteName}</td>
                  <td className="py-2 text-xs text-slate-400" colSpan={4}>
                    No COA on file
                  </td>
                  <td className="py-2">
                    <StatusPill tone="nogo">NOT ON FILE</StatusPill>
                  </td>
                  <td />
                </tr>
              ))}
          </tbody>
        </table>
      </section>

      <section className="card p-5">
        <div className="mb-3 text-xs font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400">
          Upcoming Missions (14 days) — Leidos/NOTAM Filing Status
        </div>
        <div className="space-y-2">
          {summary?.upcomingNotamStatus?.length ? (
            summary.upcomingNotamStatus.map((m: any) => (
              <div key={m.missionId} className="flex items-center justify-between rounded-md border border-slate-200 px-3 py-2 text-sm dark:border-slate-800">
                <div>
                  <Link to={`/missions/${m.missionId}`} className="font-medium text-aat-accent hover:underline">
                    {m.missionName}
                  </Link>
                  <div className="text-xs text-slate-500 dark:text-slate-400">
                    {m.designator} · {m.siteName} · {formatTimestamp(m.targetedWindowOpen, useZulu)}
                  </div>
                </div>
                <StatusPill tone={m.notamStatus === "FILED" ? "go" : m.notamStatus === "OVERDUE" ? "nogo" : "caution"}>
                  {m.notamStatus.replace("_", " ")}
                </StatusPill>
              </div>
            ))
          ) : (
            <p className="text-sm text-slate-400">No missions targeted within the next 14 days.</p>
          )}
        </div>
      </section>

      <section className="card p-5">
        <div className="mb-3 text-xs font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400">
          Today's Targeted Missions — Launch Day Notification Checklist
        </div>
        <div className="space-y-3">
          {summary?.todayChecklists?.length ? (
            summary.todayChecklists.map((m: any) => (
              <div key={m.missionId} className="rounded-md border border-aat-caution/40 bg-aat-caution/5 p-3">
                <div className="mb-2 flex items-center justify-between">
                  <Link to={`/missions/${m.missionId}`} className="font-medium text-aat-accent hover:underline">
                    {m.missionName} ({m.designator})
                  </Link>
                  <span className="text-xs text-slate-500 dark:text-slate-400">
                    {formatTimestamp(m.windowOpen, useZulu)} – {formatTimestamp(m.windowClose, useZulu)}
                  </span>
                </div>
                <div className="flex flex-wrap gap-2">
                  {m.checklist.map((item: any) => (
                    <StatusPill key={item.notificationType} tone={item.satisfied || item.notApplicable ? "go" : "caution"}>
                      {NOTIFICATION_TYPE_LABELS[item.notificationType as keyof typeof NOTIFICATION_TYPE_LABELS]}
                    </StatusPill>
                  ))}
                </div>
              </div>
            ))
          ) : (
            <p className="text-sm text-slate-400">No missions targeted today.</p>
          )}
        </div>
      </section>

      {showNewCoa && <NewCoaModal onClose={() => setShowNewCoa(false)} onDone={refetchCoas} />}
    </div>
  );
}

function NewCoaModal({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const { data: sites } = useQuery({ queryKey: ["sites"], queryFn: fetchSites });
  const [form, setForm] = useState({
    siteId: "",
    coaNumber: "",
    issuingFacility: "",
    effectiveDate: "",
    expirationDate: "",
    authorizedActivity: "",
    altitudeLimits: "",
    conditions: "",
  });
  const mutation = useMutation({
    mutationFn: () =>
      createCoa({
        ...form,
        effectiveDate: new Date(form.effectiveDate).toISOString(),
        expirationDate: new Date(form.expirationDate).toISOString(),
      } as any),
    onSuccess: () => {
      onDone();
      onClose();
    },
  });

  return (
    <div className="fixed inset-0 z-[2000] flex items-center justify-center bg-black/40 p-4">
      <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-xl bg-white p-6 dark:bg-slate-900">
        <h2 className="mb-4 text-lg font-bold">New COA</h2>
        <div className="space-y-3">
          <select value={form.siteId} onChange={(e) => setForm({ ...form, siteId: e.target.value })} className="input">
            <option value="">Select site</option>
            {sites?.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
          <input placeholder="COA number" value={form.coaNumber} onChange={(e) => setForm({ ...form, coaNumber: e.target.value })} className="input" />
          <input
            placeholder="Issuing FAA facility/office"
            value={form.issuingFacility}
            onChange={(e) => setForm({ ...form, issuingFacility: e.target.value })}
            className="input"
          />
          <div className="grid grid-cols-2 gap-2">
            <input type="date" value={form.effectiveDate} onChange={(e) => setForm({ ...form, effectiveDate: e.target.value })} className="input" />
            <input type="date" value={form.expirationDate} onChange={(e) => setForm({ ...form, expirationDate: e.target.value })} className="input" />
          </div>
          <textarea
            placeholder="Authorized activity description"
            value={form.authorizedActivity}
            onChange={(e) => setForm({ ...form, authorizedActivity: e.target.value })}
            className="input"
            rows={2}
          />
          <input
            placeholder="Altitude / airspace limits"
            value={form.altitudeLimits}
            onChange={(e) => setForm({ ...form, altitudeLimits: e.target.value })}
            className="input"
          />
          <textarea
            placeholder="Conditions / restrictions"
            value={form.conditions}
            onChange={(e) => setForm({ ...form, conditions: e.target.value })}
            className="input"
            rows={2}
          />
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <button onClick={onClose} className="btn-secondary">
            Cancel
          </button>
          <button
            onClick={() => mutation.mutate()}
            disabled={!form.siteId || !form.coaNumber || !form.effectiveDate || !form.expirationDate}
            className="btn-primary disabled:opacity-50"
          >
            Create COA
          </button>
        </div>
      </div>
    </div>
  );
}
