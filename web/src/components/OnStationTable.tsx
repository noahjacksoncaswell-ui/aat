import React, { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { clearOffStationOverride, fetchPersonnelList, setOffStationOverride, toggleOnStation } from "../api/resources";
import { offStationOverrideAttestationText } from "../types";
import type { Mission, MissionPersonnelAssignmentRecord, MissionRole } from "../types";

// v9.0 Section 3.3 - relocated verbatim from PersonnelStations.tsx (the
// v7.0 Section 8 ON STATION Table + Section 8.1 override modal), now
// removed from that page entirely and rendered only on the new Stations
// page (Section 4.3) - same columns, same Admin/LD override mechanism,
// unchanged functionally, just relocated.
export function OnStationTable({
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
