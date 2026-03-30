"use client";

import { useEffect, useMemo, useState } from "react";
import { API_URL } from "@/lib/config";

type OrderRecord = {
  id: string;
  token_symbol?: string;
  amount_usd?: number;
  close_pnl_usd?: number;
  close_reason?: string;
  closed_at?: string;
};

export function TradesPanel({ userId }: { userId: string | null }) {
  const [orders, setOrders] = useState<OrderRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!userId) {
      setOrders([]);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetch(`${API_URL}/api/orders?userId=${encodeURIComponent(userId)}&limit=100`, {
      cache: "no-store",
    })
      .then((res) => res.json())
      .then((json) => {
        if (cancelled) return;
        if (!Array.isArray(json?.orders)) {
          setError("No trade history found");
          return;
        }
        setOrders(json.orders);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err?.message || "Failed to load trades");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [userId]);

  const stats = useMemo(() => {
    const totalTrades = orders.length;
    const closedWins = orders.filter((o) => o.close_reason === "tp").length;
    const closedLosses = orders.filter((o) => o.close_reason === "sl").length;
    const totalPnl = orders.reduce((acc, order) => acc + Number(order.close_pnl_usd || 0), 0);
    const winRate = closedWins + closedLosses > 0 ? Math.round((closedWins / (closedWins + closedLosses)) * 100) : 0;
    return { totalTrades, winRate, totalPnl };
  }, [orders]);

  const recent = useMemo(() => orders.slice(0, 4), [orders]);

  return (
    <div className="flex w-full max-w-3xl flex-col gap-4 rounded-3xl border border-white/10 bg-slate-950/60 p-6 text-white shadow-lg shadow-black/40">
      <div className="flex flex-col gap-1">
        <p className="text-[10px] uppercase tracking-[0.4em] text-slate-400">Trades</p>
        <h2 className="text-2xl font-semibold">Trade history</h2>
        <p className="text-xs text-slate-500">Snapshots from your Privy-based trades.</p>
      </div>
      <div className="grid gap-3 text-sm sm:grid-cols-3">
        <div className="rounded-2xl border border-white/10 bg-white/5 p-3 text-center">
          <p className="text-[10px] uppercase tracking-[0.4em] text-slate-400">Total trades</p>
          <p className="text-2xl font-bold text-white">{stats.totalTrades}</p>
        </div>
        <div className="rounded-2xl border border-white/10 bg-white/5 p-3 text-center">
          <p className="text-[10px] uppercase tracking-[0.4em] text-slate-400">Win rate</p>
          <p className="text-2xl font-bold text-emerald-300">{stats.winRate}%</p>
        </div>
        <div className="rounded-2xl border border-white/10 bg-white/5 p-3 text-center">
          <p className="text-[10px] uppercase tracking-[0.4em] text-slate-400">PnL (USD)</p>
          <p className="text-2xl font-bold text-slate-100">${stats.totalPnl.toFixed(2)}</p>
        </div>
      </div>
      <div className="space-y-3">
        {loading ? (
          <p className="text-sm text-slate-400">Loading trades…</p>
        ) : error ? (
          <p className="text-sm text-rose-300">{error}</p>
        ) : recent.length === 0 ? (
          <p className="text-sm text-slate-400">No trades yet.</p>
        ) : (
          recent.map((order) => (
            <div key={order.id || `${order.token_symbol}-${order.closed_at}`} className="flex items-center justify-between rounded-2xl border border-white/10 bg-slate-900/70 px-4 py-3 text-xs uppercase tracking-[0.3em]">
              <div>
                <p className="text-sm text-white">{order.token_symbol || "TOKEN"}</p>
                <p className="text-[10px] text-slate-400">{order.closed_at ? new Date(order.closed_at).toLocaleDateString() : "Unknown"}</p>
              </div>
              <p className={`text-sm font-semibold ${order.close_pnl_usd && order.close_pnl_usd >= 0 ? "text-emerald-300" : "text-rose-400"}`}>
                {order.close_pnl_usd ? `$${order.close_pnl_usd.toFixed(2)}` : "--"}
              </p>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
