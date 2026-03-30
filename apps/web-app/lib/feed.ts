"use client";

import { API_URL } from "./config";

export type FeedToken = {
  name: string;
  symbol: string;
  address: string;
  priceUsd: number;
  liquidityUsd?: number;
  volume24hUsd?: number;
  marketCapUsd?: number;
  change24hPct?: number;
  chartData?: number[];
  source?: string;
  tradeRoute?: string;
  graduationTime?: string;
  isTradable?: boolean;
  tradableReason?: string;
};

type FeedResponse = {
  tokens?: FeedToken[];
  cursor?: string | null;
  error?: string;
};

const fallbackTokens: FeedToken[] = [
  { name: "Neon Kitty", symbol: "NKY", address: "So11111111111111111111111111111111111111112", priceUsd: 0.32, liquidityUsd: 480000, volume24hUsd: 54000, marketCapUsd: 2400000, change24hPct: 4.8, chartData: [0.28, 0.3, 0.32, 0.34, 0.33], source: "pumpfun", tradeRoute: "jupiter", graduationTime: "Live now" },
  { name: "Ocean Vibes", symbol: "WAVE", address: "Cmm22gaas01qw0djot7jeb7g4", priceUsd: 0.18, liquidityUsd: 280000, volume24hUsd: 36000, marketCapUsd: 1500000, change24hPct: -2.7, chartData: [0.19, 0.175, 0.18, 0.182, 0.176], source: "bags", tradeRoute: "bags", graduationTime: "Live now" },
  { name: "Hyper Doge", symbol: "HDOGE", address: "GGZ7Bmds11111111111111111111111111111111111", priceUsd: 0.0078, liquidityUsd: 120000, volume24hUsd: 18000, marketCapUsd: 900000, change24hPct: 12.4, chartData: [0.0065, 0.0072, 0.0078, 0.0081, 0.0084], source: "birdeye", tradeRoute: "jupiter", graduationTime: "Live now" },
];

export const FALLBACK_TOKENS = fallbackTokens;

export async function fetchGraduatedTokens(limit = 24, cursor?: string | null): Promise<FeedToken[]> {
  const params = new URLSearchParams();
  params.set("limit", String(limit));
  if (cursor) params.set("cursor", cursor);
  const response = await fetch(`${API_URL}/api/feed/solana/graduated?${params.toString()}`, {
    cache: "no-store",
  });
  if (!response.ok) {
    throw new Error("Failed to load tokens");
  }
  const data = (await response.json()) as FeedResponse;
  if (!Array.isArray(data.tokens)) {
    throw new Error(data.error || "Malformed feed response");
  }
  return data.tokens;
}
