"use client";

import { useFlow } from "@/lib/flow";

export function AuthStep() {
  const { loading, error, loginWithTwitter, loginWithEmail } = useFlow();

  return (
    <div className="flex w-full flex-1 flex-col items-center justify-center gap-6 px-4 text-left">
      <div className="space-y-3 text-center">
        <p className="text-xs uppercase tracking-[0.3em] text-slate-400">Step 1 · Privy Auth</p>
        <h1 className="text-3xl font-semibold text-white sm:text-4xl">Authenticate with Privy</h1>
        <p className="text-sm text-slate-300">
          Login with Twitter or Email to unlock your embedded wallet. This mirrors the mobile onboarding flow.
        </p>
      </div>

      {error && <p className="rounded-full bg-rose-500/20 px-4 py-2 text-center text-sm text-rose-200">{error}</p>}

      <div className="w-full max-w-xs space-y-3">
        <button
          onClick={loginWithTwitter}
          disabled={loading}
          className="w-full rounded-2xl border border-slate-600/70 bg-gradient-to-r from-sky-500 to-indigo-500 px-4 py-3 text-sm font-semibold uppercase tracking-[0.3em] text-white transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {loading ? "Signing in…" : "Continue with Twitter"}
        </button>
        <button
          onClick={loginWithEmail}
          disabled={loading}
          className="w-full rounded-2xl border border-white/20 bg-white/5 px-4 py-3 text-sm font-semibold uppercase tracking-[0.3em] text-white transition hover:border-white/60 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {loading ? "Starting email flow…" : "Continue with Email"}
        </button>
      </div>
    </div>
  );
}
