import React, { useState } from "react";
import { useNavigate, useSearchParams, Link } from "react-router-dom";
import { api } from "../api/client";

export default function ResetPassword() {
  const [params] = useSearchParams();
  const token = params.get("token") ?? "";
  const navigate = useNavigate();
  const [password, setPassword] = useState("");
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await api.post("/auth/reset-password", { token, password });
      setDone(true);
      setTimeout(() => navigate("/login"), 2000);
    } catch (err: any) {
      setError(err?.response?.data?.error ?? "Reset failed. The link may have expired.");
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-aat-navy px-4">
      <div className="w-full max-w-sm rounded-2xl border border-slate-800 bg-aat-steel p-8 shadow-2xl text-white">
        <h1 className="mb-6 text-lg font-semibold">Reset Password</h1>
        {done ? (
          <p className="text-sm text-slate-300">Password updated. Redirecting to sign in...</p>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            <input
              type="password"
              required
              minLength={8}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="New password (min 8 characters)"
              className="w-full rounded-md border border-slate-700 bg-slate-900 px-3 py-2 text-sm outline-none focus:border-aat-accent"
            />
            {error && <div className="rounded-md bg-aat-nogo/15 px-3 py-2 text-xs text-red-300">{error}</div>}
            <button type="submit" className="w-full rounded-md bg-aat-accent py-2.5 text-sm font-semibold hover:bg-aat-accent/90">
              Reset password
            </button>
            <Link to="/login" className="block text-center text-xs text-slate-400 hover:text-aat-accent">
              Back to sign in
            </Link>
          </form>
        )}
      </div>
    </div>
  );
}
