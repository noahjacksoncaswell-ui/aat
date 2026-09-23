import React from "react";
import { NavLink, Outlet, useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { usePreferences } from "../context/PreferencesContext";
import ClassificationFooter from "./ClassificationFooter";

const navItems = [
  { to: "/", label: "Dashboard", end: true },
  { to: "/sites", label: "Launch Sites & Weather" },
  { to: "/missions", label: "Mission Schedule" },
  { to: "/vehicles", label: "Vehicles" },
  { to: "/faa", label: "FAA Coordination" },
  { to: "/documents", label: "Documentation Library" },
  // v5.1 Section 2 - available to every role (a display surface, not a
  // control surface), positioned second-to-last, immediately before Admin.
  { to: "/range-ops", label: "Range Ops Display" },
];

export default function Layout() {
  const { user, logout, isAdmin } = useAuth();
  const { useZulu, toggleZulu } = usePreferences();
  const navigate = useNavigate();

  return (
    <div className="flex h-screen w-full flex-col overflow-hidden bg-black text-zinc-100">
      <div className="flex flex-1 overflow-hidden">
        <aside className="flex w-64 shrink-0 flex-col border-r border-zinc-800 bg-aat-navy">
          <div className="flex items-center gap-2 border-b border-zinc-800 px-5 py-5">
            <div className="flex h-9 w-9 items-center justify-center border border-white bg-white font-bold text-black">A</div>
            <div>
              <div className="text-sm font-semibold leading-tight">AAT LOD</div>
              <div className="text-[11px] text-zinc-400">Launch Ops Division</div>
            </div>
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
          <div className="space-y-2 border-t border-zinc-800 px-4 py-4 text-xs">
            <button onClick={toggleZulu} className="w-full border border-zinc-700 px-2 py-1.5 text-left text-[11px] hover:bg-zinc-900">
              {useZulu ? "ZULU (UTC)" : "LOCAL TIME"} — TOGGLE
            </button>
          </div>
          <div className="border-t border-zinc-800 px-4 py-4">
            <div className="text-sm font-medium normal-case">{user?.name}</div>
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
        </aside>
        <main className="flex-1 overflow-y-auto">
          <Outlet />
        </main>
      </div>
      <ClassificationFooter />
    </div>
  );
}
