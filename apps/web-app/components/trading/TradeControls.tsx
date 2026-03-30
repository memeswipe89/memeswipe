"use client";

import { useState } from "react";
import { useTradeSettings } from "@/lib/trade-settings-context";

const CONTROL_STYLES =
  "flex flex-col gap-1 rounded-2xl border border-white/10 bg-slate-950/50 px-4 py-3 text-left text-xs";

export function TradeControls() {
  const {
    tradeAmount,
    tpROI,
    stopLoss,
    setTradeAmount,
    setTpROI,
    setStopLoss,
    resetSettings,
  } = useTradeSettings();
  const [editingAmount, setEditingAmount] = useState(tradeAmount);

  return (
    <div className="w-full max-w-2xl space-y-4 rounded-3xl border border-white/5 bg-slate-950/40 p-6 shadow-xl shadow-black/30">
      <div className="flex items-center justify-between">
        <p className="text-xs uppercase tracking-[0.4em] text-slate-400">Set sptp</p>
        <button
          onClick={resetSettings}
          className="text-[10px] uppercase tracking-[0.4em] text-slate-500 transition hover:text-white"
        >
          Reset
        </button>
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        <label className={CONTROL_STYLES}>
          <span className="text-[10px] uppercase tracking-[0.3em] text-slate-500">Amount</span>
          <input
            type="number"
            min="0.0001"
            step="0.1"
            className="mt-1 w-full rounded-xl border border-transparent bg-slate-900/60 px-3 py-1 text-2xl font-semibold text-white outline-none focus:border-white/40"
            value={editingAmount}
            onFocus={() => setEditingAmount(tradeAmount)}
            onChange={(event) => setEditingAmount(Number(event.target.value))}
            onBlur={() => {
              const normalized = Number.isFinite(editingAmount) ? editingAmount : tradeAmount;
              setTradeAmount(normalized);
              setEditingAmount(normalized);
            }}
          />
        </label>
        <label className={CONTROL_STYLES}>
          <span className="text-[10px] uppercase tracking-[0.3em] text-slate-500">Take profit (%)</span>
          <div className="mt-1 flex items-center justify-between gap-2 text-2xl font-semibold text-white">
            <button
              type="button"
              onClick={() => setTpROI(tpROI - 0.5)}
              className="rounded-full border border-white/10 px-3 py-1 text-base font-semibold text-white/70 transition hover:border-white/50"
            >
              -
            </button>
            <span>{tpROI.toFixed(2)}%</span>
            <button
              type="button"
              onClick={() => setTpROI(tpROI + 0.5)}
              className="rounded-full border border-white/10 px-3 py-1 text-base font-semibold text-white/70 transition hover:border-white/50"
            >
              +
            </button>
          </div>
        </label>
        <label className={CONTROL_STYLES}>
          <span className="text-[10px] uppercase tracking-[0.3em] text-slate-500">Stop loss (%)</span>
          <div className="mt-1 flex items-center justify-between gap-2 text-2xl font-semibold text-white">
            <button
              type="button"
              onClick={() => setStopLoss(stopLoss - 0.5)}
              className="rounded-full border border-white/10 px-3 py-1 text-base font-semibold text-white/70 transition hover:border-white/50"
            >
              -
            </button>
            <span>{stopLoss.toFixed(2)}%</span>
            <button
              type="button"
              onClick={() => setStopLoss(stopLoss + 0.5)}
              className="rounded-full border border-white/10 px-3 py-1 text-base font-semibold text-white/70 transition hover:border-white/50"
            >
              +
            </button>
          </div>
        </label>
      </div>
    </div>
  );
}
