"use client";

import { usePrivy } from "@privy-io/react-auth";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { TokenDeck } from "./TokenDeck";
import { TradeControls } from "./TradeControls";
import { BagHighlights } from "./BagHighlights";
import { TradesPanel } from "./TradesPanel";
import { TwitterConnectPrompt } from "./TwitterConnectPrompt";
import { WalletPanel } from "./WalletPanel";
import { FeedToken, FALLBACK_TOKENS, fetchGraduatedTokens } from "@/lib/feed";
import { useFlow } from "@/lib/flow";
import { useTradeSettings } from "@/lib/trade-settings-context";
import {
  checkTwitterConnection,
  parseTwitterCallback,
  startTwitterConnection,
} from "@/lib/twitter";
import { getTwitterProfileFromUser, TwitterProfile } from "@/lib/privy-utils";

export function TradingExperience() {
  const { userId, walletAddress } = useFlow();
  const privy = usePrivy();
  const { tradeAmount, activeChain } = useTradeSettings();
  const [tokens, setTokens] = useState<FeedToken[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [bagOnly, setBagOnly] = useState(false);
  const [activeTab, setActiveTab] = useState<"home" | "trades" | "wallet">("home");
  const [twitterProfile, setTwitterProfile] = useState<TwitterProfile | null>(
    getTwitterProfileFromUser(privy.user)
  );
  const [twitterPrompt, setTwitterPrompt] = useState(!twitterProfile);
  const [twitterLoading, setTwitterLoading] = useState(false);
  const [twitterError, setTwitterError] = useState<string | undefined>();
  const [twitterFeedback, setTwitterFeedback] = useState<string | null>(null);
  const searchParams = useSearchParams();
  const router = useRouter();

  const bagTokens = useMemo(
    () => tokens.filter((token) => token.source === "bags").slice(0, 4),
    [tokens]
  );
  const deckTokens = useMemo(
    () => tokens.filter((token) => (bagOnly ? token.source === "bags" : true)),
    [tokens, bagOnly]
  );

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetchGraduatedTokens(30)
      .then((result) => {
        if (!cancelled) {
          setTokens(result.length > 0 ? result : FALLBACK_TOKENS);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err?.message || "Unable to load deck.");
          setTokens(FALLBACK_TOKENS);
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    setTwitterProfile(getTwitterProfileFromUser(privy.user));
  }, [privy.user]);

  useEffect(() => {
    if (!userId) return;
    let cancel = false;
    setTwitterError(undefined);
    checkTwitterConnection(userId)
      .then((status) => {
        if (cancel) return;
        if (status.connected && status.twitterUsername && status.twitterUserId) {
          setTwitterProfile({
            username: status.twitterUsername,
            id: status.twitterUserId,
          });
          setTwitterPrompt(false);
        } else {
          setTwitterPrompt(!Boolean(getTwitterProfileFromUser(privy.user)));
        }
      })
      .catch(() => {
        if (cancel) return;
        setTwitterPrompt(!Boolean(getTwitterProfileFromUser(privy.user)));
      });
    return () => {
      cancel = true;
    };
  }, [userId, privy.user]);

  useEffect(() => {
    const snapshot = searchParams?.toString() || "";
    if (!snapshot.includes("status")) {
      return;
    }
    const parsed = parseTwitterCallback(new URLSearchParams(snapshot));
    if (!parsed) {
      return;
    }
    if (parsed.status === "success" && parsed.twitterUserId && parsed.twitterUsername) {
      setTwitterProfile({ username: parsed.twitterUsername, id: parsed.twitterUserId });
      setTwitterPrompt(false);
      setTwitterFeedback("Twitter connected. Trading signals unlocked.");
    } else if (parsed.status === "error") {
      setTwitterError(parsed.error || parsed.reason || "Twitter connection failed.");
      setTwitterPrompt(true);
    }
    router.replace(router.pathname);
    setTwitterLoading(false);
  }, [router, searchParams]);

  const handlePressReject = () => {
    setTokens((prev) => prev.slice(1));
  };

  const handlePressTrade = (token: FeedToken) => {
    setTokens((prev) => prev.slice(1));
    setTwitterFeedback(`Placed ${token.symbol} trade at $${token.priceUsd?.toFixed(3) || "0"}`);
  };

  const handleTwitterConnect = async () => {
    if (!userId) return;
    setTwitterLoading(true);
    setTwitterError(undefined);
    try {
      if (typeof window === "undefined") {
        throw new Error("Browser window not available");
      }
      const returnUrl = `${window.location.origin}${window.location.pathname}`;
      const authUrl = await startTwitterConnection(userId, returnUrl);
      window.location.href = authUrl;
    } catch (err) {
      setTwitterError(err instanceof Error ? err.message : "Unable to start Twitter flow.");
      setTwitterLoading(false);
    }
  };

  return (
    <section className="flex w-full flex-1 flex-col items-center gap-8 px-4 py-10 text-white">
      <div className="w-full max-w-3xl space-y-5">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-xs uppercase tracking-[0.4em] text-slate-500">Step 3 · Swipe deck</p>
            <h1 className="text-3xl font-semibold text-white sm:text-4xl">Fresh picks · {activeChain.toUpperCase()}</h1>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          {[
            { key: "home", label: "Swipe" },
            { key: "trades", label: "Trades" },
            { key: "wallet", label: "Wallet" },
          ].map((tab) => (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key as "home" | "trades" | "wallet")}
              className={`rounded-full border px-4 py-2 text-[10px] font-semibold uppercase tracking-[0.4em] transition ${
                activeTab === tab.key ? "border-white text-white" : "border-white/20 text-slate-400"
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {activeTab === "home" && (
          <>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex gap-2">
                <button
                  onClick={() => setBagOnly(false)}
                  className={`rounded-full border px-4 py-2 text-[10px] font-semibold uppercase tracking-[0.4em] transition ${
                    !bagOnly ? "border-white/70 text-white" : "border-white/20 text-slate-400"
                  }`}
                >
                  All feeds
                </button>
                <button
                  onClick={() => setBagOnly(true)}
                  className={`rounded-full border px-4 py-2 text-[10px] font-semibold uppercase tracking-[0.4em] transition ${
                    bagOnly ? "border-emerald-400 text-emerald-300" : "border-white/20 text-slate-400"
                  }`}
                >
                  Bags-only
                </button>
              </div>
            </div>
            {twitterFeedback && (
              <p className="rounded-2xl border border-emerald-500/40 bg-emerald-500/10 px-4 py-2 text-sm text-emerald-200">
                {twitterFeedback}
              </p>
            )}
            <TokenDeck
              tokens={deckTokens}
              onReject={(token) => {
                handlePressReject();
                setTwitterFeedback(`Skipped ${token.symbol}`);
              }}
              onTrade={handlePressTrade}
              isLoading={loading}
              emptyTitle={error ? "❌ Unable to load deck" : "Deck complete"}
            />
            {error && <p className="text-center text-sm text-rose-300">{error}</p>}
            <TradeControls />
            <BagHighlights bagTokens={bagTokens} />
          </>
        )}

        {activeTab === "trades" && <TradesPanel userId={userId} />}

        {activeTab === "wallet" && <WalletPanel walletAddress={walletAddress} />}
      </div>
      <TwitterConnectPrompt
        visible={twitterPrompt}
        loading={twitterLoading}
        error={twitterError}
        onConnect={handleTwitterConnect}
        onDismiss={() => setTwitterPrompt(false)}
      />
    </section>
  );
}
