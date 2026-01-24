import fetch from 'node-fetch';

async function testBackend() {
    try {
        console.log('Testing Markets API with higher limit...');

        // Simulating what App.jsx sends (limit=100 for test, App uses 500)
        const limit = 100;
        const rawUrl = `https://gamma-api.polymarket.com/events?active=true&closed=false&limit=${limit}`;
        console.log(`Fetching RAW data from: ${rawUrl}`);
        const rawResponse = await fetch(rawUrl);

        if (rawResponse.ok) {
            const rawData = await rawResponse.json();
            console.log(`RAW Data Count: ${rawData.length}`);

            const asset = 'bitcoin';
            const targetString = 'up or down';

            console.log(`\nSearching for Asset: '${asset}'...`);

            let assetMatches = 0;
            let exactMatches = 0;

            rawData.forEach(event => {
                const title = event.title.toLowerCase();
                if (title.includes(asset)) {
                    assetMatches++;
                    if (title.includes(targetString)) {
                        exactMatches++;
                        console.log(`[MATCH] ${event.title}`);
                    } else {
                        console.log(`[Partial] ${event.title}`);
                    }
                }
            });

            console.log(`\nSummary:`);
            console.log(`Total Events: ${rawData.length}`);
            console.log(`Containing '${asset}': ${assetMatches}`);
            console.log(`Containing '${asset}' AND '${targetString}': ${exactMatches}`);

        } else {
            console.log('RAW Fetch: Failed', rawResponse.status);
        }

    } catch (error) {
        console.error('Test Failed:', error.message);
    }
}

testBackend();
