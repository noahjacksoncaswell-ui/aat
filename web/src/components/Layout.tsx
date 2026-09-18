import React from "react";
import { NavLink, Outlet, useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { usePreferences } from "../context/PreferencesContext";

const navItems = [
  { to: "/", label: "Dashboard", icon: "◧", end: true },
  { to: "/sites", label: "Launch Sites & Weather", icon: "🛰" },
  { to: "/missions", label: "Mission Schedule", icon: "🚀" },
  { to: "/faa", label: "FAA Coordination", icon: "📡" },
  { to: "/documents", label: "Documentation Library", icon: "📄" },
];

export default function Layout() {
  const { user, logout, isAdmin } = useAuth();
  const { darkMode, toggleDarkMode, useZulu, toggleZulu } = usePreferences();
  const navigate = useNavigate();

  return (
    <div className="flex h-screen w-full overflow-hidden bg-slate-100 text-slate-900 dark:bg-slate-950 dark:text-slate-100">
      <aside className="flex w-64 shrink-0 flex-col border-r border-slate-200 bg-white dark:border-slate-800 dark:bg-aat-navy">
        <div className="flex items-center gap-2 border-b border-slate-200 px-5 py-5 dark:border-slate-800">
          <div className="flex h-9 w-9 items-center justify-center rounded-md bg-aat-accent font-bold text-white">A</div>
          <div>
            <div className="text-sm font-semibold leading-tight">AAT LOD</div>
            <div className="text-[11px] uppercase tracking-wide text-slate-500 dark:text-slate-400">Launch Ops Division</div>
          </div>
        </div>
        <nav className="flex-1 space-y-1 overflow-y-auto px-3 py-4">
          {navItems.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              className={({ isActive }) =>
                `flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors ${
                  isActive
                    ? "bg-aat-accent/15 text-aat-accent"
                    : "text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800/60"
                }`
              }
            >
              <span className="text-base">{item.icon}</span>
              {item.label}
            </NavLink>
          ))}
          {isAdmin && (
            <NavLink
              to="/admin"
              className={({ isActive }) =>
                `flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors ${
                  isActive
                    ? "bg-aat-accent/15 text-aat-accent"
                    : "text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800/60"
                }`
              }
            >
              <span className="text-base">⚙</span>
              Admin Panel
            </NavLink>
          )}
        </nav>
        <div className="space-y-2 border-t border-slate-200 px-4 py-4 text-xs dark:border-slate-800">
          <button
            onClick={toggleZulu}
            className="w-full rounded-md border border-slate-300 px-2 py-1.5 text-left font-mono text-[11px] hover:bg-slate-100 dark:border-slate-700 dark:hover:bg-slate-800"
          >
            {useZulu ? "ZULU (UTC)" : "LOCAL TIME"} — toggle
          </button>
          <button
            onClick={toggleDarkMode}
            className="w-full rounded-md border border-slate-300 px-2 py-1.5 text-left hover:bg-slate-100 dark:border-slate-700 dark:hover:bg-slate-800"
          >
            {darkMode ? "☀ Light mode" : "☾ Dark mode"}
          </button>
        </div>
        <div className="border-t border-slate-200 px-4 py-4 dark:border-slate-800">
          <div className="text-sm font-medium">{user?.name}</div>
          <div className="text-[11px] uppercase tracking-wide text-slate-500 dark:text-slate-400">{user?.role.replace("_", " ")}</div>
          <button
            onClick={async () => {
              await logout();
              navigate("/login");
            }}
            className="mt-2 text-xs font-medium text-aat-accent hover:underline"
          >
            Sign out
          </button>
        </div>
      </aside>
      <main className="flex-1 overflow-y-auto">
        <Outlet />
      </main>
    </div>
  );
}
