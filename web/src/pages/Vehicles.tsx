import React, { useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  createVehicle,
  fetchVehicle,
  fetchVehicles,
  updateVehicle,
  uploadDocument,
} from "../api/resources";
import { usePreferences } from "../context/PreferencesContext";
import { formatDateOnly } from "../utils/time";
import { StatusPill, missionStatusTone } from "../components/StatusPill";
import { RequireRole } from "../components/RequireRole";
import type { Vehicle } from "../types";

export default function Vehicles() {
  const { vehicleId } = useParams();
  const navigate = useNavigate();
  const { data: vehicles, isLoading } = useQuery({ queryKey: ["vehicles"], queryFn: fetchVehicles });
  const [showNew, setShowNew] = useState(false);

  if (vehicleId) return <VehicleDetail vehicleId={vehicleId} onClose={() => navigate("/vehicles")} />;

  return (
    <div className="space-y-6 p-8">
      <header className="flex items-start justify-between">
        <h1 className="text-2xl font-bold tracking-tight">Vehicle Registry</h1>
        <RequireRole roles={["ADMIN", "LAUNCH_DIRECTOR"]}>
          <button onClick={() => setShowNew(true)} className="btn-primary">
            + New Vehicle
          </button>
        </RequireRole>
      </header>

      <div className="card overflow-hidden">
        <table className="w-full text-sm">
          <thead className="border-b border-slate-200 bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500 dark:border-slate-800 dark:bg-slate-800/40 dark:text-slate-400">
            <tr>
              <th className="px-4 py-3">Vehicle</th>
              <th className="px-4 py-3">Class</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3">Missions Flown</th>
              <th className="px-4 py-3">Last Flight</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
            {isLoading && (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-slate-400">
                  Loading vehicles...
                </td>
              </tr>
            )}
            {vehicles?.map((v) => (
              <tr key={v.id} className="cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-800/40">
                <td className="px-4 py-3">
                  <Link to={`/vehicles/${v.id}`} className="font-medium text-aat-accent hover:underline">
                    {v.name}
                  </Link>
                  <div className="text-xs text-slate-500 dark:text-slate-400">{v.designator || "--"}</div>
                </td>
                <td className="px-4 py-3">{v.vehicleClass || v.type || "--"}</td>
                <td className="px-4 py-3">
                  <StatusPill tone={v.status === "ACTIVE" ? "go" : v.status === "RETIRED" ? "neutral" : "caution"}>
                    {v.status.replace("_", " ")}
                  </StatusPill>
                </td>
                <td className="px-4 py-3">{v.totalMissionsFlown ?? 0}</td>
                <td className="px-4 py-3 text-xs">{v.lastFlightDate ? formatDateOnly(v.lastFlightDate, true) : "--"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {showNew && <NewVehicleModal onClose={() => setShowNew(false)} />}
    </div>
  );
}

function NewVehicleModal({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const [form, setForm] = useState({ name: "", designator: "", vehicleClass: "", program: "" });
  const mutation = useMutation({
    mutationFn: () => createVehicle(form),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["vehicles"] });
      onClose();
    },
  });

  return (
    <div className="fixed inset-0 z-[2000] flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-md rounded-xl border border-zinc-800 bg-black p-6">
        <h2 className="mb-4 text-lg font-bold">New Vehicle</h2>
        <div className="space-y-3">
          <input placeholder="Name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="input" />
          <input
            placeholder="Designator / tail number"
            value={form.designator}
            onChange={(e) => setForm({ ...form, designator: e.target.value })}
            className="input"
          />
          <input
            placeholder="Class/type designation"
            value={form.vehicleClass}
            onChange={(e) => setForm({ ...form, vehicleClass: e.target.value })}
            className="input"
          />
          <input placeholder="Program/family" value={form.program} onChange={(e) => setForm({ ...form, program: e.target.value })} className="input" />
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <button onClick={onClose} className="btn-secondary">
            Cancel
          </button>
          <button onClick={() => mutation.mutate()} disabled={!form.name} className="btn-primary disabled:opacity-50">
            Create Vehicle
          </button>
        </div>
      </div>
    </div>
  );
}

const FIELD_GROUPS: { title: string; fields: [keyof Vehicle, string, string?][] }[] = [
  {
    title: "Identification",
    fields: [
      ["designator", "Designator / tail number"],
      ["vehicleClass", "Class/type designation"],
      ["program", "Program/family"],
    ],
  },
  {
    title: "Physical Characteristics",
    fields: [
      ["totalLengthIn", "Total length", "in"],
      ["diameterIn", "Diameter", "in"],
      ["finSpanIn", "Fin span", "in"],
      ["wetMassKg", "Wet/loaded mass", "kg"],
      ["dryMassKg", "Dry mass", "kg"],
      ["massFraction", "Mass fraction"],
    ],
  },
  {
    title: "Propulsion",
    fields: [
      ["motorType", "Motor type/designation"],
      ["motorManufacturer", "Manufacturer"],
      ["propellantType", "Propellant type"],
      ["totalImpulseNs", "Total impulse (rated)", "N·s"],
      ["burnTimeSeconds", "Burn time", "s"],
      ["avgThrustN", "Average thrust", "N"],
      ["maxThrustN", "Max thrust", "N"],
      ["specificImpulseS", "Specific impulse", "s"],
    ],
  },
  {
    title: "Staging / Configuration",
    fields: [["stageConfiguration", "Stage configuration/breakdown"]],
  },
  {
    title: "Recovery Systems",
    fields: [
      ["drogueChuteSpec", "Drogue chute spec"],
      ["mainChuteSpec", "Main chute spec"],
      ["deploymentMethod", "Deployment method/altitude"],
      ["ejectionChargeConfig", "Ejection charge configuration"],
    ],
  },
  {
    title: "Avionics",
    fields: [
      ["flightComputer", "Flight computer(s)"],
      ["telemetrySystem", "Telemetry system"],
      ["gpsTracking", "GPS tracking"],
      ["avionicsRedundancy", "Redundancy configuration"],
    ],
  },
  {
    title: "Performance (Design/Simulated)",
    fields: [
      ["predictedApogeeM", "Predicted apogee", "m"],
      ["predictedMaxVelocityMach", "Predicted max velocity", "Mach"],
      ["predictedMaxQPsf", "Predicted max Q", "psf"],
    ],
  },
];

function VehicleDetail({ vehicleId, onClose }: { vehicleId: string; onClose: () => void }) {
  const { useZulu } = usePreferences();
  const qc = useQueryClient();
  const { data: vehicle } = useQuery({ queryKey: ["vehicle", vehicleId], queryFn: () => fetchVehicle(vehicleId) });
  const [editing, setEditing] = useState(false);
  const [docFile, setDocFile] = useState<File | null>(null);
  const [docTitle, setDocTitle] = useState("");

  const uploadDoc = useMutation({
    mutationFn: () => {
      const fd = new FormData();
      fd.append("file", docFile!);
      fd.append("title", docTitle || docFile!.name);
      fd.append("category", "Vehicle Certification & Test Data");
      fd.append("vehicleId", vehicleId);
      return uploadDocument(fd);
    },
    onSuccess: () => {
      setDocFile(null);
      setDocTitle("");
      qc.invalidateQueries({ queryKey: ["vehicle", vehicleId] });
    },
  });

  if (!vehicle) return <div className="p-8 text-slate-400">Loading vehicle...</div>;

  const photos = vehicle.documents?.filter((d) => d.category === "Vehicle Certification & Test Data" && d.versions?.[0]?.mimeType?.startsWith("image/")) ?? [];
  const otherDocs = vehicle.documents?.filter((d) => !photos.includes(d)) ?? [];

  return (
    <div className="space-y-6 p-8">
      <header className="flex items-start justify-between">
        <div>
          <Link to="/vehicles" className="text-xs text-aat-accent hover:underline">
            ← Vehicle Registry
          </Link>
          <h1 className="mt-1 text-2xl font-bold tracking-tight">{vehicle.name}</h1>
          <div className="text-sm text-slate-500 dark:text-slate-400">
            {vehicle.designator || "No tail number"} · {vehicle.vehicleClass || vehicle.type || "Unclassified"}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <StatusPill tone={vehicle.status === "ACTIVE" ? "go" : vehicle.status === "RETIRED" ? "neutral" : "caution"}>
            {vehicle.status.replace("_", " ")}
          </StatusPill>
          <RequireRole roles={["ADMIN", "LAUNCH_DIRECTOR"]}>
            <button onClick={() => setEditing((e) => !e)} className="btn-secondary">
              {editing ? "Done editing" : "Edit"}
            </button>
          </RequireRole>
        </div>
      </header>

      {editing ? (
        <VehicleEditForm vehicle={vehicle} onDone={() => setEditing(false)} />
      ) : (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
          <div className="space-y-6 lg:col-span-2">
            {FIELD_GROUPS.map((group) => (
              <section key={group.title} className="card p-5">
                <div className="mb-3 text-xs font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400">{group.title}</div>
                <div className="grid grid-cols-2 gap-3 text-sm">
                  {group.fields.map(([key, label, unit]) => (
                    <div key={key as string}>
                      <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">{label}</div>
                      <div>{vehicle[key] != null && vehicle[key] !== "" ? `${vehicle[key]}${unit ? ` ${unit}` : ""}` : "--"}</div>
                    </div>
                  ))}
                </div>
              </section>
            ))}

            <section className="card p-5">
              <div className="mb-3 text-xs font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400">Configuration Notes</div>
              <p className="whitespace-pre-wrap text-sm">{vehicle.configurationNotes || "No configuration change notes on file."}</p>
            </section>

            <section className="card p-5">
              <div className="mb-3 text-xs font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400">Mission History</div>
              <div className="space-y-2">
                {vehicle.missions?.length ? (
                  vehicle.missions.map((m) => (
                    <Link
                      key={m.id}
                      to={`/missions/${m.id}`}
                      className="flex items-center justify-between rounded-md border border-slate-200 px-3 py-2 text-sm hover:bg-slate-50 dark:border-slate-800 dark:hover:bg-slate-800/40"
                    >
                      <div>
                        <div className="font-medium">{m.name}</div>
                        <div className="text-xs text-slate-500 dark:text-slate-400">
                          {m.designator} · {m.site?.name}
                        </div>
                      </div>
                      <StatusPill tone={missionStatusTone(m.status)}>{m.status.replace("_", " ")}</StatusPill>
                    </Link>
                  ))
                ) : (
                  <p className="text-sm text-slate-400">No missions flown or assigned yet.</p>
                )}
              </div>
            </section>
          </div>

          <div className="space-y-6">
            <section className="card p-5">
              <div className="mb-3 text-xs font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                Documentation & Photo Gallery
              </div>
              {photos.length > 0 && (
                <div className="mb-3 grid grid-cols-3 gap-2">
                  {photos.map((p) => (
                    <a key={p.id} href={`/api/documents/${p.id}/versions/${p.currentVersion}/content`} target="_blank" rel="noreferrer">
                      <img
                        src={`/api/documents/${p.id}/versions/${p.currentVersion}/content`}
                        alt={p.title}
                        className="h-20 w-full rounded-md object-cover"
                      />
                    </a>
                  ))}
                </div>
              )}
              <div className="space-y-1">
                {otherDocs.map((d) => (
                  <a
                    key={d.id}
                    href={`/api/documents/${d.id}/versions/${d.currentVersion}/content`}
                    target="_blank"
                    rel="noreferrer"
                    className="block rounded-md border border-slate-200 px-2 py-1.5 text-xs hover:bg-slate-50 dark:border-slate-800 dark:hover:bg-slate-800/50"
                  >
                    {d.title} <span className="text-slate-400">v{d.currentVersion}</span>
                  </a>
                ))}
                {vehicle.documents?.length === 0 && <p className="text-xs text-slate-400">No documents on file.</p>}
              </div>
              <RequireRole roles={["ADMIN", "LAUNCH_DIRECTOR", "OPERATOR"]}>
                <div className="mt-3 space-y-2">
                  <input value={docTitle} onChange={(e) => setDocTitle(e.target.value)} placeholder="Document title" className="input" />
                  <input type="file" onChange={(e) => setDocFile(e.target.files?.[0] ?? null)} className="w-full text-xs" />
                  <button
                    onClick={() => docFile && uploadDoc.mutate()}
                    disabled={!docFile}
                    className="w-full rounded-md bg-white py-1.5 text-xs font-semibold text-black disabled:opacity-50"
                  >
                    Upload schematic / drawing / photo / cert
                  </button>
                </div>
              </RequireRole>
            </section>

            <section className="card p-5">
              <div className="mb-2 text-xs font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400">Weather Commit Thresholds</div>
              <div className="grid grid-cols-2 gap-2 text-sm">
                <div>Max wind: {vehicle.windMaxKts ?? "--"} kt</div>
                <div>Min ceiling: {vehicle.ceilingMinFt ?? "--"} ft</div>
                <div>Lightning radius: {vehicle.lightningRadiusMi ?? "--"} mi</div>
                <div>Max precip prob: {vehicle.maxPrecipProbability ?? "--"}%</div>
              </div>
            </section>
          </div>
        </div>
      )}
    </div>
  );
}

function VehicleEditForm({ vehicle, onDone }: { vehicle: Vehicle; onDone: () => void }) {
  const qc = useQueryClient();
  const [form, setForm] = useState<Record<string, string>>(() => {
    const initial: Record<string, string> = {};
    for (const group of FIELD_GROUPS) {
      for (const [key] of group.fields) {
        const v = (vehicle as any)[key];
        initial[key as string] = v != null ? String(v) : "";
      }
    }
    initial.status = vehicle.status;
    initial.configurationNotes = vehicle.configurationNotes ?? "";
    initial.windMaxKts = vehicle.windMaxKts != null ? String(vehicle.windMaxKts) : "";
    initial.ceilingMinFt = vehicle.ceilingMinFt != null ? String(vehicle.ceilingMinFt) : "";
    initial.lightningRadiusMi = vehicle.lightningRadiusMi != null ? String(vehicle.lightningRadiusMi) : "";
    initial.maxPrecipProbability = vehicle.maxPrecipProbability != null ? String(vehicle.maxPrecipProbability) : "";
    return initial;
  });

  const NUMERIC_FIELDS = new Set(
    FIELD_GROUPS.flatMap((g) => g.fields).filter(([, , unit]) => unit !== undefined || true).map(([k]) => k as string)
  );
  const TEXT_ONLY = new Set(["designator", "vehicleClass", "program", "motorType", "motorManufacturer", "propellantType", "stageConfiguration", "drogueChuteSpec", "mainChuteSpec", "deploymentMethod", "ejectionChargeConfig", "flightComputer", "telemetrySystem", "gpsTracking", "avionicsRedundancy"]);

  const mutation = useMutation({
    mutationFn: () => {
      const payload: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(form)) {
        if (value === "") {
          payload[key] = null;
        } else if (TEXT_ONLY.has(key) || key === "configurationNotes" || key === "status") {
          payload[key] = value;
        } else {
          const num = Number(value);
          payload[key] = Number.isNaN(num) ? value : num;
        }
      }
      return updateVehicle(vehicle.id, payload as any);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["vehicle", vehicle.id] });
      qc.invalidateQueries({ queryKey: ["vehicles"] });
      onDone();
    },
  });

  return (
    <div className="space-y-6">
      <section className="card p-5">
        <div className="mb-3 text-xs font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400">Status</div>
        <select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })} className="input max-w-xs">
          {["ACTIVE", "IN_DEVELOPMENT", "RETIRED"].map((s) => (
            <option key={s} value={s}>
              {s.replace("_", " ")}
            </option>
          ))}
        </select>
      </section>

      {FIELD_GROUPS.map((group) => (
        <section key={group.title} className="card p-5">
          <div className="mb-3 text-xs font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400">{group.title}</div>
          <div className="grid grid-cols-2 gap-3">
            {group.fields.map(([key, label, unit]) => (
              <div key={key as string}>
                <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-slate-400">
                  {label} {unit ? `(${unit})` : ""}
                </label>
                <input
                  value={form[key as string] ?? ""}
                  onChange={(e) => setForm({ ...form, [key as string]: e.target.value })}
                  className="input"
                />
              </div>
            ))}
          </div>
        </section>
      ))}

      <section className="card p-5">
        <div className="mb-3 text-xs font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400">Configuration Notes</div>
        <textarea
          value={form.configurationNotes}
          onChange={(e) => setForm({ ...form, configurationNotes: e.target.value })}
          rows={3}
          placeholder='e.g. "v2 configuration flown starting Mission 4 - upgraded recovery avionics"'
          className="input"
        />
      </section>

      <section className="card p-5">
        <div className="mb-3 text-xs font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400">Weather Commit Thresholds</div>
        <div className="grid grid-cols-2 gap-3">
          <input placeholder="Max wind (kt)" value={form.windMaxKts} onChange={(e) => setForm({ ...form, windMaxKts: e.target.value })} className="input" />
          <input placeholder="Min ceiling (ft)" value={form.ceilingMinFt} onChange={(e) => setForm({ ...form, ceilingMinFt: e.target.value })} className="input" />
          <input
            placeholder="Lightning radius (mi)"
            value={form.lightningRadiusMi}
            onChange={(e) => setForm({ ...form, lightningRadiusMi: e.target.value })}
            className="input"
          />
          <input
            placeholder="Max precip prob (%)"
            value={form.maxPrecipProbability}
            onChange={(e) => setForm({ ...form, maxPrecipProbability: e.target.value })}
            className="input"
          />
        </div>
      </section>

      <div className="flex justify-end gap-2">
        <button onClick={onDone} className="btn-secondary">
          Cancel
        </button>
        <button onClick={() => mutation.mutate()} className="btn-primary">
          Save Vehicle Record
        </button>
      </div>
    </div>
  );
}
