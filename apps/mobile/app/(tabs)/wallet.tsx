import React from "react";
import { ActivityIndicator, Alert, Pressable, ScrollView, Text, View } from "react-native";
import * as Clipboard from "expo-clipboard";
import * as Linking from "expo-linking";
import QRCode from "react-native-qrcode-svg";
import { useWalletContext } from "@/contexts/wallet-context";

const truncateMiddle = (value: string, keep = 6) => {
  if (value.length <= keep * 2 + 3) return value;
  return `${value.slice(0, keep)}...${value.slice(-keep)}`;
};

export default function WalletScreen() {
  const {
    walletAddress,
    walletLoading,
    walletError,
    refreshWalletAddress,
    getOrCreateEmbeddedWalletAddress,
  } = useWalletContext();

  const copyAddress = async () => {
    if (!walletAddress) return;
    await Clipboard.setStringAsync(walletAddress);
    Alert.alert("Copied", "Wallet address copied to clipboard.");
  };

  const refreshAddress = async () => {
    const updated = await refreshWalletAddress();
    if (!updated) {
      Alert.alert("Wallet", "Could not refresh address right now.");
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
    <ScrollView style={{ flex: 1, backgroundColor: "#000" }} contentContainerStyle={{ padding: 20 }}>
      <Text style={{ color: "#fff", fontSize: 28, fontWeight: "700" }}>Add SOL</Text>
      <Text style={{ color: "#bbb", marginTop: 12 }}>Your Memeswipe Wallet Address</Text>

      {walletLoading ? (
        <View style={{ marginTop: 16 }}>
          <ActivityIndicator />
          <Text style={{ color: "#999", marginTop: 10 }}>Loading wallet address...</Text>
        </View>
      ) : walletAddress ? (
        <>
          <View
            style={{
              marginTop: 12,
              borderRadius: 10,
              padding: 14,
              borderWidth: 1,
              borderColor: "#2a2a2a",
              backgroundColor: "#111",
            }}
          >
            <Text selectable style={{ color: "#fff", fontFamily: "Courier", fontSize: 14 }}>
              {truncateMiddle(walletAddress)}
            </Text>
            <Text selectable style={{ color: "#666", fontFamily: "Courier", marginTop: 8, fontSize: 11 }}>
              {walletAddress}
            </Text>
          </View>

          <Pressable
            onPress={copyAddress}
            style={{ marginTop: 14, backgroundColor: "#fff", borderRadius: 10, padding: 14 }}
          >
            <Text style={{ color: "#000", textAlign: "center", fontWeight: "700" }}>Copy Address</Text>
          </Pressable>

          <View style={{ marginTop: 20, alignItems: "center", justifyContent: "center" }}>
            <View style={{ backgroundColor: "#fff", padding: 14, borderRadius: 12 }}>
              <QRCode value={walletAddress} size={220} />
            </View>
          </View>

          <Text style={{ color: "#bbb", marginTop: 24, fontWeight: "600" }}>Send from Phantom</Text>
          <Pressable
            onPress={openPhantom}
            style={{ marginTop: 10, backgroundColor: "#1a1a1a", borderRadius: 10, padding: 14 }}
          >
            <Text style={{ color: "#fff", textAlign: "center", fontWeight: "700" }}>Open Phantom</Text>
          </Pressable>
        </>
      ) : (
        <View style={{ marginTop: 16 }}>
          <Text style={{ color: "#aaa" }}>{walletError || "No wallet address found yet."}</Text>
          <Pressable
            onPress={() =>
              getOrCreateEmbeddedWalletAddress().catch(() =>
                Alert.alert("Wallet", "Could not create a wallet address right now.")
              )
            }
            style={{ marginTop: 14, backgroundColor: "#fff", borderRadius: 10, padding: 14 }}
          >
            <Text style={{ color: "#000", textAlign: "center", fontWeight: "700" }}>Create Wallet</Text>
          </Pressable>
        </View>
      )}

      <Pressable
        onPress={refreshAddress}
        style={{ marginTop: 16, backgroundColor: "#222", borderRadius: 10, padding: 14 }}
      >
        <Text style={{ color: "#fff", textAlign: "center", fontWeight: "700" }}>Refresh</Text>
      </Pressable>
    </ScrollView>
  );
}
