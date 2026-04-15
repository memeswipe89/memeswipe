import * as Haptics from 'expo-haptics';
import React, { memo } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { BlurView } from 'expo-blur';
import { LinearGradient } from 'expo-linear-gradient';
import Animated, { useAnimatedStyle, useSharedValue, withSpring, withTiming } from 'react-native-reanimated';

export type FeedSegment = 'trending' | 'stalker' | 'bigcap' | 'smart' | 'favorites';

const SEGMENTS: { key: FeedSegment; label: string }[] = [
  { key: 'trending', label: 'Trending' },
  { key: 'stalker', label: 'Stalker' },
  { key: 'bigcap', label: 'Big Cap' },
  { key: 'smart', label: 'Smart List' },
  { key: 'favorites', label: 'Favorites' },
];

const SegmentChip = memo(function SegmentChip({
  label,
  active,
  onPress,
  isFavorite,
}: {
  label: string;
  active: boolean;
  onPress: () => void;
  isFavorite?: boolean;
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

  // Use pink/red gradient for Favorites tab, blue for others
  const gradientColors = isFavorite && active
    ? ['rgba(255,99,132,0.92)', 'rgba(255,128,180,0.62)']
    : ['rgba(106,142,255,0.72)', 'rgba(83,177,255,0.42)'];

  const shadowColor = isFavorite && active ? '#ff6384' : '#82a0ff';

  return (
    <Animated.View style={animatedStyle}>
      <Pressable onPress={handlePress} style={[styles.chip, active && styles.chipActive, active && isFavorite && { shadowColor }]}>
        {active ? (
          <LinearGradient
            colors={gradientColors}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={styles.activeFill}
          >
            <Text style={[styles.activeText, isFavorite && styles.favoriteActiveText]}>{label}</Text>
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
      <LinearGradient colors={['rgba(116,146,255,0.14)', 'rgba(56,83,138,0.1)']} style={styles.glow} />
      <BlurView intensity={18} tint="dark" style={styles.blur}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.scrollContent}>
          {visibleSegments.map((segment) => (
            <SegmentChip
              key={segment.key}
              label={segment.label}
              active={segment.key === value}
              isFavorite={segment.key === 'favorites'}
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
    borderRadius: 16,
    overflow: 'hidden',
  },
  glow: {
    ...StyleSheet.absoluteFillObject,
    opacity: 0.75,
    borderRadius: 16,
  },
  blur: {
    borderRadius: 16,
    backgroundColor: 'rgba(20,24,36,0.9)',
  },
  scrollContent: {
    paddingHorizontal: 8,
    paddingVertical: 5,
    justifyContent: 'flex-start',
    columnGap: 6,
  },
  chip: {
    minHeight: 36,
    borderRadius: 999,
    paddingVertical: 9,
    paddingHorizontal: 14,
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.02)',
  },
  chipActive: {
    shadowColor: '#82a0ff',
    shadowOpacity: 0.24,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
  },
  activeFill: {
    borderRadius: 999,
    marginVertical: -9,
    marginHorizontal: -14,
    paddingVertical: 9,
    paddingHorizontal: 14,
  },
  inactiveText: {
    color: 'rgba(225,235,255,0.66)',
    fontSize: 14,
    fontWeight: '700',
  },
  activeText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '800',
  },
  favoriteActiveText: {
    color: '#ffb3c6',
  },
});
