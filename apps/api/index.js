const express = require("express");
const cors = require("cors");
const fetch = require("node-fetch");
const crypto = require("crypto");
require("dotenv").config();

const { Pool } = require("pg");

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

const app = express();
app.set("trust proxy", 1);
app.use(express.json());
app.use(cors());

const oauthStateStore = new Map();
let ensureTwitterTablePromise = null;
let ensureFavoritesTablePromise = null;
let ensureOrdersTablePromise = null;
const userFkTargetCache = new Map();
const FEED_CACHE_TTL_MS = 60 * 1000;
const QUOTA_BLOCK_MS = 60 * 60 * 1000;
const feedCache = new Map();
let moralisBlockedUntil = 0;
const SOL_MINT = "So11111111111111111111111111111111111111112";
const DEFAULT_SOL_USD_FALLBACK = Number(process.env.SOL_USD_FALLBACK || 200);
const JUPITER_QUOTE_URLS = [
  "https://quote-api.jup.ag/v6/quote",
  "https://lite-api.jup.ag/swap/v1/quote",
];
const JUPITER_SWAP_URLS = [
  "https://quote-api.jup.ag/v6/swap",
  "https://lite-api.jup.ag/swap/v1/swap",
];
const TOKEN_PRICE_CACHE_TTL_MS = 20 * 1000;
const tokenPriceCache = new Map();

const base64UrlEncode = (buffer) =>
  buffer
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");

const createCodeVerifier = () => base64UrlEncode(crypto.randomBytes(32));

const createCodeChallenge = (verifier) =>
  base64UrlEncode(crypto.createHash("sha256").update(verifier).digest());

const ensureTwitterConnectionsTable = async () => {
  if (!ensureTwitterTablePromise) {
    ensureTwitterTablePromise = pool.query(`
      create table if not exists twitter_connections (
        user_id uuid primary key,
        twitter_user_id text not null,
        twitter_username text not null,
        connected_at timestamptz not null default now(),
        updated_at timestamptz not null default now()
      )
    `);
  }

  try {
    await ensureTwitterTablePromise;
  } catch (error) {
    ensureTwitterTablePromise = null;
    throw error;
  }
};

const ensureFavoritesTable = async () => {
  if (!ensureFavoritesTablePromise) {
    ensureFavoritesTablePromise = pool.query(`
      create table if not exists favorites (
        id bigserial primary key,
        user_id uuid not null,
        token_address text not null,
        created_at timestamptz not null default now(),
        unique (user_id, token_address)
      )
    `);
  }

  try {
    await ensureFavoritesTablePromise;
  } catch (error) {
    ensureFavoritesTablePromise = null;
    throw error;
  }
};

const ensureOrdersTable = async () => {
  if (!ensureOrdersTablePromise) {
    ensureOrdersTablePromise = (async () => {
      await pool.query(`
        create table if not exists orders (
          id bigserial primary key,
          user_id uuid not null,
          chain text not null,
          token_address text not null,
          token_name text,
          token_symbol text,
          amount_usd numeric not null,
          tp_roi numeric not null,
          stop_loss numeric,
          price_usd numeric,
          liquidity_usd numeric,
          volume_24h_usd numeric,
          market_cap_usd numeric,
          change_24h_pct numeric,
          graduation_time text,
          chart_data jsonb,
          status text not null default 'open',
          created_at timestamptz not null default now()
        )
      `);

      await pool.query(`alter table orders add column if not exists token_name text`);
      await pool.query(`alter table orders add column if not exists token_symbol text`);
      await pool.query(`alter table orders add column if not exists stop_loss numeric`);
      await pool.query(`alter table orders add column if not exists price_usd numeric`);
      await pool.query(`alter table orders add column if not exists liquidity_usd numeric`);
      await pool.query(`alter table orders add column if not exists volume_24h_usd numeric`);
      await pool.query(`alter table orders add column if not exists market_cap_usd numeric`);
      await pool.query(`alter table orders add column if not exists change_24h_pct numeric`);
      await pool.query(`alter table orders add column if not exists graduation_time text`);
      await pool.query(`alter table orders add column if not exists chart_data jsonb`);
      await pool.query(`alter table orders add column if not exists status text default 'open'`);
      await pool.query(`alter table orders add column if not exists created_at timestamptz not null default now()`);
      await pool.query(`alter table orders add column if not exists closed_at timestamptz`);
      await pool.query(`alter table orders add column if not exists tx_signature text`);
      await pool.query(`alter table orders add column if not exists close_tx_signature text`);
      await pool.query(`alter table orders add column if not exists input_mint text`);
      await pool.query(`alter table orders add column if not exists output_mint text`);
      await pool.query(`alter table orders add column if not exists in_amount_raw text`);
      await pool.query(`alter table orders add column if not exists out_amount_raw text`);
    })();
  }

  try {
    await ensureOrdersTablePromise;
  } catch (error) {
    ensureOrdersTablePromise = null;
    throw error;
  }
};

const resolveUserFkTarget = async (sourceTableName) => {
  if (userFkTargetCache.has(sourceTableName)) {
    return userFkTargetCache.get(sourceTableName);
  }

  const result = await pool.query(
    `
    select
      ccu.table_schema as foreign_table_schema,
      ccu.table_name as foreign_table_name,
      ccu.column_name as foreign_column_name
    from information_schema.table_constraints tc
    join information_schema.key_column_usage kcu
      on tc.constraint_name = kcu.constraint_name
      and tc.table_schema = kcu.table_schema
    join information_schema.constraint_column_usage ccu
      on ccu.constraint_name = tc.constraint_name
      and ccu.constraint_schema = tc.table_schema
    where tc.constraint_type = 'FOREIGN KEY'
      and tc.table_schema = 'public'
      and tc.table_name = $1
      and kcu.column_name = 'user_id'
    limit 1
    `,
    [sourceTableName]
  );

  const row = result.rows[0]
    ? {
        schema: result.rows[0].foreign_table_schema,
        table: result.rows[0].foreign_table_name,
        column: result.rows[0].foreign_column_name,
      }
    : null;

  userFkTargetCache.set(sourceTableName, row);
  return row;
};

const ensureUserExistsForTable = async (sourceTableName, userId) => {
  const fkTarget = await resolveUserFkTarget(sourceTableName);
  if (!fkTarget) return;

  const qSchema = `"${String(fkTarget.schema).replace(/"/g, '""')}"`;
  const qTable = `"${String(fkTarget.table).replace(/"/g, '""')}"`;
  const qColumn = `"${String(fkTarget.column).replace(/"/g, '""')}"`;

  try {
    await pool.query(
      `insert into ${qSchema}.${qTable} (${qColumn}) values ($1) on conflict (${qColumn}) do nothing`,
      [userId]
    );
  } catch (error) {
    // Supabase auth.users may need aud/role defaults; apply best-effort fallback.
    if (fkTarget.schema === "auth" && fkTarget.table === "users" && fkTarget.column === "id") {
      await pool.query(
        `
        insert into auth.users (id, aud, role)
        values ($1, 'authenticated', 'authenticated')
        on conflict (id) do nothing
        `,
        [userId]
      );
      return;
    }
    throw error;
  }
};

const resolveExistingFkUserId = async (sourceTableName) => {
  const fkTarget = await resolveUserFkTarget(sourceTableName);
  if (!fkTarget) return null;

  const qSchema = `"${String(fkTarget.schema).replace(/"/g, '""')}"`;
  const qTable = `"${String(fkTarget.table).replace(/"/g, '""')}"`;
  const qColumn = `"${String(fkTarget.column).replace(/"/g, '""')}"`;
  const existing = await pool.query(
    `select ${qColumn} as id from ${qSchema}.${qTable} limit 1`
  );

  const id = existing.rows[0]?.id;
  return typeof id === "string" && id.length > 0 ? id : null;
};

const resolveInsertUserId = async (sourceTableName, requestedUserId) => {
  try {
    await ensureUserExistsForTable(sourceTableName, requestedUserId);
    return requestedUserId;
  } catch (error) {
    const fallbackId = await resolveExistingFkUserId(sourceTableName);
    if (fallbackId) return fallbackId;
    throw error;
  }
};

const buildCallbackUrl = (req) => {
  if (process.env.TWITTER_CALLBACK_URL) {
    return process.env.TWITTER_CALLBACK_URL;
  }

  return `${req.protocol}://${req.get("host")}/api/twitter/auth/callback`;
};

const buildRedirectUrl = (returnUrl, params) => {
  const url = new URL(returnUrl);
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null) {
      url.searchParams.set(key, String(value));
    }
  });
  return url.toString();
};

const isAllowedReturnUrl = (value) => {
  if (!value || typeof value !== "string") return false;
  return value.startsWith("mobile://") || value.startsWith("exp://");
};

const getSolUsdPrice = async () => {
  // 1) Jupiter price service (fast when reachable)
  try {
    const r = await fetch("https://price.jup.ag/v4/price?ids=SOL");
    if (r.ok) {
      const json = await r.json();
      const price = Number(json?.data?.SOL?.price);
      if (Number.isFinite(price) && price > 0) {
        return { price, source: "jupiter" };
      }
    }
  } catch (error) {
    console.warn("[PRICE] Jupiter SOL price failed:", error?.message || error);
  }

  // 2) CoinGecko fallback
  try {
    const r = await fetch(
      "https://api.coingecko.com/api/v3/simple/price?ids=solana&vs_currencies=usd"
    );
    if (r.ok) {
      const json = await r.json();
      const price = Number(json?.solana?.usd);
      if (Number.isFinite(price) && price > 0) {
        return { price, source: "coingecko" };
      }
    }
  } catch (error) {
    console.warn("[PRICE] CoinGecko SOL price failed:", error?.message || error);
  }

  // 3) Safe configured default
  if (Number.isFinite(DEFAULT_SOL_USD_FALLBACK) && DEFAULT_SOL_USD_FALLBACK > 0) {
    return { price: DEFAULT_SOL_USD_FALLBACK, source: "fallback_env" };
  }

  throw new Error("Unable to resolve SOL/USD price from all sources");
};

const fetchJupiterQuote = async (params) => {
  let lastError = null;
  for (const baseUrl of JUPITER_QUOTE_URLS) {
    try {
      const qs = new URLSearchParams(params);
      const url = `${baseUrl}?${qs.toString()}`;
      const res = await fetch(url);
      const bodyText = await res.text();
      if (!res.ok) {
        lastError = new Error(`Quote failed at ${baseUrl}: ${res.status} ${bodyText.slice(0, 200)}`);
        continue;
      }
      const json = JSON.parse(bodyText);
      return { json, source: baseUrl };
    } catch (error) {
      lastError = error;
      continue;
    }
  }
  throw lastError || new Error("Failed to fetch Jupiter quote from all endpoints");
};

const fetchJupiterSwapTx = async (payload) => {
  let lastError = null;
  for (const baseUrl of JUPITER_SWAP_URLS) {
    try {
      const res = await fetch(baseUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const bodyText = await res.text();
      if (!res.ok) {
        lastError = new Error(`Swap build failed at ${baseUrl}: ${res.status} ${bodyText.slice(0, 200)}`);
        continue;
      }
      const json = JSON.parse(bodyText);
      return { json, source: baseUrl };
    } catch (error) {
      lastError = error;
      continue;
    }
  }
  throw lastError || new Error("Failed to build Jupiter swap transaction from all endpoints");
};

const fetchGraduatedFeed = async (req, res) => {
  try {
    if (!process.env.MORALIS_API_KEY) {
      return res.status(500).json({ error: "MORALIS_API_KEY is not configured" });
    }

    const now = Date.now();
    if (now < moralisBlockedUntil) {
      return res.status(429).json({
        error: "Moralis feed temporarily blocked due to quota/rate limits",
        blockedUntil: moralisBlockedUntil,
        tokens: [],
        cursor: null,
      });
    }

    const limit = req.query.limit || 50;
    const cursor = req.query.cursor ? String(req.query.cursor) : "";
    const cacheKey = `graduated:${limit}:${cursor}`;
    const cached = feedCache.get(cacheKey);
    if (cached && now - cached.lastFetch < FEED_CACHE_TTL_MS) {
      return res.json(cached.payload);
    }

    const qs = new URLSearchParams({ limit: String(limit) });
    if (cursor) qs.set("cursor", cursor);
    const url = `https://solana-gateway.moralis.io/token/mainnet/exchange/pumpfun/graduated?${qs.toString()}`;

    const r = await fetch(url, {
      headers: {
        accept: "application/json",
        "X-API-Key": process.env.MORALIS_API_KEY,
      },
    });

    if (!r.ok) {
      const text = await r.text();
      const lowerText = String(text || "").toLowerCase();
      if (r.status === 401 || r.status === 429 || lowerText.includes("quota")) {
        moralisBlockedUntil = Date.now() + QUOTA_BLOCK_MS;
      }
      return res.status(r.status).json({
        error: "Moralis request failed",
        details: text || null,
        tokens: [],
        cursor: null,
      });
    }

    const data = await r.json();

    // Normalize output for your app
    const tokens = (data.result || []).map((t) => ({
      name: t.name || t.symbol || "Unknown",
      symbol: t.symbol || "",
      address: t.address || t.mint || t.tokenAddress,
      priceUsd: t.priceUsd ?? null,
      liquidityUsd: t.liquidityUsd ?? null,
      graduatedAt: t.graduatedAt ?? null,
    }));

    if (!tokens.length) {
      return res.json({
        tokens: [],
        cursor: null,
      });
    }
    const payload = { tokens, cursor: data.cursor || null };
    feedCache.set(cacheKey, { payload, lastFetch: now });
    return res.json(payload);
  } catch (e) {
    console.error(e);
    return res.status(500).json({
      error: "Failed to fetch Moralis feed",
      cursor: null,
      tokens: [],
    });
  }
};

app.get("/api/feed/solana/graduated", fetchGraduatedFeed);
app.get("/api/feed/solana/stalker", fetchGraduatedFeed);
app.get("/api/feed/solana/bigcap", fetchGraduatedFeed);
app.get("/api/feed/solana/smart", fetchGraduatedFeed);
app.get("/api/feed/base/graduated", fetchGraduatedFeed);
app.get("/api/feed/base/stalker", fetchGraduatedFeed);
app.get("/api/feed/base/bigcap", fetchGraduatedFeed);
app.get("/api/feed/base/smart", fetchGraduatedFeed);

app.get("/api/twitter/connection/:userId", async (req, res) => {
  try {
    const { userId } = req.params;
    if (!userId) return res.status(400).json({ error: "Missing userId" });

    await ensureTwitterConnectionsTable();
    const result = await pool.query(
      `
      select user_id, twitter_user_id, twitter_username, connected_at, updated_at
      from twitter_connections
      where user_id = $1
      `,
      [userId]
    );

    if (!result.rows.length) {
      return res.json({ connected: false });
    }

    const row = result.rows[0];
    return res.json({
      connected: true,
      userId: row.user_id,
      twitterUserId: row.twitter_user_id,
      twitterUsername: row.twitter_username,
      connectedAt: row.connected_at,
      updatedAt: row.updated_at,
    });
  } catch (err) {
    console.error("Twitter connection lookup error:", err);
    return res.status(500).json({ error: "Failed to fetch Twitter connection" });
  }
});

app.delete("/api/twitter/connection/:userId", async (req, res) => {
  try {
    const { userId } = req.params;
    if (!userId) return res.status(400).json({ error: "Missing userId" });

    await ensureTwitterConnectionsTable();
    await pool.query(`delete from twitter_connections where user_id = $1`, [userId]);
    return res.json({ success: true });
  } catch (err) {
    console.error("Twitter disconnect error:", err);
    return res.status(500).json({ error: "Failed to disconnect Twitter" });
  }
});

app.get("/api/twitter/auth/start", async (req, res) => {
  try {
    const { userId, returnUrl } = req.query;

    if (!userId || !returnUrl) {
      return res.status(400).json({ error: "userId and returnUrl are required" });
    }

    if (!isAllowedReturnUrl(returnUrl)) {
      return res.status(400).json({ error: "Unsupported returnUrl" });
    }

    if (!process.env.TWITTER_CLIENT_ID) {
      return res.status(500).json({ error: "TWITTER_CLIENT_ID is not configured" });
    }

    const state = crypto.randomUUID();
    const codeVerifier = createCodeVerifier();
    const codeChallenge = createCodeChallenge(codeVerifier);
    const callbackUrl = buildCallbackUrl(req);
    const scope = "users.read tweet.read";

    oauthStateStore.set(state, {
      userId,
      returnUrl,
      codeVerifier,
      createdAt: Date.now(),
    });

    const authUrl = new URL("https://x.com/i/oauth2/authorize");
    authUrl.searchParams.set("response_type", "code");
    authUrl.searchParams.set("client_id", process.env.TWITTER_CLIENT_ID);
    authUrl.searchParams.set("redirect_uri", callbackUrl);
    authUrl.searchParams.set("scope", scope);
    authUrl.searchParams.set("state", state);
    authUrl.searchParams.set("code_challenge", codeChallenge);
    authUrl.searchParams.set("code_challenge_method", "S256");

    return res.json({ authUrl: authUrl.toString() });
  } catch (err) {
    console.error("Twitter auth start error:", err);
    return res.status(500).json({ error: "Failed to start Twitter auth" });
  }
});

app.get("/api/twitter/auth/callback", async (req, res) => {
  const { code, state, error } = req.query;
  const stateData = state ? oauthStateStore.get(state) : null;

  if (!stateData) {
    return res.status(400).send("Invalid or expired state");
  }

  oauthStateStore.delete(state);

  if (Date.now() - stateData.createdAt > 10 * 60 * 1000) {
    const expiredUrl = buildRedirectUrl(stateData.returnUrl, {
      status: "error",
      error: "state_expired",
    });
    return res.redirect(expiredUrl);
  }

  if (error) {
    const deniedUrl = buildRedirectUrl(stateData.returnUrl, {
      status: "error",
      error,
    });
    return res.redirect(deniedUrl);
  }

  if (!code) {
    const missingCodeUrl = buildRedirectUrl(stateData.returnUrl, {
      status: "error",
      error: "missing_code",
    });
    return res.redirect(missingCodeUrl);
  }

  try {
    if (!process.env.TWITTER_CLIENT_ID) {
      throw new Error("TWITTER_CLIENT_ID is not configured");
    }

    const callbackUrl = buildCallbackUrl(req);
    const tokenResponse = await fetch("https://api.twitter.com/2/oauth2/token", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code,
        redirect_uri: callbackUrl,
        client_id: process.env.TWITTER_CLIENT_ID,
        code_verifier: stateData.codeVerifier,
      }).toString(),
    });

    if (!tokenResponse.ok) {
      const text = await tokenResponse.text();
      throw new Error(`Twitter token exchange failed: ${text}`);
    }

    const tokenJson = await tokenResponse.json();
    const accessToken = tokenJson.access_token;
    if (!accessToken) throw new Error("Twitter access token missing");

    const meResponse = await fetch("https://api.twitter.com/2/users/me", {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    });

    if (!meResponse.ok) {
      const text = await meResponse.text();
      throw new Error(`Twitter user lookup failed: ${text}`);
    }

    const meJson = await meResponse.json();
    const twitterUserId = meJson?.data?.id;
    const twitterUsername = meJson?.data?.username;

    if (!twitterUserId || !twitterUsername) {
      throw new Error("Twitter user data missing");
    }

    await ensureTwitterConnectionsTable();
    await pool.query(
      `
      insert into twitter_connections (user_id, twitter_user_id, twitter_username, connected_at, updated_at)
      values ($1, $2, $3, now(), now())
      on conflict (user_id) do update
      set twitter_user_id = excluded.twitter_user_id,
          twitter_username = excluded.twitter_username,
          updated_at = now()
      `,
      [stateData.userId, twitterUserId, twitterUsername]
    );

    const successUrl = buildRedirectUrl(stateData.returnUrl, {
      status: "success",
      twitterUserId,
      twitterUsername,
    });
    return res.redirect(successUrl);
  } catch (err) {
    console.error("Twitter auth callback error:", err);
    const failedUrl = buildRedirectUrl(stateData.returnUrl, {
      status: "error",
      error: "twitter_auth_failed",
    });
    return res.redirect(failedUrl);
  }
});

app.get("/api/health/db", async (req, res) => {
    try {
      const result = await pool.query("select now() as now");
      res.json({ ok: true, now: result.rows[0].now });
    } catch (err) {
      console.error("DB error:", err);
      res.status(500).json({ ok: false, error: err.message });
    }
  });  

app.get("/api/token-prices", async (req, res) => {
  try {
    const rawAddresses = typeof req.query.addresses === "string" ? req.query.addresses : "";
    const addresses = Array.from(
      new Set(
        rawAddresses
          .split(",")
          .map((a) => a.trim())
          .filter(Boolean)
      )
    ).slice(0, 40);

    if (!addresses.length) {
      return res.status(400).json({ error: "addresses query param is required" });
    }

    const now = Date.now();
    const prices = {};

    for (const address of addresses) {
      const cacheKey = `solana:${address}`;
      const cached = tokenPriceCache.get(cacheKey);
      if (cached && now - cached.ts < TOKEN_PRICE_CACHE_TTL_MS) {
        prices[address] = cached.price;
        continue;
      }

      let resolvedPrice = null;

      // 1) Moralis token price (preferred if key available)
      if (process.env.MORALIS_API_KEY) {
        try {
          const moralisRes = await fetch(
            `https://solana-gateway.moralis.io/token/mainnet/${encodeURIComponent(address)}/price`,
            {
              headers: {
                accept: "application/json",
                "X-API-Key": process.env.MORALIS_API_KEY,
              },
            }
          );
          if (moralisRes.ok) {
            const moralisJson = await moralisRes.json();
            const p = Number(moralisJson?.usdPrice);
            if (Number.isFinite(p) && p > 0) {
              resolvedPrice = p;
            }
          }
        } catch (error) {
          console.warn("[TOKEN_PRICE] moralis failed", address, error?.message || error);
        }
      }

      // 2) DexScreener fallback
      if (resolvedPrice == null) {
        try {
          const dexRes = await fetch(
            `https://api.dexscreener.com/latest/dex/tokens/${encodeURIComponent(address)}`
          );
          if (dexRes.ok) {
            const dexJson = await dexRes.json();
            const pairs = Array.isArray(dexJson?.pairs) ? dexJson.pairs : [];
            const solanaPairs = pairs.filter((p) => p?.chainId === "solana");
            const bestPair = (solanaPairs.length ? solanaPairs : pairs)[0];
            const p = Number(bestPair?.priceUsd);
            if (Number.isFinite(p) && p > 0) {
              resolvedPrice = p;
            }
          }
        } catch (error) {
          console.warn("[TOKEN_PRICE] dexscreener failed", address, error?.message || error);
        }
      }

      if (resolvedPrice != null) {
        prices[address] = resolvedPrice;
        tokenPriceCache.set(cacheKey, { price: resolvedPrice, ts: now });
      } else {
        prices[address] = null;
      }
    }

    return res.json({ prices });
  } catch (err) {
    console.error("Token prices error:", err);
    return res.status(500).json({ error: err.message || "Failed to fetch token prices" });
  }
});

app.get("/api/solana/price-usd", async (_req, res) => {
  try {
    const { price, source } = await getSolUsdPrice();
    return res.json({ symbol: "SOL", priceUsd: price, source });
  } catch (err) {
    console.error("SOL price error:", err);
    return res.status(500).json({ error: err.message });
  }
});

app.post("/api/jupiter/swap", async (req, res) => {
  try {
    const inputMint = typeof req.body?.inputMint === "string" ? req.body.inputMint.trim() : "";
    const outputMint = typeof req.body?.outputMint === "string" ? req.body.outputMint.trim() : "";
    const userPublicKey = typeof req.body?.userPublicKey === "string" ? req.body.userPublicKey.trim() : "";
    const slippageBpsRaw = Number(req.body?.slippageBps ?? 100);
    const slippageBps = Number.isFinite(slippageBpsRaw) ? Math.max(10, Math.min(5000, slippageBpsRaw)) : 100;
    const amountRawFromClient = typeof req.body?.amountRaw === "string" ? req.body.amountRaw.trim() : "";
    const amountUsd = Number(req.body?.amountUsd);

    if (!inputMint || !outputMint || !userPublicKey) {
      return res.status(400).json({ error: "inputMint, outputMint and userPublicKey are required" });
    }

    let amountRaw = amountRawFromClient;
    if (!amountRaw) {
      if (inputMint !== SOL_MINT) {
        return res.status(400).json({ error: "amountRaw is required for non-SOL input mint" });
      }
      if (!Number.isFinite(amountUsd) || amountUsd <= 0) {
        return res.status(400).json({ error: "amountUsd must be a positive number when amountRaw is not provided" });
      }

      const { price: solPriceUsd, source: solPriceSource } = await getSolUsdPrice();

      const lamports = Math.floor((amountUsd / solPriceUsd) * 1_000_000_000);
      const safeLamports = Math.max(5_000, lamports);
      amountRaw = String(safeLamports);
      console.log("[JUPITER] Derived SOL input amount", {
        amountUsd,
        solPriceUsd,
        solPriceSource,
        lamports: amountRaw,
      });
    }

    if (!/^\d+$/.test(amountRaw) || Number(amountRaw) <= 0) {
      return res.status(400).json({ error: "amountRaw must be a positive integer string" });
    }

    const { json: quoteJson, source: quoteSource } = await fetchJupiterQuote({
      inputMint,
      outputMint,
      amount: amountRaw,
      slippageBps: String(slippageBps),
      swapMode: "ExactIn",
      // Allow broader routing for volatile/illiquid meme pairs.
      restrictIntermediateTokens: "false",
    });
    if (!quoteJson?.outAmount) {
      return res.status(400).json({ error: "No route found for this swap" });
    }

    const { json: swapJson, source: swapSource } = await fetchJupiterSwapTx({
      quoteResponse: quoteJson,
      userPublicKey,
      wrapAndUnwrapSol: true,
      dynamicComputeUnitLimit: true,
      dynamicSlippage: true,
      prioritizationFeeLamports: "auto",
    });
    if (!swapJson?.swapTransaction) {
      return res.status(500).json({ error: "Jupiter returned no swap transaction" });
    }

    return res.json({
      swapTransaction: swapJson.swapTransaction,
      quote: {
        inAmount: String(quoteJson.inAmount || amountRaw),
        outAmount: String(quoteJson.outAmount || "0"),
        inputMint,
        outputMint,
        slippageBps,
      },
      routeSource: {
        quote: quoteSource,
        swap: swapSource,
      },
      lastValidBlockHeight: swapJson.lastValidBlockHeight || null,
    });
  } catch (err) {
    console.error("Jupiter swap error:", err);
    return res.status(500).json({ error: err.message || "Failed to build Jupiter swap transaction" });
  }
});

app.get("/api/orders", async (req, res) => {
  try {
    await ensureOrdersTable();
    const userId = typeof req.query.userId === "string" ? req.query.userId.trim() : "";
    const status = typeof req.query.status === "string" ? req.query.status.trim().toLowerCase() : "";
    const statusFilter = status === "open" || status === "closed" ? status : "";
    const limitRaw = Number(req.query.limit || 50);
    const limit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(200, limitRaw)) : 50;

    if (userId) {
      const result = statusFilter
        ? await pool.query(
            `
            select *
            from orders
            where user_id = $1 and status = $2
            order by created_at desc
            limit $3
            `,
            [userId, statusFilter, limit]
          )
        : await pool.query(
            `
            select *
            from orders
            where user_id = $1
            order by created_at desc
            limit $2
            `,
            [userId, limit]
          );
      return res.json({ orders: result.rows });
    }

    const result = statusFilter
      ? await pool.query(
          `
          select *
          from orders
          where status = $1
          order by created_at desc
          limit $2
          `,
          [statusFilter, limit]
        )
      : await pool.query(
          `
          select *
          from orders
          order by created_at desc
          limit $1
          `,
          [limit]
        );
    return res.json({ orders: result.rows });
  } catch (err) {
    console.error("Orders fetch error:", err);
    return res.status(500).json({ error: err.message });
  }
});

app.patch("/api/orders/:orderId/close", async (req, res) => {
  try {
    await ensureOrdersTable();
    const orderId = Number(req.params.orderId);
    const userId = typeof req.body?.userId === "string" ? req.body.userId.trim() : "";
    if (!Number.isFinite(orderId) || orderId <= 0 || !userId) {
      return res.status(400).json({ error: "orderId and userId are required" });
    }

    const closeTxSignature =
      typeof req.body?.closeTxSignature === "string" && req.body.closeTxSignature.trim()
        ? req.body.closeTxSignature.trim()
        : null;

    const closeStatuses = ["closed", "cancelled", "filled"];
    let updated = null;
    let lastError = null;

    for (const nextStatus of closeStatuses) {
      try {
        const result = await pool.query(
          `
          update orders
          set status = $3,
              closed_at = now(),
              close_tx_signature = coalesce($4, close_tx_signature)
          where id = $1
            and user_id = $2
            and status not in ('closed', 'cancelled', 'filled')
          returning *
          `,
          [orderId, userId, nextStatus, closeTxSignature]
        );

        if (result.rows.length) {
          updated = result.rows[0];
          break;
        }

        const existing = await pool.query(
          `
          select * from orders where id = $1 and user_id = $2 limit 1
          `,
          [orderId, userId]
        );
        if (!existing.rows.length) {
          return res.status(404).json({ error: "Order not found" });
        }
        updated = existing.rows[0];
        break;
      } catch (error) {
        lastError = error;
        // 23514 = check constraint violation (status not allowed by schema)
        if (error?.code === "23514") continue;
        throw error;
      }
    }

    if (!updated) {
      if (lastError) throw lastError;
      return res.status(500).json({ error: "Unable to close order status with current schema constraints" });
    }

    return res.json({ success: true, order: updated });
  } catch (err) {
    console.error("Close order error:", err);
    return res.status(500).json({ error: err.message });
  }
});

app.post("/api/orders", async (req, res) => {
  try {
    const userId = typeof req.body.userId === "string" ? req.body.userId.trim() : "";
    const chain = typeof req.body.chain === "string" ? req.body.chain.trim() : "";
    const tokenAddress = typeof req.body.tokenAddress === "string" ? req.body.tokenAddress.trim() : "";
    const tokenName = req.body.tokenName;
    const tokenSymbol = req.body.tokenSymbol;
    const amountUsd = req.body.amountUsd;
    const tpRoi = req.body.tpRoi;
    const amountUSDT = req.body.amountUSDT;
    const roiTarget = req.body.roiTarget;
    const stopLoss = req.body.stopLoss;
    const priceUsd = req.body.priceUsd;
    const liquidityUsd = req.body.liquidityUsd;
    const volume24hUsd = req.body.volume24hUsd;
    const marketCapUsd = req.body.marketCapUsd;
    const change24hPct = req.body.change24hPct;
    const graduationTime = req.body.graduationTime;
    const chartData = req.body.chartData;
    const txSignature =
      typeof req.body.txSignature === "string" && req.body.txSignature.trim()
        ? req.body.txSignature.trim()
        : null;
    const inputMint =
      typeof req.body.inputMint === "string" && req.body.inputMint.trim() ? req.body.inputMint.trim() : null;
    const outputMint =
      typeof req.body.outputMint === "string" && req.body.outputMint.trim() ? req.body.outputMint.trim() : null;
    const inAmountRaw =
      typeof req.body.inAmountRaw === "string" && req.body.inAmountRaw.trim() ? req.body.inAmountRaw.trim() : null;
    const outAmountRaw =
      typeof req.body.outAmountRaw === "string" && req.body.outAmountRaw.trim() ? req.body.outAmountRaw.trim() : null;

    const normalizedAmount = Number(amountUsd ?? amountUSDT);
    const normalizedTp = Number(tpRoi ?? roiTarget);
    const normalizedStopLoss = stopLoss == null ? null : Number(stopLoss);
    const normalizedPrice = priceUsd == null ? null : Number(priceUsd);
    const normalizedLiquidity = liquidityUsd == null ? null : Number(liquidityUsd);
    const normalizedVolume = volume24hUsd == null ? null : Number(volume24hUsd);
    const normalizedMarketCap = marketCapUsd == null ? null : Number(marketCapUsd);
    const normalizedChange24h = change24hPct == null ? null : Number(change24hPct);
    const normalizedChartData = Array.isArray(chartData)
      ? chartData
          .map((v) => Number(v))
          .filter((v) => Number.isFinite(v))
          .slice(-40)
      : null;

    if (
      !userId ||
      !chain ||
      !tokenAddress ||
      !Number.isFinite(normalizedAmount) ||
      normalizedAmount <= 0 ||
      !Number.isFinite(normalizedTp) ||
      normalizedTp <= 0
    ) {
      return res.status(400).json({
        error: "Missing required fields",
        details: {
          hasUserId: Boolean(userId),
          hasChain: Boolean(chain),
          hasTokenAddress: Boolean(tokenAddress),
          amount: normalizedAmount,
          tp: normalizedTp,
        },
      });
    }

    console.log("[API][ORDERS] incoming", {
      userId,
      chain,
      tokenAddress,
      tokenSymbol,
      amount: normalizedAmount,
      tp: normalizedTp,
    });

    await ensureOrdersTable();
    const insertUserId = await resolveInsertUserId("orders", userId);

    const result = await pool.query(
      `
      insert into orders (
        user_id, chain, token_address, token_name, token_symbol,
        amount_usd, tp_roi, stop_loss, price_usd, liquidity_usd,
        volume_24h_usd, market_cap_usd, change_24h_pct, graduation_time, chart_data,
        tx_signature, input_mint, output_mint, in_amount_raw, out_amount_raw
      )
      values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20)
      returning *
      `,
      [
        insertUserId,
        chain,
        tokenAddress,
        tokenName || null,
        tokenSymbol || null,
        normalizedAmount,
        normalizedTp,
        Number.isFinite(normalizedStopLoss) ? normalizedStopLoss : null,
        Number.isFinite(normalizedPrice) ? normalizedPrice : null,
        Number.isFinite(normalizedLiquidity) ? normalizedLiquidity : null,
        Number.isFinite(normalizedVolume) ? normalizedVolume : null,
        Number.isFinite(normalizedMarketCap) ? normalizedMarketCap : null,
        Number.isFinite(normalizedChange24h) ? normalizedChange24h : null,
        graduationTime || null,
        normalizedChartData ? JSON.stringify(normalizedChartData) : null,
        txSignature,
        inputMint,
        outputMint,
        inAmountRaw,
        outAmountRaw,
      ]
    );

    const createdOrder = result.rows[0];
    console.log("[API][ORDERS] inserted", {
      id: createdOrder?.id,
      requestedUserId: userId,
      insertedUserId: insertUserId,
      tokenAddress: createdOrder?.token_address,
      tokenSymbol: createdOrder?.token_symbol,
    });
    res.json({ success: true, order: createdOrder, requestedUserId: userId, insertedUserId: insertUserId });
  } catch (err) {
    console.error("Order error:", err);
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/favorites", async (req, res) => {
  try {
    const { userId, tokenAddress } = req.body || {};
    if (!userId || !tokenAddress) {
      return res.status(400).json({ error: "Missing required fields" });
    }

    await ensureFavoritesTable();
    const insertUserId = await resolveInsertUserId("favorites", userId);
    const result = await pool.query(
      `
      insert into favorites (user_id, token_address)
      values ($1, $2)
      on conflict (user_id, token_address) do update set token_address = excluded.token_address
      returning *
      `,
      [insertUserId, tokenAddress]
    );

    return res.json({ success: true, favorite: result.rows[0] });
  } catch (err) {
    console.error("Favorites error:", err);
    return res.status(500).json({ error: err.message });
  }
});
  

const PORT = process.env.PORT || 3000;
app.listen(PORT, "0.0.0.0", () => {
  console.log(`API running on port ${PORT}`);
});
