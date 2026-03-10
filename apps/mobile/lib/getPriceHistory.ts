import { API_BASE } from './api-base';
const fallbackHistory = [0.21, 0.22, 0.19, 0.25, 0.27, 0.24, 0.29];

type ChartResponse = {
  points?: number[];
};

export async function getPriceHistory(address: string, change24hPct = 0): Promise<number[]> {
  try {
    if (!address) return fallbackHistory;
    const res = await fetch(
      `${API_BASE}/api/token-chart/${encodeURIComponent(address)}?change24hPct=${encodeURIComponent(String(change24hPct))}`
    );
    if (!res.ok) return fallbackHistory;
    const json = (await res.json()) as ChartResponse;
    const points = Array.isArray(json?.points) ? json.points.map((v) => Number(v)).filter((v) => Number.isFinite(v)) : [];
    return points.length > 1 ? points : fallbackHistory;
  } catch {
    return fallbackHistory;
  }
}
