import fetch from 'node-fetch';

async function findEthTag() {
    try {
        console.log('Fetching 1000 Events to find Ethereum...');
        // Fetch a lot of events to increase chance of finding ETH
        const response = await fetch('https://gamma-api.polymarket.com/events?active=true&closed=false&limit=1000');
        if (response.ok) {
            const data = await response.json();
            console.log(`Scanned ${data.length} events.`);

            const ethEvents = data.filter(e => e.title.includes('Ethereum'));
            console.log(`Found ${ethEvents.length} Ethereum events.`);

            if (ethEvents.length > 0) {
                // Analyze tags
                const tagCounts = {};
                ethEvents.forEach(e => {
                    if (e.tags) {
                        e.tags.forEach(t => {
                            tagCounts[t.id] = (tagCounts[t.id] || 0) + 1;
                            console.log(`Event: "${e.title}" -> Tag: ${t.label} (ID: ${t.id})`);
                        });
                    }
                });
            }
        }
    } catch (error) {
        console.error('Failed:', error.message);
    }
}

findEthTag();
