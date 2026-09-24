import React, { useEffect, useState } from "react";
import { NavLink, Outlet, useNavigate } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "../context/AuthContext";
import { usePreferences } from "../context/PreferencesContext";
import { useLiveClock } from "../hooks/useLiveClock";
import { fetchMyStation, toggleOnStation } from "../api/resources";
import ClassificationFooter from "./ClassificationFooter";

const MISSION_ROLE_LABELS: Record<string, string> = { LD: "LD", RC: "RC", LWO: "LWO", VSE: "VSE", OPS_SUPPORT: "OPS SUPPORT" };

// v7.0 Section 9 - sidebar ON STATION check-in control, 4 states. Polls
// /personnel/my-station (the same near-term-assignment resolution the
// mission-scoped ON STATION table's data ultimately derives from) so this
// reflects real assignment/check-in state, not a local-only toggle.
function StationCheckInButton() {
  const qc = useQueryClient();
  const { user } = useAuth();
  const { data: myStation } = useQuery({ queryKey: ["my-station"], queryFn: fetchMyStation, refetchInterval: 30_000 });
  const [blinkOn, setBlinkOn] = useState(true);

  useEffect(() => {
    if (myStation?.state !== "REPORT_TO_STATION") return;
    const t = setInterval(() => setBlinkOn((b) => !b), 800);
    return () => clearInterval(t);
  }, [myStation?.state]);

  const toggleMutation = useMutation({
    mutationFn: (onStation: boolean) => {
      if (!myStation?.missionId || !myStation?.assignmentId) return Promise.reject(new Error("No qualifying assignment"));
      return toggleOnStation(myStation.missionId, myStation.assignmentId, onStation);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["my-station"] }),
  });

  const baseClasses = "flex flex-1 flex-col items-center justify-center gap-0.5 border px-1.5 text-center leading-tight";

  // State 1 - no qualifying assignment: grayed out, not clickable.
  if (!myStation || myStation.state === "NO_ASSIGNMENT") {
    return (
      <div className={`${baseClasses} cursor-default border-zinc-800 bg-zinc-950 text-[8px] font-semibold uppercase text-zinc-600`}>
        No Assignment W/I 24Hrs
      </div>
    );
  }

  // State 2 - assigned, not yet checked in: blinks gray/yellow, clickable.
  if (myStation.state === "REPORT_TO_STATION") {
    return (
      <button
        onClick={() => toggleMutation.mutate(true)}
        className={`${baseClasses} text-[8px] font-bold uppercase transition-colors ${
          blinkOn ? "border-aat-caution bg-aat-caution text-black" : "border-zinc-700 bg-zinc-900 text-zinc-400"
        }`}
      >
        <span>Report to Station</span>
        <span>{myStation.missionDesignator}</span>
      </button>
    );
  }

  // State 3 - on-station: solid green, double-click reverts to State 2.
  return (
    <button
      onDoubleClick={() => toggleMutation.mutate(false)}
      className={`${baseClasses} border-aat-go bg-aat-go text-black`}
      title="Double-click to check off station"
    >
      <span className="text-[8px] font-bold uppercase">
        {MISSION_ROLE_LABELS[myStation.missionRole ?? ""] ?? myStation.missionRole} — {user?.name}
      </span>
      <span className="text-[9px] font-extrabold uppercase">ON STATION</span>
      <span className="text-[8px] font-bold uppercase">{myStation.missionDesignator}</span>
      <span className="text-[7px] normal-case text-black/70">double-click to check off station</span>
    </button>
  );
}

const navItems = [
  { to: "/", label: "Dashboard", end: true },
  { to: "/sites", label: "Launch Sites" },
  { to: "/missions", label: "Mission Schedule" },
  { to: "/faa", label: "FAA Coordination" },
  { to: "/documents", label: "Documentation Library" },
  { to: "/vehicles", label: "Vehicles" },
  // v6.0 Section 1 - positioned immediately above Range Ops Display.
  { to: "/trajectory-sim", label: "Trajectory Simulations" },
  // v5.1 Section 2 - available to every role (a display surface, not a
  // control surface), positioned second-to-last, immediately before Admin.
  { to: "/range-ops", label: "Range Ops Display" },
  // v7.0 Section 1 - positioned immediately above Admin.
  { to: "/personnel", label: "Personnel & Stations" },
];

export default function Layout() {
  const { user, logout, isAdmin } = useAuth();
  const { useZulu, toggleZulu } = usePreferences();
  const navigate = useNavigate();

  // v5.3 Item 2 - live UTC/Local clocks above the sitewide toggle.
  // Milliseconds are a sidebar-only display option (nowhere else uses them).
  const [showMs, setShowMs] = useState(false);
  const { utcTime, localTime } = useLiveClock({ showMs });

  return (
    <div className="flex h-screen w-full flex-col overflow-hidden bg-black text-zinc-100">
      <div className="flex flex-1 overflow-hidden">
        <aside className="flex w-64 shrink-0 flex-col border-r border-zinc-800 bg-aat-navy">
          {/* v5.2 Section 1 - the logo replaces the former square "A" mark +
              AAT/Launch Ops Division text entirely; it is bounded to this
              row's existing footprint (the surrounding px-5 py-5 padding is
              unchanged) rather than the sidebar being resized to fit it. */}
          <div className="flex items-center border-b border-zinc-800 px-5 py-5">
            <img src="/logo.webp" alt="American Aerospace" className="h-auto w-full" />
          </div>
          <nav className="flex-1 space-y-1 overflow-y-auto px-3 py-4">
            {navItems.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.end}
                className={({ isActive }) =>
                  `block border px-3 py-2.5 text-sm font-medium transition-colors ${
                    isActive ? "border-white bg-white text-black" : "border-transparent text-zinc-300 hover:border-zinc-700 hover:bg-zinc-900"
                  }`
                }
              >
                {item.label}
              </NavLink>
            ))}
            {isAdmin && (
              <NavLink
                to="/admin"
                className={({ isActive }) =>
                  `block border px-3 py-2.5 text-sm font-medium transition-colors ${
                    isActive ? "border-white bg-white text-black" : "border-transparent text-zinc-300 hover:border-zinc-700 hover:bg-zinc-900"
                  }`
                }
              >
                Admin Panel
              </NavLink>
            )}
          </nav>
          {/* Label inline before each time (UTC / LOC) instead of stacked
              above it, so each clock is a single compact row - same time
              font size as before, far less vertical space. Active-mode
              yellow outline (aat-caution) preserved. Boxes are full-width
              (matching Toggle Sitewide below), which gives room for the
              optional milliseconds display - sidebar-only, nowhere else. */}
          <div className="space-y-2 border-t border-zinc-800 px-4 py-3">
            <div className="space-y-1.5">
              <div className={`flex w-full items-baseline justify-center gap-2 border px-2 py-1 ${useZulu ? "border-aat-caution" : "border-zinc-700"}`}>
                <span className="text-[10px] uppercase tracking-wide text-zinc-500">UTC</span>
                <span className="font-mono text-xl tabular-nums text-zinc-100">{utcTime}</span>
              </div>
              <div className={`flex w-full items-baseline justify-center gap-2 border px-2 py-1 ${!useZulu ? "border-aat-caution" : "border-zinc-700"}`}>
                <span className="text-[10px] uppercase tracking-wide text-zinc-500">LOC</span>
                <span className="font-mono text-xl tabular-nums text-zinc-100">{localTime}</span>
              </div>
            </div>
            <label className="flex items-center justify-center gap-1.5 text-[10px] uppercase tracking-wide text-zinc-500">
              <input type="checkbox" checked={showMs} onChange={(e) => setShowMs(e.target.checked)} className="shrink-0" />
              Show Milliseconds
            </label>
            <button onClick={toggleZulu} className="w-full border border-zinc-700 px-2 py-1.5 text-left text-[11px] hover:bg-zinc-900">
              Toggle Sitewide
            </button>
          </div>
          {/* v7.0 Section 9 - the ON STATION check-in control sits to the
              right of the existing name/role/sign-out block, sized to the
              same vertical height (items-stretch) via a shared flex row. */}
          <div className="flex items-stretch gap-2 border-t border-zinc-800 px-4 py-4">
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-medium normal-case">{user?.name}</div>
              <div className="text-[11px] text-zinc-400">{user?.role.replace("_", " ")}</div>
              <button
                onClick={async () => {
                  await logout();
                  navigate("/login");
                }}
                className="mt-2 text-xs font-medium text-aat-accent hover:underline"
              >
                Sign Out
              </button>
            </div>
            <StationCheckInButton />
          </div>
        </aside>
        <main className="flex-1 overflow-y-auto">
          <Outlet />
        </main>
      </div>
      <ClassificationFooter />
    </div>
  );
}
