import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Keyboard,
  Platform,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
  useWindowDimensions,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import * as Clipboard from "expo-clipboard";
import * as Linking from "expo-linking";
import AsyncStorage from "@react-native-async-storage/async-storage";
import QRCode from "react-native-qrcode-svg";
import { useRouter } from "expo-router";
import { useLinkEmail, usePrivy } from "@privy-io/expo";
import { useAuth } from "@/contexts/auth-context";
import { useWalletContext } from "@/contexts/wallet-context";
import { getUserFriendlyAuthError } from "@/lib/user-friendly-errors";

const MAINNET_RPC_URL = "https://api.mainnet-beta.solana.com";
const TWITTER_PROFILE_CACHE_KEY = "@memeswipe:twitterProfile:v1";
const FAVORITES_KEY = "@memeswipe:favorites:v1";
const HIDDEN_TOKENS_KEY = "@memeswipe:hidden-tokens:v1";
const LAST_AMOUNT_KEY = "@memeswipe:lastAmount";
const LAST_ROI_KEY = "@memeswipe:lastROI";
const BONUS_2000_APPLIED_KEY = "@memeswipe:bonus2000:applied";
const LOCAL_USER_ID_KEY = "@memeswipe:userId:v1";

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

const truncateMiddle = (value: string, keep = 6) => {
  if (value.length <= keep * 2 + 3) return value;
  return `${value.slice(0, keep)}...${value.slice(-keep)}`;
};
const formatSol = (value: number) => `${value.toFixed(9)} SOL`;

export default function WalletScreen() {
  const router = useRouter();
  const { width, height } = useWindowDimensions();
  const qrSize = useMemo(() => {
    const byWidth = width * 0.56;
    const byHeight = height * 0.24;
    return Math.max(170, Math.min(230, byWidth, byHeight));
  }, [height, width]);

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
  const [solBalance, setSolBalance] = useState<number | null>(null);
  const [balanceLoading, setBalanceLoading] = useState(false);
  const [balanceError, setBalanceError] = useState<string | null>(null);
  const [withdrawToAddress, setWithdrawToAddress] = useState("");
  const [withdrawAmount, setWithdrawAmount] = useState("0.01");
  const [withdrawing, setWithdrawing] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);
  const [keyboardHeight, setKeyboardHeight] = useState(0);
  const [emailInput, setEmailInput] = useState("");
  const [codeInput, setCodeInput] = useState("");
  const [sendingCode, setSendingCode] = useState(false);
  const [verifyingCode, setVerifyingCode] = useState(false);
  const [codeSent, setCodeSent] = useState(false);
  const scrollRef = useRef<ScrollView>(null);

  const clearLocalAppData = async () => {
    await AsyncStorage.multiRemove([
      TWITTER_PROFILE_CACHE_KEY,
      FAVORITES_KEY,
      HIDDEN_TOKENS_KEY,
      LAST_AMOUNT_KEY,
      LAST_ROI_KEY,
      BONUS_2000_APPLIED_KEY,
      LOCAL_USER_ID_KEY,
    ]);
  };

  const copyAddress = async () => {
    if (!tradingWalletAddress) return;
    await Clipboard.setStringAsync(tradingWalletAddress);
    Alert.alert("Copied", "Wallet address copied to clipboard.");
  };

  const loadBalance = async (address: string) => {
    try {
      setBalanceLoading(true);
      setBalanceError(null);
      const next = await getSolBalance(address);
      setSolBalance(next);
    } catch (error: any) {
      setBalanceError(error?.message || "Failed to load SOL balance");
    } finally {
      setBalanceLoading(false);
    }
  };

  useEffect(() => {
    if (!tradingWalletAddress) return;
    void loadBalance(tradingWalletAddress);
  }, [tradingWalletAddress]);

  useEffect(() => {
    const show = Keyboard.addListener("keyboardDidShow", (event) => {
      setKeyboardHeight(event.endCoordinates?.height || 0);
    });
    const hide = Keyboard.addListener("keyboardDidHide", () => {
      setKeyboardHeight(0);
    });
    return () => {
      show.remove();
      hide.remove();
    };
  }, []);

  const handleCreateWallet = async () => {
    let applicationId = "unknown";
    try {
      // Avoid hard dependency crashes if expo-application is not installed in this environment.
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const Application = require("expo-application") as { applicationId?: string };
      if (typeof Application?.applicationId === "string" && Application.applicationId.length > 0) {
        applicationId = Application.applicationId;
      }
    } catch {
      // ignore
    }

    try {
      console.log("[WALLET] Create Wallet clicked");
      console.log("[APP]", Platform.OS, "applicationId:", applicationId);
      const address = await getOrCreateTradingWalletAddress();
      console.log("[WALLET] Embedded wallet address:", address);
      Alert.alert("Wallet Ready", "Wallet created. You can now deposit SOL to this address.");
    } catch (error: any) {
      const message = String(error?.message || error || "");
      console.log("[WALLET] Create wallet failed:", message);
      if (message.toLowerCase().includes("allowed app identifier")) {
        Alert.alert(
          "Privy Setup Required",
          `Add this app identifier in Privy allowlist: ${applicationId}\n\nAlso add host.exp.Exponent and host.exp.exponent, then restart Expo with: npx expo start -c`
        );
        return;
      }
      if (message.toLowerCase().includes("privy login required")) {
        Alert.alert("Connect Privy", "Please connect to Privy before creating your wallet.");
        return;
      }
      const friendly = getUserFriendlyAuthError(error, {
        title: "Wallet",
        message: "Could not create a wallet address right now.",
      });
      Alert.alert(friendly.title, friendly.message);
    }
  };

  const handleSendCode = useCallback(async () => {
    if (!privyUser) {
      Alert.alert("Connect Twitter", "Please connect Twitter first, then link your email.");
      return;
    }
    const email = emailInput.trim();
    if (!email) {
      Alert.alert("Connect Privy", "Enter a valid email address.");
      return;
    }
    try {
      setSendingCode(true);
      await sendCode({ email });
      setCodeSent(true);
      Alert.alert("Check your email", "Enter the verification code we sent.");
    } catch (error: any) {
      const friendly = getUserFriendlyAuthError(error, {
        title: "Could not send code",
        message: "We couldn't send a verification code. Please try again.",
      });
      Alert.alert(friendly.title, friendly.message);
    } finally {
      setSendingCode(false);
    }
  }, [emailInput, privyUser, sendCode]);

  const handleVerifyCode = useCallback(async () => {
    if (!privyUser) {
      Alert.alert("Connect Twitter", "Please connect Twitter first, then link your email.");
      return;
    }
    const email = emailInput.trim();
    const code = codeInput.trim();
    if (!email || !code) {
      Alert.alert("Connect Privy", "Enter your email and verification code.");
      return;
    }
    try {
      setVerifyingCode(true);
      await linkWithCode({ email, code });
      const address = await getOrCreateTradingWalletAddress();
      Alert.alert("Wallet Ready", "Wallet created. You can now deposit SOL to this address.");
      if (address) {
        await loadBalance(address);
      }
    } catch (error: any) {
      const friendly = getUserFriendlyAuthError(error, {
        title: "Verification failed",
        message: "The code could not be verified. Please check and try again.",
      });
      Alert.alert(friendly.title, friendly.message);
    } finally {
      setVerifyingCode(false);
    }
  }, [codeInput, emailInput, getOrCreateTradingWalletAddress, linkWithCode, privyUser]);

  const openPhantom = async () => {
    if (!tradingWalletAddress) return;

    const transferLink = `phantom://v1/transfer?recipient=${encodeURIComponent(tradingWalletAddress)}&network=mainnet-beta`;
    const appBaseLink = "phantom://";

    try {
      if (await Linking.canOpenURL(transferLink)) {
        await Linking.openURL(transferLink);
        return;
      }

      if (await Linking.canOpenURL(appBaseLink)) {
        await Linking.openURL(appBaseLink);
        Alert.alert("Phantom", "Open Phantom and send SOL to the copied address.");
        return;
      }

      await Linking.openURL("https://phantom.app/");
      Alert.alert("Phantom not found", "Copy the address and send SOL from any Solana wallet.");
    } catch {
      Alert.alert("Phantom not found", "Copy the address and send SOL from any Solana wallet.");
    }
  };

  const handleWithdraw = async () => {
    try {
      const amount = Number(withdrawAmount);
      if (!Number.isFinite(amount) || amount <= 0) {
        Alert.alert("Withdraw", "Enter valid SOL amount.");
        return;
      }
      const destination = withdrawToAddress.trim();
      if (!destination) {
        Alert.alert("Withdraw", "Set a destination address first.");
        return;
      }
      setWithdrawing(true);
      const result = await withdrawFromTradingWallet(amount, destination);
      Alert.alert("Withdraw Success", `Tx: ${result.txSignature}`);
      if (tradingWalletAddress) {
        await loadBalance(tradingWalletAddress);
      }
    } catch (error: any) {
      Alert.alert("Withdraw Failed", error?.message || "Failed to withdraw.");
    } finally {
      setWithdrawing(false);
    }
  };

  const handleLogout = () => {
    Alert.alert("Logout", "Are you sure you want to logout from this app?", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Logout",
        style: "destructive",
        onPress: () => {
          void (async () => {
            try {
              setLoggingOut(true);
              setTwitterProfile(null);
              await clearLocalAppData();
              await logout();
              router.replace("/(tabs)");
              Alert.alert("Logged out", "You have been logged out.");
            } catch (error: any) {
              Alert.alert("Logout", error?.message || "Failed to logout.");
            } finally {
              setLoggingOut(false);
            }
          })();
        },
      },
    ]);
  };

  const showWalletDetails = Boolean(tradingWalletAddress);
  const displayWalletAddress = tradingWalletAddress ?? "";

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: "#000", paddingHorizontal: 14, paddingTop: 4, paddingBottom: 4 }}>
      <ScrollView
        ref={scrollRef}
        contentContainerStyle={{ paddingBottom: 18 + keyboardHeight }}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
      <View style={{ marginTop: 6 }}>
        <Text style={{ color: "#8aa0b6", fontSize: 12 }}>Twitter</Text>
        <Text style={{ color: "#fff", fontSize: 16, fontWeight: "600" }}>
          {twitterProfile?.username ? `@${twitterProfile.username}` : "Not connected"}
        </Text>
      </View>

      <Text style={{ color: "#bbb", marginTop: 10, fontSize: 13 }}>Your Privy Embedded Wallet Address</Text>

      {walletLoading ? (
        <View style={{ marginTop: 12 }}>
          <ActivityIndicator />
          <Text style={{ color: "#999", marginTop: 6 }}>Loading wallet address...</Text>
        </View>
      ) : showWalletDetails ? (
        <View style={{ flex: 1 }}>
          <View
            style={{
              marginTop: 8,
              borderRadius: 10,
              padding: 10,
              borderWidth: 1,
              borderColor: "#2a2a2a",
              backgroundColor: "#111",
            }}
          >
            <Text selectable style={{ color: "#fff", fontFamily: "Courier", fontSize: 13 }}>
              {truncateMiddle(displayWalletAddress)}
            </Text>
            <Text selectable numberOfLines={1} style={{ color: "#666", fontFamily: "Courier", marginTop: 5, fontSize: 10 }}>
              {displayWalletAddress}
            </Text>
          </View>

          <Pressable
            onPress={copyAddress}
            style={{ marginTop: 8, backgroundColor: "#e9f3ff", borderRadius: 10, paddingVertical: 10 }}
          >
            <Text style={{ color: "#0a1a33", textAlign: "center", fontWeight: "700" }}>Copy Address</Text>
          </Pressable>

          <View style={{ marginTop: 10, marginBottom: 10, alignItems: "center", justifyContent: "center" }}>
            <View style={{ backgroundColor: "#fff", padding: 10, borderRadius: 12 }}>
              <QRCode value={tradingWalletAddress ?? undefined} size={qrSize} />
            </View>
          </View>

          <View style={{ marginTop: "auto", paddingBottom: 6 }}>
            <Text style={{ color: "#bbb", fontWeight: "600" }}>Send from Phantom</Text>
            <Pressable
              onPress={openPhantom}
              style={{
                marginTop: 6,
                backgroundColor: "#10233f",
                borderRadius: 10,
                paddingVertical: 10,
                borderWidth: 1,
                borderColor: "#254d78",
              }}
            >
              <Text style={{ color: "#fff", textAlign: "center", fontWeight: "700" }}>Open Phantom</Text>
            </Pressable>
              <Text style={{ color: "#8f9ab7", marginTop: 6, fontSize: 12 }}>
                Send SOL from Phantom or any Solana wallet to this address.
              </Text>

            <View
              style={{
                marginTop: 8,
                borderRadius: 10,
                paddingVertical: 8,
                paddingHorizontal: 10,
                borderWidth: 1,
                borderColor: "#2a2a2a",
                backgroundColor: "#111",
              }}
            >
              <Text style={{ color: "#bbb", fontSize: 12 }}>SOL Balance</Text>
              {balanceLoading ? (
                <View style={{ marginTop: 6 }}>
                  <ActivityIndicator />
                </View>
              ) : (
                <Text style={{ color: "#fff", marginTop: 4, fontSize: 18, fontWeight: "700" }}>
                  {solBalance === null ? "--" : formatSol(solBalance)}
                </Text>
              )}
              {balanceError ? <Text style={{ color: "#ff8a8a", marginTop: 6, fontSize: 11 }}>{balanceError}</Text> : null}
            </View>

            <Pressable
              onPress={() => (tradingWalletAddress ? void loadBalance(tradingWalletAddress) : undefined)}
              style={{
                marginTop: 6,
                backgroundColor: "#10233f",
                borderRadius: 10,
                paddingVertical: 10,
                borderWidth: 1,
                borderColor: "#254d78",
              }}
            >
              <Text style={{ color: "#fff", textAlign: "center", fontWeight: "700" }}>Refresh Balance</Text>
            </Pressable>

            <View
              style={{
                marginTop: 10,
                borderRadius: 10,
                padding: 10,
                borderWidth: 1,
                borderColor: "#2a2a2a",
                backgroundColor: "#0f131a",
              }}
            >
              <Text style={{ color: "#bbb", fontWeight: "600" }}>Send SOL to Phantom / external wallet</Text>
              <TextInput
                value={withdrawToAddress}
                onChangeText={setWithdrawToAddress}
                placeholder="Destination wallet address"
                placeholderTextColor="#68738a"
                autoCapitalize="none"
                autoCorrect={false}
                onFocus={() => scrollRef.current?.scrollToEnd({ animated: true })}
                style={{
                  marginTop: 8,
                  borderWidth: 1,
                  borderColor: "#2a2a2a",
                  borderRadius: 8,
                  paddingHorizontal: 10,
                  paddingVertical: 8,
                  color: "#fff",
                  fontSize: 12,
                }}
              />
              <TextInput
                value={withdrawAmount}
                onChangeText={setWithdrawAmount}
                placeholder="SOL amount (e.g. 0.01)"
                placeholderTextColor="#68738a"
                keyboardType="decimal-pad"
                onFocus={() => scrollRef.current?.scrollToEnd({ animated: true })}
                style={{
                  marginTop: 8,
                  borderWidth: 1,
                  borderColor: "#2a2a2a",
                  borderRadius: 8,
                  paddingHorizontal: 10,
                  paddingVertical: 8,
                  color: "#fff",
                  fontSize: 12,
                }}
              />
              <Pressable
                onPress={() => void handleWithdraw()}
                disabled={withdrawing}
                style={{
                  marginTop: 8,
                  backgroundColor: "#2a1530",
                  borderRadius: 8,
                  paddingVertical: 10,
                  borderWidth: 1,
                  borderColor: "#63407a",
                  opacity: withdrawing ? 0.7 : 1,
                }}
              >
                <Text style={{ color: "#fff", textAlign: "center", fontWeight: "700" }}>
                  {withdrawing ? "Sending..." : "Send SOL"}
                </Text>
              </Pressable>
            </View>

            <Pressable
              onPress={handleLogout}
              disabled={loggingOut}
              style={{
                marginTop: 12,
                borderRadius: 10,
                paddingVertical: 10,
                borderWidth: 1,
                borderColor: "#5f2128",
                backgroundColor: "#2b1115",
                opacity: loggingOut ? 0.7 : 1,
              }}
            >
              <Text style={{ color: "#ffd7dd", textAlign: "center", fontWeight: "700" }}>
                {loggingOut ? "Logging out..." : "Logout"}
              </Text>
            </Pressable>

          </View>
        </View>
      ) : (
        <View style={{ marginTop: 10, flex: 1, justifyContent: "center" }}>
          <Text style={{ color: "#aaa" }}>{walletError || "No wallet address found yet."}</Text>
          {privyUser ? (
            <Pressable
              onPress={handleCreateWallet}
              style={{ marginTop: 10, backgroundColor: "#fff", borderRadius: 10, paddingVertical: 10 }}
            >
              <Text style={{ color: "#000", textAlign: "center", fontWeight: "700" }}>Create Privy Wallet</Text>
            </Pressable>
          ) : (
            <View style={{ marginTop: 10 }}>
              <TextInput
                value={emailInput}
                onChangeText={setEmailInput}
                placeholder="Email address"
                placeholderTextColor="#68738a"
                autoCapitalize="none"
                autoCorrect={false}
                keyboardType="email-address"
                onFocus={() => scrollRef.current?.scrollToEnd({ animated: true })}
                style={{
                  borderWidth: 1,
                  borderColor: "#2a2a2a",
                  borderRadius: 8,
                  paddingHorizontal: 10,
                  paddingVertical: 8,
                  color: "#fff",
                  fontSize: 12,
                }}
              />
              <Pressable
                onPress={handleSendCode}
                disabled={sendingCode}
                style={{
                  marginTop: 10,
                  backgroundColor: "#0f223b",
                  borderRadius: 10,
                  paddingVertical: 10,
                  borderWidth: 1,
                  borderColor: "#254d78",
                  opacity: sendingCode ? 0.7 : 1,
                }}
              >
                <Text style={{ color: "#d7efff", textAlign: "center", fontWeight: "700" }}>
                  {sendingCode ? "Sending..." : "Send Code"}
                </Text>
              </Pressable>
              {codeSent ? (
                <>
                  <TextInput
                    value={codeInput}
                    onChangeText={setCodeInput}
                    placeholder="Verification code"
                    placeholderTextColor="#68738a"
                    keyboardType="number-pad"
                    onFocus={() => scrollRef.current?.scrollToEnd({ animated: true })}
                    style={{
                      marginTop: 10,
                      borderWidth: 1,
                      borderColor: "#2a2a2a",
                      borderRadius: 8,
                      paddingHorizontal: 10,
                      paddingVertical: 8,
                      color: "#fff",
                      fontSize: 12,
                    }}
                  />
                  <Pressable
                    onPress={handleVerifyCode}
                    disabled={verifyingCode}
                    style={{
                      marginTop: 10,
                      backgroundColor: "#1a2a1a",
                      borderRadius: 10,
                      paddingVertical: 10,
                      borderWidth: 1,
                      borderColor: "#2f6b38",
                      opacity: verifyingCode ? 0.7 : 1,
                    }}
                  >
                    <Text style={{ color: "#d7ffd9", textAlign: "center", fontWeight: "700" }}>
                      {verifyingCode ? "Verifying..." : "Verify & Connect"}
                    </Text>
                  </Pressable>
                </>
              ) : null}
            </View>
          )}
        </View>
      )}
      </ScrollView>
    </SafeAreaView>
  );
}
