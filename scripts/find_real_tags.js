import fetch from 'node-fetch';

async function findCorrectTagIds() {
    const assets = ['Ethereum', 'Solana', 'XRP'];

    for (const asset of assets) {
        console.log(`\n--- Searching for ${asset} Tag ID ---`);
        try {
            // Fetch events by text search (no tag_id)
            // Gamma API doesn't support 'q' well on /events directly usually, but let's try just getting recent active ones and filtering
            const url = `https://gamma-api.polymarket.com/events?active=true&closed=false&limit=100`;
            const response = await fetch(url);
            const data = await response.json();

            // Filter client side
            const matches = data.filter(e => e.title.includes(asset) && e.title.includes('Up or Down'));

            if (matches.length > 0) {
                console.log(`Found ${matches.length} events for ${asset}.`);
                const first = matches[0];
                console.log(`Examples: ${first.title}`);
                console.log(`Tags:`, JSON.stringify(first.tags));

                // Extract common tags
                const tagCounts = {};
                matches.forEach(m => {
                    if (m.tags) {
                        m.tags.forEach(t => {
                            tagCounts[t.id] = (tagCounts[t.id] || 0) + 1;
                            // Also store label for debugging
                            if (!tagCounts[`${t.id}_info`]) tagCounts[`${t.id}_info`] = t;
                        });
                    }
                });

                // Sort by frequency
                const sortedIds = Object.keys(tagCounts)
                    .filter(k => !k.endsWith('_info'))
                    .sort((a, b) => tagCounts[b] - tagCounts[a]);

                console.log('Top Tags:');
                sortedIds.slice(0, 3).forEach(id => {
                    const info = tagCounts[`${id}_info`];
                    console.log(` - ID: ${id} (${info.label || info.slug}) Count: ${tagCounts[id]}`);
                });

            } else {
                console.log(`No active "Up or Down" events found for ${asset} in the top 100 generic query.`);
                console.log('Trying broader search (just asset name)...');
                const matchesBroad = data.filter(e => e.title.includes(asset));
                if (matchesBroad.length > 0) {
                    console.log(`Found ${matchesBroad.length} broad matches.`);
                    console.log(`Example: ${matchesBroad[0].title}`);
                    console.log(`Tags:`, JSON.stringify(matchesBroad[0].tags));
                }
            }

        } catch (e) {
            console.error(e);
        }
    }
}

findCorrectTagIds();
