import React, { useState } from "react";
import { View, Text, Pressable, ActivityIndicator, Alert } from "react-native";

const API_BASE = "https://memeswipe-api.onrender.com";
const TEST_USER_ID = "11111111-1111-1111-1111-111111111111";

export default function HomeScreen() {
  const [loading, setLoading] = useState(false);
  const [tokens, setTokens] = useState<any[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [creatingOrder, setCreatingOrder] = useState(false);

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

  return (
    <View style={{ flex: 1, backgroundColor: "#000", padding: 20, justifyContent: "center" }}>
      <Text style={{ color: "#fff", fontSize: 24, fontWeight: "bold" }}>MemeSwipe</Text>

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
