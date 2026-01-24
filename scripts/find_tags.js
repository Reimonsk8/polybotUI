import fetch from 'node-fetch';

async function findTags() {
    try {
        console.log('Fetching Tags...');
        const response = await fetch('https://gamma-api.polymarket.com/tags');
        if (response.ok) {
            const tags = await response.json();
            console.log(`Found ${tags.length} tags.`);

            const search = ['Bitcoin', 'Ethereum', 'Solana', 'Crypto'];

            search.forEach(term => {
                console.log(`\nSearching for '${term}':`);
                const matches = tags.filter(t => t.label && t.label.toLowerCase().includes(term.toLowerCase()));
                matches.forEach(m => console.log(`ID: ${m.id}, Label: ${m.label}, Slug: ${m.slug}`));
            });

        } else {
            console.log('Tags Fetch: Failed', response.status);
        }
    } catch (error) {
        console.error('Test Failed:', error.message);
    }
}

findTags();
