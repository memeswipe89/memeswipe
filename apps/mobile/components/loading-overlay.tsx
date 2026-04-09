import React, { memo, useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { BlurView } from 'expo-blur';
import { LinearGradient } from 'expo-linear-gradient';
import Animated, { Easing, runOnJS, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';

type LoadingOverlayProps = {
  visible: boolean;
  text?: string;
};

const EASE = Easing.bezier(0.22, 1, 0.36, 1);

export const LoadingOverlay = memo(function LoadingOverlay({
  visible,
  text = 'Executing trade...',
}: LoadingOverlayProps) {
  const [mounted, setMounted] = useState(visible);
  const opacity = useSharedValue(0);
  const scale = useSharedValue(0.96);

  useEffect(() => {
    if (visible) {
      setMounted(true);
      opacity.value = withTiming(1, { duration: 280, easing: EASE });
      scale.value = withTiming(1, { duration: 320, easing: EASE });
      return;
    }

    opacity.value = withTiming(0, { duration: 220, easing: EASE }, (finished) => {
      if (finished) {
        runOnJS(setMounted)(false);
      }
    });
    scale.value = withTiming(0.96, { duration: 200, easing: EASE });
  }, [opacity, scale, visible]);

  const overlayStyle = useAnimatedStyle(() => ({
    opacity: opacity.value,
  }));

  const cardStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
    opacity: opacity.value,
  }));

  if (!mounted) return null;

  return (
    <Animated.View pointerEvents={visible ? 'auto' : 'none'} style={[styles.overlay, overlayStyle]}>
      <BlurView intensity={52} tint="dark" style={StyleSheet.absoluteFill} />
      <LinearGradient
        colors={['rgba(5,8,18,0.72)', 'rgba(7,10,18,0.84)', 'rgba(5,7,14,0.9)']}
        style={StyleSheet.absoluteFill}
      />

      <View style={styles.centerWrap}>
        <Animated.View style={[styles.loaderCard, cardStyle]}>
          <BlurView intensity={35} tint="dark" style={styles.cardBlur}>
            <LinearGradient
              colors={['rgba(255,255,255,0.16)', 'rgba(255,255,255,0.04)']}
              style={styles.cardBorder}
            >
              <ActivityIndicator size="large" color="#9bc2ff" />
              <Text style={styles.loadingText}>{text}</Text>
            </LinearGradient>
          </BlurView>
        </Animated.View>
      </View>
    </Animated.View>
  );
});

const styles = StyleSheet.create({
  overlay: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 30,
    justifyContent: 'center',
    alignItems: 'center',
  },
  centerWrap: {
    justifyContent: 'center',
    alignItems: 'center',
  },
  glowHalo: {
    position: 'absolute',
    width: 260,
    height: 260,
    borderRadius: 999,
    opacity: 0.8,
  },
  loaderCard: {
    width: 240,
    borderRadius: 24,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOpacity: 0.35,
    shadowRadius: 22,
    shadowOffset: { width: 0, height: 14 },
  },
  cardBlur: {
    borderRadius: 24,
    overflow: 'hidden',
  },
  cardBorder: {
    borderRadius: 24,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.2)',
    paddingVertical: 24,
    paddingHorizontal: 20,
    justifyContent: 'center',
    alignItems: 'center',
    gap: 12,
  },
  loadingText: {
    color: '#f2f6ff',
    fontSize: 16,
    fontWeight: '700',
    letterSpacing: 0.2,
  },
});
