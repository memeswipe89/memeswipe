"use client";

import { AnimatePresence, motion } from "framer-motion";
import { useState } from "react";

const cards = [
  {
    name: "Neon Kitty",
    symbol: "NKY",
    description: "Fast lane Solana memecoin with liquidity filters and auto TP/SL.",
  },
  {
    name: "Ocean Vibes",
    symbol: "WAVE",
    description: "Low-floor gem with community-driven rewards.",
  },
  {
    name: "Hyper Doge",
    symbol: "HDOGE",
    description: "Explosive charts, curated feed, and tweet-powered signals.",
  },
];

export function SwipeDeck() {
  const [deck, setDeck] = useState(cards);
  const [direction, setDirection] = useState<"left" | "right" | null>(null);

  const handleSwipe = (dir: "left" | "right") => {
    setDirection(dir);
    setTimeout(() => {
      setDeck((prev) => prev.slice(1));
      setDirection(null);
    }, 200);
  };

  const current = deck[0];

  if (!current) {
    return (
      <div className="flex w-full flex-1 flex-col items-center justify-center gap-4 px-4 text-center">
        <p className="text-sm uppercase tracking-[0.3em] text-slate-400">Step 3 · Trading</p>
        <h1 className="text-3xl font-semibold text-white">You’re all set</h1>
        <p className="text-sm text-slate-300">Your swipe deck is empty for now, but new drops land regularly.</p>
      </div>
    );
  }

  return (
    <div className="flex w-full flex-1 flex-col items-center justify-center gap-6 px-4">
      <p className="text-xs uppercase tracking-[0.3em] text-slate-400">Step 3 · Swipe deck</p>
      <div className="relative h-80 w-full max-w-md">
        <AnimatePresence>
          {current && (
            <motion.div
              key={current.symbol}
              className="absolute inset-0 rounded-3xl border border-white/10 bg-gradient-to-br from-slate-900 to-slate-800 p-6 shadow-2xl shadow-black/60"
              initial={{ opacity: 0, scale: 0.95, x: 0 }}
              animate={{ opacity: 1, scale: 1, x: 0 }}
              exit={{ opacity: 0, scale: 0.95, x: direction === "left" ? -80 : 80 }}
              drag="x"
              dragConstraints={{ left: -200, right: 200 }}
              dragElastic={0.2}
              onDragEnd={(_, info) => {
                if (Math.abs(info.offset.x) > 120) {
                  handleSwipe(info.offset.x < 0 ? "left" : "right");
                }
              }}
            >
              <p className="text-lg font-bold text-indigo-300">{current.symbol}</p>
              <h2 className="mt-2 text-3xl font-semibold text-white">{current.name}</h2>
              <p className="mt-4 text-sm text-slate-300">{current.description}</p>
              <div className="mt-6 flex items-center justify-between text-xs uppercase tracking-[0.3em] text-slate-400">
                <span>TP/SL ready</span>
                <span>Privy wallets</span>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
      <div className="flex w-full max-w-md items-center justify-between">
        <button
          onClick={() => handleSwipe("left")}
          className="rounded-full border border-white/20 px-6 py-3 text-xs tracking-[0.3em] text-slate-300 transition hover:border-white"
        >
          Skip
        </button>
        <button
          onClick={() => handleSwipe("right")}
          className="rounded-full bg-gradient-to-r from-emerald-400 to-cyan-500 px-6 py-3 text-xs font-semibold uppercase tracking-[0.3em] text-slate-950 shadow-lg shadow-cyan-500/30"
        >
          Trade
        </button>
      </div>
    </div>
  );
}
