const express = require("express");
const cors = require("cors");
const fetch = require("node-fetch");
const crypto = require("crypto");
const Stripe = require("stripe");
const {
  Connection,
  PublicKey,
} = require("@solana/web3.js");
require("dotenv").config();

const { Pool } = require("pg");

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});
const HAS_DATABASE_URL = typeof process.env.DATABASE_URL === "string" && process.env.DATABASE_URL.trim().length > 0;
let legacyTradingWalletCleanupPromise = null;

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
const USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
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
const SOLANA_RPC_URL = process.env.SOLANA_RPC_URL || "https://api.mainnet-beta.solana.com";
const AUTO_CLOSE_ENABLED = String(process.env.AUTO_CLOSE_ENABLED || "false").toLowerCase() === "true";
const AUTO_CLOSE_INTERVAL_MS = Math.max(5_000, Number(process.env.AUTO_CLOSE_INTERVAL_MS || 10_000));
const AUTO_CLOSE_MAX_ORDERS_PER_CYCLE = Math.max(
  1,
  Number(process.env.AUTO_CLOSE_MAX_ORDERS_PER_CYCLE || 5)
);
const AUTO_CLOSE_SLIPPAGE_RETRY_BPS = [800, 1200, 2000, 3000, 5000];
const AUTO_CLOSE_AMOUNT_BPS = [10000, 9800, 9000, 7500, 5000, 2500];
const AUTO_CLOSE_OUTPUT_MINTS = [
  SOL_MINT,
  USDC_MINT,
];
let autoCloseRunning = false;
let autoClosePausedUntil = 0;
const stripe = process.env.STRIPE_SECRET_KEY ? new Stripe(process.env.STRIPE_SECRET_KEY) : null;

const base64UrlEncode = (buffer) =>
  buffer
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");

const createCodeVerifier = () => base64UrlEncode(crypto.randomBytes(32));

const createCodeChallenge = (verifier) =>
  base64UrlEncode(crypto.createHash("sha256").update(verifier).digest());

const cleanupLegacyTradingWalletTable = async () => {
  if (!HAS_DATABASE_URL) return;
  if (!legacyTradingWalletCleanupPromise) {
    legacyTradingWalletCleanupPromise = pool.query(`drop table if exists trading_wallets`);
  }
  try {
    await legacyTradingWalletCleanupPromise;
  } catch (error) {
    legacyTradingWalletCleanupPromise = null;
    throw error;
  }
};

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
      await pool.query(`alter table orders add column if not exists close_price_usd numeric`);
      await pool.query(`alter table orders add column if not exists close_pnl_usd numeric`);
      await pool.query(`alter table orders add column if not exists close_pnl_pct numeric`);
      await pool.query(`alter table orders add column if not exists close_reason text`);
      await pool.query(`alter table orders add column if not exists close_trigger_pct numeric`);
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

const resolveInsertUserId = async (sourceTableName, requestedUserId) => {
  await ensureUserExistsForTable(sourceTableName, requestedUserId);
  return requestedUserId;
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

const UUID_V4_OR_V1_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const isUuid = (value) => UUID_V4_OR_V1_RE.test(String(value || "").trim());

const isAllowedReturnUrl = (value) => {
  if (!value || typeof value !== "string") return false;
  return value.startsWith("mobile://") || value.startsWith("exp://");
};

const getSolUsdPrice = async () => {
  // 1) Jupiter quote endpoint: derive SOL/USD via SOL->USDC quote for 1 SOL.
  try {
    const amountOneSolLamports = "1000000000";
    const { json } = await fetchJupiterQuote({
      inputMint: SOL_MINT,
      outputMint: USDC_MINT,
      amount: amountOneSolLamports,
      swapMode: "ExactIn",
      slippageBps: "50",
    });
    if (json?.outAmount) {
      const outUsdcMicro = Number(json.outAmount);
      const price = outUsdcMicro / 1_000_000;
      if (Number.isFinite(price) && price > 0) {
        return { price, source: "jupiter_quote" };
      }
    }
  } catch (error) {
    console.warn("[PRICE] Jupiter SOL quote failed:", error?.message || error);
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

const normalizePublicKey = (value) => {
  const text = String(value || "").trim();
  if (!text) return null;
  try {
    return new PublicKey(text).toBase58();
  } catch {
    return null;
  }
};

const getTokenPriceUsd = async (address) => {
  const now = Date.now();
  const cacheKey = String(address).toLowerCase();
  const cached = tokenPriceCache.get(cacheKey);
  if (cached && now - cached.ts < TOKEN_PRICE_CACHE_TTL_MS) {
    return cached.price;
  }

  let price = null;
  try {
    const r = await fetch(`https://api.dexscreener.com/latest/dex/tokens/${encodeURIComponent(address)}`);
    if (r.ok) {
      const json = await r.json();
      const pairs = Array.isArray(json?.pairs) ? json.pairs : [];
      const solanaPairs = pairs.filter((p) => String(p?.chainId || "").toLowerCase() === "solana");
      const best = (solanaPairs.length ? solanaPairs : pairs)[0];
      const p = Number(best?.priceUsd);
      if (Number.isFinite(p) && p > 0) price = p;
    }
  } catch {}

  if ((price == null || !(price > 0)) && process.env.MORALIS_API_KEY) {
    try {
      const r = await fetch(
        `https://solana-gateway.moralis.io/token/mainnet/${encodeURIComponent(address)}/price`,
        {
          headers: {
            accept: "application/json",
            "X-API-Key": process.env.MORALIS_API_KEY,
          },
        }
      );
      if (r.ok) {
        const json = await r.json();
        const p = Number(json?.usdPrice);
        if (Number.isFinite(p) && p > 0) price = p;
      }
    } catch {}
  }

  tokenPriceCache.set(cacheKey, { price, ts: now });
  return price;
};

const getRawTokenBalance = async (connection, ownerPubkey, mint) => {
  const mintPubkey = mint instanceof PublicKey ? mint : new PublicKey(String(mint));
  const resp = await connection.getParsedTokenAccountsByOwner(ownerPubkey, { mint: mintPubkey });
  return resp.value.reduce((sum, item) => {
    const raw = item?.account?.data?.parsed?.info?.tokenAmount?.amount;
    try {
      return sum + BigInt(String(raw || "0"));
    } catch {
      return sum;
    }
  }, 0n);
};

const executeCloseSwapForOrder = async (order, options = {}) => {
  const force = Boolean(options.force);
  const tokenAddress = String(order?.token_address || "").trim();
  const outputMint = String(order?.output_mint || "").trim();
  const sellMint = normalizePublicKey(outputMint) || normalizePublicKey(tokenAddress);
  const entryPriceUsd = Number(order?.price_usd);
  const tpRoi = Number(order?.tp_roi);
  const stopLossPct = Number(order?.stop_loss);
  const HARD_FAILSAFE_SL_PCT = 0.5;
  if (!tokenAddress) {
    return { skipped: true, reason: "missing_token" };
  }
  if (!sellMint) {
    return { skipped: true, reason: "invalid_sell_mint" };
  }

  let effectiveEntryPriceUsd = Number.isFinite(entryPriceUsd) && entryPriceUsd > 0 ? entryPriceUsd : null;
  if (!effectiveEntryPriceUsd) {
    // Legacy orders might miss entry price. Seed once from current live price.
    const seedPrice = (await getTokenPriceUsd(tokenAddress)) ?? (await getTokenPriceUsd(sellMint));
    if (Number.isFinite(seedPrice) && seedPrice > 0) {
      effectiveEntryPriceUsd = seedPrice;
      await pool.query(
        `
        update orders
        set price_usd = coalesce(price_usd, $2)
        where id = $1
        `,
        [order.id, seedPrice]
      );
      return { skipped: true, reason: "seeded_entry_price", pnlPct: 0, livePriceUsd: seedPrice };
    }
    return { skipped: true, reason: "missing_entry_price" };
  }

  // Prefer display token address for UI parity, fallback to real bought mint for safety.
  const livePriceUsd = (await getTokenPriceUsd(tokenAddress)) ?? (await getTokenPriceUsd(sellMint));
  if (!Number.isFinite(livePriceUsd) || livePriceUsd <= 0) {
    return { skipped: true, reason: "missing_live_price" };
  }

  const pnlPct = ((livePriceUsd - effectiveEntryPriceUsd) / effectiveEntryPriceUsd) * 100;
  const tpHit = Number.isFinite(tpRoi) && tpRoi > 0 ? pnlPct >= tpRoi : false;
  const configuredSlPct =
    Number.isFinite(stopLossPct) && stopLossPct > 0 ? Math.abs(stopLossPct) : Number.POSITIVE_INFINITY;
  const effectiveSlPct = Math.min(configuredSlPct, HARD_FAILSAFE_SL_PCT);
  const slHit = Number.isFinite(effectiveSlPct) ? pnlPct <= -effectiveSlPct : false;
  if (!force && !tpHit && !slHit) {
    return { skipped: true, reason: "threshold_not_hit", pnlPct, livePriceUsd };
  }

  const thresholdReason = tpHit ? "tp" : slHit ? "sl" : null;
  const closeReason = thresholdReason || (force ? "manual" : "unknown");
  const closeTriggerPct = tpHit ? tpRoi : slHit ? -effectiveSlPct : null;
  return {
    skipped: true,
    reason: "client_signature_required",
    pnlPct,
    livePriceUsd,
    closeReason,
    closeTriggerPct,
    walletMode: "non_custodial_privy",
  };
};

const processAutoClose = async () => {
  if (!AUTO_CLOSE_ENABLED || autoCloseRunning) return;
  if (Date.now() < autoClosePausedUntil) return;
  autoCloseRunning = true;
  try {
    await ensureOrdersTable();
    const rows = await pool.query(
      `
      select *
      from orders
      where chain = 'solana'
        and coalesce(close_tx_signature, '') = ''
        and status not in ('closed', 'cancelled', 'filled')
      order by created_at desc
      limit $1
      `
      ,
      [AUTO_CLOSE_MAX_ORDERS_PER_CYCLE]
    );

    for (const order of rows.rows) {
      try {
        const result = await executeCloseSwapForOrder(order, { force: false });
        if (result?.skipped) {
          if (result.reason !== "threshold_not_hit" && result.reason !== "client_signature_required") {
            console.log("[AUTO_CLOSE] skipped", {
              orderId: order.id,
              tokenAddress: order.token_address,
              reason: result.reason,
              pnlPct: result.pnlPct ?? null,
            });
          }
          if (result.reason === "client_signature_required") {
            console.log("[AUTO_CLOSE] threshold hit but skipped in non-custodial mode", {
              orderId: order.id,
              tokenAddress: order.token_address,
              reason: result.closeReason,
              triggerPct: result.closeTriggerPct,
              pnlPct: result.pnlPct ?? null,
            });
          }
          continue;
        }
        console.log("[AUTO_CLOSE] order closed", {
          orderId: order.id,
          tokenAddress: order.token_address,
          closeSig: result.closeSig,
          pnlPct: result.pnlPct,
        });
      } catch (error) {
        console.warn("[AUTO_CLOSE] order processing error", {
          orderId: order?.id,
          message: error?.message || String(error),
        });
      }
    }
  } catch (error) {
    const isAggregate = typeof AggregateError !== "undefined" && error instanceof AggregateError;
    const aggregateMessages = isAggregate
      ? Array.from(error.errors || [])
          .map((e) => String(e?.message || e))
          .filter(Boolean)
      : [];
    const message = [String(error?.message || error || ""), ...aggregateMessages].join(" | ");

    const isDbDown =
      message.includes("ECONNREFUSED ::1:5432") ||
      message.includes("connect ECONNREFUSED") ||
      message.includes("password authentication failed") ||
      message.includes("database") ||
      message.includes("timeout expired");

    const isRpcOrNetworkDown =
      message.includes("failed to fetch") ||
      message.includes("ENOTFOUND") ||
      message.includes("EAI_AGAIN") ||
      message.includes("ETIMEDOUT") ||
      message.includes("ECONNRESET") ||
      message.includes("429") ||
      message.includes("Too many requests") ||
      message.includes("AggregateError");

    if (isDbDown || isRpcOrNetworkDown) {
      autoClosePausedUntil = Date.now() + 60 * 1000;
      console.warn(
        `[AUTO_CLOSE] paused for 60s due to ${isDbDown ? "DB" : "RPC/network"} connectivity issue`,
        message
      );
    } else {
      console.warn("[AUTO_CLOSE] loop error", message);
    }
  } finally {
    autoCloseRunning = false;
  }
};

app.post("/api/trades/close/build", async (req, res) => {
  try {
    await ensureOrdersTable();
    const userId = typeof req.body?.userId === "string" ? req.body.userId.trim() : "";
    const orderId = Number(req.body?.orderId);
    const walletAddress = normalizePublicKey(req.body?.walletAddress);
    if (!userId || !Number.isFinite(orderId) || orderId <= 0 || !walletAddress) {
      return res.status(400).json({ error: "userId, orderId and walletAddress are required" });
    }

    const row = await pool.query(
      `
      select * from orders
      where id = $1 and user_id = $2
      limit 1
      `,
      [orderId, userId]
    );
    if (!row.rows.length) return res.status(404).json({ error: "Order not found" });
    const order = row.rows[0];
    if (String(order.status || "").toLowerCase() === "closed" && order.close_tx_signature) {
      return res.status(400).json({ error: "Order is already closed" });
    }

    const connection = new Connection(SOLANA_RPC_URL, "confirmed");
    const sellMintRaw = typeof order.output_mint === "string" && order.output_mint.trim() ? order.output_mint.trim() : "";
    const sellMint = normalizePublicKey(sellMintRaw || order.token_address);
    if (!sellMint) return res.status(400).json({ error: "Order token mint missing" });

    const orderOutAmountRaw = (() => {
      const v = String(order.out_amount_raw || "").trim();
      return /^\d+$/.test(v) ? BigInt(v) : 0n;
    })();
    const mintBalanceRaw = await getRawTokenBalance(connection, new PublicKey(walletAddress), sellMint);
    if (mintBalanceRaw <= 0n) return res.status(400).json({ error: "No token balance available for close" });
    const baseCloseAmountRaw =
      orderOutAmountRaw > 0n
        ? (orderOutAmountRaw < mintBalanceRaw ? orderOutAmountRaw : mintBalanceRaw)
        : mintBalanceRaw;
    if (baseCloseAmountRaw <= 0n) return res.status(400).json({ error: "Close amount resolved to zero" });

    let lastError = null;
    for (const outputMint of AUTO_CLOSE_OUTPUT_MINTS) {
      for (const amountBps of AUTO_CLOSE_AMOUNT_BPS) {
        const amountRaw = (baseCloseAmountRaw * BigInt(amountBps)) / 10000n;
        if (amountRaw <= 0n) continue;
        for (const slippageBps of AUTO_CLOSE_SLIPPAGE_RETRY_BPS) {
          try {
            const { json: quoteJson, source: quoteSource } = await fetchJupiterQuote({
              inputMint: sellMint,
              outputMint,
              amount: amountRaw.toString(),
              slippageBps: String(slippageBps),
              swapMode: "ExactIn",
            });
            if (!quoteJson?.outAmount) throw new Error("No route found for close swap");

            const { json: swapJson, source: swapSource } = await fetchJupiterSwapTx({
              quoteResponse: quoteJson,
              userPublicKey: walletAddress,
              wrapAndUnwrapSol: true,
              dynamicComputeUnitLimit: true,
              dynamicSlippage: true,
              prioritizationFeeLamports: "auto",
            });
            if (!swapJson?.swapTransaction) throw new Error("No swap transaction returned");

            return res.json({
              success: true,
              walletAddress,
              swapTransaction: swapJson.swapTransaction,
              lastValidBlockHeight: swapJson.lastValidBlockHeight || null,
              quote: {
                inAmount: String(quoteJson.inAmount || amountRaw.toString()),
                outAmount: String(quoteJson.outAmount || "0"),
                inputMint: sellMint,
                outputMint,
                slippageBps,
              },
              routeSource: { quote: quoteSource, swap: swapSource },
            });
          } catch (error) {
            lastError = error;
            continue;
          }
        }
      }
    }

    throw lastError || new Error("Unable to build close transaction");
  } catch (err) {
    console.error("Manual trade close build error:", err);
    return res.status(500).json({ error: err.message || "Failed to build close transaction" });
  }
});

app.post("/api/trades/close", async (_req, res) => {
  return res.status(410).json({
    error: "Deprecated endpoint. Build close transaction with /api/trades/close/build and submit closeTxSignature via PATCH /api/orders/:orderId/close",
  });
});

const fetchDexFallbackFeed = async (limitRaw) => {
  const limit = Number(limitRaw) || 50;
  const safeLimit = Math.max(1, Math.min(100, limit));
  const q = encodeURIComponent("pump fun solana");
  const url = `https://api.dexscreener.com/latest/dex/search?q=${q}`;
  const r = await fetch(url);
  if (!r.ok) {
    const text = await r.text();
    throw new Error(`Dex fallback failed: ${r.status} ${String(text).slice(0, 160)}`);
  }
  const json = await r.json();
  const pairs = Array.isArray(json?.pairs) ? json.pairs : [];
  const tokens = pairs
    .filter((p) => String(p?.chainId || "").toLowerCase() === "solana")
    .map((p) => ({
      name: p?.baseToken?.name || p?.baseToken?.symbol || "Unknown",
      symbol: p?.baseToken?.symbol || "",
      address: p?.baseToken?.address || "",
      priceUsd: Number(p?.priceUsd || 0) || 0,
      liquidityUsd: Number(p?.liquidity?.usd || 0) || 0,
      volume24hUsd: Number(p?.volume?.h24 || 0) || 0,
      marketCapUsd: Number(p?.marketCap || 0) || 0,
      change24hPct: Number(p?.priceChange?.h24 || 0) || 0,
      graduatedAt: null,
    }))
    .filter((t) => t.address)
    .sort((a, b) => b.liquidityUsd - a.liquidityUsd)
    .slice(0, safeLimit);
  return { tokens, cursor: null };
};

const fetchGraduatedFeed = async (req, res) => {
  try {
    const limit = req.query.limit || 50;
    const fallback = await fetchDexFallbackFeed(limit);
    return res.json({
      ...fallback,
      source: "dexscreener_only",
    });
  } catch (e) {
    console.error(e);
    try {
      const fallback = await fetchDexFallbackFeed(req.query.limit || 50);
      return res.status(200).json({
        ...fallback,
        source: "dexscreener_fallback",
        error: "Moralis failed, fallback in use",
      });
    } catch (fallbackError) {
      return res.status(500).json({
        error: "Failed to fetch feeds",
        details: fallbackError?.message || String(fallbackError),
        cursor: null,
        tokens: [],
      });
    }
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

const migrateLegacyUserDataByTwitterIdentity = async (currentUserId, twitterUserId) => {
  if (!currentUserId || !twitterUserId) return [];

  await ensureTwitterConnectionsTable();
  await ensureOrdersTable();
  await ensureFavoritesTable();
  await resolveInsertUserId("orders", currentUserId);

  const legacyUsersRes = await pool.query(
    `
    select distinct user_id
    from twitter_connections
    where twitter_user_id = $1
      and user_id <> $2
    `,
    [twitterUserId, currentUserId]
  );

  const legacyUserIds = legacyUsersRes.rows
    .map((row) => String(row.user_id || "").trim())
    .filter(Boolean);

  for (const legacyUserId of legacyUserIds) {
    await pool.query(`update orders set user_id = $2 where user_id = $1`, [legacyUserId, currentUserId]);
    await pool.query(
      `
      insert into favorites (user_id, token_address, created_at)
      select $2, token_address, created_at
      from favorites
      where user_id = $1
      on conflict (user_id, token_address) do nothing
      `,
      [legacyUserId, currentUserId]
    );
    await pool.query(`delete from favorites where user_id = $1`, [legacyUserId]);
    await pool.query(`delete from twitter_connections where user_id = $1`, [legacyUserId]);
  }

  return legacyUserIds;
};

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

    const resolvedUserId = isUuid(stateData.userId) ? stateData.userId : crypto.randomUUID();
    if (resolvedUserId !== stateData.userId) {
      console.warn("[TWITTER] invalid userId from client; generated fallback uuid", {
        inputUserId: stateData.userId,
        resolvedUserId,
      });
    }

    const migratedFromUserIds = await migrateLegacyUserDataByTwitterIdentity(resolvedUserId, twitterUserId);
    await ensureTwitterConnectionsTable();
    const insertUserId = await resolveInsertUserId("twitter_connections", resolvedUserId);
    await pool.query(
      `
      insert into twitter_connections (user_id, twitter_user_id, twitter_username, connected_at, updated_at)
      values ($1, $2, $3, now(), now())
      on conflict (user_id) do update
      set twitter_user_id = excluded.twitter_user_id,
          twitter_username = excluded.twitter_username,
          updated_at = now()
      `,
      [insertUserId, twitterUserId, twitterUsername]
    );

    if (migratedFromUserIds.length) {
      console.log("[TWITTER] migrated legacy user data", {
        twitterUserId,
        currentUserId: insertUserId,
        migratedFromUserIds,
      });
    }

    const successUrl = buildRedirectUrl(stateData.returnUrl, {
      status: "success",
      userId: insertUserId,
      twitterUserId,
      twitterUsername,
    });
    return res.redirect(successUrl);
  } catch (err) {
    console.error("Twitter auth callback error:", err);
    const failedUrl = buildRedirectUrl(stateData.returnUrl, {
      status: "error",
      error: "twitter_auth_failed",
      reason: String(err?.message || "unknown").slice(0, 120),
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

app.post("/api/payments/apple-pay/intent", async (req, res) => {
  try {
    if (!stripe) {
      return res.status(500).json({ error: "STRIPE_SECRET_KEY is not configured" });
    }
    const amountUsd = Number(req.body?.amountUsd);
    const userId = typeof req.body?.userId === "string" ? req.body.userId.trim() : "";
    const currency = String(req.body?.currency || "usd").toLowerCase();
    if (!Number.isFinite(amountUsd) || amountUsd <= 0) {
      return res.status(400).json({ error: "amountUsd must be a positive number" });
    }
    if (!userId) {
      return res.status(400).json({ error: "userId is required" });
    }

    const amountCents = Math.round(amountUsd * 100);
    const intent = await stripe.paymentIntents.create({
      amount: amountCents,
      currency,
      automatic_payment_methods: { enabled: true },
      metadata: {
        userId,
        source: "apple_pay",
        product: "wallet_deposit",
      },
      description: `MemeSwipe wallet deposit ($${amountUsd.toFixed(2)})`,
    });

    return res.json({
      clientSecret: intent.client_secret,
      paymentIntentId: intent.id,
      amount: amountCents,
      currency,
    });
  } catch (err) {
    console.error("Apple Pay intent error:", err);
    return res.status(500).json({ error: err.message || "Failed to create Apple Pay intent" });
  }
});

app.post("/api/payments/apple-pay/confirm", async (req, res) => {
  try {
    if (!stripe) {
      return res.status(500).json({ error: "STRIPE_SECRET_KEY is not configured" });
    }
    const paymentIntentId =
      typeof req.body?.paymentIntentId === "string" ? req.body.paymentIntentId.trim() : "";
    const userId = typeof req.body?.userId === "string" ? req.body.userId.trim() : "";
    if (!paymentIntentId || !userId) {
      return res.status(400).json({ error: "paymentIntentId and userId are required" });
    }

    const intent = await stripe.paymentIntents.retrieve(paymentIntentId);
    const paid =
      intent.status === "succeeded" || intent.status === "processing" || intent.status === "requires_capture";
    if (!paid) {
      return res.status(400).json({
        error: "Payment not completed",
        status: intent.status,
      });
    }

    return res.json({
      success: true,
      paymentIntentId: intent.id,
      status: intent.status,
      amount: intent.amount,
      currency: intent.currency,
      metadata: intent.metadata || {},
    });
  } catch (err) {
    console.error("Apple Pay confirm error:", err);
    return res.status(500).json({ error: err.message || "Failed to confirm Apple Pay payment" });
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

    const prices = {};

    for (const address of addresses) {
      prices[address] = await getTokenPriceUsd(address);
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

app.post("/api/trades/open", async (req, res) => {
  try {
    await ensureOrdersTable();

    const userId = typeof req.body?.userId === "string" ? req.body.userId.trim() : "";
    const tokenAddress = typeof req.body?.tokenAddress === "string" ? req.body.tokenAddress.trim() : "";
    const walletAddress = normalizePublicKey(req.body?.walletAddress);
    const amountUsd = Number(req.body?.amountUsd);
    const slippageBpsRaw = Number(req.body?.slippageBps ?? 300);
    const slippageBps = Number.isFinite(slippageBpsRaw) ? Math.max(10, Math.min(5000, slippageBpsRaw)) : 300;
    if (!userId || !tokenAddress || !walletAddress || !Number.isFinite(amountUsd) || amountUsd <= 0) {
      return res.status(400).json({ error: "userId, walletAddress, tokenAddress and positive amountUsd are required" });
    }

    const { price: solPriceUsd } = await getSolUsdPrice();
    const inputLamports = Math.max(5_000, Math.floor((amountUsd / solPriceUsd) * 1_000_000_000));
    const reserveLamports = 2_000_000; // 0.002 SOL reserve buffer for fees/rent

    const connection = new Connection(SOLANA_RPC_URL, "confirmed");
    const balanceLamports = await connection.getBalance(new PublicKey(walletAddress), "confirmed");
    if (balanceLamports < inputLamports + reserveLamports) {
      return res.status(400).json({
        error: `Insufficient SOL for swap + fees. Balance ${(balanceLamports / 1e9).toFixed(6)} SOL, required ~${(
          (inputLamports + reserveLamports) /
          1e9
        ).toFixed(6)} SOL.`,
        details: {
          walletAddress,
          balanceLamports,
          requiredLamports: inputLamports + reserveLamports,
        },
      });
    }

    let lastError = null;
    const retrySlippage = [slippageBps, 800, 1200, 2000, 3000, 5000]
      .map((v) => Math.max(10, Math.min(5000, Number(v))))
      .filter((v, i, arr) => arr.indexOf(v) === i);

    for (const slippage of retrySlippage) {
      try {
        const { json: quoteJson, source: quoteSource } = await fetchJupiterQuote({
          inputMint: SOL_MINT,
          outputMint: tokenAddress,
          amount: String(inputLamports),
          slippageBps: String(slippage),
          swapMode: "ExactIn",
        });
        if (!quoteJson?.outAmount) throw new Error("No route found for open swap");

        const { json: swapJson, source: swapSource } = await fetchJupiterSwapTx({
          quoteResponse: quoteJson,
          userPublicKey: walletAddress,
          wrapAndUnwrapSol: true,
          dynamicComputeUnitLimit: true,
          dynamicSlippage: true,
          prioritizationFeeLamports: "auto",
        });
        if (!swapJson?.swapTransaction) throw new Error("No swap transaction returned");

        return res.json({
          success: true,
          walletAddress,
          swapTransaction: swapJson.swapTransaction,
          lastValidBlockHeight: swapJson.lastValidBlockHeight || null,
          quote: {
            inAmount: String(quoteJson.inAmount || inputLamports),
            outAmount: String(quoteJson.outAmount || "0"),
            inputMint: SOL_MINT,
            outputMint: tokenAddress,
            slippageBps: slippage,
          },
          routeSource: { quote: quoteSource, swap: swapSource },
        });
      } catch (error) {
        lastError = error;
      }
    }

    throw lastError || new Error("Unable to execute open swap");
  } catch (err) {
    console.error("Open trade swap error:", err);
    return res.status(500).json({ error: err.message || "Failed to open on-chain trade" });
  }
});

app.get("/api/orders", async (req, res) => {
  try {
    await ensureOrdersTable();
    if (AUTO_CLOSE_ENABLED) {
      void processAutoClose();
    }
    const userId = typeof req.query.userId === "string" ? req.query.userId.trim() : "";
    if (!userId) {
      return res.status(400).json({ error: "userId is required" });
    }
    const status = typeof req.query.status === "string" ? req.query.status.trim().toLowerCase() : "";
    const statusFilter = status === "open" || status === "closed" ? status : "";
    const limitRaw = Number(req.query.limit || 50);
    const limit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(200, limitRaw)) : 50;

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

    // If an on-chain close signature is supplied, allow backfilling it even when the
    // order is already in a terminal status from earlier fallback logic.
    if (closeTxSignature) {
      const scoped = await pool.query(
        `
        update orders
        set close_tx_signature = coalesce(close_tx_signature, $3),
            closed_at = coalesce(closed_at, now())
        where id = $1 and user_id = $2
        returning *
        `,
        [orderId, userId, closeTxSignature]
      );
      if (scoped.rows.length) {
        return res.json({ success: true, order: scoped.rows[0] });
      }

      const byId = await pool.query(
        `
        update orders
        set close_tx_signature = coalesce(close_tx_signature, $2),
            closed_at = coalesce(closed_at, now())
        where id = $1
        returning *
        `,
        [orderId, closeTxSignature]
      );
      if (byId.rows.length) {
        return res.json({ success: true, order: byId.rows[0] });
      }
    }

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

        // Fallback: if local app user id changed, allow close by order id for this private app flow.
        const fallback = await pool.query(
          `
          update orders
          set status = $2,
              closed_at = now(),
              close_tx_signature = coalesce($3, close_tx_signature)
          where id = $1
            and status not in ('closed', 'cancelled', 'filled')
          returning *
          `,
          [orderId, nextStatus, closeTxSignature]
        );
        if (fallback.rows.length) {
          updated = fallback.rows[0];
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

    // Kick an immediate auto-close pass right after opening a new order,
    // so TP/SL can trigger quickly instead of waiting for the periodic loop.
    if (AUTO_CLOSE_ENABLED && HAS_DATABASE_URL) {
      setTimeout(() => {
        void processAutoClose();
      }, 1200);
    }

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

app.get("/api/autoclose/status", (_req, res) => {
  return res.json({
    enabled: AUTO_CLOSE_ENABLED,
    supported: false,
    mode: "non_custodial_privy",
    intervalMs: AUTO_CLOSE_INTERVAL_MS,
    running: autoCloseRunning,
  });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, "0.0.0.0", () => {
  console.log(`API running on port ${PORT}`);
  if (!HAS_DATABASE_URL) {
    console.warn("[DB] DATABASE_URL is missing. DB-backed features (orders/auto-close) cannot run.");
  }
  void cleanupLegacyTradingWalletTable()
    .then(() => {
      console.log("[DB] legacy trading_wallets table removed");
    })
    .catch((error) => {
      console.warn("[DB] failed to remove legacy trading_wallets table", error?.message || error);
    });
  if (AUTO_CLOSE_ENABLED) {
    if (!HAS_DATABASE_URL) {
      console.warn("[AUTO_CLOSE] skipped: DATABASE_URL is missing");
      return;
    }
    console.log("[AUTO_CLOSE] configured but running in monitor-only mode for Privy non-custodial wallets", {
      intervalMs: AUTO_CLOSE_INTERVAL_MS,
    });
    setTimeout(() => {
      void processAutoClose();
    }, 2500);
    setInterval(() => {
      void processAutoClose();
    }, AUTO_CLOSE_INTERVAL_MS);
  } else {
    console.log("[AUTO_CLOSE] disabled");
  }
});
