import * as Haptics from 'expo-haptics';
import React, { memo } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { BlurView } from 'expo-blur';
import { LinearGradient } from 'expo-linear-gradient';
import Animated, { useAnimatedStyle, useSharedValue, withSpring, withTiming } from 'react-native-reanimated';

export type FeedSegment = 'trending' | 'stalker' | 'bigcap' | 'smart' | 'favorites';

const SEGMENTS: { key: FeedSegment; label: string }[] = [
  { key: 'trending', label: '🔥 Trending' },
  { key: 'stalker', label: '👀 Stalker' },
  { key: 'bigcap', label: '💎 Big Cap' },
  { key: 'smart', label: '🧠 Smart List' },
  { key: 'favorites', label: '❤️ Favorites' },
];

const SegmentChip = memo(function SegmentChip({
  label,
  active,
  onPress,
}: {
  label: string;
  active: boolean;
  onPress: () => void;
}) {
  const scale = useSharedValue(1);

  const handlePress = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => undefined);
    scale.value = withSpring(1.06, { damping: 14, stiffness: 240 }, () => {
      scale.value = withTiming(1, { duration: 160 });
    });
    onPress();
  };

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }));

  return (
    <Animated.View style={animatedStyle}>
      <Pressable onPress={handlePress} style={[styles.chip, active && styles.chipActive]}>
        {active ? (
          <LinearGradient
            colors={['rgba(104,139,255,0.58)', 'rgba(74,222,128,0.32)']}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={styles.activeFill}
          >
            <Text style={styles.activeText}>{label}</Text>
          </LinearGradient>
        ) : (
          <Text style={styles.inactiveText}>{label}</Text>
        )}
      </Pressable>
    </Animated.View>
  );
});

type FeedSegmentedControlProps = {
  value: FeedSegment;
  onChange: (value: FeedSegment) => void;
  segments?: FeedSegment[];
};

export const FeedSegmentedControl = memo(function FeedSegmentedControl({
  value,
  onChange,
  segments,
}: FeedSegmentedControlProps) {
  const visibleSegments = segments?.length
    ? SEGMENTS.filter((segment) => segments.includes(segment.key))
    : SEGMENTS;

  return (
    <View style={styles.wrap}>
      <LinearGradient colors={['rgba(96,132,255,0.16)', 'rgba(74,222,128,0.06)']} style={styles.glow} />
      <BlurView intensity={24} tint="dark" style={styles.blur}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.scrollContent}>
          {visibleSegments.map((segment) => (
            <SegmentChip
              key={segment.key}
              label={segment.label}
              active={segment.key === value}
              onPress={() => onChange(segment.key)}
            />
          ))}
        </ScrollView>
      </BlurView>
    </View>
  );
});

const styles = StyleSheet.create({
  wrap: {
    borderRadius: 999,
    overflow: 'hidden',
  },
  glow: {
    ...StyleSheet.absoluteFillObject,
    opacity: 0.8,
    borderRadius: 999,
  },
  blur: {
    borderRadius: 999,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
    backgroundColor: 'rgba(255,255,255,0.06)',
  },
  scrollContent: {
    padding: 6,
    gap: 8,
  },
  chip: {
    minHeight: 38,
    borderRadius: 999,
    paddingVertical: 10,
    paddingHorizontal: 16,
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.06)',
    backgroundColor: 'rgba(255,255,255,0.03)',
  },
  chipActive: {
    borderColor: 'rgba(170,196,255,0.34)',
    shadowColor: '#6c90ff',
    shadowOpacity: 0.3,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 6 },
  },
  activeFill: {
    borderRadius: 999,
    marginVertical: -10,
    marginHorizontal: -16,
    paddingVertical: 10,
    paddingHorizontal: 16,
  },
  inactiveText: {
    color: 'rgba(255,255,255,0.66)',
    fontSize: 14,
    fontWeight: '600',
  },
  activeText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '600',
  },
});
