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
  const translateY = useSharedValue(8);

  useEffect(() => {
    opacity.value = withTiming(visible ? 1 : 0, {
      duration: visible ? 280 : 220,
      easing: EASE,
    });
    translateY.value = withTiming(visible ? 0 : 6, {
      duration: visible ? 320 : 220,
      easing: EASE,
    });
  }, [opacity, translateY, visible]);

  const animatedStyle = useAnimatedStyle(() => ({
    opacity: opacity.value,
    transform: [{ translateY: translateY.value }],
  }));

  return (
    <Animated.View pointerEvents="none" style={[styles.container, animatedStyle]}>
      <View style={styles.shell}>
        <LinearGradient
          colors={['rgba(34,197,94,0.25)', 'transparent', 'rgba(255,99,132,0.25)']}
          start={{ x: 0, y: 0.5 }}
          end={{ x: 1, y: 0.5 }}
          style={styles.glow}
        />
        <BlurView intensity={24} tint="dark" style={styles.bubble}>
          <View style={styles.content}>
            <Text style={styles.reject}>← Swipe left to reject</Text>
            <Text style={styles.buy}>Swipe right to buy →</Text>
          </View>
        </BlurView>
      </View>
    </Animated.View>
  );
});

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    bottom: 110,
    width: '100%',
    paddingHorizontal: 20,
    zIndex: 30,
  },
  shell: {
    position: 'relative',
    width: '100%',
    alignItems: 'center',
    justifyContent: 'center',
  },
  glow: {
    position: 'absolute',
    width: '80%',
    height: 40,
    borderRadius: 40,
    opacity: 0.25,
  },
  bubble: {
    width: '100%',
    borderRadius: 28,
    overflow: 'hidden',
  },
  content: {
    width: '100%',
    borderRadius: 28,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    backgroundColor: 'rgba(20,20,20,0.55)',
    paddingHorizontal: 18,
    paddingVertical: 12,
    flexDirection: 'row',
    gap: 14,
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  reject: {
    color: '#ff6b81',
    fontSize: 14,
    fontWeight: '600',
    letterSpacing: 0.3,
  },
  buy: {
    color: '#4ade80',
    fontSize: 14,
    fontWeight: '600',
    letterSpacing: 0.3,
  },
});
