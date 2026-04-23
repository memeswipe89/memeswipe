import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Keyboard,
  Modal,
  Pressable,
  RefreshControl,
  ScrollView,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { LinearGradient } from "expo-linear-gradient";
import * as Clipboard from "expo-clipboard";
import * as Linking from "expo-linking";
import * as Haptics from "expo-haptics";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useRouter } from "expo-router";
import { useLinkEmail, usePrivy } from "@privy-io/expo";
import { Ionicons } from "@expo/vector-icons";
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import FontAwesome from '@expo/vector-icons/FontAwesome';
import QRCode from 'react-native-qrcode-svg';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  interpolate,
  runOnJS,
} from 'react-native-reanimated';
import { BlurView } from 'expo-blur';
import { useAuth } from "@/contexts/auth-context";
import { useWalletContext } from "@/contexts/wallet-context";
import { useTradeSettings } from "@/contexts/trade-settings-context";
import { getUserFriendlyAuthError } from "@/lib/user-friendly-errors";
import { openExternalLink, openExternalLinkSilent } from "@/lib/external-link-warning";
import { SolanaIcon } from "@/components/icons/SolanaIcon";
import { API_BASE } from "@/lib/api-base";

const MAINNET_RPC_URL = "https://api.mainnet-beta.solana.com";
const TWITTER_PROFILE_CACHE_KEY = "@memeswipe:twitterProfile:v1";
const FAVORITES_KEY = "@memeswipe:favorites:v1";
const HIDDEN_TOKENS_KEY = "@memeswipe:hidden-tokens:v1";
const LAST_AMOUNT_KEY = "@memeswipe:lastAmount";
const LAST_ROI_KEY = "@memeswipe:lastROI";
const BONUS_2000_APPLIED_KEY = "@memeswipe:bonus2000:applied";
const LOCAL_USER_ID_KEY = "@memeswipe:userId:v1";
const TRADE_SETTINGS_KEY = "@memeswipe:trade-settings:v1";

const getSolBalance = async (address: string): Promise<number> => {
  const response = await fetch(MAINNET_RPC_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "getBalance",
      params: [address],
    }),
  });
  const json = (await response.json()) as { result?: { value?: number } };
  const lamports = Number(json?.result?.value || 0);
  return lamports / 1_000_000_000;
};

const truncateMiddle = (value: string, keep = 5) => {
  if (value.length <= keep * 2 + 3) return value;
  return `${value.slice(0, keep)}...${value.slice(-keep)}`;
};

const formatSol = (value: number) => `${value.toFixed(4)} SOL`;

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
  if (!visible || !address) return null;

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={{ flex: 1 }} onPress={onClose}>
        <BlurView intensity={30} tint="dark" style={{ flex: 1 }} />
        <View style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, justifyContent: 'center', alignItems: 'center', padding: 20 }}>
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

// ─── Avatar initials ──────────────────────────────────────────────────────────
function Avatar({ name, size = 80 }: { name: string; size?: number }) {
  const initials = name
    .split(" ")
    .map((w) => w[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);
  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: size / 2,
        backgroundColor: "rgba(42, 42, 42, 0.6)",
        alignItems: "center",
        justifyContent: "center",
        borderWidth: 3,
        borderColor: "rgba(255,255,255,0.1)",
        shadowColor: "#000",
        shadowOpacity: 0.3,
        shadowRadius: 12,
        shadowOffset: { width: 0, height: 4 },
      }}
    >
      <Text style={{ color: "#fff", fontSize: size * 0.35, fontWeight: "800", letterSpacing: 1 }}>
        {initials || "?"}
      </Text>
    </View>
  );
}

// ─── Menu row ─────────────────────────────────────────────────────────────────
function MenuRow({
  icon,
  iconBg,
  label,
  value,
  onPress,
  last = false,
  destructive = false,
  rightElement,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  iconBg: string;
  label: string;
  value?: string;
  onPress?: () => void;
  last?: boolean;
  destructive?: boolean;
  rightElement?: React.ReactNode;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => ({
        flexDirection: "row",
        alignItems: "center",
        paddingVertical: 14,
        paddingHorizontal: 18,
        backgroundColor: pressed ? "rgba(255,255,255,0.05)" : "transparent",
        borderBottomWidth: last ? 0 : 0.5,
        borderBottomColor: "rgba(255,255,255,0.06)",
      })}
    >
      <View
        style={{
          width: 36,
          height: 36,
          borderRadius: 10,
          backgroundColor: iconBg,
          alignItems: "center",
          justifyContent: "center",
          marginRight: 14,
          shadowColor: iconBg,
          shadowOpacity: 0.4,
          shadowRadius: 8,
          shadowOffset: { width: 0, height: 2 },
        }}
      >
        <Ionicons name={icon} size={18} color="#fff" />
      </View>
      <Text style={{ flex: 1, color: destructive ? "#ff453a" : "#fff", fontSize: 16, fontWeight: "600" }}>
        {label}
      </Text>
      {rightElement ?? (
        value ? (
          <Text style={{ color: "#8e8e93", fontSize: 14, fontWeight: "500" }}>{value}</Text>
        ) : null
      )}
    </Pressable>
  );
}

// ─── Section card ─────────────────────────────────────────────────────────────
function MenuSection({ children }: { children: React.ReactNode }) {
  return (
    <View
      style={{
        backgroundColor: "rgba(28, 28, 30, 0.7)",
        borderRadius: 16,
        marginBottom: 16,
        overflow: "hidden",
        borderWidth: 1,
        borderColor: "rgba(255,255,255,0.08)",
        shadowColor: "#000",
        shadowOpacity: 0.2,
        shadowRadius: 10,
        shadowOffset: { width: 0, height: 4 },
      }}
    >
      {children}
    </View>
  );
}

// ─── Withdraw sheet (inline) ──────────────────────────────────────────────────
function WithdrawSheet({
  visible,
  onClose,
  onWithdraw,
  withdrawing,
}: {
  visible: boolean;
  onClose: () => void;
  onWithdraw: (address: string, amount: string) => void;
  withdrawing: boolean;
}) {
  const [toAddress, setToAddress] = useState("");
  const [amount, setAmount] = useState("0.01");
  if (!visible) return null;
  return (
    <View style={{ 
      backgroundColor: "rgba(28, 28, 30, 0.7)", 
      borderRadius: 16, 
      padding: 20, 
      marginBottom: 16,
      borderWidth: 1,
      borderColor: "rgba(255,255,255,0.08)",
      shadowColor: "#000",
      shadowOpacity: 0.2,
      shadowRadius: 10,
      shadowOffset: { width: 0, height: 4 },
    }}>
      <Text style={{ color: "#fff", fontWeight: "800", fontSize: 17, marginBottom: 16, letterSpacing: 0.3 }}>
        Send SOL
      </Text>
      <TextInput
        value={toAddress}
        onChangeText={setToAddress}
        placeholder="Destination address"
        placeholderTextColor="rgba(255,255,255,0.3)"
        autoCapitalize="none"
        autoCorrect={false}
        style={{
          backgroundColor: "rgba(255,255,255,0.05)",
          borderRadius: 12,
          paddingHorizontal: 14,
          paddingVertical: 12,
          color: "#fff",
          fontSize: 14,
          marginBottom: 12,
          borderWidth: 1,
          borderColor: "rgba(255,255,255,0.1)",
          fontWeight: "500",
        }}
      />
      <TextInput
        value={amount}
        onChangeText={setAmount}
        placeholder="Amount (SOL)"
        placeholderTextColor="rgba(255,255,255,0.3)"
        keyboardType="decimal-pad"
        style={{
          backgroundColor: "rgba(255,255,255,0.05)",
          borderRadius: 12,
          paddingHorizontal: 14,
          paddingVertical: 12,
          color: "#fff",
          fontSize: 14,
          marginBottom: 16,
          borderWidth: 1,
          borderColor: "rgba(255,255,255,0.1)",
          fontWeight: "500",
        }}
      />
      <View style={{ flexDirection: "row", gap: 12 }}>
        <Pressable
          onPress={onClose}
          style={{ 
            flex: 1, 
            backgroundColor: "rgba(255,255,255,0.08)", 
            borderRadius: 12, 
            paddingVertical: 14, 
            alignItems: "center",
            borderWidth: 1,
            borderColor: "rgba(255,255,255,0.1)",
          }}
        >
          <Text style={{ color: "#fff", fontWeight: "700", fontSize: 15 }}>Cancel</Text>
        </Pressable>
        <Pressable
          onPress={() => onWithdraw(toAddress, amount)}
          disabled={withdrawing}
          style={{ 
            flex: 1, 
            borderRadius: 12, 
            paddingVertical: 14, 
            alignItems: "center", 
            opacity: withdrawing ? 0.6 : 1,
            overflow: "hidden",
          }}
        >
          <LinearGradient
            colors={["#0a84ff", "#0066cc"]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={{
              position: "absolute",
              left: 0,
              right: 0,
              top: 0,
              bottom: 0,
            }}
          />
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
            {withdrawing ? <ActivityIndicator color="#fff" size="small" /> : null}
            <Text style={{ color: "#fff", fontWeight: "800", fontSize: 15 }}>{withdrawing ? "Sending…" : "Send"}</Text>
          </View>
        </Pressable>
      </View>
    </View>
  );
}

// ─── Main screen ──────────────────────────────────────────────────────────────
export default function WalletScreen() {
  const router = useRouter();
  const {
    twitterProfile,
    setTwitterProfile,
    tradingWalletAddress,
    walletLoading,
    walletError,
    getOrCreateTradingWalletAddress,
    withdrawFromTradingWallet,
  } = useWalletContext();
  const { logout } = useAuth();
  const { user: privyUser } = usePrivy();
  const { sendCode, linkWithCode } = useLinkEmail();
  const { profileName, setProfileName, hapticsEnabled } = useTradeSettings();

  const appleUserId = (() => {
    const accounts: any[] = (privyUser as any)?.linked_accounts ?? (privyUser as any)?.linkedAccounts ?? [];
    const apple = accounts.find((a: any) => a?.type === "apple_oauth" || a?.type === "apple");
    const id = apple?.subject ?? apple?.id;
    return typeof id === "string" && id.length > 0 ? id : null;
  })();
  const twitterUsername = typeof twitterProfile?.username === "string" && twitterProfile.username.length > 0 ? twitterProfile.username : null;
  const authInitial =
    (typeof twitterUsername === "string" ? twitterUsername.slice(0, 2) : null) ||
    (typeof appleUserId === "string" ? appleUserId.slice(0, 2) : null);
  const displayProfileName =
    (!profileName || profileName.trim() === '') && authInitial
      ? authInitial.toUpperCase()
      : profileName || 'TR';

  const [solBalance, setSolBalance] = useState<number | null>(null);
  const [solPriceUsd, setSolPriceUsd] = useState<number | null>(null);
  const [balanceLoading, setBalanceLoading] = useState(false);
  const [withdrawVisible, setWithdrawVisible] = useState(false);
  const [withdrawing, setWithdrawing] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);
  const [qrVisible, setQrVisible] = useState(false);
  const [toastMessage, setToastMessage] = useState('');
  const [toastVisible, setToastVisible] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  // Editable profile name
  const [editingName, setEditingName] = useState(false);
  const [nameInput, setNameInput] = useState(displayProfileName);
  const nameInputRef = useRef<TextInput>(null);

  // Email link
  const [emailInput, setEmailInput] = useState("");
  const [codeInput, setCodeInput] = useState("");
  const [sendingCode, setSendingCode] = useState(false);
  const [verifyingCode, setVerifyingCode] = useState(false);
  const [codeSent, setCodeSent] = useState(false);

  const [keyboardHeight, setKeyboardHeight] = useState(0);
  const scrollRef = useRef<ScrollView>(null);

  // Keep nameInput in sync when profileName loads from storage
  useEffect(() => { setNameInput(displayProfileName); }, [displayProfileName]);

  const showToast = (message: string) => {
    setToastMessage(message);
    setToastVisible(true);
    if (hapticsEnabled) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => undefined);
    }
  };

  const clearLocalAppData = async () => {
    await AsyncStorage.multiRemove([
      TWITTER_PROFILE_CACHE_KEY, FAVORITES_KEY, HIDDEN_TOKENS_KEY,
      LAST_AMOUNT_KEY, LAST_ROI_KEY, BONUS_2000_APPLIED_KEY,
      LOCAL_USER_ID_KEY, TRADE_SETTINGS_KEY,
    ]);
  };

  const loadBalance = async (address: string) => {
    try {
      setBalanceLoading(true);
      const [next] = await Promise.all([
        getSolBalance(address),
        fetch(`${API_BASE}/api/solana/price-usd`)
          .then((r) => r.json())
          .then((j) => {
            const p = Number(j?.priceUsd || 0);
            if (Number.isFinite(p) && p > 0) setSolPriceUsd(p);
          })
          .catch(() => undefined),
      ]);
      setSolBalance(next);
    } catch { /* ignore */ }
    finally { setBalanceLoading(false); }
  };

  useEffect(() => {
    if (!tradingWalletAddress) return;
    void loadBalance(tradingWalletAddress);
  }, [tradingWalletAddress]);

  useEffect(() => {
    const show = Keyboard.addListener("keyboardDidShow", (e) => setKeyboardHeight(e.endCoordinates?.height || 0));
    const hide = Keyboard.addListener("keyboardDidHide", () => setKeyboardHeight(0));
    return () => { show.remove(); hide.remove(); };
  }, []);

  const saveName = () => {
    const trimmed = nameInput.trim();
    if (trimmed) setProfileName(trimmed);
    else setNameInput(displayProfileName);
    setEditingName(false);
  };

  const copyAddress = async () => {
    if (!tradingWalletAddress) return;
    await Clipboard.setStringAsync(tradingWalletAddress);
    showToast("Address copied to clipboard");
  };

  const openPhantom = async () => {
    if (!tradingWalletAddress) return;
    if (hapticsEnabled) {
      Haptics.selectionAsync().catch(() => undefined);
    }
    const link = `phantom://v1/transfer?recipient=${encodeURIComponent(tradingWalletAddress)}&network=mainnet-beta`;
    try {
      if (await Linking.canOpenURL(link)) await openExternalLinkSilent(link);
      else await openExternalLinkSilent("https://phantom.app/");
    } catch {
      Alert.alert("Phantom not found", "Copy the address and send SOL from any Solana wallet.");
    }
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

  const handleWithdraw = async (toAddress: string, amountStr: string) => {
    const amount = Number(amountStr);
    if (!Number.isFinite(amount) || amount <= 0) { Alert.alert("Send SOL", "Enter a valid amount."); return; }
    if (!toAddress.trim()) { Alert.alert("Send SOL", "Enter a destination address."); return; }
    try {
      setWithdrawing(true);
      const result = await withdrawFromTradingWallet(amount, toAddress.trim());
      setWithdrawVisible(false);
      showToast(`Successfully sent ${amount} SOL!`);
      if (tradingWalletAddress) void loadBalance(tradingWalletAddress);
    } catch (error: any) {
      Alert.alert("Send Failed", error?.message || "Failed to send SOL.");
    } finally { setWithdrawing(false); }
  };

  const handleLogout = () => {
    if (hapticsEnabled) {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => undefined);
    }
    Alert.alert("Sign Out", "Are you sure you want to sign out?", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Sign Out", style: "destructive",
        onPress: () => {
          void (async () => {
            try {
              setLoggingOut(true);
              setTwitterProfile(null);
              await clearLocalAppData();
              await logout();
              router.replace("/(tabs)");
            } catch (error: any) {
              Alert.alert("Sign Out", error?.message || "Failed to sign out.");
            } finally { setLoggingOut(false); }
          })();
        },
      },
    ]);
  };

  const handleCreateWallet = async () => {
    if (hapticsEnabled) {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => undefined);
    }
    try {
      const address = await getOrCreateTradingWalletAddress();
      showToast("Wallet created successfully!");
      if (address) void loadBalance(address);
    } catch (error: any) {
      const friendly = getUserFriendlyAuthError(error, { title: "Wallet", message: "Could not create a wallet right now." });
      Alert.alert(friendly.title, friendly.message);
    }
  };

  const handleSendCode = useCallback(async () => {
    if (!privyUser) { Alert.alert("Connect Twitter", "Please connect Twitter first."); return; }
    const email = emailInput.trim();
    if (!email) { Alert.alert("Email required", "Enter a valid email address."); return; }
    try {
      setSendingCode(true);
      await sendCode({ email });
      setCodeSent(true);
      Alert.alert("Check your email", "Enter the verification code we sent.");
    } catch (error: any) {
      const friendly = getUserFriendlyAuthError(error, { title: "Error", message: "Could not send code." });
      Alert.alert(friendly.title, friendly.message);
    } finally { setSendingCode(false); }
  }, [emailInput, privyUser, sendCode]);

  const handleVerifyCode = useCallback(async () => {
    if (!privyUser) { Alert.alert("Connect Twitter", "Please connect Twitter first."); return; }
    const email = emailInput.trim();
    const code = codeInput.trim();
    if (!email || !code) { Alert.alert("Required", "Enter your email and code."); return; }
    try {
      setVerifyingCode(true);
      await linkWithCode({ email, code });
      const address = await getOrCreateTradingWalletAddress();
      Alert.alert("Wallet Ready", "Wallet created. Deposit SOL to start trading.");
      if (address) void loadBalance(address);
    } catch (error: any) {
      const friendly = getUserFriendlyAuthError(error, { title: "Verification failed", message: "Check the code and try again." });
      Alert.alert(friendly.title, friendly.message);
    } finally { setVerifyingCode(false); }
  }, [codeInput, emailInput, getOrCreateTradingWalletAddress, linkWithCode, privyUser]);

  const hasWallet = Boolean(tradingWalletAddress);
  const usdValue =
    solBalance !== null && solPriceUsd !== null && solPriceUsd > 0
      ? (solBalance * solPriceUsd).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
      : null;

  // Linked email from Privy user
  const linkedEmail = (() => {
    if (!privyUser) return null;
    const accounts: any[] = (privyUser as any)?.linked_accounts ?? (privyUser as any)?.linkedAccounts ?? [];
    const emailAccount = accounts.find((a: any) => a?.type === "email");
    return emailAccount?.address ?? emailAccount?.email ?? null;
  })();

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: "#000" }}>
      <Toast message={toastMessage} visible={toastVisible} onHide={() => setToastVisible(false)} />
      <QRCodeModal visible={qrVisible} address={tradingWalletAddress ?? ''} onClose={() => setQrVisible(false)} />
      <ScrollView
        ref={scrollRef}
        contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 110 + keyboardHeight, paddingTop: 8 }}
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
        {/* ── Header: avatar + editable name ── */}
        <View style={{ alignItems: "center", paddingVertical: 24, paddingBottom: 20 }}>
          <Avatar name={displayProfileName} size={84} />

          {/* Editable name */}
          {editingName ? (
            <View style={{ flexDirection: "row", alignItems: "center", marginTop: 16, gap: 10 }}>
              <TextInput
                ref={nameInputRef}
                value={nameInput}
                onChangeText={setNameInput}
                onSubmitEditing={saveName}
                autoFocus
                returnKeyType="done"
                style={{
                  color: "#fff",
                  fontSize: 22,
                  fontWeight: "800",
                  borderBottomWidth: 2,
                  borderBottomColor: "#0a84ff",
                  minWidth: 140,
                  textAlign: "center",
                  paddingVertical: 4,
                  paddingHorizontal: 8,
                  letterSpacing: 0.5,
                }}
              />
              <Pressable onPress={saveName} hitSlop={10}>
                <Ionicons name="checkmark-circle" size={28} color="#0a84ff" />
              </Pressable>
            </View>
          ) : (
            <Pressable
              onPress={() => { setEditingName(true); setTimeout(() => nameInputRef.current?.focus(), 50); }}
              style={{ flexDirection: "row", alignItems: "center", marginTop: 16, gap: 8 }}
            >
              <Text style={{ color: "#fff", fontSize: 24, fontWeight: "800", letterSpacing: 0.3 }}>{displayProfileName}</Text>
              <View style={{
                width: 24,
                height: 24,
                borderRadius: 12,
                backgroundColor: "rgba(255,255,255,0.1)",
                alignItems: "center",
                justifyContent: "center",
              }}>
                <Ionicons name="pencil" size={12} color="rgba(255,255,255,0.6)" />
              </View>
            </Pressable>
          )}

          {twitterProfile?.username ? (
            <View style={{
              marginTop: 8,
              paddingHorizontal: 12,
              paddingVertical: 4,
              borderRadius: 12,
              backgroundColor: "rgba(29, 161, 242, 0.15)",
              borderWidth: 1,
              borderColor: "rgba(29, 161, 242, 0.3)",
            }}>
              <Text style={{ color: "#1DA1F2", fontSize: 13, fontWeight: "600" }}>@{twitterProfile.username}</Text>
            </View>
          ) : null}
        </View>

        {/* ── Wallet / balance section ── */}
        {walletLoading ? (
          <View style={{ alignItems: "center", paddingVertical: 20 }}>
            <ActivityIndicator color="#fff" />
            <Text style={{ color: "#8e8e93", marginTop: 8 }}>Loading wallet…</Text>
          </View>
        ) : hasWallet ? (
          <>
            {/* Balance card */}
            <MenuSection>
              <View style={{ padding: 20 }}>
                <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                    <View style={{
                      width: 28,
                      height: 28,
                      borderRadius: 14,
                      backgroundColor: "rgba(138, 99, 255, 0.15)",
                      alignItems: "center",
                      justifyContent: "center",
                    }}>
                      <SolanaIcon size={16} />
                    </View>
                    <Text style={{ color: "rgba(255,255,255,0.7)", fontSize: 14, fontWeight: "600", letterSpacing: 0.5 }}>SOL BALANCE</Text>
                  </View>
                  <Pressable
                    onPress={handleRefreshBalance}
                    hitSlop={10}
                    style={{
                      width: 32,
                      height: 32,
                      borderRadius: 10,
                      alignItems: "center",
                      justifyContent: "center",
                      backgroundColor: "rgba(255,255,255,0.08)",
                      borderWidth: 1,
                      borderColor: "rgba(255,255,255,0.1)",
                    }}
                  >
                    {balanceLoading
                      ? <ActivityIndicator size="small" color="#8e8e93" />
                      : <Ionicons name="refresh" size={16} color="rgba(255,255,255,0.6)" />
                    }
                  </Pressable>
                </View>
                <Text style={{ color: "#fff", fontSize: 32, fontWeight: "800", letterSpacing: -0.5, marginBottom: 4 }}>
                  {solBalance === null ? "—" : `${solBalance.toFixed(4)}`}
                </Text>
                <Text style={{ color: "rgba(255,255,255,0.5)", fontSize: 15, fontWeight: "600" }}>
                  {solBalance === null ? "SOL" : "SOL"}
                </Text>
                {usdValue ? (
                  <View style={{
                    marginTop: 12,
                    paddingTop: 12,
                    borderTopWidth: 1,
                    borderTopColor: "rgba(255,255,255,0.08)",
                  }}>
                    <Text style={{ color: "rgba(255,255,255,0.5)", fontSize: 13, fontWeight: "600" }}>
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
                overflow: "hidden",
                opacity: pressed ? 0.9 : 1,
              })}
            >
              <LinearGradient
                colors={["#0a84ff", "#0066cc"]}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
                style={{
                  paddingVertical: 16,
                  paddingHorizontal: 20,
                  flexDirection: "row",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: 10,
                }}
              >
                <Ionicons name="qr-code" size={24} color="#fff" />
                <Text style={{ color: "#fff", fontSize: 17, fontWeight: "800", letterSpacing: 0.3 }}>
                  Show Deposit QR Code
                </Text>
              </LinearGradient>
            </Pressable>

            {/* Wallet actions */}
            <MenuSection>
              <MenuRow
                icon="copy-outline"
                iconBg="#3a3a3c"
                label="Copy Address"
                value={truncateMiddle(tradingWalletAddress ?? "")}
                onPress={copyAddress}
              />
              <MenuRow
                icon="wallet-outline"
                iconBg="#1a3a1a"
                label="Deposit via Phantom"
                onPress={openPhantom}
              />
              <MenuRow
                icon="arrow-up-circle-outline"
                iconBg="#1c3a5e"
                label="Send SOL"
                onPress={() => {
                  if (hapticsEnabled) {
                    Haptics.selectionAsync().catch(() => undefined);
                  }
                  setWithdrawVisible((v) => !v);
                }}
                last
              />
            </MenuSection>

            {/* Inline withdraw form */}
            <WithdrawSheet
              visible={withdrawVisible}
              onClose={() => setWithdrawVisible(false)}
              onWithdraw={handleWithdraw}
              withdrawing={withdrawing}
            />

            {/* Account info */}
            <MenuSection>
              <MenuRow
                icon="logo-twitter"
                iconBg="#1a2a3a"
                label="X / Twitter"
                value={twitterProfile?.username ? `@${twitterProfile.username}` : "Not connected"}
                onPress={() => {}}
              />
              <MenuRow
                icon="mail-outline"
                iconBg="#2a1a3a"
                label="Email"
                value={linkedEmail ?? "Not linked"}
                onPress={() => {}}
                last
              />
            </MenuSection>

            {/* Terms & Conditions */}
            <MenuSection>
              <MenuRow
                icon="document-text-outline"
                iconBg="#2a2a1a"
                label="Terms & Conditions"
                onPress={() => router.push("/terms")}
                rightElement={<Ionicons name="chevron-forward" size={18} color="rgba(255,255,255,0.3)" />}
              />
              <MenuRow
                icon="shield-checkmark-outline"
                iconBg="#1a2a2a"
                label="Privacy Policy"
                onPress={() => router.push({ pathname: "/terms", params: { section: "privacy" } })}
                rightElement={<Ionicons name="chevron-forward" size={18} color="rgba(255,255,255,0.3)" />}
                last
              />
            </MenuSection>

            {/* Contact Us */}
            <MenuSection>
              <View style={{ padding: 20 }}>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 10, marginBottom: 14 }}>
                  <View style={{
                    width: 36,
                    height: 36,
                    borderRadius: 10,
                    backgroundColor: "rgba(74, 222, 128, 0.2)",
                    alignItems: "center",
                    justifyContent: "center",
                    shadowColor: "#4ade80",
                    shadowOpacity: 0.3,
                    shadowRadius: 8,
                    shadowOffset: { width: 0, height: 2 },
                  }}>
                    <MaterialIcons name="contact-support" size={20} color="#4ade80" />
                  </View>
                  <Text style={{ color: "#fff", fontSize: 18, fontWeight: "800", letterSpacing: 0.3 }}>Contact Us</Text>
                </View>
                <Text style={{ color: "rgba(255,255,255,0.5)", fontSize: 14, marginBottom: 18, lineHeight: 20, fontWeight: "500" }}>
                  Need help or have questions? Reach out to us!
                </Text>
                
                {/* Email */}
                <Pressable
                  onPress={() => {
                    if (hapticsEnabled) {
                      Haptics.selectionAsync().catch(() => undefined);
                    }
                    openExternalLink('mailto:memeswipe89@gmail.com');
                  }}
                  style={({ pressed }) => ({
                    flexDirection: "row",
                    alignItems: "center",
                    backgroundColor: pressed ? "rgba(255,255,255,0.08)" : "rgba(255,255,255,0.05)",
                    borderRadius: 12,
                    padding: 14,
                    marginBottom: 12,
                    borderWidth: 1,
                    borderColor: "rgba(255,255,255,0.08)",
                  })}
                >
                  <View style={{
                    width: 40,
                    height: 40,
                    borderRadius: 10,
                    backgroundColor: "rgba(74,222,128,0.15)",
                    justifyContent: "center",
                    alignItems: "center",
                    marginRight: 14,
                    shadowColor: "#4ade80",
                    shadowOpacity: 0.3,
                    shadowRadius: 6,
                    shadowOffset: { width: 0, height: 2 },
                  }}>
                    <MaterialIcons name="email" size={20} color="#4ade80" />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={{ color: "rgba(255,255,255,0.6)", fontSize: 12, marginBottom: 3, fontWeight: "600", letterSpacing: 0.3 }}>Email</Text>
                    <Text style={{ color: "#fff", fontSize: 15, fontWeight: "700" }}>memeswipe89@gmail.com</Text>
                  </View>
                  <Ionicons name="chevron-forward" size={18} color="rgba(255,255,255,0.3)" />
                </Pressable>

                {/* Twitter */}
                <Pressable
                  onPress={() => {
                    if (hapticsEnabled) {
                      Haptics.selectionAsync().catch(() => undefined);
                    }
                    openExternalLink('https://twitter.com/swipeitXYZ');
                  }}
                  style={({ pressed }) => ({
                    flexDirection: "row",
                    alignItems: "center",
                    backgroundColor: pressed ? "rgba(255,255,255,0.08)" : "rgba(255,255,255,0.05)",
                    borderRadius: 12,
                    padding: 14,
                    borderWidth: 1,
                    borderColor: "rgba(255,255,255,0.08)",
                  })}
                >
                  <View style={{
                    width: 40,
                    height: 40,
                    borderRadius: 10,
                    backgroundColor: "rgba(29,161,242,0.15)",
                    justifyContent: "center",
                    alignItems: "center",
                    marginRight: 14,
                    shadowColor: "#1DA1F2",
                    shadowOpacity: 0.3,
                    shadowRadius: 6,
                    shadowOffset: { width: 0, height: 2 },
                  }}>
                    <FontAwesome name="twitter" size={20} color="#1DA1F2" />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={{ color: "rgba(255,255,255,0.6)", fontSize: 12, marginBottom: 3, fontWeight: "600", letterSpacing: 0.3 }}>Twitter</Text>
                    <Text style={{ color: "#fff", fontSize: 15, fontWeight: "700" }}>@swipeitXYZ</Text>
                  </View>
                  <Ionicons name="chevron-forward" size={18} color="rgba(255,255,255,0.3)" />
                </Pressable>
              </View>
            </MenuSection>

            {/* Sign out */}
            <MenuSection>
              <MenuRow
                icon="log-out-outline"
                iconBg="#3a1a1a"
                label={loggingOut ? "Signing out…" : "Sign Out"}
                onPress={handleLogout}
                destructive
                last
              />
            </MenuSection>
          </>
        ) : (
          /* ── No wallet yet ── */
          <>
            <Text style={{ color: "#8e8e93", textAlign: "center", marginBottom: 16 }}>
              {walletError || "No wallet found. Create one to start trading."}
            </Text>

            {privyUser ? (
              <MenuSection>
                <MenuRow
                  icon="add-circle-outline"
                  iconBg="#1a3a1a"
                  label="Create Wallet"
                  onPress={handleCreateWallet}
                  last
                />
              </MenuSection>
            ) : (
              <MenuSection>
                <View style={{ padding: 20 }}>
                  <Text style={{ color: "rgba(255,255,255,0.6)", fontSize: 14, marginBottom: 14, fontWeight: "600", letterSpacing: 0.3 }}>
                    Link your email to create a wallet
                  </Text>
                  <TextInput
                    value={emailInput}
                    onChangeText={setEmailInput}
                    placeholder="Email address"
                    placeholderTextColor="rgba(255,255,255,0.3)"
                    autoCapitalize="none"
                    autoCorrect={false}
                    keyboardType="email-address"
                    style={{
                      backgroundColor: "rgba(255,255,255,0.05)",
                      borderRadius: 12,
                      paddingHorizontal: 14,
                      paddingVertical: 12,
                      color: "#fff",
                      fontSize: 14,
                      marginBottom: 12,
                      borderWidth: 1,
                      borderColor: "rgba(255,255,255,0.1)",
                      fontWeight: "500",
                    }}
                  />
                  <Pressable
                    onPress={handleSendCode}
                    disabled={sendingCode}
                    style={{ 
                      borderRadius: 12, 
                      paddingVertical: 14, 
                      alignItems: "center", 
                      opacity: sendingCode ? 0.6 : 1,
                      overflow: "hidden",
                    }}
                  >
                    <LinearGradient
                      colors={["#0a84ff", "#0066cc"]}
                      start={{ x: 0, y: 0 }}
                      end={{ x: 1, y: 1 }}
                      style={{
                        position: "absolute",
                        left: 0,
                        right: 0,
                        top: 0,
                        bottom: 0,
                      }}
                    />
                    <Text style={{ color: "#fff", fontWeight: "800", fontSize: 15 }}>{sendingCode ? "Sending…" : "Send Code"}</Text>
                  </Pressable>
                  {codeSent ? (
                    <>
                      <TextInput
                        value={codeInput}
                        onChangeText={setCodeInput}
                        placeholder="Verification code"
                        placeholderTextColor="rgba(255,255,255,0.3)"
                        keyboardType="number-pad"
                        style={{
                          backgroundColor: "rgba(255,255,255,0.05)",
                          borderRadius: 12,
                          paddingHorizontal: 14,
                          paddingVertical: 12,
                          color: "#fff",
                          fontSize: 14,
                          marginTop: 12,
                          marginBottom: 12,
                          borderWidth: 1,
                          borderColor: "rgba(255,255,255,0.1)",
                          fontWeight: "500",
                        }}
                      />
                      <Pressable
                        onPress={handleVerifyCode}
                        disabled={verifyingCode}
                        style={{ 
                          borderRadius: 12, 
                          paddingVertical: 14, 
                          alignItems: "center", 
                          opacity: verifyingCode ? 0.6 : 1,
                          overflow: "hidden",
                        }}
                      >
                        <LinearGradient
                          colors={["#30d158", "#28a745"]}
                          start={{ x: 0, y: 0 }}
                          end={{ x: 1, y: 1 }}
                          style={{
                            position: "absolute",
                            left: 0,
                            right: 0,
                            top: 0,
                            bottom: 0,
                          }}
                        />
                        <Text style={{ color: "#fff", fontWeight: "800", fontSize: 15 }}>{verifyingCode ? "Verifying…" : "Verify & Connect"}</Text>
                      </Pressable>
                    </>
                  ) : null}
                </View>
              </MenuSection>
            )}
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}
