import React, { useEffect, useRef } from 'react';
import { Pressable, StyleSheet, View, Platform, Text } from 'react-native';
import { BottomTabBarProps } from '@react-navigation/bottom-tabs';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { BlurView } from 'expo-blur';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withSpring,
} from 'react-native-reanimated';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import * as Haptics from 'expo-haptics';

const TAB_HEIGHT = 60;
const BLOB_HEIGHT = 44;
const BLOB_PADDING = 8;
const BLOB_VERTICAL_PADDING = 8;

const ICONS: Record<string, keyof typeof MaterialIcons.glyphMap> = {
  index: 'home',
  trades: 'view-list',
  wallet: 'credit-card',
};

const LABELS: Record<string, string> = {
  index: 'Home',
  trades: 'Trades',
  wallet: 'Wallet',
};

export function LiquidTabBar({ state, descriptors, navigation }: BottomTabBarProps) {
  const insets = useSafeAreaInsets();
  const bottom = Platform.OS === 'ios' ? Math.max(insets.bottom, 16) : 24;

  const visibleRoutes = state.routes.filter((route) => {
    const { options } = descriptors[route.key];
    return (options as any).href !== null;
  });
  const tabCount = visibleRoutes.length;

  const barWidthRef = useRef(0);
  const blobX = useSharedValue(0);
  const blobWidth = useSharedValue(0);
  const blobOpacity = useSharedValue(0);

  const activeVisibleIndex = visibleRoutes.findIndex(
    (r) => r.key === state.routes[state.index]?.key
  );

  useEffect(() => {
    if (barWidthRef.current === 0) return;
    
    const tabWidth = barWidthRef.current / tabCount;
    const targetX = activeVisibleIndex * tabWidth + BLOB_PADDING;
    const targetWidth = tabWidth - (BLOB_PADDING * 2);

    // Smooth slide to new position with fluid spring
    blobX.value = withSpring(targetX, {
      damping: 25,
      stiffness: 300,
      mass: 0.6,
    });
    
    blobWidth.value = withSpring(targetWidth, {
      damping: 25,
      stiffness: 300,
      mass: 0.6,
    });
    
    // Fade in on first render
    if (blobOpacity.value === 0) {
      blobOpacity.value = withSpring(1, { damping: 20, stiffness: 200 });
    }
  }, [activeVisibleIndex, tabCount]);

  const blobStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: blobX.value }],
    width: blobWidth.value,
    opacity: blobOpacity.value,
  }));

  return (
    <View style={[styles.container, { bottom }]}>
      <BlurView intensity={100} tint="systemUltraThinMaterialDark" style={styles.blurWrap}>
        <View
          style={styles.pill}
          onLayout={(e) => {
            const w = e.nativeEvent.layout.width;
            if (w === barWidthRef.current) return;
            barWidthRef.current = w;
            
            // Initial position without animation
            const tabWidth = w / tabCount;
            const initialX = Math.max(0, activeVisibleIndex) * tabWidth + BLOB_PADDING;
            const initialWidth = tabWidth - (BLOB_PADDING * 2);
            blobX.value = initialX;
            blobWidth.value = initialWidth;
          }}
        >
          {/* Liquid selection blob */}
          <Animated.View style={[styles.blob, blobStyle]} />

          {/* Tab buttons */}
          {visibleRoutes.map((route) => {
            const isFocused = state.routes[state.index]?.key === route.key;
            const iconName = ICONS[route.name] ?? 'circle';
            const label = LABELS[route.name] ?? route.name;

            const onPress = () => {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
              const event = navigation.emit({
                type: 'tabPress',
                target: route.key,
                canPreventDefault: true,
              });
              if (!isFocused && !event.defaultPrevented) {
                navigation.navigate(route.name);
              }
            };

            return (
              <Pressable
                key={route.key}
                onPress={onPress}
                style={styles.tabBtn}
                accessibilityRole="button"
                accessibilityState={isFocused ? { selected: true } : {}}
              >
                <View style={styles.iconContainer}>
                  <MaterialIcons
                    name={iconName}
                    size={22}
                    color={isFocused ? '#fff' : 'rgba(255,255,255,0.5)'}
                  />
                  {isFocused ? (
                    <Text style={styles.label}>{label}</Text>
                  ) : null}
                </View>
              </Pressable>
            );
          })}
        </View>
      </BlurView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    left: 0,
    right: 0,
    marginHorizontal: 20,
    // Enhanced shadow for depth
    shadowColor: '#000',
    shadowOpacity: 0.3,
    shadowRadius: 25,
    shadowOffset: { width: 0, height: 10 },
    elevation: 15,
  },
  blurWrap: {
    borderRadius: 30,
    overflow: 'hidden',
    // Refined border
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.12)',
  },
  pill: {
    height: TAB_HEIGHT,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.08)', // Subtle tint over blur
    borderRadius: 30,
    paddingHorizontal: 6,
    paddingVertical: BLOB_VERTICAL_PADDING,
  },
  blob: {
    position: 'absolute',
    height: BLOB_HEIGHT,
    borderRadius: BLOB_HEIGHT / 2,
    backgroundColor: 'rgba(0,0,0,0.25)', // Refined dark selection
    top: BLOB_VERTICAL_PADDING,
    // Enhanced inner glow
    shadowColor: '#000',
    shadowOpacity: 0.4,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
  },
  tabBtn: {
    flex: 1,
    height: TAB_HEIGHT,
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: 1,
  },
  label: {
    color: '#fff',
    fontSize: 10,
    fontWeight: '600',
    letterSpacing: 0.3,
    marginTop: 1,
  },
});