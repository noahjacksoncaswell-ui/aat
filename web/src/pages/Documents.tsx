import React, { useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  deleteDocument,
  fetchDocument,
  fetchDocuments,
  fetchMissions,
  fetchSites,
  updateDocumentMeta,
  uploadDocument,
  uploadDocumentVersion,
} from "../api/resources";
import { usePreferences } from "../context/PreferencesContext";
import { formatTimestamp } from "../utils/time";
import { StatusPill } from "../components/StatusPill";
import { RequireRole } from "../components/RequireRole";
import { useAuth } from "../context/AuthContext";
import { DOCUMENT_CATEGORIES } from "../types";
import type { DocumentStatus } from "../types";

const STATUS_TONE: Record<DocumentStatus, "go" | "caution" | "neutral"> = {
  DRAFT: "neutral",
  IN_REVIEW: "caution",
  APPROVED: "go",
  ARCHIVED: "neutral",
};

export default function Documents() {
  const [params] = useSearchParams();
  const { useZulu } = usePreferences();
  const [filters, setFilters] = useState({
    siteId: params.get("siteId") || "",
    missionId: params.get("missionId") || "",
    category: "",
    status: "",
    q: "",
  });
  const [showUpload, setShowUpload] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const { data: documents, isLoading } = useQuery({
    queryKey: ["documents", filters],
    queryFn: () =>
      fetchDocuments({
        siteId: filters.siteId || undefined,
        missionId: filters.missionId || undefined,
        category: filters.category || undefined,
        status: (filters.status as DocumentStatus) || undefined,
        q: filters.q || undefined,
      }),
  });
  const { data: sites } = useQuery({ queryKey: ["sites"], queryFn: fetchSites });
  const { data: missions } = useQuery({ queryKey: ["missions", {}], queryFn: () => fetchMissions() });

  return (
    <div className="flex h-full">
      <div className="flex-1 space-y-6 overflow-y-auto p-8">
        <header className="flex items-start justify-between">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Launch Documentation Library</h1>
          </div>
          <RequireRole roles={["ADMIN", "LAUNCH_DIRECTOR", "OPERATOR"]}>
            <button onClick={() => setShowUpload(true)} className="btn-primary">
              + Upload Document
            </button>
          </RequireRole>
        </header>

        <div className="flex flex-wrap gap-3">
          <input
            placeholder="Search title / tags"
            value={filters.q}
            onChange={(e) => setFilters({ ...filters, q: e.target.value })}
            className="input max-w-xs"
          />
          <select value={filters.category} onChange={(e) => setFilters({ ...filters, category: e.target.value })} className="input max-w-[220px]">
            <option value="">All categories</option>
            {DOCUMENT_CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
          <select value={filters.status} onChange={(e) => setFilters({ ...filters, status: e.target.value })} className="input max-w-[180px]">
            <option value="">All statuses</option>
            {["DRAFT", "IN_REVIEW", "APPROVED", "ARCHIVED"].map((s) => (
              <option key={s} value={s}>
                {s.replace("_", " ")}
              </option>
            ))}
          </select>
          <select value={filters.siteId} onChange={(e) => setFilters({ ...filters, siteId: e.target.value })} className="input max-w-[200px]">
            <option value="">All sites</option>
            {sites?.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
          <select value={filters.missionId} onChange={(e) => setFilters({ ...filters, missionId: e.target.value })} className="input max-w-[220px]">
            <option value="">All missions</option>
            {missions?.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </select>
        </div>

        <div className="card overflow-hidden">
          <table className="w-full text-sm">
            <thead className="border-b border-slate-200 bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500 dark:border-slate-800 dark:bg-slate-800/40 dark:text-slate-400">
              <tr>
                <th className="px-4 py-3">Title</th>
                <th className="px-4 py-3">Category</th>
                <th className="px-4 py-3">Site / Mission</th>
                <th className="px-4 py-3">Version</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Updated</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
              {isLoading && (
                <tr>
                  <td colSpan={6} className="px-4 py-8 text-center text-slate-400">
                    Loading documents...
                  </td>
                </tr>
              )}
              {documents?.map((doc) => (
                <tr key={doc.id} onClick={() => setSelectedId(doc.id)} className="cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-800/40">
                  <td className="px-4 py-3 font-medium text-aat-accent">{doc.title}</td>
                  <td className="px-4 py-3 text-xs">{doc.category}</td>
                  <td className="px-4 py-3 text-xs text-slate-500 dark:text-slate-400">{doc.site?.name || doc.mission?.name || "--"}</td>
                  <td className="px-4 py-3 text-xs">v{doc.currentVersion}</td>
                  <td className="px-4 py-3">
                    <StatusPill tone={STATUS_TONE[doc.status]}>{doc.status.replace("_", " ")}</StatusPill>
                  </td>
                  <td className="px-4 py-3 text-xs text-slate-500 dark:text-slate-400">{formatTimestamp(doc.updatedAt, useZulu)}</td>
                </tr>
              ))}
              {documents?.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-4 py-8 text-center text-slate-400">
                    No documents match these filters.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {selectedId && <DocumentPanel id={selectedId} onClose={() => setSelectedId(null)} />}
      {showUpload && <UploadModal onClose={() => setShowUpload(false)} sites={sites} missions={missions} />}
    </div>
  );
}

function DocumentPanel({ id, onClose }: { id: string; onClose: () => void }) {
  const { useZulu } = usePreferences();
  const { isLaunchDirector } = useAuth();
  const qc = useQueryClient();
  const { data: doc } = useQuery({ queryKey: ["document", id], queryFn: () => fetchDocument(id) });
  const [newVersionFile, setNewVersionFile] = useState<File | null>(null);

  const updateMeta = useMutation({
    mutationFn: (data: Record<string, unknown>) => updateDocumentMeta(id, data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["document", id] });
      qc.invalidateQueries({ queryKey: ["documents"] });
    },
  });

  const uploadVersion = useMutation({
    mutationFn: () => {
      const fd = new FormData();
      fd.append("file", newVersionFile!);
      return uploadDocumentVersion(id, fd);
    },
    onSuccess: () => {
      setNewVersionFile(null);
      qc.invalidateQueries({ queryKey: ["document", id] });
      qc.invalidateQueries({ queryKey: ["documents"] });
    },
  });

  const remove = useMutation({
    mutationFn: () => deleteDocument(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["documents"] });
      onClose();
    },
  });

  if (!doc) return <div className="w-[420px] border-l border-zinc-800 bg-black p-6">Loading...</div>;

  const latestVersion = doc.versions?.[0];

  return (
    <div className="flex w-[420px] shrink-0 flex-col overflow-y-auto border-l border-zinc-800 bg-black">
      <div className="flex items-start justify-between border-b border-slate-200 p-5 dark:border-slate-800">
        <div>
          <div className="text-lg font-bold">{doc.title}</div>
          <div className="text-xs text-slate-500 dark:text-slate-400">{doc.category}</div>
        </div>
        <button onClick={onClose} className="text-slate-400 hover:text-slate-700 dark:hover:text-slate-200">
          CLOSE
        </button>
      </div>

      <div className="space-y-5 p-5">
        {latestVersion && (
          <a
            href={`/api/documents/${doc.id}/versions/${latestVersion.version}/content`}
            target="_blank"
            rel="noreferrer"
            className="btn-primary block text-center"
          >
            Preview / Download Latest (v{latestVersion.version})
          </a>
        )}

        <RequireRole roles={["ADMIN", "LAUNCH_DIRECTOR"]}>
          <div>
            <label className="mb-1 block text-xs font-semibold uppercase text-slate-500">Status</label>
            <select
              value={doc.status}
              onChange={(e) => updateMeta.mutate({ status: e.target.value })}
              className="input"
            >
              {["DRAFT", "IN_REVIEW", "APPROVED", "ARCHIVED"].map((s) => (
                <option key={s} value={s}>
                  {s.replace("_", " ")}
                </option>
              ))}
            </select>
          </div>
        </RequireRole>

        <section>
          <div className="mb-2 text-xs font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400">Version History</div>
          <div className="space-y-2">
            {doc.versions?.map((v) => (
              <a
                key={v.id}
                href={`/api/documents/${doc.id}/versions/${v.version}/content`}
                target="_blank"
                rel="noreferrer"
                className="block rounded-md border border-slate-200 p-2 text-xs hover:bg-slate-50 dark:border-slate-800 dark:hover:bg-slate-800/50"
              >
                v{v.version} · {v.fileName} · {(v.fileSizeBytes / 1024).toFixed(0)} KB
                <div className="text-slate-400">
                  {v.uploadedBy.name} · {formatTimestamp(v.uploadedAt, useZulu)}
                </div>
              </a>
            ))}
          </div>
          <RequireRole roles={["ADMIN", "LAUNCH_DIRECTOR", "OPERATOR"]}>
            <div className="mt-2 flex gap-2">
              <input type="file" onChange={(e) => setNewVersionFile(e.target.files?.[0] ?? null)} className="flex-1 text-xs" />
              <button
                onClick={() => newVersionFile && uploadVersion.mutate()}
                disabled={!newVersionFile}
                className="rounded-md bg-white px-2 py-1 text-xs font-semibold text-black disabled:opacity-50"
              >
                Upload new version
              </button>
            </div>
          </RequireRole>
        </section>

        <section>
          <div className="mb-2 text-xs font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400">Audit Log</div>
          <div className="space-y-1 text-xs">
            {doc.auditLog?.map((a) => (
              <div key={a.id} className="flex justify-between text-slate-500 dark:text-slate-400">
                <span>
                  {a.action} — {a.user.name}
                </span>
                <span>{formatTimestamp(a.timestamp, useZulu)}</span>
              </div>
            ))}
          </div>
        </section>

        <RequireRole roles={["ADMIN", "LAUNCH_DIRECTOR"]}>
          <button
            onClick={() => confirm(`Delete "${doc.title}"? This cannot be undone.`) && remove.mutate()}
            className="text-xs font-semibold text-aat-nogo hover:underline"
          >
            Delete document
          </button>
        </RequireRole>
      </div>
    </div>
  );
}

function UploadModal({ onClose, sites, missions }: { onClose: () => void; sites?: any[]; missions?: any[] }) {
  const qc = useQueryClient();
  const [form, setForm] = useState({ title: "", category: DOCUMENT_CATEGORIES[0], siteId: "", missionId: "", tags: "" });
  const [file, setFile] = useState<File | null>(null);

  const mutation = useMutation({
    mutationFn: () => {
      const fd = new FormData();
      fd.append("file", file!);
      fd.append("title", form.title);
      fd.append("category", form.category);
      if (form.siteId) fd.append("siteId", form.siteId);
      if (form.missionId) fd.append("missionId", form.missionId);
      if (form.tags) fd.append("tags", form.tags);
      return uploadDocument(fd);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["documents"] });
      onClose();
    },
  });

  return (
    <div className="fixed inset-0 z-[2000] flex items-center justify-center bg-black/40 p-4">
      <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-xl border border-zinc-800 bg-black p-6">
        <h2 className="mb-4 text-lg font-bold">Upload Document</h2>
        <div className="space-y-3">
          <input type="file" onChange={(e) => setFile(e.target.files?.[0] ?? null)} className="input" />
          <input placeholder="Title" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} className="input" />
          <select value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} className="input">
            {DOCUMENT_CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
          <select value={form.siteId} onChange={(e) => setForm({ ...form, siteId: e.target.value })} className="input">
            <option value="">No associated site</option>
            {sites?.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
          <select value={form.missionId} onChange={(e) => setForm({ ...form, missionId: e.target.value })} className="input">
            <option value="">No associated mission</option>
            {missions?.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </select>
          <input
            placeholder="Tags (comma separated)"
            value={form.tags}
            onChange={(e) => setForm({ ...form, tags: e.target.value })}
            className="input"
          />
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <button onClick={onClose} className="btn-secondary">
            Cancel
          </button>
          <button onClick={() => mutation.mutate()} disabled={!file || !form.title} className="btn-primary disabled:opacity-50">
            Upload
          </button>
        </div>
      </div>
    </div>
  );
}
