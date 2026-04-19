import React, { memo, useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Clipboard, Dimensions, Linking, Pressable, StyleSheet, Text, View } from 'react-native';
import { Image } from 'expo-image';
import * as Haptics from 'expo-haptics';
import { BlurView } from 'expo-blur';
import { LinearGradient as ExpoLinearGradient } from 'expo-linear-gradient';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import Svg, { Path, G } from 'react-native-svg';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  Easing,
  Extrapolation,
  FadeIn,
  FadeOut,
  interpolate,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withSequence,
  withTiming,
} from 'react-native-reanimated';
import TradeChart from '@/components/trade-chart';
import LiveChartModal from '@/components/live-chart-modal';
import { getPriceHistory } from '@/lib/getPriceHistory';

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');
const SWIPE_THRESHOLD = SCREEN_WIDTH * 0.25;
const SWIPE_UP_THRESHOLD = SCREEN_HEIGHT * 0.15;
const SWIPE_OUT_DISTANCE = SCREEN_WIDTH * 1.3;
const SWIPE_UP_DISTANCE = -SCREEN_HEIGHT * 0.8;
const INTENTIONAL_EASING = Easing.bezier(0.22, 1, 0.36, 1);
const MOTION = {
  quick: 220,
  medium: 300,
};

type SwipeDirection = 'left' | 'right' | 'up';

export type SwipeToken = {
  name: string;
  symbol: string;
  address: string;
  chain?: string;
  pairAddress?: string;
  priceUsd: number;
  liquidityUsd: number;
  volume24hUsd: number;
  marketCapUsd: number;
  change24hPct: number;
  chartData: number[];
  graduationTime?: string;
  source?: string;
  tradeRoute?: "jupiter" | "bags";
  isTradable?: boolean;
  tradableReason?: string;
  imageUrl?: string;
  website?: string;
  twitter?: string;
};

type SwipeTokenDeckProps = {
  tokens: SwipeToken[];
  onBuy: (token: SwipeToken) => void;
  onReject: (token: SwipeToken) => void;
  onToggleFavorite: (token: SwipeToken) => void;
  onKeepFavorite?: (token: SwipeToken) => void;
  favoriteAddresses: Set<string>;
  isLoading?: boolean;
  isInteractionLocked?: boolean;
  resetKey?: string;
  emptyTitle?: string;
  emptySubtitle?: string;
  onSwipeStateChange?: (swiping: boolean) => void;
  onActiveCardChange?: (token: SwipeToken | null) => void;
  onRefresh?: () => void;
  isFavoritesMode?: boolean;
  onFavoritePopup?: (token: SwipeToken) => void;
};

type TokenCardProps = {
  token: SwipeToken;
  isFavorite: boolean;
  onToggleFavorite: (token: SwipeToken) => void;
};

const formatCurrency = (value: number) => {
  if (!Number.isFinite(value) || value === 0) return '$0';
  return `$${Number(value).toLocaleString('en-US', { maximumFractionDigits: 6 })}`;
};

const formatPct = (value: number) => {
  if (!Number.isFinite(value)) return '0.00%';
  const sign = value > 0 ? '+' : '';
  return `${sign}${value.toFixed(2)}%`;
};

const shortAddress = (address: string) => {
  if (!address || address.length < 10) return address;
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
};

const tokenPalette = (symbol: string) => {
  const sum = symbol.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0);
  const palettes = [
    ['#15f5ba', '#00bbf9'],
    ['#f72585', '#7209b7'],
    ['#ffd166', '#f77f00'],
    ['#90e0ef', '#4361ee'],
  ] as const;

  return palettes[sum % palettes.length];
};

const LinkIcon = ({ size = 15, color = '#7e88a8' }: { size?: number; color?: string }) => (
  <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
    <Path
      d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"
      stroke={color}
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
    />
    <Path
      d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"
      stroke={color}
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </Svg>
);

const FavoriteHeart = memo(function FavoriteHeart({
  isFavorite,
  onPress,
}: {
  isFavorite: boolean;
  onPress: () => void;
}) {
  const scale = useSharedValue(1);

  useEffect(() => {
    scale.value = withTiming(1.15, { duration: 120, easing: Easing.out(Easing.cubic) }, () => {
      scale.value = withTiming(1, { duration: 140, easing: Easing.out(Easing.cubic) });
    });
  }, [isFavorite, scale]);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }));

  return (
    <Pressable onPress={onPress} style={styles.favoriteWrap}>
      <Animated.View style={[styles.favoriteButton, animatedStyle]}>
        {isFavorite ? (
          <ExpoLinearGradient
            colors={['rgba(255,99,132,0.92)', 'rgba(255,128,180,0.62)']}
            style={styles.favoriteFill}
          >
            <Text style={styles.favoriteOn}>♥</Text>
          </ExpoLinearGradient>
        ) : (
          <Text style={styles.favoriteOff}>♡</Text>
        )}
      </Animated.View>
    </Pressable>
  );
});

const MetricRow = memo(function MetricRow({
  label,
  value,
  valueStyle,
  isLast,
}: {
  label: string;
  value: string;
  valueStyle?: object;
  isLast?: boolean;
}) {
  const flash = useSharedValue(0);
  const y = useSharedValue(0);
  useEffect(() => {
    flash.value = withSequence(withTiming(1, { duration: 140 }), withTiming(0, { duration: 220 }));
    y.value = withSequence(withTiming(-2, { duration: 100 }), withTiming(0, { duration: 180 }));
  }, [flash, value, y]);

  const animatedStyle = useAnimatedStyle(() => ({
    opacity: 0.85 + flash.value * 0.15,
    transform: [{ translateY: y.value }],
  }));

  return (
    <View style={[styles.metricRow, isLast && { borderBottomWidth: 0 }]}>
      <Text style={styles.metricLabel}>{label}</Text>
      <Animated.Text style={[styles.metricValue, valueStyle, animatedStyle]}>{value}</Animated.Text>
    </View>
  );
});

const MomentumGraph = memo(function MomentumGraph({ data }: { data: number[] }) {
  const draw = useSharedValue(0);
  useEffect(() => {
    draw.value = 0;
    draw.value = withTiming(1, { duration: 450, easing: Easing.out(Easing.cubic) });
  }, [data, draw]);

  const animatedStyle = useAnimatedStyle(() => ({
    opacity: 0.4 + draw.value * 0.6,
  }));

  return (
    <Animated.View style={[styles.graphContainer, animatedStyle]}>
      <TradeChart data={data.slice(-288)} />
    </Animated.View>
  );
});

const DeckStatusCard = memo(function DeckStatusCard({
  title,
  subtitle,
  loading = false,
  onRefresh,
}: {
  title: string;
  subtitle: string;
  loading?: boolean;
  onRefresh?: () => void;
}) {
  const [refreshing, setRefreshing] = useState(false);

  const handleRefresh = async () => {
    if (!onRefresh || refreshing) return;
    setRefreshing(true);
    await Promise.resolve(onRefresh());
    // Keep spinner visible briefly so the user sees feedback
    setTimeout(() => setRefreshing(false), 1200);
  };

  return (
    <View style={styles.emptyStateWrap}>
      <View style={styles.emptyStateOuter}>
        <BlurView intensity={24} tint="dark" style={styles.emptyState}>
          {loading || refreshing ? (
            <ActivityIndicator size="small" color="#9bc2ff" style={styles.emptySpinner} />
          ) : null}
          <Text style={styles.emptyTitle}>{title}</Text>
          <Text style={styles.emptySub}>{subtitle}</Text>
          {onRefresh && !loading && !refreshing ? (
            <Pressable onPress={handleRefresh} style={styles.reloadBtn}>
              <MaterialIcons name="refresh" size={16} color="#9bc2ff" />
              <Text style={styles.reloadBtnText}>Reload</Text>
            </Pressable>
          ) : null}
        </BlurView>
      </View>
    </View>
  );
});

const TokenCard = memo(function TokenCard({ token, isFavorite, onToggleFavorite }: TokenCardProps) {
  const palette = tokenPalette(token.symbol);
  const priceUp =
    token.chartData.length > 1
      ? token.chartData[token.chartData.length - 1] >= token.chartData[0]
      : token.change24hPct >= 0;
  const [history, setHistory] = useState<number[]>(token.chartData || []);
  const [copied, setCopied] = useState(false);
  const [chartModalVisible, setChartModalVisible] = useState(false);
  const compactCurrency = useMemo(
    () =>
      new Intl.NumberFormat('en-US', {
        style: 'currency',
        currency: 'USD',
        notation: 'compact',
        maximumFractionDigits: 1,
      }),
    []
  );

  useEffect(() => {
    let active = true;
    const refreshHistory = async () => {
      try {
        const values = await getPriceHistory(token.address, token.change24hPct);
        if (!active) return;
        if (Array.isArray(values) && values.length > 1) {
          setHistory(values);
          return;
        }
        setHistory(token.chartData || []);
      } catch {
        if (!active) return;
        setHistory(token.chartData || []);
      }
    };

    void refreshHistory();
    const intervalId = setInterval(() => {
      void refreshHistory();
    }, 15000);

    return () => {
      active = false;
      clearInterval(intervalId);
    };
  }, [token.address, token.change24hPct, token.chartData]);

  return (
    <View style={styles.cardWrap}>
      <View style={styles.card}>
        <View style={styles.cardScrollContent}>
            <FavoriteHeart isFavorite={isFavorite} onPress={() => onToggleFavorite(token)} />
            <View style={styles.contentWrapper}>
              <View style={styles.headerSection}>
                <View style={styles.headerTopRow}>
                  <View style={styles.headerTokenRow}>
                    {token.imageUrl ? (
                      <Image
                        source={{ uri: token.imageUrl }}
                        style={styles.logoCircle}
                        contentFit="cover"
                        cachePolicy="memory-disk"
                      />
                    ) : (
                      <ExpoLinearGradient colors={palette} style={styles.logoCircle}>
                        <Text style={styles.logoText}>{token.symbol.slice(0, 2).toUpperCase()}</Text>
                      </ExpoLinearGradient>
                    )}
                    <View style={styles.headerIdentity}>
                      <View style={styles.symbolRow}>
                        <Text style={styles.tokenName}>{token.symbol.toUpperCase()}</Text>
                        {/* Link icon → opens DexScreener in browser */}
                        <Pressable
                          hitSlop={8}
                          onPress={() => {
                            const url = `https://dexscreener.com/solana/${token.address}`;
                            Linking.openURL(url).catch(() => undefined);
                          }}
                        >
                          <LinkIcon size={18} color="#7e88a8" />
                        </Pressable>
                        {/* Chart icon → opens live chart modal in-app */}
                        <Pressable
                          hitSlop={8}
                          onPress={() => setChartModalVisible(true)}
                        >
                          <MaterialIcons name="show-chart" size={20} color="#7e88a8" />
                        </Pressable>
                       
                        {token.website ? (
                          <Pressable hitSlop={8} onPress={() => Linking.openURL(token.website!).catch(() => undefined)}>
                            <MaterialIcons name="language" size={18} color="#7e88a8" />
                          </Pressable>
                        ) : null}
                        {token.twitter ? (
                          <Pressable hitSlop={8} onPress={() => Linking.openURL(token.twitter!).catch(() => undefined)}>
                            <Text style={styles.socialIcon}>𝕏</Text>
                          </Pressable>
                        ) : null}
                      </View>
                      <View style={styles.addressRow}>
                        <Text style={styles.tokenFullName} numberOfLines={1}>{token.name}</Text>
                         <Pressable
                          hitSlop={12}
                          onPress={() => {
                            Clipboard.setString(token.address);
                            setCopied(true);
                            setTimeout(() => setCopied(false), 2000);
                          }}
                          style={styles.copyBtn}
                        >
                          <MaterialIcons
                            name={copied ? 'check' : 'content-copy'}
                            size={18}
                            color={copied ? '#4ade80' : '#7e88a8'}
                          />
                        </Pressable>
                      </View>
                    </View>
                  </View>
                </View>
                <View style={styles.priceRow}>
                  <Text style={styles.bigPrice}>{formatCurrency(token.priceUsd)}</Text>
                  <View style={[styles.changePill, token.change24hPct >= 0 ? styles.changePillGreen : styles.changePillRed]}>
                    <MaterialIcons
                      name={token.change24hPct >= 0 ? 'arrow-circle-up' : 'arrow-circle-down'}
                      size={15}
                      color={token.change24hPct >= 0 ? '#4ade80' : '#ff6b81'}
                    />
                    <Text style={[styles.changePillText, token.change24hPct >= 0 ? styles.greenValue : styles.redValue]}>
                      {Math.abs(token.change24hPct).toFixed(2)}%
                    </Text>
                  </View>
                </View>
                <View style={styles.statDotRow}>
                  
                 
                  <Text style={styles.statDotText}>MC {compactCurrency.format(token.marketCapUsd || 0)}</Text>
                  <Text style={styles.statDotSep}>•</Text>
                  <Text style={styles.statDotText}>24h Vol {compactCurrency.format(token.volume24hUsd || 0)}</Text>
                </View>
              </View>

              <MomentumGraph data={history.length ? history : token.chartData} />

              <View style={styles.metricsWrap}>
                <MetricRow label="Price" value={formatCurrency(token.priceUsd)} valueStyle={styles.greenValue} />
                <MetricRow label="Liquidity" value={formatCurrency(token.liquidityUsd)} />
                <MetricRow label="24h Volume" value={formatCurrency(token.volume24hUsd)} />
                <MetricRow label="Market Cap" value={formatCurrency(token.marketCapUsd)} isLast />
              </View>
            </View>

            <View style={styles.bottomActionSpace} />
        </View>
      </View>

      <LiveChartModal
        visible={chartModalVisible}
        onClose={() => setChartModalVisible(false)}
        address={token.address}
        pairAddress={token.pairAddress}
        symbol={token.symbol}
      />
    </View>
  );
});

export const SwipeTokenDeck = memo(function SwipeTokenDeck({
  tokens,
  onBuy,
  onReject,
  onToggleFavorite,
  onKeepFavorite,
  favoriteAddresses,
  isLoading = false,
  isInteractionLocked = false,
  resetKey,
  emptyTitle = 'Deck complete',
  emptySubtitle = 'No more tokens in this segment.',
  onSwipeStateChange,
  onActiveCardChange,
  onRefresh,
  isFavoritesMode = false,
  onFavoritePopup,
}: SwipeTokenDeckProps) {
  const translateX = useSharedValue(0);
  const translateY = useSharedValue(0);
  const buyFlash = useSharedValue(0);
  const buyBadge = useSharedValue(0);

  useEffect(() => {
    translateX.value = 0;
    translateY.value = 0;
  }, [resetKey, translateX, translateY]);

  // The parent removes the swiped token from `tokens`.
  // Use array head as the active card to avoid double-advancing.
  const currentToken = useMemo(() => tokens[0], [tokens]);
  const nextTokens = useMemo(() => tokens.slice(1, 4), [tokens]);

  useEffect(() => {
    onActiveCardChange?.(currentToken || null);
  }, [currentToken, onActiveCardChange]);

  const commitSwipe = useCallback(
    (direction: SwipeDirection) => {
      const token = currentToken;
      if (!token) return;

      if (direction === 'right') {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => undefined);
        buyFlash.value = 1;
        buyFlash.value = withTiming(0, { duration: 120, easing: Easing.out(Easing.cubic) });
        buyBadge.value = 1;
        buyBadge.value = withTiming(0, { duration: 300, easing: Easing.out(Easing.cubic) });
        onBuy(token);
      } else if (direction === 'up') {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => undefined);
        onKeepFavorite?.(token);
        onFavoritePopup?.(token);
      } else {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => undefined);
        onReject(token);
      }

      translateX.value = 0;
      translateY.value = 0;
    },
    [buyBadge, buyFlash, currentToken, onBuy, onKeepFavorite, onReject, translateX, translateY]
  );

  const panGesture = useMemo(
    () =>
      Gesture.Pan()
        .maxPointers(1)
        .enabled(!isInteractionLocked)
        .onBegin(() => {
          if (onSwipeStateChange) runOnJS(onSwipeStateChange)(true);
        })
        .onUpdate((event) => {
          translateX.value = event.translationX;
          // Only allow upward swipes (negative Y), prevent downward swipes
          translateY.value = Math.min(0, event.translationY);
        })
        .onEnd(() => {
          if (onSwipeStateChange) runOnJS(onSwipeStateChange)(false);
          
          // Check for up swipe first (negative Y)
          if (translateY.value < -SWIPE_UP_THRESHOLD && Math.abs(translateX.value) < SWIPE_THRESHOLD) {
            translateY.value = withTiming(SWIPE_UP_DISTANCE, {
              duration: MOTION.quick,
              easing: INTENTIONAL_EASING,
            });
            translateX.value = withTiming(0, { duration: MOTION.quick, easing: INTENTIONAL_EASING });
            runOnJS(commitSwipe)('up');
            return;
          }
          
          // Check for horizontal swipes
          if (Math.abs(translateX.value) > SWIPE_THRESHOLD) {
            const direction: SwipeDirection = translateX.value > 0 ? 'right' : 'left';
            translateX.value = withTiming(translateX.value > 0 ? SWIPE_OUT_DISTANCE : -SWIPE_OUT_DISTANCE, {
              duration: MOTION.quick,
              easing: INTENTIONAL_EASING,
            });
            translateY.value = withTiming(0, { duration: MOTION.quick, easing: INTENTIONAL_EASING });
            runOnJS(commitSwipe)(direction);
            return;
          }

          // Return to center
          translateX.value = withTiming(0, { duration: MOTION.medium, easing: INTENTIONAL_EASING });
          translateY.value = withTiming(0, { duration: MOTION.medium, easing: INTENTIONAL_EASING });
        }),
    [commitSwipe, isInteractionLocked, onSwipeStateChange, translateX, translateY]
  );

  const animatedCardStyle = useAnimatedStyle(() => {
    const rotate = interpolate(
      translateX.value,
      [-SCREEN_WIDTH, 0, SCREEN_WIDTH],
      [-13, 0, 13],
      Extrapolation.CLAMP
    );

    return {
      transform: [
        { translateX: translateX.value },
        { translateY: translateY.value },
        { rotate: `${rotate}deg` },
      ],
    };
  });

  const nextCardStyle = useAnimatedStyle(() => {
    const scale = interpolate(Math.abs(translateX.value), [0, SWIPE_THRESHOLD], [0.94, 0.99], Extrapolation.CLAMP);
    const opacity = interpolate(Math.abs(translateX.value), [0, SWIPE_THRESHOLD], [0.72, 0.98], Extrapolation.CLAMP);
    return {
      transform: [{ scale }],
      opacity,
    };
  });

  const upOverlayStyle = useAnimatedStyle(() => ({
    opacity: interpolate(translateY.value, [0, -SWIPE_UP_THRESHOLD], [0, 0.9], Extrapolation.CLAMP),
  }));

  const rightOverlayStyle = useAnimatedStyle(() => ({
    opacity: interpolate(translateX.value, [0, SWIPE_THRESHOLD], [0, 0.9], Extrapolation.CLAMP),
  }));

  const leftOverlayStyle = useAnimatedStyle(() => ({
    opacity: interpolate(translateX.value, [-SWIPE_THRESHOLD, 0], [0.9, 0], Extrapolation.CLAMP),
  }));

  const bgTintStyle = useAnimatedStyle(() => {
    const buyOpacity = interpolate(translateX.value, [0, SWIPE_THRESHOLD], [0, 0.22], Extrapolation.CLAMP);
    const rejectOpacity = interpolate(translateX.value, [-SWIPE_THRESHOLD, 0], [0.22, 0], Extrapolation.CLAMP);

    return {
      backgroundColor: `rgba(0,0,0,${0.28 + rejectOpacity + buyOpacity})`,
    };
  });

  const successFlashStyle = useAnimatedStyle(() => ({
    opacity: buyFlash.value,
  }));

  const successBadgeStyle = useAnimatedStyle(() => ({
    opacity: buyBadge.value,
    transform: [{ translateY: interpolate(buyBadge.value, [0, 1], [-6, 0], Extrapolation.CLAMP) }],
  }));

  const showLoadingState = isLoading || (!currentToken && /loading/i.test(emptyTitle));

  if (isLoading) {
    return (
      <ExpoLinearGradient colors={['#000000', '#000000', '#000000']} style={styles.container}>
        <DeckStatusCard
          title="Loading Tokens..."
          subtitle="Fetching live token data for this feed."
          loading
        />
      </ExpoLinearGradient>
    );
  }

  return (
    <ExpoLinearGradient colors={['#000000', '#000000', '#000000']} style={styles.container}>
      <Animated.View style={[styles.bgTintLayer, bgTintStyle]} />
      <Animated.View pointerEvents="none" style={[styles.successFlash, successFlashStyle]} />

      {nextTokens.map((token, idx) => (
        <Animated.View
          key={token.address}
          style={[styles.absoluteCard, styles.nextCard, { transform: [{ scale: 0.95 - idx * 0.02 }], marginTop: 10 + idx * 4 }, nextCardStyle]}>
          <TokenCard
            token={token}
            isFavorite={favoriteAddresses.has(token.address)}
            onToggleFavorite={onToggleFavorite}
          />
        </Animated.View>
      ))}

      {currentToken ? (
        <GestureDetector gesture={panGesture}>
          <Animated.View
            entering={FadeIn.duration(MOTION.quick).easing(INTENTIONAL_EASING)}
            exiting={FadeOut.duration(MOTION.quick).easing(INTENTIONAL_EASING)}
            style={[styles.absoluteCard, animatedCardStyle]}>
            <TokenCard
              token={currentToken}
              isFavorite={favoriteAddresses.has(currentToken.address)}
              onToggleFavorite={onToggleFavorite}
            />
            
            {/* Swipe overlays removed */}
            
            <Animated.View pointerEvents="none" style={[styles.successBadge, successBadgeStyle]}>
              <Text style={styles.successBadgeText}>✓</Text>
            </Animated.View>
          </Animated.View>
        </GestureDetector>
      ) : (
        <DeckStatusCard
          title={showLoadingState ? 'Loading Tokens...' : emptyTitle}
          subtitle={showLoadingState ? 'Fetching live token data for this feed.' : emptySubtitle}
          loading={showLoadingState}
          onRefresh={!showLoadingState ? onRefresh : undefined}
        />
      )}
    </ExpoLinearGradient>
  );
});

const styles = StyleSheet.create({
  container: {
    flex: 1,
    width: '100%',
    justifyContent: 'flex-start',
    alignItems: 'stretch',
    paddingHorizontal: 0,
  },
  bgTintLayer: {
    ...StyleSheet.absoluteFillObject,
  },
  glowOrb: {
    position: 'absolute',
    width: SCREEN_WIDTH * 0.9,
    height: SCREEN_WIDTH * 0.9,
    borderRadius: SCREEN_WIDTH,
    backgroundColor: 'rgba(61, 114, 255, 0.18)',
    shadowColor: '#000000ff',
    shadowOpacity: 0.3,
    shadowRadius: 60,
    shadowOffset: { width: 0, height: 20 },
    top: SCREEN_HEIGHT * 0.12,
  },
  absoluteCard: {
    position: 'absolute',
    top: 0,
    bottom: 22,
    left: 0,
    right: 0,
    width: '100%',
    alignItems: 'stretch',
  },
  nextCard: {
    transform: [{ scale: 0.95 }],
    marginTop: 10,
  },
  cardWrap: {
    flex: 1,
    width: '90%',
    alignSelf: 'center',
    borderRadius: 26,
    overflow: 'hidden',
    marginTop: 0,
    marginBottom: 0,
    backgroundColor: '#14161B',
    shadowColor: '#000',
    shadowOpacity: 0.25,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 6 },
  },
  card: {
    flex: 1,
    borderRadius: 26,
    borderWidth: 0,
    borderColor: 'rgba(255,255,255,0.06)',
    paddingVertical: 12,
    paddingHorizontal: 14,
    backgroundColor: '#111316ff',
  },
  blurCard: {
    flex: 1,
    borderRadius: 28,
    overflow: 'hidden',
  },
  glassBorder: {
    flex: 1,
    borderRadius: 26,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    paddingVertical: 14,
    paddingHorizontal: 16,
  },
  cardScrollContent: {
    flexGrow: 1,
    minHeight: '100%',
    paddingBottom: 0,
  },
  contentWrapper: {
    gap: 10,
  },
  headerSection: {
    marginBottom: 2,
    paddingRight: 0,
  },
  headerTopRow: {
    position: 'relative',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
  },
  headerTokenRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    flex: 1,
  },
  headerIdentity: {
    gap: 2,
  },
  favoriteWrap: {
    position: 'absolute',
    right: 4,
    top: 4,
    zIndex: 10,
  },
  favoriteButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    justifyContent: 'center',
    alignItems: 'center',
    overflow: 'hidden',
  },
  favoriteFill: {
    width: '100%',
    height: '100%',
    justifyContent: 'center',
    alignItems: 'center',
  },
  favoriteOn: {
    color: '#fff',
    fontSize: 20,
    fontWeight: '700',
  },
  favoriteOff: {
    color: 'rgba(255,255,255,0.4)',
    fontSize: 20,
    fontWeight: '700',
  },
  logoCircle: {
    width: 52,
    height: 52,
    borderRadius: 26,
    justifyContent: 'center',
    alignItems: 'center',
    overflow: 'hidden',
    backgroundColor: '#1C1F26',
  },
  logoText: {
    color: '#f6f7ff',
    fontSize: 14,
    fontWeight: '800',
    letterSpacing: 0.6,
  },
  tokenName: {
    color: '#fff',
    fontSize: 20,
    fontWeight: '700',
  },
  tokenFullName: {
    color: '#a0abc4',
    fontSize: 13,
    fontWeight: '500',
    flexShrink: 1,
  },
  symbolRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  addressRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  socialIcon: {
    fontSize: 18,
    color: '#7e88a8',
  },
  copyBtn: {
    padding: 4,
    borderRadius: 6,
  },
  bigPrice: {
    color: '#ffffff',
    fontSize: 34,
    fontWeight: '800',
    letterSpacing: 0.2,
  },
  priceRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginTop: 8,
  },
  changePill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  changePillGreen: {
    backgroundColor: 'rgba(74,222,128,0.15)',
  },
  changePillRed: {
    backgroundColor: 'rgba(255,107,129,0.15)',
  },
  changePillText: {
    fontSize: 14,
    fontWeight: '700',
  },
  statDotRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 4,
  },
  statDotText: {
    color: '#7e88a8',
    fontSize: 13,
    fontWeight: '500',
  },
  statDotSep: {
    color: '#7e88a8',
    fontSize: 13,
  },
  metricsWrap: {
    marginTop: 6,
    marginBottom: 0,
  },
  graphContainer: {
    marginTop: 4,
    width: '100%',
  },
  metricRow: {
    height: 38,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderBottomWidth: 0.5,
    borderBottomColor: 'rgba(255,255,255,0.06)',
  },
  metricLabel: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '600',
  },
  metricValue: {
    color: '#ffffff',
    fontSize: 15,
    fontWeight: '600',
    textAlign: 'right',
  },
  greenValue: {
    color: '#4ade80',
  },
  redValue: {
    color: '#ff6b81',
  },
  timeSelectorRow: {
    marginTop: 8,
    marginBottom: 2,
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: 2,
  },
  timeOption: {
    color: 'rgba(255,255,255,0.55)',
    fontSize: 12,
    fontWeight: '600',
  },
  timeOptionActive: {
    color: '#fff',
  },
  bottomActionSpace: {
    height: 32,
  },
  overlayBadge: {
    position: 'absolute',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 10,
    borderWidth: 1,
  },
  overlayUp: {
    top: 32,
    alignSelf: 'center',
    borderColor: '#ffd166',
    backgroundColor: 'rgba(255,209,102,0.18)',
  },
  overlayLeft: {
    left: 22,
    top: 32,
    borderColor: '#ff4d67',
    backgroundColor: 'rgba(255,77,103,0.18)',
  },
  overlayRight: {
    right: 22,
    top: 32,
    borderColor: '#36e67e',
    backgroundColor: 'rgba(54,230,126,0.18)',
  },
  overlayUpText: {
    color: '#ffdd7a',
    fontWeight: '800',
    fontSize: 18,
    letterSpacing: 1,
  },
  overlayLeftText: {
    color: '#ff788d',
    fontWeight: '800',
    fontSize: 13,
    letterSpacing: 1,
  },
  overlayRightText: {
    color: '#64f3a1',
    fontWeight: '800',
    fontSize: 13,
    letterSpacing: 1,
  },
  successFlash: {
    ...StyleSheet.absoluteFillObject,
    borderWidth: 2,
    borderColor: 'rgba(74,222,128,0.7)',
    borderRadius: 28,
  },
  successBadge: {
    position: 'absolute',
    top: 18,
    alignSelf: 'center',
    width: 28,
    height: 28,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: 'rgba(110,245,170,0.5)',
    backgroundColor: 'rgba(18,44,27,0.82)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  successBadgeText: {
    color: '#8ff7c1',
    fontSize: 16,
    fontWeight: '800',
  },
  emptyStateWrap: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 25,
  },
  emptyStateOuter: {
    width: SCREEN_WIDTH * 0.80,
    borderRadius: 32,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.14)',
  },
  emptyState: {
    width: '100%',
    backgroundColor: 'rgba(255,255,255,0.06)',
    padding: 22,
    alignItems: 'center',
  },
  emptySpinner: {
    marginBottom: 10,
  },
  emptyTitle: {
    color: '#fff',
    fontSize: 22,
    fontWeight: '800',
    textAlign: 'center',
  },
  emptySub: {
    marginTop: 8,
    color: '#9ca6c2',
    fontSize: 14,
    textAlign: 'center',
  },
  reloadBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 16,
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 999,
    backgroundColor: 'rgba(155,194,255,0.12)',
    borderWidth: 1,
    borderColor: 'rgba(155,194,255,0.25)',
  },
  reloadBtnText: {
    color: '#9bc2ff',
    fontSize: 14,
    fontWeight: '600',
  },
});
