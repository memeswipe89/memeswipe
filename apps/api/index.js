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

// Moralis: Pump.fun graduated tokens
const MORALIS_GRADUATED_URL =
  "https://solana-gateway.moralis.io/token/mainnet/exchange/pumpfun/graduated";

// Dexscreener: multiple token addresses at once (up to 30)
const DEXSCREENER_MULTI_TOKEN_URL =
  "https://api.dexscreener.com/tokens/v1/solana";

// Filters for Memeswipe feed
const MIN_LIQUIDITY_USD = 20000;
const MIN_VOLUME_24H_USD = 10000;
const MAX_RESULTS = 50;
const CACHE_TIME_MS = 20 * 1000;

let graduatedCache = null;
let graduatedCacheTime = 0;

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
    price: pair.priceUsd ? Number(pair.priceUsd) : null,

    liquidityUsd: pair.liquidity?.usd || 0,
    liquidity: pair.liquidity?.usd || 0,

    volume24h: pair.volume?.h24 || 0,
    volume: pair.volume?.h24 || 0,

    marketCap: pair.marketCap || null,
    mcap: pair.marketCap || null,

    fdv: pair.fdv || null,
    createdAt: pair.pairCreatedAt || null,

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

/*
==============================
MORALIS: GET GRADUATED TOKENS
==============================
*/

async function fetchGraduatedTokenAddresses() {
  if (!MORALIS_API_KEY) {
    throw new Error("Missing MORALIS_API_KEY");
  }

  const response = await fetch(MORALIS_GRADUATED_URL, {
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

  const addresses = rawItems.map(normalizeAddress).filter(Boolean);

  return [...new Set(addresses)];
}

/*
==============================
DEXSCREENER: ENRICH TOKENS
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

async function getGraduatedMemeswipeFeed() {
  const tokenAddresses = await fetchGraduatedTokenAddresses();

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
    const createdDiff = (b.createdAt || 0) - (a.createdAt || 0);
    if (createdDiff !== 0) return createdDiff;
    return (b.volume24h || 0) - (a.volume24h || 0);
  });

  return feed.slice(0, MAX_RESULTS);
}

async function getCachedGraduatedFeed() {
  const now = Date.now();

  if (graduatedCache && now - graduatedCacheTime < CACHE_TIME_MS) {
    return graduatedCache;
  }

  const feed = await getGraduatedMemeswipeFeed();
  graduatedCache = feed;
  graduatedCacheTime = now;

  return feed;
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

/*
Direct test route
*/
app.get("/tokens/graduated", async (req, res) => {
  try {
    console.log("Route hit: /tokens/graduated");

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

/*
Mobile app route
This should match what mobile is calling
*/
app.get("/api/feed/solana/graduated", async (req, res) => {
  try {
    console.log("Route hit: /api/feed/solana/graduated");

    const feed = await getCachedGraduatedFeed();
    printTokenNamesToTerminal(feed, "MOBILE GRADUATED FEED");

    return res.json({
      tokens: feed,
      nextCursor: null,
      hasMore: false,
      source: "graduated",
      chain: "solana",
    });
  } catch (error) {
    console.error("GET /api/feed/solana/graduated error:", error.message);

    return res.status(500).json({
      tokens: [],
      nextCursor: null,
      hasMore: false,
      error: "Failed to fetch graduated tokens",
      details: error.message,
    });
  }
});

/*
Optional fallback so other app segments don't crash
*/
app.get("/api/feed/:chain/:segment", async (req, res) => {
  const { chain, segment } = req.params;

  console.log(`Route hit: /api/feed/${chain}/${segment}`);

  if (chain === "solana" && segment === "graduated") {
    try {
      const feed = await getCachedGraduatedFeed();
      printTokenNamesToTerminal(feed, "FALLBACK GRADUATED FEED");

      return res.json({
        tokens: feed,
        nextCursor: null,
        hasMore: false,
        source: "graduated",
        chain: "solana",
      });
    } catch (error) {
      return res.status(500).json({
        tokens: [],
        nextCursor: null,
        hasMore: false,
        error: "Failed to fetch graduated tokens",
        details: error.message,
      });
    }
  }

  return res.json({
    tokens: [],
    nextCursor: null,
    hasMore: false,
    source: segment,
    chain,
  });
});

app.get("/token/:address", async (req, res) => {
  try {
    const { address } = req.params;

    const url = `${DEXSCREENER_MULTI_TOKEN_URL}/${address}`;
    const response = await fetch(url);

    if (!response.ok) {
      const text = await response.text();
      return res.status(500).json({
        error: "Failed to fetch token from Dexscreener",
        details: text,
      });
    }

    const data = await response.json();
    const pairs = Array.isArray(data) ? data : data.pairs || [];
    const bestPair = pickBestPairForToken(pairs);

    if (!bestPair) {
      return res.status(404).json({
        error: "No Solana pair found for this token",
      });
    }

    return res.json(formatPair(bestPair));
  } catch (error) {
    console.error("GET /token/:address error:", error.message);
    return res.status(500).json({
      error: "Failed to fetch token",
      details: error.message,
    });
  }
});

/*
==============================
START SERVER
==============================
*/

app.listen(PORT, () => {
  console.log(`🚀 Memeswipe API running on port ${PORT}`);
});