import React, { memo, useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Dimensions, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import * as Haptics from 'expo-haptics';
import { BlurView } from 'expo-blur';
import { LinearGradient as ExpoLinearGradient } from 'expo-linear-gradient';
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
  withRepeat,
  withSequence,
  withTiming,
} from 'react-native-reanimated';
import TradeChart from '@/components/trade-chart';
import { getPriceHistory } from '@/lib/getPriceHistory';

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');
const SWIPE_THRESHOLD = SCREEN_WIDTH * 0.25;
const SWIPE_OUT_DISTANCE = SCREEN_WIDTH * 1.3;
const INTENTIONAL_EASING = Easing.bezier(0.22, 1, 0.36, 1);
const MOTION = {
  quick: 220,
  medium: 300,
  slow: 1300,
};

type SwipeDirection = 'left' | 'right';

export type SwipeToken = {
  name: string;
  symbol: string;
  address: string;
  priceUsd: number;
  liquidityUsd: number;
  volume24hUsd: number;
  marketCapUsd: number;
  change24hPct: number;
  chartData: number[];
  graduationTime?: string;
};

type SwipeTokenDeckProps = {
  tokens: SwipeToken[];
  onBuy: (token: SwipeToken) => void;
  onReject: (token: SwipeToken) => void;
  onToggleFavorite: (token: SwipeToken) => void;
  favoriteAddresses: Set<string>;
  isLoading?: boolean;
  isInteractionLocked?: boolean;
  resetKey?: string;
  emptyTitle?: string;
  emptySubtitle?: string;
  onSwipeStateChange?: (swiping: boolean) => void;
  onActiveCardChange?: (token: SwipeToken | null) => void;
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
}: {
  label: string;
  value: string;
  valueStyle?: object;
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
    <View style={styles.metricRow}>
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

const ShimmerCard = memo(function ShimmerCard() {
  const shimmerX = useSharedValue(-1);

  useEffect(() => {
    shimmerX.value = withRepeat(
      withTiming(1, { duration: MOTION.slow, easing: INTENTIONAL_EASING }),
      -1,
      false
    );
  }, [shimmerX]);

  const shimmerStyle = useAnimatedStyle(() => ({
    transform: [
      {
        translateX: interpolate(shimmerX.value, [-1, 1], [-SCREEN_WIDTH, SCREEN_WIDTH]),
      },
    ],
  }));

  return (
    <View style={styles.cardWrap}>
      <BlurView intensity={30} tint="dark" style={styles.blurCard}>
        <View style={styles.skeleton}>
          <View style={[styles.skeletonCircle, styles.skeletonBlock]} />
          <View style={[styles.skeletonLineWide, styles.skeletonBlock]} />
          <View style={[styles.skeletonLineNarrow, styles.skeletonBlock]} />
          <View style={[styles.skeletonLineWide, styles.skeletonBlock]} />
          <View style={[styles.skeletonChart, styles.skeletonBlock]} />
          <Animated.View style={[styles.shimmerStripe, shimmerStyle]}>
            <ExpoLinearGradient
              colors={['transparent', 'rgba(255,255,255,0.28)', 'transparent']}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 0 }}
              style={StyleSheet.absoluteFill}
            />
          </Animated.View>
        </View>
      </BlurView>
    </View>
  );
});

const DeckStatusCard = memo(function DeckStatusCard({
  title,
  subtitle,
  loading = false,
}: {
  title: string;
  subtitle: string;
  loading?: boolean;
}) {
  return (
    <View style={styles.emptyStateWrap}>
      <BlurView intensity={24} tint="dark" style={styles.emptyState}>
        {loading ? <ActivityIndicator size="small" color="#9bc2ff" style={styles.emptySpinner} /> : null}
        <Text style={styles.emptyTitle}>{title}</Text>
        <Text style={styles.emptySub}>{subtitle}</Text>
      </BlurView>
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
        <ScrollView
          showsVerticalScrollIndicator={false}
          contentContainerStyle={styles.cardScrollContent}
          keyboardShouldPersistTaps="handled"
          bounces
          decelerationRate="normal"
          overScrollMode="auto"
          scrollEventThrottle={16}
        >
            <FavoriteHeart isFavorite={isFavorite} onPress={() => onToggleFavorite(token)} />
            <View style={styles.contentWrapper}>
              <View style={styles.headerSection}>
                <View style={styles.headerTopRow}>
                  <View style={styles.headerTokenRow}>
                    <ExpoLinearGradient colors={palette} style={styles.logoCircle}>
                      <Text style={styles.logoText}>{token.symbol.slice(0, 2).toUpperCase()}</Text>
                    </ExpoLinearGradient>
                    <View style={styles.headerIdentity}>
                      <Text style={styles.tokenName}>{token.name}</Text>
                      <Text style={styles.tokenSymbol}>${token.symbol.toUpperCase()}</Text>
                      <Text style={styles.tokenAddress}>{shortAddress(token.address)}</Text>
                    </View>
                  </View>
                  <Text style={[styles.changeBadge, token.change24hPct >= 0 ? styles.greenValue : styles.redValue]}>
                    {formatPct(token.change24hPct)}
                  </Text>
                </View>
                <Text style={styles.bigPrice}>{formatCurrency(token.priceUsd)}</Text>
                <View style={styles.statPillsRow}>
                  <View style={styles.statPill}>
                    <Text style={styles.statPillLabel}>24h Vol</Text>
                    <Text style={styles.statPillValue}>{compactCurrency.format(token.volume24hUsd || 0)}</Text>
                  </View>
                  <View style={styles.statPill}>
                    <Text style={styles.statPillLabel}>MCap</Text>
                    <Text style={styles.statPillValue}>{compactCurrency.format(token.marketCapUsd || 0)}</Text>
                  </View>
                </View>
              </View>

              <MomentumGraph data={history.length ? history : token.chartData} />

              <View style={styles.timeSelectorRow}>
                <Text style={styles.timeOption}>1H</Text>
                <Text style={[styles.timeOption, styles.timeOptionActive]}>1D</Text>
                <Text style={styles.timeOption}>1W</Text>
                <Text style={styles.timeOption}>1M</Text>
                <Text style={styles.timeOption}>ALL</Text>
              </View>

              <View style={styles.metricsWrap}>
                <MetricRow label="Price" value={formatCurrency(token.priceUsd)} valueStyle={priceUp ? styles.greenValue : undefined} />
                <MetricRow label="Liquidity" value={formatCurrency(token.liquidityUsd)} />
                <MetricRow label="24h Volume" value={formatCurrency(token.volume24hUsd)} />
                <MetricRow label="Market Cap" value={formatCurrency(token.marketCapUsd)} />
                <MetricRow
                  label="24h Change"
                  value={formatPct(token.change24hPct)}
                  valueStyle={token.change24hPct >= 0 ? styles.greenValue : styles.redValue}
                />
              </View>
            </View>

            <View style={styles.bottomActionSpace} />
        </ScrollView>
      </View>
    </View>
  );
});

export const SwipeTokenDeck = memo(function SwipeTokenDeck({
  tokens,
  onBuy,
  onReject,
  onToggleFavorite,
  favoriteAddresses,
  isLoading = false,
  isInteractionLocked = false,
  resetKey,
  emptyTitle = 'Deck complete',
  emptySubtitle = 'No more tokens in this segment.',
  onSwipeStateChange,
  onActiveCardChange,
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
      } else {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => undefined);
        onReject(token);
      }

      translateX.value = 0;
      translateY.value = 0;
    },
    [buyBadge, buyFlash, currentToken, onBuy, onReject, translateX, translateY]
  );

  const panGesture = useMemo(
    () =>
      Gesture.Pan()
        .enabled(!isInteractionLocked)
        .onBegin(() => {
          if (onSwipeStateChange) runOnJS(onSwipeStateChange)(true);
        })
        .onUpdate((event) => {
          translateX.value = event.translationX;
          translateY.value = event.translationY * 0.08;
        })
        .onEnd(() => {
          if (onSwipeStateChange) runOnJS(onSwipeStateChange)(false);
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
      <ExpoLinearGradient colors={['#04050c', '#0b1020', '#05060a']} style={styles.container}>
        <View style={styles.glowOrb} />
        <ShimmerCard />
      </ExpoLinearGradient>
    );
  }

  return (
    <ExpoLinearGradient colors={['#04050c', '#0b1020', '#05060a']} style={styles.container}>
      <View style={styles.glowOrb} />
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
            <Animated.View pointerEvents="none" style={[styles.successBadge, successBadgeStyle]}>
              <Text style={styles.successBadgeText}>✓</Text>
            </Animated.View>

            <Animated.View style={[styles.overlayBadge, styles.overlayLeft, leftOverlayStyle]}>
              <Text style={styles.overlayLeftText}>REJECT</Text>
            </Animated.View>

            <Animated.View style={[styles.overlayBadge, styles.overlayRight, rightOverlayStyle]}>
              <Text style={styles.overlayRightText}>BUY</Text>
            </Animated.View>
          </Animated.View>
        </GestureDetector>
      ) : (
        <DeckStatusCard
          title={showLoadingState ? 'Loading Tokens...' : emptyTitle}
          subtitle={showLoadingState ? 'Fetching live token data for this feed.' : emptySubtitle}
          loading={showLoadingState}
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
    shadowColor: '#3d72ff',
    shadowOpacity: 0.3,
    shadowRadius: 60,
    shadowOffset: { width: 0, height: 20 },
    top: SCREEN_HEIGHT * 0.12,
  },
  absoluteCard: {
    position: 'absolute',
    top: 0,
    bottom: 0,
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
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.06)',
    paddingVertical: 14,
    paddingHorizontal: 16,
    backgroundColor: '#14161B',
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
    marginBottom: 4,
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
    right: 0,
    top: 0,
    zIndex: 10,
  },
  favoriteButton: {
    width: 40,
    height: 40,
    borderRadius: 28,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.10)',
    backgroundColor: '#1C1F26',
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
    fontSize: 16,
    fontWeight: '700',
  },
  favoriteOff: {
    color: '#d7dff7',
    fontSize: 16,
    fontWeight: '700',
  },
  logoCircle: {
    width: 40,
    height: 40,
    borderRadius: 19,
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.2,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 10 },
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
  tokenSymbol: {
    color: '#a0abc4',
    fontSize: 18,
    fontWeight: '600',
  },
  tokenAddress: {
    color: '#7e88a8',
    fontSize: 11,
    fontWeight: '500',
  },
  bigPrice: {
    color: '#ffffff',
    fontSize: 34,
    fontWeight: '800',
    marginTop: 10,
    letterSpacing: 0.2,
  },
  changeBadge: {
    position: 'absolute',
    right: 0,
    top: 44,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 5,
    fontSize: 12,
    fontWeight: '700',
    backgroundColor: '#1C1F26',
  },
  statPillsRow: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 10,
  },
  statPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 7,
    backgroundColor: '#1C1F26',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.06)',
  },
  statPillLabel: {
    color: '#A8B0C0',
    fontSize: 11,
    fontWeight: '600',
  },
  statPillValue: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '700',
  },
  metricsWrap: {
    marginTop: 8,
    gap: 8,
    marginBottom: 0,
    minHeight: 6 * 40 + 5 * 8,
  },
  graphContainer: {
    marginTop: 6,
    height: 140,
    borderRadius: 16,
    overflow: 'hidden',
    backgroundColor: '#1C1F26',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.06)',
  },
  metricRow: {
    borderRadius: 16,
    height: 40,
    paddingHorizontal: 14,
    backgroundColor: '#1C1F26',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.06)',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 4,
  },
  metricLabel: {
    color: '#A8B0C0',
    fontSize: 13,
    fontWeight: '500',
  },
  metricValue: {
    color: '#ffffff',
    fontSize: 16,
    fontWeight: '600',
    minWidth: 95,
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
    height: 56,
  },
  overlayBadge: {
    position: 'absolute',
    top: 32,
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 10,
    borderWidth: 1,
  },
  overlayLeft: {
    left: 22,
    borderColor: '#ff4d67',
    backgroundColor: 'rgba(255,77,103,0.18)',
  },
  overlayRight: {
    right: 22,
    borderColor: '#36e67e',
    backgroundColor: 'rgba(54,230,126,0.18)',
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
    paddingHorizontal: 20,
  },
  emptyState: {
    width: SCREEN_WIDTH * 0.85,
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderRadius: 20,
    padding: 22,
    borderColor: 'rgba(255,255,255,0.14)',
    borderWidth: 1,
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
  skeleton: {
    flex: 1,
    borderRadius: 34,
    backgroundColor: 'rgba(255,255,255,0.04)',
    paddingHorizontal: 22,
    paddingTop: 24,
    overflow: 'hidden',
  },
  skeletonBlock: {
    backgroundColor: 'rgba(255,255,255,0.09)',
  },
  skeletonCircle: {
    width: 86,
    height: 86,
    borderRadius: 43,
    alignSelf: 'center',
  },
  skeletonLineWide: {
    height: 18,
    borderRadius: 9,
    marginTop: 16,
  },
  skeletonLineNarrow: {
    height: 14,
    width: '60%',
    borderRadius: 7,
    marginTop: 10,
    alignSelf: 'center',
  },
  skeletonChart: {
    height: 120,
    borderRadius: 14,
    marginTop: 20,
  },
  shimmerStripe: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    width: SCREEN_WIDTH * 0.35,
  },
});
