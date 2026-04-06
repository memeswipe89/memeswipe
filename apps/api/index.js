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
const DEXSCREENER_LATEST_URL = "https://api.dexscreener.com/token-profiles/latest/v1";
const BIRDEYE_URL = "https://public-api.birdeye.so/defi/v3/token/list";
const BAGS_FEED_URL = "https://public-api-v2.bags.fm/api/v1/token-launch/feed";
const BAGS_API_KEY = process.env.BAGS_API_KEY || "";
const BAGS_FEED_TOKEN_LIMIT = Number(process.env.BAGS_FEED_TOKEN_LIMIT || 400);

// Make filters less strict so you get more than 2-4 tokens
// How many tokens the mobile app asks for per page
const DEFAULT_PAGE_LIMIT = 100;
// Multi-source feed config
const MIN_LIQUIDITY_USD = Number(process.env.MIN_LIQUIDITY_USD || 10_000);
const MIN_VOLUME_USD = Number(process.env.MIN_VOLUME_USD || 2_000);
const FALLBACK_MIN_LIQUIDITY_USD = Number(process.env.FALLBACK_MIN_LIQUIDITY_USD || 5_000);
const FALLBACK_MIN_VOLUME_USD = Number(process.env.FALLBACK_MIN_VOLUME_USD || 2_000);
const LENIENT_MIN_LIQUIDITY_USD = Number(process.env.LENIENT_MIN_LIQUIDITY_USD || 5_000);
const LENIENT_MIN_VOLUME_USD = Number(process.env.LENIENT_MIN_VOLUME_USD || 2_000);
const MAX_TOKEN_AGE_HOURS = Number(process.env.MAX_TOKEN_AGE_HOURS || 72);
const GRADUATED_ADDRESS_FETCH_LIMIT = 400;
const MAX_GRADUATED_FEED_TOKENS = 400;
const BIRDEYE_API_KEY = process.env.BIRDEYE_API_KEY || "";
const FEED_SOURCE_ORDER = ["pumpfun", "bags", "birdeye", "dexscreener"];
const MIN_BAGS_VISIBLE = 50;

// Cache
const CACHE_TIME_MS = 20 * 1000;

let graduatedCache = null;
let graduatedCacheTime = 0;
let graduatedLastGoodFeed = null;

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || "";
const SUPABASE_SERVICE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_ANON_KEY || "";
const SUPABASE_HOST = (() => {
  try {
    return SUPABASE_URL ? new URL(SUPABASE_URL).host : "";
  } catch {
    return "";
  }
})();

async function supabaseRequest(path, options = {}) {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
    throw new Error("Supabase credentials missing");
  }
  const url = `${SUPABASE_URL.replace(/\/$/, "")}/rest/v1/${path.replace(/^\//, "")}`;
  const headers = {
    apikey: SUPABASE_SERVICE_KEY,
    Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
    "Content-Type": "application/json",
    ...options.headers,
  };
  const res = await fetch(url, { ...options, headers });
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }
  return { res, json, text };
}

const SOL_PRICE_CACHE_TTL_MS = 30 * 1000;
let solPriceCache = null;
let solPriceCacheTime = 0;

const crypto = require("crypto");

// In-memory Twitter connection store and auth state (demo/dev).
const twitterConnections = new Map();
const twitterAuthStates = new Map();
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

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

function formatPair(pair, options = {}) {
  const { source = "graduated", tradeRoute = "jupiter" } = options;
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
    createdAt: pair.pairCreatedAt
      ? new Date(pair.pairCreatedAt).toISOString()
      : null,

    image: pair.info?.imageUrl || null,
    imageUrl: pair.info?.imageUrl || null,

    pairAddress: pair.pairAddress || "",
    dexId: pair.dexId || "",
    url: pair.url || "",

    chain: "solana",
    source,
    tradeRoute,
  };
}

function isGoodFeedPair(pair) {
  return (
    pair.chainId === "solana" &&
    (pair.liquidity?.usd || 0) >= MIN_LIQUIDITY_USD &&
    (pair.volume?.h24 || 0) >= MIN_VOLUME_USD
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

function compareNormalizedTokens(a, b) {
  const liquidityA = Number(a.liquidityUsd || 0);
  const liquidityB = Number(b.liquidityUsd || 0);
  if (liquidityB !== liquidityA) return liquidityB - liquidityA;

  const volumeA = Number(a.volume24hUsd || 0);
  const volumeB = Number(b.volume24hUsd || 0);
  if (volumeB !== volumeA) return volumeB - volumeA;

  const timeA =
    new Date(a.createdAt || a.graduatedAt || 0).getTime() || 0;
  const timeB =
    new Date(b.createdAt || b.graduatedAt || 0).getTime() || 0;
  if (timeB !== timeA) return timeB - timeA;

  return (a.name || "").localeCompare(b.name || "");
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

const MAX_TOKEN_AGE_MS = MAX_TOKEN_AGE_HOURS * 60 * 60 * 1000;

function safeNumber(value) {
  const num = typeof value === "number" ? value : Number(value);
  return Number.isFinite(num) ? num : null;
}

function deriveOrderAmountUsd({ amountUsd, inAmountRaw, priceUsd }) {
  const primary = safeNumber(amountUsd) || 0;
  if (primary > 0) return primary;
  const raw = safeNumber(inAmountRaw) || 0;
  const price = safeNumber(priceUsd) || 0;
  if (raw <= 0 || price <= 0) return 0;
  const tokenAmount = raw / 1_000_000_000;
  return tokenAmount * price;
}

async function ensureSupabaseUserRow(userId) {
  if (!userId) return;

  try {
    const { res, json } = await supabaseRequest(
      `users?id=eq.${encodeURIComponent(userId)}&select=id`,
      { method: "GET" }
    );
    if (res.ok && Array.isArray(json) && json.length > 0) return;

    const { res: insertRes, text } = await supabaseRequest("users", {
      method: "POST",
      headers: { Prefer: "return=representation" },
      body: JSON.stringify({
        id: userId,
        created_at: new Date().toISOString(),
      }),
    });

    if (!insertRes.ok) {
      console.error("USER INSERT FAILED:", text);
    }
  } catch (error) {
    console.error("Failed to ensure Supabase user row:", error?.message || error);
  }
}

async function resolveUserId(inputId) {
  const normalized = String(inputId || "").trim();
  if (!normalized) {
    console.log("Resolved userId: null (empty input)");
    return null;
  }

  if (UUID_RE.test(normalized)) {
    console.log("Resolved userId:", normalized, "from input:", inputId);
    return normalized;
  }

  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
    console.log("Resolved userId: null (Supabase disabled) from input:", inputId);
    return null;
  }

  try {
    const { res, json } = await supabaseRequest(
      `user_wallets?privy_user_id=eq.${encodeURIComponent(normalized)}&select=user_id`,
      { method: "GET" }
    );
    if (res.ok && Array.isArray(json) && json.length > 0) {
      const resolved = json[0]?.user_id;
      console.log("Resolved userId:", resolved, "from privy id:", normalized);
      return resolved;
    }
  } catch (error) {
    console.error("resolveUserId error:", error?.message || error);
  }

  console.log("Resolved userId: null (not found) from input:", inputId);
  return null;
}

function normalizeTimestamp(value) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return new Date(value * 1000).toISOString();
  }
  if (typeof value === "string" && value.trim()) {
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.getTime())) {
      return parsed.toISOString();
    }
  }
  return null;
}

function formatDollar(value) {
  if (!Number.isFinite(value) || value === null || value === undefined) return "N/A";
  return `$${value.toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
}

const BAGS_STATUS_PATTERNS = ["TRADE", "GRAD", "LIVE"];

function isBagsStatusTradable(status) {
  if (!status) return false;
  const normalized = String(status).toUpperCase();
  return BAGS_STATUS_PATTERNS.some((pattern) => normalized.includes(pattern));
}

function logBagsAccepted(token, liquidityUsd) {
  const label = token?.name || token?.symbol || token?.mint || "Unknown";
  const symbol = token?.symbol ? ` (${token.symbol})` : "";
  console.log(
    `[BAGS][ACCEPTED] ${label}${symbol} - liquidity: ${formatDollar(liquidityUsd)} - address: ${token?.mint || "n/a"}`
  );
}

function logBagsRejected(token, reason) {
  const label = token?.name || token?.symbol || token?.mint || "Unknown";
  console.log(`[BAGS][REJECTED] ${label} - ${reason}`);
}

function logBagsNotTradable(token, reason) {
  const label = token?.name || token?.symbol || token?.mint || "Unknown";
  const symbol = token?.symbol ? ` (${token.symbol})` : "";
  console.log(`[BAGS][NOT_TRADABLE] ${label}${symbol} - ${reason}`);
}

function getStrictTradabilityReason(token) {
  if (!token?.address) return "missing address";
  const liquidity = Number(token.liquidityUsd || 0);
  if (!Number.isFinite(liquidity) || liquidity <= 0) return "low liquidity";
  if (liquidity < MIN_LIQUIDITY_USD) return "low liquidity";
  const volume = Number(token.volume24hUsd || 0);
  if (!Number.isFinite(volume) || volume <= 0) return "low volume";
  if (volume < MIN_VOLUME_USD) return "low volume";
  const price = Number(token.priceUsd || 0);
  if (!Number.isFinite(price) || price <= 0) return "invalid price";
  return null;
}

function ensureTokenSource(token) {
  if (!token) return token;
  const normalized = { ...token };
  if (!normalized.source) normalized.source = "graduated";
  if (!normalized.tradeRoute) normalized.tradeRoute = "jupiter";
  return normalized;
}

function applySourceDefaults(tokens) {
  if (!Array.isArray(tokens)) return [];
  return tokens.map(ensureTokenSource);
}

function logFinalFeedTokens(tokens, limit = 10) {
  if (!Array.isArray(tokens) || tokens.length === 0) return;
  const sampleCount = Math.min(tokens.length, limit);
  for (let i = 0; i < sampleCount; i++) {
    const token = tokens[i];
    if (!token) continue;
    console.log(
      `[FINAL FEED] ${token.symbol || "unknown"} - ${token.source || "n/a"} - ${token.tradeRoute ||
        "n/a"} - ${formatDollar(token.liquidityUsd)}`
    );
  }
}

function logFeedSourceBreakdown(tokens) {
  if (!Array.isArray(tokens)) return;
  const counts = tokens.reduce((acc, token) => {
    const key = (token?.source || "unknown").toLowerCase();
    if (!acc[key]) acc[key] = 0;
    acc[key] += 1;
    return acc;
  }, {});
  const segments = FEED_SOURCE_ORDER.map((key) => `${key}=${counts[key] || 0}`);
  const otherCount = Object.entries(counts).reduce((acc, [key, value]) => {
    if (!FEED_SOURCE_ORDER.includes(key)) {
      acc += value;
    }
    return acc;
  }, 0);
  if (otherCount > 0) {
    segments.push(`other=${otherCount}`);
  }
  console.log(`[FEED BREAKDOWN] ${segments.join(" | ")}`);
}

function ensureMinimumBagTokens(feed, bagTokens) {
  if (!Array.isArray(bagTokens) || bagTokens.length === 0) return feed;
  const bagCount = feed.filter((token) => token.source === "bags").length;
  if (bagCount >= MIN_BAGS_VISIBLE) return feed;
  const needed = MIN_BAGS_VISIBLE - bagCount;
  const seen = new Set(
    feed
      .map((token) => (token.address ? token.address.toLowerCase() : null))
      .filter(Boolean)
  );
  const extras = [];
  for (const token of bagTokens) {
    if (extras.length >= needed) break;
    const address = token.address?.toLowerCase();
    if (!address || seen.has(address)) continue;
    extras.push(token);
    seen.add(address);
  }
  if (extras.length > 0) {
    console.log(
      `[BAGS][FEED_FILL] added ${extras.length} extra bag token${extras.length === 1 ? '' : 's'} to reach minimum ${MIN_BAGS_VISIBLE}`
    );
  }
  return extras.length > 0 ? feed.concat(extras) : feed;
}

function logTokensBySource(source, tokens, tier) {
  const label = source.toUpperCase();
  const prefix = tier ? `${label}-${tier.toUpperCase()}` : label;
  if (!tokens.length) {
    console.log(`[${prefix}] no tokens`);
    return;
  }
  tokens.forEach((token) => {
    console.log(
      `[${prefix}] ${token.name || "Unknown"} (${token.symbol || "-"}) - liquidity: ${formatDollar(
        token.liquidityUsd
      )} - address: ${token.address || "n/a"}`
    );
  });
}

function isTokenFresh(token) {
  if (!token.address) return false;
  if (MAX_TOKEN_AGE_MS > 0 && token.createdAt) {
    const age = Date.now() - new Date(token.createdAt).getTime();
    if (age > MAX_TOKEN_AGE_MS) return false;
  }
  return true;
}

function passesPreferredFilters(token) {
  if (!token.address) return false;
  const liquidity = safeNumber(token.liquidityUsd) || 0;
  const volume = safeNumber(token.volume24hUsd) || 0;
  if (liquidity < MIN_LIQUIDITY_USD) return false;
  if (volume < MIN_VOLUME_USD) return false;
  return isTokenFresh(token);
}

function passesFallbackFilters(token) {
  if (!token.address) return false;
  const liquidity = safeNumber(token.liquidityUsd) || 0;
  const volume = safeNumber(token.volume24hUsd) || 0;
  if (liquidity < FALLBACK_MIN_LIQUIDITY_USD) return false;
  if (volume < FALLBACK_MIN_VOLUME_USD) return false;
  return isTokenFresh(token);
}

function passesLenientFilters(token) {
  if (!token.address) return false;
  const liquidity = safeNumber(token.liquidityUsd) || 0;
  const volume = safeNumber(token.volume24hUsd) || 0;
  if (liquidity < LENIENT_MIN_LIQUIDITY_USD) return false;
  if (volume < LENIENT_MIN_VOLUME_USD) return false;
  return isTokenFresh(token);
}

function mergeTokensByAddress(tokens) {
  const seen = new Map();
  for (const token of tokens) {
    if (typeof token.address !== "string") continue;
    const address = token.address.toLowerCase();
    if (!address) continue;
    if (!seen.has(address)) {
      seen.set(address, token);
      continue;
    }
    const existing = seen.get(address);
    const comparison = compareNormalizedTokens(token, existing);
    if (comparison < 0) {
      seen.set(address, token);
    }
  }
  const merged = Array.from(seen.values());
  merged.sort(compareNormalizedTokens);
  return merged.slice(0, MAX_GRADUATED_FEED_TOKENS);
}

function buildBalancedFeed(sourceMap) {
  const limit = MAX_GRADUATED_FEED_TOKENS;
  const pointers = FEED_SOURCE_ORDER.reduce((acc, key) => {
    acc[key] = 0;
    return acc;
  }, {});
  const result = [];

  const hasRemaining = () =>
    FEED_SOURCE_ORDER.some((key) => {
      const list = sourceMap[key] || [];
      return pointers[key] < list.length;
    });

  let cycle = 0;
  while (result.length < limit && hasRemaining()) {
    const sourceKey = FEED_SOURCE_ORDER[cycle % FEED_SOURCE_ORDER.length];
    cycle += 1;
    const list = sourceMap[sourceKey] || [];
    const idx = pointers[sourceKey];
    if (idx < list.length) {
      result.push(list[idx]);
      pointers[sourceKey] += 1;
    }
  }

  for (const key of FEED_SOURCE_ORDER) {
    const list = sourceMap[key] || [];
    let idx = pointers[key];
    while (result.length < limit && idx < list.length) {
      result.push(list[idx]);
      idx += 1;
    }
  }

  return result.slice(0, limit);
}

function base64UrlEncode(input) {
  return input.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function resolveTwitterConnection(userId) {
  const resolvedUserId = await resolveUserId(userId);
  const lookupId = resolvedUserId || String(userId || "").trim();
  if (!lookupId) return null;

  // Prefer Supabase when configured.
  if (SUPABASE_URL && SUPABASE_SERVICE_KEY) {
    try {
      const { res: twitterRes, json: twitterJson } = await supabaseRequest(
        `twitter_connections?user_id=eq.${encodeURIComponent(lookupId)}&select=user_id,twitter_user_id,twitter_username`,
        { method: "GET" }
      );
      if (twitterRes.ok && Array.isArray(twitterJson) && twitterJson.length > 0) {
        const row = twitterJson[0];
        return {
          twitterUserId: row.twitter_user_id,
          twitterUsername: row.twitter_username,
        };
      }
    } catch (error) {
      console.error("resolveTwitterConnection supabase error:", error.message);
    }
  }

  // Fallback to in-memory map (dev/demo).
  const profile = twitterConnections.get(lookupId);
  if (!profile) return null;
  return {
    twitterUserId: profile.twitterUserId,
    twitterUsername: profile.twitterUsername,
  };
}

async function saveTwitterConnection(userId, twitterUserId, twitterUsername) {
  const normalized = String(userId || "").trim();
  if (!normalized) return;

  // Prefer Supabase when configured.
  if (SUPABASE_URL && SUPABASE_SERVICE_KEY) {
    try {
      const payload = {
        user_id: normalized,
        twitter_user_id: twitterUserId,
        twitter_username: twitterUsername,
        connected_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };

      // Try update by user_id first
      const { res: byUserRes, json: byUserJson } = await supabaseRequest(
        `twitter_connections?user_id=eq.${encodeURIComponent(normalized)}&select=user_id`,
        { method: "GET" }
      );

      let target = "twitter_connections";
      let method = "POST";
      let body = payload;

      if (byUserRes.ok && Array.isArray(byUserJson) && byUserJson.length > 0) {
        target = `twitter_connections?user_id=eq.${encodeURIComponent(normalized)}`;
        method = "PATCH";
        body = { ...payload, twitter_user_id: undefined };
      } else {
        const { res: byTwitterRes, json: byTwitterJson } = await supabaseRequest(
          `twitter_connections?twitter_user_id=eq.${encodeURIComponent(twitterUserId)}&select=user_id`,
          { method: "GET" }
        );
        if (byTwitterRes.ok && Array.isArray(byTwitterJson) && byTwitterJson.length > 0) {
          target = `twitter_connections?twitter_user_id=eq.${encodeURIComponent(twitterUserId)}`;
          method = "PATCH";
          body = { ...payload, twitter_user_id: undefined };
        }
      }

      const { res: upsertRes, text: upsertText } = await supabaseRequest(target, {
        method,
        headers: { Prefer: "return=representation" },
        body: JSON.stringify(body),
      });
      if (!upsertRes.ok) {
        console.error("saveTwitterConnection supabase failed:", upsertText);
      }
      return;
    } catch (error) {
      console.error("saveTwitterConnection supabase error:", error.message);
    }
  }

  // Fallback to in-memory map.
  twitterConnections.set(normalized, {
    connected: true,
    twitterUsername,
    twitterUserId,
    connectedAt: new Date().toISOString(),
  });
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

async function fetchPumpfunTokens() {
  const tokenAddresses = await fetchGraduatedTokenAddresses(GRADUATED_ADDRESS_FETCH_LIMIT);
  if (!tokenAddresses.length) return [];

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

  const normalized = [];

  for (const [, tokenPairs] of byToken.entries()) {
    const bestPair = pickBestPairForToken(tokenPairs);
    if (!bestPair) continue;
    const formatted = formatPair(bestPair, {
      source: "pumpfun",
      tradeRoute: "jupiter",
    });
    const reason = getStrictTradabilityReason(formatted);
    if (reason) {
      continue;
    }
    normalized.push(formatted);
  }

  return normalized;
}

async function fetchBagsTokens() {
  if (!BAGS_API_KEY) {
    console.log("[bags] skipped (BAGS_API_KEY missing)");
    return [];
  }

  const response = await fetch(BAGS_FEED_URL, {
    method: "GET",
    headers: {
      Accept: "application/json",
      "x-api-key": BAGS_API_KEY,
    },
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Bags feed failed: ${response.status} ${text}`);
  }

  const data = await response.json();
  const rawItems = Array.isArray(data?.response) ? data.response : [];
  if (!rawItems.length) return [];

  const tokensByAddress = new Map();
  for (const item of rawItems) {
    const status = String(item?.status || "").trim();
    if (!isBagsStatusTradable(status)) {
      logBagsRejected(
        { name: item?.name, symbol: item?.symbol, mint: item?.tokenMint, status },
        `status ${status || "unknown"}`
      );
      continue;
    }

    const mint = String(item?.tokenMint || "").trim();
    if (!mint) {
      logBagsRejected(item, "missing token mint");
      continue;
    }

    const symbol = String(item?.symbol || item?.tokenSymbol || "").trim();
    if (!symbol) {
      logBagsRejected({ mint, status }, "missing symbol");
      continue;
    }

    const name = String(item?.name || symbol || "").trim() || symbol;
    const key = mint.toLowerCase();
    if (tokensByAddress.has(key)) continue;
    tokensByAddress.set(key, { mint, name, symbol, status });
    if (tokensByAddress.size >= BAGS_FEED_TOKEN_LIMIT) break;
  }

  if (!tokensByAddress.size) return [];

  const tokenAddresses = Array.from(tokensByAddress.values()).map((token) => token.mint);
  const pairs = await fetchDexscreenerPairsForAddresses(tokenAddresses);
  const pairsByAddress = new Map();
  for (const pair of pairs) {
    const tokenAddress = pair?.baseToken?.address;
    if (!tokenAddress) continue;
    const addressKey = tokenAddress.toLowerCase();
    if (!pairsByAddress.has(addressKey)) {
      pairsByAddress.set(addressKey, []);
    }
    pairsByAddress.get(addressKey).push(pair);
  }

  const normalized = [];
  for (const [address, metadata] of tokensByAddress.entries()) {
    const tokenPairs = pairsByAddress.get(address);
    if (!tokenPairs || tokenPairs.length === 0) {
      logBagsRejected(metadata, "no dexscreener pairs found");
      continue;
    }

    const bestPair = pickBestPairForToken(tokenPairs);
    if (!bestPair) {
      logBagsRejected(metadata, "no viable dexscreener pair");
      continue;
    }

    const formatted = formatPair(bestPair, { source: "bags", tradeRoute: "jupiter" });
    const reason = getStrictTradabilityReason(formatted);
    const detail =
      reason === "low liquidity"
        ? `low liquidity ${Math.round(formatted.liquidityUsd || 0)} < ${MIN_LIQUIDITY_USD}`
        : reason === "low volume"
        ? `low volume ${Math.round(formatted.volume24hUsd || 0)} < ${MIN_VOLUME_USD}`
        : reason === "invalid price"
        ? `invalid price ${formatted.priceUsd ?? "n/a"}`
        : reason;
    const isTradable = !reason;
    formatted.isTradable = isTradable;
    formatted.tradableReason = detail || undefined;
    if (!isTradable) {
      logBagsNotTradable(metadata, detail || "tradability check failed");
    } else {
      logBagsAccepted(metadata, formatted.liquidityUsd);
    }
    normalized.push(formatted);
  }

  return normalized;
}

async function fetchBirdeyeTokens() {
  if (!BIRDEYE_API_KEY) {
    console.log("[birdeye] skipped (BIRDEYE_API_KEY missing)");
    return [];
  }

  const url = new URL(BIRDEYE_URL);
  url.searchParams.set("chain", "solana");
  url.searchParams.set("limit", "100");
  url.searchParams.set("sort_by", "liquidity");
  url.searchParams.set("sort_type", "desc");

  const response = await fetch(url.toString(), {
    method: "GET",
    headers: {
      Accept: "application/json",
      "x-chain": "solana",
      "x-api-key": BIRDEYE_API_KEY,
    },
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Birdeye API failed: ${response.status} ${text}`);
  }

  const json = await response.json();
  const rawTokens =
    Array.isArray(json?.data?.tokens) ? json.data.tokens :
    Array.isArray(json?.tokens) ? json.tokens :
    [];

  return rawTokens
    .map((token) => {
      const createdAt =
        normalizeTimestamp(token.createdAt) ||
        normalizeTimestamp(token.created_at) ||
        normalizeTimestamp(token.listingTime) ||
        normalizeTimestamp(token.listing_time) ||
        normalizeTimestamp(token.launchTime) ||
        normalizeTimestamp(token.launch_time);

      return {
        name: token.name || token.tokenName || token.marketName || "",
        symbol: token.symbol || token.tokenSymbol || token.symbol_short || token.token_id || "",
        address: token.tokenAddress || token.token_address || token.mint || token.id || token.tokenId || "",
        priceUsd: safeNumber(token.priceUsd || token.price_usd || token.market_price),
        liquidityUsd: safeNumber(token.liquidityUsd || token.liquidity_usd || token.liquidity),
        volume24hUsd: safeNumber(token.volume24hUsd || token.volume_24h_usd || token.volume || token.volume_usd),
        marketCapUsd: safeNumber(token.marketCapUsd || token.market_cap_usd || token.market_cap),
        pairAddress:
          token.pairAddress ||
          token.marketAddress ||
          token.market_address ||
          token.poolAddress ||
          token.pool_address ||
          null,
        createdAt,
        source: "birdeye",
        tradeRoute: "jupiter",
      };
    })
    .filter((token) => Boolean(token.address));
}

const SOURCE_FETCHERS = [
  { name: "pumpfun", fetcher: fetchPumpfunTokens },
  { name: "bags", fetcher: fetchBagsTokens },
  { name: "birdeye", fetcher: fetchBirdeyeTokens },
  { name: "dexscreener", fetcher: fetchDexscreenerLatestTokens },
];
async function buildGraduatedFeed() {
  const sourceBuckets = FEED_SOURCE_ORDER.reduce((acc, key) => {
    acc[key] = [];
    return acc;
  }, {});

  for (const source of SOURCE_FETCHERS) {
    try {
      const tokens = await source.fetcher();
      if (sourceBuckets[source.name]) {
        sourceBuckets[source.name].push(...tokens);
      } else {
        sourceBuckets[source.name] = [...tokens];
      }
      logTokensBySource(source.name, tokens, "strict");
    } catch (error) {
      console.error(`[${source.name}] fetch failed: ${error.message}`);
    }
  }

  const mergedBuckets = FEED_SOURCE_ORDER.reduce((acc, key) => {
    const merged = mergeTokensByAddress(sourceBuckets[key]);
    acc[key] = merged;
    logTokensBySource(key, merged, "final");
    return acc;
  }, {});

  const balanced = ensureMinimumBagTokens(buildBalancedFeed(mergedBuckets), mergedBuckets.bags);
  if (balanced.length > 0) {
    const normalizedFeed = applySourceDefaults(balanced).slice(0, MAX_GRADUATED_FEED_TOKENS);
    logFeedSourceBreakdown(normalizedFeed);
    printTokenNamesToTerminal(normalizedFeed, 'FULL_FEED_TOKENS');
    graduatedLastGoodFeed = normalizedFeed;
    return normalizedFeed;
  }

  if (graduatedLastGoodFeed && graduatedLastGoodFeed.length > 0) {
    console.log("[feed] returning last known good feed");
    logFeedSourceBreakdown(graduatedLastGoodFeed);
    printTokenNamesToTerminal(graduatedLastGoodFeed, 'FULL_FEED_TOKENS');
    return graduatedLastGoodFeed;
  }

  return [];
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

async function fetchCoinbaseSolPrice() {
  const response = await fetch("https://api.coinbase.com/v2/prices/SOL-USD/spot", {
    method: "GET",
    headers: { Accept: "application/json" },
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`Coinbase price fetch failed: ${response.status} ${text}`);
  }
  const json = JSON.parse(text);
  const price = Number(json?.data?.amount || 0);
  if (!Number.isFinite(price) || price <= 0) {
    throw new Error("Invalid Coinbase price response");
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
    const coinbasePrice = await fetchCoinbaseSolPrice();
    solPriceCache = coinbasePrice;
    solPriceCacheTime = now;
    return { price: coinbasePrice, source: "coinbase" };
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
    printTokenNamesToTerminal(fullFeed, 'FULL_FEED_TOKENS');
    const start = Number.isFinite(cursor) ? cursor : 0;
    const end = start + limit;

    const pageTokens = fullFeed.slice(start, end);
    const nextCursor = end < fullFeed.length ? String(end) : null;

    printTokenNamesToTerminal(pageTokens, "MOBILE GRADUATED FEED PAGE");
    logFinalFeedTokens(pageTokens, 10);

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

async function fetchDexscreenerLatestTokens() {
  const response = await fetch(DEXSCREENER_LATEST_URL, { method: "GET" });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Dexscreener latest API failed: ${response.status} ${text}`);
  }

  const json = await response.json();
  const rawTokens =
    Array.isArray(json?.tokens)
      ? json.tokens
      : Array.isArray(json?.pairs)
      ? json.pairs
      : Array.isArray(json?.data?.tokens)
      ? json.data.tokens
      : [];

  return rawTokens
    .map((item) => {
      const baseToken = item.baseToken || item.token || item;
      const createdAt =
        normalizeTimestamp(item.createdAt) ||
        normalizeTimestamp(item.listingTime) ||
        normalizeTimestamp(item.listing_time) ||
        normalizeTimestamp(item.graduatedAt) ||
        normalizeTimestamp(item.created_at);

      return {
        name:
          baseToken?.name ||
          item.name ||
          item.tokenName ||
          item.token?.name ||
          "",
        symbol:
          baseToken?.symbol ||
          item.symbol ||
          item.tokenSymbol ||
          item.token?.symbol ||
          "",
        address:
          baseToken?.address ||
          item.address ||
          item.tokenAddress ||
          item.token?.address ||
          "",
        priceUsd:
          safeNumber(item.priceUsd || item.price_usd || baseToken?.priceUsd),
        liquidityUsd:
          safeNumber(
            item.liquidity?.usd ||
              item.liquidityUsd ||
              item.liquidity_usd ||
              item.liquidity ||
              baseToken?.liquidityUsd
          ),
        volume24hUsd:
          safeNumber(
            item.volume?.h24 ||
              item.volume24hUsd ||
              item.volume_24h_usd ||
              item.volume ||
              baseToken?.volume24hUsd
          ),
        marketCapUsd:
          safeNumber(item.marketCapUsd || item.market_cap_usd || item.marketCap),
        pairAddress:
          item.pairAddress || item.poolAddress || item.marketAddress || item.pair || null,
        createdAt,
        source: "dexscreener",
        tradeRoute: "jupiter",
      };
    })
    .filter((token) => Boolean(token.address));
}

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

    const coinbasePrice = await fetchCoinbaseSolPrice();
    solPriceCache = coinbasePrice;
    solPriceCacheTime = now;
    return res.json({ priceUsd: coinbasePrice, source: "coinbase" });

    const price = await fetchCoinGeckoSolPrice();
    solPriceCache = price;
    solPriceCacheTime = now;
    return res.json({
      priceUsd: price,
      source: "coingecko",
      debug: {
        jupiter: { ok: false, error: jupResult.error, status: jupResult.status || null },
        jupiterQuote: { ok: false, error: quoteResult.error, status: quoteResult.status || null },
        coinbase: { ok: false, error: "unreachable" },
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

    let quoteRes;
    let quoteText = "";
    try {
      quoteRes = await fetch(quoteUrl.toString(), {
        method: "GET",
        headers: { "User-Agent": "memeswipe-api/1.0" },
      });
      quoteText = await quoteRes.text();
    } catch (error) {
      return res.status(500).json({
        error: "Jupiter quote failed",
        details: error?.message || "fetch_failed",
      });
    }
    let quoteJson = null;
    try {
      quoteJson = JSON.parse(quoteText);
    } catch {
      quoteJson = null;
    }
    if (!quoteRes.ok || !quoteJson || quoteJson?.error) {
      return res.status(500).json({
        error: "Jupiter quote failed",
        details: quoteJson?.error || quoteText || "Unknown error",
        status: quoteRes.status,
      });
    }

    let swapRes;
    let swapText = "";
    try {
      swapRes = await fetch("https://quote-api.jup.ag/v6/swap", {
        method: "POST",
        headers: { "Content-Type": "application/json", "User-Agent": "memeswipe-api/1.0" },
        body: JSON.stringify({
          quoteResponse: quoteJson,
          userPublicKey,
          wrapAndUnwrapSol: true,
          dynamicComputeUnitLimit: true,
          prioritizationFeeLamports: "auto",
        }),
      });
      swapText = await swapRes.text();
    } catch (error) {
      return res.status(500).json({
        error: "Jupiter swap failed",
        details: error?.message || "fetch_failed",
      });
    }
    let swapJson = null;
    try {
      swapJson = JSON.parse(swapText);
    } catch {
      swapJson = null;
    }
    if (!swapRes.ok || !swapJson?.swapTransaction) {
      return res.status(500).json({
        error: "Jupiter swap failed",
        details: swapJson?.error || swapText || "Missing swap transaction",
        status: swapRes.status,
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

app.get("/api/jupiter/health", async (req, res) => {
  try {
    const testUrl = new URL("https://quote-api.jup.ag/v6/quote");
    testUrl.searchParams.set("inputMint", "So11111111111111111111111111111111111111112");
    testUrl.searchParams.set("outputMint", "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v");
    testUrl.searchParams.set("amount", "100000000");
    testUrl.searchParams.set("slippageBps", "50");
    const resp = await fetch(testUrl.toString(), {
      method: "GET",
      headers: { "User-Agent": "memeswipe-api/1.0" },
    });
    const text = await resp.text();
    return res.status(resp.ok ? 200 : 502).json({
      ok: resp.ok,
      status: resp.status,
      bodyPreview: text.slice(0, 200),
    });
  } catch (error) {
    return res.status(500).json({ ok: false, error: error?.message || "fetch_failed" });
  }
});

app.get("/api/twitter/connection/:userId", async (req, res) => {
  const resolvedUserId = await resolveUserId(req.params.userId);
  if (!resolvedUserId) {
    return res.status(400).json({ error: "Invalid userId" });
  }

  try {
    const profile = await resolveTwitterConnection(resolvedUserId);
    if (!profile) {
      return res.status(404).json({ connected: false });
    }
    return res.json({
      connected: true,
      twitterUsername: profile.twitterUsername,
      twitterUserId: profile.twitterUserId,
    });
  } catch (error) {
    return res.status(500).json({
      error: "Failed to resolve twitter connection",
      details: error?.message || "unknown",
    });
  }
});

app.delete("/api/twitter/connection/:userId", async (req, res) => {
  const resolvedUserId = await resolveUserId(req.params.userId);
  if (!resolvedUserId) {
    return res.status(400).json({ error: "Invalid userId" });
  }

  if (SUPABASE_URL && SUPABASE_SERVICE_KEY) {
    try {
      await supabaseRequest(`twitter_connections?user_id=eq.${encodeURIComponent(resolvedUserId)}`, {
        method: "DELETE",
      });
    } catch (error) {
      console.error("delete twitter connection supabase error:", error.message || error);
    }
  }

  twitterConnections.delete(resolvedUserId);
  return res.json({ ok: true });
});

app.get("/api/twitter/auth/start", async (req, res) => {
  const userIdRaw = String(req.query.userId || "").trim();
  const returnUrl = String(req.query.returnUrl || "").trim();
  const clientId = process.env.TWITTER_CLIENT_ID || "";
  const callbackUrl = process.env.TWITTER_CALLBACK_URL || "";

  if (!clientId || !callbackUrl) {
    return res.status(500).json({ error: "Twitter auth not configured on server" });
  }
  if (!userIdRaw) {
    return res.status(400).json({ error: "Missing userId" });
  }
  const resolvedUserId = await resolveUserId(userIdRaw);
  if (!resolvedUserId) {
    return res.status(400).json({ error: "Invalid userId" });
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
    userId: resolvedUserId,
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
    await saveTwitterConnection(stored.userId, profile.twitterUserId, profile.twitterUsername);

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

app.get("/api/orders", async (req, res) => {
  try {
    const userId = await resolveUserId(req.query.userId);
    const limit = Math.max(1, Math.min(Number(req.query.limit) || 200, 500));
    if (!userId) return res.status(400).json({ error: "Invalid userId" });
    const { res: sbRes, json, text } = await supabaseRequest(
      `orders?user_id=eq.${encodeURIComponent(userId)}&order=created_at.desc&limit=${limit}`,
      { method: "GET" }
    );
    if (!sbRes.ok) {
      return res.status(500).json({ error: "Failed to load orders", details: text });
    }
    return res.json({ orders: Array.isArray(json) ? json : [] });
  } catch (error) {
    return res.status(500).json({ error: "Failed to load orders", details: error.message });
  }
});

app.post("/api/orders", async (req, res) => {
  try {
    const body = req.body || {};
    const userId = await resolveUserId(body.userId);
    if (!userId) return res.status(400).json({ error: "Invalid userId" });
    await ensureSupabaseUserRow(userId);
    const amountUsdInput = safeNumber(body.amountUsd) || 0;
    const priceUsd = safeNumber(body.priceUsd);
    const resolvedAmountUsd = amountUsdInput > 0
      ? amountUsdInput
      : deriveOrderAmountUsd({ amountUsd: amountUsdInput, inAmountRaw: body.inAmountRaw, priceUsd });
    const payload = {
      user_id: userId,
      chain: body.chain || "solana",
      token_address: body.tokenAddress || null,
      token_name: body.tokenName || null,
      token_symbol: body.tokenSymbol || null,
      amount_usd: resolvedAmountUsd,
      tp_roi: body.tpRoi || 0,
      stop_loss: body.stopLoss ?? null,
      price_usd: priceUsd ?? null,
      liquidity_usd: body.liquidityUsd ?? null,
      volume_24h_usd: body.volume24hUsd ?? null,
      market_cap_usd: body.marketCapUsd ?? null,
      change_24h_pct: body.change24hPct ?? null,
      graduation_time: body.graduationTime ?? null,
      chart_data: Array.isArray(body.chartData) ? JSON.stringify(body.chartData) : body.chartData ?? null,
      tx_signature: body.txSignature ?? null,
      input_mint: body.inputMint ?? null,
      output_mint: body.outputMint ?? null,
      in_amount_raw: body.inAmountRaw ?? null,
      out_amount_raw: body.outAmountRaw ?? null,
      status: "filled",
    };
    const { res: sbRes, json, text } = await supabaseRequest("orders", {
      method: "POST",
      headers: { Prefer: "return=representation" },
      body: JSON.stringify(payload),
    });
    if (!sbRes.ok) {
      return res.status(500).json({ error: "Failed to create order", details: text });
    }
    return res.json({ order: Array.isArray(json) ? json[0] : json });
  } catch (error) {
    return res.status(500).json({ error: "Failed to create order", details: error.message });
  }
});

app.patch("/api/orders/:id/close", async (req, res) => {
  try {
    const orderId = String(req.params.id || "").trim();
    const body = req.body || {};
    const userId = await resolveUserId(body.userId);
    if (!orderId) return res.status(400).json({ error: "Missing order id" });
    if (!userId) return res.status(400).json({ error: "Invalid userId" });
    if (!body.closeTxSignature && body.closeError) {
      const { res: existingRes, json: existingJson, text: existingText } = await supabaseRequest(
        `orders?id=eq.${encodeURIComponent(orderId)}&user_id=eq.${encodeURIComponent(userId)}&select=close_tx_signature`,
        { method: "GET" }
      );
      if (existingRes.ok && Array.isArray(existingJson) && existingJson[0]?.close_tx_signature) {
        return res.json({ success: true, order: existingJson[0] });
      }
      if (!existingRes.ok) {
        return res.status(500).json({ error: "Failed to load order", details: existingText });
      }
    }
    const update = {
      close_reason: body.closeReason ?? null,
      close_trigger_pct: body.closeTriggerPct ?? null,
      close_price_usd: body.closePriceUsd ?? null,
      close_pnl_pct: body.closePnlPct ?? null,
      close_pnl_usd: body.closePnlUsd ?? null,
      close_tx_signature: body.closeTxSignature ?? null,
      close_error: body.closeError ?? null,
    };
    if (body.closeTxSignature) {
      update.closed_at = new Date().toISOString();
      update.close_error = null;
    } else if (body.closeError) {
      update.closed_at = null;
    }
    const { res: sbRes, json, text } = await supabaseRequest(
      `orders?id=eq.${encodeURIComponent(orderId)}&user_id=eq.${encodeURIComponent(userId)}`,
      {
        method: "PATCH",
        headers: { Prefer: "return=representation" },
        body: JSON.stringify(update),
      }
    );
    if (!sbRes.ok) {
      return res.status(500).json({ error: "Failed to close order", details: text });
    }
    return res.json({ success: true, order: Array.isArray(json) ? json[0] : json });
  } catch (error) {
    return res.status(500).json({ error: "Failed to close order", details: error.message });
  }
});

app.get("/api/stats", async (req, res) => {
  try {
    const totalsQuery =
      "orders?status=eq.filled&select=totalVolume:sum(amount_usd),totalTrades:count(id)";
    const { res: totalsRes, json: totalsJson, text: totalsText } = await supabaseRequest(totalsQuery, { method: "GET" });
    if (!totalsRes.ok) {
      return res.status(500).json({ error: "Failed to load stats", details: totalsText });
    }
    const totalsRow = Array.isArray(totalsJson) ? totalsJson[0] : totalsJson;
    const totalVolume = Number(totalsRow?.totalVolume ?? 0);
    const totalTrades = Number(totalsRow?.totalTrades ?? 0);

    const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const activeQuery = `orders?status=eq.filled&created_at=gte.${encodeURIComponent(since.toISOString())}&select=user_id&limit=2000`;
    const { res: activeRes, json: activeJson, text: activeText } = await supabaseRequest(activeQuery, {
      method: "GET",
    });
    if (!activeRes.ok) {
      return res.status(500).json({ error: "Failed to load stats", details: activeText });
    }
    const activeUsers = new Set(
      (Array.isArray(activeJson) ? activeJson : [])
        .map((row) => row?.user_id)
        .filter(Boolean)
    ).size;

    return res.json({
      totalVolume,
      totalTrades,
      activeUsers,
    });
  } catch (error) {
    return res.status(500).json({ error: "Failed to load stats", details: error.message });
  }
});

app.post("/api/favorites", (req, res) => {
  return res.json({ ok: true });
});

app.post("/api/onboard-user", async (req, res) => {
  try {
    const {
      privy_user_id,
      twitter_user_id,
      twitter_username,
      email,
      wallet_address
    } = req.body || {};

    if (!privy_user_id || !twitter_user_id || !twitter_username || !email || !wallet_address) {
      return res.status(400).json({ error: "Missing required fields" });
    }

    const debugEnabled = process.env.DEBUG_ONBOARDING === "true";
    const debug = debugEnabled ? { supabase_host: SUPABASE_HOST } : null;

    // Try to find an existing user by Privy ID first
    const { res: walletByPrivyRes, json: walletByPrivyJson } = await supabaseRequest(
      `user_wallets?privy_user_id=eq.${encodeURIComponent(privy_user_id)}&select=user_id,privy_user_id`,
      { method: "GET" }
    );

    if (!walletByPrivyRes.ok) {
      return res.status(500).json({ error: "Failed to check existing wallets by Privy ID", details: walletByPrivyJson });
    }
    if (debug) {
      debug.wallet_by_privy_count = Array.isArray(walletByPrivyJson) ? walletByPrivyJson.length : 0;
    }

    let userId;
    let existingUser = false;
    let foundByTwitter = false;

    if (Array.isArray(walletByPrivyJson) && walletByPrivyJson.length > 0) {
      existingUser = true;
      userId = walletByPrivyJson[0].user_id;
    } else {
      // Check if Twitter account already exists
      const { res: checkRes, json: checkJson } = await supabaseRequest(
        `twitter_connections?twitter_user_id=eq.${encodeURIComponent(twitter_user_id)}&select=user_id,twitter_user_id,twitter_username`,
        { method: "GET" }
      );

      if (!checkRes.ok) {
        return res.status(500).json({ error: "Failed to check existing connections", details: checkJson });
      }
      if (debug) {
        debug.twitter_by_id_count = Array.isArray(checkJson) ? checkJson.length : 0;
      }

      if (Array.isArray(checkJson) && checkJson.length > 0) {
        existingUser = true;
        foundByTwitter = true;
        userId = checkJson[0].user_id;
      } else {
        // Create new user
        userId = crypto.randomUUID();
      }
    }

    await ensureSupabaseUserRow(userId);

    // Insert or update twitter_connection
    const twitterPayload = {
      user_id: userId,
      twitter_user_id,
      twitter_username,
      connected_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    // Determine whether to PATCH or POST to avoid duplicate key errors
    const { res: byUserRes, json: byUserJson } = await supabaseRequest(
      `twitter_connections?user_id=eq.${encodeURIComponent(userId)}&select=user_id`,
      { method: "GET" }
    );

    if (!byUserRes.ok) {
      return res.status(500).json({ error: "Failed to check twitter connections by user_id", details: byUserJson });
    }
    const hasByUser = Array.isArray(byUserJson) && byUserJson.length > 0;
    const hasByTwitter = foundByTwitter;

    let twitterTarget = "twitter_connections";
    let twitterMethod = "POST";
    let twitterBody = twitterPayload;

    if (hasByUser) {
      twitterTarget = `twitter_connections?user_id=eq.${encodeURIComponent(userId)}`;
      twitterMethod = "PATCH";
      twitterBody = {
        ...twitterPayload,
        twitter_user_id: undefined, // avoid accidental change
      };
    } else if (hasByTwitter) {
      twitterTarget = `twitter_connections?twitter_user_id=eq.${encodeURIComponent(twitter_user_id)}`;
      twitterMethod = "PATCH";
      twitterBody = {
        ...twitterPayload,
        twitter_user_id: undefined,
      };
    }
    if (debug) {
      debug.twitter_by_user_count = Array.isArray(byUserJson) ? byUserJson.length : 0;
      debug.twitter_write_method = twitterMethod;
      debug.twitter_write_target = twitterTarget;
    }

    const { res: twitterRes, json: twitterJson } = await supabaseRequest(twitterTarget, {
      method: twitterMethod,
      headers: { Prefer: "return=representation" },
      body: JSON.stringify(twitterBody),
    });

    if (!twitterRes.ok) {
      return res.status(500).json({ error: "Failed to save Twitter connection", details: twitterJson });
    }
    if (debug) {
      debug.twitter_write_status = twitterRes.status;
      debug.twitter_write_rows = Array.isArray(twitterJson) ? twitterJson.length : 0;
    }

    // Check if wallet already exists for this user
    const { res: walletCheckRes, json: walletCheckJson } = await supabaseRequest(
      `user_wallets?or=(user_id.eq.${encodeURIComponent(userId)},privy_user_id.eq.${encodeURIComponent(privy_user_id)})&select=id,wallet_address,privy_user_id`,
      { method: "GET" }
    );

    if (!walletCheckRes.ok) {
      return res.status(500).json({ error: "Failed to check existing wallets", details: walletCheckJson });
    }
    if (debug) {
      debug.wallet_check_count = Array.isArray(walletCheckJson) ? walletCheckJson.length : 0;
    }

    let walletExists = false;
    if (Array.isArray(walletCheckJson) && walletCheckJson.length > 0) {
      walletExists = walletCheckJson.some(w => w.wallet_address === wallet_address || w.privy_user_id === privy_user_id);
    }

    if (!walletExists) {
      // Insert new wallet
      const walletPayload = {
        user_id: userId,
        privy_user_id,
        wallet_address,
        email,
        created_at: new Date().toISOString(),
      };

      const { res: walletRes, json: walletJson } = await supabaseRequest("user_wallets", {
        method: "POST",
        headers: { Prefer: "return=representation" },
        body: JSON.stringify(walletPayload),
      });

      if (!walletRes.ok) {
        return res.status(500).json({ error: "Failed to save wallet", details: walletJson });
      }
      if (debug) {
        debug.wallet_write_status = walletRes.status;
        debug.wallet_write_rows = Array.isArray(walletJson) ? walletJson.length : 0;
      }
    }

    const responseBody = {
      success: true,
      user_id: userId,
      existing_user: existingUser,
      wallet_exists: walletExists,
    };
    if (debug) {
      responseBody.debug = debug;
    }
    return res.json(responseBody);

  } catch (error) {
    console.error("POST /api/onboard-user error:", error.message);
    return res.status(500).json({ error: "Failed to onboard user", details: error.message });
  }
});

app.get("/tokens/graduated", async (req, res) => {
  try {
    const requestedLimit = Number(req.query.limit) || DEFAULT_PAGE_LIMIT;
    const limit = Math.max(1, Math.min(requestedLimit, DEFAULT_PAGE_LIMIT));
    const feed = await getCachedGraduatedFeed();
    const limitedFeed = feed.slice(0, limit);
    printTokenNamesToTerminal(limitedFeed, "DIRECT GRADUATED FEED");
    return res.json(limitedFeed);
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
  if (SUPABASE_HOST) {
    console.log(`[supabase] host: ${SUPABASE_HOST}`);
  }
});
