import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { fetchDashboard } from "../api/resources";
import { usePreferences } from "../context/PreferencesContext";
import { formatCountdown, formatTimestamp } from "../utils/time";
import { StatusPill, weatherStatusTone, coaStatusTone } from "../components/StatusPill";
import { useDashboardSocket } from "../hooks/useSocket";

export default function Dashboard() {
  const { useZulu } = usePreferences();
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({ queryKey: ["dashboard"], queryFn: fetchDashboard, refetchInterval: 30_000 });
  const [now, setNow] = useState(new Date());

  useDashboardSocket(() => qc.invalidateQueries({ queryKey: ["dashboard"] }));

  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  if (isLoading) return <div className="p-8 text-slate-400">Loading dashboard...</div>;

  const next = data?.nextOpportunity;
  const countdown = next ? formatCountdown(next.windowOpen, now) : null;

  return (
    <div className="space-y-6 p-8">
      <header>
        <h1 className="text-2xl font-bold tracking-tight">Operations Dashboard</h1>
        <p className="text-sm text-slate-500 dark:text-slate-400">At-a-glance status across all AAT launch operations.</p>
      </header>

      {data?.openActionItems?.length > 0 && (
        <div className="card border-aat-caution/50 bg-aat-caution/5 p-4">
          <div className="mb-2 text-xs font-bold uppercase tracking-wide text-aat-caution">Alerts</div>
          <ul className="space-y-1 text-sm">
            {data.openActionItems.map((item: any, idx: number) => (
              <li key={idx} className="flex items-center justify-between gap-4">
                <span>{item.detail}</span>
                <Link to={`/missions/${item.missionId}`} className="shrink-0 text-xs font-semibold text-aat-accent hover:underline">
                  Open mission →
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}

      <section className="card p-6">
        <div className="mb-4 text-xs font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400">
          Next Targeted Launch Opportunity
        </div>
        {next ? (
          <div className="grid grid-cols-1 gap-6 md:grid-cols-[1fr_auto]">
            <div>
              <div className="text-xl font-semibold">{next.missionName}</div>
              <div className="text-sm text-slate-500 dark:text-slate-400">
                {next.designator} · {next.vehicleName} · {next.siteName}
              </div>
              <div className="mt-2 text-xs text-slate-500 dark:text-slate-400">
                Window: {formatTimestamp(next.windowOpen, useZulu)} – {formatTimestamp(next.windowClose, useZulu)}
              </div>
              <div className="mt-4 flex flex-wrap gap-2">
                <StatusPill tone={weatherStatusTone(next.weatherStatus)}>Weather: {next.weatherStatus}</StatusPill>
                <StatusPill tone={coaStatusTone(next.coaStatus)}>COA: {next.coaStatus.replace("_", " ")}</StatusPill>
              </div>
              {next.personnelOnConsole?.length > 0 && (
                <div className="mt-4">
                  <div className="text-xs font-semibold uppercase text-slate-500 dark:text-slate-400">On Console</div>
                  <div className="mt-1 flex flex-wrap gap-2 text-xs">
                    {next.personnelOnConsole.map((p: any) => (
                      <span key={p.id} className="rounded-full bg-slate-100 px-2.5 py-1 dark:bg-slate-800">
                        {p.name} · {p.role}
                      </span>
                    ))}
                  </div>
                </div>
              )}
              <Link
                to={`/missions/${next.missionId}`}
                className="mt-4 inline-block rounded-md bg-aat-accent px-4 py-2 text-sm font-semibold text-white hover:bg-aat-accent/90"
              >
                Open Mission Console
              </Link>
            </div>
            <div className="flex flex-col items-center justify-center rounded-xl bg-aat-navy px-8 py-6 text-white">
              <div className="text-[11px] uppercase tracking-widest text-slate-400">
                {countdown?.isPast ? "Elapsed" : "Countdown"}
              </div>
              <div className="font-mono text-4xl font-bold tabular-nums">{countdown?.text}</div>
            </div>
          </div>
        ) : (
          <div className="text-sm text-slate-500 dark:text-slate-400">No mission currently has a confirmed Target Launch Opportunity.</div>
        )}
      </section>

      <section className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <QuickCard label="Active Missions" value={data?.activeMissionCount ?? 0} />
        <QuickCard label="Open Action Items" value={data?.openActionItemCount ?? 0} accent={data?.openActionItemCount > 0} />
        <QuickCard label="FAA Checklist Status" value={next ? "See mission" : "N/A"} small />
      </section>

      <section className="card p-6">
        <div className="mb-3 text-xs font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400">Recent Document Activity</div>
        <div className="divide-y divide-slate-200 dark:divide-slate-800">
          {data?.recentDocuments?.length ? (
            data.recentDocuments.map((doc: any) => (
              <div key={doc.id} className="flex items-center justify-between py-2 text-sm">
                <div>
                  <div className="font-medium">{doc.title}</div>
                  <div className="text-xs text-slate-500 dark:text-slate-400">{doc.category}</div>
                </div>
                <div className="text-right text-xs text-slate-500 dark:text-slate-400">
                  <div>{doc.uploadedBy?.name}</div>
                  <div>{formatTimestamp(doc.updatedAt, useZulu)}</div>
                </div>
              </div>
            ))
          ) : (
            <div className="py-4 text-sm text-slate-500 dark:text-slate-400">No document activity yet.</div>
          )}
        </div>
      </section>
    </div>
  );
}

function QuickCard({ label, value, accent, small }: { label: string; value: React.ReactNode; accent?: boolean; small?: boolean }) {
  return (
    <div className="card p-5">
      <div className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">{label}</div>
      <div className={`mt-2 font-bold ${small ? "text-lg" : "text-3xl"} ${accent ? "text-aat-caution" : ""}`}>{value}</div>
    </div>
  );
}
