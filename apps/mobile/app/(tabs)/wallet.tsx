import React, { useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
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
import { usePrivy } from "@privy-io/expo";

import { useAuth } from "@/contexts/auth-context";
import { useWalletContext } from "@/contexts/wallet-context";

const MAINNET_RPC_URL = "https://api.mainnet-beta.solana.com";
const API_BASE =
  process.env.EXPO_PUBLIC_API_BASE || "https://memeswipe.onrender.com";

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

const getTwitterAccountFromPrivyUser = (
  user: any
): { id: string; username: string } | null => {
  const linkedAccounts = Array.isArray(user?.linkedAccounts)
    ? user.linkedAccounts
    : [];

  const twitterAccount = linkedAccounts.find((account: any) => {
    const type = String(account?.type || "").toLowerCase();
    const provider = String(account?.provider || "").toLowerCase();

    return (
      type === "twitter_oauth" ||
      provider === "twitter" ||
      (type === "oauth" && provider === "twitter")
    );
  });

  if (!twitterAccount) return null;

  return {
    id: String(
      twitterAccount?.subject ||
        twitterAccount?.id ||
        twitterAccount?.userId ||
        twitterAccount?.username ||
        ""
    ),
    username: String(
      twitterAccount?.username ||
        twitterAccount?.name ||
        twitterAccount?.handle ||
        "twitter"
    ),
  };
};

export default function WalletScreen() {
  const router = useRouter();
  const { user, isReady } = usePrivy();
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
    getOrCreateLocalUserId,
    getOrCreateTradingWalletAddress,
    withdrawFromTradingWallet,
  } = useWalletContext();

  const { logout } = useAuth();

  const [solBalance, setSolBalance] = useState<number | null>(null);
  const [balanceLoading, setBalanceLoading] = useState(false);
  const [balanceError, setBalanceError] = useState<string | null>(null);
  const [withdrawToAddress, setWithdrawToAddress] = useState("");
  const [withdrawAmount, setWithdrawAmount] = useState("0.01");
  const [withdrawing, setWithdrawing] = useState(false);
  const [disconnectingTwitter, setDisconnectingTwitter] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);

  const privyTwitterProfile = useMemo(() => {
    return getTwitterAccountFromPrivyUser(user);
  }, [user]);

  const effectiveTwitterProfile = twitterProfile || privyTwitterProfile;
  const isTwitterConnected = Boolean(effectiveTwitterProfile);
  const hasWallet = Boolean(tradingWalletAddress);

  useEffect(() => {
    if (!effectiveTwitterProfile) return;
    if (
      twitterProfile?.id === effectiveTwitterProfile.id &&
      twitterProfile?.username === effectiveTwitterProfile.username
    ) {
      return;
    }
    setTwitterProfile(effectiveTwitterProfile);
  }, [effectiveTwitterProfile, setTwitterProfile, twitterProfile]);

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

  const handleCreateWallet = async () => {
    let applicationId = "unknown";

    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const Application = require("expo-application") as {
        applicationId?: string;
      };

      if (
        typeof Application?.applicationId === "string" &&
        Application.applicationId.length > 0
      ) {
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

      Alert.alert(
        "Wallet Ready",
        "Wallet created.\nYou can now deposit SOL to this address."
      );
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

      Alert.alert("Wallet", message || "Could not create a wallet address right now.");
    }
  };

  const openPhantom = async () => {
    if (!tradingWalletAddress) return;

    const transferLink = `phantom://v1/transfer?recipient=${encodeURIComponent(
      tradingWalletAddress
    )}&network=mainnet-beta`;
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
      Alert.alert(
        "Phantom not found",
        "Copy the address and send SOL from any Solana wallet."
      );
    } catch {
      Alert.alert(
        "Phantom not found",
        "Copy the address and send SOL from any Solana wallet."
      );
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

  const disconnectTwitter = async () => {
    try {
      setDisconnectingTwitter(true);

      const userId = await getOrCreateLocalUserId();
      const res = await fetch(
        `${API_BASE}/api/twitter/connection/${encodeURIComponent(userId)}`,
        {
          method: "DELETE",
        }
      );

      if (!res.ok) {
        const text = await res.text();
        throw new Error(text || "Failed to disconnect Twitter");
      }

      setTwitterProfile(null);
      await clearLocalAppData();
      router.replace("/(tabs)");

      Alert.alert(
        "Twitter Disconnected",
        "Your Twitter account has been disconnected."
      );
    } catch (error: any) {
      Alert.alert("Twitter", error?.message || "Failed to disconnect Twitter.");
    } finally {
      setDisconnectingTwitter(false);
    }
  };

  const handleDisconnectTwitter = () => {
    Alert.alert(
      "Disconnect Twitter",
      "Are you sure you want to disconnect this Twitter account?",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Disconnect",
          style: "destructive",
          onPress: () => void disconnectTwitter(),
        },
      ]
    );
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

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: "#07111f" }}>
      <ScrollView
        contentContainerStyle={{
          paddingHorizontal: 18,
          paddingTop: 18,
          paddingBottom: 40,
        }}
      >
        <Text
          style={{
            color: "#f8fbff",
            fontSize: 28,
            fontWeight: "800",
            marginBottom: 16,
          }}
        >
          Wallet
        </Text>

        {isTwitterConnected ? (
          <View
            style={{
              backgroundColor: "#0d1b2e",
              borderRadius: 16,
              borderWidth: 1,
              borderColor: "#173357",
              padding: 16,
              marginBottom: 16,
            }}
          >
            <Text
              style={{
                color: "#8ab4ff",
                fontSize: 12,
                fontWeight: "700",
                marginBottom: 8,
                textTransform: "uppercase",
                letterSpacing: 0.8,
              }}
            >
              User Profile
            </Text>

            <Text style={{ color: "#f8fbff", fontSize: 18, fontWeight: "700" }}>
              @{effectiveTwitterProfile?.username}
            </Text>

            <Text style={{ color: "#7f97b8", marginTop: 6 }}>
              ID: {effectiveTwitterProfile?.id}
            </Text>

            <Pressable
              onPress={handleDisconnectTwitter}
              disabled={disconnectingTwitter}
              style={{
                marginTop: 14,
                alignSelf: "flex-start",
                paddingHorizontal: 14,
                paddingVertical: 10,
                borderRadius: 10,
                backgroundColor: "#2a1530",
                borderWidth: 1,
                borderColor: "#63407a",
                opacity: disconnectingTwitter ? 0.7 : 1,
              }}
            >
              <Text style={{ color: "#ffd9ff", fontWeight: "700" }}>
                {disconnectingTwitter ? "Disconnecting..." : "Disconnect Twitter"}
              </Text>
            </Pressable>
          </View>
        ) : (
          <View
            style={{
              backgroundColor: "#0d1b2e",
              borderRadius: 16,
              borderWidth: 1,
              borderColor: "#173357",
              padding: 16,
              marginBottom: 16,
            }}
          >
            <Text style={{ color: "#f8fbff", fontSize: 16, fontWeight: "700" }}>
              Twitter not connected
            </Text>
            <Text style={{ color: "#7f97b8", marginTop: 8, lineHeight: 20 }}>
              Connect Twitter from the Home screen first. Once Privy restores your
              session, this wallet screen will use the same account automatically.
            </Text>
          </View>
        )}

        <View
          style={{
            backgroundColor: "#0d1b2e",
            borderRadius: 16,
            borderWidth: 1,
            borderColor: "#173357",
            padding: 16,
            marginBottom: 16,
          }}
        >
          <Text
            style={{
              color: "#8ab4ff",
              fontSize: 12,
              fontWeight: "700",
              marginBottom: 10,
              textTransform: "uppercase",
              letterSpacing: 0.8,
            }}
          >
            Your Privy Embedded Wallet Address
          </Text>

          {!isReady ? (
            <View style={{ paddingVertical: 18 }}>
              <ActivityIndicator color="#8ab4ff" />
              <Text style={{ color: "#7f97b8", marginTop: 10 }}>
                Restoring wallet session...
              </Text>
            </View>
          ) : walletLoading ? (
            <View style={{ paddingVertical: 18 }}>
              <ActivityIndicator color="#8ab4ff" />
              <Text style={{ color: "#7f97b8", marginTop: 10 }}>
                Loading wallet address...
              </Text>
            </View>
          ) : hasWallet ? (
            <>
              <Text
                style={{
                  color: "#f8fbff",
                  fontSize: 22,
                  fontWeight: "800",
                  marginBottom: 8,
                }}
              >
                {truncateMiddle(tradingWalletAddress!)}
              </Text>

              <Text
                selectable
                style={{
                  color: "#7f97b8",
                  fontSize: 13,
                  lineHeight: 20,
                  marginBottom: 14,
                }}
              >
                {tradingWalletAddress}
              </Text>

              <View
                style={{
                  alignItems: "center",
                  justifyContent: "center",
                  backgroundColor: "#ffffff",
                  borderRadius: 18,
                  padding: 16,
                  alignSelf: "center",
                  marginBottom: 16,
                }}
              >
                <QRCode value={tradingWalletAddress!} size={qrSize} />
              </View>

              <View style={{ gap: 10 }}>
                <Pressable
                  onPress={copyAddress}
                  style={{
                    backgroundColor: "#163150",
                    borderRadius: 10,
                    paddingVertical: 12,
                    alignItems: "center",
                    borderWidth: 1,
                    borderColor: "#28517f",
                  }}
                >
                  <Text style={{ color: "#f8fbff", fontWeight: "700" }}>
                    Copy Address
                  </Text>
                </Pressable>

                <Pressable
                  onPress={openPhantom}
                  style={{
                    backgroundColor: "#10233f",
                    borderRadius: 10,
                    paddingVertical: 12,
                    alignItems: "center",
                    borderWidth: 1,
                    borderColor: "#254d78",
                  }}
                >
                  <Text style={{ color: "#f8fbff", fontWeight: "700" }}>
                    Send from Phantom
                  </Text>
                </Pressable>
              </View>

              <Text
                style={{
                  color: "#7f97b8",
                  marginTop: 12,
                  lineHeight: 20,
                }}
              >
                Send SOL from Phantom or any Solana wallet to this address.
              </Text>
            </>
          ) : (
            <>
              <Text style={{ color: "#7f97b8", lineHeight: 20 }}>
                {!isTwitterConnected
                  ? "Connect Twitter on Home first, then create your wallet."
                  : walletError || "No wallet address found yet."}
              </Text>

              {isTwitterConnected ? (
                <Pressable
                  onPress={() => void handleCreateWallet()}
                  style={{
                    marginTop: 14,
                    backgroundColor: "#1a4d9b",
                    borderRadius: 10,
                    paddingVertical: 12,
                    alignItems: "center",
                  }}
                >
                  <Text style={{ color: "#ffffff", fontWeight: "800" }}>
                    Create Privy Wallet
                  </Text>
                </Pressable>
              ) : null}
            </>
          )}
        </View>

        {hasWallet ? (
          <>
            <View
              style={{
                backgroundColor: "#0d1b2e",
                borderRadius: 16,
                borderWidth: 1,
                borderColor: "#173357",
                padding: 16,
                marginBottom: 16,
              }}
            >
              <Text
                style={{
                  color: "#8ab4ff",
                  fontSize: 12,
                  fontWeight: "700",
                  marginBottom: 10,
                  textTransform: "uppercase",
                  letterSpacing: 0.8,
                }}
              >
                SOL Balance
              </Text>

              {balanceLoading ? (
                <ActivityIndicator color="#8ab4ff" />
              ) : (
                <Text
                  style={{
                    color: "#f8fbff",
                    fontSize: 22,
                    fontWeight: "800",
                  }}
                >
                  {solBalance === null ? "--" : formatSol(solBalance)}
                </Text>
              )}

              {balanceError ? (
                <Text style={{ color: "#ff8d8d", marginTop: 8 }}>{balanceError}</Text>
              ) : null}

              <Pressable
                onPress={() =>
                  tradingWalletAddress
                    ? void loadBalance(tradingWalletAddress)
                    : undefined
                }
                style={{
                  marginTop: 10,
                  backgroundColor: "#10233f",
                  borderRadius: 10,
                  paddingVertical: 10,
                  borderWidth: 1,
                  borderColor: "#254d78",
                  alignItems: "center",
                }}
              >
                <Text style={{ color: "#f8fbff", fontWeight: "700" }}>
                  Refresh Balance
                </Text>
              </Pressable>
            </View>

            <View
              style={{
                backgroundColor: "#0d1b2e",
                borderRadius: 16,
                borderWidth: 1,
                borderColor: "#173357",
                padding: 16,
                marginBottom: 16,
              }}
            >
              <Text
                style={{
                  color: "#8ab4ff",
                  fontSize: 12,
                  fontWeight: "700",
                  marginBottom: 10,
                  textTransform: "uppercase",
                  letterSpacing: 0.8,
                }}
              >
                Send SOL to Phantom / external wallet
              </Text>

              <TextInput
                value={withdrawToAddress}
                onChangeText={setWithdrawToAddress}
                placeholder="Destination Solana address"
                placeholderTextColor="#6f86a6"
                autoCapitalize="none"
                autoCorrect={false}
                style={{
                  color: "#f8fbff",
                  backgroundColor: "#091423",
                  borderRadius: 10,
                  paddingHorizontal: 12,
                  paddingVertical: 12,
                  borderWidth: 1,
                  borderColor: "#1f3a60",
                  marginBottom: 10,
                }}
              />

              <TextInput
                value={withdrawAmount}
                onChangeText={setWithdrawAmount}
                placeholder="Amount in SOL"
                placeholderTextColor="#6f86a6"
                keyboardType="decimal-pad"
                style={{
                  color: "#f8fbff",
                  backgroundColor: "#091423",
                  borderRadius: 10,
                  paddingHorizontal: 12,
                  paddingVertical: 12,
                  borderWidth: 1,
                  borderColor: "#1f3a60",
                }}
              />

              <Pressable
                onPress={() => void handleWithdraw()}
                disabled={withdrawing}
                style={{
                  marginTop: 12,
                  backgroundColor: "#2a1530",
                  borderRadius: 10,
                  paddingVertical: 12,
                  alignItems: "center",
                  borderWidth: 1,
                  borderColor: "#63407a",
                  opacity: withdrawing ? 0.7 : 1,
                }}
              >
                <Text style={{ color: "#ffd9ff", fontWeight: "800" }}>
                  {withdrawing ? "Sending..." : "Send SOL"}
                </Text>
              </Pressable>
            </View>
          </>
        ) : null}

        <Pressable
          onPress={handleLogout}
          disabled={loggingOut}
          style={{
            backgroundColor: "#2a1530",
            borderRadius: 12,
            paddingVertical: 14,
            alignItems: "center",
            borderWidth: 1,
            borderColor: "#63407a",
            opacity: loggingOut ? 0.7 : 1,
          }}
        >
          <Text style={{ color: "#ffd9ff", fontWeight: "800" }}>
            {loggingOut ? "Logging out..." : "Logout"}
          </Text>
        </Pressable>
      </ScrollView>
    </SafeAreaView>
  );
}