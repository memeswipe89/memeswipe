import { LinearGradient as ExpoLinearGradient } from 'expo-linear-gradient';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { Image } from 'expo-image';
import { useCallback, useMemo, useState } from 'react';
import { useFocusEffect } from '@react-navigation/native';
import Svg, { Defs, LinearGradient as SvgLinearGradient, Line, Path, Stop } from 'react-native-svg';
import { area, curveBasis, line } from 'd3-shape';

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
  const chartHeight = 190;
  const chartPadding = 12;
  const [chartWidth, setChartWidth] = useState(0);
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

    const dayBuckets = new Map<string, { profit: number; loss: number }>();
    const days: string[] = [];
    for (let i = 6; i >= 0; i -= 1) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const key = d.toISOString().slice(0, 10);
      dayBuckets.set(key, { profit: 0, loss: 0 });
      days.push(key);
    }
    closed.forEach((o) => {
      const closedAt = typeof o?.closed_at === 'string' ? o.closed_at : null;
      if (!closedAt) return;
      const key = new Date(closedAt).toISOString().slice(0, 10);
      const bucket = dayBuckets.get(key);
      if (!bucket) return;
      const pnl = toNumber(o?.close_pnl_usd, 0);
      if (o?.close_reason === 'tp') bucket.profit += Math.max(0, pnl);
      if (o?.close_reason === 'sl') bucket.loss += Math.abs(Math.min(0, pnl));
    });

    const profitSeries = days.map((k) => dayBuckets.get(k)?.profit || 0);
    const lossSeries = days.map((k) => dayBuckets.get(k)?.loss || 0);

    return {
      totalTrades,
      winRate,
      totalPnlSol,
      profitSeries,
      lossSeries,
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

  const combinedSeries = metrics.profitSeries.map((value, index) => value - (metrics.lossSeries[index] || 0));
  const hasSeries = combinedSeries.some((value) => Math.abs(value) > 0.00001);
  const cumulativeSeries = combinedSeries.reduce<number[]>((acc, value) => {
    const prev = acc.length ? acc[acc.length - 1] : 0;
    acc.push(prev + value);
    return acc;
  }, []);
  const minSeries = Math.min(...cumulativeSeries, hasSeries ? 0 : -1);
  const maxSeries = Math.max(...cumulativeSeries, hasSeries ? 1 : 1);
  const yScale = (value: number) => {
    const range = chartHeight - chartPadding * 2;
    const min = Math.min(minSeries, maxSeries - 1);
    const max = Math.max(maxSeries, minSeries + 1);
    return chartPadding + ((max - value) / (max - min)) * range;
  };
  const xScale = (index: number) => {
    if (combinedSeries.length <= 1) return chartPadding;
    const usable = chartWidth - chartPadding * 2;
    return chartPadding + (usable * index) / (combinedSeries.length - 1);
  };

  const linePath = useMemo(() => {
    if (!chartWidth) return '';
    if (!hasSeries) {
      const midY = chartPadding + (chartHeight - chartPadding * 2) / 2;
      return `M ${chartPadding} ${midY} L ${chartWidth - chartPadding} ${midY}`;
    }
    return (
      line<number>()
        .x((_, index) => xScale(index))
        .y((value) => yScale(value))
        .curve(curveBasis)(cumulativeSeries) || ''
    );
  }, [chartWidth, cumulativeSeries, minSeries, maxSeries, hasSeries]);

  const areaPath = useMemo(() => {
    if (!chartWidth) return '';
    if (!hasSeries) return '';
    return (
      area<number>()
        .x((_, index) => xScale(index))
        .y0(chartHeight - chartPadding)
        .y1((value) => yScale(value))
        .curve(curveBasis)(cumulativeSeries) || ''
    );
  }, [chartWidth, cumulativeSeries, minSeries, maxSeries, chartHeight, chartPadding, hasSeries]);

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
        <ThemedText type="defaultSemiBold" style={styles.sectionTitle}>PnL chart</ThemedText>
        <ThemedText style={styles.sectionHint}>Last 7 sessions</ThemedText>
      </ThemedView>
      <View style={styles.chartCard} onLayout={(event) => setChartWidth(event.nativeEvent.layout.width)}>
        <View style={styles.chartGrid} />
        {chartWidth > 0 ? (
          <Svg width={chartWidth} height={chartHeight}>
            <Defs>
              <SvgLinearGradient id="pnlFill" x1="0" y1="0" x2="0" y2="1">
                <Stop offset="0%" stopColor="#6ee7ff" stopOpacity="0.35" />
                <Stop offset="75%" stopColor="#1c2333" stopOpacity="0.05" />
                <Stop offset="100%" stopColor="#101625" stopOpacity="0.01" />
              </SvgLinearGradient>
              <SvgLinearGradient id="pnlStroke" x1="0" y1="0" x2="1" y2="0">
                <Stop offset="0%" stopColor="#6ee7ff" />
                <Stop offset="100%" stopColor="#a4ff8c" />
              </SvgLinearGradient>
            </Defs>
            {[0.2, 0.5, 0.8].map((t) => (
              <Line
                key={t}
                x1={chartPadding}
                y1={chartPadding + (chartHeight - chartPadding * 2) * t}
                x2={chartWidth - chartPadding}
                y2={chartPadding + (chartHeight - chartPadding * 2) * t}
                stroke="rgba(120,140,190,0.16)"
                strokeWidth={1}
              />
            ))}
            <Path d={areaPath} fill="url(#pnlFill)" />
            <Path d={linePath} stroke="url(#pnlStroke)" strokeWidth={3} fill="none" />
          </Svg>
        ) : null}
        <View style={styles.chartLegend}>
          <View style={styles.legendDot} />
          <ThemedText style={styles.legendText}>Cumulative PnL (USD)</ThemedText>
        </View>
      </View>

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
  },
  swapBudgetText: {
    color: '#99a9cd',
    fontSize: 11,
    fontWeight: '600',
  },
  swapBudgetStatus: {
    fontSize: 11,
    fontWeight: '700',
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
  chartCard: {
    borderRadius: 18,
    borderWidth: 1,
    borderColor: 'rgba(120,140,190,0.2)',
    backgroundColor: '#0c111f',
    padding: 12,
    marginBottom: 16,
    minHeight: 240,
  },
  chartGrid: {
    ...StyleSheet.absoluteFillObject,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: 'rgba(120,140,190,0.08)',
  },
  chartLegend: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 8,
  },
  legendDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#7bffb4',
  },
  legendText: {
    fontSize: 11,
    color: '#9aa6c4',
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
