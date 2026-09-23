import React, { useEffect, useMemo, useRef, useState } from "react";
import ClassificationFooter from "../ClassificationFooter";
import Chart from "./Chart";
import Scene3D, { type Scene3DHandle } from "./Scene3D";
import RawDataTable from "./RawDataTable";
import PredictedLandingTable from "./PredictedLandingTable";
import ExportSimulationButton from "./ExportSimulationButton";
import { thrustAt } from "../../lib/trajectory/physics";
import { PHASE_LABELS, EVENT_LABELS } from "../../lib/trajectory/labels";
import type { RunMeta } from "../../lib/trajectory/formConfig";
import type { SimConfig, SimResult } from "../../lib/trajectory/types";

// v6.0 Section 6 - Results view. Full-screen/chrome-collapsed, identical
// mechanism to Range Ops Display (v5.1 Section 3): same browser Fullscreen
// API pattern, same exit control, same compact persistent footer treatment.
export interface ResultsViewProps {
  config: SimConfig;
  meta: RunMeta;
  result: SimResult;
  onRestart: () => void;
}

function findNearestIndexByTime(timeSeries: SimResult["timeSeries"], t: number): number {
  let lo = 0;
  let hi = timeSeries.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (timeSeries[mid].tS < t) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

export default function ResultsView({ config, meta, result, onRestart }: ResultsViewProps) {
  const [isFullscreen, setIsFullscreen] = useState(!!document.fullscreenElement);
  const [scrubIndex, setScrubIndex] = useState(0);
  const sceneRef = useRef<Scene3DHandle>(null);
  const chartRefs = useRef<Record<string, HTMLDivElement | null>>({});

  useEffect(() => {
    document.documentElement.requestFullscreen?.().catch(() => {});
    const onChange = () => setIsFullscreen(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, []);

  function toggleFullscreen() {
    if (document.fullscreenElement) {
      document.exitFullscreen().catch(() => {});
    } else {
      document.documentElement.requestFullscreen().catch(() => {});
    }
  }

  function handleRestart() {
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    onRestart();
  }

  function scrubToTime(t: number) {
    setScrubIndex(findNearestIndexByTime(result.timeSeries, t));
  }

  const current = result.timeSeries[scrubIndex] ?? result.timeSeries[0];
  const maxVelocity = Math.max(...result.timeSeries.map((p) => p.speedMs));
  const maxMach = Math.max(...result.timeSeries.map((p) => p.mach));
  const flightDurationS = result.timeSeries[result.timeSeries.length - 1]?.tS ?? 0;
  const touchdown = result.timeSeries[result.timeSeries.length - 1];

  const coaAltLimitM = meta.activeCoa?.altitudeLimitFeet != null ? meta.activeCoa.altitudeLimitFeet * 0.3048 : null;
  const coaRadiusM = meta.activeCoa ? meta.activeCoa.authorizedOperationRadiusNm * 1852 : null;
  const coaCylinder = coaRadiusM != null && coaAltLimitM != null ? { radiusM: coaRadiusM, heightM: coaAltLimitM } : null;

  // Section 6.2 - the eleven required 2D graphs.
  const graphs = useMemo(
    () => [
      {
        title: "1. Altitude vs. Time",
        data: result.timeSeries.map((p) => ({ x: p.tS, y: p.zUpM })),
        xLabel: "Time (s)",
        yLabel: "Altitude (m)",
        hLine: coaAltLimitM != null ? { value: coaAltLimitM, label: "COA Alt Limit" } : undefined,
        timeBased: true,
      },
      { title: "2. Velocity vs. Time", data: result.timeSeries.map((p) => ({ x: p.tS, y: p.speedMs })), xLabel: "Time (s)", yLabel: "Velocity (m/s)", timeBased: true },
      { title: "3. Acceleration vs. Time", data: result.timeSeries.map((p) => ({ x: p.tS, y: p.accelMs2 })), xLabel: "Time (s)", yLabel: "Accel (m/s²)", timeBased: true },
      { title: "4. Mach Number vs. Time", data: result.timeSeries.map((p) => ({ x: p.tS, y: p.mach })), xLabel: "Time (s)", yLabel: "Mach", timeBased: true },
      { title: "5. Thrust vs. Time", data: result.timeSeries.map((p) => ({ x: p.tS, y: thrustAt(p.tS, config) })), xLabel: "Time (s)", yLabel: "Thrust (N)", timeBased: true },
      { title: "6. Mass vs. Time", data: result.timeSeries.map((p) => ({ x: p.tS, y: p.massKg })), xLabel: "Time (s)", yLabel: "Mass (kg)", timeBased: true },
      { title: "7. Dynamic Pressure (Q) vs. Time", data: result.timeSeries.map((p) => ({ x: p.tS, y: p.qPa })), xLabel: "Time (s)", yLabel: "Q (Pa)", timeBased: true },
      { title: "8. Downrange Distance vs. Time", data: result.timeSeries.map((p) => ({ x: p.tS, y: p.downrangeM })), xLabel: "Time (s)", yLabel: "Downrange (m)", timeBased: true },
      { title: "9. Crossrange Distance vs. Time", data: result.timeSeries.map((p) => ({ x: p.tS, y: p.crossrangeM })), xLabel: "Time (s)", yLabel: "Crossrange (m)", timeBased: true },
      {
        title: "10. Altitude vs. Downrange Distance",
        data: result.timeSeries.map((p) => ({ x: p.downrangeM, y: p.zUpM })),
        xLabel: "Downrange (m)",
        yLabel: "Altitude (m)",
        hLine: coaAltLimitM != null ? { value: coaAltLimitM, label: "COA Alt Limit" } : undefined,
        timeBased: false,
      },
      {
        title: "11. Ground Track — Downrange vs. Crossrange",
        data: result.timeSeries.map((p) => ({ x: p.downrangeM, y: p.crossrangeM })),
        xLabel: "Downrange (m)",
        yLabel: "Crossrange (m)",
        circleOverlay: coaRadiusM != null ? { radiusM: coaRadiusM } : undefined,
        timeBased: false,
      },
    ],
    [result, config, coaAltLimitM, coaRadiusM]
  );

  return (
    <div className="fixed inset-0 z-[1000] flex h-screen w-full flex-col overflow-hidden bg-black text-zinc-100">
      <div className="flex shrink-0 items-center justify-between gap-4 border-b border-zinc-800 px-4 py-2">
        <div className="flex items-center gap-3">
          <img src="/logo.webp" alt="American Aerospace" className="h-6 w-auto" />
          <div className="text-sm font-semibold uppercase tracking-wide text-zinc-300">
            Trajectory Simulation — {meta.populatedVehicleName ?? "Unspecified Vehicle"} — {meta.siteDesignator}
          </div>
        </div>
        <div className="flex items-center gap-3">
          <ExportSimulationButton config={config} meta={meta} result={result} sceneRef={sceneRef} chartRefs={chartRefs} />
          <button onClick={toggleFullscreen} className="border border-zinc-700 px-2.5 py-1.5 text-xs font-semibold text-zinc-400 hover:border-zinc-500 hover:text-zinc-200">
            {isFullscreen ? "⤢ Exit Full Screen" : "⛶ Full Screen"}
          </button>
          <button onClick={handleRestart} className="border border-aat-nogo px-2.5 py-1.5 text-xs font-semibold text-aat-nogo hover:bg-aat-nogo/10">
            ✕ Restart Simulation
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-6 py-6">
        <div className="mx-auto max-w-[1700px] space-y-6">
          {/* Quick stats */}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
            <Stat label="Apogee Altitude" value={`${result.apogeeAltitudeM.toFixed(0)} m`} />
            <Stat label="Apogee Time" value={`T+${result.apogeeTimeS.toFixed(1)}s`} />
            <Stat label="Max Velocity" value={`${maxVelocity.toFixed(1)} m/s`} />
            <Stat label="Max Mach" value={maxMach.toFixed(2)} />
            <Stat label="Flight Duration" value={`${flightDurationS.toFixed(1)} s`} />
            <Stat label="Touchdown Downrange" value={`${touchdown?.downrangeM.toFixed(0) ?? 0} m`} />
          </div>

          {/* Master Scrub Control - Section 6.4, the single control driving
              the 3D marker, every graph's cursor, and the Raw Data table. */}
          <section className="card space-y-2 p-4">
            <div className="flex items-center justify-between">
              <div className="text-xs font-bold uppercase tracking-wide text-zinc-400">Master Scrub Control</div>
              <div className="font-mono text-xs text-zinc-300">
                T+{current.tS.toFixed(2)}s — <span className="text-aat-caution">{PHASE_LABELS[current.phase]}</span>
              </div>
            </div>
            <input
              type="range"
              min={0}
              max={result.timeSeries.length - 1}
              value={scrubIndex}
              onChange={(e) => setScrubIndex(Number(e.target.value))}
              className="w-full accent-aat-caution"
            />
          </section>

          {/* 3D Visualization - Section 6.1 */}
          <section className="card p-4">
            <div className="mb-3 text-xs font-bold uppercase tracking-wide text-zinc-400">3D Visualization</div>
            <div className="h-[520px] w-full border border-zinc-800">
              <Scene3D ref={sceneRef} timeSeries={result.timeSeries} scrubIndex={scrubIndex} mapType={meta.mapType} coaCylinder={coaCylinder} />
            </div>
          </section>

          {/* 2D Graphs - Section 6.2 */}
          <section className="space-y-3">
            <div className="text-xs font-bold uppercase tracking-wide text-zinc-400">Flight Data Graphs</div>
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2 xl:grid-cols-3">
              {graphs.map((g) => (
                <div key={g.title} ref={(el) => (chartRefs.current[g.title] = el)} className="card p-3">
                  <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-zinc-400">{g.title}</div>
                  <Chart
                    data={g.data}
                    xLabel={g.xLabel}
                    yLabel={g.yLabel}
                    hLine={g.hLine}
                    circleOverlay={g.circleOverlay}
                    cursorX={g.timeBased ? current.tS : undefined}
                    cursorPoint={!g.timeBased ? { x: g.data[scrubIndex]?.x ?? 0, y: g.data[scrubIndex]?.y ?? 0 } : undefined}
                    onScrub={g.timeBased ? scrubToTime : undefined}
                  />
                </div>
              ))}
            </div>
          </section>

          {/* Tables - Section 6.3 */}
          <section className="card overflow-x-auto p-4">
            <div className="mb-3 text-xs font-bold uppercase tracking-wide text-zinc-400">Phase Summary</div>
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-zinc-800 text-zinc-500">
                  <th className="py-1.5 pr-4">Phase</th>
                  <th className="py-1.5 pr-4">Start (s)</th>
                  <th className="py-1.5 pr-4">End (s)</th>
                  <th className="py-1.5 pr-4">Duration (s)</th>
                  <th className="py-1.5 pr-4">Start Alt (m)</th>
                  <th className="py-1.5 pr-4">End Alt (m)</th>
                  <th className="py-1.5 pr-4">Max Velocity (m/s)</th>
                </tr>
              </thead>
              <tbody className="font-mono">
                {result.phaseSummaries.map((p, i) => (
                  <tr key={i} className="border-b border-zinc-900">
                    <td className="py-1.5 pr-4 font-sans uppercase">{PHASE_LABELS[p.phase]}</td>
                    <td className="py-1.5 pr-4">{p.startS.toFixed(2)}</td>
                    <td className="py-1.5 pr-4">{p.endS.toFixed(2)}</td>
                    <td className="py-1.5 pr-4">{p.durationS.toFixed(2)}</td>
                    <td className="py-1.5 pr-4">{p.startAltitudeM.toFixed(1)}</td>
                    <td className="py-1.5 pr-4">{p.endAltitudeM.toFixed(1)}</td>
                    <td className="py-1.5 pr-4">{p.maxVelocityMs.toFixed(1)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>

          <section className="card overflow-x-auto p-4">
            <div className="mb-3 text-xs font-bold uppercase tracking-wide text-zinc-400">Key Events</div>
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-zinc-800 text-zinc-500">
                  <th className="py-1.5 pr-4">Event</th>
                  <th className="py-1.5 pr-4">Time (s)</th>
                  <th className="py-1.5 pr-4">Altitude (m)</th>
                  <th className="py-1.5 pr-4">Velocity (m/s)</th>
                  <th className="py-1.5 pr-4">Downrange (m)</th>
                </tr>
              </thead>
              <tbody className="font-mono">
                {result.events.map((e, i) => (
                  <tr key={i} className="cursor-pointer border-b border-zinc-900 hover:bg-zinc-900" onClick={() => scrubToTime(e.tS)}>
                    <td className="py-1.5 pr-4 font-sans uppercase">{EVENT_LABELS[e.name]}</td>
                    <td className="py-1.5 pr-4">{e.tS.toFixed(2)}</td>
                    <td className="py-1.5 pr-4">{e.altitudeM.toFixed(1)}</td>
                    <td className="py-1.5 pr-4">{e.speedMs.toFixed(1)}</td>
                    <td className="py-1.5 pr-4">{e.downrangeM.toFixed(1)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>

          {touchdown && <PredictedLandingTable touchdown={touchdown} meta={meta} />}

          <section className="card p-4">
            <div className="mb-3 text-xs font-bold uppercase tracking-wide text-zinc-400">Raw Data ({result.timeSeries.length} samples)</div>
            <RawDataTable timeSeries={result.timeSeries} scrubIndex={scrubIndex} />
          </section>
        </div>
      </div>

      {/* Section 6.7 - persistent scope disclaimer, visible for as long as
          results are being viewed. */}
      <div className="shrink-0 border-t border-aat-caution/40 bg-aat-caution/5 px-4 py-2 text-center text-[10px] text-aat-caution">
        POINT-MASS MODEL — NOT A 6-DOF FLIGHT DYNAMICS SIMULATION. FOR MISSION PLANNING AND ILLUSTRATIVE PURPOSES ONLY. NOT A CERTIFIED RANGE SAFETY
        DETERMINATION.
      </div>
      <ClassificationFooter compact />
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="card p-3">
      <div className="text-[10px] uppercase tracking-wide text-zinc-500">{label}</div>
      <div className="font-mono text-lg text-zinc-100">{value}</div>
    </div>
  );
}
