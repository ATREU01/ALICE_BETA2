// ═══════════════════════════════════════════════════════════════
// ALICE ORACLE - PUMP.FUN MICRO CAP SCANNER (PAID-GRADE)
//  - Live PumpPortal stream (fallback: Pump.fun HTTP)
//  - DexScreener enrichment (liquidity, volume, price deltas, txns)
//  - 10-Layer Analysis + spike detection
//  - Recall last 500 launches (persist to /data/launches.json)
//  - Test stub via /api/scan?test=true
// ═══════════════════════════════════════════════════════════════

const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 8080;
const ROOT_DIR = process.cwd();

// --------- static dirs for serving HTML ----------
const PUBLIC_DIR = path.join(ROOT_DIR, 'public');

// --------- persistence for recall(500) ----------
const DATA_DIR = path.join(ROOT_DIR, 'data');
const LAUNCH_FILE = path.join(DATA_DIR, 'launches.json');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

// --------- gated access (kept) ----------
const VALID_CODES = new Set([
  'ALICE2025','DIAMOND_HANDS','ALPHA_ONLY','MOON_MISSION',
  'INVESTOR_001','INVESTOR_002','INVESTOR_003','INVESTOR_004',
  'BETA_TESTER_01','BETA_TESTER_02','BETA_TESTER_03'
]);
const USED_CODES = new Set();
function validateCode(code){
  if(!code) return {valid:false,message:'No access code'};
  if(process.env.NODE_ENV==='development' && VALID_CODES.has(code)) return {valid:true,message:'Access granted (dev)'};
  if(USED_CODES.has(code)) return {valid:false,message:'Code already used'};
  if(!VALID_CODES.has(code)) return {valid:false,message:'Invalid code'};
  USED_CODES.add(code); console.log(`✅ Access: ${code}`); return {valid:true,message:'Access granted'};
}

// --------- utils ----------
function fetchJSON(url, timeout=8000){
  return new Promise((resolve)=>{
    https.get(url, { headers:{'User-Agent':'ALICE/PRO'}, timeout }, (res)=>{
      let data=''; res.on('data',c=>data+=c);
      res.on('end',()=>{ try{ resolve(JSON.parse(data)); }catch{ resolve(null); }});
    }).on('error',()=>resolve(null)).on('timeout',function(){ this.destroy(); resolve(null); });
  });
}
function loadPersistedLaunches(){
  try{ const raw=fs.readFileSync(LAUNCH_FILE,'utf8'); const arr=JSON.parse(raw); if(Array.isArray(arr)) return arr; }catch{}
  return [];
}
function savePersistedLaunches(arr){
  try{ fs.writeFileSync(LAUNCH_FILE+'.tmp', JSON.stringify(arr,null,2),'utf8'); fs.renameSync(LAUNCH_FILE+'.tmp', LAUNCH_FILE); }catch(e){ console.error('Persist fail:',e.message); }
}
function persistLaunches(newItems=[]){
  if(!Array.isArray(newItems)||!newItems.length) return;
  const existing = loadPersistedLaunches();
  const map = new Map();
  for(const it of newItems){ if(!it||!it.contract_address) continue; map.set(String(it.contract_address).toLowerCase(), it); }
  for(const it of existing){ const k=String(it.contract_address||'').toLowerCase(); if(k && !map.has(k)) map.set(k,it); }
  const merged = Array.from(map.values()).slice(0,500);
  savePersistedLaunches(merged);
}

// --------- cosmic layer ----------
function getMoonPhase(){
  const now=new Date(); let y=now.getFullYear(); let m=now.getMonth()+1; const d=now.getDate();
  if(m<3){ y--; m+=12; } m++;
  let c=365.25*y, e=30.6*m, jd=(c+e+d-694039.09)/29.5305882; let b=parseInt(jd); jd-=b; b=Math.round(jd*8); if(b>=8) b=0;
  const phases=['New Moon','Waxing Crescent','First Quarter','Waxing Gibbous','Full Moon','Waning Gibbous','Last Quarter','Waning Crescent'];
  const emoji=['🌑','🌒','🌓','🌔','🌕','🌖','🌗','🌘'][b];
  return { phase: phases[b], illumination: Math.round(jd*100), emoji };
}
async function getKpIndex(){
  const data = await fetchJSON('https://services.swpc.noaa.gov/products/noaa-planetary-k-index.json');
  if(!data || data.length<2) return { kp:3, level:'Moderate' };
  const kp = parseFloat(data[data.length-1][1]);
  return { kp, level: kp>=5?'Storm':kp>=4?'Active':'Moderate' };
}

// --------- live PumpPortal stream ----------
let latestPumpTokens = []; // {mint, name, symbol, created, ...}
function startPumpPortalStream(){
  try{
    const WebSocket = require('ws');
    const ws = new WebSocket('wss://pumpportal.fun/api/data');
    ws.on('open', ()=>{ console.log('🔌 Connected to PumpPortal WebSocket'); ws.send(JSON.stringify({ method:'subscribeNewToken' })); });
    ws.on('message', (msg)=>{
      try{
        const t = JSON.parse(msg);
        if(!t) return;
        latestPumpTokens.unshift({
          mint: t.mint,
          name: (t.name||'New Token').toString().slice(0,48),
          symbol: (t.symbol||'PUMP').toString().slice(0,16),
          created: Date.now(),
          twitter: t.twitter, telegram: t.telegram, website: t.website
        });
        if(latestPumpTokens.length>200) latestPumpTokens = latestPumpTokens.slice(0,200);
        console.log(`💎 New token: ${t.name || 'Unknown'} (${t.symbol || 'N/A'})`);
      }catch(e){ /* ignore */ }
    });
    ws.on('close', ()=>{ console.log('🔌 WebSocket disconnected, retrying in 5s'); setTimeout(startPumpPortalStream, 5000); });
    ws.on('error', (e)=>{ console.log('WS error', e.message); });
  }catch(e){ console.log('⚠️ ws package not installed; stream disabled'); }
}
startPumpPortalStream();

// --------- DexScreener enrichment ----------
async function enrichWithDexScreener(tokens){
  // tokens: [{contract_address, ...}]
  const out = [];
  // DexScreener lets /latest/dex/tokens/{addr}
  // Batch up to ~20 per scan to stay polite
  const take = tokens.slice(0, 20);
  for(const t of take){
    const addr = t.contract_address;
    if(!addr){ out.push({ ...t }); continue; }
    const url = `https://api.dexscreener.com/latest/dex/tokens/${addr}`;
    const json = await fetchJSON(url);
    let pair = null;
    if(json && Array.isArray(json.pairs) && json.pairs.length){
      // choose the most liquid SOL pair
      pair = json.pairs.sort((a,b)=> (b.liquidity?.usd||0) - (a.liquidity?.usd||0))[0];
    }
    out.push({
      ...t,
      dex: pair ? {
        pairAddress: pair.pairAddress,
        baseToken: pair.baseToken?.symbol,
        chainId: pair.chainId,
        dexId: pair.dexId,
        priceUsd: pair.priceUsd ? Number(pair.priceUsd) : null,
        fdv: pair.fdv ?? null,
        liquidityUsd: pair.liquidity?.usd ?? null,
        volume24h: pair.volume?.h24 ?? null,
        txns5m: pair.txns?.m5 ? (pair.txns.m5.buys + pair.txns.m5.sells) : null,
        txns1h: pair.txns?.h1 ? (pair.txns.h1.buys + pair.txns.h1.sells) : null,
        priceChange: {
          m5: pair.priceChange?.m5 ?? null,
          h1: pair.priceChange?.h1 ?? null,
          h6: pair.priceChange?.h6 ?? null,
          h24: pair.priceChange?.h24 ?? null
        },
        pairCreatedAt: pair.pairCreatedAt ?? null
      } : null
    });
  }
  return out;
}

// --------- 10-Layer Analysis ----------
function score10Layers(t, cosmic){
  // helpers
  const clamp = (v,min,max)=>Math.max(min, Math.min(max, v));
  const dex = t.dex || {};
  const fdv = Number(dex.fdv ?? t.fdv ?? 0);
  const liq = Number(dex.liquidityUsd ?? t.liquidity ?? 0);
  const vol = Number(dex.volume24h ?? t.volume_24h ?? 0);
  const age = Number(t.age_minutes ?? 0);
  const tx5 = Number(dex.txns5m ?? 0);
  const tx1 = Number(dex.txns1h ?? 0);
  const pc5 = Number(dex.priceChange?.m5 ?? 0);
  const pc1 = Number(dex.priceChange?.h1 ?? 0);
  const pc24 = Number(dex.priceChange?.h24 ?? 0);
  const holders = Number(t.holders ?? 0);

  // Layer scores 0..100 (heuristics tuned for micro caps)
  const L = [];
  // 1) FDV (lower is better early)
  const sFDV = fdv<=15000?95:fdv<=50000?80:fdv<=150000?60:fdv<=500000?40:20;
  L.push({name:'FDV', score:sFDV, value: fdv ? `$${fdv.toLocaleString()}`:'—'});

  // 2) Age
  const sAge = age<=5?95:age<=15?85:age<=60?70:age<=180?55:35;
  L.push({name:'Age', score:sAge, value:`${age}m`});

  // 3) Pump (recent burst; 5m & 1h)
  const pumpComposite = (pc5*2 + pc1)/3;
  const sPump = clamp(50 + pumpComposite, 0, 100);
  L.push({name:'Pump', score:sPump, value: `${pumpComposite.toFixed(1)}%`});

  // 4) Liquidity
  const sLiq = liq>=60000?90:liq>=30000?75:liq>=10000?60:liq>=3000?40:20;
  L.push({name:'Liquidity', score:sLiq, value: liq?`$${Math.round(liq).toLocaleString()}`:'—'});

  // 5) Volume (24h)
  const sVol = vol>=250000?90:vol>=100000?75:vol>=30000?60:vol>=5000?45:25;
  L.push({name:'Volume', score:sVol, value: vol?`$${Math.round(vol).toLocaleString()}`:'—'});

  // 6) Holders (if known; otherwise neutral 55)
  const sHolders = holders? clamp(30 + Math.log10(holders+1)*20, 35, 85) : 55;
  L.push({name:'Holders', score:sHolders, value: holders||'—'});

  // 7) Transactions (5m / 1h)
  const txnPulse = tx5*4 + tx1;
  const sTx = txnPulse>=150?90:txnPulse>=70?75:txnPulse>=25?60:txnPulse>=8?45:30;
  L.push({name:'Transactions', score:sTx, value: tx5?`${tx5} (5m)`:'—'});

  // 8) Momentum (blend of deltas with volume weight)
  const momentum = (pc5*3 + pc1*2 + pc24)/6 + (vol? Math.min(30, Math.log10(vol+10)*8):0);
  const sMom = clamp(50 + momentum, 0, 100);
  L.push({name:'Momentum', score:sMom, value: `Δ5m ${pc5.toFixed(1)}%`});

  // 9) Risk (inverse of liquidity + drawdowns)
  const riskBase = 100 - sLiq; // low liq => high risk
  const ddPenalty = pc24<-30 ? 20 : pc1<-20 ? 12 : pc5<-10 ? 8 : 0;
  const sRisk = clamp(100 - (riskBase + ddPenalty), 5, 95);
  L.push({name:'Risk', score:sRisk, value: sRisk>70?'Low':'High'});

  // 10) Alpha (cosmic edge + price action blend)
  const moonBoost = (cosmic.moon.phase==='Full Moon' || cosmic.moon.phase==='New Moon') ? 6 : 0;
  const kpDrag = cosmic.kp.kp>=5 ? -8 : cosmic.kp.kp>=4 ? -3 : 0;
  const alpha = clamp(55 + (pc1/3) + moonBoost + kpDrag, 0, 100);
  L.push({name:'Alpha', score:alpha, value:`${alpha.toFixed(0)}`});

  // Final score: weighted
  const final =
      sFDV*0.14 + sAge*0.10 + sPump*0.12 + sLiq*0.14 + sVol*0.12 +
      sHolders*0.06 + sTx*0.10 + sMom*0.10 + sRisk*0.06 + alpha*0.06;

  // Recommendation
  let recommendation = '👀 WATCH — early';
  if (final >= 82 && pc5 >= 5 && sLiq >= 60) recommendation = '🔥 HOT — momentum building';
  else if (final >= 70) recommendation = '📈 ACCUMULATE — promising';
  else if (final <= 50) recommendation = '⚠️ RISKY — illiquid';

  // Spike flag (for the “pay for” feel)
  const spiking = pc5 >= 8 && tx5 >= 15 && sLiq >= 60;

  return {
    score: Math.round(final),
    pump_percent: pc5,
    spiking,
    analysis: {
      recommendation,
      layers: L
    }
  };
}

// --------- base discovery (Pump fun + stream fallback) ----------
async function discoverBaseTokens(){
  const results = [];

  // Use live stream cache first
  for (const token of latestPumpTokens.slice(0, 40)) {
    const ageMinutes = Math.floor((Date.now() - token.created) / 60000);
    results.push({
      name: token.name,
      symbol: (token.symbol||'').toUpperCase(),
      contract_address: token.mint,
      age_minutes: ageMinutes,
      holders: null, // not known here
      fdv: null,
      liquidity: null,
      volume_24h: null,
      first_seen: token.created
    });
  }

  // HTTP fallback if too few
  if (results.length < 10) {
    const pump = await fetchJSON('https://frontend-api.pump.fun/coins/latest');
    if (pump && Array.isArray(pump)) {
      for (const t of pump.slice(0, 50)) {
        const age = Math.floor((Date.now() - (t.created_timestamp || Date.now()-3600000))/60000);
        results.push({
          name: t.name || 'Pump Token',
          symbol: (t.symbol||'PUMP').toUpperCase(),
          contract_address: t.mint || t.address,
          age_minutes: age,
          holders: t.holder_count ?? null,
          fdv: t.usd_market_cap ?? t.market_cap ?? null,
          liquidity: null,
          volume_24h: t.volume ?? null,
          first_seen: Date.now()
        });
      }
    }
  }

  // Deduplicate by address & keep newest
  const map = new Map();
  for (const r of results) {
    if(!r.contract_address) continue;
    const k = r.contract_address.toLowerCase();
    if(!map.has(k)) map.set(k, r);
  }
  return Array.from(map.values()).slice(0, 40);
}

// --------- main scan ----------
async function runScan(){
  const [moon, kp] = [getMoonPhase(), await getKpIndex()];
  const base = await discoverBaseTokens();
  const enriched = await enrichWithDexScreener(base);

  const scored = enriched.map(t=>{
    const S = score10Layers(t, { moon, kp });
    return { ...t, ...S };
  });

  // keep only micro/low caps if fdv known else include
  const filtered = scored
    .filter(t => !t.dex || t.dex.fdv==null || t.dex.fdv<=500000)
    .sort((a,b)=> (a.age_minutes||9999)-(b.age_minutes||9999))
    .slice(0, 20);

  // persist for recall
  try { persistLaunches(filtered); } catch(e){}

  return { tokens: filtered, cosmic: { moon, kp } };
}

// --------- HTTP server ----------
const contentTypes = {
  '.html':'text/html; charset=utf-8','.js':'application/javascript; charset=utf-8',
  '.css':'text/css; charset=utf-8','.png':'image/png','.jpg':'image/jpeg',
  '.jpeg':'image/jpeg','.svg':'image/svg+xml','.json':'application/json; charset=utf-8'
};
function serveFile(req, res){
  let reqPath = decodeURIComponent(req.url.split('?')[0] || '/');
  if (reqPath==='/' ) reqPath='/index.html';
  if (reqPath==='/alice-scanner') reqPath='/alice-scanner.html';
  reqPath = reqPath.replace(/\.\./g,'');
  const tryPaths = [ path.join(ROOT_DIR, reqPath.startsWith('/')?reqPath.slice(1):reqPath),
                     path.join(PUBLIC_DIR, path.basename(reqPath)) ];
  for(const p of tryPaths){
    try{
      const st = fs.statSync(p); if(st.isFile()){
        const ext = path.extname(p); res.writeHead(200,{'Content-Type':contentTypes[ext]||'text/plain'});
        return res.end(fs.readFileSync(p));
      }
    }catch{}
  }
  res.writeHead(404,{'Content-Type':'text/plain; charset=utf-8'}); res.end('404');
}

const server = http.createServer(async (req,res)=>{
  res.setHeader('Access-Control-Allow-Origin','*');
  res.setHeader('Access-Control-Allow-Methods','GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers','Content-Type');
  if(req.method==='OPTIONS'){ res.writeHead(200); return res.end(); }

  // health
  if (req.url.startsWith('/health')) {
    res.writeHead(200,{'Content-Type':'application/json'});
    return res.end(JSON.stringify({ok:true, service:'ALICE Oracle', version:'PRO'}));
  }

  // validate code
  if (req.method==='POST' && req.url==='/api/validate-code'){
    let body=''; req.on('data',c=>body+=c); req.on('end',()=>{
      try{ const {code}=JSON.parse(body||'{}'); const result=validateCode(code);
        res.writeHead(result.valid?200:401,{'Content-Type':'application/json'}); res.end(JSON.stringify(result));
      }catch{ res.writeHead(400,{'Content-Type':'application/json'}); res.end(JSON.stringify({valid:false,message:'Bad request'})); }
    }); return;
  }

  // recall last 500
  if (req.method==='GET' && req.url.split('?')[0]==='/api/recall'){
    const all = loadPersistedLaunches();
    const qs = new URLSearchParams((req.url.split('?')[1]||'')); const limit = Math.min(500, parseInt(qs.get('limit')||'500'));
    res.writeHead(200,{'Content-Type':'application/json'});
    return res.end(JSON.stringify({ success:true, count: all.length, tokens: all.slice(0,limit) }));
  }

  // main scan (live)
  if (req.method==='GET' && req.url.split('?')[0]==='/api/scan'){
    const isTest = /\btest=true\b/i.test(req.url);
    if (isTest){
      // quick stub to prove UI
      return res.writeHead(200,{'Content-Type':'application/json'}).end(JSON.stringify({
        success:true, tokens:[
          { name:'Duolingo Inc', symbol:'DUOL', contract_address:'DUOL_FAKE_ADDR', age_minutes:9,
            fdv:245000, holders:143, pump_percent:58, score:81, spiking:true,
            analysis:{ recommendation:'🔥 HOT — momentum building',
              layers:[
                {name:'FDV',score:78,value:'$245,000'},
                {name:'Age',score:92,value:'9m'},
                {name:'Pump',score:82,value:'+12.4%'},
                {name:'Liquidity',score:70,value:'$42k'},
                {name:'Volume',score:72,value:'$180k'},
                {name:'Holders',score:65,value:'143'},
                {name:'Transactions',score:68,value:'21 (5m)'},
                {name:'Momentum',score:74,value:'Δ5m 12.4%'},
                {name:'Risk',score:66,value:'Med'},
                {name:'Alpha',score:71,value:'71'}
              ]
            },
            dex:{ priceChange:{m5:12.4}, liquidityUsd:42000, volume24h:180000, fdv:245000 }
          }
        ],
        cosmic:{ moon:getMoonPhase(), kp:{kp:3, level:'Moderate'} }
      }));
    }
    try{
      const data = await runScan();
      res.writeHead(200,{'Content-Type':'application/json'});
      return res.end(JSON.stringify({ success:true, ...data }));
    }catch(e){
      res.writeHead(500,{'Content-Type':'application/json'});
      return res.end(JSON.stringify({ success:false, error:'Scan failed', message:e.message }));
    }
  }

  // serve UI
  return serveFile(req,res);
});

server.listen(PORT, ()=>{
  console.log('\n═══════════════════════════════════════════════════════════');
  console.log('💎 ALICE ORACLE — PRO SCANNER running');
  console.log(`🚀 http://localhost:${PORT}`);
  console.log('═══════════════════════════════════════════════════════════\n');
});
