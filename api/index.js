import express from 'express';
import cors from 'cors';
import fetch from 'node-fetch';

const app = express();
const PORT = 3001;

// Trust proxy (required for Vercel/proxies)
app.set('trust proxy', 1);

// Enable CORS for all routes with explicit options
app.use(cors({
    origin: '*', // Allow all origins
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: [
        'Content-Type',
        'Authorization',
        'POLY-ADDRESS',
        'POLY-TIMESTAMP',
        'POLY-NONCE',
        'POLY-SIGNATURE'
    ]
}));
// Enable CORS pre-flight
app.options('*', cors());

// Root endpoint to verify server is running
app.get('/', (req, res) => {
    res.json({
        status: 'ok',
        message: 'Polymarket proxy server is running',
        endpoints: {
            health: '/api/health',
            data: '/api/data'
        }
    });
});

// Middleware to log all requests
app.use((req, res, next) => {
    console.log(`[Incoming] ${req.method} ${req.url}`);
    next();
});

// Proxy endpoint for Polymarket API
// Proxy endpoint for Polymarket API
app.get('/api/data', async (req, res) => {
    try {
        const { tag_id, limit = 20, active = 'true', closed = 'false', asset = 'bitcoin', timeframe = 'daily' } = req.query;

        // Map Assets to Tag IDs
        const ASSET_TAGS = {
            'bitcoin': '235',
            // 'ethereum': '210', // Invalid, fallback to generic
            // 'solana': '217',   // Invalid, fallback to generic
            // 'xrp': '257'       // Invalid, fallback to generic
        };

        const url = new URL('https://gamma-api.polymarket.com/events');
        url.searchParams.append('active', active);
        url.searchParams.append('closed', closed);

        // Use Tag ID if available for the asset
        const assetKey = asset.toLowerCase();
        if (ASSET_TAGS[assetKey]) {
            url.searchParams.append('tag_id', ASSET_TAGS[assetKey]);
            // Increase limit slightly to ensure we get enough variance if needed, 
            // but tag_id means results are highly relevant already.
            url.searchParams.append('limit', '100');
        } else {
            // Fallback to generic limit if no tag found
            url.searchParams.append('limit', limit);
            if (tag_id) url.searchParams.append('tag_id', tag_id);
        }

        console.log(`[Proxy] Fetching from Polymarket: ${url.toString()}`);

        const response = await fetch(url.toString());

        if (!response.ok) {
            throw new Error(`Polymarket API error: ${response.status}`);
        }

        const data = await response.json();

        // Secondary Client-Side Filter (Refined)
        const filteredMarkets = data.filter(event => {
            const title = event.title.toLowerCase();
            const isAsset = title.includes(assetKey);
            const isUpOrDown = title.includes('up or down');

            // If we used a Tag ID, we can be less strict about the asset name 
            // because the tag guarantees relevance (e.g. Tag 235 = Bitcoin, matches "BTC Up or Down")
            const usedTag = !!ASSET_TAGS[assetKey];

            // "Up or Down" is crucial for this specific app view.
            if (!isUpOrDown) return false;

            // Strict asset name check only if we didn't use a specific tag
            if (!usedTag && !isAsset) return false;

            // Timeframe filtering
            if (timeframe === '15m') return title.includes('15 minute') || event.slug.includes('15m');
            if (timeframe === '1h') return title.includes('1 hour') || event.slug.includes('1h');
            if (timeframe === '4h') return title.includes('4 hour') || event.slug.includes('4h');

            // Daily / Standard
            return !title.includes('15 minute') && !title.includes('1 hour') && !title.includes('4 hour');
        });

        res.json(filteredMarkets);
    } catch (error) {
        console.error('Error fetching from Polymarket:', error);
        res.status(500).json({ error: error.message });
    }
});

// Health check endpoint
app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', message: 'Polymarket proxy server is running' });
});

// Proxy for Gamma API (User Profiles, etc.)
app.use(['/gamma-api', '/api/gamma-api'], async (req, res) => {
    try {
        // Strip the prefix to get the target path
        const prefix = req.originalUrl.startsWith('/api') ? '/api/gamma-api' : '/gamma-api';
        const targetPath = req.url; // req.url is already stripped of the mount path by app.use!

        // However, we need to be careful. app.use leaves the rest. 
        // If request is /api/gamma-api/foo, req.url is /foo.
        // If request is /gamma-api/foo, req.url is /foo.
        // So we can just append req.url to the target base.

        const targetUrl = `https://gamma-api.polymarket.com${req.url}`;
        console.log(`[Proxy] Gamma: ${req.method} ${req.originalUrl} -> ${targetUrl}`);

        const response = await fetch(targetUrl, {
            method: req.method,
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'Accept': 'application/json',
                'Accept-Language': 'en-US,en;q=0.9',
                'Cache-Control': 'no-cache',
                'Pragma': 'no-cache'
            }
        });

        if (!response.ok) {
            const text = await response.text();
            console.warn(`[Proxy] Gamma upstream error: ${response.status} ${text}`);
            return res.status(response.status).send(text);
        }

        const data = await response.json();
        res.json(data);
    } catch (error) {
        console.error('Gamma Proxy error:', error);
        res.status(500).json({ error: error.message });
    }
});

// Proxy for Data API (Activity, etc.)
app.use(['/data-api', '/api/data-api'], async (req, res) => {
    try {
        const targetUrl = `https://data-api.polymarket.com${req.url}`;
        console.log(`[Proxy] Data: ${req.method} ${req.originalUrl} -> ${targetUrl}`);

        const response = await fetch(targetUrl, {
            method: req.method,
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'Accept': 'application/json',
                'Accept-Language': 'en-US,en;q=0.9',
                'Cache-Control': 'no-cache',
                'Pragma': 'no-cache'
            }
        });

        if (!response.ok) {
            const text = await response.text();
            console.warn(`[Proxy] Data upstream error: ${response.status} ${text}`);
            return res.status(response.status).send(text);
        }

        const data = await response.json();
        res.json(data);
    } catch (error) {
        console.error('Data Proxy error:', error);
        res.status(500).json({ error: error.message });
    }
});

// Proxy for CLOB API (Orderbook, Prices, etc.)
app.use(['/clob', '/api/clob'], async (req, res) => {
    try {
        const targetUrl = `https://clob.polymarket.com${req.url}`;
        console.log(`[Proxy] CLOB: ${req.method} ${req.originalUrl} -> ${targetUrl}`);

        const response = await fetch(targetUrl, {
            method: req.method,
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'Accept': 'application/json',
                'Accept-Language': 'en-US,en;q=0.9',
                'Cache-Control': 'no-cache',
                'Pragma': 'no-cache',
                // Forward important headers if present
                ...(req.headers['authorization'] ? { 'Authorization': req.headers['authorization'] } : {}),
                ...(req.headers['poly-api-key'] ? { 'POLY-API-KEY': req.headers['poly-api-key'] } : {}),
                ...(req.headers['poly-api-secret'] ? { 'POLY-API-SECRET': req.headers['poly-api-secret'] } : {}),
                ...(req.headers['poly-passphrase'] ? { 'POLY-PASSPHRASE': req.headers['poly-passphrase'] } : {})
            },
            body: ['POST', 'PUT', 'DELETE'].includes(req.method) ? JSON.stringify(req.body) : undefined
        });

        if (!response.ok) {
            const text = await response.text();
            console.warn(`[Proxy] CLOB upstream error: ${response.status} ${text}`);
            return res.status(response.status).send(text);
        }

        const data = await response.json();
        res.json(data);
    } catch (error) {
        console.error('CLOB Proxy error:', error);
        res.status(500).json({ error: error.message });
    }
});

// Proxy for Relayer API
app.use(['/relayer', '/api/relayer'], async (req, res) => {
    try {
        const targetUrl = `https://relayer-v2.polymarket.com${req.url}`;
        console.log(`[Proxy] Relayer: ${req.method} ${req.originalUrl} -> ${targetUrl}`);

        const response = await fetch(targetUrl, {
            method: req.method,
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'Accept': 'application/json',
                'Content-Type': 'application/json',
                // Forward important headers if present
                ...(req.headers['authorization'] ? { 'Authorization': req.headers['authorization'] } : {}),
                ...(req.headers['poly-api-key'] ? { 'POLY-API-KEY': req.headers['poly-api-key'] } : {}),
                ...(req.headers['poly-api-secret'] ? { 'POLY-API-SECRET': req.headers['poly-api-secret'] } : {}),
                ...(req.headers['poly-passphrase'] ? { 'POLY-PASSPHRASE': req.headers['poly-passphrase'] } : {})
            },
            body: ['POST', 'PUT', 'DELETE'].includes(req.method) ? JSON.stringify(req.body) : undefined
        });

        if (!response.ok) {
            const text = await response.text();
            console.warn(`[Proxy] Relayer upstream error: ${response.status} ${text}`);
            return res.status(response.status).send(text);
        }

        const data = await response.json();
        res.json(data);
    } catch (error) {
        console.error('Relayer Proxy error:', error);
        res.status(500).json({ error: error.message });
    }
});

// Catch-all for debugging 404s
app.use((req, res) => {
    console.log(`[404] Route not found: ${req.method} ${req.url}`);
    res.status(404).json({ error: 'Route not found', path: req.url, method: req.method });
});

// Start server only in local development (not on Vercel)
// Start server check removed to prevent EADDRINUSE when imported by server.js

// Export for Vercel serverless
export default app;
