import * as Linking from "expo-linking";
import React, { useEffect, useState } from "react";
import { View, Text, Pressable, ActivityIndicator, Alert } from "react-native";

const API_BASE = "https://memeswipe.onrender.com";
const TEST_USER_ID = "11111111-1111-1111-1111-111111111111";

const tryParseJson = (raw: string) => {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
};

const firstLine = (value: string) => value.split("\n").map((line) => line.trim()).find(Boolean) || "";

export default function HomeScreen() {
  const [loading, setLoading] = useState(false);
  const [tokens, setTokens] = useState<any[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [creatingOrder, setCreatingOrder] = useState(false);
  const [checkingTwitter, setCheckingTwitter] = useState(true);
  const [twitterConnectLoading, setTwitterConnectLoading] = useState(false);
  const [showTwitterPrompt, setShowTwitterPrompt] = useState(false);
  const [twitterConnection, setTwitterConnection] = useState<{
    username: string;
    id: string;
  } | null>(null);

  const checkTwitterConnection = async () => {
    try {
      setCheckingTwitter(true);
      const res = await fetch(`${API_BASE}/api/twitter/connection/${TEST_USER_ID}`);
      const raw = await res.text();
      const data = tryParseJson(raw);

      if (!res.ok) {
        const apiError =
          (data && typeof data.error === "string" && data.error) ||
          firstLine(raw) ||
          "Could not check Twitter connection";
        throw new Error(`Twitter check failed (${res.status}): ${apiError}`);
      }

      if (!data) {
        throw new Error(`Twitter check returned non-JSON (${res.status})`);
      }

      if (data.connected) {
        setTwitterConnection({
          username: data.twitterUsername,
          id: data.twitterUserId,
        });
        setShowTwitterPrompt(false);
      } else {
        setShowTwitterPrompt(true);
      }
    } catch (error) {
      console.log(error);
      setShowTwitterPrompt(true);
    } finally {
      setCheckingTwitter(false);
    }
  };

  const handleTwitterRedirect = (url: string) => {
    const parsed = Linking.parse(url);
    const path = parsed.path || "";
    const host = parsed.hostname || "";
    const isTwitterCallback = path.includes("twitter-connected") || host === "twitter-connected";
    if (!isTwitterCallback) return;

    const status = parsed.queryParams?.status;
    if (status !== "success") {
      setTwitterConnectLoading(false);
      const error = parsed.queryParams?.error;
      Alert.alert("Twitter Connect", `Twitter connection failed${error ? `: ${error}` : "."}`);
      return;
    }

    const twitterUsername = parsed.queryParams?.twitterUsername;
    const twitterUserId = parsed.queryParams?.twitterUserId;
    if (typeof twitterUsername !== "string" || typeof twitterUserId !== "string") {
      setTwitterConnectLoading(false);
      Alert.alert("Twitter Connect", "Twitter profile data missing");
      return;
    }

    setTwitterConnection({ username: twitterUsername, id: twitterUserId });
    setShowTwitterPrompt(false);
    setTwitterConnectLoading(false);
    Alert.alert("Connected", `Connected as @${twitterUsername}`);
  };

  useEffect(() => {
    const sub = Linking.addEventListener("url", ({ url }) => {
      handleTwitterRedirect(url);
    });

    Linking.getInitialURL().then((url) => {
      if (url) handleTwitterRedirect(url);
    });

    checkTwitterConnection();

    return () => sub.remove();
  }, []);

  const connectTwitter = async () => {
    try {
      setTwitterConnectLoading(true);
      const returnUrl = Linking.createURL("twitter-connected");

      const startRes = await fetch(
        `${API_BASE}/api/twitter/auth/start?userId=${encodeURIComponent(TEST_USER_ID)}&returnUrl=${encodeURIComponent(returnUrl)}`
      );
      const raw = await startRes.text();
      const startJson = tryParseJson(raw);

      if (!startRes.ok) {
        const apiError =
          (startJson && typeof startJson.error === "string" && startJson.error) ||
          firstLine(raw) ||
          "Failed to start Twitter auth";
        throw new Error(`Twitter start failed (${startRes.status}): ${apiError}`);
      }

      if (!startJson?.authUrl) {
        throw new Error("Twitter start endpoint returned no authUrl");
      }
      const canOpen = await Linking.canOpenURL(startJson.authUrl);
      if (!canOpen) {
        throw new Error("Cannot open Twitter authorization URL");
      }
      await Linking.openURL(startJson.authUrl);
    } catch (error: any) {
      console.log(error);
      Alert.alert("Twitter Connect", error?.message || "Failed to connect Twitter");
      setTwitterConnectLoading(false);
    } finally {
      // Intentionally kept loading while user is in Twitter/browser.
      // It is reset when callback URL is received or if an error is thrown above.
    }
  };

  const loadTokens = async () => {
    try {
      setLoading(true);
      const res = await fetch(`${API_BASE}/api/feed/solana/graduated`);
      if (!res.ok) throw new Error("Network error");
      const data = await res.json();
      setTokens(data.tokens || []);
      setCurrentIndex(0);
    } catch (err) {
      console.log(err);
      Alert.alert("Error", "Could not load tokens");
    } finally {
      setLoading(false);
    }
  };

  // Try common fields to find token address safely
  const getTokenAddress = (t: any) =>
    t?.address || t?.tokenAddress || t?.mint || t?.baseToken?.address || "";

  const createOrder = async (token: any) => {
    const tokenAddress = getTokenAddress(token);
    if (!tokenAddress) {
      Alert.alert("Error", "Token address missing in API response");
      return;
    }

    try {
      setCreatingOrder(true);

      const res = await fetch(`${API_BASE}/api/orders`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userId: TEST_USER_ID,
          chain: token.chain || "solana",
          tokenAddress,
          amountUsd: 10, // later from settings screen
          tpRoi: 0.5,    // later from settings screen
        }),
      });

      const json = await res.json();

      if (!res.ok) {
        console.log("Order error:", json);
        Alert.alert("Order Failed", json?.error || "Unknown error");
        return;
      }

      console.log("Order created:", json);
      // Optional: show tiny confirmation
      // Alert.alert("Success", `Order #${json.order?.id || ""} created`);
    } catch (e: any) {
      console.log(e);
      Alert.alert("Order Failed", e?.message || "Network error");
    } finally {
      setCreatingOrder(false);
    }
  };

  const nextToken = () => setCurrentIndex((i) => i + 1);

  const handleReject = () => {
    nextToken();
  };

  const handleBuy = async () => {
    const token = tokens[currentIndex];
    await createOrder(token);
    nextToken();
  };

  const currentToken = tokens[currentIndex];

  if (checkingTwitter) {
    return (
      <View style={{ flex: 1, backgroundColor: "#000", justifyContent: "center", alignItems: "center" }}>
        <ActivityIndicator />
        <Text style={{ color: "#fff", marginTop: 12 }}>Checking Twitter connection...</Text>
      </View>
    );
  }

  if (showTwitterPrompt && !twitterConnection) {
    return (
      <View style={{ flex: 1, backgroundColor: "#000", padding: 20, justifyContent: "center" }}>
        <Text style={{ color: "#fff", fontSize: 28, fontWeight: "bold", textAlign: "center" }}>
          Connect Twitter
        </Text>
        <Text style={{ color: "#bbb", marginTop: 12, textAlign: "center" }}>
          Please connect your Twitter/X account to continue.
        </Text>
        <Pressable
          onPress={connectTwitter}
          style={{ marginTop: 24, padding: 16, backgroundColor: "#fff", borderRadius: 10 }}
          disabled={twitterConnectLoading}
        >
          <Text style={{ color: "#000", textAlign: "center", fontWeight: "bold" }}>
            {twitterConnectLoading ? "Connecting..." : "Connect Twitter"}
          </Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: "#000", padding: 20, justifyContent: "center" }}>
      <Text style={{ color: "#fff", fontSize: 24, fontWeight: "bold" }}>MemeSwipe</Text>
      {twitterConnection ? (
        <Text style={{ color: "#7fff9f", marginTop: 6 }}>
          Connected: @{twitterConnection.username} ({twitterConnection.id})
        </Text>
      ) : null}

      {tokens.length === 0 ? (
        <>
          <Pressable
            onPress={loadTokens}
            style={{ marginTop: 20, padding: 15, backgroundColor: "#fff", borderRadius: 10 }}
            disabled={loading}
          >
            <Text style={{ textAlign: "center", fontWeight: "bold" }}>
              {loading ? "Loading..." : "Load Graduated Tokens"}
            </Text>
          </Pressable>

          {loading && <ActivityIndicator style={{ marginTop: 20 }} />}
        </>
      ) : currentToken ? (
        <>
          {/* Token Card */}
          <View style={{ backgroundColor: "#111", padding: 20, borderRadius: 16, marginTop: 20 }}>
            <Text style={{ color: "#fff", fontSize: 20, fontWeight: "bold" }}>
              {currentToken.name || "Unknown"}
            </Text>
            <Text style={{ color: "#aaa", marginTop: 6 }}>
              {currentToken.symbol || ""}
            </Text>

            <Text style={{ color: "#555", marginTop: 10, fontSize: 12 }}>
              {getTokenAddress(currentToken)}
            </Text>
          </View>

          {/* Buttons */}
          <View style={{ flexDirection: "row", justifyContent: "space-between", marginTop: 20 }}>
            <Pressable
              onPress={handleReject}
              style={{ width: "48%", padding: 16, backgroundColor: "#222", borderRadius: 12 }}
              disabled={creatingOrder}
            >
              <Text style={{ color: "red", textAlign: "center", fontWeight: "bold" }}>
                REJECT
              </Text>
            </Pressable>

            <Pressable
              onPress={handleBuy}
              style={{ width: "48%", padding: 16, backgroundColor: "#fff", borderRadius: 12 }}
              disabled={creatingOrder}
            >
              <Text style={{ color: "#000", textAlign: "center", fontWeight: "bold" }}>
                {creatingOrder ? "BUYING..." : "BUY"}
              </Text>
            </Pressable>
          </View>

          <Text style={{ color: "#444", marginTop: 14, textAlign: "center" }}>
            {currentIndex + 1} / {tokens.length}
          </Text>
        </>
      ) : (
        <>
          <Text style={{ color: "#fff", marginTop: 20, textAlign: "center" }}>
            No more tokens 🎉
          </Text>
          <Pressable
            onPress={loadTokens}
            style={{ marginTop: 20, padding: 15, backgroundColor: "#fff", borderRadius: 10 }}
          >
            <Text style={{ textAlign: "center", fontWeight: "bold" }}>Reload</Text>
          </Pressable>
        </>
      )}
    </View>
  );
}
