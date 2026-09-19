import React, { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createUser, deactivateUser, fetchActivityLog, fetchSites, fetchUsers, updateUser } from "../api/resources";
import { usePreferences } from "../context/PreferencesContext";
import { formatTimestamp } from "../utils/time";
import { StatusPill } from "../components/StatusPill";

// Vehicle and VLCP Milestone Template management live entirely under the
// Vehicles tab (v3.1 Item 6) - Admin is reserved for administrative
// functions (users, sites, COAs, system activity) only.
const TABS = ["Users", "Activity Log"] as const;

export default function Admin() {
  const [tab, setTab] = useState<(typeof TABS)[number]>("Users");

  return (
    <div className="space-y-6 p-8">
      <header>
        <h1 className="text-2xl font-bold tracking-tight">Admin Panel</h1>
      </header>

      <div className="flex gap-1 border-b border-slate-200 dark:border-slate-800">
        {TABS.map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`-mb-px border-b-2 px-4 py-2 text-sm font-medium ${
              tab === t ? "border-aat-accent text-aat-accent" : "border-transparent text-slate-500 hover:text-slate-800 dark:text-slate-400"
            }`}
          >
            {t}
          </button>
        ))}
      </div>

      {tab === "Users" && <UsersTab />}
      {tab === "Activity Log" && <ActivityTab />}
    </div>
  );
}

function UsersTab() {
  const qc = useQueryClient();
  const { data: users } = useQuery({ queryKey: ["users"], queryFn: fetchUsers });
  const { data: sites } = useQuery({ queryKey: ["sites"], queryFn: fetchSites });
  const [showNew, setShowNew] = useState(false);
  const [form, setForm] = useState({ name: "", email: "", password: "", role: "VIEWER", siteIds: [] as string[] });

  const create = useMutation({
    mutationFn: () => createUser(form),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["users"] });
      setShowNew(false);
      setForm({ name: "", email: "", password: "", role: "VIEWER", siteIds: [] });
    },
  });

  const toggleActive = useMutation({
    mutationFn: ({ id, status }: { id: string; status: string }) => updateUser(id, { status }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["users"] }),
  });

  const changeRole = useMutation({
    mutationFn: ({ id, role }: { id: string; role: string }) => updateUser(id, { role }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["users"] }),
  });

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <button onClick={() => setShowNew(true)} className="btn-primary">
          + New User
        </button>
      </div>
      <div className="card overflow-hidden">
        <table className="w-full text-sm">
          <thead className="border-b border-slate-200 bg-slate-50 text-left text-xs uppercase text-slate-500 dark:border-slate-800 dark:bg-slate-800/40 dark:text-slate-400">
            <tr>
              <th className="px-4 py-3">Name</th>
              <th className="px-4 py-3">Email</th>
              <th className="px-4 py-3">Role</th>
              <th className="px-4 py-3">Assigned Sites</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3" />
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
            {users?.map((u) => (
              <tr key={u.id}>
                <td className="px-4 py-3 font-medium">{u.name}</td>
                <td className="px-4 py-3 font-mono text-xs">{u.email}</td>
                <td className="px-4 py-3">
                  <select
                    value={u.role}
                    onChange={(e) => changeRole.mutate({ id: u.id, role: e.target.value })}
                    className="rounded-md border border-slate-300 bg-transparent px-2 py-1 text-xs dark:border-slate-700"
                  >
                    {["ADMIN", "LAUNCH_DIRECTOR", "OPERATOR", "VIEWER"].map((r) => (
                      <option key={r} value={r}>
                        {r.replace("_", " ")}
                      </option>
                    ))}
                  </select>
                </td>
                <td className="px-4 py-3 text-xs text-slate-500 dark:text-slate-400">
                  {u.assignedSites?.map((s) => s.site.designator).join(", ") || "--"}
                </td>
                <td className="px-4 py-3">
                  <StatusPill tone={u.status === "ACTIVE" ? "go" : "nogo"}>{u.status}</StatusPill>
                </td>
                <td className="px-4 py-3 text-right">
                  <button
                    onClick={() => toggleActive.mutate({ id: u.id, status: u.status === "ACTIVE" ? "INACTIVE" : "ACTIVE" })}
                    className="text-xs font-semibold text-aat-accent hover:underline"
                  >
                    {u.status === "ACTIVE" ? "Deactivate" : "Reactivate"}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {showNew && (
        <div className="fixed inset-0 z-[2000] flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-md rounded-xl border border-zinc-800 bg-black p-6">
            <h2 className="mb-4 text-lg font-bold">New User</h2>
            <div className="space-y-3">
              <input placeholder="Full name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="input" />
              <input
                type="email"
                placeholder="Email"
                value={form.email}
                onChange={(e) => setForm({ ...form, email: e.target.value })}
                className="input"
              />
              <input
                type="password"
                placeholder="Temporary password (min 8 chars)"
                value={form.password}
                onChange={(e) => setForm({ ...form, password: e.target.value })}
                className="input"
              />
              <select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })} className="input">
                {["ADMIN", "LAUNCH_DIRECTOR", "OPERATOR", "VIEWER"].map((r) => (
                  <option key={r} value={r}>
                    {r.replace("_", " ")}
                  </option>
                ))}
              </select>
              <div>
                <div className="mb-1 text-xs font-semibold uppercase text-slate-500">Assigned sites</div>
                <div className="flex flex-wrap gap-2">
                  {sites?.map((s) => (
                    <label key={s.id} className="flex items-center gap-1 text-xs">
                      <input
                        type="checkbox"
                        checked={form.siteIds.includes(s.id)}
                        onChange={(e) =>
                          setForm({
                            ...form,
                            siteIds: e.target.checked ? [...form.siteIds, s.id] : form.siteIds.filter((id) => id !== s.id),
                          })
                        }
                      />
                      {s.designator}
                    </label>
                  ))}
                </div>
              </div>
            </div>
            <div className="mt-4 flex justify-end gap-2">
              <button onClick={() => setShowNew(false)} className="btn-secondary">
                Cancel
              </button>
              <button
                onClick={() => create.mutate()}
                disabled={!form.name || !form.email || form.password.length < 8}
                className="btn-primary disabled:opacity-50"
              >
                Create User
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function ActivityTab() {
  const { useZulu } = usePreferences();
  const { data: entries } = useQuery({ queryKey: ["activity-log"], queryFn: () => fetchActivityLog({ limit: 200 }) });

  return (
    <div className="card overflow-hidden">
      <table className="w-full text-sm">
        <thead className="border-b border-slate-200 bg-slate-50 text-left text-xs uppercase text-slate-500 dark:border-slate-800 dark:bg-slate-800/40 dark:text-slate-400">
          <tr>
            <th className="px-4 py-3">Time</th>
            <th className="px-4 py-3">User</th>
            <th className="px-4 py-3">Action</th>
            <th className="px-4 py-3">Target</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
          {entries?.map((e: any) => (
            <tr key={e.id}>
              <td className="px-4 py-3 text-xs">{formatTimestamp(e.timestamp, useZulu)}</td>
              <td className="px-4 py-3 text-xs">{e.user?.name ?? "System"}</td>
              <td className="px-4 py-3 font-mono text-xs">{e.action}</td>
              <td className="px-4 py-3 text-xs text-slate-500 dark:text-slate-400">
                {e.targetType} {e.targetId ? `#${e.targetId.slice(0, 8)}` : ""}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
