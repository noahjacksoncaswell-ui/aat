import React, { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { clearLwccLog, clearLwccOverride, fetchLwccState, fetchSiteWeather, overrideLwcc, submitLwccReport } from "../api/resources";
import { useAuth } from "../context/AuthContext";
import { usePreferences } from "../context/PreferencesContext";
import { formatTimestamp } from "../utils/time";
import { StatusPill } from "./StatusPill";
import type { LwccRow, LwccRowStatus } from "../types";

function rowTone(status: LwccRowStatus) {
  switch (status) {
    case "NO_VIOLATION":
      return "go" as const;
    case "OVERRIDDEN":
      return "caution" as const;
    case "NOT_REPORTED":
      return "neutral" as const;
    default:
      return "nogo" as const;
  }
}

function ContextField({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-[9px] font-semibold uppercase tracking-wide text-slate-400">{label}</div>
      <div className="font-mono text-slate-200">{value}</div>
    </div>
  );
}

function riskLabel(risk: string) {
  if (risk === "MANUAL") return "MANUAL";
  if (risk === "ACTIVE") return "ACTIVE";
  if (risk === "INSUFFICIENT_DATA") return "N/A";
  return risk;
}

export default function LwccTab({ missionId, site }: { missionId: string; site: { id: string; name: string; lat: number; lon: number } }) {
  const { useZulu } = usePreferences();
  const { isLaunchDirector } = useAuth();
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ["lwcc", missionId],
    queryFn: () => fetchLwccState(missionId),
    refetchInterval: 30_000,
  });
  const {
    data: weather,
    refetch: refetchWeather,
    isFetching: weatherRefreshing,
  } = useQuery({
    queryKey: ["site-weather", site.id],
    queryFn: () => fetchSiteWeather(site.id),
    refetchInterval: 5 * 60_000,
  });
  const [reportRow, setReportRow] = useState<LwccRow | null>(null);
  const [overrideRow, setOverrideRow] = useState<LwccRow | null>(null);
  const [confirmClear, setConfirmClear] = useState(false);

  const clearLogMutation = useMutation({
    mutationFn: () => clearLwccLog(missionId),
    onSuccess: () => {
      setConfirmClear(false);
      qc.invalidateQueries({ queryKey: ["lwcc", missionId] });
    },
  });

  const clearOverrideMutation = useMutation({
    mutationFn: (requirementNo: number) => clearLwccOverride(missionId, requirementNo),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["lwcc", missionId] }),
  });

  if (isLoading || !data) return <div className="p-6 text-slate-400">Loading LWCC state...</div>;

  return (
    <div className="space-y-6">
      <section className={`card p-5 ${data.bannerStatus === "VIOLATION" ? "border-aat-nogo/60 bg-aat-nogo/5" : "border-aat-go/50 bg-aat-go/5"}`}>
        <div className="flex items-center justify-between">
          <div className="text-sm font-bold uppercase tracking-wide">
            LWCC Compliance Status:{" "}
            <span className={data.bannerStatus === "VIOLATION" ? "text-aat-nogo" : "text-aat-go"}>{data.bannerStatus.replace("_", " ")}</span>
          </div>
          {data.notReportedCount > 0 && (
            <span className="text-xs text-slate-500 dark:text-slate-400">{data.notReportedCount} requirement(s) not yet reported</span>
          )}
        </div>
        {data.bannerStatus === "VIOLATION" && (
          <ul className="mt-2 space-y-1 text-sm">
            {data.violatingRows.map((r) => (
              <li key={r.no} className="font-mono text-xs">
                — LWCCR {r.no} ({r.description}){r.currentValue != null ? ` — CURRENT: ${r.currentValue.toFixed(1)}` : ""}
                {r.holdExpiresAt ? ` — HOLD ACTIVE, expires ${formatTimestamp(r.holdExpiresAt, useZulu)}` : ""}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="card flex flex-wrap items-center justify-between gap-4 p-4 text-xs">
        <div className="flex flex-wrap gap-x-6 gap-y-1">
          <ContextField label="Launch Site" value={site.name} />
          <ContextField label="Coordinates" value={`${site.lat.toFixed(4)}, ${site.lon.toFixed(4)}`} />
          <ContextField
            label="Weather Data Source"
            value={
              !weather || weather.source === "UNAVAILABLE"
                ? "Unavailable"
                : weather.stationId
                  ? `${weather.source} · Station ${weather.stationId}`
                  : weather.source
            }
          />
          <ContextField label="Last Data Update" value={weather ? formatTimestamp(weather.fetchedAt, useZulu) : "--"} />
        </div>
        <button
          onClick={() => refetchWeather()}
          disabled={weatherRefreshing}
          className="shrink-0 rounded-md border border-slate-300 px-3 py-1.5 text-xs font-semibold hover:bg-slate-50 disabled:opacity-50 dark:border-slate-700 dark:hover:bg-slate-800"
        >
          {weatherRefreshing ? "Refreshing..." : "Refresh"}
        </button>
      </section>

      <section className="card overflow-hidden">
        <table className="w-full text-xs">
          <thead className="border-b border-slate-200 bg-slate-50 text-left uppercase tracking-wide text-slate-500 dark:border-slate-800 dark:bg-slate-800/40 dark:text-slate-400">
            <tr>
              <th className="px-3 py-2">LWCC No.</th>
              <th className="px-3 py-2">Description</th>
              <th className="px-3 py-2">Limit / Requirement</th>
              <th className="px-3 py-2 text-aat-caution">Report</th>
              <th className="px-3 py-2">Current</th>
              <th className="px-3 py-2">Violation Risk (15 Min)</th>
              <th className="px-3 py-2">Violation Risk (30 Min)</th>
              <th className="px-3 py-2" />
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
            {data.rows.map((row) => (
              <tr key={row.no} className={row.status === "VIOLATION" || row.status === "HOLD_ACTIVE" ? "bg-aat-nogo/5" : ""}>
                <td className="px-3 py-2 font-mono">LWCCR {row.no}</td>
                <td className="px-3 py-2">{row.description}</td>
                <td className="px-3 py-2 max-w-xs text-slate-500 dark:text-slate-400">{row.limitText}</td>
                <td className="px-3 py-2 text-aat-caution">
                  {row.mode === "LIVE" ? (
                    "--"
                  ) : (
                    <button onClick={() => setReportRow(row)} className="font-semibold text-aat-caution hover:underline">
                      {row.status === "NOT_REPORTED" ? "REPORT" : "UPDATE"}
                    </button>
                  )}
                </td>
                <td className="px-3 py-2">
                  {row.mode === "LIVE"
                    ? row.currentValue != null
                      ? row.currentValue.toFixed(1)
                      : "--"
                    : row.status === "NOT_REPORTED"
                      ? "NOT REPORTED"
                      : row.lastReport?.data?.violation
                        ? "VIOLATES"
                        : "CLEAR"}
                </td>
                <td className="px-3 py-2">{riskLabel(row.risk15)}</td>
                <td className="px-3 py-2">{riskLabel(row.risk30)}</td>
                <td className="px-3 py-2 text-right">
                  <div className="flex items-center justify-end gap-2">
                    {row.holdExpiresAt && row.status === "HOLD_ACTIVE" && (
                      <span className="font-mono text-[10px] text-aat-caution">until {formatTimestamp(row.holdExpiresAt, useZulu)}</span>
                    )}
                    <StatusPill tone={rowTone(row.status)}>{row.status.replace("_", " ")}</StatusPill>
                    {isLaunchDirector && row.status !== "OVERRIDDEN" && (
                      <button onClick={() => setOverrideRow(row)} className="text-[10px] font-semibold text-aat-caution hover:underline">
                        Override
                      </button>
                    )}
                    {isLaunchDirector && row.status === "OVERRIDDEN" && (
                      <button onClick={() => clearOverrideMutation.mutate(row.no)} className="text-[10px] font-semibold text-aat-accent hover:underline">
                        Clear override
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="card p-5">
        <div className="mb-2 flex items-center justify-between">
          <div className="text-xs font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400">LWCC Activity Log</div>
          {isLaunchDirector && (
            <button onClick={() => setConfirmClear(true)} className="text-xs font-semibold text-aat-nogo hover:underline">
              Reset/Clear log
            </button>
          )}
        </div>
        <div className="space-y-1 font-mono text-xs">
          {data.log.map((entry) => (
            <div key={entry.id} className="border-b border-slate-100 pb-1 dark:border-slate-800">
              <span className="text-slate-400">[{formatTimestamp(entry.timestamp, useZulu)}]</span> {entry.eventType}
              {entry.requirementNo ? ` — LWCCR ${entry.requirementNo}` : ""}
              {entry.actor ? ` — ${entry.actor.name}` : ""}
            </div>
          ))}
          {data.log.length === 0 && <div className="text-slate-400">No LWCC activity logged yet.</div>}
        </div>
      </section>

      {reportRow && <ReportModal missionId={missionId} row={reportRow} onClose={() => setReportRow(null)} />}
      {overrideRow && <OverrideModal missionId={missionId} row={overrideRow} onClose={() => setOverrideRow(null)} />}

      {confirmClear && (
        <div className="fixed inset-0 z-[2000] flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-md rounded-xl border border-zinc-800 bg-black p-6">
            <h2 className="mb-2 text-lg font-bold">Clear LWCC Activity Log</h2>
            <p className="mb-4 text-sm text-slate-600 dark:text-slate-300">
              This clears the visible working log only. Every underlying report, violation, hold, and override remains permanently retained in the
              compliance record and audit log — nothing is deleted.
            </p>
            <div className="flex justify-end gap-2">
              <button onClick={() => setConfirmClear(false)} className="btn-secondary">
                Cancel
              </button>
              <button onClick={() => clearLogMutation.mutate()} className="btn-danger">
                Clear visible log
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function ReportModal({ missionId, row, onClose }: { missionId: string; row: LwccRow; onClose: () => void }) {
  const qc = useQueryClient();
  const [violation, setViolation] = useState<boolean>((row.lastReport?.data as any)?.violation ?? false);
  const [notes, setNotes] = useState("");

  const mutation = useMutation({
    mutationFn: () => submitLwccReport(missionId, { requirementNo: row.no, violation, notes }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["lwcc", missionId] });
      onClose();
    },
  });

  return (
    <div className="fixed inset-0 z-[2000] flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-md rounded-xl border border-zinc-800 bg-black p-6">
        <h2 className="mb-1 text-lg font-bold">Report LWCCR {row.no}</h2>
        <p className="mb-3 text-xs text-slate-500 dark:text-slate-400">{row.limitText}</p>
        <div className="space-y-3">
          <label className="flex items-center gap-2 text-sm">
            <input type="radio" checked={!violation} onChange={() => setViolation(false)} />
            Condition does not violate this requirement
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input type="radio" checked={violation} onChange={() => setViolation(true)} />
            Condition violates this requirement{row.holdDurationSeconds ? ` (starts a ${row.holdDurationSeconds / 60}-min hold)` : ""}
          </label>
          <textarea value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Observed values, distance/bearing, coverage, etc." className="input" rows={3} />
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <button onClick={onClose} className="btn-secondary">
            Cancel
          </button>
          <button onClick={() => mutation.mutate()} className="btn-primary">
            Submit report
          </button>
        </div>
      </div>
    </div>
  );
}

function OverrideModal({ missionId, row, onClose }: { missionId: string; row: LwccRow; onClose: () => void }) {
  const qc = useQueryClient();
  const [justification, setJustification] = useState("");

  const mutation = useMutation({
    mutationFn: () => overrideLwcc(missionId, row.no, justification),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["lwcc", missionId] });
      onClose();
    },
  });

  return (
    <div className="fixed inset-0 z-[2000] flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-md rounded-xl border border-zinc-800 bg-black p-6">
        <h2 className="mb-2 text-lg font-bold text-aat-nogo">Override LWCCR {row.no}</h2>
        <p className="mb-3 text-sm text-slate-600 dark:text-slate-300">
          Overriding a Launch Weather Commit Criterion bypasses a safety-critical gate. Per APC-STD-23-01 §3.1.2, the Launch Director must have
          clear and convincing evidence that no LWCC is violated before proceeding. This override and its justification are permanently logged.
        </p>
        <textarea
          value={justification}
          onChange={(e) => setJustification(e.target.value)}
          placeholder="Justification (required)"
          className="input"
          rows={3}
        />
        <div className="mt-4 flex justify-end gap-2">
          <button onClick={onClose} className="btn-secondary">
            Cancel
          </button>
          <button onClick={() => mutation.mutate()} disabled={!justification.trim()} className="btn-danger disabled:opacity-50">
            Confirm override
          </button>
        </div>
      </div>
    </div>
  );
}
