import React, { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { fetchMissions, generateMetocMef, uploadDocument } from "../../api/resources";
import type { MetocLocationParams } from "../../api/resources";
import { buildMefPdf, mefFileName } from "../../lib/metoc/mefPdfExport";
import { METOC_MEF_CATEGORY } from "../../types";

// v8.0 Sections 4-6, corrected by v8.1 Section 4 - the Unofficial MEF
// Generator. This subtab has no location control of its own; it reads
// whatever location is currently loaded via the page-level persistent
// selector (v8.1 Section 1) and shows a confirmation line only.

function todayStr(): string {
  return new Date().toISOString().slice(0, 10);
}
function addDays(dateStr: string, n: number): string {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

type GenState = "idle" | "generating" | "uploading" | "done" | "error";

export default function MefGeneratorTab({
  loc,
  locationLabel,
  coordsLabel,
}: {
  loc: MetocLocationParams;
  locationLabel: string;
  coordsLabel: string;
}) {
  const [mode, setMode] = useState<"range" | "mission">("range");
  const [startDate, setStartDate] = useState(todayStr());
  const [durationDays, setDurationDays] = useState(1);
  const [missionId, setMissionId] = useState("");
  const [state, setState] = useState<GenState>("idle");
  const [error, setError] = useState<string | null>(null);

  const { data: missions } = useQuery({ queryKey: ["missions", {}], queryFn: () => fetchMissions() });

  const horizonEnd = addDays(todayStr(), 6);

  // v8.0 Section 4.2 - only missions whose Launch Period's every day falls
  // within the next 7 days are selectable (partial coverage would mean
  // detailed forecast data isn't available for the whole span).
  const eligibleMissions = useMemo(() => {
    return (missions ?? []).filter((m) => {
      const entries = (m as any).launchPeriodEntries ?? [];
      if (entries.length === 0) return false;
      return entries.every((e: any) => {
        const key = new Date(e.date).toISOString().slice(0, 10);
        return key >= todayStr() && key <= horizonEnd;
      });
    });
  }, [missions, horizonEnd]);

  const endDate = addDays(startDate, durationDays - 1);
  const rangeValid = startDate >= todayStr() && endDate <= horizonEnd && durationDays >= 1 && durationDays <= 5;

  async function handleGenerate() {
    setError(null);
    setState("generating");
    const tab = window.open("", "_blank");
    try {
      const body =
        mode === "range"
          ? { ...loc, mode: "range" as const, startDate, endDate }
          : { ...loc, mode: "mission" as const, missionId };
      const mef = await generateMetocMef(body);
      const doc = buildMefPdf(mef);
      const blob = doc.output("blob");
      const url = URL.createObjectURL(blob);
      if (tab) tab.location.href = url;
      else window.open(url, "_blank");
      setTimeout(() => URL.revokeObjectURL(url), 5 * 60_000);

      setState("uploading");
      const fileName = mefFileName(mef);
      const formData = new FormData();
      formData.append("file", blob, fileName);
      formData.append("title", fileName.replace(/\.pdf$/, ""));
      formData.append("category", METOC_MEF_CATEGORY);
      if (mode === "mission" && missionId) formData.append("missionId", missionId);
      formData.append("tags", "METOC,Unofficial MEF");
      await uploadDocument(formData);

      setState("done");
      setTimeout(() => setState("idle"), 3000);
    } catch (err: any) {
      tab?.close();
      setError(err?.response?.data?.error ?? err?.message ?? "MEF generation failed");
      setState("error");
    }
  }

  const canGenerate = mode === "range" ? rangeValid : !!missionId;

  const labels: Record<GenState, string> = {
    idle: "Generate Unofficial MEF",
    generating: "Generating Forecast Discussion (AI)...",
    uploading: "Archiving to Documentation Library...",
    done: "Generated ✓",
    error: "Generate Unofficial MEF (Retry)",
  };

  return (
    <div className="space-y-4">
      <section className="card p-5">
        <div className="mb-3 border border-slate-300 bg-slate-50 p-3 font-mono text-xs dark:border-slate-700 dark:bg-slate-900">
          WEATHER DATA SOURCED FROM: {locationLabel || "MANUAL COORDINATES"} — {coordsLabel}
        </div>

        <div className="mb-4 flex gap-4 text-sm">
          <label className="flex items-center gap-1.5">
            <input type="radio" checked={mode === "range"} onChange={() => setMode("range")} />
            Manual Date Range
          </label>
          <label className="flex items-center gap-1.5">
            <input type="radio" checked={mode === "mission"} onChange={() => setMode("mission")} />
            Mission Launch Period
          </label>
        </div>

        {mode === "range" ? (
          <div className="flex flex-wrap items-center gap-3">
            <label className="text-xs text-slate-500 dark:text-slate-400">
              Start Date
              <input
                type="date"
                value={startDate}
                min={todayStr()}
                max={horizonEnd}
                onChange={(e) => setStartDate(e.target.value)}
                className="input mt-1 block"
              />
            </label>
            <label className="text-xs text-slate-500 dark:text-slate-400">
              Duration (Days)
              <select value={durationDays} onChange={(e) => setDurationDays(Number(e.target.value))} className="input mt-1 block w-24">
                {[1, 2, 3, 4, 5].map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </select>
            </label>
            <div className="text-xs text-slate-500 dark:text-slate-400">
              Covers <span className="font-mono">{startDate}</span> through <span className="font-mono">{endDate}</span>
              {!rangeValid && <span className="ml-2 text-aat-nogo">— must fall within the next 7 days</span>}
            </div>
          </div>
        ) : (
          <div>
            <select value={missionId} onChange={(e) => setMissionId(e.target.value)} className="input w-96">
              <option value="">Select a mission...</option>
              {eligibleMissions.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.designator} — {m.name}
                </option>
              ))}
            </select>
            {eligibleMissions.length === 0 && (
              <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">
                No mission currently has a Launch Period falling entirely within the next 7 days.
              </p>
            )}
          </div>
        )}

        <div className="mt-4 flex items-center gap-3">
          <button
            onClick={handleGenerate}
            disabled={!canGenerate || state === "generating" || state === "uploading"}
            className="btn-primary disabled:opacity-50"
          >
            {labels[state]}
          </button>
          {error && <span className="text-xs text-aat-nogo">{error}</span>}
        </div>
      </section>
    </div>
  );
}
