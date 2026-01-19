import puppeteer from 'puppeteer';

(async () => {
    console.log('🚀 Starting Login Verification Test...');

    // Launch the browser
    const browser = await puppeteer.launch({
        headless: false, // Run in headful mode so we can see what's happening
        defaultViewport: null,
        args: ['--start-maximized'] // maximize window
    });

    const page = await browser.newPage();

    // Enable console logging from the browser
    page.on('console', msg => console.log('PAGE LOG:', msg.text()));


    try {
        // 1. Navigate to the app
        console.log('🌐 Navigating to http://localhost:5173...');
        await page.goto('http://localhost:5173', { waitUntil: 'networkidle0' });

        // 2. Check for Initial State (Login Button)
        console.log('🔍 Checking for Login button...');
        const loginBtnSelector = '.connect-button';
        await page.waitForSelector(loginBtnSelector, { timeout: 5000 });

        // Click "Login to Polymarket" if it's the initial "Show Email Login" button
        const btnText = await page.$eval(loginBtnSelector, el => el.innerText);
        if (btnText.includes('Login to Polymarket')) {
            console.log('👆 Clicking "Login to Polymarket"...');
            await page.click(loginBtnSelector);
        }

        // 3. Look for "Load from .env" button
        console.log('🔍 Checking for ".env Load" button...');
        // The button has text "Load from .env File" and class .connect-button
        // We need to distinguish it from the submit button.
        // It is the one with the folder icon or specific text.

        const loadEnvBtn = await page.evaluateHandle(() => {
            const buttons = Array.from(document.querySelectorAll('button'));
            return buttons.find(b => b.innerText.includes('Load from .env'));
        });

        if (loadEnvBtn) {
            console.log('✅ Found ".env Load" button. Clicking...');
            await loadEnvBtn.click();

            // Wait a moment for state to update
            await new Promise(r => setTimeout(r, 1000));

            // 4. Click Submit Login
            console.log('👆 Clicking Submit Login...');
            const submitBtn = await page.evaluateHandle(() => {
                const buttons = Array.from(document.querySelectorAll('button'));
                return buttons.find(b => b.innerText.includes('Login') && !b.innerText.includes('Polymarket')); // Distinguish from the first button if possible, but the first one is gone now.
            });

            if (submitBtn) {
                await submitBtn.click();
            } else {
                throw new Error('Submit "Login" button not found after loading env.');
            }

        } else {
            console.warn('⚠️ ".env Load" button NOT found. Ensure .env file exists and VITE_ vars are set.');
            // If not found, maybe we try to login manually?
            // But the test requirement says "login using the .env".
            // If the button is missing, the test fails requirement.
            throw new Error('VITE_PRIVATE_KEY or VITE_API_KEY not found in environment.');
        }

        // 5. Wait for Portfolio Dashboard
        console.log('⏳ Waiting for Portfolio Dashboard...');
        await page.waitForSelector('.portfolio-dashboard', { timeout: 15000 });
        console.log('✅ Portfolio Dashboard loaded!');

        // 6. Verify User Profile Picture
        console.log('🔍 Verifying Profile Picture...');
        // Wait a bit for images to load
        await new Promise(r => setTimeout(r, 3000));

        const profileImg = await page.$('.profile-img');
        if (profileImg) {
            const src = await page.$eval('.profile-img', el => el.src);
            console.log(`✅ Profile Picture found: ${src}`);
        } else {
            console.warn('⚠️ Profile Picture NOT found. This might be expected if the user has no Gamma profile image.');
            // Log the HTML of .user-profile to debug
            const userProfileHTML = await page.$eval('.user-profile', el => el.innerHTML).catch(() => 'User profile container not found');
            console.log('Debug Profile HTML:', userProfileHTML);
        }

        // 7. Verify Username
        console.log('🔍 Verifying Username...');
        const username = await page.$('.username');
        if (username) {
            const text = await page.$eval('.username', el => el.innerText);
            console.log(`✅ Username found: ${text}`);
        } else {
            console.error('❌ Username NOT found.');
        }

        // 8. Verify Balance
        console.log('🔍 Verifying Cash Balance...');
        // Look for the "Cash (USDC)" card
        const cashValue = await page.evaluate(() => {
            const labels = Array.from(document.querySelectorAll('.stat-card .label'));
            const cashLabel = labels.find(l => l.innerText.includes('Cash'));
            if (cashLabel) {
                return cashLabel.nextElementSibling.innerText;
            }
            return null;
        });

        if (cashValue && cashValue !== '---' && cashValue !== 'Loading...') {
            console.log(`✅ Cash Balance found: ${cashValue}`);
        } else {
            console.warn(`⚠️ Cash Balance not fully loaded or missing (Value: ${cashValue})`);
        }

        // 9. Verify Positions
        console.log('🔍 Verifying Positions Table...');
        const positionsTable = await page.$('.positions-list table');
        if (positionsTable) {
            const rowCount = await page.$$eval('.positions-list tbody tr', rows => rows.length);
            console.log(`✅ Positions Table found with ${rowCount} rows.`);
            if (rowCount > 0) {
                console.log('✅ User has active positions displayed.');
            } else {
                console.log('ℹ️ User has no active positions (active markets).');
            }
        } else {
            // Check for empty state
            const emptyState = await page.$('.empty-portfolio');
            if (emptyState) {
                console.log('✅ Empty Portfolio state displayed (No active positions).');
            } else {
                console.error('❌ Neither Positions Table nor Empty State found.');
            }
        }

        console.log('🎉 Test Completed Successfully!');

    } catch (error) {
        console.error('❌ Test Failed:', error.message);
    } finally {
        // Keep browser open for a few seconds to see result
        await new Promise(r => setTimeout(r, 5000));
        await browser.close();
    }
})();
