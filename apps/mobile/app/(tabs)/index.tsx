import AsyncStorage from '@react-native-async-storage/async-storage';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import * as Haptics from 'expo-haptics';
import * as Linking from 'expo-linking';
import * as WebBrowser from 'expo-web-browser';
import Constants from 'expo-constants';
import { BlurView } from 'expo-blur';
import { LinearGradient } from 'expo-linear-gradient';
import { FontAwesome } from '@expo/vector-icons';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Connection, VersionedTransaction } from '@solana/web3.js';
import { Buffer } from 'buffer';

import { AppLoader } from '@/components/app-loader';
import { LoadingOverlay } from '@/components/loading-overlay';
import type { FeedSegment } from '@/components/feed-segmented-control';
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
const FAVORITES_KEY = '@memeswipe:favorites:v1';
const HIDDEN_TOKENS_KEY = '@memeswipe:hidden-tokens:v1';
const LAST_AMOUNT_KEY = '@memeswipe:lastAmount';
const LAST_ROI_KEY = '@memeswipe:lastROI';
const BONUS_2000_APPLIED_KEY = '@memeswipe:bonus2000:applied';
const TWITTER_PROFILE_CACHE_KEY = '@memeswipe:twitterProfile:v1';
const PAGE_LIMIT = 50;
const LOW_DECK_THRESHOLD = 5;
const MAX_EMPTY_FETCH_ATTEMPTS = 3;
const MIN_TRADE_AMOUNT_USD = 0.0001;
const MAX_TRADE_AMOUNT_USD = 500;
const MIN_PERCENT = 0.1;
const TWITTER_CONNECTION_TIMEOUT_MS = 5000;
const TWITTER_AUTH_START_TIMEOUT_MS = 10000;
type FavoriteToken = {
  address: string;
  name: string;
  symbol: string;
  chain: string;
};
type TradeOpenPopupState = {
  visible: boolean;
  tokenName: string;
  tokenSymbol: string;
  amountUsd: number;
  tpRoi: number;
  txSignature: string;
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

void WebBrowser.maybeCompleteAuthSession();

export default function HomeScreen() {
  const {
    twitterProfile,
    setTwitterProfile,
    tradingWalletAddress,
    getOrCreateTradingWalletAddress,
    getEmbeddedSolanaProvider,
    getOrCreateLocalUserId,
  } =
    useWalletContext();
  const profileSheetRef = useRef<ProfileSheetRef>(null);
  const connectInProgressRef = useRef(false);
  const [userId, setUserId] = useState<string>('');
  const [checkingTwitter, setCheckingTwitter] = useState(true);
  const [twitterConnectLoading, setTwitterConnectLoading] = useState(false);
  const [showTwitterPrompt, setShowTwitterPrompt] = useState(false);
  const [loading, setLoading] = useState(false);
  const [creatingOrder, setCreatingOrder] = useState(false);
  const [buyLoading, setBuyLoading] = useState(false);
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
  const [tradeOpenPopup, setTradeOpenPopup] = useState<TradeOpenPopupState>({
    visible: false,
    tokenName: '',
    tokenSymbol: '',
    amountUsd: 0,
    tpRoi: 0,
    txSignature: '',
  });
  const { activeChain, profileName, tradeAmount, tpROI, stopLoss, setTradeAmount, setTpROI, setStopLoss } =
    useTradeSettings();
  const loadedAddressRef = useRef<Record<RemoteSegment, Set<string>>>(makeSegmentMap(() => new Set<string>()));
  const recoveredHiddenRef = useRef(false);
  const bootstrapCheckedRef = useRef(false);
  const lastFeedFetchRef = useRef(0);
  const blockedUntilRef = useRef(0);
  const retryDelayRef = useRef(10000);

  const checkTwitterConnection = useCallback(
    async (resolvedUserId: string, options?: { background?: boolean; allowStale?: boolean }) => {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), TWITTER_CONNECTION_TIMEOUT_MS);
      try {
        if (!options?.background) {
          setCheckingTwitter(true);
        }
        const res = await fetch(`${API_BASE}/api/twitter/connection/${resolvedUserId}`, {
          signal: controller.signal,
        });
        if (!res.ok) {
          if (res.status === 404) {
            setTwitterProfile(null);
            setShowTwitterPrompt(false);
            await AsyncStorage.removeItem(TWITTER_PROFILE_CACHE_KEY);
            return;
          }
          if (options?.allowStale && twitterProfile) {
            setShowTwitterPrompt(false);
            return;
          }
          setShowTwitterPrompt(false);
          return;
        }
        const data = (await res.json()) as {
          connected?: boolean;
          twitterUsername?: string;
          twitterUserId?: string;
        };
        if (data.connected && data.twitterUsername && data.twitterUserId) {
          const profile = {
            username: data.twitterUsername,
            id: data.twitterUserId,
          };
          setTwitterProfile(profile);
          await AsyncStorage.setItem(TWITTER_PROFILE_CACHE_KEY, JSON.stringify(profile));
          setShowTwitterPrompt(false);
          return;
        }
        setTwitterProfile(null);
        setShowTwitterPrompt(false);
        await AsyncStorage.removeItem(TWITTER_PROFILE_CACHE_KEY);
      } catch (error) {
        console.log(error);
        if (options?.allowStale && twitterProfile) {
          setShowTwitterPrompt(false);
          return;
        }
        setShowTwitterPrompt(false);
      } finally {
        clearTimeout(timeoutId);
        if (!options?.background) {
          setCheckingTwitter(false);
        }
      }
    },
    [setTwitterProfile, twitterProfile]
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

      const profile = { username: twitterUsername, id: twitterUserId };
      setTwitterProfile(profile);
      void AsyncStorage.setItem(TWITTER_PROFILE_CACHE_KEY, JSON.stringify(profile));
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
    if (bootstrapCheckedRef.current) return;
    bootstrapCheckedRef.current = true;

    const sub = Linking.addEventListener("url", ({ url }) => {
      handleTwitterRedirect(url);
    });

    Linking.getInitialURL().then((url) => {
      if (url) handleTwitterRedirect(url);
    });

    (async () => {
      const localUserId = await getOrCreateLocalUserId();
      setUserId(localUserId);
      const cachedProfileRaw = await AsyncStorage.getItem(TWITTER_PROFILE_CACHE_KEY);
      let hasCachedProfile = false;

      if (cachedProfileRaw) {
        try {
          const cachedProfile = JSON.parse(cachedProfileRaw) as { username?: string; id?: string };
          if (cachedProfile?.username && cachedProfile?.id) {
            setTwitterProfile({ username: cachedProfile.username, id: cachedProfile.id });
            setShowTwitterPrompt(false);
            setCheckingTwitter(false);
            hasCachedProfile = true;
          } else {
            await AsyncStorage.removeItem(TWITTER_PROFILE_CACHE_KEY);
          }
        } catch {
          await AsyncStorage.removeItem(TWITTER_PROFILE_CACHE_KEY);
        }
      }

      await checkTwitterConnection(localUserId, { background: hasCachedProfile, allowStale: hasCachedProfile });
    })();

    return () => sub.remove();
  }, [checkTwitterConnection, getOrCreateLocalUserId, handleTwitterRedirect, setTwitterProfile]);

  const connectTwitter = useCallback(async () => {
    try {
      connectInProgressRef.current = true;
      setTwitterConnectLoading(true);
      const resolvedUserId = (userId || '').trim() || (await getOrCreateLocalUserId());
      if (!resolvedUserId) {
        throw new Error('User session is missing. Please reopen the app and try again.');
      }
      if (resolvedUserId !== userId) {
        setUserId(resolvedUserId);
      }
      const returnUrl =
        Constants.appOwnership === 'expo'
          ? Linking.createURL('twitter-connected')
          : Linking.createURL('twitter-connected', { scheme: 'mobile' });

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), TWITTER_AUTH_START_TIMEOUT_MS);
      const startRes = await fetch(
        `${API_BASE}/api/twitter/auth/start?userId=${encodeURIComponent(resolvedUserId)}&returnUrl=${encodeURIComponent(returnUrl)}`,
        { signal: controller.signal }
      );
      clearTimeout(timeoutId);

      const startJson = await parseApiJson<{ authUrl?: string; error?: string }>(startRes);
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

      // Prefer opening in Twitter/X app when installed; fallback to auth-session/browser.
      const hasTwitterApp = (await Linking.canOpenURL('twitter://')) || (await Linking.canOpenURL('x://'));
      if (hasTwitterApp) {
        await Linking.openURL(startJson.authUrl);
        return;
      }

      const authResult = await WebBrowser.openAuthSessionAsync(startJson.authUrl, returnUrl);
      if (authResult.type === 'success' && authResult.url) {
        handleTwitterRedirect(authResult.url);
        return;
      }

      // Some Android/Expo Go combinations may not complete auth-session callback reliably.
      // Fallback to opening the URL directly in browser so user can still continue the flow.
      if (authResult.type === 'cancel' || authResult.type === 'dismiss' || authResult.type === 'opened') {
        const opened = await Linking.openURL(startJson.authUrl).then(() => true).catch(() => false);
        if (!opened) {
          throw new Error('Unable to open Twitter auth page. Please check browser availability.');
        }
      }

      if (authResult.type === 'cancel' || authResult.type === 'dismiss') {
        connectInProgressRef.current = false;
        setTwitterConnectLoading(false);
      }
    } catch (error: any) {
      connectInProgressRef.current = false;
      setTwitterConnectLoading(false);
      console.log(error);
      Alert.alert("Twitter Connect", error?.message || "Failed to connect Twitter");
    }
  }, [getOrCreateLocalUserId, handleTwitterRedirect, userId]);

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
    void AsyncStorage.setItem(LAST_ROI_KEY, String(Math.max(MIN_PERCENT, tpROI)));
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
      if (!initial && !canFetchFeed()) return [];

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
        if (!canFetchFeed()) break;
        const added = await fetchNextPage(segmentType, false);
        attempts += 1;
        if (added.length > 0) break;
      }

      const visibleCount = segmentCache[segmentType].filter(
        (t) => !(t.address && hiddenTokenAddresses.has(t.address))
      ).length;

      if (
        attempts >= MAX_EMPTY_FETCH_ATTEMPTS &&
        visibleCount === 0 &&
        !segmentHasMore[segmentType]
      ) {
        setSegmentDepleted((prev) => ({ ...prev, [segmentType]: true }));
      }
    },
    [canFetchFeed, fetchNextPage, hiddenTokenAddresses, segmentCache, segmentHasMore]
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
    setSegmentDepleted((prev) => ({ ...prev, [segment]: false }));
    void fetchNextPage(segment, true);
  }, [fetchNextPage, segment, segmentCache]);

  useEffect(() => {
    if (!isRemoteSegment(segment)) return;
    if (loading || segmentLoadingMore[segment]) return;
    const visibleCount = segmentCache[segment].filter((t) => !(t.address && hiddenTokenAddresses.has(t.address))).length;
    if (visibleCount > 0) return;
    if (hiddenTokenAddresses.size === 0) return;
    if (recoveredHiddenRef.current) return;

    recoveredHiddenRef.current = true;
    setHiddenTokenAddresses(new Set());
    void AsyncStorage.setItem(HIDDEN_TOKENS_KEY, JSON.stringify([]));
    loadedAddressRef.current[segment] = new Set<string>();
    setSegmentCache((prev) => ({ ...prev, [segment]: [] }));
    setSegmentCursor((prev) => ({ ...prev, [segment]: null }));
    setSegmentHasMore((prev) => ({ ...prev, [segment]: true }));
    setSegmentDepleted((prev) => ({ ...prev, [segment]: false }));
    void fetchNextPage(segment, true);
  }, [
    fetchNextPage,
    hiddenTokenAddresses,
    loading,
    segment,
    segmentCache,
    segmentLoadingMore,
  ]);

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
              walletAddress: resolvedWalletAddress,
              tokenAddress: token.address,
              amountUsd: Math.max(MIN_TRADE_AMOUNT_USD, Number.isFinite(tradeAmount) ? tradeAmount : MIN_TRADE_AMOUNT_USD),
              slippageBps,
            }),
          });
          const swapJson = await parseApiJson<{
            error?: string;
            swapTransaction?: string;
            quote?: { inAmount?: string; outAmount?: string; inputMint?: string; outputMint?: string };
          }>(swapRes);
          if (!swapRes.ok || !swapJson?.swapTransaction) {
            throw new Error(swapJson?.error || 'Failed to build Jupiter swap transaction');
          }

          const provider = await getEmbeddedSolanaProvider();
          const unsignedTxBytes = Uint8Array.from(Buffer.from(swapJson.swapTransaction, 'base64'));
          let signedTxBytes: Uint8Array | null = null;

          if (provider && typeof provider.signTransaction === 'function') {
            const signed = await provider.signTransaction({ transaction: unsignedTxBytes });
            signedTxBytes = signed?.signedTransaction ? Uint8Array.from(signed.signedTransaction) : null;
          } else if (provider && typeof provider.request === 'function') {
            const signed = await provider.request({
              method: 'signTransaction',
              params: { transaction: unsignedTxBytes },
            });
            signedTxBytes = signed?.signedTransaction ? Uint8Array.from(signed.signedTransaction) : null;
          }

          if (!signedTxBytes) {
            throw new Error('Embedded wallet could not sign transaction.');
          }

          const signedTx = VersionedTransaction.deserialize(signedTxBytes);
          const connection = new Connection(SOLANA_MAINNET_RPC, 'confirmed');
          const signature = await connection.sendRawTransaction(signedTx.serialize(), {
            skipPreflight: false,
            maxRetries: 3,
          });
          await connection.confirmTransaction(signature, 'confirmed');

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
    [activeChain, getEmbeddedSolanaProvider, getOrCreateLocalUserId, getOrCreateTradingWalletAddress, tradeAmount, tradingWalletAddress, userId]
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
      const targetRoi = Number.isFinite(tpROI) ? Math.max(MIN_PERCENT, tpROI) : MIN_PERCENT;

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
    if (!twitterProfile) {
      setShowTwitterPrompt(true);
      return;
    }
    hideToken(token.address);
  }, [hideToken, twitterProfile]);

  const handleBuy = useCallback(
    (token: SwipeToken) => {
      if (!twitterProfile) {
        setShowTwitterPrompt(true);
        return;
      }
      console.log('[TRADE][SWIPE_RIGHT] token selected', {
        symbol: token.symbol,
        address: token.address,
        priceUsd: token.priceUsd,
      });
      void (async () => {
        setBuyLoading(true);
        try {
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
            const message = String(error?.message || '');
            const isNotTradable =
              message.includes('TOKEN_NOT_TRADABLE') || message.toLowerCase().includes('not tradable');
            console.log('[TRADE][SWIPE_RIGHT] swap failed', {
              symbol: token.symbol,
              address: token.address,
              message,
              isNotTradable,
            });
            if (isNotTradable) {
              hideToken(token.address);
              Alert.alert('Token skipped', `${token.symbol.toUpperCase()} is not tradable right now.`);
              return;
            }
            Alert.alert('Swap Failed', message || 'Unable to execute on-chain swap.');
            return;
          }

          const ok = await createOrder(token, swapMeta);
          if (!ok) {
            Alert.alert('Order Failed', `Unable to execute ${token.symbol.toUpperCase()} order.`);
            return;
          }
          setTradeOpenPopup({
            visible: true,
            tokenName: token.name,
            tokenSymbol: token.symbol.toUpperCase(),
            amountUsd: Math.max(MIN_TRADE_AMOUNT_USD, Number.isFinite(tradeAmount) ? tradeAmount : MIN_TRADE_AMOUNT_USD),
            tpRoi: Number.isFinite(tpROI) ? tpROI : 0,
            txSignature: swapMeta?.signature || '',
          });
          hideToken(token.address);

          setFavoriteTokens((prev) => {
            const next = prev.filter((item) => item.address !== token.address);
            persistFavorites(next);
            setFavoriteAddresses(new Set(next.map((f) => f.address)));
            return next;
          });
        } finally {
          setBuyLoading(false);
        }
      })();
    },
    [createOrder, executeJupiterSwap, hideToken, persistFavorites, tpROI, tradeAmount, twitterProfile]
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
      const next = Math.max(MIN_PERCENT, Math.min(200, tpROI + delta));
      setTpROI(Number(next.toFixed(2)));
    },
    [setTpROI, tpROI]
  );

  const updateStopLoss = useCallback(
    (delta: number) => {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => undefined);
      const next = Math.max(MIN_PERCENT, Math.min(50, stopLoss + delta));
      setStopLoss(Number(next.toFixed(2)));
    },
    [setStopLoss, stopLoss]
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

  useEffect(() => {
    if (!tradeOpenPopup.visible) return;
    const timer = setTimeout(() => {
      setTradeOpenPopup((prev) => ({ ...prev, visible: false }));
    }, 2500);
    return () => clearTimeout(timer);
  }, [tradeOpenPopup.visible]);

  return (
    <GestureHandlerRootView style={styles.root}>
      <SafeAreaView edges={['top']} style={styles.safeArea}>
        <View style={styles.screen}>
          <View style={styles.topBarWrap}>
            <View style={styles.topProfileRow}>
              <View style={styles.brandWrap}>
                <Text style={styles.brandText}>MemeSwipe</Text>
              </View>
              <ProfileButton
                onPress={() => profileSheetRef.current?.open()}
                onLongPress={openDevWalletControls}
                initials={(profileName.trim().slice(0, 2) || 'TR').toUpperCase()}
                disabled={appLoading}
              />
            </View>
            <View style={styles.controlsRowWrap}>
              <View style={styles.controlsRow}>
                <View style={styles.controlSlot}>
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
                </View>
                <View style={styles.controlSlot}>
                  <GlassControlPill
                    label="ROI"
                    value={tpROI}
                    suffix="%"
                    onMinus={() => updateTpRoi(-0.1)}
                    onPlus={() => updateTpRoi(0.1)}
                    onCommit={(v) => setTpROI(Math.max(MIN_PERCENT, Math.min(200, v)))}
                  />
                </View>
                <View style={styles.controlSlot}>
                  <GlassControlPill
                    label="TL"
                    value={stopLoss}
                    suffix="%"
                    onMinus={() => updateStopLoss(-0.1)}
                    onPlus={() => updateStopLoss(0.1)}
                    onCommit={(v) => setStopLoss(Math.max(MIN_PERCENT, Math.min(50, v)))}
                  />
                </View>
              </View>
            </View>
          <View style={styles.filterRow}>
            <Text style={styles.segmentLabel}>Trending</Text>
            <Pressable
              onPress={() => setSegment((prev) => (prev === 'favorites' ? 'trending' : 'favorites'))}
              style={[styles.favoritesToggle, segment === 'favorites' && styles.favoritesToggleActive]}
            >
              <Text style={[styles.favoritesToggleText, segment === 'favorites' && styles.favoritesToggleTextActive]}>
                Favorites
              </Text>
            </Pressable>
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
              isInteractionLocked={appLoading || creatingOrder || buyLoading}
              onSwipeStateChange={setIsSwiping}
              onActiveCardChange={handleActiveCardChange}
              emptyTitle={
                segment === 'favorites'
                  ? '❤️ No favorites yet'
                  : (loading || (isRemoteSegment(segment) && segmentLoadingMore[segment]))
                    ? 'Loading tokens...'
                  : isRemoteSegment(segment) && segmentDepleted[segment]
                    ? 'No more tokens available right now'
                    : 'Deck complete'
              }
              emptySubtitle={
                segment === 'favorites'
                  ? 'Tap the heart to save tokens for later'
                  : (loading || (isRemoteSegment(segment) && segmentLoadingMore[segment]))
                    ? 'Please wait while we fetch market data.'
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
        <LoadingOverlay visible={creatingOrder || buyLoading} text="Executing trade..." />
        {showTwitterPrompt ? (
          <View style={styles.connectPromptOverlay} pointerEvents="auto">
            <BlurView intensity={58} tint="dark" style={styles.connectPromptBackdrop} />
            <View style={styles.connectPromptBackdropDim} />
            <View style={styles.connectPromptCard}>
              <View style={styles.connectPromptIconWrap}>
                <LinearGradient
                  colors={['rgba(29,155,240,0.25)', 'rgba(29,155,240,0.08)']}
                  style={styles.connectPromptIconRing}
                >
                  <View style={styles.connectPromptIconCircle}>
                    <FontAwesome name="twitter" size={24} color="#1D9BF0" />
                  </View>
                </LinearGradient>
              </View>
              <Text style={styles.connectPromptTitle}>Connect Account</Text>
              <Text style={styles.connectPromptText}>
                Link your Twitter profile to enable real-time sentiment analysis and automated trading execution.
              </Text>
              <View style={styles.connectPromptActions}>
                <Pressable
                  onPress={connectTwitter}
                  disabled={twitterConnectLoading || checkingTwitter}
                  style={({ pressed }) => [
                    styles.connectPromptBtn,
                    styles.connectPromptBtnPrimary,
                    pressed && styles.connectPromptBtnPressed,
                    (twitterConnectLoading || checkingTwitter) && { opacity: 0.7 },
                  ]}
                >
                  <Text style={styles.connectPromptBtnPrimaryText}>
                    {twitterConnectLoading ? "CONNECTING..." : "CONNECT TWITTER"}
                  </Text>
                </Pressable>
                <Pressable
                  onPress={() => setShowTwitterPrompt(false)}
                  style={({ pressed }) => [
                    styles.connectPromptBtn,
                    styles.connectPromptBtnSecondary,
                    pressed && styles.connectPromptBtnPressed,
                  ]}
                >
                  <Text style={styles.connectPromptBtnSecondaryText}>MAYBE LATER</Text>
                </Pressable>
              </View>
              <Text style={styles.connectPromptFooter}>By connecting, you agree to the Terms of Service</Text>
            </View>
          </View>
        ) : null}
        {tradeOpenPopup.visible ? (
          <View style={styles.tradePopupOverlay} pointerEvents="box-none">
            <View style={styles.tradePopupCard}>
              <LinearGradient
                colors={['rgba(74,222,128,0.24)', 'rgba(56,189,248,0.16)']}
                style={styles.tradePopupGlow}
              />
              <Text style={styles.tradePopupTitle}>Trade Opened</Text>
              <Text style={styles.tradePopupText}>
                {tradeOpenPopup.tokenName} ({tradeOpenPopup.tokenSymbol})
              </Text>
              <Text style={styles.tradePopupMeta}>
                Amount ${tradeOpenPopup.amountUsd.toFixed(4)} | TP {tradeOpenPopup.tpRoi.toFixed(2)}%
              </Text>
              {tradeOpenPopup.txSignature ? (
                <Text style={styles.tradePopupSig}>
                  Tx: {tradeOpenPopup.txSignature.slice(0, 8)}...{tradeOpenPopup.txSignature.slice(-8)}
                </Text>
              ) : null}
              <Pressable
                style={styles.tradePopupButton}
                onPress={() => setTradeOpenPopup((prev) => ({ ...prev, visible: false }))}
              >
                <Text style={styles.tradePopupButtonText}>Awesome</Text>
              </Pressable>
            </View>
          </View>
        ) : null}
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
  topProfileRow: {
    width: '100%',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingTop: 8,
    paddingBottom: 8,
  },
  brandWrap: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
    backgroundColor: 'rgba(255,255,255,0.03)',
  },
  brandText: {
    color: '#eaf1ff',
    fontSize: 13,
    fontWeight: '800',
    letterSpacing: 0.25,
  },
  controlsRowWrap: {
    width: '100%',
    paddingHorizontal: 20,
    paddingTop: 0,
  },
  controlsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  controlSlot: {
    flex: 1,
  },
  filterRow: {
    paddingHorizontal: 20,
    paddingTop: 10,
    paddingBottom: 6,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  segmentLabel: {
    color: '#f3f7ff',
    fontSize: 20,
    fontWeight: '800',
    letterSpacing: 0.2,
  },
  favoritesToggle: {
    borderRadius: 999,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.14)',
    backgroundColor: 'rgba(255,255,255,0.04)',
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  favoritesToggleActive: {
    borderColor: 'rgba(255,128,153,0.45)',
    backgroundColor: 'rgba(255,107,129,0.16)',
  },
  favoritesToggleText: {
    color: 'rgba(225,235,255,0.76)',
    fontSize: 13,
    fontWeight: '700',
  },
  favoritesToggleTextActive: {
    color: '#ffd6df',
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
    width: '100%',
  },
  controlInner: {
    minHeight: 40,
    borderRadius: 999,
    paddingHorizontal: 5,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
    backgroundColor: 'rgba(255,255,255,0.06)',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  controlButton: {
    width: 24,
    height: 24,
    borderRadius: 12,
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
    minWidth: 0,
    flex: 1,
    alignItems: 'center',
  },
  controlLabel: {
    color: 'rgba(214,224,255,0.72)',
    fontSize: 9,
    fontWeight: '600',
    letterSpacing: 0.35,
    textTransform: 'uppercase',
  },
  controlValue: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '700',
  },
  controlInput: {
    minWidth: 56,
    height: 26,
    borderRadius: 8,
    backgroundColor: 'rgba(255,255,255,0.1)',
    color: '#fff',
    textAlign: 'center',
    fontSize: 12,
    fontWeight: '700',
    paddingHorizontal: 6,
  },
  tradePopupOverlay: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'rgba(3,7,12,0.58)',
    paddingHorizontal: 20,
    zIndex: 90,
  },
  tradePopupCard: {
    width: '100%',
    maxWidth: 360,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.18)',
    backgroundColor: 'rgba(8,14,28,0.98)',
    paddingHorizontal: 18,
    paddingVertical: 16,
    gap: 8,
    overflow: 'hidden',
  },
  tradePopupGlow: {
    ...StyleSheet.absoluteFillObject,
  },
  tradePopupTitle: {
    color: '#7ff2a9',
    fontSize: 22,
    fontWeight: '800',
  },
  tradePopupText: {
    color: '#e8f2ff',
    fontSize: 17,
    fontWeight: '700',
  },
  tradePopupMeta: {
    color: '#a9c2ea',
    fontSize: 13,
    fontWeight: '600',
  },
  tradePopupSig: {
    color: '#7ca3d8',
    fontSize: 12,
    fontWeight: '600',
  },
  tradePopupButton: {
    marginTop: 8,
    borderRadius: 12,
    backgroundColor: '#dff0ff',
    paddingVertical: 10,
    alignItems: 'center',
  },
  tradePopupButtonText: {
    color: '#112644',
    fontSize: 15,
    fontWeight: '800',
  },
  connectPromptOverlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 22,
    paddingBottom: 0,
    zIndex: 220,
    elevation: 220,
  },
  connectPromptBackdrop: {
    ...StyleSheet.absoluteFillObject,
  },
  connectPromptBackdropDim: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(2,4,10,0.64)',
  },
  connectPromptCard: {
    width: '100%',
    maxWidth: 360,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: 'rgba(29,155,240,0.24)',
    backgroundColor: 'rgba(10,14,24,0.94)',
    paddingHorizontal: 14,
    paddingVertical: 14,
    shadowColor: '#000',
    shadowOpacity: 0.55,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 10 },
    elevation: 16,
  },
  connectPromptIconWrap: {
    alignItems: 'center',
    marginTop: 2,
  },
  connectPromptIconRing: {
    width: 72,
    height: 72,
    borderRadius: 36,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 1,
  },
  connectPromptIconCircle: {
    width: 70,
    height: 70,
    borderRadius: 35,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
    backgroundColor: 'rgba(255,255,255,0.02)',
  },
  connectPromptTitle: {
    marginTop: 8,
    textAlign: 'center',
    color: '#fff',
    fontSize: 26,
    fontWeight: '600',
  },
  connectPromptText: {
    marginTop: 10,
    color: '#9fb1d9',
    fontSize: 12,
    lineHeight: 18,
    textAlign: 'center',
  },
  connectPromptActions: {
    marginTop: 14,
    gap: 10,
  },
  connectPromptBtn: {
    borderRadius: 6,
    minHeight: 52,
    alignItems: 'center',
    justifyContent: 'center',
  },
  connectPromptBtnPressed: {
    opacity: 0.86,
  },
  connectPromptBtnSecondary: {
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.18)',
    backgroundColor: 'transparent',
  },
  connectPromptBtnPrimary: {
    backgroundColor: '#1D9BF0',
  },
  connectPromptBtnSecondaryText: {
    color: '#8f8ca0',
    fontSize: 12,
    letterSpacing: 1.4,
    fontWeight: '700',
  },
  connectPromptBtnPrimaryText: {
    color: '#07141f',
    fontSize: 11,
    letterSpacing: 1.6,
    fontWeight: '800',
  },
  connectPromptFooter: {
    marginTop: 12,
    textAlign: 'center',
    color: 'rgba(170,165,180,0.5)',
    fontSize: 10,
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
    if (isDollar) return n.toFixed(4).replace(/\.?0+$/, '');
    return n.toFixed(2).replace(/\.?0+$/, '');
  }, [isDollar]);
  const [draft, setDraft] = useState(formatAmount(value));

  useEffect(() => {
    if (!editing) setDraft(formatAmount(value));
  }, [editing, formatAmount, value]);

  const commit = () => {
    const normalizedDraft = isDollar ? draft.replace(/[^0-9.]/g, '') : draft;
    const next = Number(normalizedDraft);
    onCommit(Number.isFinite(next) ? next : isDollar ? MIN_TRADE_AMOUNT_USD : MIN_PERCENT);
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
              {isDollar ? `${suffix}${formatAmount(value)}` : `${formatAmount(value)}${suffix}`}
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
