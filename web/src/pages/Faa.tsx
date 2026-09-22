import React, { useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createCoa, deleteCoa, fetchCoas, fetchDocuments, fetchFaaSummary, fetchSites, updateCoa } from "../api/resources";
import { usePreferences } from "../context/PreferencesContext";
import { formatDateOnly, formatTimestamp } from "../utils/time";
import { StatusPill, coaStatusTone } from "../components/StatusPill";
import { RequireRole } from "../components/RequireRole";
import { DocumentLink } from "../components/DocumentLink";
import { NOTIFICATION_TYPE_LABELS } from "../constants";
import type { Coa } from "../types";

export default function Faa() {
  const { useZulu } = usePreferences();
  const { data: summary } = useQuery({ queryKey: ["faa-summary"], queryFn: fetchFaaSummary, refetchInterval: 60_000 });
  const [showNewCoa, setShowNewCoa] = useState(false);
  const [viewCoaId, setViewCoaId] = useState<string | null>(null);
  const { data: coas, refetch: refetchCoas } = useQuery({ queryKey: ["coas-all"], queryFn: () => fetchCoas() });
  const viewCoa = coas?.find((c) => c.id === viewCoaId) ?? null;

  return (
    <div className="space-y-6 p-8">
      <header className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">FAA Coordination &amp; Airspace Authorization</h1>
        </div>
        <RequireRole roles={["ADMIN", "LAUNCH_DIRECTOR"]}>
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
              <th className="py-2">Altitude Limit</th>
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
                <td className="py-2 text-xs">{c.altitudeLimits}</td>
                <td className="py-2 text-xs">{formatDateOnly(c.effectiveDate, useZulu)}</td>
                <td className="py-2 text-xs">{formatDateOnly(c.expirationDate, useZulu)}</td>
                <td className="py-2">
                  <StatusPill tone={coaStatusTone(c.status)}>{c.status}</StatusPill>
                </td>
                <td className="py-2 text-right">
                  <button onClick={() => setViewCoaId(c.id)} className="text-xs font-semibold text-aat-accent hover:underline">
                    View
                  </button>
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
      {viewCoa && (
        <CoaDetailModal
          coa={viewCoa}
          onClose={() => setViewCoaId(null)}
          onDone={refetchCoas}
          onDeleted={() => {
            setViewCoaId(null);
            refetchCoas();
          }}
        />
      )}
    </div>
  );
}

// Revision Directive v4.0 Section 2.1 - every field on this form is
// required; there are no optional fields on a COA record.
const EMPTY_COA_FORM = {
  siteId: "",
  coaNumber: "",
  issuedTo: "",
  issuingFacility: "",
  authorizedOperationRadiusNm: "",
  fixRadialDistance: "",
  effectiveDate: "",
  expirationDate: "",
  dailyWindowOpen: "",
  dailyWindowClose: "",
  authorizedActivity: "",
  altitudeLimits: "",
  conditions: "",
};

function coaFormValid(form: typeof EMPTY_COA_FORM): boolean {
  return Object.values(form).every((v) => String(v).trim().length > 0);
}

function CoaFormFields({ form, setForm, sites }: { form: typeof EMPTY_COA_FORM; setForm: (f: typeof EMPTY_COA_FORM) => void; sites?: { id: string; name: string }[] }) {
  return (
    <div className="space-y-3">
      <select value={form.siteId} onChange={(e) => setForm({ ...form, siteId: e.target.value })} className="input">
        <option value="">Select site *</option>
        {sites?.map((s) => (
          <option key={s.id} value={s.id}>
            {s.name}
          </option>
        ))}
      </select>
      <input placeholder="COA number *" value={form.coaNumber} onChange={(e) => setForm({ ...form, coaNumber: e.target.value })} className="input" />
      <input
        placeholder="Issued to (individual responsible) *"
        value={form.issuedTo}
        onChange={(e) => setForm({ ...form, issuedTo: e.target.value })}
        className="input"
      />
      <input
        placeholder="Issuing FAA Office/Region/Facility *"
        value={form.issuingFacility}
        onChange={(e) => setForm({ ...form, issuingFacility: e.target.value })}
        className="input"
      />
      <div className="grid grid-cols-2 gap-2">
        <input
          type="number"
          min="0"
          step="0.1"
          placeholder="Authorized operation radius (nm) *"
          value={form.authorizedOperationRadiusNm}
          onChange={(e) => setForm({ ...form, authorizedOperationRadiusNm: e.target.value })}
          className="input"
        />
        <input
          placeholder="Fix Radial Distance (FRD) *, e.g. SCB025055.4"
          value={form.fixRadialDistance}
          onChange={(e) => setForm({ ...form, fixRadialDistance: e.target.value })}
          className="input"
        />
      </div>
      <div>
        <div className="mb-1 text-[10px] font-semibold uppercase text-slate-400">Effective dates *</div>
        <div className="grid grid-cols-2 gap-2">
          <input type="date" value={form.effectiveDate} onChange={(e) => setForm({ ...form, effectiveDate: e.target.value })} className="input" />
          <input type="date" value={form.expirationDate} onChange={(e) => setForm({ ...form, expirationDate: e.target.value })} className="input" />
        </div>
      </div>
      <div>
        <div className="mb-1 text-[10px] font-semibold uppercase text-slate-400">Daily operational window *</div>
        <div className="grid grid-cols-2 gap-2">
          <input type="time" value={form.dailyWindowOpen} onChange={(e) => setForm({ ...form, dailyWindowOpen: e.target.value })} className="input" />
          <input type="time" value={form.dailyWindowClose} onChange={(e) => setForm({ ...form, dailyWindowClose: e.target.value })} className="input" />
        </div>
      </div>
      <textarea
        placeholder="Authorized activity description *"
        value={form.authorizedActivity}
        onChange={(e) => setForm({ ...form, authorizedActivity: e.target.value })}
        className="input"
        rows={2}
      />
      <input
        placeholder="Altitude / airspace limits *"
        value={form.altitudeLimits}
        onChange={(e) => setForm({ ...form, altitudeLimits: e.target.value })}
        className="input"
      />
      <textarea
        placeholder="Standard and special provisions *"
        value={form.conditions}
        onChange={(e) => setForm({ ...form, conditions: e.target.value })}
        className="input"
        rows={2}
      />
    </div>
  );
}

function NewCoaModal({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const { data: sites } = useQuery({ queryKey: ["sites"], queryFn: fetchSites });
  const [form, setForm] = useState({ ...EMPTY_COA_FORM });
  const mutation = useMutation({
    mutationFn: () =>
      createCoa({
        ...form,
        authorizedOperationRadiusNm: Number(form.authorizedOperationRadiusNm),
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
      <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-xl border border-zinc-800 bg-black p-6">
        <h2 className="mb-4 text-lg font-bold">New COA</h2>
        <CoaFormFields form={form} setForm={setForm} sites={sites} />
        <div className="mt-4 flex justify-end gap-2">
          <button onClick={onClose} className="btn-secondary">
            Cancel
          </button>
          <button onClick={() => mutation.mutate()} disabled={!coaFormValid(form)} className="btn-primary disabled:opacity-50">
            Create COA
          </button>
        </div>
        {mutation.isError && <p className="mt-2 text-xs text-aat-nogo">{(mutation.error as any)?.response?.data?.error?.formErrors?.join?.(", ") ?? "Submission failed"}</p>}
      </div>
    </div>
  );
}

// Revision Directive v4.0 Section 2.3 - view/edit/delete popup, opened from
// the tracker table's View action. A "Cert. of Waiver or Authorization"
// document tagged to the same site (Section 2.4) surfaces here, the same
// site+document-category discovery pattern used for Landowner Authorization.
function CoaDetailModal({ coa, onClose, onDone, onDeleted }: { coa: Coa; onClose: () => void; onDone: () => void; onDeleted: () => void }) {
  const { useZulu } = usePreferences();
  const { data: sites } = useQuery({ queryKey: ["sites"], queryFn: fetchSites });
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState({
    siteId: coa.siteId,
    coaNumber: coa.coaNumber,
    issuedTo: coa.issuedTo,
    issuingFacility: coa.issuingFacility,
    authorizedOperationRadiusNm: String(coa.authorizedOperationRadiusNm),
    fixRadialDistance: coa.fixRadialDistance,
    effectiveDate: coa.effectiveDate.slice(0, 10),
    expirationDate: coa.expirationDate.slice(0, 10),
    dailyWindowOpen: coa.dailyWindowOpen,
    dailyWindowClose: coa.dailyWindowClose,
    authorizedActivity: coa.authorizedActivity,
    altitudeLimits: coa.altitudeLimits,
    conditions: coa.conditions,
  });

  const { data: coaDocs } = useQuery({
    queryKey: ["coa-documents", coa.siteId],
    queryFn: () => fetchDocuments({ siteId: coa.siteId, category: "Cert. of Waiver or Authorization" }),
  });

  const updateMutation = useMutation({
    mutationFn: () =>
      updateCoa(coa.id, {
        ...form,
        authorizedOperationRadiusNm: Number(form.authorizedOperationRadiusNm),
        effectiveDate: new Date(form.effectiveDate).toISOString(),
        expirationDate: new Date(form.expirationDate).toISOString(),
      } as any),
    onSuccess: () => {
      onDone();
      setEditing(false);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: () => deleteCoa(coa.id),
    onSuccess: onDeleted,
  });

  return (
    <div className="fixed inset-0 z-[2000] flex items-center justify-center bg-black/40 p-4">
      <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-xl border border-zinc-800 bg-black p-6">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-bold">COA {coa.coaNumber}</h2>
          <StatusPill tone={coaStatusTone(coa.status)}>{coa.status}</StatusPill>
        </div>

        {!editing ? (
          <>
            <div className="grid grid-cols-2 gap-3 text-sm">
              <Field label="Site" value={coa.site?.name ?? "--"} />
              <Field label="Issued to" value={coa.issuedTo} />
              <Field label="Issuing FAA Office/Region/Facility" value={coa.issuingFacility} span2 />
              <Field label="Authorized operation radius" value={`${coa.authorizedOperationRadiusNm} nm`} />
              <Field label="Fix Radial Distance (FRD)" value={coa.fixRadialDistance} />
              <Field label="Effective" value={formatDateOnly(coa.effectiveDate, useZulu)} />
              <Field label="Expires" value={formatDateOnly(coa.expirationDate, useZulu)} />
              <Field label="Daily operational window" value={`${coa.dailyWindowOpen} – ${coa.dailyWindowClose}`} span2 />
              <Field label="Authorized activity description" value={coa.authorizedActivity} span2 />
              <Field label="Altitude/airspace limits" value={coa.altitudeLimits} span2 />
              <Field label="Standard and special provisions" value={coa.conditions} span2 />
            </div>

            <div className="mt-4 border-t border-zinc-800 pt-3">
              <div className="mb-1 text-[10px] font-semibold uppercase text-slate-400">Cert. of Waiver or Authorization document</div>
              {coaDocs && coaDocs.length > 0 ? (
                <div className="space-y-1">
                  {coaDocs.map((d) => (
                    <DocumentLink key={d.id} documentId={d.id} version={d.currentVersion} className="block text-xs text-aat-accent hover:underline">
                      {d.title} <span className="text-slate-500">v{d.currentVersion}</span>
                    </DocumentLink>
                  ))}
                </div>
              ) : (
                <p className="text-xs text-slate-400">No "Cert. of Waiver or Authorization" document on file for this site.</p>
              )}
            </div>

            <div className="mt-5 flex items-center justify-between">
              <RequireRole roles={["ADMIN", "LAUNCH_DIRECTOR"]}>
                <button
                  onClick={() => {
                    if (confirm(`Permanently delete COA ${coa.coaNumber}? This cannot be undone.`)) deleteMutation.mutate();
                  }}
                  className="text-xs font-semibold text-aat-nogo hover:underline"
                >
                  Delete COA
                </button>
              </RequireRole>
              <div className="flex gap-2">
                <button onClick={onClose} className="btn-secondary">
                  Close
                </button>
                <RequireRole roles={["ADMIN", "LAUNCH_DIRECTOR"]}>
                  <button onClick={() => setEditing(true)} className="btn-primary">
                    Edit
                  </button>
                </RequireRole>
              </div>
            </div>
          </>
        ) : (
          <>
            <CoaFormFields form={form} setForm={setForm} sites={sites} />
            <div className="mt-4 flex justify-end gap-2">
              <button onClick={() => setEditing(false)} className="btn-secondary">
                Cancel
              </button>
              <button onClick={() => updateMutation.mutate()} disabled={!coaFormValid(form)} className="btn-primary disabled:opacity-50">
                Save Changes
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function Field({ label, value, span2 }: { label: string; value: React.ReactNode; span2?: boolean }) {
  return (
    <div className={span2 ? "col-span-2" : ""}>
      <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">{label}</div>
      <div className="text-sm">{value}</div>
    </div>
  );
}
