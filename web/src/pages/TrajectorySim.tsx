import React, { useState } from "react";
import ConfigForm from "../components/trajectory/ConfigForm";
import ResultsView from "../components/trajectory/ResultsView";
import type { RunMeta } from "../lib/trajectory/formConfig";
import type { SimConfig, SimResult } from "../lib/trajectory/types";

// v6.0 Section 2 - three-state flow: Landing -> Setup (config form) ->
// Results, the last of which is the only full-screen/chrome-collapsed mode
// (handled inside ResultsView, identical mechanism to Range Ops Display).
// Setup mode uses the standard app layout, so this page is routed inside
// <Layout> like every other module page.
type Mode = "landing" | "setup" | "results";

export default function TrajectorySim() {
  const [mode, setMode] = useState<Mode>("landing");
  const [run, setRun] = useState<{ config: SimConfig; meta: RunMeta; result: SimResult } | null>(null);

  function handleRunComplete(config: SimConfig, meta: RunMeta, result: SimResult) {
    setRun({ config, meta, result });
    setMode("results");
  }

  function handleRestart() {
    setRun(null);
    setMode("landing");
  }

  if (mode === "results" && run) {
    return <ResultsView config={run.config} meta={run.meta} result={run.result} onRestart={handleRestart} />;
  }

  if (mode === "setup") {
    return <ConfigForm onSubmit={handleRunComplete} onCancel={() => setMode("landing")} />;
  }

  return (
    <div className="flex h-full flex-col items-center justify-center gap-6 px-6 py-16 text-center">
      <img src="/logo.webp" alt="American Aerospace" className="h-16 w-auto" />
      <div>
        <h1 className="text-2xl font-bold uppercase tracking-wide">Trajectory Simulations</h1>
        <p className="no-uppercase mx-auto mt-2 max-w-lg text-sm text-zinc-400">
          Simplified point-mass trajectory modeling for mission planning and illustrative range safety purposes.
        </p>
      </div>
      <button onClick={() => setMode("setup")} className="btn-primary">
        Begin New Simulation
      </button>
    </div>
  );
}
