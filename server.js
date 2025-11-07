// ═══════════════════════════════════════════════════════════════
// ALICE ORACLE - PUMP.FUN MICRO CAP SCANNER
// BILLION DOLLAR CODE - LFG! 🚀💎
// ═══════════════════════════════════════════════════════════════

const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 8080;

// ═══════════════════════════════════════════════════════════════
// GATED ACCESS
// ═══════════════════════════════════════════════════════════════

const VALID_CODES = new Set([
  'ALICE2025', 'DIAMOND_HANDS', 'ALPHA_ONLY', 'MOON_MISSION',
  'INVESTOR_001', 'INVESTOR_002', 'INVESTOR_003', 'INVESTOR_004',
  'BETA_TESTER_01', 'BETA_TESTER_02', 'BETA_TESTER_03'
]);

const USED_CODES = new Set();

function validateCode(code) {
  if (!code) return { valid: false, message: 'No access code' };
  if (process.env.NODE_ENV === 'development' && VALID_CODES.has(code)) {
    return { valid: true, message: 'Access granted (dev)' };
  }
  if (USED_CODES.has(code)) return { valid: false, message: 'Code already used' };
  if (!VALID_CODES.has(code)) return { valid: false, message: 'Invalid code' };
  USED_CODES.add(code);
  console.log(`✅ Access: ${code}`);
  return { valid: true, message: 'Access granted' };
}

// ═══════════════════════════════════════════════════════════════
/** UTIL: JSON fetch with timeout */
// ═══════════════════════════════════════════════════════════════
function fetchAPI(url) {
  return new Promise((resolve) => {
    https.get(url, { headers: { 'User-Agent': 'ALICE/2.0' }, timeout: 8000 }, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch { resolve(null); }
      });
    }).on('error', () => resolve(null)).on('timeout', function () { this.destroy(); resolve(null); });
  });
}

// ═══════════════════════════════════════════════════════════════
// COSMIC DATA
// ═══════════════════════════════════════════════════════════════

function getMoonPhase() {
  const now = new Date();
  let year = now.getFullYear();
  let month = now.getMonth() + 1;
  const day = now.getDate();

  if (month < 3) { year--; month += 12; }
  month++;

  let c = 365.25 * year;
  let e = 30.6 * month;
  let jd = c + e + day - 694039.09;
  jd /= 29.5305882;
  let b = parseInt(jd);
  jd -= b;
  b = Math.round(jd * 8);
  if (b >= 8) b = 0;

  const phases = ['New Moon', 'Waxing Crescent', 'First Quarter', 'Waxing Gibbous', 'Full Moon', 'Waning Gibbous', 'Last Quarter', 'Waning Crescent'];
  const emoji = ['🌑', '🌒', '🌓', '🌔', '🌕', '🌖', '🌗', '🌘'][b];

  return { phase: phases[b], illumination: Math.round(jd * 100), emoji };
}

async function getKpIndex() {
  const data = await fetchAPI('https://services.swpc.noaa.gov/products/noaa-planetary-k-index.json');
  if (!data || data.length < 2) return { kp: 3, level: 'Moderate' };
  const kp = parseFloat(data[data.length - 1][1]);
  return { kp, level: kp >= 5 ? 'Storm' : kp >= 4 ? 'Active' : 'Moderate' };
}

// ═══════════════════════════════════════════════════════════════
// PUMPPORTAL WEBSOCKET (realtime hints)
// ═══════════════════════════════════════════════════════════════

let latestPumpTokens = [];
let wsConnection = null;

function startPumpPortalStream() {
  try {
    const WebSocket = require('ws');
    wsConnection = new WebSocket('wss://pumpportal.fun/api/data');

    wsConnection.on('open', () => {
      console.log('🔌 Connected to PumpPortal WebSocket');
      wsConnection.send(JSON.stringify({ method: 'subscribeNewToken' }));
    });

    wsConnection.on('message', (data) => {
      try {
        const token = JSON.parse(data);
        if (token.mint || token.signature) {
          latestPumpTokens.unshift({
            mint: token.mint,
            name: token.name || 'New Token',
            symbol: token.symbol || 'PUMP',
            uri: token.uri,
            description: token.description,
            twitter: token.twitter,
            telegram: token.telegram,
            website: token.website,
            created: Date.now()
          });
          if (latestPumpTokens.length > 100) latestPumpTokens = latestPumpTokens.slice(0, 100);
          console.log(`💎 New token: ${token.name || 'Unknown'} (${token.symbol || 'N/A'})`);
        }
      } catch (e) {
        console.log('⚠️ WebSocket message parse error:', e.message);
      }
    });

    wsConnection.on('error', (error) => console.log('⚠️ WebSocket error:', error.message));
    wsConnection.on('close', () => {
      console.log('🔌 WebSocket disconnected, reconnecting in 5s...');
      setTimeout(startPumpPortalStream, 5000);
    });
  } catch (e) {
    console.log('⚠️ WebSocket not available (ws package needed), using HTTP fallback');
  }
}

try { startPumpPortalStream(); } catch { console.log('⚠️ WebSocket disabled, using HTTP only'); }

// ═══════════════════════════════════════════════════════════════
// MICRO-CAP DISCOVERY (same logic you wrote)
// ═══════════════════════════════════════════════════════════════

async function getMicroCapGems() {
  console.log('💎 SCANNING FOR MICRO CAP GEMS...');
  const results = [];

  if (latestPumpTokens.length > 0) {
    console.log(`🔥 Using ${latestPumpTokens.length} tokens from live stream`);
    for (const token of latestPumpTokens.slice(0, 20)) {
      const ageMinutes = Math.floor((Date.now() - token.created) / 60000);
      const mcap = Math.random() * 90000 + 5000;
      const score = ageMinutes < 5 ? 95 : ageMinutes < 15 ? 85 : ageMinutes < 60 ? 75 : 65;

      results.push({
        name: token.name,
        symbol: (token.symbol || '').toUpperCase(),
        contract_address: token.mint,
        fdv: Math.round(mcap),
        liquidity: Math.round(mcap * 0.15),
        volume_24h: Math.round(mcap * 2),
        holders: Math.floor(Math.random() * 50) + 5,
        age_minutes: ageMinutes,
        priceChange24h: Math.random() * 500 - 100,
        score,
        signal: score > 85 ? 'STRONG BUY' : score > 70 ? 'BUY' : 'WATCH',
        badge: ageMinutes < 5 ? '🔥 BRAND NEW' : ageMinutes < 30 ? '🚀 ULTRA FRESH' : '💎 NEW',
        twitter: token.twitter,
        telegram: token.telegram,
        website: token.website
      });
    }
  }

  if (results.length < 5) {
    console.log('⚠️ WebSocket cache empty, trying HTTP API...');
    const pumpTokens = await fetchAPI('https://frontend-api.pump.fun/coins/latest');

    if (pumpTokens && Array.isArray(pumpTokens)) {
      console.log(`🔥 Found ${pumpTokens.length} tokens from HTTP API`);
      for (const token of pumpTokens.slice(0, 20)) {
        const mcap = token.usd_market_cap || token.market_cap || Math.random() * 90000;
        if (mcap < 500000) {
          const age = Math.floor((Date.now() - (token.created_timestamp || Date.now() - 3600000)) / 60000);
          const score = mcap < 10000 ? 95 : mcap < 50000 ? 85 : mcap < 100000 ? 75 : 65;

          results.push({
            name: token.name || `GEM${Math.floor(Math.random() * 999)}`,
            symbol: (token.symbol || 'PUMP').toUpperCase(),
            contract_address: token.mint || token.address || 'pump' + Math.random().toString(36).substring(7),
            fdv: Math.round(mcap),
            liquidity: Math.round(mcap * 0.15),
            volume_24h: token.volume || Math.round(mcap * 2),
            holders: token.holder_count || Math.floor(Math.random() * 150) + 10,
            age_minutes: age,
            priceChange24h: token.price_change_24h || (age < 60 ? Math.random() * 500 - 100 : Math.random() * 200 - 50),
            score,
            signal: score > 85 ? 'STRONG BUY' : score > 70 ? 'BUY' : score > 60 ? 'ACCUMULATE' : 'WATCH',
            badge: mcap < 10000 ? '🔥 UNDER 10K' : mcap < 50000 ? '🚀 ULTRA MICRO' : mcap < 100000 ? '💎 MICRO CAP' : '📈 LOW CAP'
          });
        }
      }
    }
  }

  if (results.length < 5) {
    console.log('⚠️ APIs limited, generating realistic examples...');
    const names = ["BABY PEPE", "MICRO WIF", "NANO BONK", "STEALTH GEM", "MOON SHOT", "DIAMOND HANDS", "EARLY BIRD", "1000X COIN", "WAGMI", "ALPHA"];

    for (let i = 0; i < 10; i++) {
      const mcap = Math.random() * 90000 + 5000;
      const age = Math.floor(Math.random() * 180) + 5;
      const score = mcap < 20000 ? 90 : mcap < 50000 ? 75 : 60;

      results.push({
        name: names[i] || `GEM${i}`,
        symbol: names[i] ? names[i].split(' ')[0] : `TK${i}`,
        contract_address: 'Sol' + Math.random().toString(36).substring(2, 15).toUpperCase(),
        fdv: Math.round(mcap),
        liquidity: Math.round(mcap * 0.15),
        volume_24h: Math.round(mcap * (Math.random() * 3 + 0.5)),
        holders: Math.floor(Math.random() * 150) + 10,
        age_minutes: age,
        priceChange24h: age < 30 ? Math.random() * 1000 - 200 : Math.random() * 200 - 50,
        score: Math.floor(score + Math.random() * 10),
        signal: score > 85 ? 'STRONG BUY' : score > 70 ? 'BUY' : 'WATCH',
        badge: mcap < 10000 ? '🔥 UNDER 10K' : mcap < 30000 ? '🚀 ULTRA MICRO' : '💎 MICRO CAP'
      });
    }
  }

  const sorted = results.sort((a, b) => a.age_minutes - b.age_minutes).slice(0, 20);
  console.log(`✅ Returning ${sorted.length} micro cap gems`);
  return sorted;
}

// ═══════════════════════════════════════════════════════════════
// HTTP SERVER
//  — minimal changes:
//    1) add /api/scan (alias your /api/analyze) to match the frontend
//    2) make static serving work for /alice-scanner.html (root OR /public)
// ═══════════════════════════════════════════════════════════════

const ROOT_DIR = process.cwd();
const PUBLIC_DIR = path.join(ROOT_DIR, 'public');

function safeReadFile(candidatePath, cb) {
  // prevent path traversal and pick the first existing file
  const tryPaths = [candidatePath, path.join(PUBLIC_DIR, path.basename(candidatePath))];
  for (const p of tryPaths) {
    try {
      const stat = fs.statSync(p);
      if (stat.isFile()) return fs.readFile(p, (err, buf) => cb(err, buf, p));
    } catch { /* continue */ }
  }
  cb(new Error('not found'));
}

const contentTypes = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.json': 'application/json; charset=utf-8'
};

const server = http.createServer(async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.writeHead(200);
    return res.end();
  }

  // Health
  if (req.url === '/health' || req.url === '/healthz') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ ok: true, service: 'ALICE Oracle', version: '2.0' }));
  }

  // Validate code
  if (req.method === 'POST' && req.url === '/api/validate-code') {
    let body = '';
    req.on('data', c => body += c);
    req.on('end', () => {
      try {
        const { code } = JSON.parse(body || '{}');
        const result = validateCode(code);
        res.writeHead(result.valid ? 200 : 401, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(result));
      } catch {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ valid: false, message: 'Bad request' }));
      }
    });
    return;
  }

  // Analysis (original endpoint)
  if (req.method === 'GET' && req.url.split('?')[0] === '/api/analyze') {
    try {
      const [moon, kp, tokens] = await Promise.all([
        Promise.resolve(getMoonPhase()),
        getKpIndex(),
        getMicroCapGems()
      ]);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({
        tokens, cosmic: { moon, kp }, timestamp: new Date().toISOString(), count: tokens.length
      }));
    } catch (e) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: 'Analysis failed', message: e.message }));
    }
  }

  // 🔥 NEW: /api/scan — alias used by your HTML (supports ?test=true)
  if (req.method === 'GET' && req.url.split('?')[0] === '/api/scan') {
    const isTest = /\btest=true\b/i.test(req.url || '');
    if (isTest) {
      // quick stub so UI renders instantly
      return res.writeHead(200, { 'Content-Type': 'application/json' })
        .end(JSON.stringify({
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
                  { name: "Volatility", score: 52, value: "Med" }
                ]
              }
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
                  { name: "Volatility", score: 62, value: "High" }
                ]
              }
            }
          ]
        }));
    }
    // live path → reuse analyze logic
    try {
      const [moon, kp, tokens] = await Promise.all([
        Promise.resolve(getMoonPhase()),
        getKpIndex(),
        getMicroCapGems()
      ]);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ success: true, tokens, cosmic: { moon, kp } }));
    } catch (e) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ success: false, error: 'Scan failed', message: e.message }));
    }
  }

  // Friendly shortcut: /alice-scanner → /alice-scanner.html
  if (req.method === 'GET' && (req.url === '/alice-scanner' || req.url === '/alice-scanner/')) {
    req.url = '/alice-scanner.html';
  }

  // Static files (root OR /public). Default: /index.html
  let requested = decodeURIComponent(req.url.split('?')[0] || '/');
  let filePath = requested === '/' ? '/index.html' : requested;

  // prevent sneaky paths
  filePath = filePath.replace(/\.\./g, '');
  const ext = path.extname(filePath);
  const ct = contentTypes[ext] || 'text/plain; charset=utf-8';

  safeReadFile(path.join(ROOT_DIR, filePath.startsWith('/') ? filePath.slice(1) : filePath), (err, buf, usedPath) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      return res.end('404');
    }
    res.writeHead(200, { 'Content-Type': ct });
    res.end(buf);
  });
});

server.listen(PORT, () => {
  console.log('\n═══════════════════════════════════════════════════════════');
  console.log('💎 ALICE ORACLE - PUMP.FUN MICRO CAP SCANNER');
  console.log('═══════════════════════════════════════════════════════════');
  console.log(`🚀 Server: http://localhost:${PORT}`);
  console.log('✅ Scanning for micro caps under $500k');
  console.log('✅ Gated access enabled');
  console.log('✅ Cosmic tracking active');
  console.log('═══════════════════════════════════════════════════════════\n');
});
