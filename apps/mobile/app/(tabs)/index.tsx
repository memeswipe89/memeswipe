import AsyncStorage from '@react-native-async-storage/async-storage';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import * as Haptics from 'expo-haptics';
import { BlurView } from 'expo-blur';
import { LinearGradient } from 'expo-linear-gradient';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaView } from 'react-native-safe-area-context';

import { AppLoader } from '@/components/app-loader';
import { FeedSegmentedControl, type FeedSegment } from '@/components/feed-segmented-control';
import { ProfileButton } from '@/components/profile/profile-button';
import { ProfileSheet, type ProfileSheetRef } from '@/components/profile/profile-sheet';
import { SwipeHint } from '@/components/swipe-hint-overlay';
import { SwipeTokenDeck, type SwipeToken } from '@/components/swipe-token-deck';
import { useTradeSettings } from '@/contexts/trade-settings-context';
import { addBalance, deductBalance, getBalance as getDevBalance, resetBalance } from '@/lib/devWallet';

const API_BASE = 'https://memeswipe.onrender.com';
const TEST_USER_ID = '11111111-1111-1111-1111-111111111111';
const FAVORITES_KEY = '@memeswipe:favorites:v1';
const HIDDEN_TOKENS_KEY = '@memeswipe:hidden-tokens:v1';
const LAST_AMOUNT_KEY = '@memeswipe:lastAmount';
const LAST_ROI_KEY = '@memeswipe:lastROI';
const PAGE_LIMIT = 50;
const LOW_DECK_THRESHOLD = 5;
const MAX_EMPTY_FETCH_ATTEMPTS = 3;
type FavoriteToken = {
  address: string;
  name: string;
  symbol: string;
  chain: string;
};
type RemoteSegment = Exclude<FeedSegment, 'favorites'>;

type ApiToken = {
  name?: string;
  symbol?: string;
  address?: string;
  tokenAddress?: string;
  mint?: string;
  baseToken?: { address?: string };
  priceUsd?: number | string;
  liquidityUsd?: number | string;
  volume24hUsd?: number | string;
  marketCapUsd?: number | string;
  change24hPct?: number | string;
  chartData?: number[];
  chain?: string;
  graduatedAt?: string;
  graduationTime?: string;
};

const toNumber = (value: unknown, fallback = 0) => {
  const num = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(num) ? num : fallback;
};

const getTokenAddress = (token: ApiToken) =>
  token.address || token.tokenAddress || token.mint || token.baseToken?.address || '';

const buildFallbackChart = (priceUsd: number) => {
  const base = priceUsd || Math.random() * 0.02 + 0.002;
  return [base * 0.96, base * 1.02, base, base * 1.08, base * 1.04, base * 1.12];
};

const generateMockTokens = (offset = 0): SwipeToken[] =>
  Array.from({ length: 30 }, (_, i) => {
    const idx = offset + i + 1;
    return {
      name: `Demo Coin ${idx}`,
      symbol: `DC${idx}`,
      address: `DEMO${idx}`,
      priceUsd: Math.random() * 0.001,
      liquidityUsd: Math.random() * 50000,
      volume24hUsd: Math.random() * 900000,
      marketCapUsd: Math.random() * 3000000,
      change24hPct: (Math.random() - 0.5) * 30,
      chartData: buildFallbackChart(Math.random() * 0.001 + 0.00001).slice(-20),
      graduationTime: new Date().toISOString(),
    };
  });

const mapApiToken = (token: ApiToken): SwipeToken => {
  const price = toNumber(token.priceUsd, 0);
  const chart =
    Array.isArray(token.chartData) && token.chartData.length > 1
      ? token.chartData.map((n) => toNumber(n, price || 1)).slice(-20)
      : buildFallbackChart(price);

  return {
    name: token.name || 'Unknown Token',
    symbol: token.symbol || 'MEME',
    address: getTokenAddress(token),
    priceUsd: price,
    liquidityUsd: toNumber(token.liquidityUsd, 0),
    volume24hUsd: toNumber(token.volume24hUsd, 0),
    marketCapUsd: toNumber(token.marketCapUsd, 0),
    change24hPct: toNumber(token.change24hPct, 0),
    chartData: chart,
    graduationTime: token.graduationTime || token.graduatedAt || 'Live now',
  };
};

const mergeLiveUpdate = (prev: SwipeToken, incoming: SwipeToken): SwipeToken => {
  const history = [...prev.chartData, incoming.priceUsd].slice(-20);

  const changed =
    prev.priceUsd !== incoming.priceUsd ||
    prev.liquidityUsd !== incoming.liquidityUsd ||
    prev.volume24hUsd !== incoming.volume24hUsd ||
    prev.marketCapUsd !== incoming.marketCapUsd ||
    prev.change24hPct !== incoming.change24hPct;

  if (!changed && history.length === prev.chartData.length && history.every((v, i) => v === prev.chartData[i])) {
    return prev;
  }

  return {
    ...prev,
    priceUsd: incoming.priceUsd,
    liquidityUsd: incoming.liquidityUsd,
    volume24hUsd: incoming.volume24hUsd,
    marketCapUsd: incoming.marketCapUsd,
    change24hPct: incoming.change24hPct,
    chartData: history,
  };
};

const makeSegmentMap = <T,>(factory: () => T): Record<RemoteSegment, T> => ({
  trending: factory(),
  stalker: factory(),
  bigcap: factory(),
  smart: factory(),
});

const isRemoteSegment = (segment: FeedSegment): segment is RemoteSegment => segment !== 'favorites';

const endpointFor = (chain: 'solana' | 'base', segment: RemoteSegment) => {
  if (segment === 'stalker') return `/api/feed/${chain}/stalker`;
  if (segment === 'bigcap') return `/api/feed/${chain}/bigcap`;
  if (segment === 'smart') return `/api/feed/${chain}/smart`;
  return `/api/feed/${chain}/graduated`;
};

export default function HomeScreen() {
  const profileSheetRef = useRef<ProfileSheetRef>(null);
  const [loading, setLoading] = useState(false);
  const [creatingOrder, setCreatingOrder] = useState(false);
  const [tokens, setTokens] = useState<SwipeToken[]>([]);
  const [appLoading, setAppLoading] = useState(true);
  const [showSwipeHint, setShowSwipeHint] = useState(true);
  const [segment, setSegment] = useState<FeedSegment>('trending');
  const [favoriteAddresses, setFavoriteAddresses] = useState<Set<string>>(new Set());
  const [favoriteTokens, setFavoriteTokens] = useState<FavoriteToken[]>([]);
  const [hiddenTokenAddresses, setHiddenTokenAddresses] = useState<Set<string>>(new Set());
  const [segmentCache, setSegmentCache] = useState<Record<RemoteSegment, SwipeToken[]>>(
    makeSegmentMap(() => [])
  );
  const [segmentCursor, setSegmentCursor] = useState<Record<RemoteSegment, string | null>>(
    makeSegmentMap(() => null)
  );
  const [segmentHasMore, setSegmentHasMore] = useState<Record<RemoteSegment, boolean>>(
    makeSegmentMap(() => true)
  );
  const [segmentLoadingMore, setSegmentLoadingMore] = useState<Record<RemoteSegment, boolean>>(
    makeSegmentMap(() => false)
  );
  const [segmentDepleted, setSegmentDepleted] = useState<Record<RemoteSegment, boolean>>(
    makeSegmentMap(() => false)
  );
  const [isFallback, setIsFallback] = useState(false);
  const [isSwiping, setIsSwiping] = useState(false);
  const [balance, setBalanceState] = useState(0);
  const { activeChain, profileName, tradeAmount, tpROI, stopLoss, setTradeAmount, setTpROI } = useTradeSettings();
  const loadedAddressRef = useRef<Record<RemoteSegment, Set<string>>>(makeSegmentMap(() => new Set<string>()));
  const mockOffsetRef = useRef(0);
  const lastFeedFetchRef = useRef(0);
  const blockedUntilRef = useRef(0);
  const retryDelayRef = useRef(10000);

  const canFetchFeed = useCallback(() => {
    const now = Date.now();
    if (now < blockedUntilRef.current) return false;
    if (now - lastFeedFetchRef.current < 5000) return false;
    lastFeedFetchRef.current = now;
    return true;
  }, []);

  const onFeedSuccess = useCallback(() => {
    retryDelayRef.current = 10000;
  }, []);

  const onFeedError = useCallback((status?: number) => {
    if (status === 401) {
      blockedUntilRef.current = Date.now() + 60000;
      retryDelayRef.current = 60000;
      return;
    }
    retryDelayRef.current = Math.min(retryDelayRef.current * 2, 60000);
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => setAppLoading(false), 1600);
    return () => clearTimeout(timer);
  }, []);

  useEffect(() => {
    const hideTimer = setTimeout(() => setShowSwipeHint(false), 5000);
    return () => clearTimeout(hideTimer);
  }, []);

  useEffect(() => {
    getDevBalance().then(setBalanceState).catch(() => setBalanceState(1000));
  }, []);

  useEffect(() => {
    let mounted = true;
    const hydrateLastInputs = async () => {
      try {
        const [amountRaw, roiRaw] = await Promise.all([
          AsyncStorage.getItem(LAST_AMOUNT_KEY),
          AsyncStorage.getItem(LAST_ROI_KEY),
        ]);
        if (!mounted) return;
        const amount = Number(amountRaw);
        const roi = Number(roiRaw);
        if (Number.isFinite(amount) && amount > 0) setTradeAmount(amount);
        if (Number.isFinite(roi) && roi > 0) setTpROI(roi);
      } catch (err) {
        console.log('failed to load last input values', err);
      }
    };
    hydrateLastInputs();
    return () => {
      mounted = false;
    };
  }, [setTpROI, setTradeAmount]);

  useEffect(() => {
    void AsyncStorage.setItem(LAST_AMOUNT_KEY, String(Math.max(1, tradeAmount)));
  }, [tradeAmount]);

  useEffect(() => {
    void AsyncStorage.setItem(LAST_ROI_KEY, String(Math.max(1, tpROI)));
  }, [tpROI]);

  useEffect(() => {
    let active = true;
    const hydrateLocalState = async () => {
      try {
        const [favoritesRaw, hiddenRaw] = await Promise.all([
          AsyncStorage.getItem(FAVORITES_KEY),
          AsyncStorage.getItem(HIDDEN_TOKENS_KEY),
        ]);
        if (!active) return;

        if (favoritesRaw) {
          const parsed = JSON.parse(favoritesRaw) as (string | FavoriteToken)[];
          const normalized: FavoriteToken[] = parsed
          .map((item) => {
            if (typeof item === 'string') {
              return {
                address: item,
                name: item.slice(0, 6),
                symbol: 'FAV',
                chain: 'solana',
              };
            }
            if (!item?.address || !item?.symbol) return null;
            return {
              address: item.address,
              name: item.name || item.symbol,
              symbol: item.symbol,
              chain: item.chain || 'solana',
            };
          })
          .filter((item): item is FavoriteToken => Boolean(item));
          setFavoriteTokens(normalized);
          setFavoriteAddresses(new Set(normalized.map((f) => f.address)));
        }

        if (hiddenRaw) {
          const parsedHidden = JSON.parse(hiddenRaw) as string[];
          setHiddenTokenAddresses(new Set(parsedHidden));
        }
      } catch (err) {
        console.log('Failed to load local state', err);
      }
    };
    hydrateLocalState();
    return () => {
      active = false;
    };
  }, []);

  const fetchNextPage = useCallback(
    async (segmentType: RemoteSegment, initial = false) => {
      if (segmentLoadingMore[segmentType]) return [];
      if (!segmentHasMore[segmentType] && !initial) return [];
      if (!canFetchFeed()) {
        if (initial && segmentCache[segmentType].length === 0) {
          const mock = generateMockTokens(mockOffsetRef.current);
          mockOffsetRef.current += mock.length;
          console.log("⚠️ Using fallback demo tokens");
          setIsFallback(true);
          setSegmentCache((prev) => ({
            ...prev,
            [segmentType]: [...prev[segmentType], ...mock],
          }));
          return mock;
        }
        return [];
      }

      setSegmentLoadingMore((prev) => ({ ...prev, [segmentType]: true }));
      if (initial) setLoading(true);

      try {
        const chain = activeChain === 'base' ? 'base' : 'solana';
        const endpoint = endpointFor(chain, segmentType);
        const cursor = segmentCursor[segmentType];
        const q = cursor
          ? `?limit=${PAGE_LIMIT}&cursor=${encodeURIComponent(cursor)}`
          : `?limit=${PAGE_LIMIT}`;

        const res = await fetch(`${API_BASE}${endpoint}${q}`);
        if (!res.ok) {
          onFeedError(res.status);
          const mock = generateMockTokens(mockOffsetRef.current);
          mockOffsetRef.current += mock.length;
          console.log("⚠️ Using fallback demo tokens");
          setIsFallback(true);
          setSegmentCache((prev) => ({
            ...prev,
            [segmentType]: [...prev[segmentType], ...mock],
          }));
          return mock;
        }
        onFeedSuccess();
        const data = (await res.json()) as { tokens?: ApiToken[]; cursor?: string | null; fallback?: boolean };
        const incoming = Array.isArray(data.tokens) ? data.tokens.map(mapApiToken) : [];
        if (data.fallback || incoming.length === 0) {
          const mock = generateMockTokens(mockOffsetRef.current);
          mockOffsetRef.current += mock.length;
          console.log("⚠️ Using fallback demo tokens");
          setIsFallback(true);
          setSegmentCache((prev) => ({
            ...prev,
            [segmentType]: [...prev[segmentType], ...mock],
          }));
          return mock;
        }
        setIsFallback(false);
        const seen = loadedAddressRef.current[segmentType];

        const deduped = incoming.filter((token) => {
          if (!token.address) return false;
          if (hiddenTokenAddresses.has(token.address)) return false;
          if (seen.has(token.address)) return false;
          seen.add(token.address);
          return true;
        });

        if (deduped.length > 0) {
          setSegmentCache((prev) => ({
            ...prev,
            [segmentType]: [...prev[segmentType], ...deduped],
          }));
          setSegmentDepleted((prev) => ({ ...prev, [segmentType]: false }));
        }

        setSegmentCursor((prev) => ({ ...prev, [segmentType]: data.cursor || null }));
        setSegmentHasMore((prev) => ({ ...prev, [segmentType]: Boolean(data.cursor) }));
        return deduped;
      } catch (err) {
        console.log(err);
        const mock = generateMockTokens(mockOffsetRef.current);
        mockOffsetRef.current += mock.length;
        console.log("⚠️ Using fallback demo tokens");
        setIsFallback(true);
        setSegmentCache((prev) => ({
          ...prev,
          [segmentType]: [...prev[segmentType], ...mock],
        }));
        return mock;
      } finally {
        setSegmentLoadingMore((prev) => ({ ...prev, [segmentType]: false }));
        if (initial) setLoading(false);
      }
    },
    [
      activeChain,
      canFetchFeed,
      hiddenTokenAddresses,
      onFeedError,
      onFeedSuccess,
      segmentCache,
      segmentCursor,
      segmentHasMore,
      segmentLoadingMore,
    ]
  );

  const fetchTopLive = useCallback(
    async (segmentType: RemoteSegment, topAddress: string) => {
      try {
        if (!canFetchFeed()) return;
        const chain = activeChain === 'base' ? 'base' : 'solana';
        const endpoint = endpointFor(chain, segmentType);
        const res = await fetch(`${API_BASE}${endpoint}?limit=20`);
        if (!res.ok) {
          onFeedError(res.status);
          return;
        }
        onFeedSuccess();
        const data = (await res.json()) as { tokens?: ApiToken[] };
        const incoming = Array.isArray(data.tokens) ? data.tokens.map(mapApiToken) : [];
        const match = incoming.find((t) => t.address === topAddress);
        if (!match) return;
        setSegmentCache((prev) => ({
          ...prev,
          [segmentType]: prev[segmentType].map((t, i) => (i === 0 ? mergeLiveUpdate(t, match) : t)),
        }));
      } catch (err) {
        onFeedError();
        console.log('live update failed', err);
      }
    },
    [activeChain, canFetchFeed, onFeedError, onFeedSuccess]
  );

  const ensureDeckRefill = useCallback(
    async (segmentType: RemoteSegment) => {
      let attempts = 0;
      while (
        attempts < MAX_EMPTY_FETCH_ATTEMPTS &&
        segmentCache[segmentType].filter((t) => !(t.address && hiddenTokenAddresses.has(t.address))).length < LOW_DECK_THRESHOLD &&
        segmentHasMore[segmentType]
      ) {
        const added = await fetchNextPage(segmentType, false);
        attempts += 1;
        if (added.length > 0) break;
      }

      if (
        attempts >= MAX_EMPTY_FETCH_ATTEMPTS &&
        segmentCache[segmentType].filter((t) => !(t.address && hiddenTokenAddresses.has(t.address))).length === 0
      ) {
        setSegmentDepleted((prev) => ({ ...prev, [segmentType]: true }));
      }
    },
    [fetchNextPage, hiddenTokenAddresses, segmentCache, segmentHasMore]
  );

  useEffect(() => {
    if (!isRemoteSegment(segment)) return;
    const visibleCount = segmentCache[segment].filter((t) => !(t.address && hiddenTokenAddresses.has(t.address))).length;
    if (visibleCount < LOW_DECK_THRESHOLD && !segmentLoadingMore[segment]) {
      void ensureDeckRefill(segment);
    }
  }, [ensureDeckRefill, hiddenTokenAddresses, segment, segmentCache, segmentLoadingMore]);

  useEffect(() => {
    if (!isRemoteSegment(segment)) return;
    if (!isFallback) return;
    const visibleCount = segmentCache[segment].filter((t) => !(t.address && hiddenTokenAddresses.has(t.address))).length;
    if (visibleCount >= LOW_DECK_THRESHOLD) return;

    const mock = generateMockTokens(mockOffsetRef.current);
    mockOffsetRef.current += mock.length;
    setSegmentCache((prev) => ({
      ...prev,
      [segment]: [...prev[segment], ...mock],
    }));
  }, [hiddenTokenAddresses, isFallback, segment, segmentCache]);

  useEffect(() => {
    if (!isRemoteSegment(segment)) return;
    if (segmentCache[segment].length > 0) return;
    void fetchNextPage(segment, true);
  }, [fetchNextPage, segment, segmentCache]);

  useEffect(() => {
    if (!isRemoteSegment(segment)) return;
    if (segmentLoadingMore[segment]) return;
    if (!segmentHasMore[segment]) return;
    if (segmentCache[segment].length === 0 || segmentCache[segment].length > PAGE_LIMIT) return;
    // Preload the next page after initial data.
    void fetchNextPage(segment, false);
  }, [fetchNextPage, segment, segmentCache, segmentHasMore, segmentLoadingMore]);

  const handleActiveCardChange = useCallback(
    (token: SwipeToken | null) => {
      if (!token?.address) return;
      if (!isRemoteSegment(segment)) return;
      if (isSwiping || creatingOrder) return;
      void fetchTopLive(segment, token.address);
    },
    [creatingOrder, fetchTopLive, isSwiping, segment]
  );

  const persistFavorites = useCallback(async (next: FavoriteToken[]) => {
    try {
      await AsyncStorage.setItem(FAVORITES_KEY, JSON.stringify(next));
    } catch (err) {
      console.log('Failed to save favorites', err);
    }
  }, []);

  const persistHiddenTokens = useCallback(async (next: Set<string>) => {
    try {
      await AsyncStorage.setItem(HIDDEN_TOKENS_KEY, JSON.stringify(Array.from(next)));
    } catch (err) {
      console.log('Failed to save hidden tokens', err);
    }
  }, []);

  const hideToken = useCallback(
    (address: string) => {
      if (!address) return;
      setHiddenTokenAddresses((prev) => {
        const next = new Set(prev);
        next.add(address);
        persistHiddenTokens(next);
        return next;
      });
      setSegmentCache((prev) => ({
        trending: prev.trending.filter((t) => t.address !== address),
        stalker: prev.stalker.filter((t) => t.address !== address),
        bigcap: prev.bigcap.filter((t) => t.address !== address),
        smart: prev.smart.filter((t) => t.address !== address),
      }));
      setTokens((prev) => prev.filter((t) => t.address !== address));
    },
    [persistHiddenTokens]
  );

  const handleToggleFavorite = useCallback(async (token: SwipeToken) => {
    setFavoriteTokens((prev) => {
      const exists = prev.some((item) => item.address === token.address);
      const next = exists
        ? prev.filter((item) => item.address !== token.address)
        : [
            ...prev,
            {
              address: token.address,
              name: token.name,
              symbol: token.symbol,
              chain: activeChain,
            },
          ];
      persistFavorites(next);
      setFavoriteAddresses(new Set(next.map((f) => f.address)));
      return next;
    });

    try {
      await fetch(`${API_BASE}/api/favorites`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: TEST_USER_ID,
          tokenAddress: token.address,
        }),
      });
    } catch (err) {
      console.log('Favorite API failed', err);
    }
  }, [activeChain, persistFavorites]);

  const createOrder = useCallback(
    async (token: SwipeToken) => {
      if (!token.address) {
        Alert.alert('Error', 'Token address missing in API response');
        return false;
      }

      try {
        setCreatingOrder(true);

        const res = await fetch(`${API_BASE}/api/orders`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            userId: TEST_USER_ID,
            chain: activeChain || 'solana',
            tokenAddress: token.address,
            amountUSDT: tradeAmount,
            roiTarget: tpROI,
            stopLoss,
          }),
        });

        const json = await res.json();

        if (!res.ok) {
          console.log('Order error:', json);
          Alert.alert('Order Failed', json?.error || 'Unknown error');
          return false;
        }
        return true;
      } catch (err: any) {
        console.log(err);
        Alert.alert('Order Failed', err?.message || 'Network error');
        return false;
      } finally {
        setCreatingOrder(false);
      }
    },
    [activeChain, stopLoss, tpROI, tradeAmount]
  );

  const handleReject = useCallback((token: SwipeToken) => {
    hideToken(token.address);
  }, [hideToken]);

  const handleBuy = useCallback(
    (token: SwipeToken) => {
      if (balance < tradeAmount) {
        Alert.alert('Insufficient balance', 'Not enough funds in your dev wallet.');
        return;
      }
      hideToken(token.address);
      void (async () => {
        const ok = await createOrder(token);
        if (!ok) {
          Alert.alert('Order Failed', `Unable to execute ${token.symbol.toUpperCase()} order.`);
          return;
        }
        const newBalance = await deductBalance(tradeAmount);
        setBalanceState(newBalance);

        setFavoriteTokens((prev) => {
          const next = prev.filter((item) => item.address !== token.address);
          persistFavorites(next);
          setFavoriteAddresses(new Set(next.map((f) => f.address)));
          return next;
        });
      })();
    },
    [balance, createOrder, hideToken, persistFavorites, tradeAmount]
  );

  const openDevWalletControls = useCallback(() => {
    Alert.alert('Dev Wallet', `Current balance: $${balance.toFixed(2)}`, [
      {
        text: 'Add $100',
        onPress: async () => {
          const updated = await addBalance(100);
          setBalanceState(updated);
        },
      },
      {
        text: 'Reset $1000',
        onPress: async () => {
          await resetBalance();
          setBalanceState(1000);
        },
      },
      { text: 'Cancel', style: 'cancel' },
    ]);
  }, [balance]);

  const updateTradeAmount = useCallback(
    (delta: number) => {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => undefined);
      setTradeAmount(Math.max(1, Math.min(500, tradeAmount + delta)));
    },
    [setTradeAmount, tradeAmount]
  );

  const updateTpRoi = useCallback(
    (delta: number) => {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => undefined);
      setTpROI(Math.max(1, Math.min(200, tpROI + delta)));
    },
    [setTpROI, tpROI]
  );

  useEffect(() => {
    if (segment === 'favorites') {
      const filtered = favoriteTokens
        .filter((item) => item.chain === activeChain && !hiddenTokenAddresses.has(item.address))
        .map((item): SwipeToken => ({
          name: item.name,
          symbol: item.symbol,
          address: item.address,
          priceUsd: 0,
          liquidityUsd: 0,
          volume24hUsd: 0,
          marketCapUsd: 0,
          change24hPct: 0,
          chartData: [1, 1.02, 1.01, 1.03],
          graduationTime: 'Favorite',
        }));
      setTokens(filtered);
      return;
    }

    const visible = segmentCache[segment].filter((t) => !(t.address && hiddenTokenAddresses.has(t.address)));
    setTokens(visible);
  }, [activeChain, favoriteTokens, hiddenTokenAddresses, segment, segmentCache]);

  return (
    <GestureHandlerRootView style={styles.root}>
      <SafeAreaView edges={['top']} style={styles.safeArea}>
        <View style={styles.screen}>
          <View style={styles.topBarWrap}>
            <View style={styles.topBar}>
              <ProfileButton
                onPress={() => profileSheetRef.current?.open()}
                onLongPress={openDevWalletControls}
                initials={(profileName.trim().slice(0, 2) || 'TR').toUpperCase()}
                disabled={appLoading}
              />
              <View style={styles.controlsRow}>
                <GlassControlPill
                  label="Amount"
                  value={tradeAmount}
                  suffix="$"
                  onMinus={() => updateTradeAmount(-5)}
                  onPlus={() => updateTradeAmount(5)}
                  onCommit={(v) => setTradeAmount(Math.max(1, Math.min(500, v)))}
                />
                <GlassControlPill
                  label="ROI"
                  value={tpROI}
                  suffix="%"
                  onMinus={() => updateTpRoi(-1)}
                  onPlus={() => updateTpRoi(1)}
                  onCommit={(v) => setTpROI(Math.max(1, Math.min(200, v)))}
                />
              </View>
            </View>
            <View style={styles.filterRow}>
              <FeedSegmentedControl
                value={segment}
                onChange={setSegment}
                segments={['trending', 'stalker', 'bigcap']}
              />
            </View>
          </View>

          <View style={styles.deckArea}>
            <View style={styles.deckWrapper}>
            <SwipeTokenDeck
              resetKey={segment}
              tokens={tokens}
                onBuy={handleBuy}
                onReject={handleReject}
                onToggleFavorite={handleToggleFavorite}
              favoriteAddresses={favoriteAddresses}
              isLoading={loading}
              isInteractionLocked={appLoading}
              onSwipeStateChange={setIsSwiping}
              onActiveCardChange={handleActiveCardChange}
              emptyTitle={
                segment === 'favorites'
                  ? '❤️ No favorites yet'
                  : isFallback
                    ? 'Demo mode active'
                    : isRemoteSegment(segment) && segmentDepleted[segment]
                    ? 'No more tokens available right now'
                    : 'Deck complete'
              }
              emptySubtitle={
                segment === 'favorites'
                  ? 'Tap the heart to save tokens for later'
                  : isFallback
                    ? 'Fallback demo tokens are loaded for infinite swipe testing.'
                    : isRemoteSegment(segment) && segmentDepleted[segment]
                    ? 'Please check back shortly for fresh listings.'
                    : 'No more tokens in this segment.'
              }
            />
            </View>
          </View>
        </View>

        <ProfileSheet ref={profileSheetRef} />
        <SwipeHint visible={showSwipeHint} />
        <AppLoader visible={appLoading} />
      </SafeAreaView>
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#05070A',
  },
  safeArea: {
    flex: 1,
    backgroundColor: '#05070A',
    paddingHorizontal: 0,
  },
  topBarWrap: {
    backgroundColor: '#05070A',
    zIndex: 30,
  },
  screen: {
    flex: 1,
  },
  topBar: {
    width: '100%',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingTop: 8,
    gap: 12,
  },
  controlsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  filterRow: {
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 8,
  },
  deckArea: {
    flex: 1,
    paddingBottom: 10,
  },
  deckWrapper: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  controlRing: {
    borderRadius: 999,
    padding: 1,
  },
  controlInner: {
    minHeight: 42,
    borderRadius: 999,
    paddingHorizontal: 6,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
    backgroundColor: 'rgba(255,255,255,0.06)',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  controlButton: {
    width: 26,
    height: 26,
    borderRadius: 13,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.08)',
  },
  controlButtonText: {
    color: '#f5f7ff',
    fontSize: 15,
    fontWeight: '700',
  },
  controlValueWrap: {
    minWidth: 62,
    alignItems: 'center',
  },
  controlLabel: {
    color: 'rgba(214,224,255,0.72)',
    fontSize: 10,
    fontWeight: '600',
    letterSpacing: 0.4,
    textTransform: 'uppercase',
  },
  controlValue: {
    color: '#fff',
    fontSize: 13,
    fontWeight: '700',
  },
  controlInput: {
    minWidth: 72,
    height: 28,
    borderRadius: 8,
    backgroundColor: 'rgba(255,255,255,0.1)',
    color: '#fff',
    textAlign: 'center',
    fontSize: 13,
    fontWeight: '700',
    paddingHorizontal: 8,
  },
});

const GlassControlPill = ({
  label,
  value,
  suffix,
  onMinus,
  onPlus,
  onCommit,
}: {
  label: string;
  value: number;
  suffix: string;
  onMinus: () => void;
  onPlus: () => void;
  onCommit: (value: number) => void;
}) => {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(String(Math.round(value)));

  useEffect(() => {
    if (!editing) setDraft(String(Math.round(value)));
  }, [editing, value]);

  const commit = () => {
    const next = Number(draft);
    onCommit(Number.isFinite(next) ? next : 1);
    setEditing(false);
  };

  return (
    <LinearGradient colors={['rgba(115,143,255,0.24)', 'rgba(92,245,190,0.12)']} style={styles.controlRing}>
      <BlurView intensity={24} tint="dark" style={styles.controlInner}>
        <Pressable onPress={onMinus} style={styles.controlButton}>
          <Text style={styles.controlButtonText}>-</Text>
        </Pressable>
        <Pressable style={styles.controlValueWrap} onPress={() => setEditing(true)}>
          <Text style={styles.controlLabel}>{label}</Text>
          {editing ? (
            <TextInput
              autoFocus
              keyboardType="numeric"
              value={draft}
              onChangeText={setDraft}
              onBlur={commit}
              onSubmitEditing={commit}
              style={styles.controlInput}
            />
          ) : (
            <Text style={styles.controlValue}>
              {suffix === '$' ? `${suffix}${Math.round(value)}` : `${Math.round(value)}${suffix}`}
            </Text>
          )}
        </Pressable>
        <Pressable onPress={onPlus} style={styles.controlButton}>
          <Text style={styles.controlButtonText}>+</Text>
        </Pressable>
      </BlurView>
    </LinearGradient>
  );
};
