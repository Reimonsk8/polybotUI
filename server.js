import app from './api/index.js';

const PORT = 3001;

app.listen(PORT, () => {
    console.log(`🚀 Proxy server running on http://localhost:${PORT}`);
    console.log(`📊 Markets endpoint: http://localhost:${PORT}/api/data`);
    console.log(`👤 Gamma API proxy: http://localhost:${PORT}/api/gamma-api/*`);
    console.log(`📈 Data API proxy: http://localhost:${PORT}/api/data-api/*`);
});
