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

        // Use the same URL as the server uses internally to see raw data
        const rawUrl = 'https://gamma-api.polymarket.com/events?active=true&closed=false&limit=20';
        console.log(`Fetching RAW data from: ${rawUrl}`);
        const rawResponse = await fetch(rawUrl);
        if (rawResponse.ok) {
            const rawData = await rawResponse.json();
            console.log(`RAW Data Count: ${rawData.length}`);
            if (rawData.length > 0) {
                console.log('First 3 Raw Titles:');
                rawData.slice(0, 3).forEach(e => console.log(` - ${e.title}`));
            }

            // Replicate server filtering logic locally to debug
            const asset = 'bitcoin';
            const timeframe = 'daily';

            console.log(`\nApply Filter: Asset=${asset}, Timeframe=${timeframe}`);

            const filtered = rawData.filter(event => {
                const title = event.title.toLowerCase();
                const isAsset = title.includes(asset.toLowerCase());
                const isUpOrDown = title.includes('up or down');

                if (!isAsset) console.log(`[Skip] Not Asset: ${event.title}`);
                else if (!isUpOrDown) console.log(`[Skip] Not Up/Down: ${event.title}`);

                if (!isAsset || !isUpOrDown) return false;

                // Timeframe filtering
                if (timeframe === 'daily') {
                    const isDaily = !title.includes('15 minute') && !title.includes('1 hour') && !title.includes('4 hour');
                    if (!isDaily) console.log(`[Skip] Not Daily: ${event.title}`);
                    return isDaily;
                }
                return false;
            });
            console.log(`Filtered Count: ${filtered.length}`);
        } else {
            console.log('RAW Fetch: Failed', rawResponse.status);
        }

    } catch (error) {
        console.error('Test Failed:', error.message);
    }
}

testBackend();
