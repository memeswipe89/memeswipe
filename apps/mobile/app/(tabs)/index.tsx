import AsyncStorage from '@react-native-async-storage/async-storage';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import * as Haptics from 'expo-haptics';
import * as Linking from 'expo-linking';
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
import { useWalletContext } from '@/contexts/wallet-context';
import { useTradeSettings } from '@/contexts/trade-settings-context';
import { addBalance, getBalance as getDevBalance, resetBalance } from '@/lib/devWallet';

const API_BASE = process.env.EXPO_PUBLIC_API_BASE || 'https://memeswipe.onrender.com';
const SOLANA_MAINNET_RPC = 'https://api.mainnet-beta.solana.com';
const SOL_MINT = 'So11111111111111111111111111111111111111112';
const MIN_SOL_RESERVE_FOR_FEES = 0.01;
const SWAP_SLIPPAGE_RETRY_BPS = [100, 300, 800, 1500, 3000, 5000];
const LOCAL_USER_ID_KEY = '@memeswipe:userId:v1';
const FAVORITES_KEY = '@memeswipe:favorites:v1';
const HIDDEN_TOKENS_KEY = '@memeswipe:hidden-tokens:v1';
const LAST_AMOUNT_KEY = '@memeswipe:lastAmount';
const LAST_ROI_KEY = '@memeswipe:lastROI';
const BONUS_2000_APPLIED_KEY = '@memeswipe:bonus2000:applied';
const PAGE_LIMIT = 50;
const LOW_DECK_THRESHOLD = 5;
const MAX_EMPTY_FETCH_ATTEMPTS = 3;
const MIN_TRADE_AMOUNT_USD = 0.0001;
const MAX_TRADE_AMOUNT_USD = 500;
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
const solToLamports = (sol: number) => Math.floor(sol * 1_000_000_000);
const lamportsToSol = (lamports: number) => lamports / 1_000_000_000;

const endpointFor = (chain: 'solana' | 'base', segment: RemoteSegment) => {
  if (segment === 'stalker') return `/api/feed/${chain}/stalker`;
  if (segment === 'bigcap') return `/api/feed/${chain}/bigcap`;
  if (segment === 'smart') return `/api/feed/${chain}/smart`;
  return `/api/feed/${chain}/graduated`;
};

export default function HomeScreen() {
  const { twitterProfile, setTwitterProfile, tradingWalletAddress, getOrCreateTradingWalletAddress } =
    useWalletContext();
  const profileSheetRef = useRef<ProfileSheetRef>(null);
  const connectInProgressRef = useRef(false);
  const [userId, setUserId] = useState<string>('');
  const [checkingTwitter, setCheckingTwitter] = useState(true);
  const [twitterConnectLoading, setTwitterConnectLoading] = useState(false);
  const [showTwitterPrompt, setShowTwitterPrompt] = useState(false);
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
  const [isSwiping, setIsSwiping] = useState(false);
  const [balance, setBalanceState] = useState(0);
  const [walletSolBalance, setWalletSolBalance] = useState<number | null>(null);
  const [solPriceUsd, setSolPriceUsd] = useState<number | null>(null);
  const [swapBudgetLoading, setSwapBudgetLoading] = useState(false);
  const { activeChain, profileName, tradeAmount, tpROI, stopLoss, setTradeAmount, setTpROI } = useTradeSettings();
  const loadedAddressRef = useRef<Record<RemoteSegment, Set<string>>>(makeSegmentMap(() => new Set<string>()));
  const lastFeedFetchRef = useRef(0);
  const blockedUntilRef = useRef(0);
  const retryDelayRef = useRef(10000);

  const createUuidV4 = useCallback(
    () =>
      "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (ch) => {
        const rand = Math.floor(Math.random() * 16);
        const value = ch === "x" ? rand : (rand & 0x3) | 0x8;
        return value.toString(16);
      }),
    []
  );

  const getOrCreateLocalUserId = useCallback(async () => {
    const existing = await AsyncStorage.getItem(LOCAL_USER_ID_KEY);
    if (existing) return existing;
    const next = createUuidV4();
    await AsyncStorage.setItem(LOCAL_USER_ID_KEY, next);
    return next;
  }, [createUuidV4]);

  const checkTwitterConnection = useCallback(
    async (resolvedUserId: string) => {
      try {
        setCheckingTwitter(true);
        const res = await fetch(`${API_BASE}/api/twitter/connection/${resolvedUserId}`);
        if (!res.ok) {
          setShowTwitterPrompt(true);
          return;
        }
        const data = (await res.json()) as {
          connected?: boolean;
          twitterUsername?: string;
          twitterUserId?: string;
        };
        if (data.connected && data.twitterUsername && data.twitterUserId) {
          setTwitterProfile({
            username: data.twitterUsername,
            id: data.twitterUserId,
          });
          setShowTwitterPrompt(false);
          return;
        }
        setTwitterProfile(null);
        setShowTwitterPrompt(true);
      } catch (error) {
        console.log(error);
        setTwitterProfile(null);
        setShowTwitterPrompt(true);
      } finally {
        setCheckingTwitter(false);
      }
    },
    [setTwitterProfile]
  );

  const handleTwitterRedirect = useCallback(
    (url: string) => {
      if (!connectInProgressRef.current) return;
      const parsed = Linking.parse(url);
      const path = parsed.path || "";
      const host = parsed.hostname || "";
      const isTwitterCallback = path.includes("twitter-connected") || host === "twitter-connected";
      if (!isTwitterCallback) return;

      connectInProgressRef.current = false;
      setTwitterConnectLoading(false);

      const status = parsed.queryParams?.status;
      if (status !== "success") {
        const error = parsed.queryParams?.error;
        Alert.alert("Twitter Connect", `Twitter connection failed${error ? `: ${error}` : "."}`);
        return;
      }

      const twitterUsername = parsed.queryParams?.twitterUsername;
      const twitterUserId = parsed.queryParams?.twitterUserId;
      if (typeof twitterUsername !== "string" || typeof twitterUserId !== "string") {
        Alert.alert("Twitter Connect", "Twitter profile data missing");
        return;
      }

      setTwitterProfile({ username: twitterUsername, id: twitterUserId });
      setShowTwitterPrompt(false);
      Alert.alert("Connected", `Connected as @${twitterUsername}`);
    },
    [setTwitterProfile]
  );

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

  const refreshSwapBudget = useCallback(
    async (addressOverride?: string) => {
      const targetAddress = addressOverride || tradingWalletAddress;
      if (!targetAddress || activeChain !== 'solana') {
        setWalletSolBalance(null);
        setSolPriceUsd(null);
        return;
      }
      try {
        setSwapBudgetLoading(true);
        const [balanceRes, priceRes] = await Promise.all([
          fetch(SOLANA_MAINNET_RPC, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              jsonrpc: '2.0',
              id: 1,
              method: 'getBalance',
              params: [targetAddress],
            }),
          }),
          fetch(`${API_BASE}/api/solana/price-usd`),
        ]);
        const balanceJson = await parseApiJson<{ result?: { value?: number } }>(balanceRes);
        const priceJson = await parseApiJson<{ priceUsd?: number }>(priceRes);
        const balanceLamports = Number(balanceJson?.result?.value || 0);
        const priceUsd = Number(priceJson?.priceUsd || 0);
        setWalletSolBalance(Number.isFinite(balanceLamports) ? lamportsToSol(balanceLamports) : 0);
        setSolPriceUsd(Number.isFinite(priceUsd) && priceUsd > 0 ? priceUsd : null);
      } catch (error) {
        console.log('[SWAP_BUDGET] refresh failed', error);
      } finally {
        setSwapBudgetLoading(false);
      }
    },
    [activeChain, tradingWalletAddress]
  );

  useEffect(() => {
    void refreshSwapBudget();
  }, [refreshSwapBudget, tradeAmount]);

  const estimatedSwapInputSol = useMemo(() => {
    if (!solPriceUsd || solPriceUsd <= 0) return null;
    return Math.max(MIN_TRADE_AMOUNT_USD, tradeAmount) / solPriceUsd;
  }, [solPriceUsd, tradeAmount]);

  const estimatedRequiredSol = useMemo(() => {
    if (estimatedSwapInputSol === null) return null;
    // Includes tx/priority and first-time token-account rent overhead.
    return estimatedSwapInputSol + MIN_SOL_RESERVE_FOR_FEES;
  }, [estimatedSwapInputSol]);

  const swapShortfallSol = useMemo(() => {
    if (walletSolBalance === null || estimatedRequiredSol === null) return null;
    return Math.max(0, estimatedRequiredSol - walletSolBalance);
  }, [estimatedRequiredSol, walletSolBalance]);

  useEffect(() => {
    const timer = setTimeout(() => setAppLoading(false), 1600);
    return () => clearTimeout(timer);
  }, []);

  useEffect(() => {
    const sub = Linking.addEventListener("url", ({ url }) => {
      handleTwitterRedirect(url);
    });

    Linking.getInitialURL().then((url) => {
      if (url) handleTwitterRedirect(url);
    });

    (async () => {
      const localUserId = await getOrCreateLocalUserId();
      setUserId(localUserId);
      await checkTwitterConnection(localUserId);
    })();

    return () => sub.remove();
  }, [checkTwitterConnection, getOrCreateLocalUserId, handleTwitterRedirect]);

  const connectTwitter = useCallback(async () => {
    try {
      connectInProgressRef.current = true;
      setTwitterConnectLoading(true);
      const returnUrl = Linking.createURL("twitter-connected");

      const startRes = await fetch(
        `${API_BASE}/api/twitter/auth/start?userId=${encodeURIComponent(userId)}&returnUrl=${encodeURIComponent(returnUrl)}`
      );

      const startJson = (await startRes.json()) as { authUrl?: string; error?: string };
      if (!startRes.ok || !startJson?.authUrl) {
        connectInProgressRef.current = false;
        setTwitterConnectLoading(false);
        throw new Error(startJson?.error || "Failed to start Twitter auth");
      }

      const canOpen = await Linking.canOpenURL(startJson.authUrl);
      if (!canOpen) {
        connectInProgressRef.current = false;
        setTwitterConnectLoading(false);
        throw new Error("Cannot open Twitter auth URL");
      }
      await Linking.openURL(startJson.authUrl);
    } catch (error: any) {
      connectInProgressRef.current = false;
      setTwitterConnectLoading(false);
      console.log(error);
      Alert.alert("Twitter Connect", error?.message || "Failed to connect Twitter");
    }
  }, [userId]);

  useEffect(() => {
    const hideTimer = setTimeout(() => setShowSwipeHint(false), 5000);
    return () => clearTimeout(hideTimer);
  }, []);

  useEffect(() => {
    getDevBalance().then(setBalanceState).catch(() => setBalanceState(1000));
  }, []);

  useEffect(() => {
    let active = true;
    const applyOneTimeBonus = async () => {
      try {
        const applied = await AsyncStorage.getItem(BONUS_2000_APPLIED_KEY);
        if (applied === 'true') return;
        const updated = await addBalance(2000);
        await AsyncStorage.setItem(BONUS_2000_APPLIED_KEY, 'true');
        if (active) setBalanceState(updated);
      } catch (err) {
        console.log('failed to apply bonus balance', err);
      }
    };
    void applyOneTimeBonus();
    return () => {
      active = false;
    };
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
    void AsyncStorage.setItem(LAST_AMOUNT_KEY, String(Math.max(MIN_TRADE_AMOUNT_USD, tradeAmount)));
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
      if (!canFetchFeed()) return [];

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
          return [];
        }
        onFeedSuccess();
        const data = (await res.json()) as { tokens?: ApiToken[]; cursor?: string | null };
        const incoming = Array.isArray(data.tokens) ? data.tokens.map(mapApiToken) : [];
        if (incoming.length === 0) return [];
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
        return [];
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
      const resolvedUserId = (userId || '').trim() || (await getOrCreateLocalUserId());
      await fetch(`${API_BASE}/api/favorites`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: resolvedUserId,
          twitterUserId: twitterProfile?.id || null,
          twitterUsername: twitterProfile?.username || null,
          tokenAddress: token.address,
        }),
      });
    } catch (err) {
      console.log('Favorite API failed', err);
    }
  }, [activeChain, getOrCreateLocalUserId, persistFavorites, twitterProfile?.id, twitterProfile?.username, userId]);

  const executeJupiterSwap = useCallback(
    async (token: SwipeToken) => {
      if (!token.address) {
        throw new Error('Token address missing in API response');
      }
      if (activeChain !== 'solana') {
        throw new Error('On-chain swaps are currently enabled only for Solana feed.');
      }

      const resolvedWalletAddress = tradingWalletAddress || (await getOrCreateTradingWalletAddress());
      if (!resolvedWalletAddress) {
        throw new Error('No wallet address found. Create wallet first from Wallet tab.');
      }

      // Pre-check spendable SOL so tiny swaps fail with a clear message before simulation.
      const [balanceRes, solPriceRes] = await Promise.all([
        fetch(SOLANA_MAINNET_RPC, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            jsonrpc: '2.0',
            id: 1,
            method: 'getBalance',
            params: [resolvedWalletAddress],
          }),
        }),
        fetch(`${API_BASE}/api/solana/price-usd`),
      ]);
      const balanceJson = await parseApiJson<{ result?: { value?: number } }>(balanceRes);
      const balanceLamports = Number(balanceJson?.result?.value || 0);
      const priceJson = await parseApiJson<{ priceUsd?: number }>(solPriceRes);
      const liveSolPriceUsd = Number(priceJson?.priceUsd || 0);
      if (!Number.isFinite(liveSolPriceUsd) || liveSolPriceUsd <= 0) {
        throw new Error('Could not fetch SOL price for swap precheck.');
      }
      const usdAmount = Math.max(MIN_TRADE_AMOUNT_USD, Number.isFinite(tradeAmount) ? tradeAmount : MIN_TRADE_AMOUNT_USD);
      const requiredLamports = Math.ceil((usdAmount / liveSolPriceUsd) * 1_000_000_000);
      const reserveLamports = solToLamports(MIN_SOL_RESERVE_FOR_FEES);
      if (balanceLamports < requiredLamports + reserveLamports) {
        throw new Error(
          `Insufficient SOL for swap + fees. Balance ${lamportsToSol(balanceLamports).toFixed(6)} SOL, required ~${lamportsToSol(
            requiredLamports + reserveLamports
          ).toFixed(6)} SOL.`
        );
      }

      let lastError: any = null;

      for (const slippageBps of SWAP_SLIPPAGE_RETRY_BPS) {
        try {
          const resolvedUserId = (userId || '').trim() || (await getOrCreateLocalUserId());
          const swapRes = await fetch(`${API_BASE}/api/trades/open`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              userId: resolvedUserId,
              tokenAddress: token.address,
              amountUsd: Math.max(MIN_TRADE_AMOUNT_USD, Number.isFinite(tradeAmount) ? tradeAmount : MIN_TRADE_AMOUNT_USD),
              slippageBps,
            }),
          });
          const swapJson = await parseApiJson<{
            error?: string;
            signature?: string;
            quote?: { inAmount?: string; outAmount?: string; inputMint?: string; outputMint?: string };
          }>(swapRes);
          if (!swapRes.ok || !swapJson?.signature) {
            throw new Error(swapJson?.error || 'Failed to build Jupiter swap');
          }
          const signature = String(swapJson.signature || '');
          if (!signature) {
            throw new Error('Signed transaction was sent but no signature returned.');
          }
          console.log('[TRADE][SWIPE_RIGHT] on-chain swap success', {
            signature,
            slippageBps,
            inputMint: swapJson.quote?.inputMint || SOL_MINT,
            outputMint: swapJson.quote?.outputMint || token.address,
            inAmount: swapJson.quote?.inAmount,
            outAmount: swapJson.quote?.outAmount,
          });

          return {
            signature,
            inputMint: swapJson.quote?.inputMint || SOL_MINT,
            outputMint: swapJson.quote?.outputMint || token.address,
            inAmountRaw: String(swapJson.quote?.inAmount || ''),
            outAmountRaw: String(swapJson.quote?.outAmount || ''),
          };
        } catch (error: any) {
          lastError = error;
          const msg = String(error?.message || '');
          const retryable =
            msg.includes('0x1788') ||
            msg.toLowerCase().includes('simulation failed') ||
            msg.toLowerCase().includes('slippage');
          console.log('[TRADE][SWIPE_RIGHT] swap attempt failed', {
            slippageBps,
            retryable,
            message: msg,
          });
          if (!retryable) break;
        }
      }

      throw lastError || new Error('Swap failed after retries');
    },
    [activeChain, getOrCreateLocalUserId, getOrCreateTradingWalletAddress, tradeAmount, tradingWalletAddress, userId]
  );

  const createOrder = useCallback(
    async (
      token: SwipeToken,
      swapMeta?: {
        signature: string;
        inputMint: string;
        outputMint: string;
        inAmountRaw: string;
        outAmountRaw: string;
      }
    ) => {
      if (!token.address) {
        Alert.alert('Error', 'Token address missing in API response');
        return false;
      }
      const amount = Number.isFinite(tradeAmount)
        ? Math.max(MIN_TRADE_AMOUNT_USD, tradeAmount)
        : MIN_TRADE_AMOUNT_USD;
      const targetRoi = Number.isFinite(tpROI) ? Math.max(1, tpROI) : 1;

      try {
        setCreatingOrder(true);
        const resolvedUserId = (userId || '').trim() || (await getOrCreateLocalUserId());

        if (!resolvedUserId) {
          Alert.alert('Order Failed', 'User session is missing. Please reopen the app and try again.');
          return false;
        }

        const tradePayload = {
          userId: resolvedUserId,
          twitterUserId: twitterProfile?.id || null,
          twitterUsername: twitterProfile?.username || null,
          chain: activeChain || 'solana',
          tokenAddress: token.address,
          tokenName: token.name,
          tokenSymbol: token.symbol,
          amountUsd: amount,
          tpRoi: targetRoi,
          amountUSDT: amount,
          roiTarget: targetRoi,
          stopLoss,
          priceUsd: token.priceUsd,
          liquidityUsd: token.liquidityUsd,
          volume24hUsd: token.volume24hUsd,
          marketCapUsd: token.marketCapUsd,
          change24hPct: token.change24hPct,
          graduationTime: token.graduationTime || null,
          chartData: Array.isArray(token.chartData) ? token.chartData : [],
          txSignature: swapMeta?.signature || null,
          inputMint: swapMeta?.inputMint || null,
          outputMint: swapMeta?.outputMint || null,
          inAmountRaw: swapMeta?.inAmountRaw || null,
          outAmountRaw: swapMeta?.outAmountRaw || null,
        };
        console.log('[TRADE][SWIPE_RIGHT] sending order payload', tradePayload);

        const res = await fetch(`${API_BASE}/api/orders`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(tradePayload),
        });

        const json = await parseApiJson<{ error?: string }>(res);
        console.log('[TRADE][SWIPE_RIGHT] order API response', { status: res.status, body: json });

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
    [activeChain, getOrCreateLocalUserId, stopLoss, tpROI, tradeAmount, twitterProfile?.id, twitterProfile?.username, userId]
  );

  const handleReject = useCallback((token: SwipeToken) => {
    hideToken(token.address);
  }, [hideToken]);

  const handleBuy = useCallback(
    (token: SwipeToken) => {
      console.log('[TRADE][SWIPE_RIGHT] token selected', {
        symbol: token.symbol,
        address: token.address,
        priceUsd: token.priceUsd,
      });
      void (async () => {
        let swapMeta:
          | {
              signature: string;
              inputMint: string;
              outputMint: string;
              inAmountRaw: string;
              outAmountRaw: string;
            }
          | undefined;
        try {
          swapMeta = await executeJupiterSwap(token);
        } catch (error: any) {
          console.log('[TRADE][SWIPE_RIGHT] swap failed', {
            symbol: token.symbol,
            address: token.address,
            message: error?.message || String(error),
          });
          Alert.alert('Swap Failed', error?.message || 'Unable to execute on-chain swap.');
          return;
        }

        const ok = await createOrder(token, swapMeta);
        if (!ok) {
          Alert.alert('Order Failed', `Unable to execute ${token.symbol.toUpperCase()} order.`);
          return;
        }
        hideToken(token.address);

        setFavoriteTokens((prev) => {
          const next = prev.filter((item) => item.address !== token.address);
          persistFavorites(next);
          setFavoriteAddresses(new Set(next.map((f) => f.address)));
          return next;
        });
      })();
    },
    [createOrder, executeJupiterSwap, hideToken, persistFavorites]
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
      const next = Math.max(MIN_TRADE_AMOUNT_USD, Math.min(MAX_TRADE_AMOUNT_USD, tradeAmount + delta));
      setTradeAmount(Number(next.toFixed(4)));
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

  if (checkingTwitter) {
    return (
      <SafeAreaView style={[styles.safeArea, { justifyContent: "center", alignItems: "center" }]}>
        <Text style={{ color: "#fff", fontSize: 16 }}>Checking Twitter connection...</Text>
      </SafeAreaView>
    );
  }

  if (showTwitterPrompt) {
    return (
      <SafeAreaView style={[styles.safeArea, { justifyContent: "center", paddingHorizontal: 22 }]}>
        <View style={{ alignItems: "center" }}>
          <Text style={{ color: "#fff", fontSize: 34, fontWeight: "800", textAlign: "center" }}>
            Connect Twitter
          </Text>
          <Text style={{ color: "#97A0BA", marginTop: 12, textAlign: "center", fontSize: 15 }}>
            Connect your Twitter/X account to continue.
          </Text>
          <Pressable
            onPress={connectTwitter}
            disabled={twitterConnectLoading}
            style={{
              marginTop: 24,
              minWidth: 220,
              borderRadius: 12,
              backgroundColor: "#fff",
              paddingVertical: 14,
              paddingHorizontal: 20,
            }}
          >
            <Text style={{ textAlign: "center", color: "#000", fontWeight: "800" }}>
              {twitterConnectLoading ? "Connecting..." : "Connect Twitter"}
            </Text>
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }

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
                  onMinus={() => updateTradeAmount(-0.1)}
                  onPlus={() => updateTradeAmount(0.1)}
                  onCommit={(v) =>
                    setTradeAmount(
                      Number(Math.max(MIN_TRADE_AMOUNT_USD, Math.min(MAX_TRADE_AMOUNT_USD, v)).toFixed(4))
                    )
                  }
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
              segments={['trending', 'stalker', 'bigcap', 'smart', 'favorites']}
            />
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
                  : isRemoteSegment(segment) && segmentDepleted[segment]
                    ? 'No more tokens available right now'
                    : 'Deck complete'
              }
              emptySubtitle={
                segment === 'favorites'
                  ? 'Tap the heart to save tokens for later'
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
  swapBudgetRow: {
    paddingHorizontal: 20,
    paddingBottom: 6,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
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
  const isDollar = suffix === '$';
  const formatAmount = useCallback((n: number) => {
    if (!Number.isFinite(n)) return '0';
    if (!isDollar) return String(Math.round(n));
    return n.toFixed(4).replace(/\.?0+$/, '');
  }, [isDollar]);
  const [draft, setDraft] = useState(formatAmount(value));

  useEffect(() => {
    if (!editing) setDraft(formatAmount(value));
  }, [editing, formatAmount, value]);

  const commit = () => {
    const normalizedDraft = isDollar ? draft.replace(/[^0-9.]/g, '') : draft;
    const next = Number(normalizedDraft);
    onCommit(Number.isFinite(next) ? next : isDollar ? MIN_TRADE_AMOUNT_USD : 1);
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
              keyboardType={isDollar ? 'decimal-pad' : 'numeric'}
              value={draft}
              onChangeText={setDraft}
              onBlur={commit}
              onSubmitEditing={commit}
              style={styles.controlInput}
            />
          ) : (
            <Text style={styles.controlValue}>
              {isDollar ? `${suffix}${formatAmount(value)}` : `${Math.round(value)}${suffix}`}
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
