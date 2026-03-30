"use client";

import { FeedToken } from "@/lib/feed";
import { TokenCard } from "./TokenCard";

type TokenDeckProps = {
  tokens: FeedToken[];
  onReject: (token: FeedToken) => void;
  onTrade: (token: FeedToken) => void;
  isLoading?: boolean;
  emptyTitle?: string;
};

export function TokenDeck({
  tokens,
  onReject,
  onTrade,
  isLoading = false,
  emptyTitle = "Deck empty",
}: TokenDeckProps) {
  const current = tokens[0];

  return (
    <div className="flex w-full max-w-2xl flex-col items-center gap-5">
      {isLoading && (
        <div className="flex w-full items-center justify-center rounded-3xl border border-dashed border-white/20 bg-slate-900/60 py-20 text-sm text-slate-400">
          Fetching the latest drops…
        </div>
      )}
      {!isLoading && current && <TokenCard token={current} />}
      {!isLoading && !current && (
        <div className="flex w-full flex-col items-center gap-3 rounded-3xl border border-dashed border-white/20 bg-slate-900/40 px-6 py-12 text-center text-sm text-slate-400">
          <p className="text-lg font-semibold text-white">{emptyTitle}</p>
          <p>New drops land regularly. Come back soon.</p>
        </div>
      )}

      <div className="flex w-full max-w-2xl gap-3">
        <button
          onClick={() => current && onReject(current)}
          disabled={!current}
          className="flex-1 rounded-2xl border border-white/20 bg-white/5 px-4 py-3 text-xs font-semibold uppercase tracking-[0.3em] text-slate-300 transition hover:border-white disabled:cursor-not-allowed disabled:opacity-60"
        >
          Skip
        </button>
        <button
          onClick={() => current && onTrade(current)}
          disabled={!current}
          className="flex-1 rounded-2xl bg-gradient-to-r from-emerald-400 to-cyan-500 px-4 py-3 text-xs font-semibold uppercase tracking-[0.3em] text-slate-950 shadow-lg shadow-cyan-500/30 transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
        >
          Trade
        </button>
      </div>
    </div>
  );
}
