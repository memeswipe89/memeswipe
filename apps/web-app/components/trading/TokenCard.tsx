"use client";

import { FeedToken } from "@/lib/feed";

const currency = (value?: number) =>
  value && Number.isFinite(value)
    ? `$${value.toLocaleString("en-US", { maximumFractionDigits: 2 })}`
    : "$0";

const percent = (value?: number) =>
  value && Number.isFinite(value) ? `${value > 0 ? "+" : ""}${value.toFixed(2)}%` : "0.00%";

type TokenCardProps = {
  token: FeedToken;
};

export function TokenCard({ token }: TokenCardProps) {
  const progressPositive = (token.change24hPct ?? 0) >= 0;

  return (
    <div className="relative w-full overflow-hidden rounded-[32px] border border-white/10 bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950 p-6 shadow-2xl shadow-black/70">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs uppercase tracking-[0.4em] text-slate-500">
            {token.source ? token.source.toUpperCase() : "GRADUATED"}
          </p>
          <h2 className="mt-1 text-3xl font-bold text-white">{token.symbol || "MEME"}</h2>
          <p className="text-sm font-semibold uppercase tracking-[0.3em] text-slate-400">
            {token.tradeRoute?.toUpperCase?.() ?? "JUPITER"}
          </p>
        </div>
        <div className="text-right text-xs font-semibold uppercase tracking-[0.3em] text-slate-300">
          <div className="rounded-full border border-white/10 px-3 py-1 text-[10px] text-white/80">
            {token.source === "bags" ? "BAGS" : "DROP"}
          </div>
        </div>
      </div>

      <p className="mt-5 text-sm text-slate-400">{token.name || "Unknown token"}</p>
      <div className="mt-4 flex items-center justify-between gap-3">
        <p className="text-4xl font-semibold text-white">{currency(token.priceUsd)}</p>
        <p
          className={`text-sm font-semibold uppercase tracking-[0.4em] ${
            progressPositive ? "text-emerald-400" : "text-rose-400"
          }`}
        >
          {percent(token.change24hPct)}
        </p>
      </div>

      <div className="mt-6 grid grid-cols-2 gap-3 text-[11px] text-slate-400">
        <div className="rounded-2xl bg-white/5 p-3">
          <p className="text-[10px] uppercase tracking-[0.3em] text-slate-400">Liquidity</p>
          <p className="mt-1 text-sm text-white">{currency(token.liquidityUsd)}</p>
        </div>
        <div className="rounded-2xl bg-white/5 p-3">
          <p className="text-[10px] uppercase tracking-[0.3em] text-slate-400">Volume 24h</p>
          <p className="mt-1 text-sm text-white">{currency(token.volume24hUsd)}</p>
        </div>
        <div className="rounded-2xl bg-white/5 p-3">
          <p className="text-[10px] uppercase tracking-[0.3em] text-slate-400">MCap</p>
          <p className="mt-1 text-sm text-white">{currency(token.marketCapUsd)}</p>
        </div>
        <div className="rounded-2xl bg-white/5 p-3">
          <p className="text-[10px] uppercase tracking-[0.3em] text-slate-400">Change</p>
          <p className={`mt-1 text-sm font-semibold ${progressPositive ? "text-emerald-400" : "text-rose-400"}`}>
            {percent(token.change24hPct)}
          </p>
        </div>
      </div>

      {token.tradableReason ? (
        <p className="mt-5 text-xs text-rose-300">{token.tradableReason}</p>
      ) : (
        <p className="mt-5 text-xs text-slate-500">TP / SL ready · Liquidity checked</p>
      )}
    </div>
  );
}
