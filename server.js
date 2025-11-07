// server.js — ALICE ORACLE (billion-grade, no deps)
// Features:
// • Gated access (one-time codes)
// • /api/smallcaps → Dexscreener SOL microcaps (FDV/Liq/Age filters) with contract addrs
// • /api/analyze   → 10-layer scoring + RSI + cosmic (Moon/Kp)
// • Fast static UI from /public with UTF-8 + security headers
// • In-memory response cache + retry/backoff + timeouts (zero external libs)
// • Health check, graceful shutdown

const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const PORT = process.env.PORT || 8080;

// ---------- CONFIG (tweak in Railway Variables) ----------
const CFG = {
  FDV_LIMIT:       Number(process.env.FDV_LIMIT || 500_000),
  MIN_LIQ_USD:     Number(process.env.MIN_LIQ_USD || 3_000),
  MAX_AGE_MIN:     Number(process.env.MAX_AGE_MIN || 720),
  LIMIT_RESULTS:   Number(process.env.LIMIT_RESULTS || 60),
  REQUIRE_PUMPFUN: (process.env.REQUIRE_PUMPFUN || 'false').toLowerCase() === 'true',
  CACHE_TTL_MS:    Number(process.env.CACHE_TTL_MS || 15_000),
  UPSTREAM_TO_MS:  Number(process.env.UPSTREAM_TO_MS || 9_000)
};

// ---------- GATE ----------
const VALID_CODES = new Set([
  'ALICE2025','DIAMOND_HANDS','ALPHA_ONLY',
  'INVESTOR_001','INVESTOR_002','INVESTOR_003','INVESTOR_004','INVESTOR_005',
  'BETA_TESTER_01','BETA_TESTER_02','BETA_TESTER_03','BETA_TESTER_04','BETA_TESTER_05'
]);
const USED_CODES = new Set();
function validateCode(code) {
  if (!code) return { valid:false, message:'No access code' };
  if (process.env.NODE_ENV === 'development' && VALID_CODES.has(code)) return { valid:true, message:'Access granted (dev)' };
  if (!VALID_CODES.has(code)) return { valid:false, message:'Invalid access code' };
  if (USED_CODES.has(code)) return { valid:false, message:'Access code already used' };
  USED_CODES.add(code);
  return { valid:true, message:'Access granted' };
}

// ---------- UTIL ----------
function json(res, code, obj) {
  res.writeHead(code, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'X-Content-Type-Options': 'nosniff'
  });
  res.end(JSON.stringify(obj));
}
function withTimeout(url, opts = {}) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { timeout: CFG.UPSTREAM_TO_MS, headers: { 'User-Agent':'Mozilla/5.0', 'Accept':'application/json' }, ...opts }, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try {
          if (data.includes('<!DOCTYPE') || data.includes('<html')) return reject(new Error('html-response'));
          resolve(JSON.parse(data));
        } catch (e) { reject(e); }
      });
    });
    req.on('timeout', () => { req.destroy(new Error('timeout')); });
    req.on('error', reject);
  });
}
async function fetchJSONWithRetry(url, attempts = 3) {
  let delay = 250;
  for (let i=0;i<attempts;i++) {
    try { return await withTimeout(url); }
    catch (e) { if (i === attempts-1) throw e; await new Promise(r=>setTimeout(r, delay)); delay *= 2; }
  }
}

// ---------- COSMIC ----------
async function getKpIndex() {
  try {
    const data = await fetchJSONWithRetry('https://services.swpc.noaa.gov/products/noaa-planetary-k-index.json');
    const last = data[data.length-1]; const kp = parseFloat(last[1]);
    return { kp, level: kp>=5?'Storm':kp>=4?'Active':kp>=3?'Moderate':'Quiet' };
  } catch { return { kp:3, level:'Moderate' }; }
}
function getMoonPhase() {
  const now = new Date(); let y=now.getFullYear(), m=now.getMonth()+1, d=now.getDate();
  let c=0,e=0,jd=0,b=0; if (m<3){y--;m+=12;} ++m; c=365.25*y; e=30.6*m; jd=c+e+d-694039.09; jd/=29.5305882; b=parseInt(jd); jd-=b; b=Math.round(jd*8); if(b>=8)b=0;
  const phases = ['New Moon','Waxing Crescent','First Quarter','Waxing Gibbous','Full Moon','Waning Gibbous','Last Quarter','Waning Crescent'];
  const emoji  = ['🌑','🌒','🌓','🌔','🌕','🌖','🌗','🌘'][b];
  return { phase: phases[b], illumination: Math.round(jd*100), emoji };
}

// ---------- TA + SIGNAL ----------
function rsi(prices, period=14) {
  if (!prices || prices.length < period+1) return 50;
  let g=0,l=0; for (let i=1;i<=period;i++){ const ch=prices[i]-prices[i-1]; if (ch>0) g+=ch; else l+=Math.abs(ch); }
  if (l===0) return 100; const RS=g/period/(l/period); return Math.round((100 - 100/(1+RS))*10)/10;
}
function archetype(score, liquidity, sentiment) {
  const A=[
    ['Prophet', s=>s>=90&&liquidity>80],
    ['Seer', s=>s>=80&&liquidity>60],
    ['Trickster', s=>s>=70&&sentiment<50],
    ['Observer', s=>s>=60&&liquidity<50],
    ['Guardian', s=>s>=50&&s<70],
    ['Shadow', s=>s<50&&liquidity>70],
    ['Echo', s=>s<40&&liquidity<40],
    ['Cultist', _=>true]
  ];
  for (const [n,f] of A) if (f(score)) return n;
}
function integrateLayers(t, prices, moon, kp) {
  const namePower   = (t.name?.length||0) < 12 ? 80 : 60;
  const symbolPower = (t.symbol?.length||0) < 6  ? 75 : 55;
  const L = {};
  L.linguistics = Math.round((namePower+symbolPower)/2);
  const R = rsi(prices);
  L.technical = R>70?85:R<30?40:65;
  const pc = t.priceChange24h||0;
  L.momentum = pc>20?90:pc>0?70:40;
  const rank=t.rank||9999; L.sentiment = rank<100?85:rank<500?65:45;
  const vol=t.volumeUsd24h||0; L.liquidity = vol>10_000_000?85:vol>1_000_000?65:45;
  const mc=t.marketCap||0; L.whale = mc>100_000_000?80:mc>10_000_000?60:40;
  const ls=t.liquidityScore||0; L.orderbook = ls>50?75:ls>30?55:35;
  const moonBonus = moon.phase==='Full Moon'?15:moon.phase==='New Moon'?-10:0;
  const kpBonus = kp.kp>5?10:kp.kp<2?-5:0; L.cosmic = Math.max(0, Math.min(100, 50+moonBonus+kpBonus));
  const volty=Math.abs(pc); L.risk = volty>50?30:volty>20?60:80;
  const W={linguistics:.08,technical:.12,momentum:.15,sentiment:.12,liquidity:.13,whale:.10,orderbook:.10,cosmic:.10,risk:.10};
  let master=0; for (const k of Object.keys(W)) master += L[k]*W[k]; L.integration=Math.round(master);
  return { layers:L, rsi:R };
}
function signal(master, rsiVal, pc) {
  if (master>=80 && rsiVal<70 && pc>0) return { signal:'STRONG BUY', color:'#0f0', confidence:95 };
  if (master>=70 && pc>5)         return { signal:'BUY',        color:'#0f0', confidence:80 };
  if (master>=60)                 return { signal:'ACCUMULATE', color:'#ff0', confidence:65 };
  if (master<40 || rsiVal>80)     return { signal:'SELL',       color:'#f00', confidence:70 };
  return { signal:'HOLD', color:'#888', confidence:50 };
}

// ---------- DEXSCREENER PIPE ----------
const cache = { smallcaps: null, smallcapsAt: 0, analyze: null, analyzeAt: 0 };

function minutesSince(ms) { return (Date.now() - Number(ms||0)) / 60000; }
function scorePair(p) {
  const m5=p.txns?.m5||{buys:0,sells:0}, m15=p.txns?.m15||{buys:0,sells:0};
  const mom=(p.priceChange?.m5??0) + (p.priceChange?.h1??0);
  return (m5.buys-m5.sells) + (m15.buys-m15.sells) + (mom/5);
}
async function getNewestSolPairs() {
  const r = await fetchJSONWithRetry('https://api.dexscreener.com/latest/dex/search?q=solana');
  return r?.pairs || [];
}
async function buildSmallcaps() {
  let pairs = await getNewestSolPairs();
  pairs = pairs.filter(p=>p.chainId==='solana');
  if (CFG.REQUIRE_PUMPFUN) pairs = pairs.filter(p => (p.labels||[]).some(l=>/pump/i.test(l)));

  return pairs
    .filter(p => (p.fdv??Infinity) <= CFG.FDV_LIMIT)
    .filter(p => (p.liquidity?.usd??0) >= CFG.MIN_LIQ_USD)
    .filter(p => { const a=minutesSince(p.pairCreatedAt??0); return Number.isFinite(a) && a <= CFG.MAX_AGE_MIN; })
    .map(p => ({ p, score: scorePair(p) }))
    .sort((a,b)=>b.score-a.score)
    .slice(0, CFG.LIMIT_RESULTS)
    .map(({p,score}) => ({
      name: p.baseToken?.name, symbol: p.baseToken?.symbol,
      tokenAddress: p.baseToken?.address, pairAddress: p.pairAddress,
      pairUrl: p.url, fdv: p.fdv, priceUsd: p.priceUsd?Number(p.priceUsd):null,
      liqUsd: p.liquidity?.usd, ageMinutes: Math.round(minutesSince(p.pairCreatedAt??0)),
      txns5m: p.txns?.m5, txns15m: p.txns?.m15, change5m: p.priceChange?.m5, change1h: p.priceChange?.h1,
      labels: p.labels||[], score
    }));
}
function synthPrices(base, m5, h1) {
  const b=Number(base||0); const arr=[b*0.98,b*0.99,b,b*(1+(Number(m5||0)/100)), b*(1+(Number(h1||0)/100))];
  return arr.filter(x=>Number.isFinite(x) && x>0);
}
async function getSmallcapsCached() {
  if (Date.now() - cache.smallcapsAt < CFG.CACHE_TTL_MS && cache.smallcaps) return cache.smallcaps;
  const items = await buildSmallcaps();
  cache.smallcaps = items; cache.smallcapsAt = Date.now();
  return items;
}
async function analyzeCached() {
  if (Date.now() - cache.analyzeAt < CFG.CACHE_TTL_MS && cache.analyze) return cache.analyze;
  const [moon, kp] = [getMoonPhase(), await getKpIndex()];
  const items = await getSmallcapsCached();
  const enriched = items.map(t=>{
    const prices = synthPrices(t.priceUsd, t.change5m, t.change1h);
    const tok = {
      name:t.name, symbol:t.symbol,
      priceChange24h:Number(t.change1h||0)*2,
      rank:9999, volumeUsd24h:(t.txns15m?.buys||0)+(t.txns15m?.sells||0),
      marketCap:t.fdv||0, liquidityScore:Math.min(100, Math.round((t.liqUsd||0)/1000))
    };
    const {layers, rsi:RSI} = integrateLayers(tok, prices, moon, kp);
    const sig = signal(layers.integration, RSI, tok.priceChange24h);
    const arch = archetype(layers.integration, layers.liquidity, layers.sentiment);
    return { ...t, rsi:RSI, layers, masterScore: layers.integration, signal: sig, archetype: arch };
  }).sort((a,b)=>b.masterScore-a.masterScore);

  const out = { tokens: enriched, cosmic: { moon:getMoonPhase(), kp: await getKpIndex() }, config: CFG };
  cache.analyze = out; cache.analyzeAt = Date.now();
  return out;
}

// ---------- STATIC ----------
const PUBLIC_DIR = path.join(__dirname, 'public');
function ctype(ext) {
  const m = { '.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8',
              '.json':'application/json; charset=utf-8','.png':'image/png','.jpg':'image/jpeg','.svg':'image/svg+xml; charset=utf-8',
              '.woff2':'font/woff2','.woff':'font/woff','.ttf':'font/ttf' };
  return m[ext] || 'text/plain; charset=utf-8';
}
function serveStatic(req, res) {
  let p = decodeURI(req.url.split('?')[0]);
  if (p === '/' || !path.extname(p)) p = '/index.html';
  const fp = path.join(PUBLIC_DIR, path.normalize(p).replace(/^(\.\.[/\\])+/, ''));
  fs.readFile(fp, (err, data) => {
    if (err) { res.writeHead(err.code==='ENOENT'?404:500, {'Content-Type':'text/plain; charset=utf-8'}); return res.end(err.code==='ENOENT'?'404':'500'); }
    const ext = path.extname(fp).toLowerCase();
    const enc = (req.headers['accept-encoding']||'').includes('gzip');
    res.setHeader('Content-Type', ctype(ext));
    res.setHeader('Cache-Control','no-store');
    res.setHeader('X-Content-Type-Options','nosniff');
    if (enc) {
      res.setHeader('Content-Encoding','gzip');
      return zlib.gzip(data, (_, zipped)=>{ res.writeHead(200); res.end(zipped); });
    }
    res.writeHead(200); res.end(data);
  });
}

// ---------- SERVER ----------
const server = http.createServer(async (req, res) => {
  if (req.method==='OPTIONS') return json(res, 200, { ok:true });
  if (req.method==='GET' && req.url==='/healthz') return json(res, 200, { ok:true });

  if (req.method==='POST' && req.url==='/api/validate-code') {
    let body=''; req.on('data', c=>body+=c);
    req.on('end', ()=>{ try { const {code} = JSON.parse(body||'{}'); const r = validateCode(code); json(res, r.valid?200:401, r); } catch { json(res,400,{valid:false,message:'Bad JSON'}) } });
    return;
  }

  if (req.method==='GET' && req.url.startsWith('/api/smallcaps')) {
    try {
      const items = await getSmallcapsCached();
      return json(res, 200, { ok:true, count:items.length, config:CFG, items });
    } catch (e) {
      return json(res, 502, { ok:false, error:'upstream', message:String(e.message||e) });
    }
  }

  if (req.method==='GET' && req.url.startsWith('/api/analyze')) {
    try { const out = await analyzeCached(); return json(res, 200, out); }
    catch (e) { return json(res, 500, { ok:false, error:'analyze_failed', message:String(e.message||e) }); }
  }

  return serveStatic(req, res);
});

process.on('SIGTERM', ()=>{ server.close(()=>process.exit(0)); });
process.on('SIGINT',  ()=>{ server.close(()=>process.exit(0)); });

server.listen(PORT, ()=> console.log(`ALICE Oracle online :${PORT}`));
