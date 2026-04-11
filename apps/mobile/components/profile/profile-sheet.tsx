import React, {
  forwardRef,
  memo,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  Alert,
  Dimensions,
  Keyboard,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { BlurView } from 'expo-blur';
import { LinearGradient } from 'expo-linear-gradient';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
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

import { useTradeSettings } from '@/contexts/trade-settings-context';
import { useAuth } from '@/contexts/auth-context';
import { useWalletContext } from '@/contexts/wallet-context';
import { API_BASE } from '@/lib/api-base';

import { TradeSettings } from './trade-settings';
import { SolanaIcon } from '../icons/SolanaIcon';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';

const { height: SCREEN_HEIGHT } = Dimensions.get('window');
const SHEET_HEIGHT = Math.round(SCREEN_HEIGHT * 0.8);
const DRAG_CLOSE_THRESHOLD = 120;
const SOLANA_MAINNET_RPC = 'https://api.mainnet-beta.solana.com';
const TWITTER_PROFILE_CACHE_KEY = '@memeswipe:twitterProfile:v1';

export type ProfileSheetRef = {
  open: () => void;
  close: () => void;
};

type ProfileSheetProps = {
  onStateChange?: (open: boolean) => void;
};

export const ProfileSheet = memo(
  forwardRef<ProfileSheetRef, ProfileSheetProps>(function ProfileSheet({ onStateChange }, ref) {
    const insets = useSafeAreaInsets();
    const [mounted, setMounted] = useState(false);
    const [open, setOpen] = useState(false);
    const [inputFocused, setInputFocused] = useState(false);
    const scrollRef = useRef<ScrollView>(null);
    const [walletSolBalance, setWalletSolBalance] = useState<number | null>(null);
    const [walletSolPriceUsd, setWalletSolPriceUsd] = useState<number | null>(null);
    const [balanceRefreshing, setBalanceRefreshing] = useState(false);
    const [keyboardHeight, setKeyboardHeight] = useState(0);

    const openProgress = useSharedValue(0);
    const dragY = useSharedValue(0);

    const {
      profileName,
      setProfileName,
      tradeAmount,
      tpROI,
      stopLoss,
      resetSettings,
    } = useTradeSettings();
    const { logout } = useAuth();
    const { twitterProfile, setTwitterProfile, tradingWalletAddress, walletAddress } = useWalletContext();

    const closeSheet = useCallback(() => {
      setOpen(false);
      onStateChange?.(false);
    }, [onStateChange]);

    const openSheet = useCallback(() => {
      setMounted(true);
      setOpen(true);
      onStateChange?.(true);
    }, [onStateChange]);

    useImperativeHandle(
      ref,
      () => ({
        open: openSheet,
        close: closeSheet,
      }),
      [closeSheet, openSheet]
    );

    useEffect(() => {
      if (open) {
        openProgress.value = withSpring(1, {
          damping: 26,
          stiffness: 240,
          mass: 0.9,
          overshootClamping: true,
        });
        dragY.value = 0;
        return;
      }

      openProgress.value = withSpring(0, {
        damping: 28,
        stiffness: 260,
        mass: 1,
        overshootClamping: true,
      }, (finished) => {
        if (finished) runOnJS(setMounted)(false);
      });
      dragY.value = 0;
    }, [dragY, open, openProgress]);

    useEffect(() => {
      if (!open) return;
      const targetAddress = tradingWalletAddress || walletAddress;
      if (!targetAddress) {
        setWalletSolBalance(null);
        return;
      }
      let active = true;
      const refreshBalance = async () => {
        try {
          const [res, priceRes] = await Promise.all([
            fetch(SOLANA_MAINNET_RPC, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                jsonrpc: '2.0',
                id: 1,
                method: 'getBalance',
                params: [targetAddress],
              }),
            }),
            fetch(`${API_BASE}/api/solana/price-usd`).catch(() => null),
          ]);
          const json = (await res.json()) as { result?: { value?: number } };
          const lamports = Number(json?.result?.value || 0);
          if (!active) return;
          setWalletSolBalance(Number.isFinite(lamports) ? lamports / 1_000_000_000 : null);
          if (priceRes?.ok) {
            const priceJson = (await priceRes.json()) as { priceUsd?: number };
            const p = Number(priceJson?.priceUsd || 0);
            if (Number.isFinite(p) && p > 0) setWalletSolPriceUsd(p);
          }
        } catch {
          if (!active) return;
          setWalletSolBalance(null);
        }
      };
      void refreshBalance();
      return () => {
        active = false;
      };
    }, [open, tradingWalletAddress, walletAddress]);

    const handleRefreshBalance = useCallback(async () => {
      const targetAddress = tradingWalletAddress || walletAddress;
      if (!targetAddress || balanceRefreshing) return;
      setBalanceRefreshing(true);
      try {
        const [res, priceRes] = await Promise.all([
          fetch(SOLANA_MAINNET_RPC, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              jsonrpc: '2.0', id: 1, method: 'getBalance', params: [targetAddress],
            }),
          }),
          fetch(`${API_BASE}/api/solana/price-usd`).catch(() => null),
        ]);
        const json = (await res.json()) as { result?: { value?: number } };
        const lamports = Number(json?.result?.value || 0);
        setWalletSolBalance(Number.isFinite(lamports) ? lamports / 1_000_000_000 : null);
        if (priceRes?.ok) {
          const priceJson = (await priceRes.json()) as { priceUsd?: number };
          const p = Number(priceJson?.priceUsd || 0);
          if (Number.isFinite(p) && p > 0) setWalletSolPriceUsd(p);
        }
      } catch {
        // ignore
      } finally {
        setBalanceRefreshing(false);
      }
    }, [balanceRefreshing, tradingWalletAddress, walletAddress]);

    useEffect(() => {
      const show = Keyboard.addListener('keyboardDidShow', (event) => {
        setKeyboardHeight(event.endCoordinates?.height || 0);
      });
      const hide = Keyboard.addListener('keyboardDidHide', () => {
        setKeyboardHeight(0);
      });
      return () => {
        show.remove();
        hide.remove();
      };
    }, []);

    useEffect(() => {
      if (inputFocused) {
        scrollRef.current?.scrollTo({ y: 160, animated: true });
      }
    }, [inputFocused]);

    const panGesture = Gesture.Pan()
      .enabled(!inputFocused)
      .onUpdate((event) => {
        dragY.value = Math.max(0, event.translationY);
      })
      .onEnd(() => {
        if (dragY.value > DRAG_CLOSE_THRESHOLD) {
          runOnJS(closeSheet)();
          return;
        }
        dragY.value = withTiming(0, { duration: 260, easing: Easing.out(Easing.cubic) });
      });

    const backdropStyle = useAnimatedStyle(() => ({
      opacity: interpolate(openProgress.value, [0, 1], [0, 1], Extrapolation.CLAMP),
    }));

    const sheetStyle = useAnimatedStyle(() => {
      const baseY = interpolate(openProgress.value, [0, 1], [SHEET_HEIGHT + 40, 0], Extrapolation.CLAMP);
      return {
        transform: [{ translateY: baseY + dragY.value }],
      };
    });

    const initials = useMemo(() => {
      const trimmed = profileName.trim();
      if (!trimmed) return 'TR';
      return trimmed.slice(0, 2).toUpperCase();
    }, [profileName]);

    const handleLogout = useCallback(async () => {
      try {
        setTwitterProfile(null);
        await AsyncStorage.removeItem(TWITTER_PROFILE_CACHE_KEY);
        await logout();
        resetSettings();
        closeSheet();
      } catch (err) {
        console.log('Failed to logout', err);
        Alert.alert('Logout failed', 'Please try again.');
      }
    }, [closeSheet, logout, resetSettings, setTwitterProfile]);

    if (!mounted) return null;

    return (
      <Animated.View style={[styles.overlay, backdropStyle]} pointerEvents="auto">
        <BlurView intensity={25} tint="dark" style={StyleSheet.absoluteFill} />
        <View style={styles.dimLayer} />
        <Pressable
          style={StyleSheet.absoluteFill}
          onPress={() => {
            if (!inputFocused) closeSheet();
          }}
        />

        <GestureDetector gesture={panGesture}>
          <Animated.View style={[styles.sheetWrap, sheetStyle]}>
            <LinearGradient colors={['rgba(82,130,255,0.22)', 'rgba(38,216,179,0.1)']} style={styles.glowHalo} />
            <BlurView intensity={35} tint="dark" style={styles.sheetBlur}>
              <LinearGradient
                colors={['rgba(255,255,255,0.15)', 'rgba(255,255,255,0.05)']}
                style={styles.sheetCard}
              >
                <View style={styles.handleWrap}>
                  <View style={styles.handle} />
                </View>

                <View style={styles.header}>
                  <Text style={styles.title}>Profile & Trading</Text>
                  <Pressable onPress={closeSheet} style={styles.closeBtn}>
                    <Text style={styles.closeText}>Close</Text>
                  </Pressable>
                </View>

                <ScrollView
                  ref={scrollRef}
                  style={styles.scroll}
                  contentContainerStyle={[
                    styles.content,
                    { paddingBottom: 20 + insets.bottom + keyboardHeight },
                  ]}
                  showsVerticalScrollIndicator={false}
                  keyboardShouldPersistTaps="handled"
                >
                  <View style={styles.section}>
                    <Text style={styles.sectionTitle}>User Info</Text>
                    <View style={styles.balanceTopWrap}>
                      <View style={styles.balanceTopLabelRow}>
                        <SolanaIcon size={26} />
                        <Text style={styles.balanceTopLabel}>Balance (SOL)</Text>
                        <Pressable
                          onPress={() => void handleRefreshBalance()}
                          hitSlop={10}
                          style={styles.balanceRefreshBtn}
                          disabled={balanceRefreshing}
                        >
                          <MaterialIcons
                            name="refresh"
                            size={16}
                            color={balanceRefreshing ? '#4a5568' : '#9bc2ff'}
                          />
                        </Pressable>
                      </View>
                      <Text style={styles.balanceTopValue}>
                        {walletSolBalance == null ? '--' : `${walletSolBalance.toFixed(4)} SOL`}
                      </Text>
                      {walletSolBalance != null && walletSolPriceUsd != null && walletSolPriceUsd > 0 ? (
                        <Text style={styles.balanceUsdValue}>
                          ≈ ${(walletSolBalance * walletSolPriceUsd).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} USD
                        </Text>
                      ) : null}
                    </View>
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
                        <Text style={styles.userId}>
                          Twitter: {twitterProfile?.username ? `@${twitterProfile.username}` : 'Not connected'}
                        </Text>
                      </View>
                    </View>
                  </View>

                  <TradeSettings onInputFocusChange={setInputFocused} />

                  <View style={styles.actionsWrap}>
                    <Text style={[styles.sectionTitle, styles.networkTitle]}>Actions</Text>
                    <Pressable style={styles.logoutButton} onPress={handleLogout}>
                      <Text style={styles.logoutIcon}>⇢</Text>
                      <Text style={styles.logoutText}>Logout</Text>
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
        </GestureDetector>
      </Animated.View>
    );
  })
);

const styles = StyleSheet.create({
  overlay: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 45,
    justifyContent: 'flex-end',
  },
  dimLayer: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.35)',
  },
  sheetWrap: {
    width: '100%',
    height: SHEET_HEIGHT,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    overflow: 'hidden',
  },
  glowHalo: {
    ...StyleSheet.absoluteFillObject,
    opacity: 0.9,
  },
  sheetBlur: {
    flex: 1,
  },
  sheetCard: {
    flex: 1,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.2)',
    borderBottomWidth: 0,
    backgroundColor: 'rgba(20,20,28,0.96)',
    paddingTop: 10,
    paddingHorizontal: 14,
  },
  handleWrap: {
    alignItems: 'center',
    marginBottom: 8,
  },
  handle: {
    width: 40,
    height: 4,
    borderRadius: 4,
    backgroundColor: '#888',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  title: {
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
  scroll: {
    flex: 1,
  },
  content: {
    paddingBottom: 28,
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
  balanceTopWrap: {
    borderRadius: 12,
    backgroundColor: 'rgba(255,255,255,0.06)',
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginBottom: 10,
  },
  balanceTopLabelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  balanceRefreshBtn: {
    marginLeft: 'auto',
    width: 28,
    height: 28,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(155,194,255,0.1)',
    borderWidth: 1,
    borderColor: 'rgba(155,194,255,0.2)',
  },
  balanceTopLabel: {
    color: '#a7b4d5',
    fontSize: 13,
    fontWeight: '600',
  },
  balanceTopValue: {
    color: '#fff',
    fontSize: 28,
    fontWeight: '800',
    marginTop: 2,
  },
  balanceUsdValue: {
    color: '#8794b4',
    fontSize: 13,
    fontWeight: '500',
    marginTop: 2,
  },
  balanceRow: {
    marginTop: 8,
    alignSelf: 'stretch',
    borderRadius: 12,
    backgroundColor: 'rgba(255,255,255,0.06)',
    paddingHorizontal: 12,
    paddingVertical: 10,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  balanceLabel: {
    color: '#a7b4d5',
    fontSize: 14,
    fontWeight: '700',
  },
  balanceValue: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '700',
  },
  actionsWrap: {
    marginTop: 16,
  },
  networkTitle: {
    marginTop: 10,
  },
  logoutButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: 'rgba(255,107,107,0.3)',
    backgroundColor: 'rgba(255,80,80,0.12)',
    paddingVertical: 12,
    paddingHorizontal: 12,
    marginBottom: 8,
  },
  logoutIcon: {
    color: '#ff6b6b',
    fontSize: 14,
    fontWeight: '800',
  },
  logoutText: {
    color: '#ff6b6b',
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
