import React, { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { fetchCoas, fetchSites, fetchVehicles } from "../../api/resources";
import {
  DEFAULT_ASCENT_CD,
  DEFAULT_DROGUE_CD,
  DEFAULT_GUIDED_CD,
  DEFAULT_MAIN_CD,
  emptyFormState,
  parseAltitudeLimitFeet,
  runFullSimulation,
  validateAndBuildConfig,
  type ActiveCoaInfo,
  type DescentKind,
  type MapType,
  type TrajectoryFormState,
} from "../../lib/trajectory/formConfig";
import type { SimConfig } from "../../lib/trajectory/types";
import type { RunMeta } from "../../lib/trajectory/formConfig";

// v6.0 Section 4 - the six-section configuration form. All physics-relevant
// parsing/validation lives in lib/trajectory/formConfig.ts; this component
// is purely the controlled-input UI plus the Section 4.4 COA auto-pull
// wiring, which needs live query data this module doesn't have access to.

const MAP_TYPES: { key: MapType; label: string }[] = [
  { key: "street", label: "Street" },
  { key: "satellite", label: "Satellite" },
  { key: "topo", label: "Topographic" },
  { key: "aviation", label: "Aviation" },
];

const DESCENT_OPTIONS: { key: DescentKind; title: string; description: string }[] = [
  { key: "A", title: "A. Main Chute Only", description: "Single deployment at apogee." },
  { key: "B", title: "B. Dual-Deploy", description: "Drogue at apogee; main at a specified altitude." },
  { key: "C", title: "C. Guided Descent (Airbrake/Fin-Modulated)", description: "Modulated drag from apogee to a specified altitude, then main." },
  { key: "D", title: "D. Ballistic (No Recovery Deployment)", description: "No recovery system activates. Worst-case, high-velocity impact." },
  { key: "E", title: "E. Custom Descent Profile", description: "Single Cd/area applied continuously from apogee to touchdown." },
];

const CONFIRMATION_TEXT =
  "I acknowledge that this Trajectory Simulation is a point-mass model. This simulation is provided for mission planning, general range safety, and illustrative purposes only and does not constitute a complete certified flight dynamics analysis or a certified range safety determination. This simulation should be used in conjunction with dynamics analysis and official safety determinations. I have reviewed the input parameters entered above for accuracy and elect to proceed.";

function Field({ label, unit, children, required }: { label: string; unit?: string; children: React.ReactNode; required?: boolean }) {
  return (
    <div>
      <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-zinc-500">
        {label} {unit ? <span className="text-zinc-600">({unit})</span> : null} {required ? <span className="text-aat-nogo">*</span> : null}
      </label>
      {children}
    </div>
  );
}

export interface ConfigFormProps {
  onSubmit: (config: SimConfig, meta: RunMeta, result: import("../../lib/trajectory/types").SimResult) => void;
  onCancel: () => void;
}

export default function ConfigForm({ onSubmit, onCancel }: ConfigFormProps) {
  const [form, setForm] = useState<TrajectoryFormState>(emptyFormState());
  const [populatedVehicleName, setPopulatedVehicleName] = useState<string | null>(null);
  const [errors, setErrors] = useState<string[]>([]);
  const [running, setRunning] = useState(false);

  const set = <K extends keyof TrajectoryFormState>(key: K, value: TrajectoryFormState[K]) => setForm((f) => ({ ...f, [key]: value }));

  const { data: vehicles } = useQuery({ queryKey: ["vehicles"], queryFn: fetchVehicles });
  const { data: sites } = useQuery({ queryKey: ["sites"], queryFn: fetchSites });
  const { data: siteCoas } = useQuery({
    queryKey: ["coas", form.siteId],
    queryFn: () => fetchCoas(form.siteId),
    enabled: !!form.siteId,
  });

  const selectedSite = useMemo(() => sites?.find((s) => s.id === form.siteId) ?? null, [sites, form.siteId]);
  const activeCoa = useMemo(() => siteCoas?.find((c) => c.status === "ACTIVE") ?? null, [siteCoas]);

  function handlePopulate() {
    const vehicle = vehicles?.find((v) => v.id === form.populateVehicleId);
    if (!vehicle) return;
    setForm((f) => ({
      ...f,
      wetMassKg: vehicle.wetMassKg != null ? String(vehicle.wetMassKg) : f.wetMassKg,
      dryMassKg: vehicle.dryMassKg != null ? String(vehicle.dryMassKg) : f.dryMassKg,
      referenceDiameter: vehicle.diameterIn != null ? String(vehicle.diameterIn) : f.referenceDiameter,
      referenceDiameterUnit: vehicle.diameterIn != null ? "in" : f.referenceDiameterUnit,
      totalImpulseNs: vehicle.totalImpulseNs != null ? String(vehicle.totalImpulseNs) : f.totalImpulseNs,
      burnTimeS: vehicle.burnTimeSeconds != null ? String(vehicle.burnTimeSeconds) : f.burnTimeS,
    }));
    setPopulatedVehicleName(vehicle.name);
  }

  function handleSubmit() {
    const coaInfo: ActiveCoaInfo | null = activeCoa
      ? {
          authorizedOperationRadiusNm: activeCoa.authorizedOperationRadiusNm,
          altitudeLimits: activeCoa.altitudeLimits,
          altitudeLimitFeet: parseAltitudeLimitFeet(activeCoa.altitudeLimits),
        }
      : null;

    const result = validateAndBuildConfig(form, selectedSite, coaInfo, populatedVehicleName);
    if (!result.ok) {
      setErrors(result.errors);
      return;
    }
    setErrors([]);
    setRunning(true);
    // Synchronous but potentially heavy (thousands of RK4 steps); yield a
    // frame so the "Running..." state actually paints before it blocks.
    requestAnimationFrame(() => {
      const simResult = runFullSimulation(result.config);
      onSubmit(result.config, { ...result.meta, runAt: new Date().toISOString() }, simResult);
      setRunning(false);
    });
  }

  return (
    <div className="mx-auto max-w-4xl space-y-6 px-6 py-8">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold uppercase tracking-wide">Configure Trajectory Simulation</h1>
        <button onClick={onCancel} className="btn-secondary">
          Cancel
        </button>
      </div>

      {errors.length > 0 && (
        <div className="card border-2 border-aat-nogo/60 bg-aat-nogo/5 p-4">
          <div className="mb-2 text-xs font-bold uppercase tracking-wide text-aat-nogo">Correct the following before proceeding:</div>
          <ul className="list-inside list-disc space-y-1 text-xs text-zinc-300">
            {errors.map((e, i) => (
              <li key={i}>{e}</li>
            ))}
          </ul>
        </div>
      )}

      {/* Section (i) - Vehicle Information */}
      <section className="card space-y-4 p-5">
        <h2 className="text-sm font-bold uppercase tracking-wide text-zinc-300">(i) Vehicle Information</h2>

        <div className="flex flex-wrap items-end gap-2 border border-zinc-800 bg-zinc-950/50 p-3">
          <div className="flex-1 min-w-[240px]">
            <Field label="Populate from Vehicle Registry (optional)">
              <select className="input" value={form.populateVehicleId} onChange={(e) => set("populateVehicleId", e.target.value)}>
                <option value="">Select a vehicle...</option>
                {vehicles?.map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.name} {v.designator ? `(${v.designator})` : ""}
                  </option>
                ))}
              </select>
            </Field>
          </div>
          <button type="button" onClick={handlePopulate} disabled={!form.populateVehicleId} className="btn-secondary disabled:opacity-40">
            Populate
          </button>
          {populatedVehicleName && <span className="text-xs text-zinc-500">Populated from: {populatedVehicleName}</span>}
        </div>

        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
          <Field label="Wet Mass (Launch Mass)" unit="kg" required>
            <input className="input" type="number" value={form.wetMassKg} onChange={(e) => set("wetMassKg", e.target.value)} />
          </Field>
          <Field label="Dry Mass (Burnout Mass)" unit="kg" required>
            <input className="input" type="number" value={form.dryMassKg} onChange={(e) => set("dryMassKg", e.target.value)} />
          </Field>
          <Field label="Total Impulse" unit="N·s" required>
            <input className="input" type="number" value={form.totalImpulseNs} onChange={(e) => set("totalImpulseNs", e.target.value)} />
          </Field>
          <Field label="Burn Time" unit="s" required>
            <input className="input" type="number" value={form.burnTimeS} onChange={(e) => set("burnTimeS", e.target.value)} />
          </Field>
          <Field label="Reference Diameter" required>
            <div className="flex gap-1">
              <input className="input" type="number" value={form.referenceDiameter} onChange={(e) => set("referenceDiameter", e.target.value)} />
              <select className="input w-20" value={form.referenceDiameterUnit} onChange={(e) => set("referenceDiameterUnit", e.target.value as any)}>
                <option value="m">m</option>
                <option value="cm">cm</option>
                <option value="in">in</option>
              </select>
            </div>
          </Field>
          <Field label={`Drag Coefficient (Cd) — Ascent (optional, default ${DEFAULT_ASCENT_CD})`}>
            <input className="input" type="number" value={form.dragCoefficient} onChange={(e) => set("dragCoefficient", e.target.value)} />
          </Field>
          <Field label="Launch Rail/Rod Angle" unit="deg from vertical" required>
            <input className="input" type="number" value={form.railAngleDeg} onChange={(e) => set("railAngleDeg", e.target.value)} />
          </Field>
          <Field label="Launch Azimuth" unit="deg from true north" required>
            <input className="input" type="number" value={form.launchAzimuthDeg} onChange={(e) => set("launchAzimuthDeg", e.target.value)} />
          </Field>
        </div>
      </section>

      {/* Section (ii) - Descent Configuration */}
      <section className="card space-y-4 p-5">
        <h2 className="text-sm font-bold uppercase tracking-wide text-zinc-300">(ii) Descent Configuration</h2>
        <div className="space-y-2">
          {DESCENT_OPTIONS.map((opt) => (
            <label key={opt.key} className={`flex cursor-pointer items-start gap-3 border p-3 ${form.descentKind === opt.key ? "border-aat-caution bg-aat-caution/5" : "border-zinc-800"}`}>
              <input type="radio" className="mt-1 shrink-0" checked={form.descentKind === opt.key} onChange={() => set("descentKind", opt.key)} />
              <div>
                <div className="text-xs font-bold uppercase tracking-wide">{opt.title}</div>
                <div className="no-uppercase text-xs text-zinc-400">{opt.description}</div>
              </div>
            </label>
          ))}
        </div>

        {(form.descentKind === "A" || form.descentKind === "B" || form.descentKind === "C") && (
          <div className="grid grid-cols-2 gap-4 border-t border-zinc-800 pt-4 sm:grid-cols-3">
            <Field label={`Main Chute Cd (optional, default ${DEFAULT_MAIN_CD})`}>
              <input className="input" type="number" value={form.mainCd} onChange={(e) => set("mainCd", e.target.value)} />
            </Field>
            <Field label="Main Chute Reference Area" unit="m²" required>
              <input className="input" type="number" value={form.mainArea} onChange={(e) => set("mainArea", e.target.value)} />
            </Field>
          </div>
        )}

        {form.descentKind === "B" && (
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
            <Field label={`Drogue Cd (optional, default ${DEFAULT_DROGUE_CD})`}>
              <input className="input" type="number" value={form.drogueCd} onChange={(e) => set("drogueCd", e.target.value)} />
            </Field>
            <Field label="Drogue Reference Area" unit="m²" required>
              <input className="input" type="number" value={form.drogueArea} onChange={(e) => set("drogueArea", e.target.value)} />
            </Field>
            <Field label="Main Deploy Altitude" unit="m AGL" required>
              <input className="input" type="number" value={form.mainDeployAltitudeM} onChange={(e) => set("mainDeployAltitudeM", e.target.value)} />
            </Field>
          </div>
        )}

        {form.descentKind === "C" && (
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
            <Field label={`Guided-Descent Cd (optional, default ${DEFAULT_GUIDED_CD})`}>
              <input className="input" type="number" value={form.guidedCd} onChange={(e) => set("guidedCd", e.target.value)} />
            </Field>
            <Field label="Guided-Descent Reference Area (optional, defaults to vehicle reference area)" unit="m²">
              <input className="input" type="number" value={form.guidedArea} onChange={(e) => set("guidedArea", e.target.value)} />
            </Field>
            <Field label="Main Deploy Altitude" unit="m AGL" required>
              <input className="input" type="number" value={form.mainDeployAltitudeM} onChange={(e) => set("mainDeployAltitudeM", e.target.value)} />
            </Field>
          </div>
        )}

        {form.descentKind === "E" && (
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
            <Field label="Custom Descent Cd" required>
              <input className="input" type="number" value={form.customCd} onChange={(e) => set("customCd", e.target.value)} />
            </Field>
            <Field label="Custom Descent Reference Area" unit="m²" required>
              <input className="input" type="number" value={form.customArea} onChange={(e) => set("customArea", e.target.value)} />
            </Field>
          </div>
        )}
      </section>

      {/* Section (iii) - Weather */}
      <section className="card space-y-4 p-5">
        <h2 className="text-sm font-bold uppercase tracking-wide text-zinc-300">(iii) Weather</h2>
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <Field label="Surface Wind Speed" unit="kts" required>
            <input className="input" type="number" value={form.surfaceWindSpeedKts} onChange={(e) => set("surfaceWindSpeedKts", e.target.value)} />
          </Field>
          <Field label="Surface Wind Direction" unit="deg, from" required>
            <input className="input" type="number" value={form.surfaceWindDirDeg} onChange={(e) => set("surfaceWindDirDeg", e.target.value)} />
          </Field>
          <Field label="Surface Temperature (optional, default 59)" unit="°F">
            <input className="input" type="number" value={form.surfaceTempF} onChange={(e) => set("surfaceTempF", e.target.value)} />
          </Field>
          <Field label="Surface Pressure (optional, default 29.92)" unit="inHg">
            <input className="input" type="number" value={form.surfacePressureInHg} onChange={(e) => set("surfacePressureInHg", e.target.value)} />
          </Field>

          <Field label="Wind Speed @ 25% Apogee (optional)" unit="kts">
            <input className="input" type="number" value={form.wind25SpeedKts} onChange={(e) => set("wind25SpeedKts", e.target.value)} />
          </Field>
          <Field label="Wind Direction @ 25% Apogee (optional)" unit="deg, from">
            <input className="input" type="number" value={form.wind25DirDeg} onChange={(e) => set("wind25DirDeg", e.target.value)} />
          </Field>
          <Field label="Wind Speed @ 50% Apogee (optional)" unit="kts">
            <input className="input" type="number" value={form.wind50SpeedKts} onChange={(e) => set("wind50SpeedKts", e.target.value)} />
          </Field>
          <Field label="Wind Direction @ 50% Apogee (optional)" unit="deg, from">
            <input className="input" type="number" value={form.wind50DirDeg} onChange={(e) => set("wind50DirDeg", e.target.value)} />
          </Field>
          <Field label="Wind Speed @ 100% Apogee (optional)" unit="kts">
            <input className="input" type="number" value={form.wind100SpeedKts} onChange={(e) => set("wind100SpeedKts", e.target.value)} />
          </Field>
          <Field label="Wind Direction @ 100% Apogee (optional)" unit="deg, from">
            <input className="input" type="number" value={form.wind100DirDeg} onChange={(e) => set("wind100DirDeg", e.target.value)} />
          </Field>
        </div>
      </section>

      {/* Section (iv) - Launch Site */}
      <section className="card space-y-3 p-5">
        <h2 className="text-sm font-bold uppercase tracking-wide text-zinc-300">(iv) Launch Site</h2>
        <Field label="Launch Site" required>
          <select className="input" value={form.siteId} onChange={(e) => set("siteId", e.target.value)}>
            <option value="">Select a launch site...</option>
            {sites?.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name} ({s.designator})
              </option>
            ))}
          </select>
        </Field>
        {form.siteId &&
          (activeCoa ? (
            <div className="border border-zinc-800 bg-zinc-950/50 p-3 text-xs text-zinc-300">
              <div>
                Authorized Operation Radius: <span className="font-mono">{activeCoa.authorizedOperationRadiusNm} nm</span>
              </div>
              <div>
                Altitude Limit: <span className="font-mono">{activeCoa.altitudeLimits}</span>
              </div>
            </div>
          ) : (
            <p className="no-uppercase text-xs text-aat-caution">
              No active COA on file for this site — COA radius/altitude constraints will not be displayed in this simulation.
            </p>
          ))}
      </section>

      {/* Section (v) - Map Type */}
      <section className="card space-y-3 p-5">
        <h2 className="text-sm font-bold uppercase tracking-wide text-zinc-300">(v) Map Type</h2>
        <div className="flex flex-wrap gap-2">
          {MAP_TYPES.map((mt) => (
            <label key={mt.key} className={`cursor-pointer border px-4 py-2 text-xs font-semibold uppercase tracking-wide ${form.mapType === mt.key ? "border-aat-caution bg-aat-caution/10" : "border-zinc-700"}`}>
              <input type="radio" className="mr-2" checked={form.mapType === mt.key} onChange={() => set("mapType", mt.key)} />
              {mt.label}
            </label>
          ))}
        </div>
      </section>

      {/* Section (vi) - Confirmation */}
      <section className="card space-y-3 p-5">
        <h2 className="text-sm font-bold uppercase tracking-wide text-zinc-300">(vi) Confirmation</h2>
        <label className="flex items-start gap-3 text-xs">
          <input type="checkbox" className="mt-0.5 shrink-0" checked={form.confirmed} onChange={(e) => set("confirmed", e.target.checked)} />
          <span className="no-uppercase text-zinc-300">{CONFIRMATION_TEXT}</span>
        </label>
      </section>

      <div className="flex justify-end gap-2 pb-8">
        <button onClick={onCancel} className="btn-secondary">
          Cancel
        </button>
        <button onClick={handleSubmit} disabled={!form.confirmed || running} className="btn-primary disabled:opacity-40">
          {running ? "Running Simulation..." : "Begin Simulation"}
        </button>
      </div>
    </div>
  );
}
