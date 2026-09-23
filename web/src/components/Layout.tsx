import React, { useEffect, useState } from "react";
import { NavLink, Outlet, useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { usePreferences } from "../context/PreferencesContext";
import ClassificationFooter from "./ClassificationFooter";

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

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

  // v5.3 Item 2 - live UTC/Local clocks above the sitewide toggle.
  const [now, setNow] = useState(new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);
  const utcTime = `${pad(now.getUTCHours())}:${pad(now.getUTCMinutes())}:${pad(now.getUTCSeconds())}`;
  const localTime = `${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;

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
          <div className="space-y-2 border-t border-zinc-800 px-4 py-4 text-xs">
            <div className="grid grid-cols-2 gap-1.5">
              <div className={`border px-1.5 py-1 text-center ${useZulu ? "border-aat-caution" : "border-zinc-700"}`}>
                <div className="text-[9px] uppercase tracking-wide text-zinc-500">UTC</div>
                <div className="font-mono text-xs tabular-nums text-zinc-100">{utcTime}</div>
              </div>
              <div className={`border px-1.5 py-1 text-center ${!useZulu ? "border-aat-caution" : "border-zinc-700"}`}>
                <div className="text-[9px] uppercase tracking-wide text-zinc-500">Local</div>
                <div className="font-mono text-xs tabular-nums text-zinc-100">{localTime}</div>
              </div>
            </div>
            <button onClick={toggleZulu} className="w-full border border-zinc-700 px-2 py-1.5 text-left text-[11px] hover:bg-zinc-900">
              Toggle Sitewide
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
