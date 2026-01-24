import fetch from 'node-fetch';

async function verifyFix() {
    console.log('Verifying Market Loading Fix...\n');

    const tests = [
        { asset: 'Bitcoin', timeframe: 'daily', expected: 'Up or Down', notExpected: '15 minute' },
        { asset: 'Bitcoin', timeframe: '15m', expected: '15 minute' },
        { asset: 'Ethereum', timeframe: 'daily', expected: 'Up or Down', notExpected: '15 minute' },
    ];

    for (const test of tests) {
        try {
            const url = `http://localhost:3001/api/data?limit=500&active=true&closed=false&asset=${test.asset}&timeframe=${test.timeframe}`;
            console.log(`Testing: ${test.asset} - ${test.timeframe}`);
            console.log(`URL: ${url}`);

            const response = await fetch(url);
            if (!response.ok) {
                console.error(`Request Failed: ${response.status} ${response.statusText}`);
                continue;
            }

            const data = await response.json();
            console.log(`Markets Found: ${data.length}`);

            if (data.length > 0) {
                const first = data[0];
                console.log(` First Title: "${first.title}"`);

                // Content verification
                const titleLower = first.title.toLowerCase();
                const hasAsset = titleLower.includes(test.asset.toLowerCase());
                const hasExpected = titleLower.includes(test.expected.toLowerCase());
                const hasNotExpected = test.notExpected ? titleLower.includes(test.notExpected.toLowerCase()) : false;

                if (hasAsset && hasExpected && !hasNotExpected) {
                    console.log(' ✅ Content Match: PASS');
                } else {
                    console.log(' ❌ Content Match: FAIL');
                    console.log(`    Asset(${test.asset}): ${hasAsset}`);
                    console.log(`    Expected(${test.expected}): ${hasExpected}`);
                    if (test.notExpected) console.log(`    NotExpected(${test.notExpected}): ${hasNotExpected} (Should be false)`);
                }
            } else {
                console.log(' ⚠️ No markets found (might be valid if none active, but unexpected for major assets)');
            }
            console.log('---');

        } catch (error) {
            console.error('Error:', error.message);
        }
    }
}

verifyFix();
