import React, { useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  createMilestoneTemplate,
  createVehicle,
  deleteMilestoneTemplate,
  fetchVehicle,
  fetchVehicles,
  updateVehicle,
  uploadDocument,
} from "../api/resources";
import { usePreferences } from "../context/PreferencesContext";
import { formatDateOnly } from "../utils/time";
import { StatusPill, missionStatusTone } from "../components/StatusPill";
import { RequireRole } from "../components/RequireRole";
import { DocumentLink, DocumentImage } from "../components/DocumentLink";
import type { Vehicle } from "../types";

const SUBTABS = ["Vehicles", "VLCP Milestone Templates"] as const;

export default function Vehicles() {
  const { vehicleId } = useParams();
  const navigate = useNavigate();
  const [subtab, setSubtab] = useState<(typeof SUBTABS)[number]>("Vehicles");

  if (vehicleId) return <VehicleDetail vehicleId={vehicleId} onClose={() => navigate("/vehicles")} />;

  return (
    <div className="space-y-6 p-8">
      <header>
        <h1 className="text-2xl font-bold tracking-tight">Vehicle Registry</h1>
      </header>

      <div className="flex gap-1 border-b border-slate-200 dark:border-slate-800">
        {SUBTABS.map((t) => (
          <button
            key={t}
            onClick={() => setSubtab(t)}
            className={`-mb-px border-b-2 px-4 py-2 text-sm font-medium ${
              subtab === t ? "border-aat-accent text-aat-accent" : "border-transparent text-slate-500 hover:text-slate-800 dark:text-slate-400"
            }`}
          >
            {t}
          </button>
        ))}
      </div>

      {subtab === "Vehicles" && <VehiclesListTab />}
      {subtab === "VLCP Milestone Templates" && <VlcpTemplatesTab />}
    </div>
  );
}

function VehiclesListTab() {
  const { data: vehicles, isLoading } = useQuery({ queryKey: ["vehicles"], queryFn: fetchVehicles });
  const [showNew, setShowNew] = useState(false);

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <RequireRole roles={["ADMIN", "LAUNCH_DIRECTOR"]}>
          <button onClick={() => setShowNew(true)} className="btn-primary">
            + Add Vehicle
          </button>
        </RequireRole>
      </div>

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

// ---------------------------------------------------------------------------
// Single comprehensive field set (v3.1 Items 5+6) - used identically by the
// one Add Vehicle flow and the one Edit Vehicle flow. Name, designator, and
// class/type are the only fields required at creation; everything else is
// optional/estimate-acceptable and may be filled in later.
// ---------------------------------------------------------------------------

const REQUIRED_FIELDS = ["name", "designator", "vehicleClass"] as const;

const FIELD_GROUPS: { title: string; fields: [keyof Vehicle, string, string?][] }[] = [
  {
    title: "Identification",
    fields: [
      ["designator", "Designator / tail number *"],
      ["vehicleClass", "Class/type designation *"],
      ["type", "Type"],
      ["program", "Program/family"],
    ],
  },
  {
    title: "Physical Characteristics",
    fields: [
      ["totalLengthIn", "Total length", "in"],
      ["diameterIn", "Diameter", "in"],
      ["finSpanIn", "Fin span", "in"],
      ["wetMassKg", "Wet/loaded mass (estimate acceptable)", "kg"],
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
      ["totalImpulseNs", "Total impulse (rated/as flown)", "N·s"],
      ["burnTimeSeconds", "Burn time", "s"],
      ["avgThrustN", "Average thrust", "N"],
      ["maxThrustN", "Max thrust", "N"],
      ["specificImpulseS", "Specific impulse (if known)", "s"],
    ],
  },
  {
    title: "Staging / Configuration",
    fields: [["stageConfiguration", "Single/multi-stage, stage breakdown"]],
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

const TEXT_ONLY_FIELDS = new Set([
  "designator",
  "vehicleClass",
  "type",
  "program",
  "motorType",
  "motorManufacturer",
  "propellantType",
  "stageConfiguration",
  "drogueChuteSpec",
  "mainChuteSpec",
  "deploymentMethod",
  "ejectionChargeConfig",
  "flightComputer",
  "telemetrySystem",
  "gpsTracking",
  "avionicsRedundancy",
]);

type VehicleFormState = Record<string, string>;

function initialVehicleForm(vehicle?: Vehicle): VehicleFormState {
  const initial: VehicleFormState = {};
  for (const group of FIELD_GROUPS) {
    for (const [key] of group.fields) {
      const v = vehicle ? (vehicle as any)[key] : undefined;
      initial[key as string] = v != null ? String(v) : "";
    }
  }
  initial.name = vehicle?.name ?? "";
  initial.description = vehicle?.description ?? "";
  initial.status = vehicle?.status ?? "IN_DEVELOPMENT";
  initial.configurationNotes = vehicle?.configurationNotes ?? "";
  initial.windMaxKts = vehicle?.windMaxKts != null ? String(vehicle.windMaxKts) : "";
  initial.ceilingMinFt = vehicle?.ceilingMinFt != null ? String(vehicle.ceilingMinFt) : "";
  initial.lightningRadiusMi = vehicle?.lightningRadiusMi != null ? String(vehicle.lightningRadiusMi) : "";
  initial.maxPrecipProbability = vehicle?.maxPrecipProbability != null ? String(vehicle.maxPrecipProbability) : "";
  return initial;
}

function buildVehiclePayload(form: VehicleFormState): Record<string, unknown> {
  const payload: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(form)) {
    if (value === "") {
      payload[key] = key === "name" ? undefined : null;
    } else if (TEXT_ONLY_FIELDS.has(key) || key === "configurationNotes" || key === "description" || key === "status" || key === "name") {
      payload[key] = value;
    } else {
      const num = Number(value);
      payload[key] = Number.isNaN(num) ? value : num;
    }
  }
  return payload;
}

function isVehicleFormValid(form: VehicleFormState): boolean {
  return REQUIRED_FIELDS.every((f) => form[f]?.trim());
}

function VehicleFormBody({ form, setForm }: { form: VehicleFormState; setForm: (f: VehicleFormState) => void }) {
  return (
    <div className="space-y-6">
      <section className="card p-5">
        <div className="mb-3 text-xs font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400">Identification</div>
        <div className="grid grid-cols-2 gap-3">
          <div className="col-span-2">
            <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-slate-400">Name *</label>
            <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="input" />
          </div>
          {FIELD_GROUPS[0].fields.map(([key, label]) => (
            <div key={key as string}>
              <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-slate-400">{label}</label>
              <input value={form[key as string] ?? ""} onChange={(e) => setForm({ ...form, [key as string]: e.target.value })} className="input" />
            </div>
          ))}
          <div className="col-span-2">
            <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-slate-400">Vehicle description</label>
            <textarea
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
              rows={2}
              className="input"
            />
          </div>
        </div>
      </section>

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

      {FIELD_GROUPS.slice(1).map((group) => (
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
        <div className="mb-3 text-xs font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400">
          Weather / Operational Limits (LWCC &amp; countdown gating)
        </div>
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
    </div>
  );
}

function NewVehicleModal({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const [form, setForm] = useState<VehicleFormState>(() => initialVehicleForm());
  const mutation = useMutation({
    mutationFn: () => createVehicle(buildVehiclePayload(form) as any),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["vehicles"] });
      onClose();
    },
  });

  return (
    <div className="fixed inset-0 z-[2000] flex items-center justify-center bg-black/40 p-4">
      <div className="max-h-[90vh] w-full max-w-2xl overflow-y-auto border border-zinc-800 bg-black p-6">
        <h2 className="mb-1 text-lg font-bold">Add Vehicle</h2>
        <p className="mb-4 text-xs text-slate-500 dark:text-slate-400">
          Only Name, Designator, and Class/Type are required to create the record. Every other field may be filled in or estimated later.
        </p>
        <VehicleFormBody form={form} setForm={setForm} />
        <div className="mt-4 flex justify-end gap-2">
          <button onClick={onClose} className="btn-secondary">
            Cancel
          </button>
          <button onClick={() => mutation.mutate()} disabled={!isVehicleFormValid(form)} className="btn-primary disabled:opacity-50">
            Create Vehicle
          </button>
        </div>
      </div>
    </div>
  );
}

function VehicleDetail({ vehicleId, onClose }: { vehicleId: string; onClose: () => void }) {
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
            <section className="card p-5">
              <div className="mb-3 text-xs font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400">Description</div>
              <p className="whitespace-pre-wrap text-sm">{vehicle.description || "No description on file."}</p>
            </section>

            {FIELD_GROUPS.map((group) => (
              <section key={group.title} className="card p-5">
                <div className="mb-3 text-xs font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400">{group.title}</div>
                <div className="grid grid-cols-2 gap-3 text-sm">
                  {group.fields.map(([key, label, unit]) => (
                    <div key={key as string}>
                      <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">{label.replace(" *", "")}</div>
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
                    <DocumentLink key={p.id} documentId={p.id} version={p.currentVersion} className="block">
                      <DocumentImage documentId={p.id} version={p.currentVersion} alt={p.title} className="h-20 w-full rounded-md object-cover" />
                    </DocumentLink>
                  ))}
                </div>
              )}
              <div className="space-y-1">
                {otherDocs.map((d) => (
                  <DocumentLink
                    key={d.id}
                    documentId={d.id}
                    version={d.currentVersion}
                    className="block rounded-md border border-slate-200 px-2 py-1.5 text-xs hover:bg-slate-50 dark:border-slate-800 dark:hover:bg-slate-800/50"
                  >
                    {d.title} <span className="text-slate-400">v{d.currentVersion}</span>
                  </DocumentLink>
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
          </div>
        </div>
      )}
    </div>
  );
}

function VehicleEditForm({ vehicle, onDone }: { vehicle: Vehicle; onDone: () => void }) {
  const qc = useQueryClient();
  const [form, setForm] = useState<VehicleFormState>(() => initialVehicleForm(vehicle));

  const mutation = useMutation({
    mutationFn: () => updateVehicle(vehicle.id, buildVehiclePayload(form) as any),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["vehicle", vehicle.id] });
      qc.invalidateQueries({ queryKey: ["vehicles"] });
      onDone();
    },
  });

  return (
    <div className="space-y-6">
      <VehicleFormBody form={form} setForm={setForm} />
      <div className="flex justify-end gap-2">
        <button onClick={onDone} className="btn-secondary">
          Cancel
        </button>
        <button onClick={() => mutation.mutate()} disabled={!isVehicleFormValid(form)} className="btn-primary disabled:opacity-50">
          Save Vehicle Record
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// VLCP Milestone Templates subtab (moved here in full from
// Admin > "Vehicles & Templates", v3.1 Item 6)
// ---------------------------------------------------------------------------

function VlcpTemplatesTab() {
  const { data: vehicles } = useQuery({ queryKey: ["vehicles"], queryFn: fetchVehicles });

  return (
    <div className="space-y-4">
      <p className="text-xs text-slate-500 dark:text-slate-400">
        A mission's Countdown tab generates its milestone sequence from one of these VLCP Milestone Templates, selected per the assigned
        vehicle.
      </p>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        {vehicles?.map((v) => (
          <div key={v.id} className="card p-5">
            <div className="text-lg font-semibold">{v.name}</div>
            <div className="text-xs text-slate-500 dark:text-slate-400">{v.designator || v.type}</div>
            <div className="mt-3">
              <div className="text-xs font-semibold uppercase text-slate-500">VLCP Milestone Templates</div>
              {v.templates?.length ? (
                v.templates.map((t) => <TemplateCard key={t.id} vehicleId={v.id} template={t} />)
              ) : (
                <div className="mt-1 text-xs text-slate-400">No templates on file for this vehicle.</div>
              )}
              <NewTemplateInline vehicleId={v.id} />
            </div>
          </div>
        ))}
        {vehicles?.length === 0 && <p className="text-sm text-slate-400">No vehicles on file yet. Add a vehicle first.</p>}
      </div>
    </div>
  );
}

function TemplateCard({ vehicleId, template }: { vehicleId: string; template: { id: string; name: string; items: { id: string; label: string; tMinusSeconds: number }[] } }) {
  const qc = useQueryClient();
  const [expanded, setExpanded] = useState(false);
  const deleteMutation = useMutation({
    mutationFn: () => deleteMilestoneTemplate(vehicleId, template.id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["vehicles"] }),
  });

  return (
    <div className="mt-1 rounded-md border border-slate-200 p-2 text-xs dark:border-slate-800">
      <div className="flex items-center justify-between">
        <button onClick={() => setExpanded((e) => !e)} className="font-medium hover:underline">
          {template.name}
        </button>
        <div className="flex items-center gap-2">
          <span className="text-slate-500 dark:text-slate-400">{template.items.length} milestones</span>
          <button onClick={() => confirm(`Delete template "${template.name}"?`) && deleteMutation.mutate()} className="text-aat-nogo hover:underline">
            Delete
          </button>
        </div>
      </div>
      {expanded && (
        <ul className="mt-2 space-y-0.5 font-mono text-[11px] text-slate-500 dark:text-slate-400">
          {template.items
            .slice()
            .sort((a, b) => b.tMinusSeconds - a.tMinusSeconds)
            .map((item) => (
              <li key={item.id}>
                T-{item.tMinusSeconds}s {item.label}
              </li>
            ))}
        </ul>
      )}
    </div>
  );
}

function NewTemplateInline({ vehicleId }: { vehicleId: string }) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [items, setItems] = useState([{ label: "", tMinusSeconds: 0 }]);

  const mutation = useMutation({
    mutationFn: () => createMilestoneTemplate(vehicleId, { name, items: items.filter((i) => i.label) as any }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["vehicles"] });
      setOpen(false);
      setName("");
      setItems([{ label: "", tMinusSeconds: 0 }]);
    },
  });

  if (!open) {
    return (
      <button onClick={() => setOpen(true)} className="mt-2 text-xs font-semibold text-aat-accent hover:underline">
        + Add VLCP template
      </button>
    );
  }

  return (
    <div className="mt-2 space-y-2 rounded-md border border-slate-200 p-2 dark:border-slate-800">
      <input placeholder="Template name" value={name} onChange={(e) => setName(e.target.value)} className="input" />
      {items.map((item, idx) => (
        <div key={idx} className="grid grid-cols-[1fr_100px] gap-1">
          <input
            placeholder="Milestone label"
            value={item.label}
            onChange={(e) => {
              const next = [...items];
              next[idx] = { ...next[idx], label: e.target.value };
              setItems(next);
            }}
            className="input"
          />
          <input
            type="number"
            placeholder="T-minus (s)"
            value={item.tMinusSeconds}
            onChange={(e) => {
              const next = [...items];
              next[idx] = { ...next[idx], tMinusSeconds: Number(e.target.value) };
              setItems(next);
            }}
            className="input"
          />
        </div>
      ))}
      <button onClick={() => setItems([...items, { label: "", tMinusSeconds: 0 }])} className="text-xs text-aat-accent hover:underline">
        + Add milestone
      </button>
      <div className="flex justify-end gap-2">
        <button onClick={() => setOpen(false)} className="text-xs">
          Cancel
        </button>
        <button onClick={() => mutation.mutate()} disabled={!name} className="rounded-md bg-white px-2 py-1 text-xs font-semibold text-black disabled:opacity-50">
          Save template
        </button>
      </div>
    </div>
  );
}
