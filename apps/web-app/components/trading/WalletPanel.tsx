"use client";

import { useCallback, useState } from "react";
import { useFlow } from "@/lib/flow";

type WalletPanelProps = {
  walletAddress: string | null;
};

export function WalletPanel({ walletAddress }: WalletPanelProps) {
  const { createWallet } = useFlow();
  const [copyMessage, setCopyMessage] = useState("");
  const [registering, setRegistering] = useState(false);

  const handleCopy = useCallback(() => {
    if (!walletAddress) return;
    navigator.clipboard.writeText(walletAddress);
    setCopyMessage("Copied!");
    window.setTimeout(() => setCopyMessage(""), 1200);
  }, [walletAddress]);

  const handleCreate = useCallback(async () => {
    setRegistering(true);
    try {
      await createWallet();
    } finally {
      setRegistering(false);
    }
  }, [createWallet]);

  return (
    <div className="flex w-full max-w-3xl flex-col gap-5 rounded-3xl border border-white/10 bg-slate-950/60 p-6 shadow-xl shadow-black/40">
      <div className="flex flex-col gap-1">
        <p className="text-[10px] uppercase tracking-[0.4em] text-slate-400">Wallet</p>
        <h2 className="text-2xl font-semibold text-white">Privy embedded wallet</h2>
        <p className="text-xs text-slate-500">Automatic Solana wallet powered by Privy.</p>
      </div>
      <div className="rounded-3xl border border-white/15 bg-slate-900/60 p-4">
        {walletAddress ? (
          <>
            <p className="text-[10px] uppercase tracking-[0.3em] text-slate-500">Address</p>
            <p className="font-mono text-sm text-white break-all">{walletAddress}</p>
            <p className="text-[10px] text-slate-400">{copyMessage || "You can deposit SOL to this address."}</p>
          </>
        ) : (
          <p className="text-sm text-slate-400">Link your wallet to receive SOL, trade, and withdraw.</p>
        )}
      </div>
      <div className="flex gap-3 text-xs uppercase tracking-[0.4em] text-slate-300">
        <button
          onClick={handleCreate}
          disabled={registering}
          className="flex-1 rounded-2xl border border-white/10 bg-gradient-to-r from-emerald-400 to-cyan-500 px-4 py-3 text-[10px] font-semibold text-slate-950 shadow-lg shadow-cyan-500/30 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {walletAddress ? (registering ? "Refreshing wallet…" : "Refresh wallet") : registering ? "Creating wallet…" : "Create wallet"}
        </button>
        <button
          onClick={handleCopy}
          disabled={!walletAddress}
          className="flex-1 rounded-2xl border border-dashed border-white/30 px-4 py-3 text-[10px] font-semibold tracking-[0.4em] text-slate-300 disabled:cursor-not-allowed disabled:opacity-40"
        >
          Copy address
        </button>
      </div>
      <div className="rounded-2xl border border-white/10 bg-white/5 p-4 text-xs text-slate-300">
        <p className="font-semibold text-slate-50">Deposit instructions</p>
        <p className="mt-2 text-[11px] text-slate-400">
          Send SOL from any Solana wallet (Phantom, Solflare, etc). Monitor the RPC at{" "}
          <span className="text-white">https://api.mainnet-beta.solana.com</span>.
        </p>
      </div>
    </div>
  );
}
