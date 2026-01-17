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

// Proxy for Gamma API (User Profiles, etc.) - Fixes missing username/picture in prod
app.get('/gamma-api/*', async (req, res) => {
    try {
        const targetPath = req.url.replace(/^\/gamma-api/, '');
        const targetUrl = `https://gamma-api.polymarket.com${targetPath}`;

        console.log(`[Proxy] Proxying ${req.method} ${req.url} -> ${targetUrl}`);

        const response = await fetch(targetUrl, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'Accept': 'application/json',
                'Accept-Language': 'en-US,en;q=0.9',
                'Cache-Control': 'no-cache',
                'Pragma': 'no-cache'
            }
        });

        console.log(`[Proxy] Upstream status for ${targetPath}: ${response.status}`);

        if (!response.ok) {
            const text = await response.text();
            console.warn(`[Proxy] Upstream error: ${response.status} ${text}`);
            return res.status(response.status).send(text);
        }

        const data = await response.json();
        res.json(data);
    } catch (error) {
        console.error('Gamma Proxy error:', error);
        res.status(500).json({ error: error.message });
    }
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
