"use client";

"use client";

import { useFlow } from "@/lib/flow";

export function WalletStep() {
  const { walletAddress, loading, error, createWallet, displayName } = useFlow();

  return (
    <div className="flex w-full flex-1 flex-col items-center justify-center gap-6 px-4 text-center">
      <p className="text-xs uppercase tracking-[0.3em] text-slate-400">Step 2 · Wallet</p>
      <h1 className="text-3xl font-semibold text-white sm:text-4xl">
        {walletAddress ? "Wallet linked" : "Finishing wallet setup"}
      </h1>
      <p className="text-sm text-slate-300">
        Privy keeps an embedded Solana wallet ready, just like the mobile experience.
        {" "}
        {walletAddress ? `${displayName}'s trading wallet is ready.` : "We just need one more tap to create your wallet."}
      </p>
      {!walletAddress ? (
        <div className="space-y-3">
          <button
            onClick={createWallet}
            disabled={loading}
            className="w-full max-w-xs rounded-2xl border border-slate-600/70 bg-gradient-to-r from-emerald-400 to-cyan-500 px-4 py-3 text-sm font-semibold uppercase tracking-[0.3em] text-slate-950 shadow-lg shadow-cyan-500/30 transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {loading ? "Linking wallet…" : "Link embedded wallet"}
          </button>
          <p className="text-xs text-slate-500">Privy will prompt you to create or connect your Solana wallet.</p>
        </div>
      ) : (
        <div className="rounded-3xl border border-slate-800/80 bg-slate-900/60 px-8 py-4 shadow-xl shadow-black/40">
          <p className="text-xs uppercase tracking-[0.3em] text-slate-400">Wallet address</p>
          <p className="mt-1 font-mono text-sm text-white break-all">{walletAddress}</p>
        </div>
      )}
      {error && <p className="text-sm text-rose-300">{error}</p>}
    </div>
  );
}
