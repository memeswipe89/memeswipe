import { LinearGradient as ExpoLinearGradient } from 'expo-linear-gradient';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { Image } from 'expo-image';
import { useCallback, useMemo, useState } from 'react';
import { useFocusEffect } from '@react-navigation/native';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { useTradeSettings } from '@/contexts/trade-settings-context';
import { useWalletContext } from '@/contexts/wallet-context';
import { API_BASE } from '@/lib/api-base';

const SOLANA_MAINNET_RPC = 'https://api.mainnet-beta.solana.com';
const MIN_TRADE_AMOUNT_USD = 0.0001;
const MIN_SOL_RESERVE_FOR_FEES = 0.01;
const lamportsToSol = (lamports: number) => lamports / 1_000_000_000;

export default function TabTwoScreen() {
  const { twitterProfile, getOrCreateLocalUserId, tradingWalletAddress } = useWalletContext();
  const { activeChain, tradeAmount } = useTradeSettings();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [orders, setOrders] = useState<any[]>([]);
  const [solPriceUsd, setSolPriceUsd] = useState<number | null>(null);
  const [walletSolBalance, setWalletSolBalance] = useState<number | null>(null);
  const [swapBudgetLoading, setSwapBudgetLoading] = useState(false);

  const loadOrders = useCallback(async () => {
    if (!twitterProfile) {
      setOrders([]);
      setError(null);
      return;
    }
    try {
      setLoading(true);
      setError(null);
      const userId = await getOrCreateLocalUserId();
      const res = await fetch(`${API_BASE}/api/orders?userId=${encodeURIComponent(userId)}&limit=200`);
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error || 'Failed to load orders');
      setOrders(Array.isArray(json?.orders) ? json.orders : []);
    } catch (err: any) {
      setError(err?.message || 'Failed to load orders');
      setOrders([]);
    } finally {
      setLoading(false);
    }
  }, [API_BASE, getOrCreateLocalUserId, twitterProfile]);

  const loadSolPrice = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/api/solana/price-usd`);
      const json = await res.json();
      const price = Number(json?.priceUsd || 0);
      if (Number.isFinite(price) && price > 0) {
        setSolPriceUsd(price);
      }
    } catch {
      // ignore
    }
  }, [API_BASE]);

  const refreshSwapBudget = useCallback(async () => {
    if (!tradingWalletAddress || activeChain !== 'solana') {
      setWalletSolBalance(null);
      return;
    }
    try {
      setSwapBudgetLoading(true);
      const res = await fetch(SOLANA_MAINNET_RPC, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'getBalance',
          params: [tradingWalletAddress],
        }),
      });
      const json = (await res.json()) as { result?: { value?: number } };
      const lamports = Number(json?.result?.value || 0);
      setWalletSolBalance(Number.isFinite(lamports) ? lamportsToSol(lamports) : 0);
    } catch (error) {
      console.log('[SWAP_BUDGET] refresh failed', error);
    } finally {
      setSwapBudgetLoading(false);
    }
  }, [activeChain, tradingWalletAddress]);

  useFocusEffect(
    useCallback(() => {
      void loadOrders();
      void loadSolPrice();
      void refreshSwapBudget();
    }, [loadOrders, loadSolPrice, refreshSwapBudget])
  );

  const toNumber = (value: any, fallback = 0) => {
    const num = Number(value);
    return Number.isFinite(num) ? num : fallback;
  };

  const metrics = useMemo(() => {
    const closed = orders.filter((o) => o?.close_tx_signature || o?.close_reason === 'tp' || o?.close_reason === 'sl');
    const totalTrades = orders.length;
    const wins = closed.filter((o) => o?.close_reason === 'tp').length;
    const losses = closed.filter((o) => o?.close_reason === 'sl').length;
    const winRate = wins + losses > 0 ? Math.round((wins / (wins + losses)) * 100) : 0;

    let totalPnlUsd = 0;
    closed.forEach((o) => {
      const pnlUsd = toNumber(o?.close_pnl_usd, 0);
      totalPnlUsd += pnlUsd;
    });
    const totalPnlSol = solPriceUsd ? totalPnlUsd / solPriceUsd : 0;

    return {
      totalTrades,
      winRate,
      totalPnlSol,
      recentWins: closed
        .filter((o) => o?.close_reason === 'tp')
        .sort((a, b) => String(b?.closed_at || '').localeCompare(String(a?.closed_at || '')))
        .slice(0, 3),
    };
  }, [orders, solPriceUsd]);

  const estimatedSwapInputSol = useMemo(() => {
    if (!solPriceUsd || solPriceUsd <= 0) return null;
    return Math.max(MIN_TRADE_AMOUNT_USD, tradeAmount) / solPriceUsd;
  }, [solPriceUsd, tradeAmount]);

  const estimatedRequiredSol = useMemo(() => {
    if (estimatedSwapInputSol === null) return null;
    return estimatedSwapInputSol + MIN_SOL_RESERVE_FOR_FEES;
  }, [estimatedSwapInputSol]);

  const swapShortfallSol = useMemo(() => {
    if (walletSolBalance === null || estimatedRequiredSol === null) return null;
    return Math.max(0, estimatedRequiredSol - walletSolBalance);
  }, [estimatedRequiredSol, walletSolBalance]);

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
      <View style={styles.hero}>
        <ExpoLinearGradient colors={['#121a32', '#0b0f1a']} style={StyleSheet.absoluteFillObject} />
        <View style={styles.heroOrbCyan} />
        <View style={styles.heroOrbLime} />
        <View style={styles.heroOrbAmber} />
        <View style={styles.heroBadge}>
          <Image source={require('@/assets/images/icon.png')} style={styles.heroBadgeImage} contentFit="contain" />
        </View>
        <ThemedText type="title" style={styles.heroTitle}>Dashboard</ThemedText>
        <ThemedText style={styles.heroSubtitle}>Your meme portfolio at a glance.</ThemedText>
      </View>

      <View style={styles.summaryRow}>
        {[
          { label: 'Total PnL', value: `${metrics.totalPnlSol >= 0 ? '+' : ''}${metrics.totalPnlSol.toFixed(4)} SOL`, tone: 'positive' },
          { label: 'Win Rate', value: `${metrics.winRate}%`, tone: 'neutral' },
          { label: 'Trades', value: String(metrics.totalTrades), tone: 'neutral' },
        ].map((item) => (
          <View key={item.label} style={styles.summaryCard}>
            <ThemedText style={styles.summaryLabel}>{item.label}</ThemedText>
            <ThemedText style={[styles.summaryValue, item.tone === 'positive' && styles.positive]}>
              {item.value}
            </ThemedText>
          </View>
        ))}
      </View>

      {activeChain === 'solana' ? (
        <View style={styles.swapBudgetRow}>
          <Text style={styles.swapBudgetText}>
            Wallet: {walletSolBalance === null ? '--' : `${walletSolBalance.toFixed(6)} SOL`} | Est need:{' '}
            {estimatedRequiredSol === null ? '--' : `${estimatedRequiredSol.toFixed(6)} SOL`}
          </Text>
          <Text
            style={[
              styles.swapBudgetStatus,
              swapShortfallSol && swapShortfallSol > 0 ? styles.swapBudgetBad : styles.swapBudgetGood,
            ]}
          >
            {swapBudgetLoading
              ? 'Checking...'
              : swapShortfallSol && swapShortfallSol > 0
                ? `Short ${swapShortfallSol.toFixed(6)} SOL`
                : 'Sufficient'}
          </Text>
        </View>
      ) : null}

      <ThemedView style={styles.sectionHeader}>
        <ThemedText type="defaultSemiBold" style={styles.sectionTitle}>Recent wins</ThemedText>
        <ThemedText style={styles.sectionHint}>Quick read of your best exits</ThemedText>
      </ThemedView>
      <View style={styles.listWrap}>
        {loading ? (
          <ThemedText style={styles.sectionHint}>Loading dashboard...</ThemedText>
        ) : error ? (
          <ThemedText style={styles.sectionHint}>{error}</ThemedText>
        ) : metrics.recentWins.length === 0 ? (
          <ThemedText style={styles.sectionHint}>No wins yet.</ThemedText>
        ) : (
          metrics.recentWins.map((item) => {
            const pnlUsd = toNumber(item?.close_pnl_usd, 0);
            const pnlSol = solPriceUsd ? pnlUsd / solPriceUsd : 0;
            return (
              <View key={String(item?.id || Math.random())} style={styles.listCard}>
                <View>
                  <ThemedText style={styles.listName}>{item?.token_symbol || 'TOKEN'}</ThemedText>
                  <ThemedText style={styles.listMeta}>{String(item?.closed_at || '').slice(0, 10)}</ThemedText>
                </View>
                <ThemedText style={styles.listPnl}>
                  +{pnlSol.toFixed(4)} SOL
                </ThemedText>
              </View>
            );
          })
        )}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: '#07090f',
  },
  content: {
    padding: 16,
    paddingBottom: 28,
  },
  hero: {
    borderRadius: 20,
    padding: 18,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: 'rgba(120,140,190,0.2)',
    marginTop: 50,
    marginBottom: 16,
  },
  heroOrbCyan: {
    position: 'absolute',
    right: -30,
    top: -20,
    width: 120,
    height: 120,
    borderRadius: 60,
    backgroundColor: 'rgba(77,214,255,0.3)',
  },
  heroOrbLime: {
    position: 'absolute',
    left: -20,
    bottom: -30,
    width: 140,
    height: 140,
    borderRadius: 70,
    backgroundColor: 'rgba(183,244,107,0.2)',
  },
  heroOrbAmber: {
    position: 'absolute',
    right: 30,
    bottom: 10,
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: 'rgba(255,180,84,0.28)',
  },
  heroTitle: {
    fontSize: 26,
    fontWeight: '800',
    color: '#f4f7ff',
  },
  heroBadge: {
    width: 44,
    height: 44,
    borderRadius: 16,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: 'rgba(120,140,190,0.35)',
    backgroundColor: '#0b0f1a',
    marginBottom: 8,
  },
  heroBadgeImage: {
    width: '100%',
    height: '100%',
  },
  heroSubtitle: {
    marginTop: 6,
    color: '#9aa6c4',
    fontSize: 12,
  },
  summaryRow: {
    flexDirection: 'row',
    gap: 10,
    marginBottom: 18,
  },
  summaryCard: {
    flex: 1,
    borderRadius: 16,
    padding: 12,
    borderWidth: 1,
    borderColor: 'rgba(120,140,190,0.2)',
    backgroundColor: '#0c111f',
  },
  summaryLabel: {
    color: '#8794b4',
    fontSize: 11,
  },
  summaryValue: {
    marginTop: 8,
    color: '#f4f7ff',
    fontSize: 16,
    fontWeight: '700',
  },
  positive: {
    color: '#9bf28b',
  },
  swapBudgetRow: {
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(120,140,190,0.3)',
    backgroundColor: '#0b0f1a',
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 8,
    marginBottom: 8,
    flexWrap: 'wrap',
  },
  swapBudgetText: {
    color: '#99a9cd',
    fontSize: 11,
    fontWeight: '600',
    flex: 1,
    minWidth: 0,
    flexWrap: 'wrap',
  },
  swapBudgetStatus: {
    fontSize: 11,
    fontWeight: '700',
    flexShrink: 0,
  },
  swapBudgetGood: {
    color: '#4ade80',
  },
  swapBudgetBad: {
    color: '#ff8a8a',
  },
  sectionHeader: {
    gap: 4,
    marginBottom: 8,
    marginTop: 12,
  },
  sectionTitle: {
    color: '#f4f7ff',
    fontSize: 16,
  },
  sectionHint: {
    color: '#7f8dad',
    fontSize: 11,
  },
  listWrap: {
    gap: 10,
  },
  listCard: {
    borderRadius: 14,
    borderWidth: 1,
    borderColor: 'rgba(120,140,190,0.2)',
    backgroundColor: '#0c111f',
    padding: 12,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  listName: {
    color: '#f4f7ff',
    fontWeight: '700',
  },
  listMeta: {
    color: '#7f8dad',
    fontSize: 11,
    marginTop: 4,
  },
  listPnl: {
    color: '#9bf28b',
    fontWeight: '700',
  },
});
