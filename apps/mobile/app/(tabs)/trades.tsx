import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Alert, FlatList, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
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
      const isHtml404 = response.status === 404 && raw.trim().startsWith('<');
      if (isHtml404) continue;
      const json = JSON.parse(raw) as T;
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
    trade.entryPriceUsd && trade.livePriceUsd
      ? ((trade.livePriceUsd - trade.entryPriceUsd) / trade.entryPriceUsd) * 100
      : trade.tpRoi > 0
        ? trade.tpRoi
        : null;
  const livePnlUsd =
    livePnlPct !== null ? (trade.displayAmountUsd * livePnlPct) / 100 : trade.fallbackPnlUsd;
  return { livePnlPct, livePnlUsd };
};

const getRealtimePnlPct = (trade: TradeItem) => {
  if (!trade.entryPriceUsd || !trade.livePriceUsd || trade.entryPriceUsd <= 0 || trade.livePriceUsd <= 0) {
    return null;
  }
  return ((trade.livePriceUsd - trade.entryPriceUsd) / trade.entryPriceUsd) * 100;
};

const getDisplayedPnl = (trade: TradeItem) => {
  if (trade.status === 'closed' && trade.closePnlPct !== null) {
    return {
      pnlPct: trade.closePnlPct,
      pnlUsd: trade.closePnlUsd ?? (trade.displayAmountUsd * trade.closePnlPct) / 100,
    };
  }
  const { livePnlPct, livePnlUsd } = getLivePnl(trade);
  return { pnlPct: livePnlPct, pnlUsd: livePnlUsd };
};

export default function TradesScreen() {
  const { twitterProfile } = useWalletContext();
  const { getOrCreateTradingWalletAddress, getEmbeddedSolanaProvider, getOrCreateLocalUserId } = useWalletContext();
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [trades, setTrades] = useState<TradeItem[]>([]);
  const [closingId, setClosingId] = useState<string | null>(null);
  const [solPriceUsd, setSolPriceUsd] = useState<number | null>(null);
  const autoCloseRetryAfterRef = useRef<Record<string, number>>({});
  const lastAutoClosePriceFetchRef = useRef(0);
  const recentlyClosedRef = useRef<Set<string>>(new Set());
  const pageSize = 20;

  const loadTrades = useCallback(async () => {
    try {
      if (!twitterProfile) {
        setTrades([]);
        setError(null);
        setLoading(false);
        return;
      }
      setLoading(true);
      setError(null);
      const resolvedUserId = await getOrCreateLocalUserId();
      if (!resolvedUserId) {
        throw new Error('User id not found');
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
        throw new Error(json?.error || 'Failed to load trades');
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
      setError(err?.message || 'Failed to load trades');
    } finally {
      setLoading(false);
    }
  }, [getOrCreateLocalUserId, solPriceUsd, twitterProfile]);

  useEffect(() => {
    if (!twitterProfile) {
      setLoading(false);
      return;
    }
    void loadTrades();
  }, [loadTrades, twitterProfile]);

  useFocusEffect(
    useCallback(() => {
      if (!twitterProfile) return;
      void loadTrades();
    }, [loadTrades, twitterProfile])
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

  useEffect(() => {
    let active = true;
    const refreshLivePrices = async () => {
      try {
        const addresses = Array.from(
          new Set(
            trades
              .filter((t) => t.chain === 'solana' && Boolean(t.tokenAddress))
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
            const live = Number(prices?.[t.tokenAddress]);
            return Number.isFinite(live) && live > 0 ? { ...t, livePriceUsd: live } : t;
          })
        );
      } catch {
        // ignore
      }
    };
    void refreshLivePrices();
    const id = setInterval(refreshLivePrices, 5000);
    return () => {
      active = false;
      clearInterval(id);
    };
  }, [trades]);

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
          skipPreflight: false,
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
        console.log('[TRADES] finalize close payload', {
          orderId,
          closeReason,
          closeTriggerPct,
          closePriceUsd: trade.livePriceUsd ?? null,
          closePnlPct,
          closePnlUsd,
        });
        const { response: res, json, url } = await fetchJsonWithFallback<{ error?: string; success?: boolean; byId?: boolean; skipped?: boolean }>(
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
        console.log('[TRADES] finalize close response', { orderId, url, status: res.status, body: json });
        if (!res.ok) throw new Error(json?.error || 'Failed to finalize close');
        const closeTxSignature = signature;
        recentlyClosedRef.current.add(orderId);

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
        const message = err?.message || 'Failed to close trade';
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => undefined);
        if (recentlyClosedRef.current.has(orderId) || trade.closeTxSignature) {
          return;
        }
        try {
          if (!resolvedUserId) {
            resolvedUserId = await getOrCreateLocalUserId();
          }
          const { response: fallbackRes, json: fallbackJson, url } = await fetchJsonWithFallback<{
            error?: string;
            success?: boolean;
            byId?: boolean;
            skipped?: boolean;
          }>(
            [`/api/orders/${encodeURIComponent(orderId)}/close`, `/orders/${encodeURIComponent(orderId)}/close`],
            {
              method: 'PATCH',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                userId: resolvedUserId,
                closeError: message,
              }),
            }
          );
          console.log('[TRADES] close error saved', {
            orderId,
            url,
            status: fallbackRes.status,
            body: fallbackJson,
          });
        } catch {
          // ignore close-error persistence
        }
        if (options?.silent) {
          autoCloseRetryAfterRef.current[orderId] = Date.now() + 30_000;
        } else {
          Alert.alert('Close Trade Failed', message);
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
        Alert.alert('Update Failed', err?.message || 'Failed to mark as uncloseable');
      }
    },
    [getOrCreateLocalUserId]
  );

  useEffect(() => {
    if (!twitterProfile || closingId) return;
    const now = Date.now();
    const findTargets = (source: TradeItem[]) =>
      source
        .map((trade) => {
          if (trade.status !== 'open') return null;
          if (trade.closeError) return null;
          const retryAfter = autoCloseRetryAfterRef.current[trade.id] || 0;
          if (retryAfter > now) return null;
          const pnlPct = getRealtimePnlPct(trade);
          if (pnlPct === null) return null;
          const tpHit = Number.isFinite(trade.tpRoi) && pnlPct >= trade.tpRoi;
          const slHit =
            trade.stopLossPct !== null && Number.isFinite(trade.stopLossPct) && pnlPct <= -Math.abs(trade.stopLossPct);
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

    // If live prices are missing, refresh them on-demand so TP/SL can trigger reliably.
    const openAddresses = Array.from(new Set(trades.filter((t) => t.status === 'open' && t.tokenAddress).map((t) => t.tokenAddress)));
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
            const live = Number(prices?.[t.tokenAddress]);
            return Number.isFinite(live) && live > 0 ? { ...t, livePriceUsd: live } : t;
          })
        );
      } catch {
        // ignore and retry on next interval/effect run
      }
    })();
  }, [closeTrade, closingId, trades, twitterProfile]);

  const filtered = useMemo(() => {
    return trades.filter((trade) => {
      const { livePnlUsd } = getLivePnl(trade);
      if (query && !trade.symbol.toLowerCase().includes(query.toLowerCase())) return false;
      if (filter === 'open' && trade.status !== 'open') return false;
      if (filter === 'closed' && trade.status !== 'closed') return false;
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
      const pnl = trade.closePnlUsd ?? 0;
      if (trade.closeReason === 'tp') {
        totalProfit += Math.max(0, pnl);
      } else if (trade.closeReason === 'sl') {
        totalLoss += Math.max(0, Math.abs(pnl || 0));
      } else {
        if (pnl > 0) totalProfit += pnl;
        if (pnl < 0) totalLoss += Math.abs(pnl);
      }
    }
    return { totalProfit, totalLoss };
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

  if (!twitterProfile) {
    return (
      <SafeAreaView style={styles.root}>
        <View style={styles.centerState}>
          <Text style={styles.muted}>Connect Twitter first to view your trades.</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.root}>
      <View style={styles.headerRow}>
        <Text style={styles.title}>Trades</Text>
        <View style={styles.headerActions}>
          <Pressable onPress={() => void loadTrades()} style={styles.refreshBtn}>
            <Text style={styles.refreshText}>Refresh</Text>
          </Pressable>
        </View>
      </View>

      <TextInput
        value={query}
        onChangeText={(text) => {
          setQuery(text);
          setPage(1);
        }}
        placeholder="Search by token"
        placeholderTextColor="#7f8cae"
        style={styles.search}
      />

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
        </View>
      ) : (
        <FlatList
          data={paged}
          keyExtractor={(item) => item.id}
          renderItem={({ item }) => (
            <View style={styles.card}>
              {(() => {
                const { pnlPct, pnlUsd } = getDisplayedPnl(item);
                const pnlSol = solPriceUsd && solPriceUsd > 0 ? pnlUsd / solPriceUsd : null;
                return (
                  <>
              <View style={styles.cardTop}>
                <Text style={styles.symbol}>{item.symbol}</Text>
                <Text style={styles.status}>{item.status}</Text>
              </View>
              <Text style={styles.meta}>Amount: ${item.displayAmountUsd.toFixed(6)}</Text>
              {item.createdAt ? <Text style={styles.meta}>Created: {new Date(item.createdAt).toLocaleString()}</Text> : null}
              <Text style={styles.meta}>
                Entry Price: {item.entryPriceUsd ? `$${item.entryPriceUsd.toFixed(9)}` : '--'}
              </Text>
              {item.status === 'closed' ? (
                <Text style={styles.meta}>
                  Close Price: {item.closePriceUsd ? `$${item.closePriceUsd.toFixed(9)}` : '--'}
                </Text>
              ) : null}
              <Text style={styles.meta}>
                Live Price: {item.livePriceUsd ? `$${item.livePriceUsd.toFixed(9)}` : '--'}
              </Text>
              {item.status === 'closed' ? (
                <>
                  {item.closedAt ? (
                    <Text style={styles.meta}>Closed: {new Date(item.closedAt).toLocaleString()}</Text>
                  ) : null}
                  <Text style={[styles.meta, pnlSol !== null ? (pnlSol >= 0 ? styles.green : styles.red) : null]}>
                    {item.closeReason === 'tp' ? 'Win SOL' : 'Loss SOL'}:{' '}
                    {pnlSol === null ? '--' : `${pnlSol >= 0 ? '+' : ''}${pnlSol.toFixed(9)} SOL`}
                  </Text>
                </>
              ) : (
                <>
                  {item.entryPriceUsd && item.livePriceUsd ? (
                    <Text style={[styles.meta, item.livePriceUsd >= item.entryPriceUsd ? styles.green : styles.red]}>
                      Change: {(((item.livePriceUsd - item.entryPriceUsd) / item.entryPriceUsd) * 100).toFixed(2)}%
                    </Text>
                  ) : null}
                  <Text style={[styles.pnl, pnlUsd >= 0 ? styles.green : styles.red]}>
                    {pnlUsd >= 0 ? '+' : ''}
                    {pnlUsd.toFixed(6)} USDT
                  </Text>
                  <Text style={[styles.meta, pnlPct !== null ? (pnlPct >= 0 ? styles.green : styles.red) : null]}>
                    PnL %: {pnlPct === null ? '--' : `${pnlPct >= 0 ? '+' : ''}${pnlPct.toFixed(4)}%`}
                  </Text>
                  <Text style={[styles.meta, pnlSol !== null ? (pnlSol >= 0 ? styles.green : styles.red) : null]}>
                    PnL SOL: {pnlSol === null ? '--' : `${pnlSol >= 0 ? '+' : ''}${pnlSol.toFixed(9)} SOL`}
                  </Text>
                </>
              )}
              {item.status === 'closed' && item.closeReason ? (
                <Text style={styles.meta}>
                  CLOSED BY {item.closeReason.toUpperCase()}
                  {Number.isFinite(item.closeTriggerPct || Number.NaN)
                    ? ` (${(item.closeTriggerPct as number) > 0 ? '+' : ''}${(item.closeTriggerPct as number).toFixed(2)}%)`
                    : ''}
                </Text>
              ) : null}
              {item.status === 'closed' && !item.closeReason && item.closeTxSignature ? (
                <Text style={styles.meta}>Closed by MANUAL</Text>
              ) : null}
              {item.closeError ? (
                <Text style={[styles.meta, styles.red]}>
                  Close failed. Try again later or mark as uncloseable.
                </Text>
              ) : null}
              {item.txSignature ? (
                <Pressable onPress={() => void openSolscanTx(item.txSignature as string)} style={styles.linkBtn}>
                  <Text style={styles.linkBtnText}>View Open Tx</Text>
                </Pressable>
              ) : null}
              {item.closeTxSignature ? (
                <Pressable onPress={() => void openSolscanTx(item.closeTxSignature as string)} style={styles.linkBtn}>
                  <Text style={styles.linkBtnText}>View Close Tx</Text>
                </Pressable>
              ) : null}
              {item.status === 'open' && !item.closeTxSignature && item.closeReason !== 'failed' ? (
                <Pressable
                  onPress={() => void closeTrade(item)}
                  disabled={closingId === item.id}
                  style={[styles.closeBtn, closingId === item.id && { opacity: 0.6 }]}
                >
                  <Text style={styles.closeBtnText}>
                    {closingId === item.id ? 'Closing...' : item.closeError ? 'Retry Close' : 'Close Trade'}
                  </Text>
                </Pressable>
              ) : null}
              {item.status === 'open' && !item.closeTxSignature && item.closeError && item.closeReason !== 'failed' ? (
                <Pressable onPress={() => void markUncloseable(item)} style={styles.closeBtnSecondary}>
                  <Text style={styles.closeBtnSecondaryText}>Mark Uncloseable</Text>
                </Pressable>
              ) : null}
                  </>
                );
              })()}
            </View>
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
  refreshBtn: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.18)',
    backgroundColor: 'rgba(255,255,255,0.06)',
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
  error: { color: '#ff8a8a' },
  listContent: { paddingBottom: 40, gap: 10 },
  card: {
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.14)',
    borderRadius: 14,
    padding: 12,
  },
  cardTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  symbol: { color: '#fff', fontWeight: '800', fontSize: 16 },
  status: { color: '#9db0db', textTransform: 'uppercase', fontSize: 11, fontWeight: '700' },
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
