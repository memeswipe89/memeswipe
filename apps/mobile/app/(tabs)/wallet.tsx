import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Keyboard,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import * as Clipboard from "expo-clipboard";
import * as Linking from "expo-linking";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useRouter } from "expo-router";
import { useLinkEmail, usePrivy } from "@privy-io/expo";
import { Ionicons } from "@expo/vector-icons";
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import FontAwesome from '@expo/vector-icons/FontAwesome';
import { useAuth } from "@/contexts/auth-context";
import { useWalletContext } from "@/contexts/wallet-context";
import { useTradeSettings } from "@/contexts/trade-settings-context";
import { getUserFriendlyAuthError } from "@/lib/user-friendly-errors";
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
        backgroundColor: "#2a2a2a",
        alignItems: "center",
        justifyContent: "center",
        borderWidth: 2,
        borderColor: "#3a3a3a",
      }}
    >
      <Text style={{ color: "#fff", fontSize: size * 0.35, fontWeight: "700" }}>
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
        paddingVertical: 13,
        paddingHorizontal: 16,
        backgroundColor: pressed ? "#1e1e1e" : "transparent",
        borderBottomWidth: last ? 0 : 0.5,
        borderBottomColor: "#2a2a2a",
      })}
    >
      <View
        style={{
          width: 32,
          height: 32,
          borderRadius: 8,
          backgroundColor: iconBg,
          alignItems: "center",
          justifyContent: "center",
          marginRight: 14,
        }}
      >
        <Ionicons name={icon} size={17} color="#fff" />
      </View>
      <Text style={{ flex: 1, color: destructive ? "#ff453a" : "#fff", fontSize: 16 }}>
        {label}
      </Text>
      {rightElement ?? (
        value ? (
          <Text style={{ color: "#8e8e93", fontSize: 15 }}>{value}</Text>
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
        backgroundColor: "#1c1c1e",
        borderRadius: 12,
        marginBottom: 16,
        overflow: "hidden",
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
    <View style={{ backgroundColor: "#1c1c1e", borderRadius: 16, padding: 16, marginBottom: 16 }}>
      <Text style={{ color: "#fff", fontWeight: "700", fontSize: 16, marginBottom: 12 }}>
        Send SOL
      </Text>
      <TextInput
        value={toAddress}
        onChangeText={setToAddress}
        placeholder="Destination address"
        placeholderTextColor="#555"
        autoCapitalize="none"
        autoCorrect={false}
        style={{
          backgroundColor: "#2c2c2e",
          borderRadius: 10,
          paddingHorizontal: 12,
          paddingVertical: 10,
          color: "#fff",
          fontSize: 13,
          marginBottom: 10,
        }}
      />
      <TextInput
        value={amount}
        onChangeText={setAmount}
        placeholder="Amount (SOL)"
        placeholderTextColor="#555"
        keyboardType="decimal-pad"
        style={{
          backgroundColor: "#2c2c2e",
          borderRadius: 10,
          paddingHorizontal: 12,
          paddingVertical: 10,
          color: "#fff",
          fontSize: 13,
          marginBottom: 12,
        }}
      />
      <View style={{ flexDirection: "row", gap: 10 }}>
        <Pressable
          onPress={onClose}
          style={{ flex: 1, backgroundColor: "#2c2c2e", borderRadius: 10, paddingVertical: 12, alignItems: "center" }}
        >
          <Text style={{ color: "#fff", fontWeight: "600" }}>Cancel</Text>
        </Pressable>
        <Pressable
          onPress={() => onWithdraw(toAddress, amount)}
          disabled={withdrawing}
          style={{ flex: 1, backgroundColor: "#0a84ff", borderRadius: 10, paddingVertical: 12, alignItems: "center", opacity: withdrawing ? 0.6 : 1 }}
        >
          <Text style={{ color: "#fff", fontWeight: "700" }}>{withdrawing ? "Sending…" : "Send"}</Text>
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
  const { profileName, setProfileName } = useTradeSettings();

  const [solBalance, setSolBalance] = useState<number | null>(null);
  const [solPriceUsd, setSolPriceUsd] = useState<number | null>(null);
  const [balanceLoading, setBalanceLoading] = useState(false);
  const [withdrawVisible, setWithdrawVisible] = useState(false);
  const [withdrawing, setWithdrawing] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);

  // Editable profile name
  const [editingName, setEditingName] = useState(false);
  const [nameInput, setNameInput] = useState(profileName);
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
  useEffect(() => { setNameInput(profileName); }, [profileName]);

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
    else setNameInput(profileName);
    setEditingName(false);
  };

  const copyAddress = async () => {
    if (!tradingWalletAddress) return;
    await Clipboard.setStringAsync(tradingWalletAddress);
    Alert.alert("Copied", "Wallet address copied to clipboard.");
  };

  const openPhantom = async () => {
    if (!tradingWalletAddress) return;
    const link = `phantom://v1/transfer?recipient=${encodeURIComponent(tradingWalletAddress)}&network=mainnet-beta`;
    try {
      if (await Linking.canOpenURL(link)) await Linking.openURL(link);
      else await Linking.openURL("https://phantom.app/");
    } catch {
      Alert.alert("Phantom not found", "Copy the address and send SOL from any Solana wallet.");
    }
  };

  const handleWithdraw = async (toAddress: string, amountStr: string) => {
    const amount = Number(amountStr);
    if (!Number.isFinite(amount) || amount <= 0) { Alert.alert("Send SOL", "Enter a valid amount."); return; }
    if (!toAddress.trim()) { Alert.alert("Send SOL", "Enter a destination address."); return; }
    try {
      setWithdrawing(true);
      const result = await withdrawFromTradingWallet(amount, toAddress.trim());
      setWithdrawVisible(false);
      Alert.alert("Sent!", `Tx: ${result.txSignature}`);
      if (tradingWalletAddress) void loadBalance(tradingWalletAddress);
    } catch (error: any) {
      Alert.alert("Send Failed", error?.message || "Failed to send SOL.");
    } finally { setWithdrawing(false); }
  };

  const handleLogout = () => {
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
    try {
      const address = await getOrCreateTradingWalletAddress();
      Alert.alert("Wallet Ready", "Wallet created. Deposit SOL to start trading.");
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
      <ScrollView
        ref={scrollRef}
        contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 110 + keyboardHeight, paddingTop: 8 }}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        {/* ── Header: avatar + editable name ── */}
        <View style={{ alignItems: "center", paddingVertical: 28 }}>
          <Avatar name={profileName} size={88} />

          {/* Editable name */}
          {editingName ? (
            <View style={{ flexDirection: "row", alignItems: "center", marginTop: 14, gap: 8 }}>
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
                  fontWeight: "700",
                  borderBottomWidth: 1.5,
                  borderBottomColor: "#0a84ff",
                  minWidth: 120,
                  textAlign: "center",
                  paddingVertical: 2,
                  paddingHorizontal: 4,
                }}
              />
              <Pressable onPress={saveName} hitSlop={10}>
                <Ionicons name="checkmark-circle" size={26} color="#0a84ff" />
              </Pressable>
            </View>
          ) : (
            <Pressable
              onPress={() => { setEditingName(true); setTimeout(() => nameInputRef.current?.focus(), 50); }}
              style={{ flexDirection: "row", alignItems: "center", marginTop: 14, gap: 6 }}
            >
              <Text style={{ color: "#fff", fontSize: 24, fontWeight: "700" }}>{profileName}</Text>
              <Ionicons name="pencil" size={15} color="#8e8e93" />
            </Pressable>
          )}

          {twitterProfile?.username ? (
            <Text style={{ color: "#8e8e93", fontSize: 14, marginTop: 4 }}>
              @{twitterProfile.username}
            </Text>
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
              <View style={{ padding: 16 }}>
                <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
                  {/* Solana logo + label */}
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 7 }}>
                    <SolanaIcon size={20} />
                    <Text style={{ color: "#8e8e93", fontSize: 13 }}>SOL Balance</Text>
                  </View>
                  {/* Refresh button inline with balance label */}
                  <Pressable
                    onPress={() => tradingWalletAddress && void loadBalance(tradingWalletAddress)}
                    hitSlop={10}
                    style={{
                      width: 30,
                      height: 30,
                      borderRadius: 8,
                      alignItems: "center",
                      justifyContent: "center",
                      backgroundColor: "#2c2c2e",
                    }}
                  >
                    {balanceLoading
                      ? <ActivityIndicator size="small" color="#8e8e93" />
                      : <Ionicons name="refresh" size={15} color="#8e8e93" />
                    }
                  </Pressable>
                </View>
                <Text style={{ color: "#fff", fontSize: 28, fontWeight: "700" }}>
                  {solBalance === null ? "—" : formatSol(solBalance)}
                </Text>
                {usdValue ? (
                  <Text style={{ color: "#8e8e93", fontSize: 14, marginTop: 2 }}>≈ ${usdValue} USD</Text>
                ) : null}
              </View>
            </MenuSection>

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
                label="Open in Phantom"
                onPress={openPhantom}
              />
              <MenuRow
                icon="arrow-up-circle-outline"
                iconBg="#1c3a5e"
                label="Send SOL"
                onPress={() => setWithdrawVisible((v) => !v)}
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
                rightElement={<Ionicons name="chevron-forward" size={18} color="#3a3a3a" />}
                last
              />
            </MenuSection>

            {/* Contact Us */}
            <MenuSection>
              <View style={{ padding: 16 }}>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 12 }}>
                  <MaterialIcons name="contact-support" size={24} color="#4ade80" />
                  <Text style={{ color: "#fff", fontSize: 18, fontWeight: "700" }}>Contact Us</Text>
                </View>
                <Text style={{ color: "#8e8e93", fontSize: 14, marginBottom: 16, lineHeight: 20 }}>
                  Need help or have questions? Reach out to us!
                </Text>
                
                {/* Email */}
                <Pressable
                  onPress={() => Linking.openURL('mailto:memeswipe89@gmail.com')}
                  style={{
                    flexDirection: "row",
                    alignItems: "center",
                    backgroundColor: "#2c2c2e",
                    borderRadius: 10,
                    padding: 12,
                    marginBottom: 10,
                  }}
                >
                  <View style={{
                    width: 36,
                    height: 36,
                    borderRadius: 18,
                    backgroundColor: "rgba(74,222,128,0.15)",
                    justifyContent: "center",
                    alignItems: "center",
                    marginRight: 12,
                  }}>
                    <MaterialIcons name="email" size={20} color="#4ade80" />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={{ color: "#8e8e93", fontSize: 12, marginBottom: 2 }}>Email</Text>
                    <Text style={{ color: "#fff", fontSize: 14, fontWeight: "600" }}>memeswipe89@gmail.com</Text>
                  </View>
                  <Ionicons name="chevron-forward" size={18} color="#3a3a3a" />
                </Pressable>

                {/* Twitter */}
                <Pressable
                  onPress={() => Linking.openURL('https://twitter.com/swipeitXYZ')}
                  style={{
                    flexDirection: "row",
                    alignItems: "center",
                    backgroundColor: "#2c2c2e",
                    borderRadius: 10,
                    padding: 12,
                  }}
                >
                  <View style={{
                    width: 36,
                    height: 36,
                    borderRadius: 18,
                    backgroundColor: "rgba(29,161,242,0.15)",
                    justifyContent: "center",
                    alignItems: "center",
                    marginRight: 12,
                  }}>
                    <FontAwesome name="twitter" size={20} color="#1DA1F2" />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={{ color: "#8e8e93", fontSize: 12, marginBottom: 2 }}>Twitter</Text>
                    <Text style={{ color: "#fff", fontSize: 14, fontWeight: "600" }}>@swipeitXYZ</Text>
                  </View>
                  <Ionicons name="chevron-forward" size={18} color="#3a3a3a" />
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
                <View style={{ padding: 16 }}>
                  <Text style={{ color: "#8e8e93", fontSize: 13, marginBottom: 10 }}>
                    Link your email to create a wallet
                  </Text>
                  <TextInput
                    value={emailInput}
                    onChangeText={setEmailInput}
                    placeholder="Email address"
                    placeholderTextColor="#555"
                    autoCapitalize="none"
                    autoCorrect={false}
                    keyboardType="email-address"
                    style={{
                      backgroundColor: "#2c2c2e",
                      borderRadius: 10,
                      paddingHorizontal: 12,
                      paddingVertical: 10,
                      color: "#fff",
                      fontSize: 14,
                      marginBottom: 10,
                    }}
                  />
                  <Pressable
                    onPress={handleSendCode}
                    disabled={sendingCode}
                    style={{ backgroundColor: "#0a84ff", borderRadius: 10, paddingVertical: 12, alignItems: "center", opacity: sendingCode ? 0.6 : 1 }}
                  >
                    <Text style={{ color: "#fff", fontWeight: "700" }}>{sendingCode ? "Sending…" : "Send Code"}</Text>
                  </Pressable>
                  {codeSent ? (
                    <>
                      <TextInput
                        value={codeInput}
                        onChangeText={setCodeInput}
                        placeholder="Verification code"
                        placeholderTextColor="#555"
                        keyboardType="number-pad"
                        style={{
                          backgroundColor: "#2c2c2e",
                          borderRadius: 10,
                          paddingHorizontal: 12,
                          paddingVertical: 10,
                          color: "#fff",
                          fontSize: 14,
                          marginTop: 10,
                          marginBottom: 10,
                        }}
                      />
                      <Pressable
                        onPress={handleVerifyCode}
                        disabled={verifyingCode}
                        style={{ backgroundColor: "#30d158", borderRadius: 10, paddingVertical: 12, alignItems: "center", opacity: verifyingCode ? 0.6 : 1 }}
                      >
                        <Text style={{ color: "#fff", fontWeight: "700" }}>{verifyingCode ? "Verifying…" : "Verify & Connect"}</Text>
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
