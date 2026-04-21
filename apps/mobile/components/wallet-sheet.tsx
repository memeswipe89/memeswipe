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
  Modal,
  Pressable,
  RefreshControl,
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
import * as Haptics from 'expo-haptics';
import * as Linking from 'expo-linking';
import { LinearGradient } from 'expo-linear-gradient';
import { openExternalLinkSilent } from '@/lib/external-link-warning';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useLinkEmail, usePrivy } from '@privy-io/expo';
import { Ionicons } from '@expo/vector-icons';
import QRCode from 'react-native-qrcode-svg';

import { useWalletContext } from '@/contexts/wallet-context';
import { useTradeSettings } from '@/contexts/trade-settings-context';
import { getUserFriendlyAuthError } from '@/lib/user-friendly-errors';
import { SolanaIcon } from '@/components/icons/SolanaIcon';
import { API_BASE } from '@/lib/api-base';

const { height: SCREEN_HEIGHT } = Dimensions.get('window');
const SHEET_HEIGHT = Math.round(SCREEN_HEIGHT * 0.88);
const DRAG_CLOSE_THRESHOLD = 100;
const MAINNET_RPC_URL = 'https://api.mainnet-beta.solana.com';

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

// ─── Toast notification ───────────────────────────────────────────────────────
function Toast({ message, visible, onHide }: { message: string; visible: boolean; onHide: () => void }) {
  const opacity = useSharedValue(0);

  useEffect(() => {
    if (visible) {
      opacity.value = withTiming(1, { duration: 200 });
      const timer = setTimeout(() => {
        opacity.value = withTiming(0, { duration: 200 }, (finished) => {
          if (finished) runOnJS(onHide)();
        });
      }, 2000);
      return () => clearTimeout(timer);
    }
  }, [visible, opacity, onHide]);

  const animatedStyle = useAnimatedStyle(() => ({
    opacity: opacity.value,
    transform: [{ translateY: interpolate(opacity.value, [0, 1], [-20, 0]) }],
  }));

  if (!visible) return null;

  return (
    <Animated.View style={[{
      position: 'absolute',
      top: 60,
      left: 20,
      right: 20,
      zIndex: 1000,
    }, animatedStyle]}>
      <View style={{
        backgroundColor: 'rgba(48, 209, 88, 0.95)',
        borderRadius: 12,
        padding: 16,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
        shadowColor: '#000',
        shadowOpacity: 0.3,
        shadowRadius: 10,
        shadowOffset: { width: 0, height: 4 },
      }}>
        <Ionicons name="checkmark-circle" size={24} color="#fff" />
        <Text style={{ color: '#fff', fontSize: 15, fontWeight: '700', flex: 1 }}>{message}</Text>
      </View>
    </Animated.View>
  );
}

// ─── QR Code Modal ────────────────────────────────────────────────────────────
function QRCodeModal({ visible, address, onClose }: { visible: boolean; address: string; onClose: () => void }) {
  if (!visible) return null;

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={StyleSheet.absoluteFill} onPress={onClose}>
        <BlurView intensity={30} tint="dark" style={StyleSheet.absoluteFill} />
        <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', padding: 20 }}>
          <Pressable onPress={(e) => e.stopPropagation()}>
            <View style={{
              backgroundColor: 'rgba(28, 28, 30, 0.98)',
              borderRadius: 24,
              padding: 30,
              alignItems: 'center',
              borderWidth: 1,
              borderColor: 'rgba(255,255,255,0.1)',
              shadowColor: '#000',
              shadowOpacity: 0.5,
              shadowRadius: 20,
              shadowOffset: { width: 0, height: 10 },
            }}>
              <Text style={{ color: '#fff', fontSize: 20, fontWeight: '800', marginBottom: 8, letterSpacing: 0.3 }}>
                Deposit SOL
              </Text>
              <Text style={{ color: 'rgba(255,255,255,0.6)', fontSize: 14, marginBottom: 24, textAlign: 'center', fontWeight: '500' }}>
                Scan this QR code to deposit SOL
              </Text>
              
              <View style={{
                backgroundColor: '#fff',
                padding: 20,
                borderRadius: 16,
                marginBottom: 20,
              }}>
                <QRCode value={address} size={220} />
              </View>

              <Text style={{ 
                color: 'rgba(255,255,255,0.5)', 
                fontSize: 12, 
                textAlign: 'center',
                fontFamily: 'monospace',
                marginBottom: 20,
                fontWeight: '600',
              }}>
                {truncateMiddle(address, 8)}
              </Text>

              <Pressable
                onPress={onClose}
                style={{
                  paddingHorizontal: 32,
                  paddingVertical: 12,
                  borderRadius: 12,
                  backgroundColor: 'rgba(255,255,255,0.1)',
                  borderWidth: 1,
                  borderColor: 'rgba(255,255,255,0.2)',
                }}
              >
                <Text style={{ color: '#fff', fontWeight: '700', fontSize: 15 }}>Close</Text>
              </Pressable>
            </View>
          </Pressable>
        </View>
      </Pressable>
    </Modal>
  );
}

// ─── Avatar ───────────────────────────────────────────────────────────────────
function Avatar({ name, size = 72 }: { name: string; size?: number }) {
  const initials = name.split(' ').map((w) => w[0]).join('').toUpperCase().slice(0, 2);
  return (
    <View style={{
      width: size, height: size, borderRadius: size / 2,
      backgroundColor: 'rgba(42, 42, 42, 0.6)', 
      alignItems: 'center', justifyContent: 'center',
      borderWidth: 3, 
      borderColor: 'rgba(255,255,255,0.1)',
      shadowColor: '#000',
      shadowOpacity: 0.3,
      shadowRadius: 12,
      shadowOffset: { width: 0, height: 4 },
    }}>
      <Text style={{ color: '#fff', fontSize: size * 0.35, fontWeight: '800', letterSpacing: 1 }}>{initials || '?'}</Text>
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
        paddingVertical: 14, paddingHorizontal: 18,
        backgroundColor: pressed ? 'rgba(255,255,255,0.05)' : 'transparent',
        borderBottomWidth: last ? 0 : 0.5, 
        borderBottomColor: 'rgba(255,255,255,0.06)',
      })}
    >
      <View style={{
        width: 36, height: 36, borderRadius: 10, backgroundColor: iconBg,
        alignItems: 'center', justifyContent: 'center', marginRight: 14,
        shadowColor: iconBg,
        shadowOpacity: 0.4,
        shadowRadius: 8,
        shadowOffset: { width: 0, height: 2 },
      }}>
        <Ionicons name={icon} size={18} color="#fff" />
      </View>
      <Text style={{ flex: 1, color: destructive ? '#ff453a' : '#fff', fontSize: 16, fontWeight: '600' }}>{label}</Text>
      {value ? <Text style={{ color: '#8e8e93', fontSize: 14, marginRight: showChevron ? 6 : 0, fontWeight: '500' }}>{value}</Text> : null}
      {showChevron ? <Ionicons name="chevron-forward" size={18} color='rgba(255,255,255,0.3)' /> : null}
    </Pressable>
  );
}

// ─── Section card ─────────────────────────────────────────────────────────────
function MenuSection({ children }: { children: React.ReactNode }) {
  return (
    <View style={{ 
      backgroundColor: 'rgba(28, 28, 30, 0.7)', 
      borderRadius: 16, 
      marginBottom: 16, 
      overflow: 'hidden',
      borderWidth: 1,
      borderColor: 'rgba(255,255,255,0.08)',
      shadowColor: '#000',
      shadowOpacity: 0.2,
      shadowRadius: 10,
      shadowOffset: { width: 0, height: 4 },
    }}>
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
    <View style={{ 
      backgroundColor: 'rgba(28, 28, 30, 0.7)', 
      borderRadius: 16, 
      padding: 20, 
      marginBottom: 16,
      borderWidth: 1,
      borderColor: 'rgba(255,255,255,0.08)',
      shadowColor: '#000',
      shadowOpacity: 0.2,
      shadowRadius: 10,
      shadowOffset: { width: 0, height: 4 },
    }}>
      <Text style={{ color: '#fff', fontWeight: '800', fontSize: 17, marginBottom: 16, letterSpacing: 0.3 }}>Send SOL</Text>
      <TextInput
        value={addr} onChangeText={setAddr}
        placeholder="Destination address" placeholderTextColor="rgba(255,255,255,0.3)"
        autoCapitalize="none" autoCorrect={false}
        style={{ 
          backgroundColor: 'rgba(255,255,255,0.05)', 
          borderRadius: 12, 
          paddingHorizontal: 14, 
          paddingVertical: 12, 
          color: '#fff', 
          fontSize: 14, 
          marginBottom: 12,
          borderWidth: 1,
          borderColor: 'rgba(255,255,255,0.1)',
          fontWeight: '500',
        }}
      />
      <TextInput
        value={amt} onChangeText={setAmt}
        placeholder="Amount (SOL)" placeholderTextColor="rgba(255,255,255,0.3)" keyboardType="decimal-pad"
        style={{ 
          backgroundColor: 'rgba(255,255,255,0.05)', 
          borderRadius: 12, 
          paddingHorizontal: 14, 
          paddingVertical: 12, 
          color: '#fff', 
          fontSize: 14, 
          marginBottom: 16,
          borderWidth: 1,
          borderColor: 'rgba(255,255,255,0.1)',
          fontWeight: '500',
        }}
      />
      <View style={{ flexDirection: 'row', gap: 12 }}>
        <Pressable onPress={onClose} style={{ 
          flex: 1, 
          backgroundColor: 'rgba(255,255,255,0.08)', 
          borderRadius: 12, 
          paddingVertical: 14, 
          alignItems: 'center',
          borderWidth: 1,
          borderColor: 'rgba(255,255,255,0.1)',
        }}>
          <Text style={{ color: '#fff', fontWeight: '700', fontSize: 15 }}>Cancel</Text>
        </Pressable>
        <Pressable onPress={() => onSend(addr, amt)} disabled={sending}
          style={{ 
            flex: 1, 
            borderRadius: 12, 
            paddingVertical: 14, 
            alignItems: 'center', 
            opacity: sending ? 0.6 : 1,
            overflow: 'hidden',
          }}>
          <LinearGradient
            colors={['#0a84ff', '#0066cc']}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={{
              position: 'absolute',
              left: 0,
              right: 0,
              top: 0,
              bottom: 0,
            }}
          />
          <Text style={{ color: '#fff', fontWeight: '800', fontSize: 15 }}>{sending ? 'Sending…' : 'Send'}</Text>
        </Pressable>
      </View>
    </View>
  );
}

// ─── Sheet content ────────────────────────────────────────────────────────────
function WalletContent({ onClose }: { onClose: () => void }) {
  const { twitterProfile, setTwitterProfile, tradingWalletAddress, walletLoading, walletError, getOrCreateTradingWalletAddress, withdrawFromTradingWallet } = useWalletContext();
  const { user: privyUser } = usePrivy();
  const { sendCode, linkWithCode } = useLinkEmail();
  const { profileName, setProfileName, showDisclaimer, setShowDisclaimer, hapticsEnabled, setHapticsEnabled } = useTradeSettings();

  const [solBalance, setSolBalance] = useState<number | null>(null);
  const [solPriceUsd, setSolPriceUsd] = useState<number | null>(null);
  const [balanceLoading, setBalanceLoading] = useState(false);
  const [sendVisible, setSendVisible] = useState(false);
  const [sending, setSending] = useState(false);
  const [emailInput, setEmailInput] = useState('');
  const [codeInput, setCodeInput] = useState('');
  const [sendingCode, setSendingCode] = useState(false);
  const [verifyingCode, setVerifyingCode] = useState(false);
  const [codeSent, setCodeSent] = useState(false);
  const [qrVisible, setQrVisible] = useState(false);
  const [toastMessage, setToastMessage] = useState('');
  const [toastVisible, setToastVisible] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const scrollRef = useRef<ScrollView>(null);

  const showToast = (message: string) => {
    setToastMessage(message);
    setToastVisible(true);
    if (hapticsEnabled) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => undefined);
    }
  };

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

  const copyAddress = async () => {
    if (!tradingWalletAddress) return;
    await Clipboard.setStringAsync(tradingWalletAddress);
    showToast('Address copied to clipboard');
  };

  const openPhantom = async () => {
    if (!tradingWalletAddress) return;
    if (hapticsEnabled) {
      Haptics.selectionAsync().catch(() => undefined);
    }
    const link = `phantom://v1/transfer?recipient=${encodeURIComponent(tradingWalletAddress)}&network=mainnet-beta`;
    try {
      if (await Linking.canOpenURL(link)) await openExternalLinkSilent(link);
      else await openExternalLinkSilent('https://phantom.app/');
    } catch { Alert.alert('Phantom not found', 'Copy the address and send SOL from any Solana wallet.'); }
  };

  const handleShowQR = () => {
    if (hapticsEnabled) {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => undefined);
    }
    setQrVisible(true);
  };

  const handleRefreshBalance = () => {
    if (hapticsEnabled) {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => undefined);
    }
    if (tradingWalletAddress) void loadBalance(tradingWalletAddress);
  };

  const onRefresh = useCallback(async () => {
    if (!tradingWalletAddress) return;
    setRefreshing(true);
    if (hapticsEnabled) {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => undefined);
    }
    try {
      await loadBalance(tradingWalletAddress);
    } finally {
      setRefreshing(false);
    }
  }, [tradingWalletAddress, loadBalance, hapticsEnabled]);

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
      showToast(`Successfully sent ${amount} SOL!`);
      if (tradingWalletAddress) void loadBalance(tradingWalletAddress);
    } catch (e: any) { 
      console.error('Send error:', e);
      Alert.alert('Send Failed', e?.message || 'Could not send SOL. Please try again.');
    }
    finally { setSending(false); }
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

  return (
    <ScrollView
      ref={scrollRef}
      contentContainerStyle={{ paddingHorizontal: 18, paddingBottom: 40, paddingTop: 8 }}
      showsVerticalScrollIndicator={false}
      keyboardShouldPersistTaps="handled"
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={onRefresh}
          tintColor="#0a84ff"
          colors={["#0a84ff"]}
          progressBackgroundColor="rgba(28, 28, 30, 0.9)"
        />
      }
    >
      <Toast message={toastMessage} visible={toastVisible} onHide={() => setToastVisible(false)} />
      <QRCodeModal visible={qrVisible} address={tradingWalletAddress ?? ''} onClose={() => setQrVisible(false)} />

      {/* Avatar + name (read-only) */}
      <View style={{ alignItems: 'center', paddingVertical: 24, paddingBottom: 20 }}>
        <Avatar name={profileName} size={84} />
        <View style={{ marginTop: 16 }}>
          <Text style={{ color: '#fff', fontSize: 24, fontWeight: '800', letterSpacing: 0.3, textAlign: 'center' }}>{profileName}</Text>
        </View>
        {twitterProfile?.username ? (
          <View style={{
            marginTop: 8,
            paddingHorizontal: 12,
            paddingVertical: 4,
            borderRadius: 12,
            backgroundColor: 'rgba(29, 161, 242, 0.15)',
            borderWidth: 1,
            borderColor: 'rgba(29, 161, 242, 0.3)',
          }}>
            <Text style={{ color: '#1DA1F2', fontSize: 13, fontWeight: '600' }}>@{twitterProfile.username}</Text>
          </View>
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
            <View style={{ padding: 20 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                  <View style={{
                    width: 28,
                    height: 28,
                    borderRadius: 14,
                    backgroundColor: 'rgba(138, 99, 255, 0.15)',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}>
                    <SolanaIcon size={16} />
                  </View>
                  <Text style={{ color: 'rgba(255,255,255,0.7)', fontSize: 14, fontWeight: '600', letterSpacing: 0.5 }}>SOL BALANCE</Text>
                </View>
                <Pressable
                  onPress={handleRefreshBalance}
                  hitSlop={10}
                  style={{ 
                    width: 32, 
                    height: 32, 
                    borderRadius: 10, 
                    alignItems: 'center', 
                    justifyContent: 'center', 
                    backgroundColor: 'rgba(255,255,255,0.08)',
                    borderWidth: 1,
                    borderColor: 'rgba(255,255,255,0.1)',
                  }}
                >
                  {balanceLoading
                    ? <ActivityIndicator size="small" color="#8e8e93" />
                    : <Ionicons name="refresh" size={16} color="rgba(255,255,255,0.6)" />}
                </Pressable>
              </View>
              <Text style={{ color: '#fff', fontSize: 32, fontWeight: '800', letterSpacing: -0.5, marginBottom: 4 }}>
                {solBalance === null ? '—' : `${solBalance.toFixed(4)}`}
              </Text>
              <Text style={{ color: 'rgba(255,255,255,0.5)', fontSize: 15, fontWeight: '600' }}>
                {solBalance === null ? 'SOL' : 'SOL'}
              </Text>
              {usdValue ? (
                <View style={{ 
                  marginTop: 12, 
                  paddingTop: 12, 
                  borderTopWidth: 1, 
                  borderTopColor: 'rgba(255,255,255,0.08)' 
                }}>
                  <Text style={{ color: 'rgba(255,255,255,0.5)', fontSize: 13, fontWeight: '600' }}>
                    ≈ ${usdValue} USD
                  </Text>
                </View>
              ) : null}
            </View>
          </MenuSection>

          {/* Deposit Button */}
          <Pressable
            onPress={handleShowQR}
            style={({ pressed }) => ({
              marginBottom: 16,
              borderRadius: 16,
              overflow: 'hidden',
              opacity: pressed ? 0.9 : 1,
            })}
          >
            <LinearGradient
              colors={['#0a84ff', '#0066cc']}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={{
                paddingVertical: 16,
                paddingHorizontal: 20,
                flexDirection: 'row',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 10,
              }}
            >
              <Ionicons name="qr-code" size={24} color="#fff" />
              <Text style={{ color: '#fff', fontSize: 17, fontWeight: '800', letterSpacing: 0.3 }}>
                Show Deposit QR Code
              </Text>
            </LinearGradient>
          </Pressable>

          {/* Actions */}
          <MenuSection>
            <MenuRow icon="copy-outline" iconBg="#3a3a3c" label="Copy Address" value={truncateMiddle(tradingWalletAddress ?? '')} onPress={copyAddress} />
            <MenuRow icon="wallet-outline" iconBg="#1a3a1a" label="Deposit via Phantom" onPress={openPhantom} />
            <MenuRow icon="arrow-up-circle-outline" iconBg="#1c3a5e" label="Send SOL" onPress={() => {
              if (hapticsEnabled) {
                Haptics.selectionAsync().catch(() => undefined);
              }
              setSendVisible((v) => !v);
            }} last />
          </MenuSection>

          <SendForm visible={sendVisible} onClose={() => setSendVisible(false)} onSend={handleSend} sending={sending} />

          {/* Settings */}
          <MenuSection>
            <Pressable
              onPress={() => {
                const newValue = !showDisclaimer;
                setShowDisclaimer(newValue);
                if (hapticsEnabled) {
                  Haptics.selectionAsync().catch(() => undefined);
                }
              }}
              style={({ pressed }) => ({
                flexDirection: 'row', alignItems: 'center',
                paddingVertical: 14, paddingHorizontal: 18,
                backgroundColor: pressed ? 'rgba(255,255,255,0.05)' : 'transparent',
                borderBottomWidth: 0.5,
                borderBottomColor: 'rgba(255,255,255,0.06)',
              })}
            >
              <View style={{
                width: 36, height: 36, borderRadius: 10, 
                backgroundColor: 'rgba(10, 132, 255, 0.2)',
                alignItems: 'center', justifyContent: 'center', marginRight: 14,
                shadowColor: '#0a84ff',
                shadowOpacity: 0.3,
                shadowRadius: 8,
                shadowOffset: { width: 0, height: 2 },
              }}>
                <Ionicons name="information-circle-outline" size={18} color="#0a84ff" />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={{ color: '#fff', fontSize: 16, fontWeight: '600' }}>Show Disclaimer</Text>
                <Text style={{ color: 'rgba(255,255,255,0.5)', fontSize: 12, marginTop: 2, fontWeight: '500' }}>Display risk warning on main screen</Text>
              </View>
              <View style={{
                width: 51, height: 31, borderRadius: 16,
                backgroundColor: showDisclaimer ? '#30d158' : 'rgba(120, 120, 128, 0.32)',
                padding: 2, justifyContent: 'center',
                shadowColor: showDisclaimer ? '#30d158' : '#000',
                shadowOpacity: showDisclaimer ? 0.4 : 0.2,
                shadowRadius: 4,
                shadowOffset: { width: 0, height: 2 },
              }}>
                <View style={{
                  width: 27, height: 27, borderRadius: 14, backgroundColor: '#fff',
                  transform: [{ translateX: showDisclaimer ? 20 : 0 }],
                  shadowColor: '#000', shadowOpacity: 0.3, shadowRadius: 3, shadowOffset: { width: 0, height: 2 },
                }} />
              </View>
            </Pressable>

            <Pressable
              onPress={() => {
                const newValue = !hapticsEnabled;
                setHapticsEnabled(newValue);
                // Give immediate feedback when enabling
                if (newValue) {
                  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => undefined);
                }
              }}
              style={({ pressed }) => ({
                flexDirection: 'row', alignItems: 'center',
                paddingVertical: 14, paddingHorizontal: 18,
                backgroundColor: pressed ? 'rgba(255,255,255,0.05)' : 'transparent',
              })}
            >
              <View style={{
                width: 36, height: 36, borderRadius: 10, 
                backgroundColor: 'rgba(48, 209, 88, 0.2)',
                alignItems: 'center', justifyContent: 'center', marginRight: 14,
                shadowColor: '#30d158',
                shadowOpacity: 0.3,
                shadowRadius: 8,
                shadowOffset: { width: 0, height: 2 },
              }}>
                <Ionicons name="phone-portrait-outline" size={18} color="#30d158" />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={{ color: '#fff', fontSize: 16, fontWeight: '600' }}>Haptic Feedback</Text>
                <Text style={{ color: 'rgba(255,255,255,0.5)', fontSize: 12, marginTop: 2, fontWeight: '500' }}>Vibration feedback for interactions</Text>
              </View>
              <View style={{
                width: 51, height: 31, borderRadius: 16,
                backgroundColor: hapticsEnabled ? '#30d158' : 'rgba(120, 120, 128, 0.32)',
                padding: 2, justifyContent: 'center',
                shadowColor: hapticsEnabled ? '#30d158' : '#000',
                shadowOpacity: hapticsEnabled ? 0.4 : 0.2,
                shadowRadius: 4,
                shadowOffset: { width: 0, height: 2 },
              }}>
                <View style={{
                  width: 27, height: 27, borderRadius: 14, backgroundColor: '#fff',
                  transform: [{ translateX: hapticsEnabled ? 20 : 0 }],
                  shadowColor: '#000', shadowOpacity: 0.3, shadowRadius: 3, shadowOffset: { width: 0, height: 2 },
                }} />
              </View>
            </Pressable>
          </MenuSection>
        </>
      ) : (
        <>
          <View style={{ alignItems: 'center', paddingVertical: 30, paddingHorizontal: 20 }}>
            <View style={{
              width: 80,
              height: 80,
              borderRadius: 40,
              backgroundColor: 'rgba(138, 99, 255, 0.15)',
              alignItems: 'center',
              justifyContent: 'center',
              marginBottom: 20,
              borderWidth: 2,
              borderColor: 'rgba(138, 99, 255, 0.3)',
            }}>
              <Ionicons name="wallet-outline" size={40} color="#8a63ff" />
            </View>
            <Text style={{ color: '#fff', fontSize: 20, fontWeight: '800', marginBottom: 8, letterSpacing: 0.3 }}>
              No Wallet Yet
            </Text>
            <Text style={{ color: 'rgba(255,255,255,0.6)', textAlign: 'center', fontSize: 14, lineHeight: 20, fontWeight: '500' }}>
              {walletError || 'Create a wallet to start trading meme coins on Solana'}
            </Text>
          </View>
          {privyUser ? (
            <MenuSection>
              <Pressable
                onPress={async () => {
                  if (hapticsEnabled) {
                    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => undefined);
                  }
                  try {
                    const address = await getOrCreateTradingWalletAddress();
                    if (address) {
                      showToast('Wallet created successfully!');
                      void loadBalance(address);
                    }
                  } catch (e: any) {
                    const f = getUserFriendlyAuthError(e, { title: 'Wallet', message: 'Could not create a wallet right now.' });
                    Alert.alert(f.title, f.message);
                  }
                }}
                style={({ pressed }) => ({
                  margin: 16,
                  borderRadius: 16,
                  overflow: 'hidden',
                  opacity: pressed ? 0.9 : 1,
                })}
              >
                <LinearGradient
                  colors={['#30d158', '#28a745']}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 1 }}
                  style={{
                    paddingVertical: 16,
                    paddingHorizontal: 20,
                    flexDirection: 'row',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: 10,
                  }}
                >
                  <Ionicons name="add-circle" size={24} color="#fff" />
                  <Text style={{ color: '#fff', fontSize: 17, fontWeight: '800', letterSpacing: 0.3 }}>
                    Create Wallet
                  </Text>
                </LinearGradient>
              </Pressable>
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
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    backgroundColor: 'rgba(10, 10, 12, 0.95)',
    borderTopWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
    shadowColor: '#000',
    shadowOpacity: 0.5,
    shadowRadius: 20,
    shadowOffset: { width: 0, height: -10 },
  },
  handleWrap: { alignItems: 'center', paddingTop: 12, paddingBottom: 8 },
  handle: { 
    width: 40, 
    height: 5, 
    borderRadius: 3, 
    backgroundColor: 'rgba(255,255,255,0.3)',
    shadowColor: '#fff',
    shadowOpacity: 0.2,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 1 },
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.08)',
    backgroundColor: 'rgba(255,255,255,0.02)',
  },
  headerTitle: { 
    color: '#fff', 
    fontSize: 20, 
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  closeBtn: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
    backgroundColor: 'rgba(10, 132, 255, 0.15)',
    borderWidth: 1,
    borderColor: 'rgba(10, 132, 255, 0.3)',
  },
  closeBtnText: { 
    color: '#0a84ff', 
    fontWeight: '700', 
    fontSize: 15,
    letterSpacing: 0.3,
  },
});
