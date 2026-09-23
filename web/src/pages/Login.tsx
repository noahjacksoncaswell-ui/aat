import React, { useState } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { api } from "../api/client";

const CONFIDENTIALITY_TEXT = `By proceeding, you acknowledge and agree that: (a) you are an authorized employee or agent of the Launch Operations Division of American Aerospace Technologies Corp; (b) all technical data, documentation, and information accessible through this system is the confidential and proprietary property of American Aerospace Technologies Corp and/or its affiliates; (c) you shall not disclose, reproduce, transmit, or otherwise disseminate any information accessed through this system, in whole or in part, to any person or entity not authorized to receive it; (d) unauthorized disclosure may result in civil liability and, where ITAR-controlled technical data is implicated, criminal penalties under the Arms Export Control Act; and (e) your access and activity within this system may be logged and audited.`;

// v5.2 Section 2 - a two-step flow replaces the former single-page login:
// Step 1 is a branded intro/splash (logo, org identification, the ITAR
// notice widened and centered), Step 2 is the actual credential form,
// relocated here unchanged. Pure layout/sequencing - no change to
// authentication logic, the acknowledgment gate, or any backend behavior.
export default function Login() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [step, setStep] = useState<1 | 2>(1);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [acknowledged, setAcknowledged] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [forgotMode, setForgotMode] = useState(false);
  const [forgotSent, setForgotSent] = useState(false);

  const from = (location.state as any)?.from?.pathname ?? "/";

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!acknowledged) {
      setError("ACKNOWLEDGMENT REQUIRED — YOU MUST AFFIRM THE CONFIDENTIALITY NOTICE BELOW TO PROCEED.");
      return;
    }
    setSubmitting(true);
    try {
      await login(email, password);
      navigate(from, { replace: true });
    } catch (err: any) {
      setError(err?.response?.data?.error ?? "LOGIN FAILED — CREDENTIALS NOT RECOGNIZED.");
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

  if (step === 1) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center overflow-y-auto bg-black px-4 py-8 text-center">
        <img src="/logo.webp" alt="American Aerospace" className="w-full max-w-[300px]" />

        <div className="mt-6 space-y-1">
          <div className="text-lg font-bold uppercase tracking-wide text-white">American Aerospace Technologies Corporation</div>
          <div className="text-sm font-semibold uppercase tracking-wide text-zinc-300">Launch Operations Division</div>
          <div className="text-sm font-semibold uppercase tracking-wide text-zinc-400">Launch Operations and Information System (LOIS)</div>
        </div>

        <div className="mt-8 w-[65%] border border-aat-caution bg-aat-caution/10 px-5 py-4">
          <p className="text-xs font-bold uppercase tracking-wide text-aat-caution">ITAR-Controlled // Distribution Is Limited</p>
          <p className="normal-case mt-2 text-[11px] leading-snug text-zinc-300">
            This system contains ITAR-controlled technical data as defined in 22 CFR Part 120.10. Access is restricted to U.S. persons as
            defined in 22 CFR Part 120.15. No foreign dissemination is permitted. Unauthorized access, disclosure, transfer, export, or
            re-export of the technical data contained herein is prohibited under the Arms Export Control Act (22 U.S.C. 2751 et seq.) and
            the International Traffic in Arms Regulations (22 CFR Parts 120–130). Distribution of this system and its contents is
            limited and controlled by American Aerospace Technologies Corp.
          </p>
        </div>

        <button onClick={() => setStep(2)} className="btn-primary mt-8">
          Proceed to Login
        </button>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center overflow-y-auto bg-black px-4 py-8">
      <div className="w-full max-w-sm">
        <div className="mb-5 flex flex-col items-center gap-3 text-center">
          <img src="/logo.webp" alt="American Aerospace" className="w-full max-w-[170px]" />
          <h1 className="text-sm font-bold uppercase tracking-wide text-white">AAT Launch Operations and Information System (LOIS)</h1>
        </div>

        <div className="border border-zinc-800 bg-aat-steel p-5">
          {!forgotMode ? (
            <form onSubmit={handleSubmit} className="space-y-3">
              <div>
                <label className="mb-1 block text-xs font-medium text-zinc-400">Email</label>
                <input
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="input"
                  placeholder="you@aat-aerospace.example"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-zinc-400">Password</label>
                <input type="password" required value={password} onChange={(e) => setPassword(e.target.value)} className="input" placeholder="••••••••" />
              </div>

              <label className="flex max-h-32 items-start gap-2 overflow-y-auto border border-zinc-700 p-2.5 text-left">
                <input type="checkbox" checked={acknowledged} onChange={(e) => setAcknowledged(e.target.checked)} className="mt-0.5 shrink-0" />
                <span className="normal-case text-[11px] leading-snug text-zinc-300">{CONFIDENTIALITY_TEXT}</span>
              </label>

              {error && <div className="border border-aat-nogo bg-aat-nogo/15 px-3 py-2 text-xs font-semibold text-aat-nogo">{error}</div>}
              <button type="submit" disabled={submitting || !acknowledged} className="btn-primary w-full disabled:opacity-40">
                {submitting ? "Authenticating..." : "Sign In"}
              </button>
              <button type="button" onClick={() => setForgotMode(true)} className="w-full text-center text-xs text-zinc-400 hover:text-white">
                Forgot Password?
              </button>
            </form>
          ) : (
            <form onSubmit={handleForgot} className="space-y-4">
              {forgotSent ? (
                <p className="normal-case text-sm text-zinc-300">
                  If an account exists for <span className="font-mono">{email}</span>, a reset link has been sent.
                </p>
              ) : (
                <>
                  <div>
                    <label className="mb-1 block text-xs font-medium text-zinc-400">Email</label>
                    <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} className="input" />
                  </div>
                  <button type="submit" disabled={submitting} className="btn-primary w-full disabled:opacity-40">
                    Send Reset Link
                  </button>
                </>
              )}
              <button
                type="button"
                onClick={() => {
                  setForgotMode(false);
                  setForgotSent(false);
                }}
                className="w-full text-center text-xs text-zinc-400 hover:text-white"
              >
                Back To Sign In
              </button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
