import React, { memo, useEffect, useMemo, useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { BlurView } from 'expo-blur';
import { LinearGradient } from 'expo-linear-gradient';
import Animated, { Easing, runOnJS, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';

import { useTradeSettings } from '@/contexts/trade-settings-context';
import { useWalletContext } from '@/contexts/wallet-context';
import { usePrivy } from '@privy-io/expo';

import { ChainSwitcher } from './chain-switcher';
import { LiveStats } from './live-stats';
import { LiveTradesList } from './live-trades-list';
import { TradeSettings } from './trade-settings';

type ProfilePanelProps = {
  visible: boolean;
  onClose: () => void;
};

const EASE = Easing.bezier(0.22, 1, 0.36, 1);

export const ProfilePanel = memo(function ProfilePanel({ visible, onClose }: ProfilePanelProps) {
  const [mounted, setMounted] = useState(visible);
  const [inputFocused, setInputFocused] = useState(false);
  const progress = useSharedValue(0);
  const {
    profileName,
    setProfileName,
    activeChain,
    setActiveChain,
    tradeAmount,
    tpROI,
    stopLoss,
  } = useTradeSettings();
  const { twitterProfile } = useWalletContext();
  const { user: privyUser } = usePrivy();

  const appleUserId = (() => {
    const accounts: any[] = (privyUser as any)?.linked_accounts ?? (privyUser as any)?.linkedAccounts ?? [];
    const apple = accounts.find((a: any) => a?.type === "apple_oauth" || a?.type === "apple");
    const id = apple?.subject ?? apple?.id;
    return typeof id === "string" && id.length > 0 ? id : null;
  })();
  const twitterUsername = typeof twitterProfile?.username === "string" && twitterProfile.username.length > 0 ? twitterProfile.username : null;

  useEffect(() => {
    if (visible) {
      setMounted(true);
      progress.value = withTiming(1, { duration: 300, easing: EASE });
      return;
    }

    progress.value = withTiming(0, { duration: 220, easing: EASE }, (finished) => {
      if (finished) {
        runOnJS(setMounted)(false);
      }
    });
  }, [progress, visible]);

  const backdropStyle = useAnimatedStyle(() => ({
    opacity: progress.value,
  }));

  const panelStyle = useAnimatedStyle(() => ({
    opacity: progress.value,
    transform: [
      {
        translateY: (1 - progress.value) * 70,
      },
      {
        scale: 0.97 + progress.value * 0.03,
      },
    ],
  }));

  const initials = useMemo(() => {
    const trimmed = profileName.trim();
    if (!trimmed) {
      // Use first letter of Twitter username or Apple ID if profile name is empty
      const authInitial =
        (typeof twitterUsername === "string" ? twitterUsername[0] : null) ||
        (typeof appleUserId === "string" ? appleUserId[0] : null);
      return authInitial ? authInitial.toUpperCase() : 'T';
    }
    return trimmed.slice(0, 2).toUpperCase();
  }, [profileName, twitterUsername, appleUserId]);

  if (!mounted) return null;

  return (
    <Animated.View style={[styles.overlay, backdropStyle]} pointerEvents="auto">
      <BlurView intensity={38} tint="dark" style={StyleSheet.absoluteFill} />
      <Pressable
        style={StyleSheet.absoluteFill}
        onPress={() => {
          if (!inputFocused) onClose();
        }}
      />

      <KeyboardAvoidingView behavior={Platform.select({ ios: 'padding', android: undefined })} style={styles.avoid}>
        <Animated.View style={[styles.panelWrap, panelStyle]}>
          <LinearGradient colors={['rgba(82,130,255,0.2)', 'rgba(38,216,179,0.09)']} style={styles.glowHalo} />
          <BlurView intensity={34} tint="dark" style={styles.panelBlur}>
            <LinearGradient
              colors={['rgba(255,255,255,0.15)', 'rgba(255,255,255,0.05)']}
              style={styles.panelCard}
            >
              <View style={styles.header}>
                <Text style={styles.panelTitle}>Profile & Trading</Text>
                <Pressable onPress={onClose} style={styles.closeBtn}>
                  <Text style={styles.closeText}>Close</Text>
                </Pressable>
              </View>

              <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
                <View style={styles.section}>
                  <Text style={styles.sectionTitle}>User Info</Text>
                  <View style={styles.userRow}>
                    <View style={styles.avatarPlaceholder}>
                      <Text style={styles.avatarText}>{initials}</Text>
                    </View>
                    <View style={styles.userFields}>
                      <TextInput
                        value={profileName}
                        onChangeText={setProfileName}
                        onFocus={() => setInputFocused(true)}
                        onBlur={() => setInputFocused(false)}
                        placeholder="Profile Name"
                        placeholderTextColor="#8290b3"
                        style={styles.nameInput}
                      />
                      <Text style={styles.userId}>User ID: 1111...1111</Text>
                    </View>
                  </View>
                </View>

                <TradeSettings onInputFocusChange={setInputFocused} />
                <LiveStats />
                <LiveTradesList />
                <ChainSwitcher value={activeChain} onChange={setActiveChain} />

                <View style={styles.actionsWrap}>
                  <Text style={styles.sectionTitle}>Actions</Text>
                  <Pressable style={styles.actionBtn}>
                    <Text style={styles.actionText}>Logout</Text>
                  </Pressable>
                  <Text style={styles.version}>Version 1.0.0</Text>
                </View>

                <Text style={styles.footnote}>
                  Active Config: ${tradeAmount.toFixed(2)} | TP {tpROI}% | SL {stopLoss}%
                </Text>
              </ScrollView>
            </LinearGradient>
          </BlurView>
        </Animated.View>
      </KeyboardAvoidingView>
    </Animated.View>
  );
});

const styles = StyleSheet.create({
  overlay: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 40,
    justifyContent: 'flex-end',
  },
  avoid: {
    width: '100%',
    justifyContent: 'flex-end',
  },
  panelWrap: {
    marginHorizontal: 10,
    marginBottom: 8,
    borderRadius: 24,
    overflow: 'hidden',
    maxHeight: '88%',
  },
  glowHalo: {
    ...StyleSheet.absoluteFillObject,
    opacity: 0.9,
  },
  panelBlur: {
    borderRadius: 24,
    overflow: 'hidden',
  },
  panelCard: {
    borderRadius: 24,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.2)',
    paddingTop: 14,
    paddingHorizontal: 14,
    paddingBottom: 16,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  panelTitle: {
    color: '#f3f7ff',
    fontSize: 17,
    fontWeight: '800',
  },
  closeBtn: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.16)',
    backgroundColor: 'rgba(255,255,255,0.06)',
  },
  closeText: {
    color: '#d7e4ff',
    fontWeight: '700',
    fontSize: 12,
  },
  content: {
    paddingBottom: 30,
  },
  section: {
    marginBottom: 8,
  },
  sectionTitle: {
    color: '#a7b4d5',
    fontSize: 13,
    fontWeight: '700',
    marginBottom: 8,
  },
  userRow: {
    flexDirection: 'row',
    gap: 12,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
    backgroundColor: 'rgba(255,255,255,0.04)',
    padding: 12,
  },
  avatarPlaceholder: {
    width: 52,
    height: 52,
    borderRadius: 26,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(124,150,255,0.25)',
  },
  avatarText: {
    color: '#f2f7ff',
    fontWeight: '800',
  },
  userFields: {
    flex: 1,
  },
  nameInput: {
    color: '#eef3ff',
    fontSize: 15,
    fontWeight: '700',
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.12)',
    paddingBottom: 6,
  },
  userId: {
    marginTop: 8,
    color: '#91a0c3',
    fontSize: 12,
    fontWeight: '600',
  },
  actionsWrap: {
    marginTop: 16,
  },
  actionBtn: {
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.14)',
    backgroundColor: 'rgba(255,255,255,0.05)',
    paddingVertical: 11,
    paddingHorizontal: 12,
    marginBottom: 8,
  },
  actionText: {
    color: '#e5eeff',
    fontSize: 14,
    fontWeight: '700',
  },
  version: {
    marginTop: 2,
    color: '#94a3c8',
    fontSize: 12,
  },
  footnote: {
    marginTop: 12,
    color: '#7f8fb5',
    fontSize: 12,
  },
});
