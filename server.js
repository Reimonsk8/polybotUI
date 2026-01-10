import express from 'express';
import cors from 'cors';
import fetch from 'node-fetch';

const app = express();
const PORT = 3001;

// Enable CORS for all routes
app.use(cors());
app.use(express.json());

// Proxy endpoint for Polymarket API
app.get('/api/markets', async (req, res) => {
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

app.listen(PORT, () => {
    console.log(`🚀 Proxy server running on http://localhost:${PORT}`);
    console.log(`📊 Markets endpoint: http://localhost:${PORT}/api/markets`);
});
