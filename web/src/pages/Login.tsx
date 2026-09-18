import React, { useState } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { api } from "../api/client";

export default function Login() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [forgotMode, setForgotMode] = useState(false);
  const [forgotSent, setForgotSent] = useState(false);

  const from = (location.state as any)?.from?.pathname ?? "/";

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await login(email, password);
      navigate(from, { replace: true });
    } catch (err: any) {
      setError(err?.response?.data?.error ?? "Login failed. Check your credentials.");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleForgot(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    try {
      await api.post("/auth/forgot-password", { email });
      setForgotSent(true);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-aat-navy px-4">
      <div className="w-full max-w-sm rounded-2xl border border-slate-800 bg-aat-steel p-8 shadow-2xl">
        <div className="mb-8 flex flex-col items-center gap-2 text-center">
          <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-aat-accent text-xl font-bold text-white">A</div>
          <h1 className="text-lg font-semibold text-white">AAT Launch Operations Division</h1>
          <p className="text-xs uppercase tracking-widest text-slate-400">Internal Use / Company Confidential</p>
        </div>

        {!forgotMode ? (
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-400">Email</label>
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full rounded-md border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-white outline-none focus:border-aat-accent"
                placeholder="you@aat-aerospace.example"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-400">Password</label>
              <input
                type="password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full rounded-md border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-white outline-none focus:border-aat-accent"
                placeholder="••••••••"
              />
            </div>
            {error && <div className="rounded-md bg-aat-nogo/15 px-3 py-2 text-xs text-red-300">{error}</div>}
            <button
              type="submit"
              disabled={submitting}
              className="w-full rounded-md bg-aat-accent py-2.5 text-sm font-semibold text-white transition hover:bg-aat-accent/90 disabled:opacity-60"
            >
              {submitting ? "Signing in..." : "Sign In"}
            </button>
            <button
              type="button"
              onClick={() => setForgotMode(true)}
              className="w-full text-center text-xs text-slate-400 hover:text-aat-accent"
            >
              Forgot password?
            </button>
          </form>
        ) : (
          <form onSubmit={handleForgot} className="space-y-4">
            {forgotSent ? (
              <p className="text-sm text-slate-300">
                If an account exists for <span className="font-mono">{email}</span>, a reset link has been sent.
              </p>
            ) : (
              <>
                <div>
                  <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-400">Email</label>
                  <input
                    type="email"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="w-full rounded-md border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-white outline-none focus:border-aat-accent"
                  />
                </div>
                <button
                  type="submit"
                  disabled={submitting}
                  className="w-full rounded-md bg-aat-accent py-2.5 text-sm font-semibold text-white hover:bg-aat-accent/90 disabled:opacity-60"
                >
                  Send reset link
                </button>
              </>
            )}
            <button
              type="button"
              onClick={() => {
                setForgotMode(false);
                setForgotSent(false);
              }}
              className="w-full text-center text-xs text-slate-400 hover:text-aat-accent"
            >
              Back to sign in
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
