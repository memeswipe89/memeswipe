import AsyncStorage from '@react-native-async-storage/async-storage';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, Pressable, StyleSheet, Text, View } from 'react-native';
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
import { useRouter } from 'expo-router';

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
import { API_BASE, JUP_API_KEY } from '@/lib/api-base';
const SOLANA_MAINNET_RPC = 'https://api.mainnet-beta.solana.com';
const SOL_MINT = 'So11111111111111111111111111111111111111112';
const MIN_SOL_RESERVE_FOR_FEES = 0.01;
const SWAP_SLIPPAGE_RETRY_BPS = [100, 300, 800, 1500, 3000, 5000];
const JUPITER_BASE_URLS = ['https://api.jup.ag/swap/v1', 'https://lite-api.jup.ag/swap/v1'];
const FAVORITES_KEY = '@memeswipe:favorites:v1';
const HIDDEN_TOKENS_KEY = '@memeswipe:hidden-tokens:v1';
const LAST_AMOUNT_KEY = '@memeswipe:lastAmount';
const LAST_ROI_KEY = '@memeswipe:lastROI';
const BONUS_2000_APPLIED_KEY = '@memeswipe:bonus2000:applied';
const TWITTER_PROFILE_CACHE_KEY = '@memeswipe:twitterProfile:v1';
const LOCAL_USER_ID_KEY = '@memeswipe:userId:v1';
const PAGE_LIMIT = 50;
const INITIAL_PAGE_LIMIT = 12;
const LOW_DECK_THRESHOLD = 5;
const MAX_EMPTY_FETCH_ATTEMPTS = 3;
const INITIAL_DECK_RETRY_MS = 1200;
const FEED_FETCH_TIMEOUT_MS = 7000;
const MIN_TRADE_AMOUNT_USD = 0.0001;
const MAX_TRADE_AMOUNT_USD = 500;
const MIN_PERCENT = 0.1;
const TWITTER_CONNECTION_TIMEOUT_MS = 5000;
const TWITTER_AUTH_START_TIMEOUT_MS = 10000;
const MAX_FAVORITES = 12;
type FavoriteToken = {
  address: string;
  name: string;
  symbol: string;
  chain: string;
  likedAt: number;
  priceUsd: number;
  liquidityUsd: number;
  volume24hUsd: number;
  marketCapUsd: number;
  change24hPct: number;
  chartData: number[];
  source?: string;
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
  source?: string;
  tradeRoute?: "jupiter" | "bags";
  isTradable?: boolean;
  tradableReason?: string;
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

const matchesFavoriteSource = (item: FavoriteToken, source: 'pumpfun' | 'bags') => {
  if (source === 'bags') {
    return item.source === 'bags' || item.chain === 'base';
  }
  return item.source !== 'bags';
};

const favoriteTokenToSwipe = (item: FavoriteToken): SwipeToken => ({
  name: item.name,
  symbol: item.symbol,
  address: item.address,
  priceUsd: item.priceUsd,
  liquidityUsd: item.liquidityUsd,
  volume24hUsd: item.volume24hUsd,
  marketCapUsd: item.marketCapUsd,
  change24hPct: item.change24hPct,
  chartData: item.chartData.length ? item.chartData : buildFallbackChart(item.priceUsd),
  graduationTime: item.chain === 'base' ? 'Favorite • Base' : 'Favorite',
  source: item.source || (item.chain === 'base' ? 'bags' : 'pumpfun'),
  chain: item.chain,
});

const buildFavoriteDeckTokens = (items: FavoriteToken[], source: 'pumpfun' | 'bags') =>
  items.filter((item) => matchesFavoriteSource(item, source)).map(favoriteTokenToSwipe);

const mapApiToken = (token: ApiToken): SwipeToken => {
  const price = toNumber(token.priceUsd, 0);
  const chart =
    Array.isArray(token.chartData) && token.chartData.length > 1
      ? token.chartData.map((n) => toNumber(n, price || 1)).slice(-288)
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
    source: token.source,
    tradeRoute: token.tradeRoute,
    isTradable: token.isTradable ?? true,
    tradableReason: token.tradableReason || undefined,
  };
};

const SourceTab = ({
  label,
  enabled,
  onPress,
}: {
  label: string;
  enabled: boolean;
  onPress: () => void;
}) => (
  <Pressable
    onPress={onPress}
    style={[styles.sourceTab, enabled && styles.sourceTabActive]}
    android_ripple={{ color: 'rgba(255,255,255,0.06)' }}
  >
    <Text style={[styles.sourceTabText, enabled && styles.sourceTabTextActive]}>{label}</Text>
  </Pressable>
);

const mergeLiveUpdate = (prev: SwipeToken, incoming: SwipeToken): SwipeToken => {
  const history = [...prev.chartData, incoming.priceUsd].slice(-288);

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

const normalizeJupiterError = (error: unknown) => {
  const raw = String((error as any)?.message || error || '');
  try {
    const parsed = JSON.parse(raw);
    if (parsed?.message) return String(parsed.message);
  } catch {
    // ignore
  }
  return raw;
};

void WebBrowser.maybeCompleteAuthSession();

export default function HomeScreen() {
  const router = useRouter();
  const {
    privyUserId,
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
  const [initialDeckPending, setInitialDeckPending] = useState(true);
  const [creatingOrder, setCreatingOrder] = useState(false);
  const [buyLoading, setBuyLoading] = useState(false);
  const [tokens, setTokens] = useState<SwipeToken[]>([]);
  const [activeSource, setActiveSource] = useState<'pumpfun' | 'bags'>('pumpfun');
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
  const initialRetryScheduledRef = useRef<Record<RemoteSegment, boolean>>(makeSegmentMap(() => false));
  const recoveredHiddenRef = useRef(false);
  const bootstrapCheckedRef = useRef(false);
  const lastFeedFetchRef = useRef(0);
  const blockedUntilRef = useRef(0);
  const retryDelayRef = useRef(10000);

  useEffect(() => {
    console.log('[FILTERS] activeSource=', activeSource);
  }, [activeSource]);

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
          if (options?.allowStale && twitterProfile) {
            setShowTwitterPrompt(false);
            return;
          }
          if (res.status === 404) {
            if (privyUserId && twitterProfile) {
              setShowTwitterPrompt(false);
              return;
            }
            setTwitterProfile(null);
            setShowTwitterPrompt(false);
            await AsyncStorage.removeItem(TWITTER_PROFILE_CACHE_KEY);
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
    [privyUserId, setTwitterProfile, twitterProfile]
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
        const reason = parsed.queryParams?.reason;
        Alert.alert(
          "Twitter Connect",
          `Twitter connection failed${error ? `: ${error}` : "."}${typeof reason === "string" ? `\n${reason}` : ""}`
        );
        return;
      }

      const callbackUserId = parsed.queryParams?.userId;
      if (typeof callbackUserId === "string" && callbackUserId.length > 0) {
        void AsyncStorage.setItem(LOCAL_USER_ID_KEY, callbackUserId);
        setUserId(callbackUserId);
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
      const identityForTwitterCheck = (privyUserId || "").trim() || localUserId;
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

      await checkTwitterConnection(identityForTwitterCheck, { background: hasCachedProfile, allowStale: hasCachedProfile });
    })();

    return () => sub.remove();
  }, [checkTwitterConnection, getOrCreateLocalUserId, handleTwitterRedirect, privyUserId, setTwitterProfile]);

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

      const contentType = startRes.headers.get('content-type') || '';
      if (contentType.includes('text/html')) {
        throw new Error(
          `Twitter auth route missing on API. API_BASE=${API_BASE} (got HTML ${startRes.status}). Redeploy API with /api/twitter/auth/start.`
        );
      }

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
          const now = Date.now();
          const normalized: FavoriteToken[] = parsed
            .map((item, index) => {
              const fallbackLikedAt = now - (parsed.length - index);
              if (typeof item === 'string') {
                return {
                  address: item,
                  name: item.slice(0, 6),
                  symbol: 'FAV',
                  chain: 'solana',
                  likedAt: fallbackLikedAt,
                  priceUsd: 0,
                  liquidityUsd: 0,
                  volume24hUsd: 0,
                  marketCapUsd: 0,
                  change24hPct: 0,
                  chartData: buildFallbackChart(0),
                };
              }
              if (!item?.address || !item?.symbol) return null;
              const price = toNumber(item.priceUsd, 0);
              const chart =
                Array.isArray(item.chartData) && item.chartData.length > 1
                  ? item.chartData.map((n) => toNumber(n, price || 0))
                  : buildFallbackChart(price);
              return {
                address: item.address,
                name: item.name || item.symbol,
                symbol: item.symbol,
                chain: item.chain || 'solana',
                likedAt: typeof item.likedAt === 'number' ? item.likedAt : fallbackLikedAt,
                priceUsd: price,
                liquidityUsd: toNumber(item.liquidityUsd, 0),
                volume24hUsd: toNumber(item.volume24hUsd, 0),
                marketCapUsd: toNumber(item.marketCapUsd, 0),
                change24hPct: toNumber(item.change24hPct, 0),
                chartData: chart,
                source: item.source,
              };
            })
            .filter((item): item is FavoriteToken => Boolean(item));
          const trimmed = [...normalized]
            .sort((a, b) => b.likedAt - a.likedAt)
            .slice(0, MAX_FAVORITES);
          setFavoriteTokens(trimmed);
          setFavoriteAddresses(new Set(trimmed.map((f) => f.address)));
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
        const limit = initial ? INITIAL_PAGE_LIMIT : PAGE_LIMIT;
        const q = cursor
          ? `?limit=${limit}&cursor=${encodeURIComponent(cursor)}`
          : `?limit=${limit}`;

        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), FEED_FETCH_TIMEOUT_MS);
        const res = await fetch(`${API_BASE}${endpoint}${q}`, { signal: controller.signal });
        clearTimeout(timeoutId);
        if (!res.ok) {
          onFeedError(res.status);
          return [];
        }
        onFeedSuccess();
        const data = (await res.json()) as { tokens?: ApiToken[]; cursor?: string | null };
        const incoming = Array.isArray(data.tokens) ? data.tokens.map(mapApiToken) : [];
        if (incoming.length === 0) return [];
        const seen = loadedAddressRef.current[segmentType];

        const filtered = incoming.filter((token) => {
          if (!token.address) return false;
          if (hiddenTokenAddresses.has(token.address)) return false;
          return true;
        });

        const deduped = [];
        for (const token of filtered) {
          if (!seen.has(token.address)) {
            seen.add(token.address);
            deduped.push(token);
          }
        }

        if (!deduped.length && filtered.length) {
          // if dedup eliminated everything, still add the filtered batch so we keep cards flowing
          filtered.forEach((token) => seen.add(token.address));
        }

        const tokensToAdd = deduped.length > 0 ? deduped : filtered;
        if (tokensToAdd.length > 0) {
          setSegmentCache((prev) => ({
            ...prev,
            [segmentType]: [...prev[segmentType], ...tokensToAdd],
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

  const segmentCacheLength = isRemoteSegment(segment) ? segmentCache[segment].length : 0;

  useEffect(() => {
    if (!isRemoteSegment(segment)) {
      setInitialDeckPending(false);
      return;
    }
    const shouldKeepPending =
      segmentCacheLength === 0 &&
      (segmentLoadingMore[segment] || segmentHasMore[segment]);
    setInitialDeckPending(shouldKeepPending);
    initialRetryScheduledRef.current[segment] = false;
  }, [segment, segmentCacheLength, segmentHasMore, segmentLoadingMore]);

  useEffect(() => {
    if (!isRemoteSegment(segment)) return;
    if (!initialDeckPending) return;
    if (segmentCacheLength > 0) return;
    if (segmentLoadingMore[segment]) return;
    if (!segmentHasMore[segment]) return;
    if (initialRetryScheduledRef.current[segment]) return;

    initialRetryScheduledRef.current[segment] = true;
    const retryTimer = setTimeout(() => {
      void fetchNextPage(segment, true);
    }, INITIAL_DECK_RETRY_MS);

    return () => clearTimeout(retryTimer);
  }, [fetchNextPage, initialDeckPending, segment, segmentCacheLength, segmentHasMore, segmentLoadingMore]);

  useEffect(() => {
    if (!isRemoteSegment(segment)) return;
    if (segmentCacheLength > 0) return;
    setSegmentDepleted((prev) => {
      if (prev[segment] === false) return prev;
      return { ...prev, [segment]: false };
    });
    void fetchNextPage(segment, true);
  }, [fetchNextPage, segment, segmentCacheLength]);

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

  const applyFavoriteUpdate = useCallback(
    (next: FavoriteToken[]) => {
      const sorted = [...next].sort((a, b) => b.likedAt - a.likedAt);
      const trimmed = sorted.slice(0, MAX_FAVORITES);
      persistFavorites(trimmed);
      setFavoriteAddresses(new Set(trimmed.map((f) => f.address)));
      if (segment === 'favorites') {
        setTokens(buildFavoriteDeckTokens(trimmed, activeSource));
      }
      return trimmed;
    },
    [activeSource, persistFavorites, segment]
  );

  const removeFavoriteToken = useCallback(
    (address: string) => {
      if (!address) return;
      setFavoriteTokens((prev) => {
        if (!prev.some((item) => item.address === address)) {
          return prev;
        }
        const next = prev.filter((item) => item.address !== address);
        return applyFavoriteUpdate(next);
      });
    },
    [applyFavoriteUpdate]
  );

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
      if (exists) {
        const next = prev.filter((item) => item.address !== token.address);
        return applyFavoriteUpdate(next);
      }
      const basePrice = toNumber(token.priceUsd, 0);
      const next = [
        ...prev.filter((item) => item.address !== token.address),
        {
          address: token.address,
          name: token.name,
          symbol: token.symbol,
          chain: activeChain,
          likedAt: Date.now(),
          priceUsd: basePrice,
          liquidityUsd: toNumber(token.liquidityUsd, 0),
          volume24hUsd: toNumber(token.volume24hUsd, 0),
          marketCapUsd: toNumber(token.marketCapUsd, 0),
          change24hPct: toNumber(token.change24hPct, 0),
          chartData:
            Array.isArray(token.chartData) && token.chartData.length > 0
              ? token.chartData.map((n) => toNumber(n, basePrice || 0))
              : buildFallbackChart(basePrice),
          source: token.source || (activeChain === 'base' ? 'bags' : 'pumpfun'),
        },
      ];
      return applyFavoriteUpdate(next);
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
  }, [activeChain, applyFavoriteUpdate, getOrCreateLocalUserId, twitterProfile?.id, twitterProfile?.username, userId]);

  const executeJupiterSwap = useCallback(
    async (token: SwipeToken) => {
      if (!token.address) {
        throw new Error('Token address missing in API response');
      }
      if (activeChain !== 'solana') {
        throw new Error('On-chain swaps are currently enabled only for Solana feed.');
      }

      const resolvedWalletAddress = await getOrCreateTradingWalletAddress();
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
          const amountUsd = Math.max(MIN_TRADE_AMOUNT_USD, Number.isFinite(tradeAmount) ? tradeAmount : MIN_TRADE_AMOUNT_USD);
          const amountSol = amountUsd / liveSolPriceUsd;
          const amountLamports = Math.max(1, Math.floor(amountSol * 1_000_000_000));

          const quoteParams = new URLSearchParams({
            inputMint: SOL_MINT,
            outputMint: token.address,
            amount: String(amountLamports),
            slippageBps: String(slippageBps),
          });
          const { json: quoteJson } = await fetchJupiterJson(`/quote?${quoteParams.toString()}`);
          if (!quoteJson || quoteJson?.error) {
            throw new Error(quoteJson?.error || 'Jupiter quote failed');
          }
          if (quoteJson?.outAmount) {
            const sellParams = new URLSearchParams({
              inputMint: token.address,
              outputMint: SOL_MINT,
              amount: String(quoteJson.outAmount),
              slippageBps: String(slippageBps),
            });
            try {
              const { json: sellQuote } = await fetchJupiterJson(`/quote?${sellParams.toString()}`);
              if (!sellQuote || sellQuote?.error) {
                throw new Error('No sell route');
              }
            } catch {
              throw new Error('No sell route');
            }
          }

          const { json: swapJson } = await fetchJupiterJson('/swap', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              quoteResponse: quoteJson,
              userPublicKey: resolvedWalletAddress,
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

          const provider = await getEmbeddedSolanaProvider();
          const unsignedTx = VersionedTransaction.deserialize(Uint8Array.from(Buffer.from(swapJson.swapTransaction, 'base64')));
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
            throw new Error('Embedded wallet could not sign transaction.');
          }
          const connection = new Connection(SOLANA_MAINNET_RPC, 'confirmed');
          const signature = await connection.sendRawTransaction(signedTx.serialize(), {
            skipPreflight: false,
            maxRetries: 3,
          });
          await connection.confirmTransaction(signature, 'confirmed');

          console.log('[TRADE][SWIPE_RIGHT] on-chain swap success', {
            signature,
            slippageBps,
            inputMint: quoteJson?.inputMint || SOL_MINT,
            outputMint: quoteJson?.outputMint || token.address,
            inAmount: quoteJson?.inAmount,
            outAmount: quoteJson?.outAmount,
          });

          return {
            signature,
            inputMint: quoteJson?.inputMint || SOL_MINT,
            outputMint: quoteJson?.outputMint || token.address,
            inAmountRaw: String(quoteJson?.inAmount || ''),
            outAmountRaw: String(quoteJson?.outAmount || ''),
          };
        } catch (error: any) {
          lastError = error;
          const msg = normalizeJupiterError(error);
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
    [activeChain, getEmbeddedSolanaProvider, getOrCreateTradingWalletAddress, tradeAmount]
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
      if (!swapMeta?.signature) {
        Alert.alert('Order Failed', 'On-chain transaction signature missing. Trade not created.');
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
          txSignature: swapMeta.signature,
          inputMint: swapMeta.inputMint,
          outputMint: swapMeta.outputMint,
          inAmountRaw: swapMeta.inAmountRaw,
          outAmountRaw: swapMeta.outAmountRaw,
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

  const handleReject = useCallback(
    (token: SwipeToken) => {
      hideToken(token.address);
      if (segment === 'favorites') {
        removeFavoriteToken(token.address);
      }
    },
    [hideToken, removeFavoriteToken, segment]
  );

  const handleBuy = useCallback(
    (token: SwipeToken) => {
      if (!tradingWalletAddress) {
        Alert.alert("Set up wallet", "Please create your Privy wallet first.");
        return;
      }
      if (token.source === 'bags' && token.isTradable === false) {
        const reason = token.tradableReason || 'very low liquidity';
        console.log('[BAGS][SWIPE_BLOCKED]', { symbol: token.symbol, address: token.address, reason });
        hideToken(token.address);
        Alert.alert('Token not tradable', 'Token not tradable. Very low liquidity.');
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
            const message = normalizeJupiterError(error);
            const isNotTradable =
              message.includes('TOKEN_NOT_TRADABLE') ||
              message.toLowerCase().includes('not tradable') ||
              message.toLowerCase().includes('route not found') ||
              message.toLowerCase().includes('no route') ||
              message.toLowerCase().includes('no sell route') ||
              message.includes('0x1788');
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
          removeFavoriteToken(token.address);
        } finally {
          setBuyLoading(false);
        }
      })();
    },
    [createOrder, executeJupiterSwap, hideToken, removeFavoriteToken, tpROI, tradeAmount, tradingWalletAddress]
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

  const openWalletPage = useCallback(() => {
    router.push('/wallet');
  }, [router]);

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
      setTokens(buildFavoriteDeckTokens(favoriteTokens, activeSource));
      return;
    }

    const visible = segmentCache[segment].filter((t) => !(t.address && hiddenTokenAddresses.has(t.address)));
    const filteredBySource = visible.filter((token) => {
      const source = (token.source || 'pumpfun').toLowerCase();
      return source === activeSource;
    });
    setTokens(filteredBySource);
  }, [activeChain, favoriteTokens, hiddenTokenAddresses, segment, segmentCache, activeSource]);

  useEffect(() => {
    if (!tradeOpenPopup.visible) return;
    const timer = setTimeout(() => {
      setTradeOpenPopup((prev) => ({ ...prev, visible: false }));
    }, 2500);
    return () => clearTimeout(timer);
  }, [tradeOpenPopup.visible]);

  const favoritesActive = segment === 'favorites';

  return (
    <GestureHandlerRootView style={styles.root}>
      <SafeAreaView edges={['top']} style={styles.safeArea}>
        <View style={styles.screen}>
          <View style={styles.topBarWrap}>
            <View style={styles.topProfileRow}>
              <Pressable
                onPress={openWalletPage}
                android_ripple={{ color: 'rgba(255,255,255,0.08)' }}
                style={({ pressed }) => [styles.brandAvatarButton, pressed && styles.brandAvatarButtonPressed]}
              >
                <View style={styles.brandAvatar}>
                  <Text style={styles.brandAvatarText}>{(profileName.trim().slice(0, 2) || 'TR').toUpperCase()}</Text>
                </View>
              </Pressable>
              <View style={styles.topActionsRow}>
                <Pressable
                  onPress={() => setSegment((prev) => (prev === 'favorites' ? 'trending' : 'favorites'))}
                  android_ripple={{ color: 'rgba(255,255,255,0.08)' }}
                  style={({ pressed }) => [
                    styles.favoriteIconButton,
                    favoritesActive && styles.favoriteIconButtonActive,
                    pressed && styles.favoriteIconButtonPressed,
                  ]}
                >
                  <FontAwesome
                    name={favoritesActive ? 'heart' : 'heart-o'}
                    size={20}
                    color={favoritesActive ? '#ffffff' : 'rgba(255,255,255,0.78)'}
                  />
                </Pressable>
                <ProfileButton
                  onPress={() => profileSheetRef.current?.open()}
                  onLongPress={openDevWalletControls}
                  disabled={appLoading}
                />
              </View>
            </View>
            <View style={styles.controlsRowWrap}>
            <View style={styles.simplePillRow}>
              <SimplePill label="AMT" value={`$${tradeAmount.toFixed(2)}`} />
              <SimplePill label="ROI" value={`${tpROI.toFixed(1)}%`} />
              <SimplePill label="SL" value={`${stopLoss.toFixed(0)}%`} />
            </View>
          </View>
            <View style={styles.sourceTabsWrap}>
              <View style={styles.sourceTabRow}>
                <SourceTab label="Pump.fun" enabled={activeSource === 'pumpfun'} onPress={() => setActiveSource('pumpfun')} />
                <SourceTab label="Bags" enabled={activeSource === 'bags'} onPress={() => setActiveSource('bags')} />
              </View>
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
              isLoading={loading || (isRemoteSegment(segment) && initialDeckPending && tokens.length === 0)}
              isInteractionLocked={appLoading || creatingOrder || buyLoading}
              onSwipeStateChange={setIsSwiping}
              onActiveCardChange={handleActiveCardChange}
              emptyTitle={
                segment === 'favorites'
                  ? '❤️ No favorites yet'
                  : (loading || (isRemoteSegment(segment) && (segmentLoadingMore[segment] || initialDeckPending)))
                    ? 'Loading tokens...'
                  : isRemoteSegment(segment) && segmentDepleted[segment]
                    ? 'No more tokens available right now'
                    : 'Deck complete'
              }
              emptySubtitle={
                segment === 'favorites'
                  ? 'Tap the heart to save tokens for later'
                  : (loading || (isRemoteSegment(segment) && (segmentLoadingMore[segment] || initialDeckPending)))
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
  topActionsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  brandAvatarButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    overflow: 'hidden',
  },
  brandAvatarButtonPressed: {
    opacity: 0.88,
  },
  brandAvatar: {
    flex: 1,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#3b3b3b',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
  },
  brandAvatarText: {
    color: '#151515',
    fontSize: 13,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  favoriteIconButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.14)',
    backgroundColor: '#171717',
  },
  favoriteIconButtonActive: {
    borderColor: 'rgba(255,255,255,0.2)',
    backgroundColor: '#171717',
  },
  favoriteIconButtonPressed: {
    opacity: 0.85,
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
  controlSlotAmount: {
    flex: 1.16,
  },
  controlSlotCompact: {
    flex: 0.92,
  },
  simplePillRow: {
    flexDirection: 'row',
    gap: 8,
    width: '100%',
    alignItems: 'stretch',
    justifyContent: 'space-between',
  },
  sourceTabRow: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 12,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.05)',
    backgroundColor: 'rgba(255,255,255,0.02)',
  },
  sourceTab: {
    flex: 1,
    minWidth: 0,
    paddingVertical: 10,
    alignItems: 'center',
    borderColor: 'rgba(255,255,255,0.08)',
    backgroundColor: 'rgba(255,255,255,0.04)',
  },
  sourceTabActive: {
    borderColor: 'rgba(97,180,255,0.95)',
    backgroundColor: 'rgba(97,180,255,0.2)',
  },
  sourceTabText: {
    color: 'rgba(225,235,255,0.7)',
    fontSize: 13,
    fontWeight: '700',
  },
  sourceTabTextActive: {
    color: '#fff',
  },
  sourceTabsWrap: {
    paddingHorizontal: 20,
    paddingTop: 10,
    paddingBottom: 6,
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
  simplePill: {
    flex: 1,
    flexDirection: 'row',
    backgroundColor: '#1c1c1e',
    borderRadius: 999,
    paddingHorizontal: 16,
    paddingVertical: 12,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  simplePillLabel: {
    color: 'rgba(255,255,255,0.45)',
    fontSize: 13,
    letterSpacing: 1,
    fontWeight: '600',
  },
  simplePillValue: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '700',
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

const SimplePill = ({ label, value }: { label: string; value: string }) => (
  <View style={styles.simplePill}>
    <Text style={styles.simplePillLabel}>{label}</Text>
    <Text style={styles.simplePillValue}>{value}</Text>
  </View>
);
