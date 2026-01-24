import fetch from 'node-fetch';

async function checkTags() {
    const attempts = [
        { id: 968, name: 'Solana Network (Candidate)' },
        { id: 210, name: 'Ethereum (Candidate 1)' },
        { id: 208, name: 'Ethereum (Candidate 2)' },
        { id: 227, name: 'Ethereum (Candidate 3)' }
    ];

    console.log('Verifying Tag IDs...');

    for (const tag of attempts) {
        try {
            const url = `https://gamma-api.polymarket.com/events?tag_id=${tag.id}&active=true&closed=false&limit=3`;
            const res = await fetch(url);
            const data = await res.json();

            console.log(`\nID ${tag.id} (${tag.name}): Found ${data.length} events`);
            if (data.length > 0) {
                console.log(` - Example: ${data[0].title}`);
                // Check if relevant
                if (data[0].title.toLowerCase().includes('solana') || data[0].title.toLowerCase().includes('ethereum')) {
                    console.log(' ✅ MATCH!');
                }
            }
        } catch (e) {
            console.log(`Error ${tag.id}: ${e.message}`);
        }
    }
}

checkTags();
