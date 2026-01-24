import fetch from 'node-fetch';

async function checkTagIds() {
    const tags = [
        { name: 'Ethereum', id: 210 },
        { name: 'Solana', id: 217 },
        { name: 'XRP', id: 257 } // Educated guess or just skip
    ];

    for (const tag of tags) {
        try {
            const url = `https://gamma-api.polymarket.com/events?tag_id=${tag.id}&limit=1`;
            const response = await fetch(url);
            if (response.ok) {
                const data = await response.json();
                if (data.length > 0) {
                    console.log(`ID ${tag.id} (${tag.name}): Found event "${data[0].title}"`);
                } else {
                    console.log(`ID ${tag.id} (${tag.name}): No events found.`);
                }
            }
        } catch (e) {
            console.log(`Error checking ID ${tag.id}: ${e.message}`);
        }
    }
}

checkTagIds();
