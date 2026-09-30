import React, { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  fetchMission,
  fetchMissions,
  fetchMissionComms,
  fetchMissionCommsActions,
  fetchLaunchStatusCheck,
  fetchMissionPersonnel,
  sendMissionComms,
} from "../api/resources";
import { useAuth } from "../context/AuthContext";
import { usePreferences } from "../context/PreferencesContext";
import { useMissionSocket, getSocket } from "../hooks/useSocket";
import { formatTimestamp } from "../utils/time";
import { OnStationTable } from "../components/OnStationTable";
import { PollItemRow } from "../components/LaunchStatusCheck";
import type { CommsActionDef, CommsFieldDef, CommsRecipient, Mission, MissionRole } from "../types";

// v9.0 Section 4 - Stations. A genuine "second monitor" page: situational
// awareness + the new Formal Role Communications system (Section 4.4).
// Does not duplicate or replace any role's real working tab (CCS/LWCC/
// Polls) - Section 4.4.4's non-authoritative boundary is load-bearing
// throughout this page: nothing here writes to MissionHold, PollItem, or
// any other module's state. Comms messages are pure log entries.

const ROLE_LABELS: Record<MissionRole, string> = {
  LD: "Launch Director (LD)",
  RC: "Range Coordinator (RC)",
  LWO: "Launch Weather Officer (LWO)",
  VSE: "Vehicle Systems Engineer (VSE)",
  OPS_SUPPORT: "Ops Support",
};

const RECIPIENTS: CommsRecipient[] = ["GENERAL", "LD", "LWO", "RC", "VSE"];

// v9.0 Section 4.4.2 - "System" field reuses the existing VSE Polls-box
// system list (Section 3.3 of v7.1); matches server/src/services/commsActions.ts.
const COMMS_SYSTEM_OPTIONS = ["Propulsion", "Avionics", "Telemetry", "Staging", "Recovery", "Pad", "LCS", "LOIS"];

// v9.0 Section 4.5 - "role-filtered milestone ticker...tagged to user's own
// station/role." MissionMilestone.responsibleStation is free text from the
// countdown sequence template (server/src/services/countdownSequence.ts),
// more granular than the 5 mission roles - this maps each mission role to
// the station-text values that belong to it.
const ROLE_TO_MILESTONE_STATIONS: Record<MissionRole, string[]> = {
  LD: ["Launch Director", "All Stations"],
  RC: ["Range", "Communications"],
  LWO: ["Weather/LWCC"],
  VSE: ["Propulsion", "Telemetry", "Recovery", "Pad", "Ground Systems/LCS"],
  OPS_SUPPORT: ["Ops Support"],
};

const QUICK_LINK_TAB: Record<MissionRole, string | null> = {
  LD: "CCS",
  LWO: "LWCC",
  RC: "Polls",
  VSE: "Polls",
  OPS_SUPPORT: null,
};

function jumpToNearestTargeted(missions: Mission[], setSelectedMissionId: (id: string) => void): boolean {
  const targetedWithEntry = missions
    .map((m) => ({ mission: m, entry: m.launchPeriodEntries.find((e) => e.isTargeted) }))
    .filter((x): x is { mission: Mission; entry: NonNullable<typeof x.entry> } => !!x.entry)
    .sort((a, b) => new Date(a.entry.windowOpen).getTime() - new Date(b.entry.windowOpen).getTime());
  if (targetedWithEntry.length === 0) return false;
  setSelectedMissionId(targetedWithEntry[0].mission.id);
  return true;
}

function fmtSeconds(totalSeconds: number): string {
  const sign = totalSeconds < 0 ? "+" : "-";
  const abs = Math.abs(Math.floor(totalSeconds));
  const h = Math.floor(abs / 3600);
  const m = Math.floor((abs % 3600) / 60);
  const s = abs % 60;
  return `T${sign}${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

export default function Stations() {
  const { user } = useAuth();
  const { useZulu } = usePreferences();
  const qc = useQueryClient();

  const { data: missions } = useQuery({ queryKey: ["missions", {}], queryFn: () => fetchMissions() });
  const [selectedMissionId, setSelectedMissionId] = useState("");
  const [defaulted, setDefaulted] = useState(false);

  useEffect(() => {
    if (defaulted || !missions || missions.length === 0) return;
    if (!jumpToNearestTargeted(missions, setSelectedMissionId)) setSelectedMissionId(missions[0].id);
    setDefaulted(true);
  }, [missions, defaulted]);

  const { data: mission } = useQuery({
    queryKey: ["mission", selectedMissionId],
    queryFn: () => fetchMission(selectedMissionId),
    enabled: !!selectedMissionId,
  });
  const { data: personnelState } = useQuery({
    queryKey: ["mission-personnel", selectedMissionId],
    queryFn: () => fetchMissionPersonnel(selectedMissionId),
    enabled: !!selectedMissionId,
  });
  const { data: commsActions } = useQuery({
    queryKey: ["mission-comms-actions", selectedMissionId],
    queryFn: () => fetchMissionCommsActions(selectedMissionId),
    enabled: !!selectedMissionId,
  });
  const { data: commsMessages } = useQuery({
    queryKey: ["mission-comms", selectedMissionId],
    queryFn: () => fetchMissionComms(selectedMissionId),
    enabled: !!selectedMissionId,
  });
  const { data: check } = useQuery({
    queryKey: ["launch-status-check", selectedMissionId],
    queryFn: () => fetchLaunchStatusCheck(selectedMissionId),
    enabled: !!selectedMissionId,
  });

  function invalidateAll() {
    qc.invalidateQueries({ queryKey: ["mission", selectedMissionId] });
    qc.invalidateQueries({ queryKey: ["mission-personnel", selectedMissionId] });
    qc.invalidateQueries({ queryKey: ["mission-comms", selectedMissionId] });
    qc.invalidateQueries({ queryKey: ["mission-comms-actions", selectedMissionId] });
    qc.invalidateQueries({ queryKey: ["launch-status-check", selectedMissionId] });
  }
  useMissionSocket(selectedMissionId || undefined, invalidateAll);

  const myAssignment = personnelState?.assignments.find((a) => a.userId === user?.id) ?? null;
  const myRole = commsActions?.role ?? myAssignment?.role ?? null;

  const targeted = mission?.launchPeriodEntries.find((e) => e.isTargeted) ?? null;
  const now = Date.now();
  const within24h = targeted
    ? (() => {
        const open = new Date(targeted.windowOpen).getTime();
        const close = new Date(targeted.windowClose).getTime();
        return (open <= now + 24 * 3600 * 1000 && open >= now) || (open <= now && close >= now);
      })()
    : false;
  const qualifies = !!myAssignment && within24h;

  // v9.0 Section 4.5 - lightweight, purely-relayed comms presence: re-emit
  // every 15s while this page is open for the selected mission, and prune
  // entries older than 40s locally. Never persisted server-side (see
  // server/src/websocket/index.ts).
  const [presence, setPresence] = useState<Record<string, { userName: string; at: number }>>({});
  useEffect(() => {
    if (!selectedMissionId || !user) return;
    const socket = getSocket();
    if (!socket) return;
    const emit = () => socket.emit("stations:present", { missionId: selectedMissionId, userName: user.name });
    emit();
    const interval = setInterval(emit, 15_000);
    const handler = (payload: { userId: string; userName: string; at: number }) => {
      setPresence((prev) => ({ ...prev, [payload.userId]: { userName: payload.userName, at: payload.at } }));
    };
    socket.on("stations:presence", handler);
    const prune = setInterval(() => {
      setPresence((prev) => {
        const cutoff = Date.now() - 40_000;
        const next: typeof prev = {};
        for (const [id, v] of Object.entries(prev)) if (v.at >= cutoff) next[id] = v;
        return next;
      });
    }, 10_000);
    return () => {
      clearInterval(interval);
      clearInterval(prune);
      socket.off("stations:presence", handler);
    };
  }, [selectedMissionId, user]);
  const presentViewers = Object.entries(presence).filter(([id]) => id !== user?.id);

  return (
    <div className="space-y-6 p-8">
      <header>
        <h1 className="text-2xl font-bold uppercase tracking-wide">Stations</h1>
      </header>

      {/* Section 4.2.1 - identity/status block, topmost element */}
      <section className="card p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="text-sm font-medium">{user?.name}</div>
            <div className="text-xs text-zinc-500">{user ? undefined : ""}</div>
            <div className="mt-2 text-lg font-bold uppercase tracking-wide">
              {!mission ? (
                "--"
              ) : qualifies && myRole ? (
                ROLE_LABELS[myRole]
              ) : (
                <span className="text-aat-nogo">NO ASSIGNMENT W/I 24HR</span>
              )}
            </div>
          </div>
          {mission && (
            <div className="text-right">
              <div className="text-[10px] uppercase tracking-wide text-zinc-500">Test Clock (T-)</div>
              <div className="font-mono text-xl">{mission.lot ? fmtSeconds((new Date(mission.lot).getTime() - now) / 1000) : "PENDING"}</div>
              <div className="text-[10px] text-zinc-500">Target: {mission.lot ? formatTimestamp(mission.lot, useZulu) : "--"}</div>
            </div>
          )}
        </div>
        <div className="mt-4">
          <StationStatusIndicator assignment={myAssignment} within24h={within24h} />
        </div>
      </section>

      {/* Section 4.2 - page-level mission selector */}
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
          <button onClick={() => missions && jumpToNearestTargeted(missions, setSelectedMissionId)} className="btn-secondary">
            Jump to Nearest Targeted Launch Opportunity
          </button>
          {presentViewers.length > 0 && (
            <span className="ml-auto text-xs text-zinc-500">
              Also viewing: {presentViewers.map(([, v]) => v.userName).join(", ")}
            </span>
          )}
        </div>
      </section>

      {mission && personnelState && (
        <>
          {/* Section 4.3 - relocated ON STATION table */}
          <OnStationTable
            mission={mission}
            ld={personnelState.assignments.find((a) => a.role === "LD") ?? null}
            rc={personnelState.assignments.find((a) => a.role === "RC") ?? null}
            lwo={personnelState.assignments.find((a) => a.role === "LWO") ?? null}
            vse={personnelState.assignments.find((a) => a.role === "VSE") ?? null}
            canManage={user?.role === "ADMIN" || user?.role === "LAUNCH_DIRECTOR"}
            onChanged={invalidateAll}
          />

          <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
            <CommsComposer missionId={mission.id} myRole={myRole} actions={commsActions?.actions ?? []} onSent={invalidateAll} />
            <LiveCommsFeed messages={commsMessages ?? []} useZulu={useZulu} />
          </div>

          <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
            <OutstandingItems mission={mission} myRole={myRole} check={check} messages={commsMessages ?? []} userId={user?.id} />
            <MyPollsMirror check={check} myRole={myRole} />
          </div>

          <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
            <MilestoneTicker mission={mission} myRole={myRole} useZulu={useZulu} />
            <QuickLinkAndTelemetry mission={mission} myRole={myRole} />
          </div>
        </>
      )}
    </div>
  );
}

// Section 4.2.1 - larger, read-only mirror of the sidebar's ON STATION
// check-in button (v7.0 Section 9) 4-state visual logic; the actual
// check-in action stays exclusively on the sidebar.
function StationStatusIndicator({ assignment, within24h }: { assignment: { onStationAt: string | null } | null; within24h: boolean }) {
  const [blinkOn, setBlinkOn] = useState(true);
  const onStation = !!assignment?.onStationAt;
  const shouldBlink = !onStation && within24h && !!assignment;

  useEffect(() => {
    if (!shouldBlink) return;
    const t = setInterval(() => setBlinkOn((b) => !b), 800);
    return () => clearInterval(t);
  }, [shouldBlink]);

  const baseClasses = "inline-block border px-4 py-2 text-sm font-bold uppercase tracking-wide";
  if (onStation) return <div className={`${baseClasses} border-aat-go bg-aat-go text-black`}>ON STATION</div>;
  if (shouldBlink)
    return (
      <div className={`${baseClasses} ${blinkOn ? "border-aat-caution bg-aat-caution text-black" : "border-zinc-700 bg-zinc-900 text-zinc-400"}`}>
        NOT ON STATION
      </div>
    );
  return <div className={`${baseClasses} border-zinc-800 bg-zinc-950 text-zinc-600`}>NOT ON STATION</div>;
}

// Section 4.4.1/4.4.2 - the comms composer. Sender role is resolved
// server-side and merely displayed here (never sent by the client); the
// action dropdown and its required fields are driven entirely by the
// catalog the server returns for the sender's own role.
function CommsComposer({
  missionId,
  myRole,
  actions,
  onSent,
}: {
  missionId: string;
  myRole: MissionRole | null;
  actions: CommsActionDef[];
  onSent: () => void;
}) {
  const [recipient, setRecipient] = useState<CommsRecipient>("GENERAL");
  const [actionCode, setActionCode] = useState("");
  const [fields, setFields] = useState<Record<string, unknown>>({});
  const [detail, setDetail] = useState("");
  const [error, setError] = useState<string | null>(null);

  const action = actions.find((a) => a.code === actionCode) ?? null;

  useEffect(() => {
    if (action?.recipientLockedToLd) setRecipient("LD");
  }, [action]);

  const mutation = useMutation({
    mutationFn: () => sendMissionComms(missionId, { recipient, actionCode, fields, detail: detail.trim() || undefined }),
    onSuccess: () => {
      setFields({});
      setDetail("");
      setError(null);
      onSent();
    },
    onError: (err: any) => setError(err?.response?.data?.error ?? "Failed to send message"),
  });

  if (!myRole) {
    return (
      <section className="card p-5">
        <div className="mb-3 text-sm font-bold uppercase tracking-wide text-zinc-300">Formal Role Communications</div>
        <p className="text-sm text-zinc-500">You hold no mission-role assignment on this mission and cannot send formal comms.</p>
      </section>
    );
  }

  function setField(id: string, value: unknown) {
    setFields((prev) => ({ ...prev, [id]: value }));
  }

  function renderField(fd: CommsFieldDef) {
    if (fd.id === "detail") return null; // detail has its own dedicated textarea below
    if (fd.id === "isIndefinite") {
      return (
        <label key={fd.id} className="flex items-center gap-2 text-xs">
          <input type="checkbox" checked={!!fields.isIndefinite} onChange={(e) => setField("isIndefinite", e.target.checked)} />
          Indefinite
        </label>
      );
    }
    if (fd.id === "duration") {
      if (fields.isIndefinite) return null;
      return (
        <label key={fd.id} className="text-xs">
          <div className="mb-1 text-zinc-500">{fd.label} (min)</div>
          <input
            type="number"
            min={0}
            className="input"
            value={typeof fields.duration === "number" ? fields.duration / 60 : ""}
            onChange={(e) => setField("duration", e.target.value === "" ? undefined : Number(e.target.value) * 60)}
          />
        </label>
      );
    }
    if (fd.id === "effectiveTime") {
      return (
        <label key={fd.id} className="text-xs">
          <div className="mb-1 text-zinc-500">{fd.label} (min from now; blank = immediate)</div>
          <input
            type="number"
            min={0}
            className="input"
            value={typeof fields.effectiveTime === "number" ? fields.effectiveTime / 60 : ""}
            onChange={(e) => setField("effectiveTime", e.target.value === "" ? undefined : Number(e.target.value) * 60)}
          />
        </label>
      );
    }
    if (fd.id === "system") {
      return (
        <label key={fd.id} className="text-xs">
          <div className="mb-1 text-zinc-500">{fd.label}</div>
          <select className="input" value={(fields.system as string) ?? ""} onChange={(e) => setField("system", e.target.value)}>
            <option value="">Select...</option>
            {COMMS_SYSTEM_OPTIONS.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </label>
      );
    }
    if (fd.id === "status") {
      return (
        <label key={fd.id} className="text-xs">
          <div className="mb-1 text-zinc-500">{fd.label}</div>
          <select className="input" value={(fields.status as string) ?? ""} onChange={(e) => setField("status", e.target.value)}>
            <option value="">Select...</option>
            {fd.statusOptions?.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </label>
      );
    }
    return (
      <label key={fd.id} className="text-xs">
        <div className="mb-1 text-zinc-500">{fd.label}</div>
        <input
          type="text"
          className="input"
          value={(fields[fd.id] as string) ?? ""}
          onChange={(e) => setField(fd.id, e.target.value)}
        />
      </label>
    );
  }

  const detailField = action?.fields.find((f) => f.id === "detail");

  return (
    <section className="card p-5">
      <div className="mb-3 flex items-center justify-between">
        <div className="text-sm font-bold uppercase tracking-wide text-zinc-300">Formal Role Communications</div>
        <span className="text-xs uppercase text-zinc-500">Sending as {ROLE_LABELS[myRole]}</span>
      </div>
      <div className="space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <label className="text-xs">
            <div className="mb-1 text-zinc-500">Recipient</div>
            <select
              className="input"
              value={recipient}
              disabled={!!action?.recipientLockedToLd}
              onChange={(e) => setRecipient(e.target.value as CommsRecipient)}
            >
              {RECIPIENTS.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>
          </label>
          <label className="text-xs">
            <div className="mb-1 text-zinc-500">Action</div>
            <select
              className="input"
              value={actionCode}
              onChange={(e) => {
                setActionCode(e.target.value);
                setFields({});
              }}
            >
              <option value="">Select action...</option>
              {actions.map((a) => (
                <option key={a.code} value={a.code}>
                  {a.label} ({a.code})
                </option>
              ))}
            </select>
          </label>
        </div>

        {action && action.fields.length > 0 && <div className="grid grid-cols-2 gap-3">{action.fields.map(renderField)}</div>}

        {(detailField || actionCode === "OTHER") && (
          <label className="block text-xs">
            <div className="mb-1 text-zinc-500">Detail{detailField?.required ? " (required)" : " (optional)"}</div>
            <textarea className="input" rows={2} value={detail} onChange={(e) => setDetail(e.target.value)} />
          </label>
        )}

        {error && <p className="text-xs text-aat-nogo">{error}</p>}

        <button
          onClick={() => actionCode && mutation.mutate()}
          disabled={!actionCode || mutation.isPending}
          className="w-full rounded-md bg-white px-4 py-2 text-sm font-semibold text-black disabled:opacity-40"
        >
          {mutation.isPending ? "Transmitting..." : "TRANSMIT"}
        </button>
      </div>
    </section>
  );
}

function LiveCommsFeed({ messages, useZulu }: { messages: { id: string; line: string; timestamp: string }[]; useZulu: boolean }) {
  const recent = [...messages].sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()).slice(0, 30);
  return (
    <section className="card p-5">
      <div className="mb-3 text-sm font-bold uppercase tracking-wide text-zinc-300">Live Comms Feed</div>
      <div className="max-h-96 space-y-1 overflow-y-auto font-mono text-xs">
        {recent.length === 0 && <p className="font-sans text-sm text-zinc-500">No formal comms activity yet.</p>}
        {recent.map((m) => (
          <div key={m.id} className="border-b border-zinc-900 py-1">
            PEMSG {m.line}
          </div>
        ))}
      </div>
      <p className="mt-2 text-[10px] text-zinc-600">Full permanent record: Mission Detail → History tab (Unified Mission Command Log).</p>
    </section>
  );
}

// v9.0 Section 4.5 - role-filtered worklist. "Not yet acknowledged" has no
// dedicated backend field for general directed messages (only REC HOLD/
// REC TERM track resolution) - interpretive choice: a message addressed to
// my role is treated as acknowledged once I have sent any ACK-coded
// message in this mission after it, since there is no per-message ack
// mechanism in the composer (Section 4.4.1 gives no "reply to" control).
function OutstandingItems({
  mission,
  myRole,
  check,
  messages,
  userId,
}: {
  mission: Mission;
  myRole: MissionRole | null;
  check: { items: { key: string; box: string; label: string; status: string }[] } | undefined;
  messages: { id: string; senderId: string; senderRole: MissionRole; recipient: CommsRecipient; actionCode: string; resolvedAt: string | null; timestamp: string; line: string }[];
  userId?: string;
}) {
  const unpolled = myRole && check ? check.items.filter((i) => i.box === myRole && i.status === "UNPOLLED") : [];
  const myOutstandingRecs = userId ? messages.filter((m) => m.senderId === userId && (m.actionCode === "REC HOLD" || m.actionCode === "REC TERM") && !m.resolvedAt) : [];

  const myAckTimestamps = myRole ? messages.filter((m) => m.senderId === userId && m.actionCode === "ACK").map((m) => new Date(m.timestamp).getTime()) : [];
  const lastAck = myAckTimestamps.length ? Math.max(...myAckTimestamps) : 0;
  const unacknowledged = myRole
    ? messages.filter((m) => m.recipient === myRole && m.senderId !== userId && new Date(m.timestamp).getTime() > lastAck)
    : [];

  const totalCount = unpolled.length + myOutstandingRecs.length + unacknowledged.length;

  return (
    <section className="card p-5">
      <div className="mb-3 text-sm font-bold uppercase tracking-wide text-zinc-300">Your Outstanding Items ({totalCount})</div>
      {totalCount === 0 && <p className="text-sm text-zinc-500">Nothing outstanding.</p>}
      {unpolled.length > 0 && (
        <div className="mb-3">
          <div className="mb-1 text-[11px] font-semibold uppercase text-zinc-500">Unpolled Items</div>
          {unpolled.map((i) => (
            <div key={i.key} className="border-b border-zinc-900 py-1 text-xs">
              {i.label}
            </div>
          ))}
        </div>
      )}
      {myOutstandingRecs.length > 0 && (
        <div className="mb-3">
          <div className="mb-1 text-[11px] font-semibold uppercase text-zinc-500">Awaiting LD Decision</div>
          {myOutstandingRecs.map((m) => (
            <div key={m.id} className="border-b border-zinc-900 py-1 font-mono text-xs">
              {m.line}
            </div>
          ))}
        </div>
      )}
      {unacknowledged.length > 0 && (
        <div>
          <div className="mb-1 text-[11px] font-semibold uppercase text-zinc-500">Not Yet Acknowledged</div>
          {unacknowledged.map((m) => (
            <div key={m.id} className="border-b border-zinc-900 py-1 font-mono text-xs">
              {m.line}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

// Section 4.5 - compact, read-only mirror of the user's own role's Polls
// box; the actual interactive dropdowns remain exclusively on the Polls tab.
function MyPollsMirror({ check, myRole }: { check: { items: { key: string; box: string; label: string; status: string }[] } | undefined; myRole: MissionRole | null }) {
  if (!myRole || myRole === "OPS_SUPPORT") {
    return (
      <section className="card p-5">
        <div className="mb-3 text-sm font-bold uppercase tracking-wide text-zinc-300">Your Polls Box</div>
        <p className="text-sm text-zinc-500">{!myRole ? "No assignment on this mission." : "No Polls box applies to Ops Support."}</p>
      </section>
    );
  }
  const items = check?.items.filter((i) => i.box === myRole) ?? [];
  return (
    <section className="card p-5">
      <div className="mb-3 text-sm font-bold uppercase tracking-wide text-zinc-300">Your Polls Box ({ROLE_LABELS[myRole]})</div>
      <div className="space-y-1.5">
        {items.length === 0 && <p className="text-sm text-zinc-500">Loading...</p>}
        {items.map((i) => (
          <PollItemRow key={i.key} label={i.label} status={i.status} options={[]} readOnly />
        ))}
      </div>
    </section>
  );
}

function MilestoneTicker({ mission, myRole, useZulu }: { mission: Mission; myRole: MissionRole | null; useZulu: boolean }) {
  const stations = myRole ? ROLE_TO_MILESTONE_STATIONS[myRole] : [];
  const upcoming = (mission.milestones ?? [])
    .filter((m) => m.status !== "COMPLETE" && m.responsibleStation && stations.includes(m.responsibleStation))
    .sort((a, b) => b.tMinusSeconds - a.tMinusSeconds);

  return (
    <section className="card p-5">
      <div className="mb-3 text-sm font-bold uppercase tracking-wide text-zinc-300">Your Upcoming Milestones</div>
      {!myRole && <p className="text-sm text-zinc-500">No assignment on this mission.</p>}
      {myRole && upcoming.length === 0 && <p className="text-sm text-zinc-500">No upcoming milestones tagged to your station.</p>}
      <div className="space-y-1.5">
        {upcoming.map((m) => (
          <div key={m.id} className="flex items-center justify-between border-b border-zinc-900 py-1 text-xs">
            <span>{m.label}</span>
            <span className="font-mono text-zinc-500">T-{Math.floor(m.tMinusSeconds / 60)}min</span>
          </div>
        ))}
      </div>
    </section>
  );
}

function QuickLinkAndTelemetry({ mission, myRole }: { mission: Mission; myRole: MissionRole | null }) {
  const qc = useQueryClient();
  const [telemetryStatus, setTelemetryStatus] = useState<"NOMINAL" | "DEGRADED" | "LOST">("NOMINAL");
  const tab = myRole ? QUICK_LINK_TAB[myRole] : null;

  const mutation = useMutation({
    mutationFn: () => sendMissionComms(mission.id, { recipient: "LD", actionCode: "TLM STAT", fields: { status: telemetryStatus }, detail: `Telemetry ${telemetryStatus}` }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["mission-comms", mission.id] }),
  });

  return (
    <section className="card space-y-4 p-5">
      <div>
        <div className="mb-2 text-sm font-bold uppercase tracking-wide text-zinc-300">Quick Link</div>
        {tab ? (
          <Link to={`/missions/${mission.id}?tab=${tab}`} className="btn-secondary inline-block">
            Go to {tab} Tab
          </Link>
        ) : (
          <Link to={`/missions/${mission.id}`} className="btn-secondary inline-block">
            Go to Overview
          </Link>
        )}
      </div>
      {myRole === "VSE" && (
        <div>
          <div className="mb-2 text-sm font-bold uppercase tracking-wide text-zinc-300">Telemetry Quick-Status</div>
          <div className="flex items-center gap-2">
            <select className="input w-auto" value={telemetryStatus} onChange={(e) => setTelemetryStatus(e.target.value as typeof telemetryStatus)}>
              <option value="NOMINAL">NOMINAL</option>
              <option value="DEGRADED">DEGRADED</option>
              <option value="LOST">LOST</option>
            </select>
            <button onClick={() => mutation.mutate()} disabled={mutation.isPending} className="btn-secondary">
              {mutation.isPending ? "Sending..." : "Send TLM STAT"}
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
