import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  addProgrammedHold,
  armTerminalCount,
  callHold,
  confirmCofrGate,
  fetchCoas,
  fetchCountdownState,
  fetchDocuments,
  fetchLaunchStatusCheck,
  fetchLwccState,
  fetchMilestoneTemplateOptions,
  fetchMissionComms,
  generateMilestoneSequence,
  markLiftoff,
  recycleCountdown,
  releaseHold,
  removeHold,
  resetMilestoneSequence,
  reviseLot,
  revokeTerminalCountArm,
  setHoldAutoProceed,
  submitLot,
  updateMilestone,
  uploadDocument,
  waivePemsgHold,
  xmitCcsToVfs,
} from "../api/resources";
import { useAuth } from "../context/AuthContext";
import { usePreferences } from "../context/PreferencesContext";
import { tickTMinusSeconds } from "../utils/countdownMath";
import { formatTimestamp } from "../utils/time";
import { DocumentLink } from "./DocumentLink";
import { CompletionBanner } from "./LaunchStatusCheck";
import { COMR_DOCUMENT_CATEGORY, LOT_CERTIFICATION_TEXTS } from "../types";
import type { Mission, MissionHold } from "../types";

export function secondsToHms(totalSeconds: number): string {
  const s = Math.max(0, Math.round(totalSeconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
}

function hmsToSeconds(hms: string): number {
  const [h, m, s] = hms.split(":").map((v) => Number(v) || 0);
  return h * 3600 + m * 60 + s;
}

function isSameUtcDateClient(a: Date, b: Date): boolean {
  return a.getUTCFullYear() === b.getUTCFullYear() && a.getUTCMonth() === b.getUTCMonth() && a.getUTCDate() === b.getUTCDate();
}

export default function CountdownTab({ mission, onRequestScrub }: { mission: Mission; onRequestScrub: () => void }) {
  const { isLaunchDirector, isAdmin } = useAuth();
  const [now, setNow] = useState(new Date());
  const [fetchedAt, setFetchedAt] = useState(new Date());

  // v4.1 Item 1 - hold triggering (and Item 2's Auto-Proceed release) is
  // decided entirely server-side by the always-running hold scheduler
  // (server/src/services/holdScheduler.ts), not by this component. This
  // query just displays that state; MissionDetail's websocket subscription
  // invalidates it the instant the scheduler broadcasts a change, so the
  // freeze/banner appears live regardless of whether this tab was ever
  // navigated away from.
  const { data: state } = useQuery({
    queryKey: ["countdown", mission.id],
    queryFn: () => fetchCountdownState(mission.id),
    refetchInterval: 8000,
  });

  useEffect(() => {
    if (state) setFetchedAt(new Date());
  }, [state]);

  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  const tMinus = tickTMinusSeconds(state, fetchedAt, now);

  if (!state) return <div className="p-6 text-slate-400">Loading countdown state...</div>;

  const targeted = mission.launchPeriodEntries.find((e) => e.isTargeted);

  return (
    <div className="space-y-6">
      {!state.lot ? (
        <LotSubmissionForm mission={mission} targeted={targeted} disabled={mission.status !== "TARGETED"} />
      ) : (
        <>
          {state.activeHold?.status === "ACTIVE" && state.activeHold.isCofrComplianceHold && (
            <CofrComplianceGateAlert mission={mission} hold={state.activeHold} />
          )}
          <HoldManagement mission={mission} state={state} isLaunchDirector={isLaunchDirector} tMinus={tMinus} onRequestScrub={onRequestScrub} />
        </>
      )}

      <MilestoneSequence mission={mission} />
      <VehicleLcpCrossReference mission={mission} isLaunchDirector={isLaunchDirector || isAdmin} />
    </div>
  );
}

// v5.0 Section 7 - full LOT Submission rebuild, governed by the reference
// MOP (IRM2-MOP-001A Section 5). Only launch date/time is load-bearing from
// the old form; the five free-text constraint boxes are gone, replaced by
// a mandatory CoMR selection, eight verbatim certification statements
// (checkbox 8 has real functional teeth - see the CoFR compliance gate
// banner in HoldManagement below), and a typed e-signature of record.
function LotSubmissionForm({ mission, targeted, disabled }: { mission: Mission; targeted: any; disabled: boolean }) {
  const qc = useQueryClient();
  const [lot, setLot] = useState("");
  const [comrDocumentId, setComrDocumentId] = useState("");
  const [certs, setCerts] = useState<boolean[]>(Array(8).fill(false));
  const [signatureName, setSignatureName] = useState("");
  const [signatureRole, setSignatureRole] = useState("");

  const { data: comrDocs } = useQuery({
    queryKey: ["documents", "comr"],
    queryFn: () => fetchDocuments({ category: COMR_DOCUMENT_CATEGORY }),
  });
  const { data: coas } = useQuery({ queryKey: ["coas", mission.siteId], queryFn: () => fetchCoas(mission.siteId) });
  const activeCoa = coas?.find((c) => c.status === "ACTIVE");

  const comrLibraryEmpty = comrDocs != null && comrDocs.length === 0;
  const allCertsAffirmed = certs.every(Boolean);
  const canSubmit = !disabled && !!lot && !!comrDocumentId && allCertsAffirmed && !!signatureName.trim() && !!signatureRole.trim() && !comrLibraryEmpty;

  const mutation = useMutation({
    mutationFn: () =>
      submitLot(mission.id, {
        lot: new Date(lot).toISOString(),
        comrDocumentId,
        certifications: certs,
        signatureName: signatureName.trim(),
        signatureRole: signatureRole.trim(),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["countdown", mission.id] });
      qc.invalidateQueries({ queryKey: ["mission", mission.id] });
    },
  });

  return (
    <section className="card p-5">
      <div className="mb-1 text-xs font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400">Targeted Lift-Off Time (LOT) Submission</div>
      <p className="mb-3 text-xs text-slate-500 dark:text-slate-400">
        Due no later than L-3 days. Must fall within the confirmed launch window
        {targeted ? ` (${new Date(targeted.windowOpen).toISOString()} – ${new Date(targeted.windowClose).toISOString()})` : ""}
        {activeCoa ? ` and the site's active COA Daily Operational Window (${activeCoa.dailyWindowOpen}Z–${activeCoa.dailyWindowClose}Z)` : ""}.
      </p>

      {comrLibraryEmpty && (
        <div className="mb-3 rounded-md border border-aat-nogo/50 bg-aat-nogo/10 p-3 text-xs text-aat-nogo">
          No Certification of Mission Readiness (CoMR) document exists in the Documentation Library. Upload and tag one with the "Certification of
          Mission Readiness (CoMR)" category before a LOT can be submitted.{" "}
          <Link to="/documents" className="font-semibold underline">
            Go to Documentation Library
          </Link>
        </div>
      )}

      <div className="space-y-3">
        <input type="datetime-local" value={lot} onChange={(e) => setLot(e.target.value)} className="input" />

        <div>
          <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-slate-400">
            Certification of Mission Readiness (CoMR)
          </label>
          <select value={comrDocumentId} onChange={(e) => setComrDocumentId(e.target.value)} disabled={comrLibraryEmpty} className="input disabled:opacity-40">
            <option value="">Select the governing CoMR document...</option>
            {comrDocs?.map((d) => (
              <option key={d.id} value={d.id}>
                {d.title}
              </option>
            ))}
          </select>
        </div>

        <div className="space-y-2 rounded-md border border-slate-200 p-3 dark:border-slate-800">
          <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Certification (all eight required)</div>
          {LOT_CERTIFICATION_TEXTS.map((text, i) => (
            <label key={i} className="flex items-start gap-2 text-xs">
              <input
                type="checkbox"
                className="mt-0.5 shrink-0"
                checked={certs[i]}
                onChange={(e) => setCerts(certs.map((c, idx) => (idx === i ? e.target.checked : c)))}
              />
              <span>{text}</span>
            </label>
          ))}
        </div>

        <div className="grid grid-cols-2 gap-2">
          <input placeholder="Typed full legal name" value={signatureName} onChange={(e) => setSignatureName(e.target.value)} className="input" />
          <input placeholder="Role" value={signatureRole} onChange={(e) => setSignatureRole(e.target.value)} className="input" />
        </div>
        <p className="text-[11px] text-slate-400">
          Digitally signed by the name and role entered above, timestamped at submission, as the e-signature of record.
        </p>
      </div>
      <button onClick={() => mutation.mutate()} disabled={!canSubmit || mutation.isPending} className="btn-primary mt-3 disabled:opacity-50">
        Submit LOT
      </button>
      {mutation.isError && <p className="mt-2 text-xs text-aat-nogo">{(mutation.error as any)?.response?.data?.error ?? "Submission failed"}</p>}
    </section>
  );
}

// v5.0 Section 7.4 - mandatory, non-dismissible-without-action alert shown
// whenever the mission's CoFR compliance gate has raised its system-
// triggered hold. There are only two ways out: confirm a CoFR document is
// now on file (which the backend independently verifies before releasing
// the hold), or Postpone Indefinitely from the Lifecycle tab - the button
// here is a plain instruction, not a duplicate action, so there is exactly
// one place Postpone Indefinitely can be executed from.
function CofrComplianceGateAlert({ mission, hold }: { mission: Mission; hold: MissionHold }) {
  const qc = useQueryClient();
  const mutation = useMutation({
    mutationFn: () => confirmCofrGate(mission.id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["countdown", mission.id] });
      qc.invalidateQueries({ queryKey: ["mission", mission.id] });
    },
  });

  return (
    <section className="card border-2 border-aat-nogo bg-aat-nogo/10 p-5">
      <div className="mb-1 text-sm font-bold uppercase tracking-wide text-aat-nogo">CoFR Compliance Deadline Lapsed — T-Count Blocked</div>
      <p className="mb-3 text-xs text-slate-700 dark:text-slate-300">
        This mission's LOT Certification checkbox 8 was affirmed on the basis that a Certification of Flight Readiness (CoFR) would be filed no later
        than twenty-four (24) hours prior to LOT. That deadline has now lapsed with no CoFR document on file for the assigned vehicle (
        {mission.vehicle.name}). Per the LOT Certification, further T-Count progression is blocked until the Launch Director either confirms a CoFR
        document now exists, or executes Postpone Indefinitely.
      </p>
      <div className="flex flex-wrap items-center gap-3">
        <button onClick={() => mutation.mutate()} disabled={mutation.isPending} className="btn-primary disabled:opacity-50">
          Confirm CoFR Now On File &amp; Resume Countdown
        </button>
        <span className="text-xs text-slate-500 dark:text-slate-400">
          — or, from the Lifecycle tab, execute <strong>Postpone Indefinitely</strong>.
        </span>
      </div>
      {mutation.isError && (
        <p className="mt-2 text-xs font-semibold text-aat-nogo">{(mutation.error as any)?.response?.data?.error ?? "Could not resolve the gate"}</p>
      )}
    </section>
  );
}

// v9.5 Section 4 - restrained color scheme, fully replacing v9.3 Section
// 3.3.1's broader 4-tier scheme. Color now marks only these buttons in the
// whole console: red = ABORT/RTS only; orange = the three indefinite-hold
// buttons (CALL HOLD, WX HOLD - INDEF, PEMSG HOLD - INDEF); white = ARM
// TERMINAL COUNT, MARK LIFTOFF, XMIT CCS TO VFS. Every other button/field
// group - SEL NEW LOT, REC TO MARK, REVOKE ARM, the ADD PGM HOLD group,
// both DUR-variant groups, and WAIVE (v9.6 Section 2) - is plain gray.
//
// v9.6 Section 3.1.1 - one standard card width, applied everywhere a
// single button lives; `wide` opts a field-group card (programmed hold,
// DUR variants) out of that width so it instead sizes to its own content
// rather than stretching full-row. Cards are laid out by the caller in a
// left-justified flex row with a fixed gap (never CSS Grid stretch, never
// space-between/space-around) so rows of different cell counts end at
// different widths instead of all filling the row.
//
// v9.6 Section 3.3 - the unavailable state no longer replaces the card's
// content with a wall-of-text overlay. The control stays visible (dimmed),
// and overlayText renders as a small secondary caption beneath it - the
// control's own identity stays primary, the reason becomes supporting info.
const ACTION_CARD_WIDTH = "w-full sm:w-56";

function ActionCard({
  border,
  disabled,
  overlayText,
  wide,
  children,
}: {
  border: "white" | "red" | "orange" | "gray";
  disabled: boolean;
  overlayText?: string;
  wide?: boolean;
  children: React.ReactNode;
}) {
  const borderClass = {
    white: "border-white",
    red: "border-aat-nogo",
    orange: "border-aat-caution",
    gray: "border-zinc-700",
  }[border];
  // v9.7 Section 4 - every card reserves the same fixed caption-line space
  // beneath its content, always rendered (never conditionally added), so
  // every button box shares identical height regardless of state: the
  // actual reason when disabled, "AVAIL — NO ERR" when not. v9.7 Section 1 -
  // caption text must always fit one line at this card's width; abbreviate
  // rather than let it wrap.
  return (
    <div
      className={`flex flex-col justify-center gap-1.5 border-2 p-2.5 ${borderClass} ${wide ? "w-full sm:w-auto" : ACTION_CARD_WIDTH} ${
        disabled ? "opacity-60" : ""
      }`}
    >
      {children}
      <div className="truncate whitespace-nowrap text-[9px] font-semibold uppercase leading-tight tracking-wide text-slate-400">
        {disabled && overlayText ? overlayText : "AVAIL — NO ERR"}
      </div>
    </div>
  );
}

// v9.6 Section 3.1 - left-justified flex row, fixed gap, no stretch (the
// grid it replaces stretched every card to its column width and forced
// uniform row height). Section 3.2 - section titles get a thin accent
// underline, brighter tone, and wider letter-spacing so a section boundary
// registers before reading individual buttons.
const actionRowClass = "flex flex-wrap items-start gap-3";
const sectionTitleClass = "mb-2 border-b border-aat-accent/30 pb-1 text-[11px] font-bold uppercase tracking-[0.15em] text-slate-300";

// v9.3 - CCS Hold Management full restructure. Replaces the prior single
// Hold Management box with three sibling-level boxes (Section 3): Box One
// (Test Clock Holds - the hold list + each active hold's own row
// controls), Box Two (Hold Recommendations - LWCC panel stacked above
// PEMSG panel, display only), and Box Three (CCS and Hold Actions - the
// full action console, LD-only, always-visible/grayed-with-overlay
// buttons on a uniform grid, organized into five parts). Every button here
// existed before this directive except Part 2 (Terminal Count Arm), which
// is genuinely new; every other action is relocated, not reimplemented.
function HoldManagement({
  mission,
  state,
  isLaunchDirector,
  tMinus,
  onRequestScrub,
}: {
  mission: Mission;
  state: any;
  isLaunchDirector: boolean;
  tMinus: number | null;
  onRequestScrub: () => void;
}) {
  const { useZulu } = usePreferences();
  const qc = useQueryClient();

  const [showAutoConfirm, setShowAutoConfirm] = useState(false);

  // Part 1 - Time Control Actions.
  const [showRevise, setShowRevise] = useState(false);
  const [showRecycle, setShowRecycle] = useState(false);
  const [reviseForm, setReviseForm] = useState({ lot: "", reason: "" });
  const [recycleForm, setRecycleForm] = useState({ toMark: "00:30:00", reason: "" });

  // Part 3 - Routine Hold Actions (programmed hold entry).
  const [newHold, setNewHold] = useState({ holdMark: "00:30:00", duration: "00:15:00", reason: "" });

  // Parts 3/4/5 share one indefinite-hold confirmation modal: CALL HOLD
  // requires a manually typed reason; WX HOLD - INDEF and PEMSG HOLD -
  // INDEF pre-populate and lock the reason (v9.3 Part 4/5 - "not a
  // lighter-weight variant," the same confirmation gate as CALL HOLD, just
  // with no manual reason entry required).
  const [holdConfirm, setHoldConfirm] = useState<{ label: string; reason: string; editable: boolean; pemsgMessageId?: string } | null>(null);

  // Part 4 - LWCC Rec Hold Actions.
  const [weatherHoldDuration, setWeatherHoldDuration] = useState("00:15:00");
  // Part 5 - PEMSG Rec Hold Actions.
  const [pemsgHoldDuration, setPemsgHoldDuration] = useState("00:15:00");

  // v9.0 Section 5 - REC HOLD/REC TERM escalation data, now also driving
  // Part 5's availability (REC HOLD only - Part 5's scope note: REC TERM is
  // handled by TERM APPR/DENY + ABORT/RTS, never a dedicated button here).
  const { data: commsMessages } = useQuery({
    queryKey: ["mission-comms", mission.id],
    queryFn: () => fetchMissionComms(mission.id),
    refetchInterval: 10_000,
  });
  // v9.6 Section 1.2 [BUG FIX] - "outstanding" now means PENDING or
  // APPROVED, not merely "not yet resolved". The old !resolvedAt check
  // conflated APPROVED with a terminal resolution: the instant the LD sent
  // HOLD APPR, the message stopped being "outstanding" and Part 5's
  // buttons re-greyed before the LD could act on their own approval. Only
  // ACTIONED/DENIED/WAIVED are terminal now.
  const pemsgOutstanding = (m: { actionCode: string; lifecycleState: string | null }) =>
    m.lifecycleState === "PENDING" || m.lifecycleState === "APPROVED";
  const outstandingPemsg = (commsMessages ?? []).filter((m) => (m.actionCode === "REC HOLD" || m.actionCode === "REC TERM") && pemsgOutstanding(m));
  const outstandingPemsgHold = (commsMessages ?? []).filter((m) => m.actionCode === "REC HOLD" && pemsgOutstanding(m));

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["countdown", mission.id] });
    qc.invalidateQueries({ queryKey: ["mission", mission.id] });
  };

  const addHold = useMutation({
    mutationFn: (data: { holdMarkSeconds: number; estimatedDurationSeconds: number; reason: string; pemsgMessageId?: string }) =>
      addProgrammedHold(mission.id, data),
    onSuccess: () => {
      invalidate();
      setNewHold({ holdMark: "00:30:00", duration: "00:15:00", reason: "" });
    },
  });
  const removeHoldMutation = useMutation({ mutationFn: (id: string) => removeHold(mission.id, id), onSuccess: invalidate });
  const releaseHoldMutation = useMutation({ mutationFn: (id: string) => releaseHold(mission.id, id), onSuccess: invalidate });
  const callHoldMutation = useMutation({
    mutationFn: ({ reason, pemsgMessageId }: { reason: string; pemsgMessageId?: string }) => callHold(mission.id, reason, pemsgMessageId),
    onSuccess: () => {
      invalidate();
      setHoldConfirm(null);
    },
  });
  // v9.6 Section 2 - WAIVE is the CCS-local quick equivalent of sending
  // HOLD DENY: marks the originating REC HOLD/REC TERM message WAIVED
  // (logged with the same weight as HOLD DENY, not a silent dismissal),
  // clears the Box Two banner, and re-locks Part 5.
  const waiveMutation = useMutation({
    mutationFn: (messageId: string) => waivePemsgHold(mission.id, messageId),
    onSuccess: invalidate,
  });
  const autoProceedMutation = useMutation({
    mutationFn: ({ holdId, autoProceed }: { holdId: string; autoProceed: boolean }) => setHoldAutoProceed(mission.id, holdId, autoProceed),
    onSuccess: invalidate,
  });
  const reviseMutation = useMutation({
    mutationFn: () => reviseLot(mission.id, new Date(reviseForm.lot).toISOString(), reviseForm.reason),
    onSuccess: () => {
      invalidate();
      setShowRevise(false);
    },
  });
  const recycleMutation = useMutation({
    mutationFn: () => recycleCountdown(mission.id, hmsToSeconds(recycleForm.toMark), recycleForm.reason),
    onSuccess: () => {
      invalidate();
      setShowRecycle(false);
    },
  });
  const liftoffMutation = useMutation({ mutationFn: () => markLiftoff(mission.id), onSuccess: invalidate });
  const armMutation = useMutation({ mutationFn: () => armTerminalCount(mission.id), onSuccess: invalidate });
  const revokeMutation = useMutation({ mutationFn: () => revokeTerminalCountArm(mission.id), onSuccess: invalidate });
  const xmitMutation = useMutation({ mutationFn: () => xmitCcsToVfs(mission.id), onSuccess: invalidate });

  const activeHold: MissionHold | undefined = state.holds.find((h: MissionHold) => h.status === "ACTIVE");

  // v5.3 Item 1 - reads the exact same LWCC evaluation data the LWCC tab's
  // own compliance banner uses (same query key, same server computation);
  // this panel never re-derives violation status itself.
  const { data: lwcc } = useQuery({
    queryKey: ["lwcc", mission.id],
    queryFn: () => fetchLwccState(mission.id),
    refetchInterval: 30_000,
  });
  const [recNow, setRecNow] = useState(new Date());
  useEffect(() => {
    const t = setInterval(() => setRecNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  const violatingRows = lwcc?.violatingRows ?? [];
  // Section 7.4's existing distinction is holdExpiresAt: present only for
  // requirements with a built-in wait period once that hold is active;
  // null for an instantaneous-limit violation with no timer. Used as-is,
  // not re-derived from LWCC_REQUIREMENTS.
  const timedViolations = violatingRows.filter((r) => r.holdExpiresAt);
  const untimedViolations = violatingRows.filter((r) => !r.holdExpiresAt);

  let recommendation: string;
  if (violatingRows.length === 0) {
    recommendation = "NO LWCC VIOLATIONS — NO HOLD RECOMMENDED";
  } else if (untimedViolations.length > 0) {
    recommendation = "LWCC RECOMMENDS A HOLD UNTIL WEATHER VIOLATIONS CLEAR";
  } else {
    const longestRemainingSeconds = Math.max(...timedViolations.map((r) => (new Date(r.holdExpiresAt!).getTime() - recNow.getTime()) / 1000));
    recommendation = `LWCC RECOMMENDS A HOLD OF ${secondsToHms(Math.max(0, longestRemainingSeconds))}`;
  }

  const weatherHoldReason = `Weather — LWCCR ${violatingRows.map((r) => r.no).join(", ")} violated`;
  // v9.6 Section 1.2 - the specific message these Part 5 actions resolve;
  // its id is threaded through to the hold-creation calls so the backend
  // marks the correct originating message ACTIONED (not a mass-resolve of
  // every outstanding REC HOLD).
  const targetPemsgHold = outstandingPemsgHold[0];
  const pemsgHoldReason = targetPemsgHold
    ? `PEMSG REC HOLD — ${targetPemsgHold.senderRole} — ${targetPemsgHold.detail ?? targetPemsgHold.line}`
    : "";

  // v9.5 Section 5 - LSC State panel data. Same query key the Polls tab and
  // Range Ops Display use (LaunchStatusCheckBoard), so this never computes
  // completion a second, parallel way - per v9.4 Section 1's own
  // instruction, this and the ERROR HOLD gate must never be able to
  // disagree. lscErrorHoldActive reads the ERROR hold's own presence
  // (rather than re-deriving "T-Count passed T-10:00:00 without LSC
  // completion" client-side) for the same reason.
  const { data: lscCheck } = useQuery({
    queryKey: ["launch-status-check", mission.id],
    queryFn: () => fetchLaunchStatusCheck(mission.id),
    refetchInterval: 15_000,
  });
  const lscComplete = !!lscCheck?.completion.isGo;
  const lscErrorHoldActive = state.holds.some((h: MissionHold) => h.status === "ACTIVE" && h.type === "ERROR");

  // --- v9.3 Section 3.3.3 Terminal Count Arm derived state ---
  const armed = !!state.terminalCountArmedAt;
  const xmitted = !!state.terminalCountXmitAt;
  const armWindowOpen = tMinus != null && tMinus <= 600;
  const armDeadlinePassed = tMinus != null && tMinus <= 180;

  let armOverlay: string | undefined;
  if (!state.lot) armOverlay = "N/A — NO LOT ESTABLISHED";
  else if (armed) armOverlay = "N/A — ALREADY ARMED";
  else if (!armWindowOpen) armOverlay = "N/A — OPENS AT T-10:00:00";
  const armDisabled = !!armOverlay;

  const revokeOverlay = !armed ? "N/A — NOT ARMED" : undefined;
  const revokeDisabled = !armed;

  let xmitOverlay: string | undefined;
  if (!armed) xmitOverlay = "N/A — T-COUNT NOT ARMED";
  else if (xmitted) xmitOverlay = "N/A — ALREADY TRANSMITTED";
  const xmitDisabled = !!xmitOverlay;

  // --- Part 1 (Time Control Actions) derived state ---
  let liftoffOverlay: string | undefined;
  if (!state.lot) liftoffOverlay = "N/A — NO LOT ESTABLISHED";
  else if (state.tCountStatus === "COMPLETE") liftoffOverlay = "N/A — LIFTOFF ALREADY MARKED";
  const liftoffDisabled = !!liftoffOverlay;

  const selNewLotOverlay = !state.lot ? "N/A — NO LOT ESTABLISHED" : undefined;
  const selNewLotDisabled = !!selNewLotOverlay;

  const recToMarkOverlay = state.tCountStatus !== "COUNTING" ? "N/A — NO MARK TO RECYCLE" : undefined;
  const recToMarkDisabled = !!recToMarkOverlay;

  const targetedEntry = mission.launchPeriodEntries.find((e) => e.isTargeted);
  // v9.7 Section 1 - abbreviated to fit one line at the card's standard
  // width (was wrapping to three lines and inflating the button's box).
  let abortOverlay: string | undefined;
  if (mission.status !== "TARGETED" || !targetedEntry) abortOverlay = "SCRUB U/A — NO TLO";
  else if (!isSameUtcDateClient(new Date(targetedEntry.date), new Date())) abortOverlay = "SCRUB U/A — NO TLO TDY";
  const abortDisabled = !!abortOverlay;

  // --- Part 3 (Routine Hold Actions) derived state ---
  let routineHoldOverlay: string | undefined;
  if (activeHold) routineHoldOverlay = "N/A — HOLD ALREADY ACTIVE";
  else if (state.tCountStatus !== "COUNTING") routineHoldOverlay = "N/A — T-COUNT NOT ACTIVE";
  const routineHoldDisabled = !!routineHoldOverlay;

  // --- Part 4 (LWCC Rec Hold Actions) derived state ---
  let lwccRecOverlay: string | undefined;
  if (violatingRows.length === 0) lwccRecOverlay = "N/A — NO LWCC REC";
  else if (activeHold) lwccRecOverlay = "N/A — HOLD ALREADY ACTIVE";
  else if (state.tCountStatus !== "COUNTING") lwccRecOverlay = "N/A — T-COUNT NOT ACTIVE";
  const lwccRecDisabled = !!lwccRecOverlay;

  // --- Part 5 (PEMSG Rec Hold Actions) derived state ---
  let pemsgRecOverlay: string | undefined;
  if (outstandingPemsgHold.length === 0) pemsgRecOverlay = "N/A — NO PEMSG REC";
  else if (activeHold) pemsgRecOverlay = "N/A — HOLD ALREADY ACTIVE";
  else if (state.tCountStatus !== "COUNTING") pemsgRecOverlay = "N/A — T-COUNT NOT ACTIVE";
  const pemsgRecDisabled = !!pemsgRecOverlay;

  return (
    <>
      {/* v9.3 Section 3.1 - Box One: Test Clock Holds */}
      <section className="card p-5">
        <div className="mb-3 text-xs font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400">Test Clock Holds</div>

        {activeHold && (
          <div
            className={`mb-3 rounded-md border p-3 ${activeHold.type === "ERROR" ? "border-aat-nogo bg-aat-nogo/10" : "border-aat-caution bg-aat-caution/10"}`}
          >
            <div className="flex items-center justify-between text-sm">
              <div>
                <strong>{activeHold.type === "ERROR" ? "ERROR HOLD" : "ACTIVE HOLD"}</strong> at T-{secondsToHms(activeHold.holdMarkSeconds)}
                {activeHold.type !== "ERROR" ? ` — ${activeHold.type}` : ""}
                {activeHold.reason ? ` — ${activeHold.reason}` : ""}
              </div>
              <div className="flex items-center gap-3">
                {/* v9.4 Section 1.4 - the LSC Verification Error Hold carries
                    neither a Proceed Through Hold button nor an Auto/Manual
                    toggle at all, since neither applies to a hold that is
                    genuinely unreleasable by any manual action - displaying
                    either would be misleading. It clears only via its own
                    condition-based auto-release (recapped in the LSC State
                    panel, Box Two, below). */}
                {activeHold.type === "ERROR" ? (
                  <span className="text-xs font-semibold uppercase text-aat-nogo">Clears automatically upon LSC completion — not manually releasable</span>
                ) : (
                  <>
                    {isLaunchDirector && activeHold.type === "PROGRAMMED" && (
                      <label className="flex items-center gap-1.5 text-xs">
                        <span className={activeHold.autoProceed ? "text-slate-500" : "font-semibold"}>Manual-Proceed</span>
                        <button
                          type="button"
                          role="switch"
                          aria-checked={activeHold.autoProceed}
                          onClick={() => {
                            if (activeHold.autoProceed) {
                              // Auto -> Manual: immediate, no confirmation.
                              autoProceedMutation.mutate({ holdId: activeHold.id, autoProceed: false });
                            } else {
                              // Manual -> Auto: lightweight single confirmation.
                              setShowAutoConfirm(true);
                            }
                          }}
                          className={`relative h-4 w-8 shrink-0 rounded-full transition-colors ${activeHold.autoProceed ? "bg-aat-accent" : "bg-slate-600"}`}
                        >
                          <span
                            className={`absolute left-0.5 top-0.5 h-3 w-3 rounded-full bg-white transition-transform ${activeHold.autoProceed ? "translate-x-4" : "translate-x-0"}`}
                          />
                        </button>
                        <span className={activeHold.autoProceed ? "font-semibold text-aat-accent" : "text-slate-500"}>Auto-Proceed</span>
                      </label>
                    )}
                    {isLaunchDirector && !activeHold.isCofrComplianceHold && (
                      <div className="flex flex-col items-end gap-1">
                        <button
                          onClick={() => releaseHoldMutation.mutate(activeHold.id)}
                          disabled={activeHold.isTerminalCountAutoHold && !armed}
                          className="btn-primary text-xs disabled:opacity-50"
                        >
                          Proceed Through Hold
                        </button>
                        {/* v9.3 Section 3.3.3 - the Terminal Count Not
                            Authorized auto-hold cannot be released via this
                            control alone; ARM TERMINAL COUNT (Terminal
                            Count Arm, Box Three) must be actuated first.
                            Shown grayed with the reason rather than
                            removed, per the governing principle. */}
                        {activeHold.isTerminalCountAutoHold && !armed && (
                          <span className="text-[10px] font-semibold uppercase text-aat-nogo">Requires Arm Terminal Count</span>
                        )}
                      </div>
                    )}
                    {activeHold.isCofrComplianceHold && (
                      <span className="text-xs font-semibold text-aat-nogo">See CoFR Compliance alert above</span>
                    )}
                  </>
                )}
              </div>
            </div>
            {activeHold.actualStartedAt && (
              <ElapsedIndicator startedAt={activeHold.actualStartedAt} estimatedSeconds={activeHold.estimatedDurationSeconds ?? undefined} />
            )}
          </div>
        )}

        {showAutoConfirm && activeHold && (
          <div className="fixed inset-0 z-[2000] flex items-center justify-center bg-black/40 p-4">
            <div className="w-full max-w-sm rounded-xl border border-zinc-800 bg-black p-6">
              <h2 className="mb-2 text-base font-bold">Switch to Auto-Proceed?</h2>
              <p className="mb-4 text-sm text-slate-300">
                The system will automatically release this hold and resume the Test Clock the instant the estimated duration elapses, with
                no further confirmation.
              </p>
              <div className="flex justify-end gap-2">
                <button onClick={() => setShowAutoConfirm(false)} className="btn-secondary">
                  Cancel
                </button>
                <button
                  onClick={() => {
                    autoProceedMutation.mutate({ holdId: activeHold.id, autoProceed: true });
                    setShowAutoConfirm(false);
                  }}
                  className="btn-primary"
                >
                  Confirm Auto-Proceed
                </button>
              </div>
            </div>
          </div>
        )}

        <div className="space-y-1">
          {state.holds
            .filter((h: MissionHold) => h.status !== "ACTIVE")
            .map((h: MissionHold) => (
              <div key={h.id} className="flex items-center justify-between rounded-md border border-slate-200 px-3 py-1.5 text-xs dark:border-slate-800">
                <span>
                  T-{secondsToHms(h.holdMarkSeconds)} · {h.type} · {h.status}
                  {h.estimatedDurationSeconds ? ` · est. ${secondsToHms(h.estimatedDurationSeconds)}` : ""}
                  {h.actualDurationSeconds != null ? ` · actual ${secondsToHms(h.actualDurationSeconds)}` : ""}
                  {h.reason ? ` — ${h.reason}` : ""}
                </span>
                {isLaunchDirector && h.status === "SCHEDULED" && (
                  <button onClick={() => removeHoldMutation.mutate(h.id)} className="text-aat-nogo hover:underline">
                    Remove
                  </button>
                )}
              </div>
            ))}
          {state.holds.length === 0 && <div className="text-xs text-slate-400">No holds programmed.</div>}
        </div>
      </section>

      {/* v9.3 Section 3.2 - Box Two: Hold Recommendations and LSC State
          (renamed per v9.5 Section 5.1). Display only, no action buttons -
          every action has its own home in Box Three's LWCC/PEMSG Rec Hold
          Actions groups. Three stacked panels, top to bottom: LWCC
          Recommendation Panel, PEMSG panel (both unchanged), and the LSC
          State panel (v9.5 Section 5.3, new) - this fully supersedes v9.4
          Section 2's separate top-of-cluster LWCC Compliance Status
          banner, which is not built at all. */}
      <section className="card p-5">
        <div className="mb-3 text-xs font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400">Hold Recommendations and LSC State</div>

        <div className="mb-4">
          <div className="mb-2 flex items-center justify-between">
            <div className="text-xs font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400">LWCC Recommendation</div>
            <span className={`text-xs font-bold uppercase ${violatingRows.length > 0 ? "text-aat-nogo" : "text-aat-go"}`}>
              {violatingRows.length > 0 ? "VIOLATION" : "NO VIOLATION"}
            </span>
          </div>

          {violatingRows.length > 0 && (
            <ul className="mb-3 space-y-1">
              {violatingRows.map((r) => (
                <li key={r.no} className="font-mono text-xs text-slate-600 dark:text-slate-300">
                  — LWCCR {r.no} ({r.description})
                  {r.holdExpiresAt ? ` — HOLD ACTIVE, expires ${formatTimestamp(r.holdExpiresAt, useZulu)}` : ""}
                </li>
              ))}
            </ul>
          )}

          <div className="border border-aat-caution bg-aat-caution/10 px-3 py-2 text-xs font-bold uppercase tracking-wide text-aat-caution">
            {recommendation}
          </div>
        </div>

        <div className="border-t border-slate-200 pt-4 dark:border-slate-800">
          <div className="mb-2 flex items-center justify-between">
            <div className="text-xs font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400">PEMSG HOLD/TERM RECOMMENDATIONS</div>
            <span className={`text-xs font-bold uppercase ${outstandingPemsg.length > 0 ? "text-aat-nogo" : "text-aat-go"}`}>
              {outstandingPemsg.length > 0 ? `${outstandingPemsg.length} OUTSTANDING` : "CLEAR"}
            </span>
          </div>

          {outstandingPemsg.length > 0 ? (
            <ul className="space-y-1.5">
              {outstandingPemsg.map((m) => (
                <li
                  key={m.id}
                  className="flex items-center justify-between gap-2 border border-aat-caution bg-aat-caution/10 px-3 py-2 font-mono text-xs text-slate-700 dark:text-slate-200"
                >
                  <span>PEMSG {m.line}</span>
                  {/* v9.6 Section 1.2 - banner must indicate which of
                      PENDING/APPROVED the message is currently in; it no
                      longer clears at APPROVED, only at ACTIONED/DENIED/WAIVED. */}
                  <span
                    className={`shrink-0 text-[10px] font-bold uppercase tracking-wide ${
                      m.lifecycleState === "APPROVED" ? "text-aat-go" : "text-aat-caution"
                    }`}
                  >
                    {m.lifecycleState}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <div className="border border-aat-caution bg-aat-caution/10 px-3 py-2 text-xs font-bold uppercase tracking-wide text-aat-caution">
              NO PEMSG HOLD/TERM RECOMMENDATIONS OUTSTANDING
            </div>
          )}
        </div>

        {/* v9.5 Section 5.3 - LSC State panel: four states, all driven by
            data already computed elsewhere (lscCheck.completion from the
            same endpoint the Polls tab/Range Ops Display read, and the
            ERROR hold's own presence in state.holds) - never a second,
            parallel check that could disagree with the actual gate. */}
        <div className="mt-4 border-t border-slate-200 pt-4 dark:border-slate-800">
          <div className="mb-2 text-xs font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400">LSC State</div>
          {!lscCheck ? (
            <div className="text-xs text-slate-400">Loading LSC state...</div>
          ) : lscComplete ? (
            <CompletionBanner check={lscCheck} useZulu={useZulu} />
          ) : lscErrorHoldActive ? (
            <div className="border-2 border-aat-nogo bg-aat-nogo/10 px-3 py-2 text-center text-xs font-bold uppercase tracking-wide text-aat-nogo">
              LSC NOT VERIFIED BY T-10:00:00 — AWAITING LSC COMPLETION
            </div>
          ) : tMinus != null && tMinus <= 900 ? (
            <div className="border-2 border-aat-caution bg-aat-caution/10 px-3 py-2 text-center text-xs font-bold uppercase tracking-wide text-aat-caution">
              LSC NOT PERFORMED
            </div>
          ) : (
            <div className="border-2 border-zinc-700 bg-zinc-900/40 px-3 py-2 text-center text-xs font-bold uppercase tracking-wide text-zinc-400">
              LSC NOT PERFORMED
            </div>
          )}
        </div>
      </section>

      {/* v9.3 Section 3.3 - Box Three: CCS and Hold Actions (LD-only, as
          the prior Time Control Actions box already was). */}
      {isLaunchDirector && (
        <section className="card p-5">
          <div className="mb-3 text-xs font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400">CCS and Hold Actions</div>

          <div className="mb-4 space-y-2">
            <div className="border border-slate-600 bg-slate-900/60 px-3 py-2 font-mono text-[11px] uppercase tracking-wide text-slate-300">
              T-CNT: {state.tCountStatus} | LWCC REC: {violatingRows.length > 0 ? "ACTIVE" : "NONE"} | PEMSG REC:{" "}
              {outstandingPemsg.length > 0 ? "ACTIVE" : "NONE"}
            </div>
            {/* v9.3 Section 3.3.3 - required banner, positioned in the
                status-line area (not buried only as a normal Box One list
                entry), matching the LWCC/PEMSG banners' visual severity. */}
            {activeHold?.isTerminalCountAutoHold && (
              <div className="border-2 border-aat-nogo bg-aat-nogo/10 px-3 py-2 text-center text-xs font-bold uppercase tracking-wide text-aat-nogo">
                TERMINAL COUNT NOT AUTHORIZED — HOLD FORCED AT T-{secondsToHms(activeHold.holdMarkSeconds)}
              </div>
            )}
          </div>

          {/* Time Control Actions (v9.5 Section 1 - no "Part N" numbering) */}
          <div className="mb-8">
            <div className={sectionTitleClass}>Time Control Actions</div>
            <div className={actionRowClass}>
              <ActionCard border="white" disabled={liftoffDisabled} overlayText={liftoffOverlay}>
                <button
                  onClick={() => {
                    if (window.confirm("Establish the actual launch time now? This marks liftoff and cannot be undone from this action.")) {
                      liftoffMutation.mutate();
                    }
                  }}
                  disabled={liftoffDisabled}
                  className="btn-primary w-full text-xs disabled:opacity-50"
                >
                  Mark Liftoff
                </button>
              </ActionCard>
              {/* v9.5 Section 4 - SEL NEW LOT is now plain gray (was orange). */}
              <ActionCard border="gray" disabled={selNewLotDisabled} overlayText={selNewLotOverlay}>
                <button onClick={() => setShowRevise(true)} disabled={selNewLotDisabled} className="btn-secondary w-full text-xs disabled:opacity-50">
                  Sel New LOT
                </button>
              </ActionCard>
              <ActionCard border="gray" disabled={recToMarkDisabled} overlayText={recToMarkOverlay}>
                <button onClick={() => setShowRecycle(true)} disabled={recToMarkDisabled} className="btn-secondary w-full text-xs disabled:opacity-50">
                  Rec to Mark
                </button>
              </ActionCard>
              <ActionCard border="red" disabled={abortDisabled} overlayText={abortOverlay}>
                <button onClick={onRequestScrub} disabled={abortDisabled} className="btn-danger w-full text-xs disabled:opacity-50">
                  Abort/RTS
                </button>
              </ActionCard>
            </div>
          </div>

          {/* Terminal Count Arm (v9.3 Section 3.3.3, new logic; v9.5 Section 1 - no "Part N" numbering) */}
          <div className="mb-8">
            <div className={sectionTitleClass}>Terminal Count Arm</div>
            <div className={actionRowClass}>
              <ActionCard border="white" disabled={armDisabled} overlayText={armOverlay}>
                <button onClick={() => armMutation.mutate()} disabled={armDisabled} className="btn-primary w-full text-xs disabled:opacity-50">
                  Arm Terminal Count
                </button>
                {!armed && armWindowOpen && !armDeadlinePassed && tMinus != null && (
                  <div className="font-mono text-[10px] text-aat-caution">AUTHORIZE BY: {secondsToHms(tMinus - 180)} REMAINING</div>
                )}
              </ActionCard>
              {/* v9.5 Section 4 - REVOKE ARM is now plain gray (was red). */}
              <ActionCard border="gray" disabled={revokeDisabled} overlayText={revokeOverlay}>
                <button onClick={() => revokeMutation.mutate()} disabled={revokeDisabled} className="btn-secondary w-full text-xs disabled:opacity-50">
                  Revoke Arm
                </button>
              </ActionCard>
              <ActionCard border="white" disabled={xmitDisabled} overlayText={xmitOverlay}>
                <button onClick={() => xmitMutation.mutate()} disabled={xmitDisabled} className="btn-primary w-full text-xs disabled:opacity-50">
                  Xmit CCS to VFS
                </button>
              </ActionCard>
            </div>
            {(armMutation.isError || revokeMutation.isError || xmitMutation.isError) && (
              <p className="mt-2 text-xs text-aat-nogo">
                {((armMutation.error ?? revokeMutation.error ?? xmitMutation.error) as any)?.response?.data?.error ?? "Action failed"}
              </p>
            )}
          </div>

          {/* Routine Hold Actions (v9.5 Section 2 - CALL HOLD alone as its
              own row; T-mark/Duration/Reason/ADD PGM HOLD in one single
              bordered group, one overlay, arranged horizontally - matching
              the pattern the LWCC/PEMSG Rec Hold Actions groups already
              use, rather than a separate card per field/button. v9.7
              Section 3 - the field group now sits to the right of CALL
              HOLD on the same row, same side-by-side pattern as the
              LWCC/PEMSG indefinite+duration pairs below, rather than on
              its own row beneath.) */}
          <div className="mb-8">
            <div className={sectionTitleClass}>Routine Hold Actions</div>
            <div className={actionRowClass}>
              {/* v9.5 Section 4 - CALL HOLD is one of the three indefinite
                  hold buttons: orange (was red). v9.6 Section 3.1.1 - single
                  standard-width button, left-aligned, own row, remainder
                  empty (ActionCard's default width, not `wide`). */}
              <ActionCard border="orange" disabled={routineHoldDisabled} overlayText={routineHoldOverlay}>
                <button
                  onClick={() => setHoldConfirm({ label: "Call Hold", reason: "", editable: true })}
                  disabled={routineHoldDisabled}
                  className="btn-secondary w-full text-xs disabled:opacity-50"
                >
                  Call Hold
                </button>
              </ActionCard>
              {/* v9.6 Section 3.1.1 - field group sized to the sum of its
                  parts (content-based widths), not forced full-row. */}
              <ActionCard border="gray" disabled={routineHoldDisabled} overlayText={routineHoldOverlay} wide>
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                  <input
                    value={newHold.holdMark}
                    onChange={(e) => setNewHold({ ...newHold, holdMark: e.target.value })}
                    placeholder="T-mark HH:MM:SS"
                    className="input w-32 text-xs"
                    disabled={routineHoldDisabled}
                  />
                  <input
                    value={newHold.duration}
                    onChange={(e) => setNewHold({ ...newHold, duration: e.target.value })}
                    placeholder="Duration HH:MM:SS"
                    className="input w-32 text-xs"
                    disabled={routineHoldDisabled}
                  />
                  <input
                    value={newHold.reason}
                    onChange={(e) => setNewHold({ ...newHold, reason: e.target.value })}
                    placeholder="Reason (optional)"
                    className="input w-40 text-xs"
                    disabled={routineHoldDisabled}
                  />
                  <button
                    onClick={() =>
                      addHold.mutate({
                        holdMarkSeconds: hmsToSeconds(newHold.holdMark),
                        estimatedDurationSeconds: hmsToSeconds(newHold.duration),
                        reason: newHold.reason,
                      })
                    }
                    disabled={routineHoldDisabled}
                    className="btn-secondary shrink-0 text-xs disabled:opacity-50"
                  >
                    Add Pgm Hold
                  </button>
                </div>
              </ActionCard>
            </div>
          </div>

          {/* LWCC Rec Hold Actions (v9.5 Section 1 - no "Part N" numbering;
              Section 3 - DUR variant's field+button now horizontal, same
              height/width as the INDEF card beside it; Section 4 - INDEF is
              orange, DUR group is gray) */}
          <div className="mb-8">
            <div className={sectionTitleClass}>LWCC Rec Hold Actions</div>
            <div className={actionRowClass}>
              <ActionCard border="orange" disabled={lwccRecDisabled} overlayText={lwccRecOverlay}>
                <button
                  onClick={() => setHoldConfirm({ label: "Weather Hold (Indefinite)", reason: weatherHoldReason, editable: false })}
                  disabled={lwccRecDisabled}
                  className="btn-secondary w-full text-xs disabled:opacity-50"
                >
                  Wx Hold — Indef
                </button>
              </ActionCard>
              <ActionCard border="gray" disabled={lwccRecDisabled} overlayText={lwccRecOverlay} wide>
                <div className="flex items-center gap-2">
                  <input
                    value={weatherHoldDuration}
                    onChange={(e) => setWeatherHoldDuration(e.target.value)}
                    placeholder="Duration HH:MM:SS"
                    className="input w-32 text-xs"
                    disabled={lwccRecDisabled}
                  />
                  <button
                    onClick={() =>
                      addHold.mutate({
                        // Auto-set to the current countdown position minus a
                        // small safety margin: POST /countdown/holds rejects
                        // a mark that is already >= the server's freshly-
                        // computed T-minus at request time, which a mark
                        // read at the exact instant of the click would trip
                        // the moment network/processing latency passes.
                        holdMarkSeconds: Math.max(0, Math.round(tMinus ?? state.currentTMinusSeconds ?? 0) - 3),
                        estimatedDurationSeconds: hmsToSeconds(weatherHoldDuration),
                        reason: weatherHoldReason,
                      })
                    }
                    disabled={lwccRecDisabled}
                    className="btn-secondary shrink-0 text-xs disabled:opacity-50"
                  >
                    Wx Hold — Dur
                  </button>
                </div>
              </ActionCard>
            </div>
          </div>

          {/* PEMSG Rec Hold Actions (v9.5 Section 1 - no "Part N" numbering;
              Section 3 - DUR variant horizontal; Section 4 - INDEF orange,
              DUR group gray) */}
          <div>
            <div className={sectionTitleClass}>PEMSG Rec Hold Actions</div>
            <div className={actionRowClass}>
              <ActionCard border="orange" disabled={pemsgRecDisabled} overlayText={pemsgRecOverlay}>
                <button
                  onClick={() =>
                    setHoldConfirm({
                      label: "PEMSG Hold (Indefinite)",
                      reason: pemsgHoldReason,
                      editable: false,
                      pemsgMessageId: targetPemsgHold?.id,
                    })
                  }
                  disabled={pemsgRecDisabled}
                  className="btn-secondary w-full text-xs disabled:opacity-50"
                >
                  PEMSG Hold — Indef
                </button>
              </ActionCard>
              <ActionCard border="gray" disabled={pemsgRecDisabled} overlayText={pemsgRecOverlay} wide>
                <div className="flex items-center gap-2">
                  <input
                    value={pemsgHoldDuration}
                    onChange={(e) => setPemsgHoldDuration(e.target.value)}
                    placeholder="Duration HH:MM:SS"
                    className="input w-32 text-xs"
                    disabled={pemsgRecDisabled}
                  />
                  <button
                    onClick={() =>
                      addHold.mutate({
                        holdMarkSeconds: Math.max(0, Math.round(tMinus ?? state.currentTMinusSeconds ?? 0) - 3),
                        estimatedDurationSeconds: hmsToSeconds(pemsgHoldDuration),
                        reason: pemsgHoldReason,
                        pemsgMessageId: targetPemsgHold?.id,
                      })
                    }
                    disabled={pemsgRecDisabled}
                    className="btn-secondary shrink-0 text-xs disabled:opacity-50"
                  >
                    PEMSG Hold — Dur
                  </button>
                </div>
              </ActionCard>
              {/* v9.6 Section 2 - WAIVE: gray border (routine/administrative
                  dismissal, not one of the three indefinite-hold actions),
                  standard single-button width. */}
              <ActionCard border="gray" disabled={pemsgRecDisabled} overlayText={pemsgRecOverlay}>
                <button
                  onClick={() => targetPemsgHold && waiveMutation.mutate(targetPemsgHold.id)}
                  disabled={pemsgRecDisabled}
                  className="btn-secondary w-full text-xs disabled:opacity-50"
                >
                  Waive
                </button>
              </ActionCard>
            </div>
          </div>
        </section>
      )}

      {/* Indefinite-hold confirmation modal, shared by Call Hold, Wx Hold -
          Indef, and PEMSG Hold - Indef (v9.3 Section 3.3 Parts 3/4/5 - each
          retains the same confirmation requirement CALL HOLD already had). */}
      {holdConfirm && (
        <div className="fixed inset-0 z-[2000] flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-md rounded-xl border border-zinc-800 bg-black p-6">
            <h2 className="mb-3 text-lg font-bold">{holdConfirm.label}</h2>
            {holdConfirm.editable ? (
              <textarea
                value={holdConfirm.reason}
                onChange={(e) => setHoldConfirm({ ...holdConfirm, reason: e.target.value })}
                placeholder="Reason (required)"
                className="input"
                rows={3}
              />
            ) : (
              <p className="rounded-md border border-slate-700 bg-slate-900 p-3 text-xs text-slate-300">{holdConfirm.reason}</p>
            )}
            <div className="mt-4 flex justify-end gap-2">
              <button onClick={() => setHoldConfirm(null)} className="btn-secondary">
                Cancel
              </button>
              <button
                onClick={() => callHoldMutation.mutate({ reason: holdConfirm.reason, pemsgMessageId: holdConfirm.pemsgMessageId })}
                disabled={!holdConfirm.reason.trim()}
                className="btn-danger disabled:opacity-50"
              >
                Confirm Hold
              </button>
            </div>
          </div>
        </div>
      )}

      {showRevise && (
        <div className="fixed inset-0 z-[2000] flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-md rounded-xl border border-zinc-800 bg-black p-6">
            <h2 className="mb-3 text-lg font-bold">Select New LOT</h2>
            <input type="datetime-local" value={reviseForm.lot} onChange={(e) => setReviseForm({ ...reviseForm, lot: e.target.value })} className="input mb-2" />
            <textarea value={reviseForm.reason} onChange={(e) => setReviseForm({ ...reviseForm, reason: e.target.value })} placeholder="Reason (required)" className="input" rows={2} />
            <div className="mt-4 flex justify-end gap-2">
              <button onClick={() => setShowRevise(false)} className="btn-secondary">
                Cancel
              </button>
              <button onClick={() => reviseMutation.mutate()} disabled={!reviseForm.lot || !reviseForm.reason.trim()} className="btn-primary disabled:opacity-50">
                Confirm new LOT
              </button>
            </div>
            {reviseMutation.isError && <p className="mt-2 text-xs text-aat-nogo">{(reviseMutation.error as any)?.response?.data?.error}</p>}
          </div>
        </div>
      )}

      {showRecycle && (
        <div className="fixed inset-0 z-[2000] flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-md rounded-xl border border-zinc-800 bg-black p-6">
            <h2 className="mb-3 text-lg font-bold">Recycle to Mark</h2>
            <input value={recycleForm.toMark} onChange={(e) => setRecycleForm({ ...recycleForm, toMark: e.target.value })} placeholder="Target T-mark HH:MM:SS" className="input mb-2" />
            <textarea value={recycleForm.reason} onChange={(e) => setRecycleForm({ ...recycleForm, reason: e.target.value })} placeholder="Reason (required)" className="input" rows={2} />
            <div className="mt-4 flex justify-end gap-2">
              <button onClick={() => setShowRecycle(false)} className="btn-secondary">
                Cancel
              </button>
              <button onClick={() => recycleMutation.mutate()} disabled={!recycleForm.reason.trim()} className="btn-primary disabled:opacity-50">
                Confirm recycle
              </button>
            </div>
            {recycleMutation.isError && <p className="mt-2 text-xs text-aat-nogo">{(recycleMutation.error as any)?.response?.data?.error}</p>}
          </div>
        </div>
      )}
    </>
  );
}

export function ElapsedIndicator({
  startedAt,
  estimatedSeconds,
  large,
  textClassName,
}: {
  startedAt: string;
  estimatedSeconds?: number;
  large?: boolean;
  /** v5.4 Section 2 - Range Ops Display only, overrides the size portion of
   * the default large/normal classes to match that page's LWCC banner body
   * text exactly. Every other caller omits this and keeps large/normal. */
  textClassName?: string;
}) {
  const [now, setNow] = useState(new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);
  const elapsed = (now.getTime() - new Date(startedAt).getTime()) / 1000;
  const elapsedText = secondsToHms(elapsed);
  const durationElapsed = estimatedSeconds != null && elapsed >= estimatedSeconds;
  const sizeClassName = textClassName ?? (large ? "mt-2 text-xl" : "mt-1 text-xs");
  return (
    <div className={`${sizeClassName} ${durationElapsed ? "animate-pulse font-bold text-aat-nogo" : "text-slate-500 dark:text-slate-400"}`}>
      Elapsed: {elapsedText}
      {estimatedSeconds != null ? ` / est. ${secondsToHms(estimatedSeconds)}` : ""}
      {durationElapsed ? " — DURATION ELAPSED, AWAITING RELEASE" : ""}
    </div>
  );
}

function MilestoneSequence({ mission }: { mission: Mission }) {
  const qc = useQueryClient();
  const { isLaunchDirector, isAdmin } = useAuth();
  const [selectedTemplateId, setSelectedTemplateId] = useState<string>("standard");
  const [showResetConfirm, setShowResetConfirm] = useState(false);

  const { data: templateOptions } = useQuery({
    queryKey: ["milestone-templates", mission.id],
    queryFn: () => fetchMilestoneTemplateOptions(mission.id),
  });

  const generateMutation = useMutation({
    mutationFn: () => generateMilestoneSequence(mission.id, selectedTemplateId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["mission", mission.id] });
      qc.invalidateQueries({ queryKey: ["milestone-templates", mission.id] });
    },
  });
  const resetMutation = useMutation({
    mutationFn: () => resetMilestoneSequence(mission.id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["mission", mission.id] });
      qc.invalidateQueries({ queryKey: ["milestone-templates", mission.id] });
      setShowResetConfirm(false);
    },
  });
  const updateMutation = useMutation({
    mutationFn: ({ id, status }: { id: string; status: string }) => updateMilestone(mission.id, id, { status }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["mission", mission.id] }),
  });

  const milestones = mission.milestones ?? [];
  const canResetSequence = isAdmin || isLaunchDirector;

  return (
    <section className="card p-5">
      <div className="mb-3 flex items-center justify-between">
        <div>
          <div className="text-xs font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400">Countdown Milestone Sequence</div>
          {milestones.length > 0 && (
            <div className="mt-1 text-[11px] text-slate-400">
              Applied VLCP Milestone Template: <span className="text-slate-300">{mission.appliedMilestoneTemplateName ?? "Unknown"}</span>
            </div>
          )}
        </div>
        <div className="flex items-center gap-2">
          {isLaunchDirector && milestones.length === 0 && (
            <>
              <select
                value={selectedTemplateId}
                onChange={(e) => setSelectedTemplateId(e.target.value)}
                className="rounded-md border border-slate-300 bg-transparent px-2 py-1 text-xs dark:border-slate-700"
              >
                {templateOptions?.options.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.name} ({o.itemCount})
                  </option>
                ))}
              </select>
              <button onClick={() => generateMutation.mutate()} className="btn-secondary text-xs">
                Generate Countdown Sequence
              </button>
            </>
          )}
          {canResetSequence && milestones.length > 0 && (
            <button onClick={() => setShowResetConfirm(true)} className="rounded-md border border-red-800 px-2 py-1 text-xs font-semibold text-red-400 hover:bg-red-950/40">
              Reset Countdown Sequence
            </button>
          )}
        </div>
      </div>
      {showResetConfirm && (
        <div className="fixed inset-0 z-[2000] flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-md rounded-xl border border-red-900 bg-black p-6">
            <h2 className="mb-2 text-lg font-bold text-red-400">Reset Countdown Sequence</h2>
            <p className="mb-4 text-sm text-slate-300">
              This will remove the currently generated milestone sequence for {mission.designator}
              {mission.appliedMilestoneTemplateName ? ` (applied template: "${mission.appliedMilestoneTemplateName}")` : ""} and any recorded
              verification / checkbox progress against it. This action cannot be undone. A new VLCP Milestone Template can be selected and
              generated afterward.
            </p>
            <div className="flex justify-end gap-2">
              <button onClick={() => setShowResetConfirm(false)} className="btn-secondary">
                Cancel
              </button>
              <button
                onClick={() => resetMutation.mutate()}
                disabled={resetMutation.isPending}
                className="rounded-md bg-red-700 px-3 py-1.5 text-sm font-semibold text-white hover:bg-red-600 disabled:opacity-50"
              >
                Confirm Reset
              </button>
            </div>
          </div>
        </div>
      )}
      {["PRE_OPERATION_SETUP", "COUNTDOWN"].map((phase) => {
        const items = milestones.filter((m) => (m.phase ?? "COUNTDOWN") === phase).sort((a, b) => b.tMinusSeconds - a.tMinusSeconds);
        if (items.length === 0) return null;
        return (
          <div key={phase} className="mb-3">
            <div className="mb-1 text-[11px] font-semibold uppercase text-slate-400">{phase.replace(/_/g, " ")}</div>
            <div className="space-y-1">
              {items.map((m) => (
                <div key={m.id} className="flex items-center justify-between rounded-md border border-slate-200 px-3 py-1.5 text-xs dark:border-slate-800">
                  <div>
                    <span className="font-mono text-slate-500">T-{secondsToHms(m.tMinusSeconds)}</span> <span className="ml-2">{m.label}</span>
                    {m.responsibleStation && <span className="ml-2 text-slate-400">({m.responsibleStation})</span>}
                  </div>
                  <select
                    value={m.status}
                    onChange={(e) => updateMutation.mutate({ id: m.id, status: e.target.value })}
                    className="rounded-md border border-slate-300 bg-transparent px-1.5 py-0.5 text-[11px] dark:border-slate-700"
                  >
                    {["UPCOMING", "IN_PROGRESS", "COMPLETE", "HELD"].map((s) => (
                      <option key={s} value={s}>
                        {s.replace("_", " ")}
                      </option>
                    ))}
                  </select>
                </div>
              ))}
            </div>
          </div>
        );
      })}
      {milestones.length === 0 && <div className="text-xs text-slate-400">No milestone sequence generated for this mission yet.</div>}
    </section>
  );
}

function VehicleLcpCrossReference({ mission, isLaunchDirector }: { mission: Mission; isLaunchDirector: boolean }) {
  const qc = useQueryClient();
  const [file, setFile] = useState<File | null>(null);
  const { data: docs } = useQuery({
    queryKey: ["vehicle-lcp", mission.id, mission.vehicleId],
    queryFn: () => fetchDocuments({ missionId: mission.id, category: "Launch Countdown Procedure" }),
  });

  const uploadMutation = useMutation({
    mutationFn: () => {
      const fd = new FormData();
      fd.append("file", file!);
      fd.append("title", `${mission.vehicle.name} LCP — ${mission.designator}`);
      fd.append("category", "Launch Countdown Procedure");
      fd.append("missionId", mission.id);
      fd.append("vehicleId", mission.vehicleId);
      return uploadDocument(fd);
    },
    onSuccess: () => {
      setFile(null);
      qc.invalidateQueries({ queryKey: ["vehicle-lcp", mission.id, mission.vehicleId] });
    },
  });

  return (
    <section className="card p-5">
      <div className="mb-2 text-xs font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400">
        Vehicle-Specific Launch Countdown Procedure
      </div>
      <div className="space-y-1">
        {docs?.map((d) => (
          <DocumentLink
            key={d.id}
            documentId={d.id}
            version={d.currentVersion}
            className="block rounded-md border border-slate-200 px-2 py-1.5 text-xs hover:bg-slate-50 dark:border-slate-800 dark:hover:bg-slate-800/50"
          >
            {d.title} <span className="text-slate-400">v{d.currentVersion}</span>
          </DocumentLink>
        ))}
        {docs?.length === 0 && <div className="text-xs text-slate-400">No vehicle-specific LCP on file for this mission.</div>}
      </div>
      {isLaunchDirector && (
        <div className="mt-2 flex gap-2">
          <input type="file" onChange={(e) => setFile(e.target.files?.[0] ?? null)} className="flex-1 text-xs" />
          <button onClick={() => file && uploadMutation.mutate()} disabled={!file} className="rounded-md bg-white px-2 py-1 text-xs font-semibold text-black disabled:opacity-50">
            Upload LCP
          </button>
        </div>
      )}
    </section>
  );
}
