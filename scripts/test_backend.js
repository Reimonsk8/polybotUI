import fetch from 'node-fetch';

async function testBackend() {
    try {
        console.log('Testing Backend Connection...');
        const health = await fetch('http://localhost:3001/api/health');
        if (health.ok) {
            console.log('Health Check: OK', await health.json());
        } else {
            console.log('Health Check: Failed', health.status);
        }

        console.log('\nTesting Markets API...');
        // Match the query string from App.jsx: asset=Bitcoin or similar
        const markets = await fetch('http://localhost:3001/api/data?limit=5&active=true&closed=false&asset=Bitcoin&timeframe=daily');
        if (markets.ok) {
            const data = await markets.json();
            console.log(`Markets Fetch: OK. Found ${data.length} markets.`);
            if (data.length > 0) {
                console.log('First market:', data[0].title);
            }
        } else {
            console.log('Markets Fetch: Failed', markets.status, await markets.text());
        }

    } catch (error) {
        console.error('Test Failed:', error.message);
    }
}

testBackend();
