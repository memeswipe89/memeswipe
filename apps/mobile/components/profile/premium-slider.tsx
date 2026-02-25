import React, { memo, useEffect, useMemo, useState } from 'react';
import { LayoutChangeEvent, StyleSheet, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  Easing,
  Extrapolation,
  interpolate,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from 'react-native-reanimated';

type PremiumSliderProps = {
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (value: number) => void;
};

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

const toSteppedValue = (x: number, width: number, min: number, max: number, step: number) => {
  if (width <= 0) return min;
  const clampedX = clamp(x, 0, width);
  const ratio = clampedX / width;
  const raw = min + ratio * (max - min);
  const stepped = Math.round(raw / step) * step;
  return clamp(stepped, min, max);
};

const valueToX = (value: number, width: number, min: number, max: number) => {
  if (width <= 0) return 0;
  const ratio = (value - min) / (max - min);
  return clamp(ratio * width, 0, width);
};

export const PremiumSlider = memo(function PremiumSlider({
  value,
  min,
  max,
  step,
  onChange,
}: PremiumSliderProps) {
  const [trackWidth, setTrackWidth] = useState(0);
  const positionX = useSharedValue(0);
  const gestureStartX = useSharedValue(0);
  const lastSentValue = useSharedValue(value);
  const isDragging = useSharedValue(0);

  const safeValue = useMemo(() => clamp(value, min, max), [max, min, value]);

  useEffect(() => {
    const nextX = valueToX(safeValue, trackWidth, min, max);
    if (isDragging.value === 0) {
      positionX.value = withTiming(nextX, { duration: 120, easing: Easing.out(Easing.cubic) });
    }
    lastSentValue.value = safeValue;
  }, [isDragging, lastSentValue, max, min, positionX, safeValue, trackWidth]);

  const commitFromX = (x: number) => {
    const next = toSteppedValue(x, trackWidth, min, max, step);
    if (next !== lastSentValue.value) {
      lastSentValue.value = next;
      onChange(next);
    }
  };

  const panGesture = Gesture.Pan()
    .onBegin(() => {
      isDragging.value = 1;
      gestureStartX.value = positionX.value;
    })
    .onUpdate((event) => {
      const nextX = clamp(gestureStartX.value + event.translationX, 0, trackWidth);
      positionX.value = nextX;
      runOnJS(commitFromX)(nextX);
    })
    .onEnd(() => {
      isDragging.value = 0;
      positionX.value = withSpring(positionX.value, { damping: 16, stiffness: 190 });
    });

  const tapGesture = Gesture.Tap().onEnd((event) => {
    const x = clamp(event.x, 0, trackWidth);
    positionX.value = withTiming(x, { duration: 140, easing: Easing.out(Easing.cubic) });
    runOnJS(commitFromX)(x);
  });

  const composedGesture = Gesture.Simultaneous(tapGesture, panGesture);

  const fillStyle = useAnimatedStyle(() => ({
    width: positionX.value,
  }));

  const thumbScaleStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: positionX.value - 12 },
      {
        scale: interpolate(isDragging.value, [0, 1], [1, 1.06], Extrapolation.CLAMP),
      },
    ],
  }));

  const onTrackLayout = (event: LayoutChangeEvent) => {
    setTrackWidth(event.nativeEvent.layout.width);
  };

  return (
    <View style={styles.wrap}>
      <GestureDetector gesture={composedGesture}>
        <View style={styles.pressArea}>
        <View onLayout={onTrackLayout} style={styles.track}>
          <Animated.View style={[styles.fill, fillStyle]} />
          <Animated.View style={[styles.thumb, thumbScaleStyle]} />
        </View>
        </View>
      </GestureDetector>
    </View>
  );
});

const styles = StyleSheet.create({
  wrap: {
    marginTop: 10,
  },
  pressArea: {
    paddingVertical: 10,
  },
  track: {
    height: 8,
    borderRadius: 999,
    backgroundColor: 'rgba(255,255,255,0.1)',
    overflow: 'visible',
    justifyContent: 'center',
  },
  fill: {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
    borderRadius: 999,
    backgroundColor: '#79a5ff',
    shadowColor: '#79a5ff',
    shadowOpacity: 0.45,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 0 },
  },
  thumb: {
    position: 'absolute',
    top: -8,
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: '#ecf3ff',
    borderWidth: 2,
    borderColor: '#8fb6ff',
    shadowColor: '#000',
    shadowOpacity: 0.32,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
  },
});
