import React, { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  clearPollItemOverride,
  confirmLaunchCountTime,
  fetchLaunchStatusCheck,
  fetchLwccState,
  fetchMissionPersonnel,
  fetchPollHistory,
  setPollItem,
} from "../api/resources";
import { useAuth } from "../context/AuthContext";
import { usePreferences } from "../context/PreferencesContext";
import { useMissionSocket } from "../hooks/useSocket";
import { formatTimestamp } from "../utils/time";
import type { LaunchStatusCheckState, PollBoxRole } from "../types";

// v7.1 Section 3, reworked by v7.1.1 Section 3 - the Launch Status Check's
// four role-owned boxes + completion banner, as ONE shared component used
// by both Mission Detail's Polls tab (interactive) and Range Ops Display
// (read-only, large-format) so the two can never drift apart the way the
// pre-v7.1.1 Range Ops poll section did. `readOnly` suppresses every
// interactive control (dropdowns render as plain status pills, no Admin
// Override buttons, no Launch Count Time input); `large` scales text up
// for the big-board display, matching the `large` prop convention already
// used by PersistentClockHeader.

export const POLL_BOX_LABELS: Record<PollBoxRole, string> = {
  VSE: "VEHICLE SYSTEMS ENGINEER (VSE)",
  LWO: "LAUNCH WEATHER OFFICER (LWO)",
  RC: "RANGE COORDINATOR (RC)",
  LD: "LAUNCH DIRECTOR (LD)",
};
export const STANDARD_OPTIONS = ["UNPOLLED", "GO", "NO_GO", "HOLD"];
export const WEATHER_OPTIONS = ["UNPOLLED", "CLEAR", "NOT_CLEAR", "HOLD"];
export const RANGE_STATUS_OPTIONS = ["UNPOLLED", "CLEAR_TO_PROCEED", "NOT_CLEAR_TO_PROCEED", "HOLD"];
export const FINAL_STATUS_OPTIONS = ["UNPOLLED", "GO_FOR_LAUNCH", "NO_GO", "HOLD"];

// A single classifier every GO/NO-GO-flavored color in this file derives
// from, so the dropdown border color (edit mode) and the plain status
// pill (read-only / Range Ops mode) can never show different colors for
// the same status value.
export function pollStatusTone(status: string): "go" | "nogo" | "caution" | "neutral" {
  if (["GO", "CLEAR", "CLEAR_TO_PROCEED", "GO_FOR_LAUNCH"].includes(status)) return "go";
  if (["NO_GO", "NOT_CLEAR", "NOT_CLEAR_TO_PROCEED"].includes(status)) return "nogo";
  if (status === "HOLD") return "caution";
  return "neutral";
}
export function pollColor(status: string) {
  const tone = pollStatusTone(status);
  if (tone === "go") return "border-aat-go text-aat-go";
  if (tone === "nogo") return "border-aat-nogo text-aat-nogo";
  if (tone === "caution") return "border-aat-caution text-aat-caution";
  return "border-zinc-700 text-zinc-500";
}

// Section 3.2 - on-station status indicator: green (on station, regardless
// of window proximity), blinking orange (not on station, within 24h of the
// Targeted Launch Opportunity), or grayed "NOT ON STATION" (not on
// station, more than 24h out or no TLO confirmed).
export function OnStationIndicator({ assignment, within24h }: { assignment: any; within24h: boolean }) {
  const [blinkOn, setBlinkOn] = useState(true);
  const onStation = !!assignment?.onStationAt;
  const shouldBlink = !onStation && within24h;

  useEffect(() => {
    if (!shouldBlink) return;
    const t = setInterval(() => setBlinkOn((b) => !b), 800);
    return () => clearInterval(t);
  }, [shouldBlink]);

  if (onStation) return <span className="status-pill status-go">ON STATION</span>;
  if (shouldBlink) return <span className={`status-pill ${blinkOn ? "status-caution" : "status-neutral"}`}>NOT ON STATION</span>;
  return <span className="status-pill status-neutral">NOT ON STATION</span>;
}

// Section 3.7 - the box is outlined in the accent color when the viewer is
// its assigned holder; individual controls inside are gated separately.
export function RoleBoxShell({
  boxLabel,
  assignmentName,
  isOwn,
  indicator,
  large,
  children,
}: {
  boxLabel: string;
  assignmentName: string;
  isOwn: boolean;
  indicator: React.ReactNode;
  large?: boolean;
  children: React.ReactNode;
}) {
  return (
    <section className={`card ${large ? "p-3" : "p-5"} ${isOwn ? "border-2 border-aat-accent" : ""}`}>
      <div className={`flex items-center justify-between ${large ? "mb-2" : "mb-3"}`}>
        <div>
          <div className={`font-bold uppercase tracking-wide ${large ? "text-sm" : "text-sm"}`}>{boxLabel}</div>
          <div className={`${large ? "text-[11px]" : "text-xs"} ${assignmentName === "UNASSIGNED" ? "text-aat-nogo" : "text-zinc-500"}`}>
            {assignmentName}
          </div>
        </div>
        {indicator}
      </div>
      <div className={large ? "space-y-1" : "space-y-2"}>{children}</div>
    </section>
  );
}

// A normal 4(or fewer)-state dropdown, usable only by the box's assigned
// holder; Admin gets a separate one-click "Override" control beside it
// (Section 3.7) that forces the item to its GO/proceed/clear equivalent,
// bypassing the assigned-person-only restriction - logged server-side as
// an override whenever the actor isn't the assigned holder. In readOnly
// mode (Range Ops Display), renders as a plain color-coded status pill
// with no interactive control at all.
export function PollItemRow({
  label,
  status,
  options,
  canEdit,
  isAdmin,
  affirmativeValue,
  onSet,
  updatedByName,
  updatedAt,
  useZulu,
  readOnly,
  large,
}: {
  label: string;
  status: string;
  options: string[];
  canEdit?: boolean;
  isAdmin?: boolean;
  affirmativeValue?: string;
  onSet?: (status: string) => void;
  updatedByName?: string | null;
  updatedAt?: string | null;
  useZulu?: boolean;
  readOnly?: boolean;
  large?: boolean;
}) {
  const textSize = large ? "text-base" : "text-sm";
  if (readOnly) {
    return (
      <div className={`flex items-center justify-between border border-zinc-800 px-3 py-2 ${textSize}`}>
        <span>{label}</span>
        <span className={`status-pill status-${pollStatusTone(status)}`}>{status.replace(/_/g, " ")}</span>
      </div>
    );
  }
  return (
    <div className={`border border-zinc-800 px-3 py-2 ${textSize}`}>
      <div className="flex items-center justify-between">
        <span>{label}</span>
        <div className="flex items-center gap-2">
          <select
            value={status}
            disabled={!canEdit}
            onChange={(e) => onSet?.(e.target.value)}
            className={`input w-auto py-1 text-xs disabled:opacity-40 ${pollColor(status)}`}
          >
            {options.map((o) => (
              <option key={o} value={o}>
                {o.replace(/_/g, " ")}
              </option>
            ))}
          </select>
          {isAdmin && (
            <button
              onClick={() => onSet?.(affirmativeValue!)}
              className="text-[10px] font-semibold text-aat-caution hover:underline"
              title="Admin override"
            >
              Override
            </button>
          )}
        </div>
      </div>
      {updatedByName && (
        <div className="mt-0.5 text-[10px] text-zinc-600">
          Last set by {updatedByName}
          {updatedAt ? `, ${formatTimestamp(updatedAt, useZulu ?? true)}` : ""}
        </div>
      )}
    </div>
  );
}

// v7.1.2 - Range Ops Display only: a small, dense, entirely color-coded
// block (its own background/border/text color IS the status indicator -
// no separate floating badge, no dropdown). Used instead of PollItemRow
// when readOnly, arranged in a compact grid per box so a role's full item
// set is a small cluster of tiles rather than one full-width line per
// item - that's what makes the whole board fit on one screen.
function PollItemTile({ label, status, style }: { label: string; status: string; style?: React.CSSProperties }) {
  return (
    <div
      style={style}
      className={`status-pill status-${pollStatusTone(status)} flex h-full w-full flex-col items-center justify-center gap-0 px-2 py-6 text-center text-lg font-bold uppercase leading-tight`}
    >
      {label}
    </div>
  );
}

// Section 3.4 - a live, read-only readout of the LWCC banner (Section
// 7.1/v3.0, as corrected by later revisions) - never a separately-set
// manual value, and matches that banner's own NO VIOLATION/VIOLATION
// format and violation enumeration exactly. Already read-only by nature,
// so this one component serves both contexts unchanged.
export function LwccReadoutRow({ lwcc, large }: { lwcc: any; large?: boolean }) {
  const textSize = large ? "text-base" : "text-sm";
  if (!lwcc) return <div className={`border border-zinc-800 px-3 py-2 ${textSize} text-zinc-500`}>Loading LWCC status...</div>;
  return (
    <div className={`border border-zinc-800 px-3 py-2 ${textSize}`}>
      <div className="flex items-center justify-between">
        <span>LWCC</span>
        <span className={`status-pill ${lwcc.bannerStatus === "VIOLATION" ? "status-nogo" : "status-go"}`}>{lwcc.bannerStatus.replace("_", " ")}</span>
      </div>
      {lwcc.bannerStatus === "VIOLATION" && (
        <ul className="mt-1 space-y-0.5 text-[11px] text-zinc-400">
          {lwcc.violatingRows.map((r: any) => (
            <li key={r.no} className="font-mono">
              — LWCCR {r.no} ({r.description}){r.currentValue != null ? ` — CURRENT: ${r.currentValue.toFixed(1)}` : ""}
            </li>
          ))}
        </ul>
      )}
      {!large && <div className="mt-0.5 text-[10px] text-zinc-600">Live readout from the LWCC tab — not independently editable here.</div>}
    </div>
  );
}

// Section 3.5 - Airspace is computed (UNPOLLED more than 24h out; GO once
// the NOTAM/T-60/T-15 checklist is complete within 24h, NO-GO otherwise -
// Termination is deliberately excluded). No one "sets" it normally; an
// Admin override is the only way to force a value, and it persists until
// cleared (reverting to the live-computed value). readOnly (Range Ops)
// never shows the override controls at all.
export function AirspaceRow({
  item,
  checklist,
  isAdmin,
  missionId,
  onChanged,
  readOnly,
  large,
}: {
  item: { status: string; isOverridden: boolean };
  checklist: { notamFiled: boolean; t60Complete: boolean; t15Complete: boolean };
  isAdmin: boolean;
  missionId: string;
  onChanged: () => void;
  readOnly?: boolean;
  large?: boolean;
}) {
  const setMutation = useMutation({ mutationFn: (status: string) => setPollItem(missionId, "RC_AIRSPACE", status), onSuccess: onChanged });
  const clearMutation = useMutation({ mutationFn: () => clearPollItemOverride(missionId, "RC_AIRSPACE"), onSuccess: onChanged });
  const textSize = large ? "text-base" : "text-sm";

  return (
    <div className={`border border-zinc-800 px-3 py-2 ${textSize}`}>
      <div className="flex items-center justify-between">
        <span>Airspace</span>
        <div className="flex items-center gap-2">
          {readOnly ? (
            <span className={`status-pill status-${pollStatusTone(item.status)}`}>{item.status.replace(/_/g, " ")}</span>
          ) : (
            <>
              <span className={`border px-2 py-0.5 text-xs font-semibold ${pollColor(item.status)}`}>{item.status.replace(/_/g, " ")}</span>
              {item.isOverridden && <span className="text-[10px] text-aat-caution">(OVERRIDDEN)</span>}
              {isAdmin && !item.isOverridden && (
                <button onClick={() => setMutation.mutate("GO")} className="text-[10px] font-semibold text-aat-caution hover:underline">
                  Override → GO
                </button>
              )}
              {isAdmin && item.isOverridden && (
                <button onClick={() => clearMutation.mutate()} className="text-[10px] text-zinc-400 hover:underline">
                  Clear Override
                </button>
              )}
            </>
          )}
        </div>
      </div>
      {!readOnly && (
        <div className="mt-1 text-[10px] text-zinc-600">
          Computed: NOTAM {checklist.notamFiled ? "FILED" : "NOT FILED"} · T-60 {checklist.t60Complete ? "COMPLETE" : "PENDING"} · T-15{" "}
          {checklist.t15Complete ? "COMPLETE" : "PENDING"}
        </div>
      )}
    </div>
  );
}

// Section 3.6, gated by v7.1.1 Section 1 - the LD's callout-and-readback
// confirmation of the Launch Clock's current projected liftoff time.
// Genuinely non-interactive (not merely unenforced) until every poll item
// reads GO - readiness.allGo, computed server-side from the same catalog
// the boxes render, is the single source of truth for "ready," so this
// can never disagree with what the boxes above are showing. Polls-tab
// only - Range Ops Display's item list (Section 3/4 of the v7.1.1
// directive) does not include this control.
function LaunchCountTimeBlock({
  missionId,
  check,
  canEdit,
  isAdmin,
  useZulu,
  onChanged,
}: {
  missionId: string;
  check: LaunchStatusCheckState;
  canEdit: boolean;
  isAdmin: boolean;
  useZulu: boolean;
  onChanged: () => void;
}) {
  const [entered, setEntered] = useState("");
  const [error, setError] = useState<string | null>(null);
  const mutation = useMutation({
    mutationFn: () => confirmLaunchCountTime(missionId, entered),
    onSuccess: () => {
      setError(null);
      setEntered("");
      onChanged();
    },
    onError: (err: any) => setError(err?.response?.data?.error ?? "Confirmation failed"),
  });
  const notReady = !check.readiness.allGo;
  const disabled = (!canEdit && !isAdmin) || notReady;

  return (
    <div className="border border-zinc-800 p-3">
      <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-zinc-500">Launch Count Time Confirmation</div>
      <div className="mb-2 text-xs text-zinc-400">
        Launch Clock projected liftoff:{" "}
        <span className="font-mono text-zinc-200">
          {check.launchCountTime.projectedLiftoff ? formatTimestamp(check.launchCountTime.projectedLiftoff, true) : "--"}
        </span>
      </div>
      {check.launchCountTime.confirmed ? (
        <div className="text-xs font-semibold text-aat-go">
          CONFIRMED by {check.launchCountTime.confirmedByName}
          {check.launchCountTime.confirmedAt ? `, ${formatTimestamp(check.launchCountTime.confirmedAt, useZulu)}` : ""}
        </div>
      ) : (
        <>
          {/* v7.1.1 Section 1, step 2 - genuinely non-interactive, not
              merely unenforced, until every item above reads GO. */}
          {notReady && (
            <p className="mb-2 text-[11px] text-zinc-500">
              Locked until every poll item across all four boxes reads GO ({check.readiness.notGoItems.length} item
              {check.readiness.notGoItems.length === 1 ? "" : "s"} remaining).
            </p>
          )}
          <div className="flex items-center gap-2">
            <input
              value={entered}
              onChange={(e) => setEntered(e.target.value)}
              placeholder="HHMM Zulu"
              disabled={disabled}
              className="input w-32 py-1 text-xs disabled:opacity-40"
            />
            <button
              onClick={() => mutation.mutate()}
              disabled={disabled || !entered.trim() || mutation.isPending}
              className="btn-secondary px-2 py-1 text-xs disabled:opacity-40"
            >
              {mutation.isPending ? "Confirming..." : "Confirm"}
            </button>
          </div>
        </>
      )}
      {error && <p className="mt-1 text-[11px] text-aat-nogo">{error}</p>}
    </div>
  );
}

// Section 3.8, corrected by v7.1.1 Section 1 step 3 - the single
// completion banner: GO only once the Launch Count Time Confirmation has
// actually been submitted and accepted (Final Launch Status = GO FOR
// LAUNCH is a prerequisite for that submission, not the completion event
// itself). Identical component used on both the Polls tab and Range Ops
// Display, so the two banners can never show different text or color.
export function CompletionBanner({ check, useZulu, large }: { check: LaunchStatusCheckState; useZulu: boolean; large?: boolean }) {
  const textSize = large ? "text-lg" : "text-sm";
  if (check.completion.isGo && check.completion.completedAt) {
    return (
      <div className={`card border-2 border-aat-go bg-aat-go/10 p-4 text-center font-bold uppercase tracking-wide text-aat-go ${textSize}`}>
        LAUNCH STATUS CHECK: GO — LSC COMPLETED AT {formatTimestamp(check.completion.completedAt, useZulu)} — PROCEEDING WITH TERMINAL COUNT UPON
        PROGRAMMED LSC HOLD RELEASE
      </div>
    );
  }
  return (
    <div className={`card border border-zinc-700 p-4 text-center font-bold uppercase tracking-wide text-zinc-400 ${textSize}`}>
      LAUNCH STATUS CHECK: IN PROGRESS — NOT YET COMPLETE
    </div>
  );
}

function PollHistoryPanel({ history, useZulu }: { history: any; useZulu: boolean }) {
  return (
    <section className="card p-5">
      <div className="mb-3 text-sm font-bold uppercase tracking-wide text-zinc-300">Launch Status Check Activity Log</div>
      {!history?.length ? (
        <p className="text-sm text-zinc-500">No poll activity on file for this mission.</p>
      ) : (
        <div className="max-h-72 overflow-y-auto">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="border-b border-zinc-800 text-zinc-500">
                <th className="py-1.5 pr-4">When</th>
                <th className="py-1.5 pr-4">Item</th>
                <th className="py-1.5 pr-4">Previous</th>
                <th className="py-1.5 pr-4">New</th>
                <th className="py-1.5 pr-4">By</th>
                <th className="py-1.5 pr-4">Override?</th>
              </tr>
            </thead>
            <tbody className="font-mono">
              {history.map((h: any) => (
                <tr key={h.id} className="border-b border-zinc-900">
                  <td className="py-1.5 pr-4">{formatTimestamp(h.timestamp, useZulu)}</td>
                  <td className="py-1.5 pr-4 font-sans uppercase">{h.itemKey.replace(/_/g, " ")}</td>
                  <td className="py-1.5 pr-4">{h.previousValue ?? "--"}</td>
                  <td className="py-1.5 pr-4">{h.newValue}</td>
                  <td className="py-1.5 pr-4">{h.actorName}</td>
                  <td className="py-1.5 pr-4 font-sans">{h.isOverride ? <span className="text-aat-caution">YES</span> : "No"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

// The top-level shared component: owns all data-fetching and live-update
// wiring, and renders the banner + four boxes (+ history log, edit mode
// only). Mission Detail's Polls tab and Range Ops Display both render
// this directly - neither maintains its own copy of the box/item markup,
// which is what let the two drift apart before this correction.
export function LaunchStatusCheckBoard({
  mission,
  missionId,
  readOnly,
  large,
  showHistory,
}: {
  mission: any;
  missionId: string;
  readOnly?: boolean;
  large?: boolean;
  showHistory?: boolean;
}) {
  const { user, isAdmin } = useAuth();
  const { useZulu } = usePreferences();
  const qc = useQueryClient();

  const { data: personnelState } = useQuery({ queryKey: ["mission-personnel", missionId], queryFn: () => fetchMissionPersonnel(missionId) });
  const { data: check } = useQuery({
    queryKey: ["launch-status-check", missionId],
    queryFn: () => fetchLaunchStatusCheck(missionId),
    refetchInterval: 15_000,
  });
  const { data: lwcc } = useQuery({ queryKey: ["lwcc", missionId], queryFn: () => fetchLwccState(missionId), refetchInterval: 30_000 });
  const { data: history } = useQuery({
    queryKey: ["poll-history", missionId],
    queryFn: () => fetchPollHistory(missionId),
    enabled: !!showHistory,
  });

  function invalidate() {
    qc.invalidateQueries({ queryKey: ["launch-status-check", missionId] });
    qc.invalidateQueries({ queryKey: ["poll-history", missionId] });
  }
  useMissionSocket(missionId, invalidate);

  const setItemMutation = useMutation({
    mutationFn: ({ key, status }: { key: string; status: string }) => setPollItem(missionId, key, status),
    onSuccess: invalidate,
    onError: (err: any) => alert(err?.response?.data?.error ?? "Failed to update"),
  });

  if (!check || !personnelState) {
    return <div className={`p-6 text-slate-400 ${large ? "text-lg" : ""}`}>Loading Launch Status Check...</div>;
  }

  // v7.1.1 Section 2 - once complete, every item (and the Admin Override
  // control itself) locks; nothing further may change it.
  const locked = check.completion.isGo;

  const assignmentFor = (role: PollBoxRole) => personnelState.assignments.find((a: any) => a.role === role) ?? null;
  const itemFor = (key: string) => check.items.find((i) => i.key === key)!;

  const targeted = mission.launchPeriodEntries?.find((e: any) => e.isTargeted);
  const now = Date.now();
  const within24h = targeted
    ? (() => {
        const open = new Date(targeted.windowOpen).getTime();
        const close = new Date(targeted.windowClose).getTime();
        return (open <= now + 24 * 3600 * 1000 && open >= now) || (open <= now && close >= now);
      })()
    : false;

  function boxProps(role: PollBoxRole) {
    const assignment = assignmentFor(role);
    const isOwn = !readOnly && !!user && assignment?.userId === user.id;
    return { assignment, isOwn, canEdit: isOwn && !locked };
  }
  const vse = boxProps("VSE");
  const lwo = boxProps("LWO");
  const rc = boxProps("RC");
  const ld = boxProps("LD");

  const effectiveIsAdmin = !readOnly && isAdmin && !locked;

  function row(key: string, box: { canEdit: boolean }, options: string[], affirmativeValue: string) {
    const item = itemFor(key);
    return (
      <PollItemRow
        key={key}
        label={item.label}
        status={item.status}
        options={options}
        canEdit={box.canEdit}
        isAdmin={effectiveIsAdmin}
        affirmativeValue={affirmativeValue}
        onSet={(status) => setItemMutation.mutate({ key, status })}
        updatedByName={item.updatedByName}
        updatedAt={item.updatedAt}
        useZulu={useZulu}
        readOnly={readOnly}
        large={large}
      />
    );
  }

  // v7.1.3 - Range Ops Display only: per-role grouping removed per direct
  // correction ("doesn't need to be broken up by person; just make all the
  // tiles in a grid together, with a standard size for all tiles"). Every
  // item except the LD's decision sits in one flat, uniformly-sized grid;
  // the LD's Final Launch Status is called out separately at the bottom,
  // since it's the decision the whole check culminates in. The Polls tab
  // (readOnly false) is completely unchanged - still four role boxes.
  const allTileKeys = [
    "VSE_PROPULSION",
    "VSE_AVIONICS",
    "VSE_TELEMETRY",
    "VSE_STAGING",
    "VSE_RECOVERY",
    "VSE_PAD",
    "VSE_LCS",
    "VSE_LOIS",
    "LWO_WEATHER",
    "RC_COMMUNICATIONS",
    "RC_OPS_SUPPORT",
    "RC_AIRSPACE",
    "RC_RANGE_STATUS",
  ];

  return (
    <div className={readOnly ? "space-y-3" : "mx-auto max-w-4xl space-y-4"}>
      <CompletionBanner check={check} useZulu={useZulu} large={large} />

      {readOnly ? (
        // 4x4 grid (16 cells): the 14 non-LD items fill cells 1-14 (rows
        // 1-3 full, row 4 cols 1-2); the LD's Final Launch Status - the
        // decision the whole check culminates in - takes the remaining
        // two cells of row 4 (cols 3-4) as one combined, double-wide tile.
        <div className="grid gap-2" style={{ gridTemplateColumns: "repeat(4, minmax(0, 1fr))" }}>
          <PollItemTile label="LWCC" status={lwcc ? (lwcc.bannerStatus === "VIOLATION" ? "NO_GO" : "GO") : "UNPOLLED"} />
          {allTileKeys.map((key) => (
            <PollItemTile key={key} label={itemFor(key).shortLabel} status={itemFor(key).status} />
          ))}
          <PollItemTile
            label="LD — Final Launch Status"
            status={itemFor("LD_FINAL_LAUNCH_STATUS").status}
            style={{ gridColumn: "span 2" }}
          />
        </div>
      ) : (
        <>
          <RoleBoxShell
            boxLabel={POLL_BOX_LABELS.VSE}
            assignmentName={vse.assignment?.userName ?? "UNASSIGNED"}
            isOwn={vse.isOwn}
            large={large}
            indicator={<OnStationIndicator assignment={vse.assignment} within24h={within24h} />}
          >
            <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-zinc-500">Vehicle Systems</div>
            {["VSE_PROPULSION", "VSE_AVIONICS", "VSE_TELEMETRY", "VSE_STAGING", "VSE_RECOVERY"].map((key) => row(key, vse, STANDARD_OPTIONS, "GO"))}
            <div className="mb-1 mt-3 text-[11px] font-semibold uppercase tracking-wide text-zinc-500">Ground Systems</div>
            {["VSE_PAD", "VSE_LCS", "VSE_LOIS"].map((key) => row(key, vse, STANDARD_OPTIONS, "GO"))}
          </RoleBoxShell>

          <RoleBoxShell
            boxLabel={POLL_BOX_LABELS.LWO}
            assignmentName={lwo.assignment?.userName ?? "UNASSIGNED"}
            isOwn={lwo.isOwn}
            large={large}
            indicator={<OnStationIndicator assignment={lwo.assignment} within24h={within24h} />}
          >
            <LwccReadoutRow lwcc={lwcc} large={large} />
            {row("LWO_WEATHER", lwo, WEATHER_OPTIONS, "CLEAR")}
          </RoleBoxShell>

          <RoleBoxShell
            boxLabel={POLL_BOX_LABELS.RC}
            assignmentName={rc.assignment?.userName ?? "UNASSIGNED"}
            isOwn={rc.isOwn}
            large={large}
            indicator={<OnStationIndicator assignment={rc.assignment} within24h={within24h} />}
          >
            {row("RC_COMMUNICATIONS", rc, STANDARD_OPTIONS, "GO")}
            {row("RC_OPS_SUPPORT", rc, STANDARD_OPTIONS, "GO")}
            <AirspaceRow
              item={itemFor("RC_AIRSPACE")}
              checklist={check.airspaceChecklist}
              isAdmin={effectiveIsAdmin}
              missionId={missionId}
              onChanged={invalidate}
              readOnly={readOnly}
              large={large}
            />
            {row("RC_RANGE_STATUS", rc, RANGE_STATUS_OPTIONS, "CLEAR_TO_PROCEED")}
          </RoleBoxShell>

          <RoleBoxShell
            boxLabel={POLL_BOX_LABELS.LD}
            assignmentName={ld.assignment?.userName ?? "UNASSIGNED"}
            isOwn={ld.isOwn}
            large={large}
            indicator={<OnStationIndicator assignment={ld.assignment} within24h={within24h} />}
          >
            {row("LD_FINAL_LAUNCH_STATUS", ld, FINAL_STATUS_OPTIONS, "GO_FOR_LAUNCH")}
            <LaunchCountTimeBlock missionId={missionId} check={check} canEdit={ld.canEdit} isAdmin={effectiveIsAdmin} useZulu={useZulu} onChanged={invalidate} />
          </RoleBoxShell>
        </>
      )}

      {showHistory && <PollHistoryPanel history={history} useZulu={useZulu} />}
    </div>
  );
}
