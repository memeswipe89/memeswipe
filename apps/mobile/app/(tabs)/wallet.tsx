import React, { useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Alert, Platform, Pressable, Text, View, useWindowDimensions } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import * as Clipboard from "expo-clipboard";
import * as Linking from "expo-linking";
import QRCode from "react-native-qrcode-svg";
import { useWalletContext } from "@/contexts/wallet-context";

const MAINNET_RPC_URL = "https://api.mainnet-beta.solana.com";

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

export default function WalletScreen() {
  const { width, height } = useWindowDimensions();
  const qrSize = useMemo(() => {
    const byWidth = width * 0.56;
    const byHeight = height * 0.24;
    return Math.max(170, Math.min(230, byWidth, byHeight));
  }, [height, width]);

  const {
    twitterProfile,
    walletAddress,
    walletLoading,
    walletError,
    getOrCreateEmbeddedWalletAddress,
  } = useWalletContext();
  const [solBalance, setSolBalance] = useState<number | null>(null);
  const [balanceLoading, setBalanceLoading] = useState(false);
  const [balanceError, setBalanceError] = useState<string | null>(null);

  const copyAddress = async () => {
    if (!walletAddress) return;
    await Clipboard.setStringAsync(walletAddress);
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
    if (!walletAddress) return;
    void loadBalance(walletAddress);
  }, [walletAddress]);

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
      const address = await getOrCreateEmbeddedWalletAddress();
      console.log("[WALLET] Embedded Solana wallet address:", address);
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
      Alert.alert("Wallet", "Could not create a wallet address right now.");
    }
  };

  const openPhantom = async () => {
    if (!walletAddress) return;

    const transferLink = `phantom://v1/transfer?recipient=${encodeURIComponent(walletAddress)}&network=mainnet-beta`;
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

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: "#000", paddingHorizontal: 14, paddingTop: 4, paddingBottom: 4 }}>
      <View style={{ flex: 1 }}>
      {twitterProfile ? (
        <View
          style={{
            marginTop: 6,
            borderRadius: 10,
            paddingVertical: 8,
            paddingHorizontal: 10,
            borderWidth: 1,
            borderColor: "#254d78",
            backgroundColor: "#0a1a33",
          }}
        >
          <Text style={{ color: "#7fddff", fontWeight: "700" }}>User Profile</Text>
          <Text style={{ color: "#fff", marginTop: 2 }}>@{twitterProfile.username}</Text>
          <Text style={{ color: "#8f9ab7", marginTop: 2, fontSize: 11 }} numberOfLines={1}>
            ID: {twitterProfile.id}
          </Text>
        </View>
      ) : null}
      <Text style={{ color: "#bbb", marginTop: 8, fontSize: 13 }}>Your Memeswipe Wallet Address</Text>

      {walletLoading ? (
        <View style={{ marginTop: 12 }}>
          <ActivityIndicator />
          <Text style={{ color: "#999", marginTop: 6 }}>Loading wallet address...</Text>
        </View>
      ) : walletAddress ? (
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
              {truncateMiddle(walletAddress)}
            </Text>
            <Text selectable numberOfLines={1} style={{ color: "#666", fontFamily: "Courier", marginTop: 5, fontSize: 10 }}>
              {walletAddress}
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
              <QRCode value={walletAddress} size={qrSize} />
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
                  {solBalance === null ? "--" : `${solBalance.toFixed(6)} SOL`}
                </Text>
              )}
              {balanceError ? <Text style={{ color: "#ff8a8a", marginTop: 6, fontSize: 11 }}>{balanceError}</Text> : null}
            </View>

            <Pressable
              onPress={() => (walletAddress ? void loadBalance(walletAddress) : undefined)}
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
          </View>
        </View>
      ) : (
        <View style={{ marginTop: 10, flex: 1, justifyContent: "center" }}>
          <Text style={{ color: "#aaa" }}>{walletError || "No wallet address found yet."}</Text>
          <Pressable
            onPress={handleCreateWallet}
            style={{ marginTop: 10, backgroundColor: "#fff", borderRadius: 10, paddingVertical: 10 }}
          >
            <Text style={{ color: "#000", textAlign: "center", fontWeight: "700" }}>Create Wallet</Text>
          </Pressable>
        </View>
      )}
      </View>
    </SafeAreaView>
  );
}
