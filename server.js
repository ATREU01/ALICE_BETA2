// server.js — ALICE ORACLE (Railway safe, serves /alice-scanner.html + /api/scan)
import express from "express";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 8080;

// ---------- STATIC ASSETS ----------
const PUBLIC_DIR = path.join(__dirname, "public");
app.use(express.static(PUBLIC_DIR));

// Serve the scanner by path or with .html
app.get(["/alice-scanner", "/alice-scanner.html"], (_req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, "alice-scanner.html"));
});

// ---------- API (minimal test stub) ----------
/*
  Your HTML calls:  GET /api/scan?test=true
  This stub returns fake data when ?test=true so the UI renders immediately.
  Wire your real scanner later by replacing the non-test branch.
*/
app.get("/api/scan", (req, res) => {
  const { test } = req.query;
  if (String(test) === "true") {
    return res.json({
      success: true,
      tokens: [
        {
          name: "Duolingo Inc",
          symbol: "DUOL",
          contract_address: "DUOL_FAKE_ADDR",
          score: 81,
          fdv: 245000,
          age_minutes: 9,
          bonding_curve: 62.3,
          holders: 143,
          pump_percent: 58,
          analysis: {
            recommendation: "🔥 HOT — momentum building",
            layers: [
              { name: "Momentum", score: 84, value: "High" },
              { name: "Liquidity", score: 71, value: "$42k" },
              { name: "Holders", score: 65, value: "143" },
              { name: "Volatility", score: 52, value: "Med" },
            ],
          },
        },
        {
          name: "ZestyCash",
          symbol: "ZECSTY",
          contract_address: "ZECSTY_FAKE_ADDR",
          score: 69,
          fdv: 120000,
          age_minutes: 22,
          bonding_curve: 40.1,
          holders: 88,
          pump_percent: 33,
          analysis: {
            recommendation: "👀 WATCH — early",
            layers: [
              { name: "Momentum", score: 60, value: "Rising" },
              { name: "Liquidity", score: 48, value: "$18k" },
              { name: "Holders", score: 55, value: "88" },
              { name: "Volatility", score: 62, value: "High" },
            ],
          },
        },
      ],
    });
  }

  // TODO: plug in your live data here (replace with your real scanner output)
  return res.json({ success: true, tokens: [] });
});

// ---------- ROOT ----------
app.get("/", (_req, res) => {
  // Simple landing so root isn’t a 404
  res.send(
    `<html><body style="background:#000;color:#0ff;font-family:monospace;padding:20px">
      <h2>ALICE ORACLE</h2>
      <p>Scanner at <a style="color:#0ff" href="/alice-scanner.html">/alice-scanner.html</a></p>
    </body></html>`
  );
});

// ---------- START ----------
app.listen(PORT, () => {
  console.log("═══════════════════════════════════════════════════════════");
  console.log("💎 ALICE ORACLE - PUMP.FUN MICRO CAP SCANNER");
  console.log("═══════════════════════════════════════════════════════════");
  console.log(`🚀 Server: http://localhost:${PORT}`);
  console.log("✅ Static serving enabled (public/)");
  console.log("✅ /alice-scanner.html mounted");
  console.log("✅ /api/scan ready (test stub)");
  console.log("═══════════════════════════════════════════════════════════");
});
