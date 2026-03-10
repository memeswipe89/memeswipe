const express = require("express");
const cors = require("cors");

require("dotenv").config();

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(express.json());

/*
==============================
CONFIG
==============================
*/

const MORALIS_API_KEY = process.env.MORALIS_API_KEY || "";

const MORALIS_GRADUATED_URL =
  "https://solana-gateway.moralis.io/token/mainnet/exchange/pumpfun/graduated";

const DEXSCREENER_MULTI_TOKEN_URL =
  "https://api.dexscreener.com/tokens/v1/solana";

// Make filters less strict so you get more than 2-4 tokens
const MIN_LIQUIDITY_USD = 8000;
const MIN_VOLUME_24H_USD = 2000;

// How many tokens the mobile app asks for per page
const DEFAULT_PAGE_LIMIT = 50;

// Cache
const CACHE_TIME_MS = 20 * 1000;

let graduatedCache = null;
let graduatedCacheTime = 0;

const SOL_PRICE_CACHE_TTL_MS = 30 * 1000;
let solPriceCache = null;
let solPriceCacheTime = 0;

const crypto = require("crypto");

// In-memory Twitter connection store and auth state (demo/dev).
const twitterConnections = new Map();
const twitterAuthStates = new Map();

/*
==============================
HELPERS
==============================
*/

function chunkArray(arr, size) {
  const chunks = [];
  for (let i = 0; i < arr.length; i += size) {
    chunks.push(arr.slice(i, i + size));
  }
  return chunks;
}

function normalizeAddress(item) {
  return (
    item?.tokenAddress ||
    item?.address ||
    item?.mint ||
    item?.token?.address ||
    item?.baseToken?.address ||
    null
  );
}

function formatPair(pair) {
  return {
    id: pair.baseToken?.address || pair.pairAddress || "",
    name: pair.baseToken?.name || "",
    symbol: pair.baseToken?.symbol || "",
    address: pair.baseToken?.address || "",

    priceUsd: pair.priceUsd ? Number(pair.priceUsd) : null,
    liquidityUsd: pair.liquidity?.usd || 0,
    volume24hUsd: pair.volume?.h24 || 0,
    marketCapUsd: pair.marketCap || null,
    change24hPct: pair.priceChange?.h24 || 0,

    chartData: [],
    graduatedAt: pair.pairCreatedAt || null,
    graduationTime: pair.pairCreatedAt
      ? new Date(pair.pairCreatedAt).toLocaleString()
      : "Live now",

    image: pair.info?.imageUrl || null,
    imageUrl: pair.info?.imageUrl || null,

    pairAddress: pair.pairAddress || "",
    dexId: pair.dexId || "",
    url: pair.url || "",

    chain: "solana",
    source: "graduated",
  };
}

function isGoodFeedPair(pair) {
  return (
    pair.chainId === "solana" &&
    (pair.liquidity?.usd || 0) >= MIN_LIQUIDITY_USD &&
    (pair.volume?.h24 || 0) >= MIN_VOLUME_24H_USD
  );
}

function pickBestPairForToken(pairs) {
  if (!Array.isArray(pairs) || pairs.length === 0) return null;

  const solanaPairs = pairs.filter((p) => p.chainId === "solana");
  if (solanaPairs.length === 0) return null;

  solanaPairs.sort((a, b) => {
    const liqDiff = (b.liquidity?.usd || 0) - (a.liquidity?.usd || 0);
    if (liqDiff !== 0) return liqDiff;
    return (b.volume?.h24 || 0) - (a.volume?.h24 || 0);
  });

  return solanaPairs[0];
}

function printTokenNamesToTerminal(tokens, label = "TOKENS") {
  console.log(`\n========== ${label} (${tokens.length}) ==========`);

  if (!Array.isArray(tokens) || tokens.length === 0) {
    console.log("No tokens returned.");
    console.log("====================================\n");
    return;
  }

  tokens.forEach((token, index) => {
    console.log(
      `${index + 1}. ${token.name || "Unknown"} (${token.symbol || "-"})`
    );
  });

  console.log("====================================\n");
}

function base64UrlEncode(input) {
  return input.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function sha256Base64Url(value) {
  const hash = crypto.createHash("sha256").update(value).digest("base64");
  return base64UrlEncode(hash);
}

function buildRedirectUrl(returnUrl, params) {
  const url = new URL(returnUrl);
  Object.entries(params).forEach(([key, value]) => {
    if (typeof value === "string") {
      url.searchParams.set(key, value);
    }
  });
  return url.toString();
}

/*
==============================
MORALIS
==============================
*/

async function fetchGraduatedTokenAddresses(limitWanted = 120) {
  if (!MORALIS_API_KEY) {
    throw new Error("Missing MORALIS_API_KEY");
  }

  let cursor = null;
  const addresses = [];
  let safety = 0;

  while (addresses.length < limitWanted && safety < 10) {
    const url = new URL(MORALIS_GRADUATED_URL);
    url.searchParams.set("limit", "100");
    if (cursor) {
      url.searchParams.set("cursor", cursor);
    }

    const response = await fetch(url.toString(), {
      method: "GET",
      headers: {
        "X-Api-Key": MORALIS_API_KEY,
        Accept: "application/json",
      },
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Moralis graduated API failed: ${response.status} ${text}`);
    }

    const data = await response.json();

    const rawItems = Array.isArray(data)
      ? data
      : Array.isArray(data.result)
      ? data.result
      : Array.isArray(data.tokens)
      ? data.tokens
      : [];

    const pageAddresses = rawItems.map(normalizeAddress).filter(Boolean);
    addresses.push(...pageAddresses);

    cursor = data.cursor || null;
    if (!cursor) break;

    safety += 1;
  }

  return [...new Set(addresses)].slice(0, limitWanted);
}

/*
==============================
DEXSCREENER
==============================
*/

async function fetchDexscreenerPairsForAddresses(addresses) {
  const chunks = chunkArray(addresses, 30);
  const allPairs = [];

  for (const group of chunks) {
    const url = `${DEXSCREENER_MULTI_TOKEN_URL}/${group.join(",")}`;
    const response = await fetch(url);

    if (!response.ok) {
      const text = await response.text();
      throw new Error(
        `Dexscreener multi-token API failed: ${response.status} ${text}`
      );
    }

    const data = await response.json();

    if (Array.isArray(data)) {
      allPairs.push(...data);
    } else if (Array.isArray(data.pairs)) {
      allPairs.push(...data.pairs);
    }
  }

  return allPairs;
}

async function buildGraduatedFeed() {
  const tokenAddresses = await fetchGraduatedTokenAddresses(180);

  if (!tokenAddresses.length) {
    return [];
  }

  const pairs = await fetchDexscreenerPairsForAddresses(tokenAddresses);

  const byToken = new Map();

  for (const pair of pairs) {
    const tokenAddress = pair?.baseToken?.address;
    if (!tokenAddress) continue;

    if (!byToken.has(tokenAddress)) {
      byToken.set(tokenAddress, []);
    }
    byToken.get(tokenAddress).push(pair);
  }

  const feed = [];

  for (const [, tokenPairs] of byToken.entries()) {
    const bestPair = pickBestPairForToken(tokenPairs);
    if (!bestPair) continue;
    if (!isGoodFeedPair(bestPair)) continue;

    feed.push(formatPair(bestPair));
  }

  feed.sort((a, b) => {
    const createdA = new Date(a.graduatedAt || 0).getTime() || 0;
    const createdB = new Date(b.graduatedAt || 0).getTime() || 0;
    if (createdB !== createdA) return createdB - createdA;
    return (b.volume24hUsd || 0) - (a.volume24hUsd || 0);
  });

  return feed;
}

async function getCachedGraduatedFeed() {
  const now = Date.now();

  if (graduatedCache && now - graduatedCacheTime < CACHE_TIME_MS) {
    return graduatedCache;
  }

  const feed = await buildGraduatedFeed();
  graduatedCache = feed;
  graduatedCacheTime = now;

  return feed;
}

async function fetchJupiterSolPrice(jupApiKey) {
  const solMint = "So11111111111111111111111111111111111111112";
  if (!jupApiKey) {
    return { ok: false, error: "missing_api_key" };
  }
  try {
    const jupRes = await fetch(`https://api.jup.ag/price/v3?ids=${solMint}`, {
      method: "GET",
      headers: { "x-api-key": jupApiKey },
    });
    const jupJson = await jupRes.json();
    const price =
      Number(jupJson?.data?.[solMint]?.price) ||
      Number(jupJson?.[solMint]?.usdPrice) ||
      Number(jupJson?.data?.[solMint]?.usdPrice) ||
      0;
    if (jupRes.ok && Number.isFinite(price) && price > 0) {
      return { ok: true, price };
    }
    return {
      ok: false,
      error: jupJson?.error || jupJson?.message || "invalid_response",
      status: jupRes.status,
    };
  } catch (error) {
    return { ok: false, error: error.message || "jupiter_fetch_failed" };
  }
}

async function fetchJupiterQuoteSolPrice() {
  const solMint = "So11111111111111111111111111111111111111112";
  const usdcMint = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
  const amountLamports = 1_000_000_000; // 1 SOL

  try {
    const quoteUrl = new URL("https://quote-api.jup.ag/v6/quote");
    quoteUrl.searchParams.set("inputMint", solMint);
    quoteUrl.searchParams.set("outputMint", usdcMint);
    quoteUrl.searchParams.set("amount", String(amountLamports));
    quoteUrl.searchParams.set("slippageBps", "50");

    const quoteRes = await fetch(quoteUrl.toString(), { method: "GET" });
    const quoteJson = await quoteRes.json();
    const outAmountRaw = Number(quoteJson?.outAmount || 0);
    if (!quoteRes.ok || !Number.isFinite(outAmountRaw) || outAmountRaw <= 0) {
      return {
        ok: false,
        error: quoteJson?.error || "quote_failed",
        status: quoteRes.status,
      };
    }

    const price = outAmountRaw / 1_000_000; // USDC has 6 decimals
    if (!Number.isFinite(price) || price <= 0) {
      return { ok: false, error: "invalid_quote_price" };
    }

    return { ok: true, price };
  } catch (error) {
    return { ok: false, error: error.message || "quote_fetch_failed" };
  }
}

async function fetchCoinGeckoSolPrice() {
  const response = await fetch(
    "https://api.coingecko.com/api/v3/simple/price?ids=solana&vs_currencies=usd",
    { method: "GET" }
  );
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`SOL price fetch failed: ${response.status} ${text}`);
  }
  const json = JSON.parse(text);
  const price = Number(json?.solana?.usd || 0);
  if (!Number.isFinite(price) || price <= 0) {
    throw new Error("Invalid SOL price response");
  }
  return price;
}

async function fetchSolPriceUsd() {
  const now = Date.now();
  if (solPriceCache && now - solPriceCacheTime < SOL_PRICE_CACHE_TTL_MS) {
    return { price: solPriceCache, source: "cache" };
  }

  const jupApiKey =
    process.env.JUP_API_KEY ||
    process.env.JUPITER_API_KEY ||
    process.env.jup_api_key ||
    process.env.jupiter_api_key ||
    "";
  try {
    const jupResult = await fetchJupiterSolPrice(jupApiKey);
    if (jupResult.ok) {
      solPriceCache = jupResult.price;
      solPriceCacheTime = now;
      return { price: jupResult.price, source: "jupiter" };
    }
    const quoteResult = await fetchJupiterQuoteSolPrice();
    if (quoteResult.ok) {
      solPriceCache = quoteResult.price;
      solPriceCacheTime = now;
      return { price: quoteResult.price, source: "jupiter-quote" };
    }
    const price = await fetchCoinGeckoSolPrice();
    solPriceCache = price;
    solPriceCacheTime = now;
    return { price, source: "coingecko" };
  } catch (error) {
    if (solPriceCache) {
      return { price: solPriceCache, source: "cache" };
    }
    throw error;
  }
}

/*
==============================
ROUTES
==============================
*/

app.get("/health", (req, res) => {
  res.json({
    status: "ok",
    service: "memeswipe-api",
    hasMoralisKey: Boolean(MORALIS_API_KEY),
  });
});

app.get("/api/feed/solana/graduated", async (req, res) => {
  try {
    console.log("Route hit: /api/feed/solana/graduated");

    const limit = Math.max(
      1,
      Math.min(Number(req.query.limit) || DEFAULT_PAGE_LIMIT, 100)
    );
    const cursor = req.query.cursor ? Number(req.query.cursor) : 0;

    const fullFeed = await getCachedGraduatedFeed();
    const start = Number.isFinite(cursor) ? cursor : 0;
    const end = start + limit;

    const pageTokens = fullFeed.slice(start, end);
    const nextCursor = end < fullFeed.length ? String(end) : null;

    printTokenNamesToTerminal(pageTokens, "MOBILE GRADUATED FEED PAGE");

    return res.json({
      tokens: pageTokens,
      cursor: nextCursor,
    });
  } catch (error) {
    console.error("GET /api/feed/solana/graduated error:", error.message);

    return res.status(500).json({
      tokens: [],
      cursor: null,
      error: "Failed to fetch graduated tokens",
      details: error.message,
    });
  }
});

app.get("/api/solana/price-usd", async (req, res) => {
  try {
    const now = Date.now();
    const jupApiKey =
      process.env.JUP_API_KEY ||
      process.env.JUPITER_API_KEY ||
      process.env.jup_api_key ||
      process.env.jupiter_api_key ||
      "";

    const jupResult = await fetchJupiterSolPrice(jupApiKey);
    if (jupResult.ok) {
      solPriceCache = jupResult.price;
      solPriceCacheTime = now;
      return res.json({ priceUsd: jupResult.price, source: "jupiter" });
    }

    const quoteResult = await fetchJupiterQuoteSolPrice();
    if (quoteResult.ok) {
      solPriceCache = quoteResult.price;
      solPriceCacheTime = now;
      return res.json({ priceUsd: quoteResult.price, source: "jupiter-quote" });
    }

    const price = await fetchCoinGeckoSolPrice();
    solPriceCache = price;
    solPriceCacheTime = now;
    return res.json({
      priceUsd: price,
      source: "coingecko",
      debug: {
        jupiter: { ok: false, error: jupResult.error, status: jupResult.status || null },
        jupiterQuote: { ok: false, error: quoteResult.error, status: quoteResult.status || null },
        hasJupKey: Boolean(jupApiKey),
      },
    });
  } catch (error) {
    console.error("GET /api/solana/price-usd error:", error.message);
    return res.status(500).json({
      error: "Failed to fetch SOL price",
      details: error.message,
      debug: {
        hasJupKey: Boolean(
          process.env.JUP_API_KEY ||
            process.env.JUPITER_API_KEY ||
            process.env.jup_api_key ||
            process.env.jupiter_api_key
        ),
        note: "Use /api/solana/price-debug for upstream diagnostics.",
      },
    });
  }
});

app.get("/api/solana/price-debug", async (req, res) => {
  const jupApiKey =
    process.env.JUP_API_KEY ||
    process.env.JUPITER_API_KEY ||
    process.env.jup_api_key ||
    process.env.jupiter_api_key ||
    "";
  const [jupiter, jupiterQuote] = await Promise.all([
    fetchJupiterSolPrice(jupApiKey),
    fetchJupiterQuoteSolPrice(),
  ]);
  return res.json({
    hasJupKey: Boolean(jupApiKey),
    jupiter,
    jupiterQuote,
  });
});

app.post("/api/jupiter/swap", async (req, res) => {
  try {
    const {
      inputMint,
      outputMint,
      userPublicKey,
      amountUsd,
      slippageBps = 100,
    } = req.body || {};

    if (!inputMint || !outputMint || !userPublicKey) {
      return res.status(400).json({ error: "Missing swap parameters" });
    }

    const usdAmount = Number(amountUsd || 0);
    if (!Number.isFinite(usdAmount) || usdAmount <= 0) {
      return res.status(400).json({ error: "Invalid amountUsd" });
    }

    const { price: solPriceUsd } = await fetchSolPriceUsd();
    const amountSol = usdAmount / solPriceUsd;
    const amountLamports = Math.max(1, Math.floor(amountSol * 1_000_000_000));

    const quoteUrl = new URL("https://quote-api.jup.ag/v6/quote");
    quoteUrl.searchParams.set("inputMint", inputMint);
    quoteUrl.searchParams.set("outputMint", outputMint);
    quoteUrl.searchParams.set("amount", String(amountLamports));
    quoteUrl.searchParams.set("slippageBps", String(slippageBps));

    const quoteRes = await fetch(quoteUrl.toString(), { method: "GET" });
    const quoteJson = await quoteRes.json();
    if (!quoteRes.ok || !quoteJson) {
      return res.status(500).json({
        error: "Jupiter quote failed",
        details: quoteJson?.error || "Unknown error",
      });
    }

    const swapRes = await fetch("https://quote-api.jup.ag/v6/swap", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        quoteResponse: quoteJson,
        userPublicKey,
        wrapAndUnwrapSol: true,
        dynamicComputeUnitLimit: true,
        prioritizationFeeLamports: "auto",
      }),
    });
    const swapJson = await swapRes.json();
    if (!swapRes.ok || !swapJson?.swapTransaction) {
      return res.status(500).json({
        error: "Jupiter swap failed",
        details: swapJson?.error || "Missing swap transaction",
      });
    }

    return res.json({
      swapTransaction: swapJson.swapTransaction,
      quote: {
        inAmount: quoteJson?.inAmount,
        outAmount: quoteJson?.outAmount,
        inputMint: quoteJson?.inputMint,
        outputMint: quoteJson?.outputMint,
      },
    });
  } catch (error) {
    console.error("POST /api/jupiter/swap error:", error.message);
    return res.status(500).json({ error: "Failed to build swap", details: error.message });
  }
});

app.get("/api/twitter/connection/:userId", (req, res) => {
  const userId = String(req.params.userId || "").trim();
  if (!userId) {
    return res.status(400).json({ error: "Missing userId" });
  }

  const profile = twitterConnections.get(userId);
  if (!profile) {
    return res.status(404).json({ connected: false });
  }

  return res.json({
    connected: true,
    twitterUsername: profile.twitterUsername,
    twitterUserId: profile.twitterUserId,
  });
});

app.delete("/api/twitter/connection/:userId", (req, res) => {
  const userId = String(req.params.userId || "").trim();
  if (!userId) {
    return res.status(400).json({ error: "Missing userId" });
  }

  twitterConnections.delete(userId);
  return res.json({ ok: true });
});

app.get("/api/twitter/auth/start", (req, res) => {
  const userId = String(req.query.userId || "").trim();
  const returnUrl = String(req.query.returnUrl || "").trim();
  const clientId = process.env.TWITTER_CLIENT_ID || "";
  const callbackUrl = process.env.TWITTER_CALLBACK_URL || "";

  if (!clientId || !callbackUrl) {
    return res.status(500).json({ error: "Twitter auth not configured on server" });
  }
  if (!userId) {
    return res.status(400).json({ error: "Missing userId" });
  }
  if (!returnUrl) {
    return res.status(400).json({ error: "Missing returnUrl" });
  }

  let parsedReturn;
  try {
    parsedReturn = new URL(returnUrl);
  } catch {
    return res.status(400).json({ error: "Invalid returnUrl" });
  }

  const state = crypto.randomBytes(16).toString("hex");
  const codeVerifier = base64UrlEncode(crypto.randomBytes(32).toString("base64"));
  const codeChallenge = sha256Base64Url(codeVerifier);

  twitterAuthStates.set(state, {
    userId,
    returnUrl: parsedReturn.toString(),
    codeVerifier,
    createdAt: Date.now(),
  });

  const authUrl = new URL("https://twitter.com/i/oauth2/authorize");
  authUrl.searchParams.set("response_type", "code");
  authUrl.searchParams.set("client_id", clientId);
  authUrl.searchParams.set("redirect_uri", callbackUrl);
  authUrl.searchParams.set("scope", "users.read tweet.read offline.access");
  authUrl.searchParams.set("state", state);
  authUrl.searchParams.set("code_challenge", codeChallenge);
  authUrl.searchParams.set("code_challenge_method", "S256");

  return res.json({ authUrl: authUrl.toString() });
});

app.get("/api/twitter/auth/callback", async (req, res) => {
  const code = String(req.query.code || "");
  const state = String(req.query.state || "");
  const error = String(req.query.error || "");

  const stored = twitterAuthStates.get(state);
  if (!stored) {
    return res.status(400).send("Invalid or expired OAuth state");
  }

  if (error) {
    const redirectUrl = buildRedirectUrl(stored.returnUrl, {
      status: "error",
      error,
    });
    twitterAuthStates.delete(state);
    return res.redirect(redirectUrl);
  }

  if (!code) {
    const redirectUrl = buildRedirectUrl(stored.returnUrl, {
      status: "error",
      error: "missing_code",
      reason: "Missing authorization code",
    });
    twitterAuthStates.delete(state);
    return res.redirect(redirectUrl);
  }

  const clientId = process.env.TWITTER_CLIENT_ID || "";
  const clientSecret = process.env.TWITTER_CLIENT_SECRET || "";
  const callbackUrl = process.env.TWITTER_CALLBACK_URL || "";

  if (!clientId || !clientSecret || !callbackUrl) {
    const redirectUrl = buildRedirectUrl(stored.returnUrl, {
      status: "error",
      error: "server_not_configured",
      reason: "Twitter auth not configured on server",
    });
    twitterAuthStates.delete(state);
    return res.redirect(redirectUrl);
  }

  try {
    const tokenRes = await fetch("https://api.twitter.com/2/oauth2/token", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`,
      },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        client_id: clientId,
        code,
        redirect_uri: callbackUrl,
        code_verifier: stored.codeVerifier,
      }).toString(),
    });

    const tokenJson = await tokenRes.json();
    if (!tokenRes.ok || !tokenJson?.access_token) {
      const redirectUrl = buildRedirectUrl(stored.returnUrl, {
        status: "error",
        error: "token_exchange_failed",
        reason: tokenJson?.error_description || "Failed to exchange token",
      });
      twitterAuthStates.delete(state);
      return res.redirect(redirectUrl);
    }

    const meRes = await fetch("https://api.twitter.com/2/users/me", {
      headers: {
        Authorization: `Bearer ${tokenJson.access_token}`,
      },
    });
    const meJson = await meRes.json();
    if (!meRes.ok || !meJson?.data?.id || !meJson?.data?.username) {
      const redirectUrl = buildRedirectUrl(stored.returnUrl, {
        status: "error",
        error: "profile_fetch_failed",
        reason: "Unable to load Twitter profile",
      });
      twitterAuthStates.delete(state);
      return res.redirect(redirectUrl);
    }

    const profile = {
      connected: true,
      twitterUsername: meJson.data.username,
      twitterUserId: meJson.data.id,
      connectedAt: new Date().toISOString(),
    };
    twitterConnections.set(stored.userId, profile);

    const redirectUrl = buildRedirectUrl(stored.returnUrl, {
      status: "success",
      userId: stored.userId,
      twitterUsername: profile.twitterUsername,
      twitterUserId: profile.twitterUserId,
    });
    twitterAuthStates.delete(state);
    return res.redirect(redirectUrl);
  } catch (err) {
    const redirectUrl = buildRedirectUrl(stored.returnUrl, {
      status: "error",
      error: "exception",
      reason: "Unexpected server error",
    });
    twitterAuthStates.delete(state);
    return res.redirect(redirectUrl);
  }
});

app.get("/tokens/graduated", async (req, res) => {
  try {
    const feed = await getCachedGraduatedFeed();
    printTokenNamesToTerminal(feed, "DIRECT GRADUATED FEED");
    return res.json(feed);
  } catch (error) {
    console.error("GET /tokens/graduated error:", error.message);
    return res.status(500).json({
      error: "Failed to fetch graduated tokens",
      details: error.message,
    });
  }
});

app.listen(PORT, () => {
  console.log(`🚀 Memeswipe API running on port ${PORT}`);
});
