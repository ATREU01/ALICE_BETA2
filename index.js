// server.js
// ═══════════════════════════════════════════════════════════════
// ALICE ORACLE — Small-Caps SOL Scanner + 10-Layer Engine
// • Gated access
// • Real-time small-cap feed (Dexscreener SOL pairs)
// • 10-layer scoring + signals + cosmic (Moon/Kp)
// • Works on Railway (no extra deps)
// ═══════════════════════════════════════════════════════════════

const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 8080;

// ------------------------------- CONFIG -------------------------------
const FDV_LIMIT = Number(process.env.FDV_LIMIT || 500_000);   // e.g., 100_000 for ultra micro
const MIN_LIQ_USD = Number(process.env.MIN_LIQ_USD || 2_000); // filter dust
const MAX_AGE_MIN = Number(process.env.MAX_AGE_MIN || 720);   // <= 12h
const LIMIT_RESULTS = Number(process.env.LIMIT_RESULTS || 50);
const REQUIRE_PUMPFUN = (process.env.REQUIRE_PUMPFUN || 'false').toLowerCase() === 'true';

// -------------------------- GATED ACCESS SYSTEM ------------------------
const VALID_CODES = new Set([
  'ALICE2025','DIAMOND_HANDS','ALPHA_ONLY',
  'INVESTOR_001','INVESTOR_002','INVESTOR_003','INVESTOR_004','INVESTOR_005',
  'BETA_TESTER_01','BETA_TESTER_02','BETA_TESTER_03','BETA_TESTER_04','BETA_TESTER_05'
]);
const USED_CODES = new Set();

function validateAndConsumeCode(code) {
  if (!code) return { valid: false, message: 'No access code provided' };
  if (process.env.NODE_ENV === 'development' && VALID_CODES.has(code)) {
    return { valid: true, message: 'Access granted' };
  }
  if (USED_CODES.has(code)) return { valid: false, message: 'Access code already used' };
  if (!VALID_CODES.has(code)) return { valid: false, message: 'Invalid access code' };
  USED_CODES.add(code);
  return { valid: true, message: 'Access granted' };
}

// ------------------------------ HELPERS -------------------------------
function fetchJSON(url, headers = {}, timeoutMs = 9000) {
  return new Promise((resolve) => {
    const req = https.get(
      url,
      { headers: { 'User-Agent': 'Mozilla/5.0', 'Accept': 'application/json', ...headers }, timeout: timeoutMs },
      (res) => {
        let data = '';
        res.on('data', (c) => (data += c));
        res.on('end', () => {
          try {
            if (data.includes('<!DOCTYPE') || data.includes('<html')) return resolve(null);
            resolve(JSON.parse(data));
          } catch {
            resolve(null);
          }
        });
      }
    );
    req.on('timeout', () => { req.destroy(); resolve(null); });
    req.on('error', () => resolve(null));
  });
}
const minutesSince = (ms) => (Date.now() - Number(ms || 0)) / 60000;

// ---------------------------- COSMIC SIGNALS --------------------------
function getMoonPhase() {
  const now = new Date(); let y = now.getFullYear(); let m = now.getMonth() + 1; const d = now.getDate();
  let c = 0, e = 0, jd = 0, b = 0; if (m < 3) { y--; m += 12; } ++m;
  c = 365.25 * y; e = 30.6 * m; jd = c + e + d - 694039.09; jd /= 29.5305882; b = parseInt(jd); jd -= b; b = Math.round(jd * 8); if (b >= 8) b = 0;
  const phases = ['New Moon','Waxing Crescent','First Quarter','Waxing Gibbous','Full Moon','Waning Gibbous','Last Quarter','Waning Crescent'];
  const emoji = ['🌑','🌒','🌓','🌔','🌕','🌖','🌗','🌘'][b];
  return { phase: phases[b], illumination: Math.round(jd * 100), emoji };
}
async function getKpIndex() {
  const data = await fetchJSON('https://services.swpc.noaa.gov/products/noaa-planetary-k-index.json');
  if (!data || data.length < 2) return { kp: 3, level: 'Moderate' };
  const latest = data[data.length - 1]; const kp = parseFloat(latest[1]);
  let level = 'Quiet'; if (kp >= 5) level = 'Storm'; else if (kp >= 4) level = 'Active'; else if (kp >= 3) level = 'Moderate';
  return { kp, level };
}

// ---------------------------- TA + SIGNALS ----------------------------
function calculateRSI(prices, period = 14) {
  if (!prices || prices.length < period + 1) return 50;
  let gains = 0, losses = 0;
  for (let i = 1; i <= period; i++) {
    const ch = prices[i] - prices[i - 1];
    if (ch > 0) gains += ch; else losses += Math.abs(ch);
  }
  const avgGain = gains / period, avgLoss = losses / period;
  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss; return Math.round((100 - 100 / (1 + rs)) * 10) / 10;
}
function assignArchetype(score, volume, sentiment) {
  const ar = [
    { name: 'Prophet',   condition: (s,v)=>s>=90&&v>80 },
    { name: 'Seer',      condition: (s,v)=>s>=80&&v>60 },
    { name: 'Trickster', condition: (s,v,st)=>s>=70&&st<50 },
    { name: 'Observer',  condition: (s,v)=>s>=60&&v<50 },
    { name: 'Guardian',  condition: (s)=>s>=50&&s<70 },
    { name: 'Shadow',    condition: (s,v)=>s<50&&v>70 },
    { name: 'Echo',      condition: (s,v)=>s<40&&v<40 },
    { name: 'Cultist',   condition: (s)=>s<30 }
  ];
  for (const a of ar) if (a.condition(score, volume, sentiment)) return a.name;
  return 'Observer';
}
function analyze10Layers(tokenData, prices, moon, kp) {
  const layers = {};
  const namePower = (tokenData.name?.length || 0) < 12 ? 80 : 60;
  const symbolPower = (tokenData.symbol?.length || 0) < 6 ? 75 : 55;
  layers.linguistics = Math.round((namePower + symbolPower) / 2);

  const rsi = calculateRSI(prices);
  layers.technical = rsi > 70 ? 85 : rsi < 30 ? 40 : 65;

  const priceChange = tokenData.priceChange24h || 0;
  layers.momentum = priceChange > 20 ? 90 : priceChange > 0 ? 70 : 40;

  const rank = tokenData.rank || 9999;
  layers.sentiment = rank < 100 ? 85 : rank < 500 ? 65 : 45;

  const volume = tokenData.volumeUsd24h || 0;
  layers.liquidity = volume > 10_000_000 ? 85 : volume > 1_000_000 ? 65 : 45;

  const marketCap = tokenData.marketCap || 0;
  layers.whale = marketCap > 100_000_000 ? 80 : marketCap > 10_000_000 ? 60 : 40;

  const liquidityScore = tokenData.liquidityScore || 0;
  layers.orderbook = liquidityScore > 50 ? 75 : liquidityScore > 30 ? 55 : 35;

  const moonBonus = moon.phase === 'Full Moon' ? 15 : moon.phase === 'New Moon' ? -10 : 0;
  const kpBonus = kp.kp > 5 ? 10 : kp.kp < 2 ? -5 : 0;
  layers.cosmic = Math.max(0, Math.min(100, 50 + moonBonus + kpBonus));

  const volatility = Math.abs(priceChange);
  layers.risk = volatility > 50 ? 30 : volatility > 20 ? 60 : 80;

  const weights = { linguistics:.08, technical:.12, momentum:.15, sentiment:.12, liquidity:.13, whale:.10, orderbook:.10, cosmic:.10, risk:.10 };
  let master = 0; for (const [k, v] of Object.entries(layers)) if (k !== 'integration') master += v * (weights[k] || 0);
  layers.integration = Math.round(master);
  return layers;
}
function generateSignal(masterScore, rsi, priceChange) {
  if (masterScore >= 80 && rsi < 70 && priceChange > 0) return { signal: 'STRONG BUY', color: '#0f0', confidence: 95 };
  if (masterScore >= 70 && priceChange > 5) return { signal: 'BUY', color: '#0f0', confidence: 80 };
  if (masterScore >= 60) return { signal: 'ACCUMULATE', color: '#ff0', confidence: 65 };
  if (masterScore < 40 || rsi > 80) return { signal: 'SELL', color: '#f00', confidence: 70 };
  return { signal: 'HOLD', color: '#888', confidence: 50 };
}

// ------------------- DEXSCREENER SMALL-CAPS PIPELINE -------------------
async function getNewestSolPairs() {
  // Newest SOL pairs (Dexscreener)
  const r = await fetchJSON('https://api.dexscreener.com/latest/dex/search?q=solana');
  return r?.pairs || [];
}
function scorePair(p) {
  const m5 = p.txns?.m5 || { buys: 0, sells: 0 };
  const m15 = p.txns?.m15 || { buys: 0, sells: 0 };
  const momentum = (p.priceChange?.m5 ?? 0) + (p.priceChange?.h1 ?? 0);
  return (m5.buys - m5.sells) + (m15.buys - m15.sells) + (momentum / 5);
}
async function buildSmallCapsList() {
  let pairs = await getNewestSolPairs();
  pairs = pairs.filter(p => p.chainId === 'solana');

  if (REQUIRE_PUMPFUN) {
    pairs = pairs.filter(p => (p.labels || []).some(l => /pump/i.test(l)));
  }

  const list = pairs
    .filter(p => (p.fdv ?? Infinity) <= FDV_LIMIT)
    .filter(p => (p.liquidity?.usd ?? 0) >= MIN_LIQ_USD)
    .filter(p => {
      const ageMin = minutesSince(p.pairCreatedAt ?? 0);
      return Number.isFinite(ageMin) && ageMin <= MAX_AGE_MIN;
    })
    .map(p => ({ p, score: scorePair(p) }))
    .sort((a,b) => b.score - a.score)
    .slice(0, LIMIT_RESULTS)
    .map(({ p, score }) => ({
      symbol: p.baseToken?.symbol,
      name: p.baseToken?.name,
      tokenAddress: p.baseToken?.address,
      pairUrl: p.url,
      pairAddress: p.pairAddress,
      fdv: p.fdv,
      priceUsd: p.priceUsd ? Number(p.priceUsd) : null,
      liqUsd: p.liquidity?.usd,
      ageMinutes: Math.round(minutesSince(p.pairCreatedAt ?? 0)),
      txns5m: p.txns?.m5,
      txns15m: p.txns?.m15,
      change5m: p.priceChange?.m5,
      change1h: p.priceChange?.h1,
      labels: p.labels || [],
      score
    }));

  return list;
}
function synthPrices(base, m5, h1) {
  const b = Number(base || 0);
  const arr = [b * 0.98, b * 0.99, b, b * (1 + (Number(m5 || 0) / 100)), b * (1 + (Number(h1 || 0) / 100))];
  return arr.filter(x => Number.isFinite(x) && x > 0);
}
async function analyzeSmallCaps() {
  const [moon, kp] = await Promise.all([Promise.resolve(getMoonPhase()), getKpIndex()]);
  const items = await buildSmallCapsList();

  const analyzed = items.map(t => {
    const prices = synthPrices(t.priceUsd, t.change5m, t.change1h);
    const tokenData = {
      name: t.name, symbol: t.symbol,
      priceChange24h: Number(t.change1h || 0) * 2, // rough proxy
      rank: 9999,
      volumeUsd24h: (t.txns15m?.buys || 0) + (t.txns15m?.sells || 0),
      marketCap: t.fdv || 0,
      liquidityScore: Math.min(100, Math.round((t.liqUsd || 0) / 1000))
    };
    const layers = analyze10Layers(tokenData, prices, moon, kp);
    const rsi = calculateRSI(prices);
    const signal = generateSignal(layers.integration, rsi, tokenData.priceChange24h);
    const archetype = assignArchetype(layers.integration, layers.liquidity, layers.sentiment);
    return { ...t, rsi, layers, masterScore: layers.integration, signal, archetype };
  });

  analyzed.sort((a,b) => b.masterScore - a.masterScore);
  return { tokens: analyzed, cosmic: { moon, kp }, config: { FDV_LIMIT, MIN_LIQ_USD, MAX_AGE_MIN, LIMIT_RESULTS, REQUIRE_PUMPFUN } };
}

// ------------------------------ ROUTING -------------------------------
function sendJSON(res, code, obj) {
  res.writeHead(code, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type' });
  res.end(JSON.stringify(obj));
}
function serveStatic(req, res) {
  let filePath = '.' + req.url;
  if (req.url === '/' || req.url === '/index') filePath = './index.html';
  const ext = path.extname(filePath).toLowerCase();
  const types = { '.html':'text/html','.js':'text/javascript','.css':'text/css','.json':'application/json','.png':'image/png','.jpg':'image/jpeg','.gif':'image/gif','.svg':'image/svg+xml' };
  const contentType = types[ext] || 'text/html';

  fs.readFile(filePath, (err, content) => {
    if (err) {
      if (err.code === 'ENOENT') { res.writeHead(404); res.end('404 - File Not Found'); }
      else { res.writeHead(500); res.end('500 - Internal Server Error'); }
    } else {
      res.writeHead(200, { 'Content-Type': contentType });
      res.end(content, 'utf-8');
    }
  });
}

const server = http.createServer(async (req, res) => {
  // CORS preflight
  if (req.method === 'OPTIONS') return sendJSON(res, 200, { ok: true });

  // Health
  if (req.method === 'GET' && req.url === '/healthz') return sendJSON(res, 200, { ok: true });

  // Validate code
  if (req.method === 'POST' && req.url === '/api/validate-code') {
    let body = ''; req.on('data', c => body += c);
    req.on('end', () => {
      try {
        const { code } = JSON.parse(body || '{}');
        const result = validateAndConsumeCode(code);
        return sendJSON(res, result.valid ? 200 : 401, result);
      } catch {
        return sendJSON(res, 400, { valid: false, message: 'Invalid request' });
      }
    });
    return;
  }

  // Smallcaps (raw list)
  if (req.method === 'GET' && req.url.split('?')[0] === '/api/smallcaps') {
    try {
      const list = await buildSmallCapsList();
      return sendJSON(res, 200, { ok: true, count: list.length, config: { FDV_LIMIT, MIN_LIQ_USD, MAX_AGE_MIN, LIMIT_RESULTS, REQUIRE_PUMPFUN }, items: list });
    } catch (e) {
      return sendJSON(res, 500, { ok: false, error: 'smallcaps_failed' });
    }
  }

  // Analyze (10-layer over smallcaps) — keeps your original route name so UI doesn't break
  if (req.method === 'GET' && req.url.split('?')[0] === '/api/analyze') {
    try {
      const analysis = await analyzeSmallCaps();
      return sendJSON(res, 200, analysis);
    } catch (e) {
      return sendJSON(res, 500, { error: 'analysis_failed' });
    }
  }

  // Static files (your exact UI can live in index.html + assets)
  return serveStatic(req, res);
});

server.listen(PORT, () => {
  console.log('\n═══════════════════════════════════════════════════════════');
  console.log('🔮 ALICE ORACLE — Small-Caps SOL Scanner + 10-Layer Engine');
  console.log('═══════════════════════════════════════════════════════════');
  console.log(`🚀 Up on :${PORT} → /api/smallcaps · /api/analyze · /healthz`);
  console.log('✅ Gated access · contract addrs · txns · momentum · cosmic');
});
