import React, { useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Alert, Platform, Pressable, Text, TextInput, View, useWindowDimensions } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import * as Clipboard from "expo-clipboard";
import * as Linking from "expo-linking";
import QRCode from "react-native-qrcode-svg";
import { useEmbeddedSolanaWallet } from "@privy-io/expo";
import { Connection, PublicKey, SystemProgram, TransactionMessage, VersionedTransaction } from "@solana/web3.js";
import { useWalletContext } from "@/contexts/wallet-context";

const MAINNET_RPC_URL = "https://api.mainnet-beta.solana.com";
const MIGRATE_FEE_RESERVE_LAMPORTS = 15000;

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
    tradingWalletAddress,
    withdrawAddress,
    walletLoading,
    walletError,
    getOrCreateEmbeddedWalletAddress,
    getOrCreateTradingWalletAddress,
    setTradingWithdrawAddress,
    withdrawFromTradingWallet,
  } = useWalletContext();
  const embeddedSolanaWallet = useEmbeddedSolanaWallet();
  const [solBalance, setSolBalance] = useState<number | null>(null);
  const [balanceLoading, setBalanceLoading] = useState(false);
  const [balanceError, setBalanceError] = useState<string | null>(null);
  const [withdrawToAddress, setWithdrawToAddress] = useState("");
  const [withdrawAmount, setWithdrawAmount] = useState("0.01");
  const [withdrawing, setWithdrawing] = useState(false);
  const [migrating, setMigrating] = useState(false);

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
    if (withdrawAddress && !withdrawToAddress) {
      setWithdrawToAddress(withdrawAddress);
    }
  }, [withdrawAddress, withdrawToAddress]);

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
      console.log("[WALLET] Trading wallet address:", address);
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

  const handleSaveWithdrawAddress = async () => {
    try {
      const next = withdrawToAddress.trim();
      if (!next) {
        Alert.alert("Withdraw", "Enter destination wallet address.");
        return;
      }
      const saved = await setTradingWithdrawAddress(next);
      setWithdrawToAddress(saved);
      Alert.alert("Saved", "Withdraw address updated.");
    } catch (error: any) {
      Alert.alert("Withdraw", error?.message || "Failed to save withdraw address.");
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

  const handleMigrateFromPrivyWallet = async () => {
    try {
      if (!tradingWalletAddress) {
        Alert.alert("Migrate", "Create trading wallet first.");
        return;
      }
      setMigrating(true);
      const fromAddress = walletAddress || (await getOrCreateEmbeddedWalletAddress());
      if (!fromAddress) {
        throw new Error("Old Privy wallet not found.");
      }
      if (fromAddress === tradingWalletAddress) {
        Alert.alert("Migrate", "Old wallet and trading wallet are same address.");
        return;
      }

      let provider: any = null;
      if ("wallets" in embeddedSolanaWallet && Array.isArray(embeddedSolanaWallet.wallets) && embeddedSolanaWallet.wallets.length > 0) {
        provider = await embeddedSolanaWallet.wallets[0].getProvider();
      } else if ("create" in embeddedSolanaWallet && typeof embeddedSolanaWallet.create === "function") {
        provider = await embeddedSolanaWallet.create();
      }
      if (!provider || typeof provider.request !== "function") {
        throw new Error("Embedded wallet provider unavailable.");
      }

      const connection = new Connection(MAINNET_RPC_URL, "confirmed");
      const fromPubkey = new PublicKey(fromAddress);
      const toPubkey = new PublicKey(tradingWalletAddress);

      const currentLamports = await connection.getBalance(fromPubkey, "confirmed");
      const sendLamports = currentLamports - MIGRATE_FEE_RESERVE_LAMPORTS;
      if (sendLamports <= 0) {
        throw new Error("Not enough SOL in old wallet to migrate after fees.");
      }

      const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash("confirmed");
      const message = new TransactionMessage({
        payerKey: fromPubkey,
        recentBlockhash: blockhash,
        instructions: [
          SystemProgram.transfer({
            fromPubkey,
            toPubkey,
            lamports: sendLamports,
          }),
        ],
      }).compileToV0Message();
      const tx = new VersionedTransaction(message);

      const signed = (await provider.request({
        method: "signAndSendTransaction",
        params: {
          transaction: tx,
          connection,
          options: { skipPreflight: false, maxRetries: 3 },
        },
      })) as { signature?: string };

      if (!signed?.signature) {
        throw new Error("Migration transaction signature missing.");
      }

      await connection.confirmTransaction(
        { signature: signed.signature, blockhash, lastValidBlockHeight },
        "confirmed"
      );
      await loadBalance(tradingWalletAddress);
      Alert.alert("Migration Success", `Tx: ${signed.signature}`);
    } catch (error: any) {
      Alert.alert("Migration Failed", error?.message || "Failed to migrate SOL.");
    } finally {
      setMigrating(false);
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
      <Text style={{ color: "#bbb", marginTop: 8, fontSize: 13 }}>Your Memeswipe Trading Wallet Address</Text>

      {walletLoading ? (
        <View style={{ marginTop: 12 }}>
          <ActivityIndicator />
          <Text style={{ color: "#999", marginTop: 6 }}>Loading wallet address...</Text>
        </View>
      ) : tradingWalletAddress ? (
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
              {truncateMiddle(tradingWalletAddress)}
            </Text>
            <Text selectable numberOfLines={1} style={{ color: "#666", fontFamily: "Courier", marginTop: 5, fontSize: 10 }}>
              {tradingWalletAddress}
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
              <QRCode value={tradingWalletAddress} size={qrSize} />
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
                borderColor: "#3a2d12",
                backgroundColor: "#20180a",
              }}
            >
              <Text style={{ color: "#f2cb7d", fontWeight: "700" }}>Temporary: migrate old Privy wallet SOL</Text>
              <Text style={{ color: "#d6c7a7", marginTop: 6, fontSize: 11 }}>
                Moves SOL from your previous embedded Privy wallet to this new trading wallet.
              </Text>
              <Pressable
                onPress={() => void handleMigrateFromPrivyWallet()}
                disabled={migrating}
                style={{
                  marginTop: 8,
                  backgroundColor: "#3a2d12",
                  borderRadius: 8,
                  paddingVertical: 10,
                  borderWidth: 1,
                  borderColor: "#8a6b37",
                  opacity: migrating ? 0.7 : 1,
                }}
              >
                <Text style={{ color: "#fff", textAlign: "center", fontWeight: "700" }}>
                  {migrating ? "Migrating..." : "Migrate SOL To Trading Wallet"}
                </Text>
              </Pressable>
            </View>

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
              <Text style={{ color: "#bbb", fontWeight: "600" }}>Withdraw to Phantom / external wallet</Text>
              <TextInput
                value={withdrawToAddress}
                onChangeText={setWithdrawToAddress}
                placeholder="Destination wallet address"
                placeholderTextColor="#68738a"
                autoCapitalize="none"
                autoCorrect={false}
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
                onPress={handleSaveWithdrawAddress}
                style={{
                  marginTop: 8,
                  backgroundColor: "#10233f",
                  borderRadius: 8,
                  paddingVertical: 9,
                  borderWidth: 1,
                  borderColor: "#254d78",
                }}
              >
                <Text style={{ color: "#fff", textAlign: "center", fontWeight: "700" }}>Save Withdraw Address</Text>
              </Pressable>

              <TextInput
                value={withdrawAmount}
                onChangeText={setWithdrawAmount}
                placeholder="SOL amount (e.g. 0.01)"
                placeholderTextColor="#68738a"
                keyboardType="decimal-pad"
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
                  {withdrawing ? "Withdrawing..." : "Withdraw SOL"}
                </Text>
              </Pressable>
            </View>

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
