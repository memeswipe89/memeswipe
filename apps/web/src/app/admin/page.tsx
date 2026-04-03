'use client';

import { useCallback, useEffect, useState } from 'react';

type StatsPayload = {
  totalVolume: number;
  totalTrades: number;
  activeUsers: number;
};

const EMPTY_STATS: StatsPayload = {
  totalVolume: 0,
  totalTrades: 0,
  activeUsers: 0,
};

const formatNumber = (value: number, digits: number = 1) =>
  new Intl.NumberFormat('en-US', {
    maximumFractionDigits: digits,
  }).format(value);

export default function AdminPage() {
  const [stats, setStats] = useState<StatsPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchStats = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/stats', { cache: 'no-store' });
      if (!res.ok) {
        const payload = await res.json().catch(() => ({}));
        throw new Error(payload?.error || 'Failed to load stats');
      }
      const payload = await res.json();
      setStats({
        totalVolume: Number(payload.totalVolume || 0),
        totalTrades: Number(payload.totalTrades || 0),
        activeUsers: Number(payload.activeUsers || 0),
      });
      setError(null);
    } catch (err: any) {
      setError(err?.message || 'Unable to load stats');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchStats();
    const interval = setInterval(() => {
      void fetchStats();
    }, 15_000);
    return () => clearInterval(interval);
  }, [fetchStats]);

  const activeStats = stats || EMPTY_STATS;

  return (
    <div className="min-h-screen bg-[#03050b] text-white px-6 py-10">
      <div className="mx-auto max-w-5xl space-y-8 rounded-3xl border border-white/10 bg-white/5 p-8 shadow-2xl shadow-black/40">
        <header className="space-y-1">
          <p className="text-xs uppercase tracking-[0.4em] text-white/60">Admin</p>
          <h1 className="text-4xl font-semibold">Protocol stats dashboard</h1>
          <p className="text-sm text-white/70">
            Live roll-up of filled trades and swap volume. Refreshes every 15 seconds.
          </p>
        </header>

        <div className="space-y-4">
          <div className="grid gap-4 md:grid-cols-3">
            {[
              {
                icon: '🔥',
                label: 'Total volume',
                value: `$${formatNumber(activeStats.totalVolume, 2)}`,
                description: 'USD basis',
              },
              {
                icon: '⚡',
                label: 'Total trades',
                value: formatNumber(activeStats.totalTrades, 0),
                description: 'filled orders',
              },
            ].map((item) => (
              <div key={item.label} className="rounded-2xl border border-white/10 bg-black/30 p-4">
                <p className="text-2xl">{item.icon}</p>
                <p className="mt-2 text-sm uppercase tracking-[0.3em] text-white/50">{item.label}</p>
                <p className="mt-1 text-2xl font-semibold text-white">{item.value}</p>
                <p className="text-xs text-white/50">{item.description}</p>
              </div>
            ))}
          </div>
          <div className="rounded-2xl border border-white/10 bg-black/30 p-4">
            <p className="text-sm text-white/60">Active traders (last 24h):</p>
            <p className="text-3xl font-semibold">{formatNumber(activeStats.activeUsers, 0)}</p>
            <p className="text-xs text-white/50">Distinct Privy users with filled orders.</p>
          </div>
        </div>

        <div className="rounded-2xl border border-white/10 bg-black/30 p-4 text-sm text-white/70">
          {loading && <p className="text-white/50">Fetching stats...</p>}
          {error && <p className="text-red-400">{error}</p>}
        </div>
      </div>
    </div>
  );
}
