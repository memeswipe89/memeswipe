import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Alert, FlatList, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import * as Linking from 'expo-linking';
import * as Haptics from 'expo-haptics';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import { addBalance } from '@/lib/devWallet';
import { notifyTradeClosed } from '@/lib/notifications';
import { useWalletContext } from '@/contexts/wallet-context';
import { Connection, VersionedTransaction } from '@solana/web3.js';
import { Buffer } from 'buffer';

import { API_BASE, JUP_API_KEY } from '@/lib/api-base';
import { getFriendlyCloseError } from '@/lib/user-friendly-errors';
const SOLANA_MAINNET_RPC = 'https://api.mainnet-beta.solana.com';
const SOL_MINT = 'So11111111111111111111111111111111111111112';
const JUPITER_BASE_URLS = ['https://api.jup.ag/swap/v1', 'https://lite-api.jup.ag/swap/v1'];
const parseApiJson = async <T,>(response: Response): Promise<T> => {
  const raw = await response.text();
  try {
    return JSON.parse(raw) as T;
  } catch {
    const trimmed = raw.trim();
    const preview = trimmed.slice(0, 120);
    if (trimmed.startsWith('<')) {
      throw new Error(`Server returned HTML (${response.status}). Check API_BASE/deploy backend routes.`);
    }
    throw new Error(`Invalid server response (${response.status}): ${preview || 'empty body'}`);
  }
};

const fetchDexscreenerPrices = async (addresses: string[]) => {
  if (!addresses.length) return {};
  const url = `https://api.dexscreener.com/tokens/v1/solana/${addresses.join(',')}`;
  const res = await fetch(url);
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Dexscreener failed: ${res.status} ${text}`);
  }
  const data = (await res.json()) as any[];
  const byToken = new Map<string, any[]>();
  for (const pair of data || []) {
    const addr = pair?.baseToken?.address;
    if (!addr) continue;
    if (!byToken.has(addr)) byToken.set(addr, []);
    byToken.get(addr)!.push(pair);
  }
  const prices: Record<string, number | null> = {};
  byToken.forEach((pairs, addr) => {
    pairs.sort((a, b) => (b?.liquidity?.usd || 0) - (a?.liquidity?.usd || 0));
    const best = pairs[0];
    const price = Number(best?.priceUsd || 0);
    prices[addr] = Number.isFinite(price) && price > 0 ? price : null;
  });
  return prices;
};

const fetchJupiterJson = async (path: string, init?: RequestInit) => {
  let lastError: unknown = null;
  for (const base of JUPITER_BASE_URLS) {
    try {
      const headers = {
        ...(init?.headers || {}),
        ...(JUP_API_KEY ? { 'x-api-key': JUP_API_KEY } : {}),
      };
      const res = await fetch(`${base}${path}`, { ...init, headers });
      const text = await res.text();
      let json: any = null;
      try {
        json = JSON.parse(text);
      } catch {
        json = null;
      }
      if (!res.ok) {
        lastError = new Error(json?.error || text || `Jupiter error ${res.status}`);
        continue;
      }
      return { res, json, text };
    } catch (error) {
      lastError = error;
      continue;
    }
  }
  throw lastError instanceof Error ? lastError : new Error('Jupiter request failed');
};

const buildJupiterSwapTx = async (params: {
  inputMint: string;
  outputMint: string;
  amountRaw: string;
  userPublicKey: string;
  slippageBps: number;
}) => {
  const quoteParams = new URLSearchParams({
    inputMint: params.inputMint,
    outputMint: params.outputMint,
    amount: params.amountRaw,
    slippageBps: String(params.slippageBps),
  });
  const { json: quoteJson } = await fetchJupiterJson(`/quote?${quoteParams.toString()}`);
  if (!quoteJson || quoteJson?.error) {
    throw new Error(quoteJson?.error || 'Jupiter quote failed');
  }

  const { json: swapJson } = await fetchJupiterJson('/swap', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      quoteResponse: quoteJson,
      userPublicKey: params.userPublicKey,
      wrapAndUnwrapSol: true,
      useSharedAccounts: false,
      dynamicComputeUnitLimit: true,
      dynamicSlippage: true,
      prioritizationFeeLamports: {
        priorityLevelWithMaxLamports: {
          priorityLevel: 'veryHigh',
          maxLamports: 1_000_000,
        },
      },
    }),
  });
  if (!swapJson?.swapTransaction) {
    throw new Error(swapJson?.error || 'Jupiter swap failed');
  }
  return { swapTransaction: swapJson.swapTransaction, quote: quoteJson };
};
const joinApiUrl = (base: string, path: string) => `${base.replace(/\/+$/, '')}${path}`;
const fetchJsonWithFallback = async <T,>(
  paths: string[],
  init?: RequestInit
): Promise<{ response: Response; json: T; url: string }> => {
  let lastError: unknown = null;
  for (const path of paths) {
    const url = joinApiUrl(API_BASE, path);
    try {
      const response = await fetch(url, init);
      const raw = await response.text();
      
      // Check if response is HTML (error page)
      const isHtml = raw.trim().startsWith('<');
      if (isHtml) {
        if (response.status === 404) {
          continue; // Try next endpoint
        }
        // For other HTML responses (502, 500, etc.), throw a user-friendly error
        throw new Error(`Server returned HTML (${response.status}). The backend may be starting up — please try again in a moment.`);
      }
      
      // Try to parse JSON
      let json: T;
      try {
        json = JSON.parse(raw) as T;
      } catch (parseError) {
        // If JSON parsing fails, provide context about the response
        const preview = raw.slice(0, 100);
        throw new Error(`Invalid server response (${response.status}): ${preview || 'empty body'}`);
      }
      
      return { response, json, url };
    } catch (error) {
      lastError = error;
      continue;
    }
  }
  throw lastError instanceof Error ? lastError : new Error('All API endpoints failed');
};

type TradeStatus = 'open' | 'closed';
type TradeItem = {
  id: string;
  symbol: string;
  status: TradeStatus;
  fallbackPnlUsd: number;
  amountUsd: number;
  displayAmountUsd: number;
  createdAt: string | null;
  chain: string;
  tokenAddress: string;
  inAmountRaw: string | null;
  outAmountRaw: string | null;
  txSignature: string | null;
  closeTxSignature: string | null;
  closeReason: 'tp' | 'sl' | 'manual' | 'unknown' | 'failed' | null;
  closeTriggerPct: number | null;
  entryPriceUsd: number | null;
  closePriceUsd: number | null;
  closePnlPct: number | null;
  closePnlUsd: number | null;
  closeError: string | null;
  closedAt: string | null;
  livePriceUsd: number | null;
  tpRoi: number;
  stopLossPct: number | null;
};

type Filter = 'all' | 'open' | 'closed' | 'profit' | 'loss';

const toNumber = (value: unknown, fallback = 0) => {
  const num = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(num) ? num : fallback;
};

const normalizeTradeStatus = (status: unknown): TradeStatus => {
  const s = String(status || '').trim().toLowerCase();
  if (s === 'closed' || s === 'cancelled') return 'closed';
  if (s === 'filled' || s === 'completed') return 'open';
  if (s === 'open' || s === 'queued' || s === 'pending' || s === 'processing') return 'open';
  return 'open';
};

const getLivePnl = (trade: TradeItem) => {
  const livePnlPct =
    trade.entryPriceUsd && trade.livePriceUsd && trade.entryPriceUsd > 0
      ? ((trade.livePriceUsd - trade.entryPriceUsd) / trade.entryPriceUsd) * 100
      : null;
  const livePnlUsd =
    livePnlPct !== null
      ? (trade.displayAmountUsd * livePnlPct) / 100
      : trade.fallbackPnlUsd;
  return { livePnlPct, livePnlUsd };
};

const getRealtimePnlPct = (trade: TradeItem) => {
  if (!trade.entryPriceUsd || !trade.livePriceUsd || trade.entryPriceUsd <= 0 || trade.livePriceUsd <= 0) {
    return null;
  }
  return ((trade.livePriceUsd - trade.entryPriceUsd) / trade.entryPriceUsd) * 100;
};

const getDisplayedPnl = (trade: TradeItem) => {
  if (trade.status === 'closed') {
    // Priority 1: stored close PnL values (most accurate)
    if (trade.closePnlPct !== null && trade.closePnlUsd !== null) {
      return { pnlPct: trade.closePnlPct, pnlUsd: trade.closePnlUsd };
    }
    // Priority 2: derive from close price vs entry price
    if (trade.closePriceUsd && trade.entryPriceUsd && trade.entryPriceUsd > 0) {
      const pnlPct = ((trade.closePriceUsd - trade.entryPriceUsd) / trade.entryPriceUsd) * 100;
      const pnlUsd = (trade.displayAmountUsd * pnlPct) / 100;
      return { pnlPct, pnlUsd };
    }
    // Priority 3: stored pct only
    if (trade.closePnlPct !== null) {
      return {
        pnlPct: trade.closePnlPct,
        pnlUsd: trade.closePnlUsd ?? (trade.displayAmountUsd * trade.closePnlPct) / 100,
      };
    }
    // Closed but no price data — show zero, never use live price
    return { pnlPct: null, pnlUsd: 0 };
  }
  // Open trade — use live price
  const { livePnlPct, livePnlUsd } = getLivePnl(trade);
  return { pnlPct: livePnlPct, pnlUsd: livePnlUsd };
};

function TradeCard({
  item,
  solPriceUsd,
  closingId,
  closeTrade,
  markUncloseable,
  openSolscanTx,
}: {
  item: TradeItem;
  solPriceUsd: number | null;
  closingId: string | null;
  closeTrade: (trade: TradeItem) => void;
  markUncloseable: (trade: TradeItem) => void;
  openSolscanTx: (sig: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const { pnlPct, pnlUsd } = getDisplayedPnl(item);
  // Closed trades: show fixed USD PnL — never divide by a live-updating SOL price
  // Open trades: show live SOL PnL
  const pnlSol = item.status === 'open' && solPriceUsd && solPriceUsd > 0
    ? pnlUsd / solPriceUsd
    : null;
  const isWin = item.closeReason === 'tp' || (pnlUsd > 0 && item.status === 'closed');
  const isLoss = item.closeReason === 'sl' || (pnlUsd < 0 && item.status === 'closed');

  return (
    <Pressable style={styles.card} onPress={() => setExpanded((v) => !v)}>
      {/* Collapsed row */}
      <View style={styles.cardTop}>
        <View style={styles.cardTopLeft}>
          <Text style={styles.symbol}>{item.symbol}</Text>
          <Text style={[styles.statusBadge, item.status === 'open' ? styles.statusOpen : styles.statusClosed]}>
            {item.status.toUpperCase()}
          </Text>
        </View>
        <View style={styles.cardTopRight}>
          <Text style={styles.amountText}>${item.displayAmountUsd.toFixed(5)}</Text>
          {item.status === 'closed' ? (
            <View style={styles.pnlStack}>
              <Text style={[styles.pnlText, isWin ? styles.green : styles.red]}>
                {isWin ? '▲' : '▼'} ${Math.abs(pnlUsd).toFixed(6)}
              </Text>
              {solPriceUsd && solPriceUsd > 0 ? (
                <Text style={[styles.pnlSubText, isWin ? styles.green : styles.red]}>
                  {(pnlUsd / solPriceUsd).toFixed(9)} SOL
                </Text>
              ) : null}
            </View>
          ) : pnlSol !== null ? (
            <Text style={[styles.pnlText, pnlSol >= 0 ? styles.green : styles.red]}>
              {pnlSol >= 0 ? '+' : ''}{pnlSol.toFixed(10)} SOL
            </Text>
          ) : null}
        </View>
      </View>

      {/* Expanded detail */}
      {expanded && (
        <View style={styles.expandedWrap}>
          <View style={styles.divider} />
          {item.createdAt ? <Text style={styles.meta}>Created: {new Date(item.createdAt).toLocaleString()}</Text> : null}
          <Text style={styles.meta}>Entry Price: {item.entryPriceUsd ? `$${item.entryPriceUsd.toFixed(9)}` : '--'}</Text>
          {item.status === 'closed' ? (
            <Text style={styles.meta}>Close Price: {item.closePriceUsd ? `$${item.closePriceUsd.toFixed(9)}` : '--'}</Text>
          ) : null}
          <Text style={styles.meta}>Live Price: {item.livePriceUsd ? `$${item.livePriceUsd.toFixed(9)}` : '--'}</Text>
          {item.status === 'closed' ? (
            <>
              {item.closedAt ? <Text style={styles.meta}>Closed: {new Date(item.closedAt).toLocaleString()}</Text> : null}
              <Text style={[styles.meta, isWin ? styles.green : styles.red]}>
                {isWin ? 'Profit' : 'Loss'}: {pnlUsd >= 0 ? '+' : ''}${pnlUsd.toFixed(6)}
                {pnlPct !== null ? ` (${pnlPct >= 0 ? '+' : ''}${pnlPct.toFixed(2)}%)` : ''}
              </Text>
              {item.closeReason ? (
                <Text style={styles.meta}>
                  Closed by {item.closeReason.toUpperCase()}
                  {Number.isFinite(item.closeTriggerPct ?? NaN) ? ` (${(item.closeTriggerPct! > 0 ? '+' : '')}${item.closeTriggerPct!.toFixed(2)}%)` : ''}
                </Text>
              ) : item.closeTxSignature ? (
                <Text style={styles.meta}>Closed by MANUAL</Text>
              ) : null}
            </>
          ) : (
            <>
              {item.entryPriceUsd && item.livePriceUsd ? (
                <Text style={[styles.meta, item.livePriceUsd >= item.entryPriceUsd ? styles.green : styles.red]}>
                  Change: {(((item.livePriceUsd - item.entryPriceUsd) / item.entryPriceUsd) * 100).toFixed(2)}%
                </Text>
              ) : null}
              <Text style={[styles.meta, pnlPct !== null ? (pnlPct >= 0 ? styles.green : styles.red) : null]}>
                PnL %: {pnlPct === null ? '--' : `${pnlPct >= 0 ? '+' : ''}${pnlPct.toFixed(4)}%`}
              </Text>
              <Text style={[styles.meta, pnlSol !== null ? (pnlSol >= 0 ? styles.green : styles.red) : null]}>
                PnL SOL: {pnlSol === null ? '--' : `${pnlSol >= 0 ? '+' : ''}${pnlSol.toFixed(9)} SOL`}
              </Text>
            </>
          )}
          {item.closeError ? (
            <Text style={[styles.meta, styles.red]}>Close failed. Try again or mark uncloseable.</Text>
          ) : null}
          {item.txSignature ? (
            <Pressable onPress={() => openSolscanTx(item.txSignature!)} style={styles.linkBtn}>
              <Text style={styles.linkBtnText}>View Open Tx</Text>
            </Pressable>
          ) : null}
          {item.closeTxSignature ? (
            <Pressable onPress={() => openSolscanTx(item.closeTxSignature!)} style={styles.linkBtn}>
              <Text style={styles.linkBtnText}>View Close Tx</Text>
            </Pressable>
          ) : null}
          {item.status === 'open' && !item.closeTxSignature && item.closeReason !== 'failed' ? (
            <Pressable
              onPress={() => closeTrade(item)}
              disabled={closingId === item.id}
              style={[styles.closeBtn, closingId === item.id && { opacity: 0.6 }]}
            >
              <Text style={styles.closeBtnText}>
                {closingId === item.id ? 'Closing...' : item.closeError ? 'Retry Close' : 'Close Trade'}
              </Text>
            </Pressable>
          ) : null}
          {item.status === 'open' && !item.closeTxSignature && item.closeError && item.closeReason !== 'failed' ? (
            <Pressable onPress={() => markUncloseable(item)} style={styles.closeBtnSecondary}>
              <Text style={styles.closeBtnSecondaryText}>Mark Uncloseable</Text>
            </Pressable>
          ) : null}
        </View>
      )}
    </Pressable>
  );
}

export default function TradesScreen() {
  const { getOrCreateTradingWalletAddress, getEmbeddedSolanaProvider, getOrCreateLocalUserId } =
    useWalletContext();
  const [query, setQuery] = useState('');
  const [showSearch, setShowSearch] = useState(false);
  const [filter, setFilter] = useState<Filter>('all');
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [trades, setTrades] = useState<TradeItem[]>([]);
  const [closingId, setClosingId] = useState<string | null>(null);
  const [solPriceUsd, setSolPriceUsd] = useState<number | null>(null);
  const [lastErrorTime, setLastErrorTime] = useState<number>(0);
  const autoCloseRetryAfterRef = useRef<Record<string, number>>({});
  const lastAutoClosePriceFetchRef = useRef(0);
  const recentlyClosedRef = useRef<Set<string>>(new Set());
  const pageSize = 20;

  const loadTrades = useCallback(async (forceRefresh = false) => {
    try {
      setLoading(true);
      setError(null);
      const resolvedUserId = await getOrCreateLocalUserId();
      if (!resolvedUserId) {
        throw new Error('User session not found. Please restart the app.');
      }
      const { response: res, json } = await fetchJsonWithFallback<{
        orders?: {
          id?: string | number;
          token_symbol?: string;
          chain?: string;
          token_address?: string;
          status?: string;
          amount_usd?: number | string;
          tp_roi?: number | string;
          stop_loss?: number | string | null;
          created_at?: string;
          in_amount_raw?: string | null;
          out_amount_raw?: string | null;
          tx_signature?: string | null;
          close_tx_signature?: string | null;
          close_reason?: string | null;
          close_trigger_pct?: number | string | null;
          price_usd?: number | string | null;
          close_price_usd?: number | string | null;
          close_pnl_pct?: number | string | null;
          close_pnl_usd?: number | string | null;
          closed_at?: string | null;
          close_error?: string | null;
          output_mint?: string | null;
        }[];
        error?: string;
      }>([
        `/api/orders?userId=${encodeURIComponent(resolvedUserId)}&limit=200`,
        `/orders?userId=${encodeURIComponent(resolvedUserId)}&limit=200`,
      ]);
      if (!res.ok) {
        throw new Error(json?.error || `Server error (${res.status}). Please try again.`);
      }
      const sourceOrders = json.orders || [];

      const mapped: TradeItem[] = sourceOrders.map((order) => {
        const amount = toNumber(order.amount_usd, 0);
        const roi = toNumber(order.tp_roi, 0);
        const inAmountLamports = Number(order.in_amount_raw || 0);
        const derivedAmountUsd =
          Number.isFinite(inAmountLamports) && inAmountLamports > 0 && Number.isFinite(solPriceUsd || 0)
            ? (inAmountLamports / 1_000_000_000) * Number(solPriceUsd || 0)
            : 0;
        const displayAmountUsd = amount > 0 ? amount : derivedAmountUsd;
        const entryPrice = toNumber(order.price_usd, 0);
        return {
          id: String(order.id || Math.random()),
          symbol: order.token_symbol || 'TOKEN',
          status: order.close_tx_signature ? 'closed' : normalizeTradeStatus(order.status),
          fallbackPnlUsd: (amount * roi) / 100,
          amountUsd: amount,
          displayAmountUsd,
          createdAt: order.created_at || null,
          chain: order.chain || 'solana',
          inAmountRaw: typeof order.in_amount_raw === 'string' ? order.in_amount_raw : null,
          outAmountRaw: typeof order.out_amount_raw === 'string' ? order.out_amount_raw : null,
          txSignature: typeof order.tx_signature === 'string' ? order.tx_signature : null,
          closeTxSignature: typeof order.close_tx_signature === 'string' ? order.close_tx_signature : null,
          closeReason:
            order.close_reason === 'tp' ||
            order.close_reason === 'sl' ||
            order.close_reason === 'manual' ||
            order.close_reason === 'failed'
              ? order.close_reason
              : order.close_reason
                ? 'unknown'
                : null,
          closeTriggerPct:
            order.close_trigger_pct == null
              ? null
              : (() => {
                  const v = toNumber(order.close_trigger_pct, Number.NaN);
                  return Number.isFinite(v) ? v : null;
                })(),
          tpRoi: roi,
          stopLossPct: (() => {
            const v = toNumber(order.stop_loss, Number.NaN);
            return Number.isFinite(v) ? v : null;
          })(),
          entryPriceUsd: entryPrice > 0 ? entryPrice : null,
          closePriceUsd: (() => {
            const v = toNumber(order.close_price_usd, 0);
            return v > 0 ? v : null;
          })(),
          closePnlPct: (() => {
            const v = toNumber(order.close_pnl_pct, Number.NaN);
            return Number.isFinite(v) ? v : null;
          })(),
          closePnlUsd: (() => {
            const v = toNumber(order.close_pnl_usd, Number.NaN);
            return Number.isFinite(v) ? v : null;
          })(),
          closeError: typeof order.close_error === 'string' ? order.close_error : null,
          closedAt: typeof order.closed_at === 'string' ? order.closed_at : null,
          livePriceUsd: null,
          tokenAddress: order.token_address || order.output_mint || '',
        } as TradeItem;
      });
      setTrades(mapped);
    } catch (err: any) {
      console.log('Failed to load trades:', err);
      const now = Date.now();
      setLastErrorTime(now);
      
      // Provide user-friendly error messages
      let errorMessage = 'Failed to load trades';
      if (err?.message?.includes('Server returned HTML')) {
        errorMessage = 'Backend server is starting up. Please wait a moment and try again.';
      } else if (err?.message?.includes('JSON Parse error')) {
        errorMessage = 'Server error. Please try again in a moment.';
      } else if (err?.message) {
        errorMessage = err.message;
      }
      setError(errorMessage);
    } finally {
      setLoading(false);
    }
  }, [getOrCreateLocalUserId, solPriceUsd]);

  useEffect(() => {
    void loadTrades();
  }, [loadTrades]);

  useFocusEffect(
    useCallback(() => {
      // Only auto-refresh if no recent error (within last 30 seconds)
      const now = Date.now();
      if (now - lastErrorTime > 30000) {
        void loadTrades();
      }
    }, [loadTrades, lastErrorTime])
  );

  useEffect(() => {
    let active = true;
    const refreshSolPrice = async () => {
      try {
        const { response: res, json } = await fetchJsonWithFallback<{ priceUsd?: number }>([
          '/api/solana/price-usd',
          '/solana/price-usd',
        ]);
        if (!res.ok) return;
        if (!active) return;
        const price = Number(json?.priceUsd || 0);
        if (Number.isFinite(price) && price > 0) {
          setSolPriceUsd(price);
        }
      } catch {
        // ignore
      }
    };
    void refreshSolPrice();
    const id = setInterval(refreshSolPrice, 30000);
    return () => {
      active = false;
      clearInterval(id);
    };
  }, []);

  // Live price refresh — stable interval, reads latest trades via ref
  const tradesRef = useRef<TradeItem[]>(trades);
  useEffect(() => { tradesRef.current = trades; }, [trades]);

  useEffect(() => {
    let active = true;
    const refreshLivePrices = async () => {
      try {
        const currentTrades = tradesRef.current;
        const addresses = Array.from(
          new Set(
            currentTrades
              .filter((t) => t.status === 'open' && t.chain === 'solana' && Boolean(t.tokenAddress))
              .map((t) => t.tokenAddress)
          )
        );
        if (!addresses.length) return;
        let prices: Record<string, number | null> | null = null;
        try {
          prices = await fetchDexscreenerPrices(addresses);
        } catch {
          const { response: res, json } = await fetchJsonWithFallback<{ prices?: Record<string, number | null> }>([
            `/api/token-prices?addresses=${encodeURIComponent(addresses.join(','))}`,
            `/token-prices?addresses=${encodeURIComponent(addresses.join(','))}`,
          ]);
          if (!res.ok || !json?.prices) return;
          prices = json.prices || null;
        }
        if (!active || !prices) return;
        setTrades((prev) =>
          prev.map((t) => {
            // Never update live price for closed trades — their PnL is fixed
            if (t.status === 'closed') return t;
            const live = Number(prices?.[t.tokenAddress]);
            return Number.isFinite(live) && live > 0 ? { ...t, livePriceUsd: live } : t;
          })
        );
      } catch {
        // ignore and retry on next tick
      }
    };
    void refreshLivePrices();
    const id = setInterval(refreshLivePrices, 5000);
    return () => {
      active = false;
      clearInterval(id);
    };
  }, []); // stable — no deps, reads trades via ref

  const closeTrade = useCallback(
    async (trade: TradeItem, options?: { silent?: boolean; closeReason?: 'tp' | 'sl' | 'manual'; closeTriggerPct?: number | null }) => {
      const orderId = trade.id;
      if (!orderId) return;
      let resolvedUserId = '';
      try {
        setClosingId(orderId);
        resolvedUserId = await getOrCreateLocalUserId();
        if (!resolvedUserId) throw new Error('User id not found');
        const walletAddress = await getOrCreateTradingWalletAddress();
        if (!walletAddress) throw new Error('Embedded wallet address not found');

        const closeBuildSlippageBps = [300, 800, 1200, 2000, 3000, 5000, 8000, 12000];
        const amountRaw = trade.outAmountRaw;
        if (!amountRaw) {
          throw new Error('Missing token amount for close. Reopen the app to refresh order data.');
        }
        let buildJson: { swapTransaction?: string } | null = null;
        let lastBuildError: string | null = null;
        for (const slippageBps of closeBuildSlippageBps) {
          try {
            const inputMint = trade.tokenAddress;
            if (!inputMint) throw new Error('Missing token address for close transaction.');
            const result = await buildJupiterSwapTx({
              inputMint,
              outputMint: SOL_MINT,
              amountRaw,
              userPublicKey: walletAddress,
              slippageBps,
            });
            buildJson = result;
            break;
          } catch (err: any) {
            lastBuildError = err?.message || `Failed to build close transaction (slippage ${slippageBps})`;
          }
        }
        if (!buildJson?.swapTransaction) {
          throw new Error(lastBuildError || 'Failed to build close transaction');
        }

        const provider = await getEmbeddedSolanaProvider();
        const unsignedTx = VersionedTransaction.deserialize(Uint8Array.from(Buffer.from(buildJson.swapTransaction, 'base64')));
        let signedTx: VersionedTransaction | null = null;

        if (provider && typeof provider.signTransaction === 'function') {
          const signed = await provider.signTransaction({ transaction: unsignedTx });
          if (signed?.signedTransaction?.serialize) {
            signedTx = signed.signedTransaction as VersionedTransaction;
          }
        } else if (provider && typeof provider.request === 'function') {
          const signed = await provider.request({
            method: 'signTransaction',
            params: { transaction: unsignedTx },
          });
          if (signed?.signedTransaction?.serialize) {
            signedTx = signed.signedTransaction as VersionedTransaction;
          }
        }

        if (!signedTx) {
          throw new Error('Embedded wallet could not sign close transaction.');
        }
        const connection = new Connection(SOLANA_MAINNET_RPC, 'confirmed');
        const signature = await connection.sendRawTransaction(signedTx.serialize(), {
          skipPreflight: true,   // skip simulation — avoids stale-quote 0x1788 rejections
          maxRetries: 3,
        });
        await connection.confirmTransaction(signature, 'confirmed');

        const closeReason = options?.closeReason ?? 'manual';
        const closeTriggerPct =
          options?.closeTriggerPct ??
          (closeReason === 'tp'
            ? trade.tpRoi
            : closeReason === 'sl' && trade.stopLossPct !== null
              ? -Math.abs(trade.stopLossPct)
              : null);
        const closePnlPct =
          trade.entryPriceUsd && trade.livePriceUsd
            ? ((trade.livePriceUsd - trade.entryPriceUsd) / trade.entryPriceUsd) * 100
            : null;
        const closePnlUsd = closePnlPct !== null ? (trade.displayAmountUsd * closePnlPct) / 100 : null;
        const { response: res, json } = await fetchJsonWithFallback<{ error?: string; success?: boolean; byId?: boolean; skipped?: boolean }>(
          [`/api/orders/${encodeURIComponent(orderId)}/close`, `/orders/${encodeURIComponent(orderId)}/close`],
          {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              userId: resolvedUserId,
              closeTxSignature: signature,
              closeReason,
              closeTriggerPct,
              closePriceUsd: trade.livePriceUsd ?? null,
              closePnlPct,
              closePnlUsd,
            }),
          }
        );
        if (!res.ok) throw new Error(json?.error || 'Failed to finalize close');
        const closeTxSignature = signature;
        recentlyClosedRef.current.add(orderId);
        // Prune recentlyClosed set to avoid unbounded growth
        if (recentlyClosedRef.current.size > 200) {
          const arr = Array.from(recentlyClosedRef.current);
          recentlyClosedRef.current = new Set(arr.slice(-100));
        }

        setTrades((prev) =>
          prev.map((t) =>
            t.id === orderId
              ? {
                  ...t,
                  status: 'closed',
                  closeTxSignature: closeTxSignature || t.closeTxSignature,
                }
              : t
          )
        );
        delete autoCloseRetryAfterRef.current[orderId];

        // Credit/debit realized PnL into app balance after confirmed on-chain close.
        const { livePnlUsd } = getLivePnl(trade);
        await addBalance(livePnlUsd);
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => undefined);
        if (!options?.silent) {
          const notified = await notifyTradeClosed({ symbol: trade.symbol, pnlUsd: livePnlUsd });
          if (!notified) {
            Alert.alert(
              'Trade Closed',
              `${trade.symbol.toUpperCase()} closed ${livePnlUsd >= 0 ? 'in profit' : 'in loss'} (${livePnlUsd >= 0 ? '+' : ''}$${livePnlUsd.toFixed(4)}).`
            );
          }
        }
      } catch (err: any) {
        const { title, message } = getFriendlyCloseError(err);
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => undefined);
        if (recentlyClosedRef.current.has(orderId) || trade.closeTxSignature) {
          return;
        }
        try {
          if (!resolvedUserId) {
            resolvedUserId = await getOrCreateLocalUserId();
          }
          await fetchJsonWithFallback<{ error?: string }>(
            [`/api/orders/${encodeURIComponent(orderId)}/close`, `/orders/${encodeURIComponent(orderId)}/close`],
            {
              method: 'PATCH',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ userId: resolvedUserId, closeError: message }),
            }
          );
        } catch {
          // ignore close-error persistence
        }
        if (options?.silent) {
          autoCloseRetryAfterRef.current[orderId] = Date.now() + 30_000;
        } else {
          Alert.alert(title, message);
        }
      } finally {
        setClosingId(null);
      }
    },
    [getEmbeddedSolanaProvider, getOrCreateLocalUserId, getOrCreateTradingWalletAddress]
  );

  const markUncloseable = useCallback(
    async (trade: TradeItem) => {
      const orderId = trade.id;
      if (!orderId) return;
      try {
        const resolvedUserId = await getOrCreateLocalUserId();
        if (!resolvedUserId) throw new Error('User id not found');
        const { response: res, json } = await fetchJsonWithFallback<{ error?: string; success?: boolean }>(
          [`/api/orders/${encodeURIComponent(orderId)}/close`, `/orders/${encodeURIComponent(orderId)}/close`],
          {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              userId: resolvedUserId,
              closeReason: 'failed',
              closeError: trade.closeError || 'Marked uncloseable by user',
            }),
          }
        );
        if (!res.ok) throw new Error(json?.error || 'Failed to update order');
        setTrades((prev) =>
          prev.map((t) =>
            t.id === orderId
              ? {
                  ...t,
                  closeReason: 'failed',
                }
              : t
          )
        );
      } catch (err: any) {
        Alert.alert('Update failed', "Couldn't update this trade. Please try again.");
      }
    },
    [getOrCreateLocalUserId]
  );

  useEffect(() => {
    if (closingId) return;
    const now = Date.now();
    const findTargets = (source: TradeItem[]) =>
      source
        .map((trade) => {
          if (trade.status !== 'open') return null;
          // Only skip if closeError AND retry window hasn't expired
          const retryAfter = autoCloseRetryAfterRef.current[trade.id] || 0;
          if (retryAfter > now) return null;
          // If closeError exists but retry window has passed, allow retry
          const pnlPct = getRealtimePnlPct(trade);
          if (pnlPct === null) return null;
          const tpHit = Number.isFinite(trade.tpRoi) && trade.tpRoi > 0 && pnlPct >= trade.tpRoi;
          const slHit =
            trade.stopLossPct !== null &&
            Number.isFinite(trade.stopLossPct) &&
            trade.stopLossPct > 0 &&
            pnlPct <= -Math.abs(trade.stopLossPct);
          if (!tpHit && !slHit) return null;
          return {
            trade,
            closeReason: (tpHit ? 'tp' : 'sl') as 'tp' | 'sl',
            closeTriggerPct: tpHit ? trade.tpRoi : -Math.abs(trade.stopLossPct || 0),
          };
        })
        .filter((item): item is { trade: TradeItem; closeReason: 'tp' | 'sl'; closeTriggerPct: number } => Boolean(item));

    const targets = findTargets(trades);
    if (targets.length) {
      const target = targets[0];
      void closeTrade(target.trade, { silent: true, closeReason: target.closeReason, closeTriggerPct: target.closeTriggerPct });
      return;
    }

    // Refresh live prices for open trades only — skip already-closed ones
    const openAddresses = Array.from(
      new Set(
        trades
          .filter((t) => t.status === 'open' && t.tokenAddress && !recentlyClosedRef.current.has(t.id))
          .map((t) => t.tokenAddress)
      )
    );
    if (!openAddresses.length) return;
    if (now - lastAutoClosePriceFetchRef.current < 5_000) return;
    lastAutoClosePriceFetchRef.current = now;
    void (async () => {
      try {
        let prices: Record<string, number | null> | null = null;
        try {
          prices = await fetchDexscreenerPrices(openAddresses);
        } catch {
          const { response: res, json } = await fetchJsonWithFallback<{ prices?: Record<string, number | null> }>([
            `/api/token-prices?addresses=${encodeURIComponent(openAddresses.join(','))}`,
            `/token-prices?addresses=${encodeURIComponent(openAddresses.join(','))}`,
          ]);
          if (!res.ok || !json?.prices) return;
          prices = json.prices || null;
        }
        if (!prices) return;
        setTrades((prev) =>
          prev.map((t) => {
            // Never update live price for closed trades — their PnL is fixed
            if (t.status === 'closed') return t;
            const live = Number(prices?.[t.tokenAddress]);
            return Number.isFinite(live) && live > 0 ? { ...t, livePriceUsd: live } : t;
          })
        );
      } catch {
        // ignore and retry on next interval/effect run
      }
    })();
  }, [closeTrade, closingId, trades]);

  const filtered = useMemo(() => {
    return trades.filter((trade) => {
      const { livePnlUsd } = getLivePnl(trade);
      if (query && !trade.symbol.toLowerCase().includes(query.toLowerCase())) return false;
      if (filter === 'open' && trade.status !== 'open') return false;
      if (filter === 'closed' && trade.status !== 'closed') return false;
      if ((filter as string) === 'profit') {
        return trade.status === 'closed' && trade.closeReason === 'tp';
      }
      if ((filter as string) === 'loss') {
        return trade.status === 'closed' && trade.closeReason === 'sl';
      }
      if (filter === 'profit' && livePnlUsd <= 0) return false;
      if (filter === 'loss' && livePnlUsd >= 0) return false;
      return true;
    });
  }, [filter, query, trades]);

  const totals = useMemo(() => {
    let totalProfit = 0;
    let totalLoss = 0;
    for (const trade of trades) {
      if (trade.status !== 'closed') continue;
      const { pnlUsd } = getDisplayedPnl(trade);
      if (pnlUsd > 0) totalProfit += pnlUsd;
      if (pnlUsd < 0) totalLoss += Math.abs(pnlUsd);
    }
    return { totalProfit, totalLoss };
  }, [trades]);

  const summary = useMemo(() => {
    const closed = trades.filter((t) => t.status === 'closed');
    const wins = closed.filter((t) => t.closeReason === 'tp').length;
    const losses = closed.filter((t) => t.closeReason === 'sl').length;
    const winRate = wins + losses > 0 ? Math.round((wins / (wins + losses)) * 100) : 0;
    // totalPnlUsd is fixed for closed trades — don't convert to SOL (SOL price fluctuates)
    const totalPnlUsd = closed.reduce((acc, t) => acc + getDisplayedPnl(t).pnlUsd, 0);
    return { totalTrades: trades.length, winRate, totalPnlUsd };
  }, [trades]);

  const paged = filtered.slice(0, page * pageSize);
  const hasMore = paged.length < filtered.length;
  const openSolscanTx = useCallback(async (signature: string) => {
    const url = `https://solscan.io/tx/${encodeURIComponent(signature)}`;
    const canOpen = await Linking.canOpenURL(url);
    if (canOpen) {
      await Linking.openURL(url);
    }
  }, []);

  return (
    <SafeAreaView style={styles.root}>
      <View style={styles.headerRow}>
        <Text style={styles.title}>Trades</Text>
        <View style={styles.headerActions}>
          {/* <Pressable onPress={() => setShowSearch(v => !v)} style={styles.iconBtn}>
            <MaterialIcons name={showSearch ? 'search-off' : 'search'} size={20} color="#fff" />
          </Pressable> */}
          <Pressable onPress={() => void loadTrades(true)} style={styles.refreshBtn}>
            <Text style={styles.refreshText}>Refresh</Text>
          </Pressable>
        </View>
      </View>

      <View style={styles.summaryRow}>
        {[
          {
            label: 'Total PnL',
            value: `${summary.totalPnlUsd >= 0 ? '+' : ''}$${Math.abs(summary.totalPnlUsd).toFixed(6)}`,
            tone: summary.totalPnlUsd >= 0 ? 'positive' : 'negative',
            flex: 2,
          },
          { label: 'Win Rate', value: `${summary.winRate}%`, tone: 'neutral', flex: 1 },
          { label: 'Trades', value: String(summary.totalTrades), tone: 'neutral', flex: 0.6 },
        ].map((item) => (
          <View key={item.label} style={[styles.summaryCard, { flex: item.flex }]}>
            <Text style={styles.summaryLabel}>{item.label}</Text>
            <Text style={[
              styles.summaryValue,
              item.tone === 'positive' && styles.summaryPositive,
              item.tone === 'negative' && styles.summaryNegative,
            ]}>
              {item.value}
            </Text>
          </View>
        ))}
      </View>

      {showSearch && (
        <TextInput
          value={query}
          onChangeText={(text) => {
            setQuery(text);
            setPage(1);
          }}
          placeholder="Search by token"
          placeholderTextColor="#7f8cae"
          style={styles.search}
          autoFocus
        />
      )}

      <View style={styles.filterRow}>
        {(['all', 'open', 'closed', 'profit', 'loss'] as Filter[]).map((item) => (
          <Pressable
            key={item}
            onPress={() => setFilter(item)}
            style={[styles.filterChip, filter === item && styles.filterChipActive]}
          >
            <Text style={[styles.filterText, filter === item && styles.filterTextActive]}>
              {item.toUpperCase()}
            </Text>
          </Pressable>
        ))}
      </View>
    {filter === 'profit' ? (
      <View style={styles.totalsRow}>
        <Text style={styles.meta}>Total Profit: ${totals.totalProfit.toFixed(6)}</Text>
      </View>
    ) : null}
    {filter === 'loss' ? (
      <View style={styles.totalsRow}>
        <Text style={styles.meta}>Total Loss: ${totals.totalLoss.toFixed(6)}</Text>
      </View>
    ) : null}

      {loading ? (
        <View style={styles.centerState}>
          <ActivityIndicator />
          <Text style={styles.muted}>Loading trades...</Text>
        </View>
      ) : error ? (
        <View style={styles.centerState}>
          <Text style={styles.error}>{error}</Text>
          <Pressable 
            onPress={() => void loadTrades(true)} 
            style={styles.retryButton}
          >
            <Text style={styles.retryButtonText}>Retry</Text>
          </Pressable>
        </View>
      ) : (
        <FlatList
          data={paged}
          keyExtractor={(item) => item.id}
          renderItem={({ item }) => (
            <TradeCard
              item={item}
              solPriceUsd={solPriceUsd}
              closingId={closingId}
              closeTrade={(t) => void closeTrade(t)}
              markUncloseable={(t) => void markUncloseable(t)}
              openSolscanTx={(sig) => void openSolscanTx(sig)}
            />
          )}
          contentContainerStyle={styles.listContent}
          onEndReached={() => {
            if (hasMore) setPage((p) => p + 1);
          }}
          onEndReachedThreshold={0.2}
          ListEmptyComponent={<Text style={styles.muted}>No trades found.</Text>}
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#05070f', padding: 16 },
  headerRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 },
  headerActions: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  title: { color: '#fff', fontSize: 24, fontWeight: '800' },
  summaryRow: { flexDirection: 'row', gap: 6, marginBottom: 8 },
  summaryCard: {
    flex: 1,
    minWidth: 0,
    borderRadius: 14,
    paddingVertical: 8,
    paddingHorizontal: 8,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.14)',
    backgroundColor: 'rgba(255,255,255,0.06)',
  },
  summaryLabel: { color: '#8794b4', fontSize: 9, fontWeight: '800' },
  summaryValue: { marginTop: 5, color: '#f4f7ff', fontSize: 12, fontWeight: '800' },
  summaryPositive: { color: '#4ade80' },
  summaryNegative: { color: '#ef4444' },
  refreshBtn: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.18)',
    backgroundColor: 'rgba(255,255,255,0.06)',
  },
  iconBtn: {
    width: 36,
    height: 36,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.18)',
    backgroundColor: 'rgba(255,255,255,0.06)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  refreshText: { color: '#fff', fontWeight: '700', fontSize: 12 },
  search: {
    height: 42,
    borderRadius: 12,
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.14)',
    color: '#fff',
    paddingHorizontal: 12,
  },
  filterRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 12, marginBottom: 10 },
  totalsRow: { marginBottom: 12 },
  filterChip: {
    paddingVertical: 8,
    paddingHorizontal: 10,
    borderRadius: 10,
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
  },
  filterChipActive: { backgroundColor: 'rgba(111,173,255,0.22)', borderColor: 'rgba(111,173,255,0.6)' },
  filterText: { color: '#b8c6e8', fontSize: 11, fontWeight: '700' },
  filterTextActive: { color: '#fff' },
  centerState: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 8 },
  muted: { color: '#9db0db' },
  error: { color: '#ff8a8a', textAlign: 'center', paddingHorizontal: 20, marginBottom: 16 },
  retryButton: {
    backgroundColor: '#007AFF',
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 8,
    marginTop: 8,
  },
  retryButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  listContent: { paddingBottom: 110, gap: 10 },
  card: {
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.14)',
    borderRadius: 14,
    padding: 12,
  },
  cardTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  cardTopLeft: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  cardTopRight: { alignItems: 'flex-end', gap: 2 },
  symbol: { color: '#fff', fontWeight: '800', fontSize: 16 },
  statusBadge: { fontSize: 10, fontWeight: '700', paddingHorizontal: 7, paddingVertical: 3, borderRadius: 999 },
  statusOpen: { backgroundColor: 'rgba(74,222,128,0.15)', color: '#4ade80' },
  statusClosed: { backgroundColor: 'rgba(255,255,255,0.08)', color: '#9db0db' },
  amountText: { color: '#fff', fontSize: 13, fontWeight: '600' },
  pnlText: { fontSize: 12, fontWeight: '700' },
  pnlStack: { alignItems: 'flex-end', gap: 1 },
  pnlSubText: { fontSize: 10, fontWeight: '500', opacity: 0.7 },
  expandedWrap: { marginTop: 10 },
  divider: { height: 1, backgroundColor: 'rgba(255,255,255,0.08)', marginBottom: 8 },
  meta: { color: '#9db0db', marginTop: 4, fontSize: 12 },
  pnl: { marginTop: 8, fontWeight: '700' },
  green: { color: '#4ade80' },
  red: { color: '#ff6b81' },
  closeBtn: {
    marginTop: 10,
    borderRadius: 10,
    paddingVertical: 8,
    borderWidth: 1,
    borderColor: 'rgba(255,120,120,0.6)',
    backgroundColor: 'rgba(255,70,70,0.15)',
  },
  closeBtnText: {
    color: '#ffd0d0',
    textAlign: 'center',
    fontSize: 12,
    fontWeight: '700',
  },
  closeBtnSecondary: {
    marginTop: 8,
    borderRadius: 10,
    paddingVertical: 8,
    borderWidth: 1,
    borderColor: 'rgba(255,120,120,0.6)',
    backgroundColor: 'transparent',
  },
  closeBtnSecondaryText: {
    color: '#ffb3b3',
    textAlign: 'center',
    fontSize: 12,
    fontWeight: '700',
  },
  linkBtn: {
    marginTop: 8,
    borderRadius: 10,
    paddingVertical: 8,
    borderWidth: 1,
    borderColor: 'rgba(111,173,255,0.6)',
    backgroundColor: 'rgba(111,173,255,0.14)',
  },
  linkBtnText: {
    color: '#d6e7ff',
    textAlign: 'center',
    fontSize: 12,
    fontWeight: '700',
  },
});
