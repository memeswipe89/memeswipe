const express = require("express");
const cors = require("cors");
const fetch = require("node-fetch");
require("dotenv").config();

const { Pool } = require("pg");

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

const app = express();
app.use(express.json());
app.use(cors());

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
