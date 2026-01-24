import fetch from 'node-fetch';

async function findTagsDeep() {
    try {
        console.log('Fetching Tags (limit=1000)...');
        const response = await fetch('https://gamma-api.polymarket.com/tags?limit=1000');
        if (response.ok) {
            const tags = await response.json();
            console.log(`Found ${tags.length} tags.`);

            const search = ['Ethereum', 'Solana', 'XRP', 'ETH', 'SOL'];

            search.forEach(term => {
                console.log(`\nSearching for '${term}':`);
                const matches = tags.filter(t => t.label && t.label.toLowerCase() === term.toLowerCase()); // Exact match preference
                const partials = tags.filter(t => t.label && t.label.toLowerCase().includes(term.toLowerCase()) && t.label.toLowerCase() !== term.toLowerCase());

                matches.forEach(m => console.log(`[EXACT] ID: ${m.id}, Label: ${m.label}, Slug: ${m.slug}`));
                partials.forEach(m => console.log(`[PARTIAL] ID: ${m.id}, Label: ${m.label}, Slug: ${m.slug}`));
            });

        } else {
            console.log('Tags Fetch: Failed', response.status);
        }
    } catch (error) {
        console.error('Test Failed:', error.message);
    }
}

findTagsDeep();
