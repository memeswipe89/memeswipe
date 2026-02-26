import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useEmbeddedSolanaWallet } from '@privy-io/expo';
import { Buffer } from 'buffer';
import { Connection, VersionedTransaction } from '@solana/web3.js';
import * as Linking from 'expo-linking';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import { useWalletContext } from '@/contexts/wallet-context';
import { addBalance } from '@/lib/devWallet';

const API_BASE = process.env.EXPO_PUBLIC_API_BASE || 'https://memeswipe.onrender.com';
const LOCAL_USER_ID_KEY = '@memeswipe:userId:v1';
const SOLANA_MAINNET_RPC = 'https://api.mainnet-beta.solana.com';
const SOL_MINT = 'So11111111111111111111111111111111111111112';
const FORCE_CLOSE_ON_SWAP_FAILURE = false;
const CLOSE_SLIPPAGE_RETRY_BPS = [1200, 2500, 4000, 5000];
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
  entryPriceUsd: number | null;
  livePriceUsd: number | null;
};

type Filter = 'all' | 'open' | 'closed' | 'profit' | 'loss';

const toNumber = (value: unknown, fallback = 0) => {
  const num = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(num) ? num : fallback;
};

const normalizeTradeStatus = (status: unknown): TradeStatus => {
  const s = String(status || '').trim().toLowerCase();
  if (s === 'closed' || s === 'cancelled' || s === 'filled' || s === 'completed') return 'closed';
  if (s === 'open' || s === 'queued' || s === 'pending' || s === 'processing') return 'open';
  return 'open';
};

const getLivePnl = (trade: TradeItem) => {
  const livePnlPct =
    trade.entryPriceUsd && trade.livePriceUsd
      ? ((trade.livePriceUsd - trade.entryPriceUsd) / trade.entryPriceUsd) * 100
      : null;
  const livePnlUsd =
    livePnlPct !== null ? (trade.displayAmountUsd * livePnlPct) / 100 : trade.fallbackPnlUsd;
  return { livePnlPct, livePnlUsd };
};

export default function TradesScreen() {
  const { getOrCreateEmbeddedWalletAddress } = useWalletContext();
  const embeddedSolanaWallet = useEmbeddedSolanaWallet();
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [trades, setTrades] = useState<TradeItem[]>([]);
  const [userId, setUserId] = useState<string>('');
  const [closingId, setClosingId] = useState<string | null>(null);
  const [solPriceUsd, setSolPriceUsd] = useState<number | null>(null);
  const pageSize = 20;

  useEffect(() => {
    void (async () => {
      const stored = await AsyncStorage.getItem(LOCAL_USER_ID_KEY);
      if (stored) setUserId(stored);
    })();
  }, []);

  const loadTrades = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const resolvedUserId = userId || (await AsyncStorage.getItem(LOCAL_USER_ID_KEY)) || '';
      if (!resolvedUserId) {
        throw new Error('User id not found');
      }
      const res = await fetch(
        `${API_BASE}/api/orders?userId=${encodeURIComponent(resolvedUserId)}&limit=200`
      );
      const json = await parseApiJson<{
        orders?: {
          id?: string | number;
          token_symbol?: string;
          chain?: string;
          token_address?: string;
          status?: string;
          amount_usd?: number | string;
          tp_roi?: number | string;
          created_at?: string;
          in_amount_raw?: string | null;
          out_amount_raw?: string | null;
          tx_signature?: string | null;
          close_tx_signature?: string | null;
          price_usd?: number | string | null;
        }[];
        error?: string;
      }>(res);
      if (!res.ok) {
        throw new Error(json?.error || 'Failed to load trades');
      }
      let sourceOrders = json.orders || [];
      if (!sourceOrders.length) {
        const fallbackRes = await fetch(`${API_BASE}/api/orders?limit=200`);
        const fallbackJson = await parseApiJson<{
          orders?: {
            id?: string | number;
            token_symbol?: string;
            chain?: string;
            token_address?: string;
            status?: string;
            amount_usd?: number | string;
            tp_roi?: number | string;
            created_at?: string;
            in_amount_raw?: string | null;
            out_amount_raw?: string | null;
            tx_signature?: string | null;
            close_tx_signature?: string | null;
            price_usd?: number | string | null;
          }[];
        }>(fallbackRes);
        if (fallbackRes.ok && Array.isArray(fallbackJson.orders)) {
          sourceOrders = fallbackJson.orders;
        }
      }

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
          status: normalizeTradeStatus(order.status),
          fallbackPnlUsd: (amount * roi) / 100,
          amountUsd: amount,
          displayAmountUsd,
          createdAt: order.created_at || null,
          chain: order.chain || 'solana',
          tokenAddress: order.token_address || '',
          inAmountRaw: typeof order.in_amount_raw === 'string' ? order.in_amount_raw : null,
          outAmountRaw: typeof order.out_amount_raw === 'string' ? order.out_amount_raw : null,
          txSignature: typeof order.tx_signature === 'string' ? order.tx_signature : null,
          closeTxSignature: typeof order.close_tx_signature === 'string' ? order.close_tx_signature : null,
          entryPriceUsd: entryPrice > 0 ? entryPrice : null,
          livePriceUsd: null,
        };
      });
      setTrades(mapped);
    } catch (err: any) {
      setError(err?.message || 'Failed to load trades');
    } finally {
      setLoading(false);
    }
  }, [solPriceUsd, userId]);

  useEffect(() => {
    void loadTrades();
  }, [loadTrades]);

  useFocusEffect(
    useCallback(() => {
      void loadTrades();
    }, [loadTrades])
  );

  useEffect(() => {
    let active = true;
    const refreshSolPrice = async () => {
      try {
        const res = await fetch(`${API_BASE}/api/solana/price-usd`);
        const json = await parseApiJson<{ priceUsd?: number }>(res);
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
        const res = await fetch(
          `${API_BASE}/api/token-prices?addresses=${encodeURIComponent(addresses.join(','))}`
        );
        const json = await parseApiJson<{ prices?: Record<string, number | null> }>(res);
        if (!active || !json?.prices) return;
        setTrades((prev) =>
          prev.map((t) => {
            const live = Number(json.prices?.[t.tokenAddress]);
            return Number.isFinite(live) && live > 0 ? { ...t, livePriceUsd: live } : t;
          })
        );
      } catch {
        // ignore
      }
    };
    void refreshLivePrices();
    const id = setInterval(refreshLivePrices, 15000);
    return () => {
      active = false;
      clearInterval(id);
    };
  }, [trades]);

  const closeTrade = useCallback(
    async (trade: TradeItem) => {
      const orderId = trade.id;
      if (!orderId) return;
      try {
        setClosingId(orderId);
        const resolvedUserId = userId || (await AsyncStorage.getItem(LOCAL_USER_ID_KEY)) || '';
        if (!resolvedUserId) throw new Error('User id not found');

        // Attempt real close swap first for Solana trades when we have the raw token amount.
        let closeTxSignature: string | null = null;
        if (trade.chain === 'solana' && trade.status === 'open' && trade.tokenAddress) {
          try {
            const walletAddress = await getOrCreateEmbeddedWalletAddress();
            let provider: any = null;
            if ('wallets' in embeddedSolanaWallet && Array.isArray(embeddedSolanaWallet.wallets) && embeddedSolanaWallet.wallets.length > 0) {
              provider = await embeddedSolanaWallet.wallets[0].getProvider();
            } else if ('create' in embeddedSolanaWallet && typeof embeddedSolanaWallet.create === 'function') {
              provider = await embeddedSolanaWallet.create();
            }
            if (!provider || typeof provider.request !== 'function') {
              throw new Error('Embedded wallet provider unavailable for closing trade');
            }

            const connection = new Connection(SOLANA_MAINNET_RPC, 'confirmed');

            // Use the actual wallet token balance for this mint.
            const balRes = await fetch(SOLANA_MAINNET_RPC, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                jsonrpc: '2.0',
                id: 1,
                method: 'getTokenAccountsByOwner',
                params: [
                  walletAddress,
                  { mint: trade.tokenAddress },
                  { encoding: 'jsonParsed' },
                ],
              }),
            });
            const balJson = await parseApiJson<{
              result?: { value?: { account?: { data?: { parsed?: { info?: { tokenAmount?: { amount?: string } } } } } }[] };
            }>(balRes);
            const tokenLamports = (balJson?.result?.value || []).reduce((sum, item) => {
              const raw = Number(item?.account?.data?.parsed?.info?.tokenAmount?.amount || 0);
              return sum + (Number.isFinite(raw) ? raw : 0);
            }, 0);
            if (!Number.isFinite(tokenLamports) || tokenLamports <= 0) {
              throw new Error('No token balance available to close on-chain.');
            }
            const closeAmountRaw = String(Math.floor(tokenLamports * 0.995));
            if (Number(closeAmountRaw) <= 0) {
              throw new Error('Token balance too small to close on-chain.');
            }

            let lastCloseError: any = null;
            for (const slippageBps of CLOSE_SLIPPAGE_RETRY_BPS) {
              try {
                const swapRes = await fetch(`${API_BASE}/api/jupiter/swap`, {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({
                    userPublicKey: walletAddress,
                    inputMint: trade.tokenAddress,
                    outputMint: SOL_MINT,
                    amountRaw: closeAmountRaw,
                    slippageBps,
                  }),
                });
                const swapJson = await parseApiJson<{ error?: string; swapTransaction?: string }>(swapRes);
                if (!swapRes.ok || !swapJson?.swapTransaction) {
                  throw new Error(swapJson?.error || 'Failed to build close swap');
                }

                const tx = VersionedTransaction.deserialize(Buffer.from(swapJson.swapTransaction, 'base64'));
                const signed = (await provider.request({
                  method: 'signAndSendTransaction',
                  params: {
                    transaction: tx,
                    connection,
                    options: { skipPreflight: false, maxRetries: 3 },
                  },
                })) as { signature?: string };
                if (!signed?.signature) {
                  throw new Error('No close transaction signature returned');
                }
                closeTxSignature = signed.signature;
                await connection.confirmTransaction(closeTxSignature, 'confirmed');
                break;
              } catch (e: any) {
                lastCloseError = e;
                continue;
              }
            }

            if (!closeTxSignature) {
              throw lastCloseError || new Error('Close swap failed for all retry attempts');
            }
          } catch (swapError: any) {
            console.log('[TRADES][CLOSE] on-chain close swap failed', {
              orderId,
              tokenAddress: trade.tokenAddress,
              message: swapError?.message || String(swapError),
            });
            if (!FORCE_CLOSE_ON_SWAP_FAILURE) {
              throw swapError;
            }
            // Emergency mode: allow closing the DB trade even if swap fails.
          }
        } else if (trade.status === 'open') {
          throw new Error('Trade cannot be closed on-chain: missing token chain/address.');
        }

        const res = await fetch(`${API_BASE}/api/orders/${encodeURIComponent(orderId)}/close`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ userId: resolvedUserId, closeTxSignature }),
        });
        const json = await parseApiJson<{ error?: string }>(res);
        if (!res.ok) throw new Error(json?.error || 'Failed to close trade');

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

        // Credit/debit realized PnL into app balance after confirmed on-chain close.
        const { livePnlUsd } = getLivePnl(trade);
        await addBalance(livePnlUsd);
      } catch (err: any) {
        setError(err?.message || 'Failed to close trade');
      } finally {
        setClosingId(null);
      }
    },
    [embeddedSolanaWallet, getOrCreateEmbeddedWalletAddress, userId]
  );

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
        <Pressable onPress={() => void loadTrades()} style={styles.refreshBtn}>
          <Text style={styles.refreshText}>Refresh</Text>
        </Pressable>
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
                const { livePnlPct, livePnlUsd } = getLivePnl(item);
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
              <Text style={styles.meta}>
                Live Price: {item.livePriceUsd ? `$${item.livePriceUsd.toFixed(9)}` : '--'}
              </Text>
              {item.entryPriceUsd && item.livePriceUsd ? (
                <Text style={[styles.meta, item.livePriceUsd >= item.entryPriceUsd ? styles.green : styles.red]}>
                  Change: {(((item.livePriceUsd - item.entryPriceUsd) / item.entryPriceUsd) * 100).toFixed(2)}%
                </Text>
              ) : null}
              <Text style={[styles.pnl, livePnlUsd >= 0 ? styles.green : styles.red]}>
                {livePnlUsd >= 0 ? '+' : ''}
                {livePnlUsd.toFixed(6)} USDT
              </Text>
              <Text style={[styles.meta, livePnlPct !== null ? (livePnlPct >= 0 ? styles.green : styles.red) : null]}>
                PnL %: {livePnlPct === null ? '--' : `${livePnlPct >= 0 ? '+' : ''}${livePnlPct.toFixed(2)}%`}
              </Text>
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
              {item.status === 'open' ? (
                <Pressable
                  onPress={() => void closeTrade(item)}
                  disabled={closingId === item.id}
                  style={[styles.closeBtn, closingId === item.id && { opacity: 0.6 }]}
                >
                  <Text style={styles.closeBtnText}>{closingId === item.id ? 'Closing...' : 'Close Trade'}</Text>
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
