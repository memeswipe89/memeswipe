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

app.get("/api/feed/solana/graduated", async (req, res) => {
  try {
    const limit = req.query.limit || 50;

    const url = `https://solana-gateway.moralis.io/token/mainnet/exchange/pumpfun/graduated?limit=${limit}`;

    const r = await fetch(url, {
      headers: {
        accept: "application/json",
        "X-API-Key": process.env.MORALIS_API_KEY,
      },
    });

    if (!r.ok) {
      const text = await r.text();
      return res.status(r.status).send(text);
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

    res.json({ tokens, cursor: data.cursor || null });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Failed to fetch graduated tokens" });
  }
});

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

    const authUrl = new URL("https://twitter.com/i/oauth2/authorize");
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

  app.post("/api/orders", async (req, res) => {
    try {
      const { userId, chain, tokenAddress, amountUsd, tpRoi } = req.body;
  
      if (!userId || !chain || !tokenAddress || !amountUsd || !tpRoi) {
        return res.status(400).json({ error: "Missing required fields" });
      }
  
      const result = await pool.query(
        `
        insert into orders (user_id, chain, token_address, amount_usd, tp_roi)
        values ($1, $2, $3, $4, $5)
        returning *
        `,
        [userId, chain, tokenAddress, amountUsd, tpRoi]
      );
  
      res.json({ success: true, order: result.rows[0] });
  
    } catch (err) {
      console.error("Order error:", err);
      res.status(500).json({ error: err.message });
    }
  });
  

const PORT = process.env.PORT || 3000;
app.listen(PORT, "0.0.0.0", () => {
  console.log(`API running on port ${PORT}`);
});
