import React, { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  assignLd,
  assignOperator,
  clearOffStationOverride,
  fetchMissionPersonnel,
  fetchMissionPersonnelHistory,
  fetchMissions,
  fetchPersonnelList,
  removePersonnelAssignment,
  removeQualification,
  setOffStationOverride,
  setQualification,
  toggleOnStation,
} from "../api/resources";
import { useAuth } from "../context/AuthContext";
import { formatTimestamp } from "../utils/time";
import { usePreferences } from "../context/PreferencesContext";
import { useMissionSocket } from "../hooks/useSocket";
import { LD_ASSIGNMENT_ATTESTATION_TEXT, offStationOverrideAttestationText } from "../types";
import type {
  Mission,
  MissionPersonnelAssignmentRecord,
  MissionRole,
  PersonnelListEntry,
  QualificationRole,
} from "../types";

// v7.0 - Personnel & Stations. The website-role/mission-role distinction
// (Section 2/10 of the directive) is load-bearing throughout this page:
// every dropdown below is deliberately scoped to a specific website role
// (Launch Director for the LD assignment control, Operator for RC/LWO/
// VSE/Ops Support), and mission-role assignment is a wholly separate data
// model (MissionPersonnelAssignment) from that website role - never a
// repurposing of it.

const REQUIRED_ROLES: MissionRole[] = ["LD", "RC", "LWO", "VSE"];
const QUALIFIABLE_ROLES: QualificationRole[] = ["RC", "LWO", "VSE"];
const ROLE_LABELS: Record<MissionRole, string> = {
  LD: "Launch Director (LD)",
  RC: "Range Coordinator (RC)",
  LWO: "Launch Weather Officer (LWO)",
  VSE: "Vehicle Systems Engineer (VSE)",
  OPS_SUPPORT: "Ops Support",
};

export default function PersonnelStations() {
  const qc = useQueryClient();
  const { user, isAdmin, isLaunchDirector } = useAuth();
  const canManage = isAdmin || isLaunchDirector;
  const { useZulu } = usePreferences();

  const { data: missions } = useQuery({ queryKey: ["missions", {}], queryFn: () => fetchMissions() });
  const { data: personnelList } = useQuery({ queryKey: ["personnel-list"], queryFn: fetchPersonnelList });

  const [selectedMissionId, setSelectedMissionId] = useState("");
  const [defaulted, setDefaulted] = useState(false);

  useEffect(() => {
    if (defaulted || !missions || missions.length === 0) return;
    setDefaulted(true);
    jumpToNearestTargeted(missions, setSelectedMissionId) || setSelectedMissionId(missions[0].id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [missions, defaulted]);

  const selectedMission = missions?.find((m) => m.id === selectedMissionId) ?? null;

  const { data: personnelState } = useQuery({
    queryKey: ["mission-personnel", selectedMissionId],
    queryFn: () => fetchMissionPersonnel(selectedMissionId),
    enabled: !!selectedMissionId,
  });
  const { data: history } = useQuery({
    queryKey: ["mission-personnel-history", selectedMissionId],
    queryFn: () => fetchMissionPersonnelHistory(selectedMissionId),
    enabled: !!selectedMissionId,
  });

  const assignments = personnelState?.assignments ?? [];
  const ld = assignments.find((a) => a.role === "LD") ?? null;
  const rc = assignments.find((a) => a.role === "RC") ?? null;
  const lwo = assignments.find((a) => a.role === "LWO") ?? null;
  const vse = assignments.find((a) => a.role === "VSE") ?? null;
  const opsSupport = assignments.filter((a) => a.role === "OPS_SUPPORT");
  const missingRoles = personnelState?.missingRoles ?? [];

  function invalidateMission() {
    qc.invalidateQueries({ queryKey: ["mission-personnel", selectedMissionId] });
    qc.invalidateQueries({ queryKey: ["mission-personnel-history", selectedMissionId] });
    qc.invalidateQueries({ queryKey: ["mission", selectedMissionId] });
  }

  // v7.0.1 Section 2.2 - the ON STATION table (and everything else derived
  // from mission-personnel assignment state on this page) previously only
  // refreshed on this client's own mutations, so a change made elsewhere
  // (the sidebar check-in control, another viewer's session) required a
  // manual page reload to appear here. broadcastMissionUpdate is already
  // fired by every mission-personnel route (assignment, station toggle,
  // override) - this just subscribes to it, the same live-update mechanism
  // already used by Mission Detail's countdown/LWCC tabs.
  useMissionSocket(selectedMissionId || undefined, invalidateMission);

  return (
    <div className="space-y-6 p-8">
      <header>
        <h1 className="text-2xl font-bold uppercase tracking-wide">Personnel &amp; Stations</h1>
      </header>

      {/* Section 6 - incomplete-assignment warning, scoped to the selected mission */}
      {selectedMission && missingRoles.length > 0 && (
        <div className="card border-2 border-aat-nogo bg-aat-nogo/10 p-4">
          <div className="text-sm font-bold uppercase tracking-wide text-aat-nogo">
            Incomplete Personnel Assignment — {selectedMission.designator}: {missingRoles.map((r) => r).join(" AND ")} UNASSIGNED
          </div>
        </div>
      )}

      {/* Section 3 - top-of-page personnel list + qualification tags */}
      <PersonnelListSection personnelList={personnelList} canManage={canManage} />

      {/* Section 4.1 - mission selector */}
      <section className="card space-y-3 p-5">
        <div className="flex flex-wrap items-center gap-3">
          <select value={selectedMissionId} onChange={(e) => setSelectedMissionId(e.target.value)} className="input w-auto min-w-[320px]">
            <option value="">Select a mission...</option>
            {missions?.map((m) => (
              <option key={m.id} value={m.id}>
                {m.designator} — {m.name} ({m.status.replace("_", " ")})
              </option>
            ))}
          </select>
          <button
            onClick={() => missions && jumpToNearestTargeted(missions, setSelectedMissionId)}
            className="btn-secondary"
          >
            Jump to Nearest Targeted Launch Opportunity
          </button>
        </div>
      </section>

      {selectedMission && (
        <>
          <AssignmentSection
            mission={selectedMission}
            canManage={canManage}
            personnelList={personnelList ?? []}
            ld={ld}
            rc={rc}
            lwo={lwo}
            vse={vse}
            opsSupport={opsSupport}
            onChanged={invalidateMission}
          />

          <OnStationTable mission={selectedMission} ld={ld} rc={rc} lwo={lwo} vse={vse} canManage={canManage} onChanged={invalidateMission} />

          <section className="card p-5">
            <div className="mb-3 text-sm font-bold uppercase tracking-wide text-zinc-300">Personnel Assignment History</div>
            {!history?.length ? (
              <p className="text-sm text-zinc-500">No personnel assignment activity on file for this mission.</p>
            ) : (
              <div className="max-h-96 overflow-y-auto">
                <table className="w-full text-left text-xs">
                  <thead>
                    <tr className="border-b border-zinc-800 text-zinc-500">
                      <th className="py-1.5 pr-4">When</th>
                      <th className="py-1.5 pr-4">Role</th>
                      <th className="py-1.5 pr-4">Action</th>
                      <th className="py-1.5 pr-4">Previous</th>
                      <th className="py-1.5 pr-4">New</th>
                      <th className="py-1.5 pr-4">By</th>
                      <th className="py-1.5 pr-4">Notes</th>
                    </tr>
                  </thead>
                  <tbody className="font-mono">
                    {history.map((h) => (
                      <tr key={h.id} className="border-b border-zinc-900">
                        <td className="py-1.5 pr-4">{formatTimestamp(h.timestamp, useZulu)}</td>
                        <td className="py-1.5 pr-4 font-sans uppercase">{h.role}</td>
                        <td className="py-1.5 pr-4 font-sans uppercase">{h.action.replace(/_/g, " ")}</td>
                        <td className="py-1.5 pr-4">{h.previousUserName ?? "--"}</td>
                        <td className="py-1.5 pr-4">{h.newUserName ?? "--"}</td>
                        <td className="py-1.5 pr-4">{h.actorName}</td>
                        <td className="py-1.5 pr-4 no-uppercase">{h.notes ?? ""}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </>
      )}
    </div>
  );
}

// Section 4.1 - "Jump to Nearest Targeted Launch Opportunity," matching the
// same nearest-targeted-entry pattern already used on the Dashboard and
// Range Ops Display.
function jumpToNearestTargeted(missions: Mission[], setSelectedMissionId: (id: string) => void): boolean {
  const targetedWithEntry = missions
    .map((m) => ({ mission: m, entry: m.launchPeriodEntries.find((e) => e.isTargeted) }))
    .filter((x): x is { mission: Mission; entry: NonNullable<typeof x.entry> } => !!x.entry)
    .sort((a, b) => new Date(a.entry.windowOpen).getTime() - new Date(b.entry.windowOpen).getTime());
  if (targetedWithEntry[0]) {
    setSelectedMissionId(targetedWithEntry[0].mission.id);
    return true;
  }
  return false;
}

function PersonnelListSection({ personnelList, canManage }: { personnelList?: PersonnelListEntry[]; canManage: boolean }) {
  const qc = useQueryClient();
  const [editingUserId, setEditingUserId] = useState<string | null>(null);

  const setQualMutation = useMutation({
    mutationFn: ({ userId, role, expiresAt }: { userId: string; role: QualificationRole; expiresAt: string | null }) =>
      setQualification(userId, role, expiresAt),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["personnel-list"] }),
  });
  const removeQualMutation = useMutation({
    mutationFn: ({ userId, role }: { userId: string; role: QualificationRole }) => removeQualification(userId, role),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["personnel-list"] }),
  });

  return (
    <section className="card p-5">
      <div className="mb-3 text-sm font-bold uppercase tracking-wide text-zinc-300">Personnel</div>
      <table className="w-full text-left text-sm">
        <thead>
          <tr className="border-b border-zinc-800 text-xs uppercase text-zinc-500">
            <th className="py-1.5 pr-4">Name</th>
            <th className="py-1.5 pr-4">Website Role</th>
            <th className="py-1.5 pr-4">Online</th>
            <th className="py-1.5 pr-4">Qualifications (RC / LWO / VSE)</th>
            {canManage && <th className="py-1.5 pr-4"></th>}
          </tr>
        </thead>
        <tbody>
          {personnelList?.map((p) => (
            <tr key={p.id} className="border-b border-zinc-900">
              <td className="py-2 pr-4">{p.name}</td>
              <td className="py-2 pr-4 text-xs text-zinc-400">{p.websiteRole.replace("_", " ")}</td>
              <td className="py-2 pr-4">
                <span className={`status-pill ${p.isOnline ? "status-go" : "status-neutral"}`}>{p.isOnline ? "ONLINE" : "OFFLINE"}</span>
              </td>
              <td className="py-2 pr-4 text-xs">
                {QUALIFIABLE_ROLES.map((r) => {
                  const tag = p.qualifications.find((q) => q.role === r);
                  const active = tag?.active;
                  return (
                    <span
                      key={r}
                      className={`mr-1.5 inline-block border px-1.5 py-0.5 ${
                        active ? "border-aat-go/50 text-aat-go" : tag ? "border-aat-nogo/50 text-aat-nogo" : "border-zinc-800 text-zinc-600"
                      }`}
                      title={tag?.expiresAt ? `Expires ${new Date(tag.expiresAt).toLocaleDateString()}` : undefined}
                    >
                      {r}
                      {tag && !active ? " (EXPIRED)" : ""}
                    </span>
                  );
                })}
              </td>
              {canManage && (
                <td className="py-2 pr-4">
                  <button onClick={() => setEditingUserId(p.id)} className="text-xs font-semibold text-aat-accent hover:underline">
                    Edit Tags
                  </button>
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>

      {editingUserId && (
        <QualificationEditModal
          person={personnelList!.find((p) => p.id === editingUserId)!}
          onClose={() => setEditingUserId(null)}
          onSet={(role, expiresAt) => setQualMutation.mutate({ userId: editingUserId, role, expiresAt })}
          onRemove={(role) => removeQualMutation.mutate({ userId: editingUserId, role })}
        />
      )}
    </section>
  );
}

function QualificationEditModal({
  person,
  onClose,
  onSet,
  onRemove,
}: {
  person: PersonnelListEntry;
  onClose: () => void;
  onSet: (role: QualificationRole, expiresAt: string | null) => void;
  onRemove: (role: QualificationRole) => void;
}) {
  const [expiryDrafts, setExpiryDrafts] = useState<Record<QualificationRole, string>>({ RC: "", LWO: "", VSE: "" });

  return (
    <div className="fixed inset-0 z-[2000] flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-md border border-zinc-800 bg-black p-6">
        <h2 className="mb-1 text-lg font-bold">Qualification Tags — {person.name}</h2>
        <p className="mb-4 text-xs text-zinc-500">
          A person-level attribute, applicable across every mission this person might work — not a per-mission setting.
        </p>
        <div className="space-y-3">
          {QUALIFIABLE_ROLES.map((r) => {
            const tag = person.qualifications.find((q) => q.role === r);
            return (
              <div key={r} className="flex items-center justify-between gap-2 border border-zinc-800 p-2">
                <div className="text-sm font-semibold">
                  {r} {tag ? <span className={tag.active ? "text-aat-go" : "text-aat-nogo"}>{tag.active ? "ACTIVE" : "EXPIRED"}</span> : <span className="text-zinc-600">NOT TAGGED</span>}
                </div>
                <div className="flex items-center gap-2">
                  <input
                    type="date"
                    className="input w-auto py-1 text-xs"
                    value={expiryDrafts[r]}
                    onChange={(e) => setExpiryDrafts((d) => ({ ...d, [r]: e.target.value }))}
                    title="Optional expiry date"
                  />
                  <button onClick={() => onSet(r, expiryDrafts[r] ? new Date(expiryDrafts[r]).toISOString() : null)} className="btn-secondary px-2 py-1 text-xs">
                    {tag ? "Update" : "Tag"}
                  </button>
                  {tag && (
                    <button onClick={() => onRemove(r)} className="border border-aat-nogo px-2 py-1 text-xs text-aat-nogo hover:bg-aat-nogo/10">
                      Remove
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
        <div className="mt-5 flex justify-end">
          <button onClick={onClose} className="btn-secondary">
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

function AssignmentSection({
  mission,
  canManage,
  personnelList,
  ld,
  rc,
  lwo,
  vse,
  opsSupport,
  onChanged,
}: {
  mission: Mission;
  canManage: boolean;
  personnelList: PersonnelListEntry[];
  ld: MissionPersonnelAssignmentRecord | null;
  rc: MissionPersonnelAssignmentRecord | null;
  lwo: MissionPersonnelAssignmentRecord | null;
  vse: MissionPersonnelAssignmentRecord | null;
  opsSupport: MissionPersonnelAssignmentRecord[];
  onChanged: () => void;
}) {
  const [ldModalOpen, setLdModalOpen] = useState(false);
  const [operatorRole, setOperatorRole] = useState<MissionRole>("RC");
  const [operatorUserId, setOperatorUserId] = useState("");

  const operators = personnelList.filter((p) => p.websiteRole === "OPERATOR");
  const launchDirectors = personnelList.filter((p) => p.websiteRole === "LAUNCH_DIRECTOR");

  const assignOperatorMutation = useMutation({
    mutationFn: () => assignOperator(mission.id, { userId: operatorUserId, role: operatorRole }),
    onSuccess: () => {
      onChanged();
      setOperatorUserId("");
    },
  });

  const removeMutation = useMutation({
    mutationFn: (assignmentId: string) => removePersonnelAssignment(mission.id, assignmentId),
    onSuccess: onChanged,
  });

  const selectedOperator = operators.find((p) => p.id === operatorUserId);
  const needsQualification = operatorRole === "RC" || operatorRole === "LWO" || operatorRole === "VSE";
  const isQualified = selectedOperator?.qualifications.find((q) => q.role === operatorRole)?.active ?? false;

  function handleAssignOperator() {
    if (!operatorUserId) return;
    if (needsQualification && !isQualified) {
      const proceed = window.confirm(
        `${selectedOperator?.name ?? "This person"} does not currently hold an active ${operatorRole} qualification tag. Assign anyway?`
      );
      if (!proceed) return;
    }
    assignOperatorMutation.mutate();
  }

  return (
    <section className="card space-y-5 p-5">
      <div className="text-sm font-bold uppercase tracking-wide text-zinc-300">
        Assign Personnel and Stations for Mission — {mission.designator}
      </div>

      {/* Section 4.2 - LD assignment */}
      <div className="border border-zinc-800 p-4">
        <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-zinc-500">Launch Director (LD)</div>
        <div className="flex items-center justify-between">
          <div className="text-sm">
            {ld ? (
              <>
                <span className="font-semibold">{ld.userName}</span>
                <span className="ml-2 text-xs text-zinc-500">
                  Assigned by {ld.assignedByName}, {new Date(ld.assignedAt).toLocaleString()}
                </span>
              </>
            ) : (
              <span className="text-aat-nogo">UNASSIGNED</span>
            )}
          </div>
          {canManage && (
            <button onClick={() => setLdModalOpen(true)} className="btn-secondary text-xs">
              {ld ? "Reassign LD" : "Assign LD"}
            </button>
          )}
        </div>
      </div>

      {/* Section 4.3 - RC/LWO/VSE/Ops Support */}
      <div className="border border-zinc-800 p-4">
        <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-zinc-500">Operators</div>
        <div className="mb-4 grid grid-cols-1 gap-2 sm:grid-cols-3">
          <RoleRow label="Range Coordinator (RC)" assignment={rc} canManage={canManage} onRemove={() => rc && removeMutation.mutate(rc.id)} />
          <RoleRow label="Launch Weather Officer (LWO)" assignment={lwo} canManage={canManage} onRemove={() => lwo && removeMutation.mutate(lwo.id)} />
          <RoleRow label="Vehicle Systems Engineer (VSE)" assignment={vse} canManage={canManage} onRemove={() => vse && removeMutation.mutate(vse.id)} />
        </div>

        <div className="mb-3">
          <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-zinc-500">Ops Support ({opsSupport.length})</div>
          {opsSupport.length === 0 ? (
            <p className="text-xs text-zinc-600">No Ops Support personnel assigned.</p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {opsSupport.map((a) => (
                <span key={a.id} className="flex items-center gap-2 border border-zinc-800 px-2 py-1 text-xs">
                  {a.userName}
                  {canManage && (
                    <button onClick={() => removeMutation.mutate(a.id)} className="text-aat-nogo hover:underline">
                      ×
                    </button>
                  )}
                </span>
              ))}
            </div>
          )}
        </div>

        {canManage && (
          <div className="flex flex-wrap items-center gap-2 border-t border-zinc-800 pt-3">
            <select value={operatorUserId} onChange={(e) => setOperatorUserId(e.target.value)} className="input w-auto min-w-[220px]">
              <option value="">Select an Operator...</option>
              {operators.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.name}
                </option>
              ))}
            </select>
            <select value={operatorRole} onChange={(e) => setOperatorRole(e.target.value as MissionRole)} className="input w-auto">
              <option value="RC">Range Coordinator (RC)</option>
              <option value="LWO">Launch Weather Officer (LWO)</option>
              <option value="VSE">Vehicle Systems Engineer (VSE)</option>
              <option value="OPS_SUPPORT">Ops Support</option>
            </select>
            <button onClick={handleAssignOperator} disabled={!operatorUserId} className="btn-primary text-xs disabled:opacity-40">
              Assign
            </button>
          </div>
        )}
      </div>

      {ldModalOpen && (
        <LdAssignmentModal mission={mission} launchDirectors={launchDirectors} onClose={() => setLdModalOpen(false)} onDone={onChanged} />
      )}
    </section>
  );
}

function RoleRow({
  label,
  assignment,
  canManage,
  onRemove,
}: {
  label: string;
  assignment: MissionPersonnelAssignmentRecord | null;
  canManage: boolean;
  onRemove: () => void;
}) {
  return (
    <div className="border border-zinc-800 p-3">
      <div className="text-[10px] uppercase tracking-wide text-zinc-500">{label}</div>
      <div className="mt-1 flex items-center justify-between text-sm">
        <span className={assignment ? "font-semibold" : "text-aat-nogo"}>{assignment ? assignment.userName : "UNASSIGNED"}</span>
        {canManage && assignment && (
          <button onClick={onRemove} className="text-xs text-aat-nogo hover:underline">
            Remove
          </button>
        )}
      </div>
    </div>
  );
}

function LdAssignmentModal({
  mission,
  launchDirectors,
  onClose,
  onDone,
}: {
  mission: Mission;
  launchDirectors: PersonnelListEntry[];
  onClose: () => void;
  onDone: () => void;
}) {
  const [step, setStep] = useState<"select" | "confirm">("select");
  const [candidateId, setCandidateId] = useState("");
  const [affirmed, setAffirmed] = useState(false);
  const [signatureName, setSignatureName] = useState("");
  const [signatureRole, setSignatureRole] = useState("");

  const candidate = launchDirectors.find((p) => p.id === candidateId);

  const mutation = useMutation({
    mutationFn: () => assignLd(mission.id, { userId: candidateId, signatureName: signatureName.trim(), signatureRole: signatureRole.trim() }),
    onSuccess: () => {
      onDone();
      onClose();
    },
  });

  const canSubmit = affirmed && !!signatureName.trim() && !!signatureRole.trim();

  return (
    <div className="fixed inset-0 z-[2000] flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-lg border border-zinc-800 bg-black p-6">
        <h2 className="mb-4 text-lg font-bold">Assign Launch Director</h2>

        {step === "select" && (
          <>
            <select value={candidateId} onChange={(e) => setCandidateId(e.target.value)} className="input">
              <option value="">Select a Launch Director...</option>
              {launchDirectors.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
            <div className="mt-4 flex justify-end gap-2">
              <button onClick={onClose} className="btn-secondary">
                Cancel
              </button>
              <button onClick={() => setStep("confirm")} disabled={!candidateId} className="btn-primary disabled:opacity-40">
                Continue
              </button>
            </div>
          </>
        )}

        {step === "confirm" && candidate && (
          <>
            {/* Section 4.2 - exact verbatim confirmation prompt */}
            <p className="no-uppercase mb-4 border border-zinc-800 bg-zinc-950/50 p-3 text-sm">
              Confirm you are selecting <strong>{candidate.name}</strong> as Mission Launch Director for <strong>{mission.name}</strong> (
              {mission.designator}).
            </p>
            <div className="space-y-2 border border-zinc-800 p-3">
              <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Attestation</div>
              <label className="flex items-start gap-2 text-xs">
                <input type="checkbox" className="mt-0.5 shrink-0" checked={affirmed} onChange={(e) => setAffirmed(e.target.checked)} />
                <span className="no-uppercase">{LD_ASSIGNMENT_ATTESTATION_TEXT}</span>
              </label>
            </div>
            <div className="mt-3 grid grid-cols-2 gap-2">
              <input placeholder="Typed full legal name" value={signatureName} onChange={(e) => setSignatureName(e.target.value)} className="input" />
              <input placeholder="Role" value={signatureRole} onChange={(e) => setSignatureRole(e.target.value)} className="input" />
            </div>
            <p className="no-uppercase mt-2 text-[11px] text-zinc-500">
              Digitally signed by the name and role entered above, timestamped at submission, as the e-signature of record.
            </p>
            {mutation.isError && (
              <p className="mt-2 text-xs text-aat-nogo">{(mutation.error as any)?.response?.data?.error ?? "Assignment failed"}</p>
            )}
            <div className="mt-4 flex justify-end gap-2">
              <button onClick={() => setStep("select")} className="btn-secondary">
                Back
              </button>
              <button onClick={() => mutation.mutate()} disabled={!canSubmit || mutation.isPending} className="btn-primary disabled:opacity-40">
                {mutation.isPending ? "Saving..." : "Confirm Assignment"}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// Section 8 - ON STATION table (LD/RC/LWO/VSE only; Ops Support excluded).
function OnStationTable({
  mission,
  ld,
  rc,
  lwo,
  vse,
  canManage,
  onChanged,
}: {
  mission: Mission;
  ld: MissionPersonnelAssignmentRecord | null;
  rc: MissionPersonnelAssignmentRecord | null;
  lwo: MissionPersonnelAssignmentRecord | null;
  vse: MissionPersonnelAssignmentRecord | null;
  canManage: boolean;
  onChanged: () => void;
}) {
  const { data: personnelList } = useQuery({ queryKey: ["personnel-list"], queryFn: fetchPersonnelList });
  const [overrideTarget, setOverrideTarget] = useState<{ assignment: MissionPersonnelAssignmentRecord; role: MissionRole } | null>(null);

  const stationMutation = useMutation({
    mutationFn: ({ assignmentId, onStation }: { assignmentId: string; onStation: boolean }) => toggleOnStation(mission.id, assignmentId, onStation),
    onSuccess: onChanged,
  });
  const clearOverrideMutation = useMutation({
    mutationFn: (assignmentId: string) => clearOffStationOverride(mission.id, assignmentId),
    onSuccess: onChanged,
  });

  const rows: { role: MissionRole; assignment: MissionPersonnelAssignmentRecord | null }[] = [
    { role: "LD", assignment: ld },
    { role: "RC", assignment: rc },
    { role: "LWO", assignment: lwo },
    { role: "VSE", assignment: vse },
  ];

  return (
    <section className="card p-5">
      <div className="mb-3 text-sm font-bold uppercase tracking-wide text-zinc-300">On Station</div>
      <table className="w-full text-left text-sm">
        <thead>
          <tr className="border-b border-zinc-800 text-xs uppercase text-zinc-500">
            <th className="py-1.5 pr-4">Name</th>
            <th className="py-1.5 pr-4">Mission Role</th>
            <th className="py-1.5 pr-4">Online Status</th>
            <th className="py-1.5 pr-4">On-Station Status</th>
            {canManage && <th className="py-1.5 pr-4"></th>}
          </tr>
        </thead>
        <tbody>
          {rows.map(({ role, assignment }) => {
            const isOnline = assignment ? personnelList?.find((p) => p.id === assignment.userId)?.isOnline ?? false : false;
            return (
              <tr key={role} className="border-b border-zinc-900">
                <td className="py-2 pr-4">{assignment ? assignment.userName : <span className="text-aat-nogo">UNASSIGNED</span>}</td>
                <td className="py-2 pr-4 text-xs uppercase">{role}</td>
                <td className="py-2 pr-4">
                  {assignment ? <span className={`status-pill ${isOnline ? "status-go" : "status-neutral"}`}>{isOnline ? "ONLINE" : "OFFLINE"}</span> : "--"}
                </td>
                <td className="py-2 pr-4">
                  {!assignment ? (
                    "--"
                  ) : assignment.offStationOverride ? (
                    <span className="status-pill status-caution" title={assignment.offStationOverrideReason ?? ""}>
                      OFF-STATION (OVERRIDDEN)
                    </span>
                  ) : assignment.onStationAt ? (
                    <span className="status-pill status-go">ON STATION</span>
                  ) : (
                    <span className="status-pill status-nogo">OFF STATION</span>
                  )}
                </td>
                {canManage && (
                  <td className="py-2 pr-4">
                    {assignment && (
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => stationMutation.mutate({ assignmentId: assignment.id, onStation: !assignment.onStationAt })}
                          className="text-xs font-semibold text-aat-accent hover:underline"
                        >
                          Mark {assignment.onStationAt ? "Off" : "On"} Station
                        </button>
                        {assignment.offStationOverride ? (
                          <button onClick={() => clearOverrideMutation.mutate(assignment.id)} className="text-xs text-zinc-400 hover:underline">
                            Clear Override
                          </button>
                        ) : (
                          <button onClick={() => setOverrideTarget({ assignment, role })} className="text-xs text-aat-caution hover:underline">
                            Override
                          </button>
                        )}
                      </div>
                    )}
                  </td>
                )}
              </tr>
            );
          })}
        </tbody>
      </table>

      {overrideTarget && (
        <OverrideModal
          mission={mission}
          role={overrideTarget.role}
          assignment={overrideTarget.assignment}
          onClose={() => setOverrideTarget(null)}
          onDone={onChanged}
        />
      )}
    </section>
  );
}

function OverrideModal({
  mission,
  role,
  assignment,
  onClose,
  onDone,
}: {
  mission: Mission;
  role: MissionRole;
  assignment: MissionPersonnelAssignmentRecord;
  onClose: () => void;
  onDone: () => void;
}) {
  const [affirmed, setAffirmed] = useState(false);
  const [reason, setReason] = useState("");

  const mutation = useMutation({
    mutationFn: () => setOffStationOverride(mission.id, assignment.id, reason.trim()),
    onSuccess: () => {
      onDone();
      onClose();
    },
  });

  return (
    <div className="fixed inset-0 z-[2000] flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-lg border border-zinc-800 bg-black p-6">
        <h2 className="mb-4 text-lg font-bold text-aat-caution">Off-Station Override</h2>
        <p className="no-uppercase mb-3 border border-zinc-800 bg-zinc-950/50 p-3 text-sm">
          {offStationOverrideAttestationText(role, assignment.userName, mission.designator)}
        </p>
        <label className="mb-3 flex items-start gap-2 text-xs">
          <input type="checkbox" className="mt-0.5 shrink-0" checked={affirmed} onChange={(e) => setAffirmed(e.target.checked)} />
          <span className="no-uppercase">I affirm the above.</span>
        </label>
        <textarea
          placeholder="Reason (required)"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          className="input"
          rows={3}
        />
        {mutation.isError && <p className="mt-2 text-xs text-aat-nogo">{(mutation.error as any)?.response?.data?.error ?? "Override failed"}</p>}
        <div className="mt-4 flex justify-end gap-2">
          <button onClick={onClose} className="btn-secondary">
            Cancel
          </button>
          <button
            onClick={() => mutation.mutate()}
            disabled={!affirmed || !reason.trim() || mutation.isPending}
            className="border border-aat-caution bg-aat-caution px-4 py-2 text-sm font-semibold text-black hover:bg-aat-caution/90 disabled:opacity-40"
          >
            {mutation.isPending ? "Saving..." : "Confirm Override"}
          </button>
        </div>
      </div>
    </div>
  );
}
