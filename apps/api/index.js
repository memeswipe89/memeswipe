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
    change24hPct: 0,

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