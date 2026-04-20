import React, {
  forwardRef,
  memo,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from 'react';
import {
  ActivityIndicator,
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
import * as Clipboard from 'expo-clipboard';
import * as Linking from 'expo-linking';
import { openExternalLinkSilent } from '@/lib/external-link-warning';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useRouter } from 'expo-router';
import { useLinkEmail, usePrivy } from '@privy-io/expo';
import { Ionicons } from '@expo/vector-icons';

import { useAuth } from '@/contexts/auth-context';
import { useWalletContext } from '@/contexts/wallet-context';
import { useTradeSettings } from '@/contexts/trade-settings-context';
import { getUserFriendlyAuthError } from '@/lib/user-friendly-errors';
import { SolanaIcon } from '@/components/icons/SolanaIcon';
import { API_BASE } from '@/lib/api-base';

const { height: SCREEN_HEIGHT } = Dimensions.get('window');
const SHEET_HEIGHT = Math.round(SCREEN_HEIGHT * 0.88);
const DRAG_CLOSE_THRESHOLD = 100;
const MAINNET_RPC_URL = 'https://api.mainnet-beta.solana.com';

const TWITTER_PROFILE_CACHE_KEY = '@memeswipe:twitterProfile:v1';
const FAVORITES_KEY = '@memeswipe:favorites:v1';
const HIDDEN_TOKENS_KEY = '@memeswipe:hidden-tokens:v1';
const LAST_AMOUNT_KEY = '@memeswipe:lastAmount';
const LAST_ROI_KEY = '@memeswipe:lastROI';
const BONUS_2000_APPLIED_KEY = '@memeswipe:bonus2000:applied';
const LOCAL_USER_ID_KEY = '@memeswipe:userId:v1';
const TRADE_SETTINGS_KEY = '@memeswipe:trade-settings:v1';

const getSolBalance = async (address: string): Promise<number> => {
  const res = await fetch(MAINNET_RPC_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'getBalance', params: [address] }),
  });
  const json = (await res.json()) as { result?: { value?: number } };
  return Number(json?.result?.value || 0) / 1_000_000_000;
};

const truncateMiddle = (value: string, keep = 5) => {
  if (value.length <= keep * 2 + 3) return value;
  return `${value.slice(0, keep)}...${value.slice(-keep)}`;
};

// ─── Avatar ───────────────────────────────────────────────────────────────────
function Avatar({ name, size = 72 }: { name: string; size?: number }) {
  const initials = name.split(' ').map((w) => w[0]).join('').toUpperCase().slice(0, 2);
  return (
    <View style={{
      width: size, height: size, borderRadius: size / 2,
      backgroundColor: '#2a2a2a', alignItems: 'center', justifyContent: 'center',
      borderWidth: 2, borderColor: '#3a3a3a',
    }}>
      <Text style={{ color: '#fff', fontSize: size * 0.35, fontWeight: '700' }}>{initials || '?'}</Text>
    </View>
  );
}

// ─── Menu row ─────────────────────────────────────────────────────────────────
function MenuRow({
  icon, iconBg, label, value, onPress, last = false, destructive = false, showChevron = false,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  iconBg: string;
  label: string;
  value?: string;
  onPress?: () => void;
  last?: boolean;
  destructive?: boolean;
  showChevron?: boolean;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => ({
        flexDirection: 'row', alignItems: 'center',
        paddingVertical: 13, paddingHorizontal: 16,
        backgroundColor: pressed ? '#1e1e1e' : 'transparent',
        borderBottomWidth: last ? 0 : 0.5, borderBottomColor: '#2a2a2a',
      })}
    >
      <View style={{
        width: 32, height: 32, borderRadius: 8, backgroundColor: iconBg,
        alignItems: 'center', justifyContent: 'center', marginRight: 14,
      }}>
        <Ionicons name={icon} size={17} color="#fff" />
      </View>
      <Text style={{ flex: 1, color: destructive ? '#ff453a' : '#fff', fontSize: 16 }}>{label}</Text>
      {value ? <Text style={{ color: '#8e8e93', fontSize: 14, marginRight: showChevron ? 4 : 0 }}>{value}</Text> : null}
      {showChevron ? <Ionicons name="chevron-forward" size={16} color="#3a3a3a" /> : null}
    </Pressable>
  );
}

// ─── Section card ─────────────────────────────────────────────────────────────
function MenuSection({ children }: { children: React.ReactNode }) {
  return (
    <View style={{ backgroundColor: '#1c1c1e', borderRadius: 12, marginBottom: 14, overflow: 'hidden' }}>
      {children}
    </View>
  );
}

// ─── Inline send form ─────────────────────────────────────────────────────────
function SendForm({
  visible, onClose, onSend, sending,
}: {
  visible: boolean;
  onClose: () => void;
  onSend: (addr: string, amt: string) => void;
  sending: boolean;
}) {
  const [addr, setAddr] = useState('');
  const [amt, setAmt] = useState('0.01');
  if (!visible) return null;
  return (
    <View style={{ backgroundColor: '#1c1c1e', borderRadius: 14, padding: 16, marginBottom: 14 }}>
      <Text style={{ color: '#fff', fontWeight: '700', fontSize: 15, marginBottom: 12 }}>Send SOL</Text>
      <TextInput
        value={addr} onChangeText={setAddr}
        placeholder="Destination address" placeholderTextColor="#555"
        autoCapitalize="none" autoCorrect={false}
        style={{ backgroundColor: '#2c2c2e', borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, color: '#fff', fontSize: 13, marginBottom: 10 }}
      />
      <TextInput
        value={amt} onChangeText={setAmt}
        placeholder="Amount (SOL)" placeholderTextColor="#555" keyboardType="decimal-pad"
        style={{ backgroundColor: '#2c2c2e', borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, color: '#fff', fontSize: 13, marginBottom: 12 }}
      />
      <View style={{ flexDirection: 'row', gap: 10 }}>
        <Pressable onPress={onClose} style={{ flex: 1, backgroundColor: '#2c2c2e', borderRadius: 10, paddingVertical: 12, alignItems: 'center' }}>
          <Text style={{ color: '#fff', fontWeight: '600' }}>Cancel</Text>
        </Pressable>
        <Pressable onPress={() => onSend(addr, amt)} disabled={sending}
          style={{ flex: 1, backgroundColor: '#0a84ff', borderRadius: 10, paddingVertical: 12, alignItems: 'center', opacity: sending ? 0.6 : 1 }}>
          <Text style={{ color: '#fff', fontWeight: '700' }}>{sending ? 'Sending…' : 'Send'}</Text>
        </Pressable>
      </View>
    </View>
  );
}

// ─── Sheet content ────────────────────────────────────────────────────────────
function WalletContent({ onClose }: { onClose: () => void }) {
  const router = useRouter();
  const { twitterProfile, setTwitterProfile, tradingWalletAddress, walletLoading, walletError, getOrCreateTradingWalletAddress, withdrawFromTradingWallet } = useWalletContext();
  const { logout } = useAuth();
  const { user: privyUser } = usePrivy();
  const { sendCode, linkWithCode } = useLinkEmail();
  const { profileName, setProfileName, showDisclaimer, setShowDisclaimer } = useTradeSettings();

  const [solBalance, setSolBalance] = useState<number | null>(null);
  const [solPriceUsd, setSolPriceUsd] = useState<number | null>(null);
  const [balanceLoading, setBalanceLoading] = useState(false);
  const [sendVisible, setSendVisible] = useState(false);
  const [sending, setSending] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);
  const [editingName, setEditingName] = useState(false);
  const [nameInput, setNameInput] = useState(profileName);
  const nameInputRef = useRef<TextInput>(null);
  const [emailInput, setEmailInput] = useState('');
  const [codeInput, setCodeInput] = useState('');
  const [sendingCode, setSendingCode] = useState(false);
  const [verifyingCode, setVerifyingCode] = useState(false);
  const [codeSent, setCodeSent] = useState(false);
  const scrollRef = useRef<ScrollView>(null);

  useEffect(() => { setNameInput(profileName); }, [profileName]);

  const loadBalance = useCallback(async (address: string) => {
    try {
      setBalanceLoading(true);
      const [next] = await Promise.all([
        getSolBalance(address),
        fetch(`${API_BASE}/api/solana/price-usd`).then((r) => r.json()).then((j) => {
          const p = Number(j?.priceUsd || 0);
          if (Number.isFinite(p) && p > 0) setSolPriceUsd(p);
        }).catch(() => undefined),
      ]);
      setSolBalance(next);
    } catch { /* ignore */ } finally { setBalanceLoading(false); }
  }, []);

  useEffect(() => {
    if (tradingWalletAddress) void loadBalance(tradingWalletAddress);
  }, [tradingWalletAddress, loadBalance]);

  const saveName = () => {
    const t = nameInput.trim();
    if (t) setProfileName(t); else setNameInput(profileName);
    setEditingName(false);
  };

  const copyAddress = async () => {
    if (!tradingWalletAddress) return;
    await Clipboard.setStringAsync(tradingWalletAddress);
    Alert.alert('Copied', 'Wallet address copied to clipboard.');
  };

  const openPhantom = async () => {
    if (!tradingWalletAddress) return;
    const link = `phantom://v1/transfer?recipient=${encodeURIComponent(tradingWalletAddress)}&network=mainnet-beta`;
    try {
      if (await Linking.canOpenURL(link)) await openExternalLinkSilent(link);
      else await openExternalLinkSilent('https://phantom.app/');
    } catch { Alert.alert('Phantom not found', 'Copy the address and send SOL from any Solana wallet.'); }
  };

  const handleSend = async (toAddress: string, amountStr: string) => {
    const amount = Number(amountStr);
    if (!Number.isFinite(amount) || amount <= 0) { 
      Alert.alert('Invalid Amount', 'Please enter a valid amount.'); 
      return; 
    }
    if (!toAddress.trim()) { 
      Alert.alert('Missing Address', 'Please enter a destination address.'); 
      return; 
    }
    
    // Check if user has enough balance
    if (solBalance !== null && amount > solBalance) {
      Alert.alert(
        'Insufficient Balance',
        `You only have ${solBalance.toFixed(4)} SOL available. Please enter a smaller amount.`
      );
      return;
    }
    
    try {
      setSending(true);
      const result = await withdrawFromTradingWallet(amount, toAddress.trim());
      setSendVisible(false);
      Alert.alert(
        'Success!', 
        `Successfully sent ${amount} SOL!\n\nTransaction ID: ${result.txSignature.slice(0, 8)}...${result.txSignature.slice(-8)}`
      );
      if (tradingWalletAddress) void loadBalance(tradingWalletAddress);
    } catch (e: any) { 
      console.error('Send error:', e);
      Alert.alert('Send Failed', e?.message || 'Could not send SOL. Please try again.');
    }
    finally { setSending(false); }
  };

  const handleLogout = () => {
    Alert.alert('Sign Out', 'Are you sure you want to sign out?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Sign Out', style: 'destructive',
        onPress: () => void (async () => {
          try {
            setLoggingOut(true);
            setTwitterProfile(null);
            await AsyncStorage.multiRemove([TWITTER_PROFILE_CACHE_KEY, FAVORITES_KEY, HIDDEN_TOKENS_KEY, LAST_AMOUNT_KEY, LAST_ROI_KEY, BONUS_2000_APPLIED_KEY, LOCAL_USER_ID_KEY, TRADE_SETTINGS_KEY]);
            await logout();
            onClose();
            router.replace('/(tabs)');
          } catch (e: any) { Alert.alert('Sign Out', e?.message || 'Failed to sign out.'); }
          finally { setLoggingOut(false); }
        })(),
      },
    ]);
  };

  const handleSendCode = useCallback(async () => {
    const email = emailInput.trim();
    if (!email) { Alert.alert('Email required', 'Enter a valid email address.'); return; }
    try {
      setSendingCode(true);
      await sendCode({ email });
      setCodeSent(true);
    } catch (e: any) {
      const f = getUserFriendlyAuthError(e, { title: 'Error', message: 'Could not send code.' });
      Alert.alert(f.title, f.message);
    } finally { setSendingCode(false); }
  }, [emailInput, sendCode]);

  const handleVerifyCode = useCallback(async () => {
    const email = emailInput.trim(); const code = codeInput.trim();
    if (!email || !code) { Alert.alert('Required', 'Enter your email and code.'); return; }
    try {
      setVerifyingCode(true);
      await linkWithCode({ email, code });
      const address = await getOrCreateTradingWalletAddress();
      if (address) void loadBalance(address);
    } catch (e: any) {
      const f = getUserFriendlyAuthError(e, { title: 'Verification failed', message: 'Check the code and try again.' });
      Alert.alert(f.title, f.message);
    } finally { setVerifyingCode(false); }
  }, [codeInput, emailInput, getOrCreateTradingWalletAddress, linkWithCode, loadBalance]);

  const hasWallet = Boolean(tradingWalletAddress);
  const usdValue = solBalance !== null && solPriceUsd !== null && solPriceUsd > 0
    ? (solBalance * solPriceUsd).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    : null;
  const linkedEmail = (() => {
    if (!privyUser) return null;
    const accounts: any[] = (privyUser as any)?.linked_accounts ?? (privyUser as any)?.linkedAccounts ?? [];
    const ea = accounts.find((a: any) => a?.type === 'email');
    return ea?.address ?? ea?.email ?? null;
  })();

  return (
    <ScrollView
      ref={scrollRef}
      contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 40, paddingTop: 4 }}
      showsVerticalScrollIndicator={false}
      keyboardShouldPersistTaps="handled"
    >
      {/* Avatar + editable name */}
      <View style={{ alignItems: 'center', paddingVertical: 20 }}>
        <Avatar name={profileName} size={76} />
        {editingName ? (
          <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 12, gap: 8 }}>
            <TextInput
              ref={nameInputRef} value={nameInput} onChangeText={setNameInput}
              onSubmitEditing={saveName} autoFocus returnKeyType="done"
              style={{ color: '#fff', fontSize: 20, fontWeight: '700', borderBottomWidth: 1.5, borderBottomColor: '#0a84ff', minWidth: 120, textAlign: 'center', paddingVertical: 2, paddingHorizontal: 4 }}
            />
            <Pressable onPress={saveName} hitSlop={10}>
              <Ionicons name="checkmark-circle" size={24} color="#0a84ff" />
            </Pressable>
          </View>
        ) : (
          <Pressable
            onPress={() => { setEditingName(true); setTimeout(() => nameInputRef.current?.focus(), 50); }}
            style={{ flexDirection: 'row', alignItems: 'center', marginTop: 12, gap: 6 }}
          >
            <Text style={{ color: '#fff', fontSize: 22, fontWeight: '700' }}>{profileName}</Text>
            <Ionicons name="pencil" size={14} color="#8e8e93" />
          </Pressable>
        )}
        {twitterProfile?.username ? (
          <Text style={{ color: '#8e8e93', fontSize: 13, marginTop: 3 }}>@{twitterProfile.username}</Text>
        ) : null}
      </View>

      {walletLoading ? (
        <View style={{ alignItems: 'center', paddingVertical: 20 }}>
          <ActivityIndicator color="#fff" />
          <Text style={{ color: '#8e8e93', marginTop: 8 }}>Loading wallet…</Text>
        </View>
      ) : hasWallet ? (
        <>
          {/* Balance */}
          <MenuSection>
            <View style={{ padding: 16 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 7 }}>
                  <SolanaIcon size={18} />
                  <Text style={{ color: '#8e8e93', fontSize: 13 }}>SOL Balance</Text>
                </View>
                <Pressable
                  onPress={() => tradingWalletAddress && void loadBalance(tradingWalletAddress)}
                  hitSlop={10}
                  style={{ width: 28, height: 28, borderRadius: 8, alignItems: 'center', justifyContent: 'center', backgroundColor: '#2c2c2e' }}
                >
                  {balanceLoading
                    ? <ActivityIndicator size="small" color="#8e8e93" />
                    : <Ionicons name="refresh" size={14} color="#8e8e93" />}
                </Pressable>
              </View>
              <Text style={{ color: '#fff', fontSize: 26, fontWeight: '700' }}>
                {solBalance === null ? '—' : `${solBalance.toFixed(4)} SOL`}
              </Text>
              {usdValue ? <Text style={{ color: '#8e8e93', fontSize: 13, marginTop: 2 }}>≈ ${usdValue} USD</Text> : null}
            </View>
          </MenuSection>

          {/* Actions */}
          <MenuSection>
            <MenuRow icon="copy-outline" iconBg="#3a3a3c" label="Copy Address" value={truncateMiddle(tradingWalletAddress ?? '')} onPress={copyAddress} />
            <MenuRow icon="wallet-outline" iconBg="#1a3a1a" label="Open in Phantom" onPress={openPhantom} />
            <MenuRow icon="arrow-up-circle-outline" iconBg="#1c3a5e" label="Send SOL" onPress={() => setSendVisible((v) => !v)} last />
          </MenuSection>

          <SendForm visible={sendVisible} onClose={() => setSendVisible(false)} onSend={handleSend} sending={sending} />

          {/* Account */}
          <MenuSection>
            <MenuRow icon="logo-twitter" iconBg="#1a2a3a" label="X / Twitter" value={twitterProfile?.username ? `@${twitterProfile.username}` : 'Not connected'} onPress={() => {}} />
            <MenuRow icon="mail-outline" iconBg="#2a1a3a" label="Email" value={linkedEmail ?? 'Not linked'} onPress={() => {}} last />
          </MenuSection>

          {/* Settings */}
          <MenuSection>
            <Pressable
              onPress={() => setShowDisclaimer(!showDisclaimer)}
              style={({ pressed }) => ({
                flexDirection: 'row', alignItems: 'center',
                paddingVertical: 13, paddingHorizontal: 16,
                backgroundColor: pressed ? '#1e1e1e' : 'transparent',
              })}
            >
              <View style={{
                width: 32, height: 32, borderRadius: 8, backgroundColor: '#2a2a3a',
                alignItems: 'center', justifyContent: 'center', marginRight: 14,
              }}>
                <Ionicons name="information-circle-outline" size={17} color="#fff" />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={{ color: '#fff', fontSize: 16 }}>Show Disclaimer</Text>
                <Text style={{ color: '#8e8e93', fontSize: 12, marginTop: 2 }}>Display risk warning on main screen</Text>
              </View>
              <View style={{
                width: 48, height: 28, borderRadius: 14,
                backgroundColor: showDisclaimer ? '#30d158' : 'rgba(255,255,255,0.15)',
                padding: 2, justifyContent: 'center',
              }}>
                <View style={{
                  width: 24, height: 24, borderRadius: 12, backgroundColor: '#fff',
                  transform: [{ translateX: showDisclaimer ? 20 : 0 }],
                  shadowColor: '#000', shadowOpacity: 0.2, shadowRadius: 2, shadowOffset: { width: 0, height: 1 },
                }} />
              </View>
            </Pressable>
          </MenuSection>

          {/* T&C + Sign out */}
          <MenuSection>
            <MenuRow
              icon="document-text-outline"
              iconBg="#2a2a1a"
              label="Terms & Conditions"
              showChevron
              onPress={() => { router.push('/terms'); }}
            />
            <MenuRow icon="log-out-outline" iconBg="#3a1a1a" label={loggingOut ? 'Signing out…' : 'Sign Out'} onPress={handleLogout} destructive last />
          </MenuSection>
        </>
      ) : (
        <>
          <Text style={{ color: '#8e8e93', textAlign: 'center', marginBottom: 16 }}>
            {walletError || 'No wallet found. Create one to start trading.'}
          </Text>
          {privyUser ? (
            <MenuSection>
              <MenuRow icon="add-circle-outline" iconBg="#1a3a1a" label="Create Wallet"
                onPress={async () => {
                  try {
                    const address = await getOrCreateTradingWalletAddress();
                    if (address) void loadBalance(address);
                  } catch (e: any) {
                    const f = getUserFriendlyAuthError(e, { title: 'Wallet', message: 'Could not create a wallet right now.' });
                    Alert.alert(f.title, f.message);
                  }
                }} last />
            </MenuSection>
          ) : (
            <MenuSection>
              <View style={{ padding: 16 }}>
                <Text style={{ color: '#8e8e93', fontSize: 13, marginBottom: 10 }}>Link your email to create a wallet</Text>
                <TextInput value={emailInput} onChangeText={setEmailInput} placeholder="Email address" placeholderTextColor="#555" autoCapitalize="none" autoCorrect={false} keyboardType="email-address"
                  style={{ backgroundColor: '#2c2c2e', borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, color: '#fff', fontSize: 14, marginBottom: 10 }} />
                <Pressable onPress={handleSendCode} disabled={sendingCode}
                  style={{ backgroundColor: '#0a84ff', borderRadius: 10, paddingVertical: 12, alignItems: 'center', opacity: sendingCode ? 0.6 : 1 }}>
                  <Text style={{ color: '#fff', fontWeight: '700' }}>{sendingCode ? 'Sending…' : 'Send Code'}</Text>
                </Pressable>
                {codeSent ? (
                  <>
                    <TextInput value={codeInput} onChangeText={setCodeInput} placeholder="Verification code" placeholderTextColor="#555" keyboardType="number-pad"
                      style={{ backgroundColor: '#2c2c2e', borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, color: '#fff', fontSize: 14, marginTop: 10, marginBottom: 10 }} />
                    <Pressable onPress={handleVerifyCode} disabled={verifyingCode}
                      style={{ backgroundColor: '#30d158', borderRadius: 10, paddingVertical: 12, alignItems: 'center', opacity: verifyingCode ? 0.6 : 1 }}>
                      <Text style={{ color: '#fff', fontWeight: '700' }}>{verifyingCode ? 'Verifying…' : 'Verify & Connect'}</Text>
                    </Pressable>
                  </>
                ) : null}
              </View>
            </MenuSection>
          )}
        </>
      )}
    </ScrollView>
  );
}

// ─── Sheet wrapper ────────────────────────────────────────────────────────────
export type WalletSheetRef = { open: () => void; close: () => void };

export const WalletSheet = memo(
  forwardRef<WalletSheetRef>(function WalletSheet(_props, ref) {
    const insets = useSafeAreaInsets();
    const [mounted, setMounted] = useState(false);
    const [open, setOpen] = useState(false);
    const openProgress = useSharedValue(0);
    const dragY = useSharedValue(0);

    const closeSheet = useCallback(() => {
      setOpen(false);
    }, []);

    const openSheet = useCallback(() => {
      setMounted(true);
      setOpen(true);
    }, []);

    useImperativeHandle(ref, () => ({ open: openSheet, close: closeSheet }), [openSheet, closeSheet]);

    useEffect(() => {
      if (open) {
        openProgress.value = withSpring(1, { damping: 26, stiffness: 240, mass: 0.9, overshootClamping: true });
        dragY.value = 0;
        return;
      }
      openProgress.value = withSpring(0, { damping: 28, stiffness: 260, mass: 1, overshootClamping: true }, (finished) => {
        if (finished) runOnJS(setMounted)(false);
      });
      dragY.value = 0;
    }, [open, openProgress, dragY]);

    const panGesture = Gesture.Pan()
      .onUpdate((e) => { dragY.value = Math.max(0, e.translationY); })
      .onEnd(() => {
        if (dragY.value > DRAG_CLOSE_THRESHOLD) { runOnJS(closeSheet)(); return; }
        dragY.value = withTiming(0, { duration: 260, easing: Easing.out(Easing.cubic) });
      });

    const backdropStyle = useAnimatedStyle(() => ({
      opacity: interpolate(openProgress.value, [0, 1], [0, 1], Extrapolation.CLAMP),
    }));

    const sheetStyle = useAnimatedStyle(() => {
      const baseY = interpolate(openProgress.value, [0, 1], [SHEET_HEIGHT + 40, 0], Extrapolation.CLAMP);
      return { transform: [{ translateY: baseY + dragY.value }] };
    });

    if (!mounted) return null;

    return (
      <Animated.View style={[StyleSheet.absoluteFill, { zIndex: 50, justifyContent: 'flex-end' }, backdropStyle]} pointerEvents="auto">
        <BlurView intensity={25} tint="dark" style={StyleSheet.absoluteFill} />
        <View style={[StyleSheet.absoluteFill, { backgroundColor: 'rgba(0,0,0,0.4)' }]} />
        <Pressable style={StyleSheet.absoluteFill} onPress={closeSheet} />

        <GestureDetector gesture={panGesture}>
          <Animated.View style={[styles.sheet, sheetStyle, { paddingBottom: insets.bottom }]}>
            {/* Handle */}
            <View style={styles.handleWrap}>
              <View style={styles.handle} />
            </View>
            {/* Header */}
            <View style={styles.header}>
              <Text style={styles.headerTitle}>Wallet</Text>
              <Pressable onPress={closeSheet} style={styles.closeBtn}>
                <Text style={styles.closeBtnText}>Done</Text>
              </Pressable>
            </View>
            {/* Content */}
            <WalletContent onClose={closeSheet} />
          </Animated.View>
        </GestureDetector>
      </Animated.View>
    );
  })
);

const styles = StyleSheet.create({
  sheet: {
    width: '100%',
    height: SHEET_HEIGHT,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    backgroundColor: 'rgba(15, 15, 15, 0.78)',
    borderTopWidth: 0.5,
    borderColor: '#2a2a2a',
  },
  handleWrap: { alignItems: 'center', paddingTop: 10, paddingBottom: 4 },
  handle: { width: 36, height: 4, borderRadius: 4, backgroundColor: '#444' },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderBottomWidth: 0.5,
    borderBottomColor: '#1c1c1e',
  },
  headerTitle: { color: '#fff', fontSize: 17, fontWeight: '700' },
  closeBtn: {
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: '#1c1c1e',
  },
  closeBtnText: { color: '#0a84ff', fontWeight: '600', fontSize: 14 },
});
