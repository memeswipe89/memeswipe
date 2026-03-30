"use client";

import { FeedToken } from "@/lib/feed";

type BagHighlightsProps = {
  bagTokens: FeedToken[];
};

export function BagHighlights({ bagTokens }: BagHighlightsProps) {
  if (!bagTokens.length) {
    return (
      <div className="flex w-full max-w-2xl flex-col gap-2 rounded-3xl border border-dashed border-white/15 bg-slate-950/50 px-4 py-5 text-sm text-slate-400">
        <p className="text-xs uppercase tracking-[0.4em] text-slate-500">Bags feed</p>
        <p>We add filtered Bags tokens alongside the main feed so you never miss a launch.</p>
      </div>
    );
  }

  return (
    <div className="flex w-full max-w-2xl flex-col gap-3 rounded-3xl border border-white/10 bg-slate-950/60 px-4 py-4 text-sm text-slate-400">
      <div className="flex items-center justify-between">
        <p className="text-xs uppercase tracking-[0.4em] text-slate-500">BAGS integration</p>
        <span className="text-[10px] font-semibold uppercase tracking-[0.3em] text-emerald-300">
          {bagTokens.length} live
        </span>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        {bagTokens.map((token) => (
          <div key={token.address} className="rounded-2xl border border-white/20 bg-slate-900/40 px-3 py-3">
            <div className="flex items-center justify-between text-xs uppercase tracking-[0.3em] text-slate-500">
              <span>{token.symbol}</span>
              <span className="text-emerald-400">BAGS</span>
            </div>
            <p className="mt-2 text-base font-semibold text-white">{token.name || "Unknown"}</p>
            <p className="text-sm text-slate-400">{token.priceUsd ? `$${token.priceUsd.toFixed(3)}` : "--"}</p>
          </div>
        ))}
      </div>
    </div>
  );
}
