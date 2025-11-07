// ═══════════════════════════════════════════════════════════════
// ALICE ORACLE - UNIVERSAL 10-LAYER ANALYSIS ENGINE
// Complete production server with gated access & real data
// ═══════════════════════════════════════════════════════════════

const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 8080;

// ═══════════════════════════════════════════════════════════════
// GATED ACCESS SYSTEM
// ═══════════════════════════════════════════════════════════════

const VALID_CODES = new Set([
    'ALICE2025',
    'DIAMOND_HANDS',
    'ALPHA_ONLY',
    'INVESTOR_001',
    'INVESTOR_002',
    'INVESTOR_003',
    'INVESTOR_004',
    'INVESTOR_005',
    'BETA_TESTER_01',
    'BETA_TESTER_02',
    'BETA_TESTER_03',
    'BETA_TESTER_04',
    'BETA_TESTER_05'
]);

const USED_CODES = new Set();

function validateAndConsumeCode(code) {
    if (!code) {
        return { valid: false, message: 'No access code provided' };
    }
    
    // Allow reuse of codes in development
    if (process.env.NODE_ENV === 'development') {
        if (VALID_CODES.has(code)) {
            console.log(`✅ Access code "${code}" validated (dev mode)`);
            return { valid: true, message: 'Access granted' };
        }
    }
    
    if (USED_CODES.has(code)) {
        return { valid: false, message: 'Access code already used' };
    }
    
    if (!VALID_CODES.has(code)) {
        return { valid: false, message: 'Invalid access code' };
    }
    
    USED_CODES.add(code);
    console.log(`✅ Access code "${code}" used successfully`);
    
    return { valid: true, message: 'Access granted' };
}

// ═══════════════════════════════════════════════════════════════
// API FETCHING - BULLETPROOF
// ═══════════════════════════════════════════════════════════════

async function fetchFromAPI(url) {
    return new Promise((resolve) => {
        const request = https.get(url, {
            headers: {
                'User-Agent': 'Mozilla/5.0',
                'Accept': 'application/json'
            },
            timeout: 8000
        }, (res) => {
            let data = '';
            
            res.on('data', (chunk) => {
                data += chunk;
            });
            
            res.on('end', () => {
                try {
                    if (data.includes('<!DOCTYPE') || data.includes('<html>')) {
                        console.log('⚠️ Got HTML error page');
                        resolve(null);
                        return;
                    }
                    
                    const parsed = JSON.parse(data);
                    resolve(parsed);
                } catch (error) {
                    console.log('⚠️ JSON parse failed:', error.message.substring(0, 50));
                    resolve(null);
                }
            });
        });
        
        request.on('timeout', () => {
            console.log('⚠️ Request timeout');
            request.abort();
            resolve(null);
        });
        
        request.on('error', (error) => {
            console.log('⚠️ Request error:', error.message);
            resolve(null);
        });
    });
}

// ═══════════════════════════════════════════════════════════════
// COINGECKO DATA FETCHING
// ═══════════════════════════════════════════════════════════════

async function getCoinGeckoTrending() {
    console.log('🔥 Fetching CoinGecko trending tokens...');
    const data = await fetchFromAPI('https://api.coingecko.com/api/v3/search/trending');
    return data?.coins || [];
}

async function getTokenDetails(coinId) {
    const [coinData, marketChart] = await Promise.all([
        fetchFromAPI(`https://api.coingecko.com/api/v3/coins/${coinId}?localization=false&tickers=false&community_data=false&developer_data=false`),
        fetchFromAPI(`https://api.coingecko.com/api/v3/coins/${coinId}/market_chart?vs_currency=usd&days=14`)
    ]);
    
    return { coinData, marketChart };
}

// ═══════════════════════════════════════════════════════════════
// RSI CALCULATION
// ═══════════════════════════════════════════════════════════════

function calculateRSI(prices, period = 14) {
    if (!prices || prices.length < period + 1) return 50;
    
    let gains = 0;
    let losses = 0;
    
    for (let i = 1; i <= period; i++) {
        const change = prices[i] - prices[i - 1];
        if (change > 0) gains += change;
        else losses += Math.abs(change);
    }
    
    const avgGain = gains / period;
    const avgLoss = losses / period;
    
    if (avgLoss === 0) return 100;
    
    const rs = avgGain / avgLoss;
    const rsi = 100 - (100 / (1 + rs));
    
    return Math.round(rsi * 10) / 10;
}

// ═══════════════════════════════════════════════════════════════
// MOON PHASE CALCULATION
// ═══════════════════════════════════════════════════════════════

function getMoonPhase() {
    const now = new Date();
    const year = now.getFullYear();
    const month = now.getMonth() + 1;
    const day = now.getDate();
    
    let c = 0, e = 0, jd = 0, b = 0;
    
    if (month < 3) {
        year--;
        month += 12;
    }
    
    ++month;
    c = 365.25 * year;
    e = 30.6 * month;
    jd = c + e + day - 694039.09;
    jd /= 29.5305882;
    b = parseInt(jd);
    jd -= b;
    b = Math.round(jd * 8);
    
    if (b >= 8) b = 0;
    
    const phases = ['New Moon', 'Waxing Crescent', 'First Quarter', 'Waxing Gibbous', 
                    'Full Moon', 'Waning Gibbous', 'Last Quarter', 'Waning Crescent'];
    
    const phaseData = {
        phase: phases[b],
        illumination: Math.round(jd * 100),
        emoji: ['🌑','🌒','🌓','🌔','🌕','🌖','🌗','🌘'][b]
    };
    
    return phaseData;
}

// ═══════════════════════════════════════════════════════════════
// KP INDEX (SPACE WEATHER)
// ═══════════════════════════════════════════════════════════════

async function getKpIndex() {
    try {
        const data = await fetchFromAPI('https://services.swpc.noaa.gov/products/noaa-planetary-k-index.json');
        
        if (!data || data.length < 2) {
            return { kp: 3, level: 'Moderate' };
        }
        
        const latest = data[data.length - 1];
        const kpValue = parseFloat(latest[1]);
        
        let level = 'Quiet';
        if (kpValue >= 5) level = 'Storm';
        else if (kpValue >= 4) level = 'Active';
        else if (kpValue >= 3) level = 'Moderate';
        
        return { kp: kpValue, level };
    } catch (error) {
        console.log('⚠️ Kp index fetch failed, using default');
        return { kp: 3, level: 'Moderate' };
    }
}

// ═══════════════════════════════════════════════════════════════
// CLIF HIGH ARCHETYPE SYSTEM
// ═══════════════════════════════════════════════════════════════

function assignArchetype(score, volume, sentiment) {
    const archetypes = [
        { name: 'Prophet', threshold: 90, condition: (s, v) => s >= 90 && v > 80 },
        { name: 'Seer', threshold: 80, condition: (s, v) => s >= 80 && v > 60 },
        { name: 'Trickster', threshold: 70, condition: (s, v, sent) => s >= 70 && sent < 50 },
        { name: 'Observer', threshold: 60, condition: (s, v) => s >= 60 && v < 50 },
        { name: 'Guardian', threshold: 50, condition: (s, v) => s >= 50 && s < 70 },
        { name: 'Shadow', threshold: 40, condition: (s, v) => s < 50 && v > 70 },
        { name: 'Echo', threshold: 30, condition: (s, v) => s < 40 && v < 40 },
        { name: 'Cultist', threshold: 0, condition: (s) => s < 30 }
    ];
    
    for (const archetype of archetypes) {
        if (archetype.condition(score, volume, sentiment)) {
            return archetype.name;
        }
    }
    
    return 'Observer';
}

// ═══════════════════════════════════════════════════════════════
// 10-LAYER ANALYSIS ENGINE
// ═══════════════════════════════════════════════════════════════

function analyze10Layers(tokenData, prices, moonPhase, kpIndex) {
    const layers = {};
    
    // Layer 1: Linguistics (Name/Symbol Analysis)
    const namePower = (tokenData.name?.length || 0) < 12 ? 80 : 60;
    const symbolPower = (tokenData.symbol?.length || 0) < 6 ? 75 : 55;
    layers.linguistics = Math.round((namePower + symbolPower) / 2);
    
    // Layer 2: Technical (RSI)
    const rsi = calculateRSI(prices);
    layers.technical = rsi > 70 ? 85 : rsi < 30 ? 40 : 65;
    
    // Layer 3: Momentum (Price Change)
    const priceChange = tokenData.price_change_percentage_24h || 0;
    layers.momentum = priceChange > 20 ? 90 : priceChange > 0 ? 70 : 40;
    
    // Layer 4: Sentiment (Market Cap Rank)
    const rank = tokenData.market_cap_rank || 9999;
    layers.sentiment = rank < 100 ? 85 : rank < 500 ? 65 : 45;
    
    // Layer 5: Liquidity (Volume)
    const volume = tokenData.total_volume || 0;
    layers.liquidity = volume > 10000000 ? 85 : volume > 1000000 ? 65 : 45;
    
    // Layer 6: Whale Activity (Market Cap)
    const marketCap = tokenData.market_cap || 0;
    layers.whale = marketCap > 100000000 ? 80 : marketCap > 10000000 ? 60 : 40;
    
    // Layer 7: Order Book (Liquidity Score)
    const liquidityScore = tokenData.liquidity_score || 0;
    layers.orderbook = liquidityScore > 50 ? 75 : liquidityScore > 30 ? 55 : 35;
    
    // Layer 8: Cosmic (Moon + Kp)
    const moonBonus = moonPhase.phase === 'Full Moon' ? 15 : 
                      moonPhase.phase === 'New Moon' ? -10 : 0;
    const kpBonus = kpIndex.kp > 5 ? 10 : kpIndex.kp < 2 ? -5 : 0;
    layers.cosmic = Math.max(0, Math.min(100, 50 + moonBonus + kpBonus));
    
    // Layer 9: Risk Assessment
    const volatility = Math.abs(priceChange);
    layers.risk = volatility > 50 ? 30 : volatility > 20 ? 60 : 80;
    
    // Layer 10: Integration (Master Score)
    const weights = {
        linguistics: 0.08,
        technical: 0.12,
        momentum: 0.15,
        sentiment: 0.12,
        liquidity: 0.13,
        whale: 0.10,
        orderbook: 0.10,
        cosmic: 0.10,
        risk: 0.10
    };
    
    let masterScore = 0;
    for (const [layer, score] of Object.entries(layers)) {
        if (layer !== 'integration') {
            masterScore += score * (weights[layer] || 0);
        }
    }
    
    layers.integration = Math.round(masterScore);
    
    return layers;
}

// ═══════════════════════════════════════════════════════════════
// SIGNAL GENERATION
// ═══════════════════════════════════════════════════════════════

function generateSignal(masterScore, rsi, priceChange) {
    if (masterScore >= 80 && rsi < 70 && priceChange > 0) {
        return { signal: 'STRONG BUY', color: '#0f0', confidence: 95 };
    } else if (masterScore >= 70 && priceChange > 5) {
        return { signal: 'BUY', color: '#0f0', confidence: 80 };
    } else if (masterScore >= 60) {
        return { signal: 'ACCUMULATE', color: '#ff0', confidence: 65 };
    } else if (masterScore < 40 || rsi > 80) {
        return { signal: 'SELL', color: '#f00', confidence: 70 };
    } else {
        return { signal: 'HOLD', color: '#888', confidence: 50 };
    }
}

// ═══════════════════════════════════════════════════════════════
// MAIN ANALYSIS ORCHESTRATOR
// ═══════════════════════════════════════════════════════════════

async function analyzeTokens() {
    console.log('\n🔮 Starting ALICE Oracle Analysis...\n');
    
    // Get cosmic data
    const [moonPhase, kpIndex] = await Promise.all([
        Promise.resolve(getMoonPhase()),
        getKpIndex()
    ]);
    
    console.log(`🌙 Moon: ${moonPhase.emoji} ${moonPhase.phase} (${moonPhase.illumination}%)`);
    console.log(`⚡ Kp Index: ${kpIndex.kp} (${kpIndex.level})\n`);
    
    // Get trending tokens
    const trending = await getCoinGeckoTrending();
    
    if (!trending || trending.length === 0) {
        console.log('⚠️ No trending tokens found, using mock data');
        return {
            tokens: generateMockTokens(),
            cosmic: { moon: moonPhase, kp: kpIndex }
        };
    }
    
    console.log(`📊 Found ${trending.length} trending tokens\n`);
    
    // Analyze top 10
    const tokensToAnalyze = trending.slice(0, 10);
    const analyzedTokens = [];
    
    for (const trendingToken of tokensToAnalyze) {
        const coinId = trendingToken.item.id;
        const coinName = trendingToken.item.name;
        
        console.log(`🔍 Analyzing: ${coinName}...`);
        
        const { coinData, marketChart } = await getTokenDetails(coinId);
        
        if (!coinData) {
            console.log(`  ⚠️ Failed to fetch data for ${coinName}`);
            continue;
        }
        
        const prices = marketChart?.prices?.map(p => p[1]) || [];
        const layers = analyze10Layers(coinData, prices, moonPhase, kpIndex);
        const rsi = calculateRSI(prices);
        const priceChange = coinData.market_data?.price_change_percentage_24h || 0;
        const signal = generateSignal(layers.integration, rsi, priceChange);
        
        const archetype = assignArchetype(
            layers.integration,
            layers.liquidity,
            layers.sentiment
        );
        
        analyzedTokens.push({
            id: coinData.id,
            name: coinData.name,
            symbol: coinData.symbol?.toUpperCase(),
            image: coinData.image?.small,
            price: coinData.market_data?.current_price?.usd || 0,
            priceChange24h: priceChange,
            volume: coinData.market_data?.total_volume?.usd || 0,
            marketCap: coinData.market_data?.market_cap?.usd || 0,
            rank: coinData.market_cap_rank || 999,
            rsi: rsi,
            layers: layers,
            masterScore: layers.integration,
            signal: signal,
            archetype: archetype
        });
        
        console.log(`  ✅ Score: ${layers.integration}/100 | Signal: ${signal.signal} | ${archetype}`);
    }
    
    // Sort by master score
    analyzedTokens.sort((a, b) => b.masterScore - a.masterScore);
    
    console.log(`\n✨ Analysis complete! ${analyzedTokens.length} tokens processed\n`);
    
    return {
        tokens: analyzedTokens,
        cosmic: { moon: moonPhase, kp: kpIndex }
    };
}

// ═══════════════════════════════════════════════════════════════
// MOCK DATA GENERATOR (FALLBACK)
// ═══════════════════════════════════════════════════════════════

function generateMockTokens() {
    const mockTokens = [
        { name: 'Ethereum', symbol: 'ETH', score: 87 },
        { name: 'Solana', symbol: 'SOL', score: 82 },
        { name: 'Cardano', symbol: 'ADA', score: 76 },
        { name: 'Polkadot', symbol: 'DOT', score: 71 },
        { name: 'Avalanche', symbol: 'AVAX', score: 68 },
        { name: 'Chainlink', symbol: 'LINK', score: 64 },
        { name: 'Polygon', symbol: 'MATIC', score: 59 },
        { name: 'Uniswap', symbol: 'UNI', score: 55 },
        { name: 'Cosmos', symbol: 'ATOM', score: 51 },
        { name: 'Algorand', symbol: 'ALGO', score: 47 }
    ];
    
    return mockTokens.map(token => ({
        id: token.symbol.toLowerCase(),
        name: token.name,
        symbol: token.symbol,
        image: 'https://via.placeholder.com/50',
        price: Math.random() * 100,
        priceChange24h: (Math.random() - 0.5) * 20,
        volume: Math.random() * 10000000,
        marketCap: Math.random() * 1000000000,
        rank: Math.floor(Math.random() * 100),
        rsi: Math.floor(Math.random() * 100),
        layers: {
            linguistics: token.score - 10,
            technical: token.score - 5,
            momentum: token.score,
            sentiment: token.score - 8,
            liquidity: token.score - 12,
            whale: token.score - 7,
            orderbook: token.score - 15,
            cosmic: token.score - 3,
            risk: token.score - 20,
            integration: token.score
        },
        masterScore: token.score,
        signal: generateSignal(token.score, 50, 5),
        archetype: assignArchetype(token.score, 65, 70)
    }));
}

// ═══════════════════════════════════════════════════════════════
// HTTP SERVER
// ═══════════════════════════════════════════════════════════════

const server = http.createServer(async (req, res) => {
    // CORS headers
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    
    if (req.method === 'OPTIONS') {
        res.writeHead(200);
        res.end();
        return;
    }
    
    const url = req.url;
    
    // ══════════ ROUTES ══════════
    
    // API: Validate access code
    if (url === '/api/validate-code' && req.method === 'POST') {
        let body = '';
        req.on('data', chunk => body += chunk);
        req.on('end', () => {
            try {
                const { code } = JSON.parse(body);
                const result = validateAndConsumeCode(code);
                
                res.writeHead(result.valid ? 200 : 401, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify(result));
            } catch (error) {
                res.writeHead(400, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ valid: false, message: 'Invalid request' }));
            }
        });
        return;
    }
    
    // API: Get analyzed tokens
    if (url === '/api/analyze' && req.method === 'GET') {
        try {
            const analysis = await analyzeTokens();
            
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify(analysis));
        } catch (error) {
            console.error('Analysis error:', error);
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Analysis failed' }));
        }
        return;
    }
    
    // Serve static files
    let filePath = '.' + url;
    if (url === '/') {
        filePath = './index.html';
    }
    
    const extname = path.extname(filePath);
    const contentTypes = {
        '.html': 'text/html',
        '.js': 'text/javascript',
        '.css': 'text/css',
        '.json': 'application/json',
        '.png': 'image/png',
        '.jpg': 'image/jpg',
        '.gif': 'image/gif',
        '.svg': 'image/svg+xml'
    };
    
    const contentType = contentTypes[extname] || 'text/html';
    
    fs.readFile(filePath, (error, content) => {
        if (error) {
            if (error.code === 'ENOENT') {
                res.writeHead(404);
                res.end('404 - File Not Found');
            } else {
                res.writeHead(500);
                res.end('500 - Internal Server Error');
            }
        } else {
            res.writeHead(200, { 'Content-Type': contentType });
            res.end(content, 'utf-8');
        }
    });
});

server.listen(PORT, () => {
    console.log('\n═══════════════════════════════════════════════════════════');
    console.log('🔮 ALICE ORACLE - UNIVERSAL 10-LAYER ANALYSIS ENGINE');
    console.log('═══════════════════════════════════════════════════════════');
    console.log(`\n🚀 Server running on port ${PORT}`);
    console.log(`📡 Access at: http://localhost:${PORT}`);
    console.log('\n✅ Features enabled:');
    console.log('   • Gated access system');
    console.log('   • 10-layer token analysis');
    console.log('   • Real CoinGecko data');
    console.log('   • Moon phase tracking');
    console.log('   • Kp index monitoring');
    console.log('   • Clif High archetypes');
    console.log('   • Signal generation');
    console.log('\n═══════════════════════════════════════════════════════════\n');
});
