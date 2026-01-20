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
    methods: ['GET', 'POST', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization']
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
app.get('/api/data', async (req, res) => {
    try {
        const { tag_id, limit = 20, active = 'true', closed = 'false' } = req.query;

        const url = new URL('https://gamma-api.polymarket.com/events');
        url.searchParams.append('active', active);
        url.searchParams.append('closed', closed);
        url.searchParams.append('limit', limit);
        if (tag_id) {
            url.searchParams.append('tag_id', tag_id);
        }

        const response = await fetch(url.toString());

        if (!response.ok) {
            throw new Error(`Polymarket API error: ${response.status}`);
        }

        const data = await response.json();

        // Filter for Bitcoin Up or Down markets
        const btcMarkets = data.filter(event =>
            event.title.toLowerCase().includes('bitcoin') &&
            event.title.toLowerCase().includes('up or down')
        );

        res.json(btcMarkets);
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
app.use('/gamma-api', async (req, res) => {
    try {
        const targetUrl = `https://gamma-api.polymarket.com${req.url}`;
        console.log(`[Proxy] Gamma: ${req.method} ${req.url} -> ${targetUrl}`);

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
app.use('/data-api', async (req, res) => {
    try {
        const targetUrl = `https://data-api.polymarket.com${req.url}`;
        console.log(`[Proxy] Data: ${req.method} ${req.url} -> ${targetUrl}`);

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

// Catch-all for debugging 404s
app.use((req, res) => {
    console.log(`[404] Route not found: ${req.method} ${req.url}`);
    res.status(404).json({ error: 'Route not found', path: req.url, method: req.method });
});

// Start server only in local development (not on Vercel)
if (process.env.NODE_ENV !== 'production') {
    app.listen(PORT, () => {
        console.log(`🚀 Proxy server running on http://localhost:${PORT}`);
        console.log(`📊 Markets endpoint: http://localhost:${PORT}/api/data`);
    });
}

// Export for Vercel serverless
export default app;
