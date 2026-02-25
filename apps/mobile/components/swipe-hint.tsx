import React, { memo, useEffect } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { BlurView } from 'expo-blur';
import { LinearGradient } from 'expo-linear-gradient';
import Animated, { Easing, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';

type SwipeHintProps = {
  visible: boolean;
};

const EASE = Easing.bezier(0.22, 1, 0.36, 1);

export const SwipeHint = memo(function SwipeHint({ visible }: SwipeHintProps) {
  const opacity = useSharedValue(0);
  const translateY = useSharedValue(14);

  useEffect(() => {
    opacity.value = withTiming(visible ? 1 : 0, { duration: visible ? 280 : 220, easing: EASE });
    translateY.value = withTiming(visible ? 0 : 14, { duration: visible ? 280 : 220, easing: EASE });
  }, [opacity, translateY, visible]);

  const wrapStyle = useAnimatedStyle(() => ({
    opacity: opacity.value,
    transform: [{ translateY: translateY.value }],
  }));

  return (
    <Animated.View pointerEvents="none" style={[styles.container, wrapStyle]}>
      <LinearGradient colors={['rgba(118,165,255,0.2)', 'rgba(24,245,186,0.1)']} style={styles.glow} />
      <BlurView intensity={30} tint="dark" style={styles.bubble}>
        <View style={styles.row}>
          <Text style={styles.buy}>Swipe → to BUY</Text>
          <Text style={styles.reject}>Swipe ← to Reject</Text>
        </View>
      </BlurView>
    </Animated.View>
  );
});

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    left: 24,
    right: 24,
    bottom: 92,
    borderRadius: 16,
    overflow: 'hidden',
    zIndex: 26,
  },
  glow: {
    ...StyleSheet.absoluteFillObject,
    opacity: 0.9,
  },
  bubble: {
    borderRadius: 16,
    overflow: 'hidden',
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.2)',
    backgroundColor: 'rgba(12,16,28,0.66)',
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  buy: {
    color: '#6df0ab',
    fontSize: 12,
    fontWeight: '800',
  },
  reject: {
    color: '#ff8fa2',
    fontSize: 12,
    fontWeight: '800',
  },
});
