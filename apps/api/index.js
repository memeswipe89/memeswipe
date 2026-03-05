const express = require("express");
const cors = require("cors");
const fetch = require("node-fetch");
const crypto = require("crypto");
const {
  Connection,
  Keypair,
  VersionedTransaction,
  PublicKey,
  SystemProgram,
  Transaction,
  LAMPORTS_PER_SOL,
} = require("@solana/web3.js");
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
let ensureTradingWalletsTablePromise = null;
const userFkTargetCache = new Map();
const FEED_CACHE_TTL_MS = 60 * 1000;
const feedCache = new Map();
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
const SOLANA_RPC_URL = process.env.SOLANA_RPC_URL || "https://api.mainnet-beta.solana.com";
const AUTO_CLOSE_ENABLED = String(process.env.AUTO_CLOSE_ENABLED || "false").toLowerCase() === "true";
const AUTO_CLOSE_INTERVAL_MS = Math.max(10_000, Number(process.env.AUTO_CLOSE_INTERVAL_MS || 30_000));
const AUTO_CLOSE_SLIPPAGE_RETRY_BPS = [800, 1200, 2000, 3000, 5000];
const AUTO_CLOSE_AMOUNT_BPS = [10000, 9800, 9000, 7500, 5000, 2500];
const AUTO_CLOSE_OUTPUT_MINTS = [
  SOL_MINT,
  "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", // USDC
];
let autoCloseRunning = false;
const TRADING_WALLET_TABLE = "trading_wallets";

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
      await pool.query(`alter table orders add column if not exists close_price_usd numeric`);
      await pool.query(`alter table orders add column if not exists close_pnl_usd numeric`);
      await pool.query(`alter table orders add column if not exists close_pnl_pct numeric`);
    })();
  }

  try {
    await ensureOrdersTablePromise;
  } catch (error) {
    ensureOrdersTablePromise = null;
    throw error;
  }
};

const ensureTradingWalletsTable = async () => {
  if (!ensureTradingWalletsTablePromise) {
    ensureTradingWalletsTablePromise = (async () => {
      await pool.query(`
        create table if not exists trading_wallets (
          user_id uuid primary key,
          wallet_public_key text not null unique,
          wallet_secret_encrypted text not null,
          withdraw_address text,
          created_at timestamptz not null default now(),
          updated_at timestamptz not null default now()
        )
      `);
      await pool.query(`alter table trading_wallets add column if not exists wallet_public_key text`);
      await pool.query(`alter table trading_wallets add column if not exists wallet_secret_encrypted text`);
      await pool.query(`alter table trading_wallets add column if not exists withdraw_address text`);
      await pool.query(`alter table trading_wallets add column if not exists created_at timestamptz not null default now()`);
      await pool.query(`alter table trading_wallets add column if not exists updated_at timestamptz not null default now()`);
    })();
  }

  try {
    await ensureTradingWalletsTablePromise;
  } catch (error) {
    ensureTradingWalletsTablePromise = null;
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

const getWalletEncryptionKey = () => {
  const raw = String(process.env.TRADING_WALLET_ENCRYPTION_KEY || "");
  if (!raw) {
    throw new Error("TRADING_WALLET_ENCRYPTION_KEY is not configured");
  }
  const asBase64 = (() => {
    try {
      const b = Buffer.from(raw, "base64");
      if (b.length === 32) return b;
      return null;
    } catch {
      return null;
    }
  })();
  if (asBase64) return asBase64;

  if (raw.length >= 32) {
    return crypto.createHash("sha256").update(raw).digest();
  }
  throw new Error("TRADING_WALLET_ENCRYPTION_KEY must be base64(32 bytes) or >=32 chars");
};

const encryptWalletSecret = (secretKey) => {
  const key = getWalletEncryptionKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const plaintext = JSON.stringify(Array.from(secretKey));
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return JSON.stringify({
    v: 1,
    alg: "aes-256-gcm",
    iv: iv.toString("base64"),
    tag: tag.toString("base64"),
    data: encrypted.toString("base64"),
  });
};

const decryptWalletSecret = (payload) => {
  const key = getWalletEncryptionKey();
  const parsed = JSON.parse(String(payload || ""));
  const iv = Buffer.from(parsed.iv, "base64");
  const tag = Buffer.from(parsed.tag, "base64");
  const data = Buffer.from(parsed.data, "base64");
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  const plain = Buffer.concat([decipher.update(data), decipher.final()]).toString("utf8");
  const arr = JSON.parse(plain);
  if (!Array.isArray(arr) || !arr.length) throw new Error("Invalid wallet secret payload");
  return Uint8Array.from(arr.map((n) => Number(n)));
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

const getTradingWalletRow = async (userId) => {
  const r = await pool.query(
    `select user_id, wallet_public_key, wallet_secret_encrypted, withdraw_address from trading_wallets where user_id = $1 limit 1`,
    [userId]
  );
  return r.rows[0] || null;
};

const getTradingWalletKeypair = async (userId) => {
  const row = await getTradingWalletRow(userId);
  if (!row?.wallet_secret_encrypted) return null;
  const secret = decryptWalletSecret(row.wallet_secret_encrypted);
  return {
    keypair: Keypair.fromSecretKey(secret),
    walletPublicKey: row.wallet_public_key,
    withdrawAddress: row.withdraw_address || null,
  };
};

const parseBotSecretKey = () => {
  const raw = process.env.BOT_WALLET_SECRET_KEY || "";
  if (!raw) return null;
  try {
    if (raw.trim().startsWith("[")) {
      const arr = JSON.parse(raw);
      if (!Array.isArray(arr) || !arr.length) return null;
      return Uint8Array.from(arr.map((n) => Number(n)));
    }
    const parts = raw.split(",").map((x) => Number(x.trim())).filter((n) => Number.isFinite(n));
    if (!parts.length) return null;
    return Uint8Array.from(parts);
  } catch {
    return null;
  }
};

const getBotKeypair = () => {
  const secret = parseBotSecretKey();
  if (!secret || !secret.length) {
    throw new Error("BOT_WALLET_SECRET_KEY is missing/invalid");
  }
  return Keypair.fromSecretKey(secret);
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

  tokenPriceCache.set(cacheKey, { price, ts: now });
  return price;
};

const getRawTokenBalance = async (connection, ownerPubkey, mint) => {
  const resp = await connection.getParsedTokenAccountsByOwner(ownerPubkey, { mint });
  return resp.value.reduce((sum, item) => {
    const raw = item?.account?.data?.parsed?.info?.tokenAmount?.amount;
    try {
      return sum + BigInt(String(raw || "0"));
    } catch {
      return sum;
    }
  }, 0n);
};

const closeOrderRow = async (orderId, closeTxSignature, closePriceUsd, closePnlUsd, closePnlPct) => {
  const statusOptions = ["closed", "filled", "cancelled"];
  let lastError = null;
  for (const status of statusOptions) {
    try {
      const r = await pool.query(
        `
        update orders
        set status = $2,
            closed_at = now(),
            close_tx_signature = $3,
            close_price_usd = $4,
            close_pnl_usd = $5,
            close_pnl_pct = $6
        where id = $1
          and status not in ('closed', 'cancelled')
        returning *
        `,
        [orderId, status, closeTxSignature, closePriceUsd, closePnlUsd, closePnlPct]
      );
      if (r.rows.length) return r.rows[0];
    } catch (error) {
      lastError = error;
      if (error?.code === "23514") continue;
      throw error;
    }
  }
  if (lastError) throw lastError;
  return null;
};

const processAutoClose = async () => {
  if (!AUTO_CLOSE_ENABLED || autoCloseRunning) return;
  autoCloseRunning = true;
  try {
    await ensureOrdersTable();
    await ensureTradingWalletsTable();
    const connection = new Connection(SOLANA_RPC_URL, "confirmed");

    const rows = await pool.query(
      `
      select *
      from orders
      where chain = 'solana'
        and coalesce(close_tx_signature, '') = ''
        and status not in ('closed', 'cancelled')
      order by created_at asc
      limit 25
      `
    );

    for (const order of rows.rows) {
      try {
        const tokenAddress = String(order.token_address || "").trim();
        const entryPriceUsd = Number(order.price_usd);
        const tpRoi = Number(order.tp_roi);
        const amountUsd = Number(order.amount_usd);
        if (!tokenAddress || !Number.isFinite(entryPriceUsd) || entryPriceUsd <= 0) continue;
        if (!Number.isFinite(tpRoi) || tpRoi <= 0) continue;

        const livePriceUsd = await getTokenPriceUsd(tokenAddress);
        if (!Number.isFinite(livePriceUsd) || livePriceUsd <= 0) continue;

        const pnlPct = ((livePriceUsd - entryPriceUsd) / entryPriceUsd) * 100;
        if (!Number.isFinite(pnlPct) || pnlPct < tpRoi) continue;

        const ownerWallet = await getTradingWalletKeypair(order.user_id);
        if (!ownerWallet) continue;
        const signer = ownerWallet.keypair;
        const mintBalanceRaw = await getRawTokenBalance(connection, signer.publicKey, tokenAddress);
        if (mintBalanceRaw <= 0n) continue;

        let closeSig = null;
        let lastError = null;

        for (const outputMint of AUTO_CLOSE_OUTPUT_MINTS) {
          for (const amountBps of AUTO_CLOSE_AMOUNT_BPS) {
            const amountRaw = (mintBalanceRaw * BigInt(amountBps)) / 10000n;
            if (amountRaw <= 0n) continue;
            for (const slippageBps of AUTO_CLOSE_SLIPPAGE_RETRY_BPS) {
              try {
                const { json: quoteJson } = await fetchJupiterQuote({
                  inputMint: tokenAddress,
                  outputMint,
                  amount: amountRaw.toString(),
                  slippageBps: String(slippageBps),
                  swapMode: "ExactIn",
                });
                if (!quoteJson?.outAmount) throw new Error("No route found");

                const { json: swapJson } = await fetchJupiterSwapTx({
                  quoteResponse: quoteJson,
                  userPublicKey: signer.publicKey.toBase58(),
                  wrapAndUnwrapSol: true,
                  dynamicComputeUnitLimit: true,
                  dynamicSlippage: true,
                  prioritizationFeeLamports: "auto",
                });
                if (!swapJson?.swapTransaction) throw new Error("No swap transaction");

                const tx = VersionedTransaction.deserialize(Buffer.from(swapJson.swapTransaction, "base64"));
                tx.sign([signer]);
                const signature = await connection.sendRawTransaction(tx.serialize(), {
                  skipPreflight: false,
                  maxRetries: 3,
                });
                await connection.confirmTransaction(signature, "confirmed");
                closeSig = signature;
                break;
              } catch (error) {
                lastError = error;
                continue;
              }
            }
            if (closeSig) break;
          }
          if (closeSig) break;
        }

        if (!closeSig) {
          if (lastError) {
            console.warn("[AUTO_CLOSE] close failed", {
              orderId: order.id,
              tokenAddress,
              message: lastError?.message || String(lastError),
            });
          }
          continue;
        }

        const realizedPnlUsd =
          Number.isFinite(amountUsd) && amountUsd > 0 ? (amountUsd * pnlPct) / 100 : null;
        await closeOrderRow(
          order.id,
          closeSig,
          livePriceUsd,
          Number.isFinite(realizedPnlUsd) ? realizedPnlUsd : null,
          pnlPct
        );
        console.log("[AUTO_CLOSE] order closed", {
          orderId: order.id,
          tokenAddress,
          closeSig,
          pnlPct,
        });
      } catch (error) {
        console.warn("[AUTO_CLOSE] order processing error", {
          orderId: order?.id,
          message: error?.message || String(error),
        });
      }
    }
  } catch (error) {
    console.warn("[AUTO_CLOSE] loop error", error?.message || error);
  } finally {
    autoCloseRunning = false;
  }
};

const fetchGraduatedFeed = async (req, res) => {
  try {
    const limitRaw = Number(req.query.limit || 50);
    const limit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(100, limitRaw)) : 50;
    const now = Date.now();
    const cacheKey = `dexscreener:${limit}`;
    const cached = feedCache.get(cacheKey);
    if (cached && now - cached.lastFetch < FEED_CACHE_TTL_MS) {
      return res.json(cached.payload);
    }

    const searchTerms = ["solana", "pump", "meme", "raydium"];
    const responses = await Promise.all(
      searchTerms.map((term) =>
        fetch(`https://api.dexscreener.com/latest/dex/search?q=${encodeURIComponent(term)}`)
      )
    );
    const firstFailed = responses.find((r) => !r.ok);
    if (firstFailed) {
      const text = await firstFailed.text();
      return res.status(firstFailed.status).json({
        error: "DexScreener request failed",
        details: text || null,
        tokens: [],
        cursor: null,
      });
    }

    const payloads = await Promise.all(responses.map((r) => r.json()));
    const pairs = payloads.flatMap((data) => (Array.isArray(data?.pairs) ? data.pairs : []));
    const tokensByAddress = new Map();
    const isSolLike = (token) => {
      const address = String(token?.address || "").trim();
      const symbol = String(token?.symbol || "").trim().toUpperCase();
      return address === SOL_MINT || symbol === "SOL" || symbol === "WSOL";
    };

    const pickTradeToken = (pair) => {
      const base = pair?.baseToken || null;
      const quote = pair?.quoteToken || null;
      if (base && !isSolLike(base)) return base;
      if (quote && !isSolLike(quote)) return quote;
      return base || quote || null;
    };

    for (const pair of pairs) {
      if (String(pair?.chainId || "").toLowerCase() !== "solana") continue;
      const chosen = pickTradeToken(pair);
      const address = String(chosen?.address || "").trim();
      if (!address) continue;
      const existing = tokensByAddress.get(address);
      const liquidity = Number(pair?.liquidity?.usd || 0);
      if (!existing || liquidity > Number(existing?.liquidityUsd || 0)) {
        tokensByAddress.set(address, {
          name: chosen?.name || chosen?.symbol || "Unknown",
          symbol: chosen?.symbol || "",
          address,
          priceUsd: Number(pair?.priceUsd || 0) || null,
          liquidityUsd: liquidity || null,
          volume24hUsd: Number(pair?.volume?.h24 || 0) || null,
          marketCapUsd: Number(pair?.marketCap || 0) || null,
          change24hPct: Number(pair?.priceChange?.h24 || 0) || null,
          graduatedAt: null,
        });
      }
    }
    const tokens = Array.from(tokensByAddress.values())
      .sort((a, b) => Number(b?.liquidityUsd || 0) - Number(a?.liquidityUsd || 0))
      .slice(0, limit);

    if (!tokens.length) {
      return res.json({
        tokens: [],
        cursor: null,
      });
    }
    const payload = { tokens, cursor: null };
    feedCache.set(cacheKey, { payload, lastFetch: now });
    return res.json(payload);
  } catch (e) {
    console.error(e);
    return res.status(500).json({
      error: "Failed to fetch DexScreener feed",
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

app.post("/api/trades/close/build", async (req, res) => {
  try {
    await ensureOrdersTable();
    const userId = typeof req.body?.userId === "string" ? req.body.userId.trim() : "";
    const walletAddress = typeof req.body?.walletAddress === "string" ? req.body.walletAddress.trim() : "";
    const orderId = Number(req.body?.orderId);
    const slippageBpsRaw = Number(req.body?.slippageBps ?? 300);
    const slippageBps = Number.isFinite(slippageBpsRaw) ? Math.max(10, Math.min(5000, slippageBpsRaw)) : 300;

    if (!userId || !walletAddress || !Number.isFinite(orderId) || orderId <= 0) {
      return res.status(400).json({ error: "userId, walletAddress and valid orderId are required" });
    }

    const scoped = await pool.query(
      `
      select *
      from orders
      where id = $1 and user_id = $2
      limit 1
      `,
      [orderId, userId]
    );
    const fallback = scoped.rows.length
      ? scoped
      : await pool.query(
          `
          select *
          from orders
          where id = $1
          limit 1
          `,
          [orderId]
        );
    const order = fallback.rows[0];
    if (!order) return res.status(404).json({ error: "Order not found" });
    if (String(order.status || "").toLowerCase() === "closed") {
      return res.status(400).json({ error: "Order is already closed" });
    }

    const inputMint = String(order.output_mint || order.token_address || "").trim();
    const outputMint = SOL_MINT;
    const inAmountRaw = String(order.out_amount_raw || "").trim();
    if (!inputMint || !inAmountRaw || !/^\d+$/.test(inAmountRaw) || Number(inAmountRaw) <= 0) {
      return res.status(400).json({ error: "Order is missing closeable token amount (out_amount_raw)" });
    }

    const { json: quoteJson, source: quoteSource } = await fetchJupiterQuote({
      inputMint,
      outputMint,
      amount: inAmountRaw,
      slippageBps: String(slippageBps),
      swapMode: "ExactIn",
    });
    if (!quoteJson?.outAmount) {
      return res.status(400).json({ error: "No route found for close swap" });
    }

    const { json: swapJson, source: swapSource } = await fetchJupiterSwapTx({
      quoteResponse: quoteJson,
      userPublicKey: walletAddress,
      wrapAndUnwrapSol: true,
      dynamicComputeUnitLimit: true,
      dynamicSlippage: true,
      prioritizationFeeLamports: "auto",
    });
    if (!swapJson?.swapTransaction) {
      return res.status(500).json({ error: "Jupiter returned no swap transaction for close" });
    }

    return res.json({
      success: true,
      swapTransaction: swapJson.swapTransaction,
      quote: {
        inAmount: String(quoteJson.inAmount || inAmountRaw),
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
    console.error("Close build error:", err);
    return res.status(500).json({ error: err.message || "Failed to build close transaction" });
  }
});

app.post("/api/trading-wallet/create", async (req, res) => {
  try {
    await ensureTradingWalletsTable();
    const requestedUserId = typeof req.body?.userId === "string" ? req.body.userId.trim() : "";
    if (!requestedUserId) {
      return res.status(400).json({ error: "userId is required" });
    }
    const userId = await resolveInsertUserId(TRADING_WALLET_TABLE, requestedUserId);

    const existing = await getTradingWalletRow(userId);
    if (existing?.wallet_public_key) {
      return res.json({
        success: true,
        userId,
        walletAddress: existing.wallet_public_key,
        withdrawAddress: existing.withdraw_address || null,
        created: false,
      });
    }

    const kp = Keypair.generate();
    const encrypted = encryptWalletSecret(kp.secretKey);
    const result = await pool.query(
      `
      insert into trading_wallets (user_id, wallet_public_key, wallet_secret_encrypted, created_at, updated_at)
      values ($1, $2, $3, now(), now())
      on conflict (user_id) do update
      set wallet_public_key = excluded.wallet_public_key,
          wallet_secret_encrypted = excluded.wallet_secret_encrypted,
          updated_at = now()
      returning user_id, wallet_public_key, withdraw_address
      `,
      [userId, kp.publicKey.toBase58(), encrypted]
    );

    return res.json({
      success: true,
      userId: result.rows[0].user_id,
      walletAddress: result.rows[0].wallet_public_key,
      withdrawAddress: result.rows[0].withdraw_address || null,
      created: true,
    });
  } catch (err) {
    console.error("Trading wallet create error:", err);
    return res.status(500).json({ error: err.message || "Failed to create trading wallet" });
  }
});

app.get("/api/trading-wallet/:userId", async (req, res) => {
  try {
    await ensureTradingWalletsTable();
    const userId = typeof req.params?.userId === "string" ? req.params.userId.trim() : "";
    if (!userId) return res.status(400).json({ error: "userId is required" });
    const row = await getTradingWalletRow(userId);
    if (!row?.wallet_public_key) return res.status(404).json({ error: "Trading wallet not found" });
    return res.json({
      success: true,
      userId: row.user_id,
      walletAddress: row.wallet_public_key,
      withdrawAddress: row.withdraw_address || null,
    });
  } catch (err) {
    console.error("Trading wallet fetch error:", err);
    return res.status(500).json({ error: err.message || "Failed to fetch trading wallet" });
  }
});

app.patch("/api/trading-wallet/withdraw-address", async (req, res) => {
  try {
    await ensureTradingWalletsTable();
    const userId = typeof req.body?.userId === "string" ? req.body.userId.trim() : "";
    const normalized = normalizePublicKey(req.body?.withdrawAddress);
    if (!userId || !normalized) {
      return res.status(400).json({ error: "userId and valid withdrawAddress are required" });
    }
    const r = await pool.query(
      `
      update trading_wallets
      set withdraw_address = $2, updated_at = now()
      where user_id = $1
      returning user_id, wallet_public_key, withdraw_address
      `,
      [userId, normalized]
    );
    if (!r.rows.length) return res.status(404).json({ error: "Trading wallet not found" });
    return res.json({
      success: true,
      userId: r.rows[0].user_id,
      walletAddress: r.rows[0].wallet_public_key,
      withdrawAddress: r.rows[0].withdraw_address || null,
    });
  } catch (err) {
    console.error("Withdraw address update error:", err);
    return res.status(500).json({ error: err.message || "Failed to update withdraw address" });
  }
});

app.post("/api/trading-wallet/withdraw", async (req, res) => {
  try {
    await ensureTradingWalletsTable();
    const userId = typeof req.body?.userId === "string" ? req.body.userId.trim() : "";
    const amountSol = Number(req.body?.amountSol);
    const amountLamportsInput = Number(req.body?.amountLamports);
    if (!userId) return res.status(400).json({ error: "userId is required" });
    const toAddressNormalized = normalizePublicKey(req.body?.toAddress);

    const wallet = await getTradingWalletKeypair(userId);
    if (!wallet) return res.status(404).json({ error: "Trading wallet not found" });

    const destination = toAddressNormalized || normalizePublicKey(wallet.withdrawAddress);
    if (!destination) {
      return res.status(400).json({ error: "Destination address missing. Set withdraw address first." });
    }

    const lamports =
      Number.isFinite(amountLamportsInput) && amountLamportsInput > 0
        ? Math.floor(amountLamportsInput)
        : Number.isFinite(amountSol) && amountSol > 0
          ? Math.floor(amountSol * LAMPORTS_PER_SOL)
          : 0;
    if (lamports <= 0) {
      return res.status(400).json({ error: "amountSol or amountLamports must be positive" });
    }

    const connection = new Connection(SOLANA_RPC_URL, "confirmed");
    const from = wallet.keypair.publicKey;
    const fromBalance = await connection.getBalance(from, "confirmed");
    const feeReserve = 8_000; // keep buffer for tx fee
    if (fromBalance < lamports + feeReserve) {
      return res.status(400).json({
        error: "Insufficient balance",
        details: { balanceLamports: fromBalance, requestedLamports: lamports, feeReserve },
      });
    }

    const tx = new Transaction().add(
      SystemProgram.transfer({
        fromPubkey: from,
        toPubkey: new PublicKey(destination),
        lamports,
      })
    );
    tx.feePayer = from;
    const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash("confirmed");
    tx.recentBlockhash = blockhash;
    tx.sign(wallet.keypair);
    const signature = await connection.sendRawTransaction(tx.serialize(), {
      skipPreflight: false,
      maxRetries: 3,
    });
    await connection.confirmTransaction({ signature, blockhash, lastValidBlockHeight }, "confirmed");

    const nextBalance = await connection.getBalance(from, "confirmed");
    return res.json({
      success: true,
      txSignature: signature,
      fromAddress: from.toBase58(),
      toAddress: destination,
      withdrawnLamports: lamports,
      withdrawnSol: lamports / LAMPORTS_PER_SOL,
      remainingLamports: nextBalance,
      remainingSol: nextBalance / LAMPORTS_PER_SOL,
    });
  } catch (err) {
    console.error("Withdraw error:", err);
    return res.status(500).json({ error: err.message || "Failed to withdraw" });
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
      normalizedTp <= 0 ||
      !txSignature
    ) {
      return res.status(400).json({
        error: "Missing required fields (on-chain txSignature is required)",
        details: {
          hasUserId: Boolean(userId),
          hasChain: Boolean(chain),
          hasTokenAddress: Boolean(tokenAddress),
          hasTxSignature: Boolean(txSignature),
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

app.get("/api/autoclose/status", (_req, res) => {
  let configured = true;
  try {
    getWalletEncryptionKey();
  } catch {
    configured = false;
  }
  pool
    .query(`select count(*)::int as total from trading_wallets`)
    .then((r) => {
      return res.json({
        enabled: AUTO_CLOSE_ENABLED,
        intervalMs: AUTO_CLOSE_INTERVAL_MS,
        running: autoCloseRunning,
        encryptionConfigured: configured,
        tradingWallets: r.rows[0]?.total || 0,
      });
    })
    .catch(() =>
      res.json({
        enabled: AUTO_CLOSE_ENABLED,
        intervalMs: AUTO_CLOSE_INTERVAL_MS,
        running: autoCloseRunning,
        encryptionConfigured: configured,
        tradingWallets: null,
      })
    );
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, "0.0.0.0", () => {
  console.log(`API running on port ${PORT}`);
  if (AUTO_CLOSE_ENABLED) {
    console.log("[AUTO_CLOSE] enabled", { intervalMs: AUTO_CLOSE_INTERVAL_MS });
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
