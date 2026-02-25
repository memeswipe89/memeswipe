import React, { memo, useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text } from 'react-native';
import { BlurView } from 'expo-blur';
import { LinearGradient } from 'expo-linear-gradient';
import Animated, { Easing, runOnJS, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';

type AppLoaderProps = {
  visible: boolean;
};

const EASE = Easing.bezier(0.22, 1, 0.36, 1);

export const AppLoader = memo(function AppLoader({ visible }: AppLoaderProps) {
  const [mounted, setMounted] = useState(visible);
  const opacity = useSharedValue(0);
  const scale = useSharedValue(0.96);

  useEffect(() => {
    if (visible) {
      setMounted(true);
      opacity.value = withTiming(1, { duration: 260, easing: EASE });
      scale.value = withTiming(1, { duration: 320, easing: EASE });
      return;
    }

    opacity.value = withTiming(0, { duration: 220, easing: EASE }, (finished) => {
      if (finished) runOnJS(setMounted)(false);
    });
    scale.value = withTiming(0.96, { duration: 180, easing: EASE });
  }, [opacity, scale, visible]);

  const overlayStyle = useAnimatedStyle(() => ({ opacity: opacity.value }));
  const cardStyle = useAnimatedStyle(() => ({
    opacity: opacity.value,
    transform: [{ scale: scale.value }],
  }));

  if (!mounted) return null;

  return (
    <Animated.View pointerEvents={visible ? 'auto' : 'none'} style={[styles.overlay, overlayStyle]}>
      <BlurView intensity={50} tint="dark" style={StyleSheet.absoluteFill} />
      <LinearGradient
        colors={['rgba(5,8,18,0.76)', 'rgba(7,10,18,0.86)', 'rgba(5,7,14,0.92)']}
        style={StyleSheet.absoluteFill}
      />

      <Animated.View style={[styles.card, cardStyle]}>
        <LinearGradient colors={['rgba(120,162,255,0.22)', 'rgba(24,245,186,0.12)']} style={styles.glow} />
        <BlurView intensity={35} tint="dark" style={styles.cardBlur}>
          <LinearGradient
            colors={['rgba(255,255,255,0.16)', 'rgba(255,255,255,0.05)']}
            style={styles.cardBorder}
          >
            <ActivityIndicator size="large" color="#9bc2ff" />
            <Text style={styles.label}>Loading MemeSwipe...</Text>
          </LinearGradient>
        </BlurView>
      </Animated.View>
    </Animated.View>
  );
});

const styles = StyleSheet.create({
  overlay: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 60,
    alignItems: 'center',
    justifyContent: 'center',
  },
  card: {
    width: 250,
    borderRadius: 24,
    overflow: 'hidden',
  },
  glow: {
    ...StyleSheet.absoluteFillObject,
    opacity: 0.9,
  },
  cardBlur: {
    borderRadius: 24,
    overflow: 'hidden',
  },
  cardBorder: {
    borderRadius: 24,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.2)',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
    paddingVertical: 24,
    paddingHorizontal: 18,
  },
  label: {
    color: '#edf4ff',
    fontSize: 16,
    fontWeight: '700',
  },
});
