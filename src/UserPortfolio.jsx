import { useState, useEffect } from 'react'
import { ethers } from 'ethers'
import { ClobClient } from '@polymarket/clob-client'
import './UserPortfolio.css'

const UserPortfolio = () => {
    const [address, setAddress] = useState(null)
    const [username, setUsername] = useState(null)
    const [profileImage, setProfileImage] = useState(null)
    const [cashBalance, setCashBalance] = useState(null)
    const [loginMethod, setLoginMethod] = useState(null) // 'Phantom Wallet' | 'email'
    const [privateKeyInput, setPrivateKeyInput] = useState('')
    const [proxyAddressInput, setProxyAddressInput] = useState('') // For manual proxy input
    const [showEmailLogin, setShowEmailLogin] = useState(false)
    const [isL2Authenticated, setIsL2Authenticated] = useState(false)

    const [viewMode, setViewMode] = useState('active') // 'active' | 'closed' | 'activity'
    const [closedPositions, setClosedPositions] = useState([])
    const [activity, setActivity] = useState([])

    // Re-added missing state
    const [positions, setPositions] = useState([])
    const [loading, setLoading] = useState(false)
    const [error, setError] = useState(null)
    const [client, setClient] = useState(null)

    // Helper: Fetch Profile (Proxy Address & Username)
    const getProfileData = async (userAddress) => {
        try {
            // Use locally running backend (dev) or Vercel backend (prod)
            // Ensure http:// prefix if mostly running locally without env set
            const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001';
            const urls = [
                `${API_URL}/gamma-api/profiles/${userAddress}`,
                `${API_URL}/gamma-api/public-profile?address=${userAddress}`
            ]

            for (const url of urls) {
                try {
                    const res = await fetch(url)
                    if (res.ok) {
                        return await res.json()
                    }
                } catch (e) {
                    console.warn(`Fetch failed for ${url}`, e)
                }
            }
            return null
        } catch (e) {
            console.warn("Profile fetch failed:", e)
            return null
        }
    }

    // Authenticate L2 & Fetch Private Data
    const performL2Login = async (signer, userAddress, authType) => {
        try {
            // 0. Time Sync Check (Crucial for CLOB 400 errors)
            try {
                const timeRes = await fetch("https://clob.polymarket.com/time");
                if (timeRes.ok) {
                    const timeData = await timeRes.json();
                    // server time format check
                    if (timeData.time) {
                        const serverTime = new Date(timeData.time).getTime();
                        const localTime = Date.now();
                        const diff = Math.abs(serverTime - localTime);

                        console.log(`Time Sync: Server ${timeData.time} vs Local ${new Date().toISOString()} (Diff: ${diff}ms)`);

                        if (diff > 10000) { // 10s tolerance
                            const err = `CRITICAL: Your System Clock is off by ${Math.round(diff / 1000)}s. Please set time to Automatic. (Tu reloj está desincronizado)`;
                            setError(err);
                            throw new Error(err);
                        }
                    }
                }
            } catch (timeErr) {
                console.warn("Time check failed or blocked", timeErr);
                if (timeErr.message.includes("Clock")) throw timeErr;
            }

            // 1. Fetch Profile to get Proxy Address
            let profile = await getProfileData(userAddress)

            // Priority: Manual Input > Stored > API Detection
            let proxyAddress = localStorage.getItem('poly_proxy_address')
                || proxyAddressInput
                || profile?.proxyWallet

            if (!proxyAddress) {
                console.log("Profile proxy missing, checking positions for proxy info...");
                try {
                    const posRes = await fetch(`https://data-api.polymarket.com/positions?user=${userAddress}&limit=1`)
                    if (posRes.ok) {
                        const posData = await posRes.json()
                        if (posData.length > 0 && posData[0].proxyWallet) {
                            proxyAddress = posData[0].proxyWallet
                            console.log("Found Proxy via Positions:", proxyAddress)
                        }
                    }
                } catch (e) { console.warn("Proxy lookup failed", e) }
            }

            // Final fallback to userAddress
            proxyAddress = proxyAddress || profile?.address || userAddress

            const name = profile?.name || profile?.display_name || profile?.slug
            const image = profile?.profileImage

            if (name) setUsername(name)
            if (image) setProfileImage(image)

            // 2. Determine Signature Type & Funder FIRST
            // Type 0: EOA (Standard Wallet)
            // Type 1: POLY_PROXY (Magic/Google users)
            // Type 2: GNOSIS_SAFE (Wallet + Proxy users)
            let signatureType = 0
            let funderAddress = userAddress

            if (authType === 'email') {
                signatureType = 1
                // CRITICAL: Type 1 (POLY_PROXY) requires the Proxy Address as funder
                funderAddress = proxyAddress  // Must be proxy, not EOA!

                // VALIDATE: Proxy must exist and be different from EOA
                if (!funderAddress || funderAddress.toLowerCase() === userAddress.toLowerCase()) {
                    const err = "⚠️ MAGIC LOGIN REQUIRES PROXY ADDRESS!\n\n" +
                        "1. Go to: polymarket.com/settings\n" +
                        "2. Copy your 'Proxy Address' (0x...)\n" +
                        "3. Paste it in the 'Proxy Address' field\n" +
                        "4. Click Login again\n\n" +
                        "🇪🇸 NECESITAS tu Proxy Address de polymarket.com/settings";
                    setError(err);
                    throw new Error(err);
                }

                console.log("Auth Type is EMAIL/GOOGLE -> Type 1 (PolyProxy), Funder:", funderAddress);
            } else if (proxyAddress && proxyAddress.toLowerCase() !== userAddress.toLowerCase()) {
                // If we found a proxy distinct from the EOA, Use Type 2
                signatureType = 2
                funderAddress = proxyAddress
            }

            console.log(`Auth Mode: Type ${signatureType}, Funder: ${funderAddress}`);

            // 3. Init L1 Client & Create Keys
            let creds = null;

            // Critical Logic: Which Type to use for KeyGen?
            // Type 1 (Google) -> Use Type 1 WITH funderAddress (Proxy)
            // Type 2 (Proxy) -> Use Type 0 (EOA)
            // Type 0 (EOA) -> Use Type 0
            const keyGenType = (signatureType === 1) ? 1 : 0;
            const keyGenFunder = (signatureType === 1) ? funderAddress : undefined;

            try {
                console.log(`Initializing L1 Client as Type ${keyGenType}, Funder: ${keyGenFunder || 'N/A'}`);
                const l1Client = new ClobClient(
                    "https://clob.polymarket.com",
                    137,
                    signer,
                    undefined,
                    keyGenType,
                    keyGenFunder  // Pass funder for Type 1 (Magic)
                )

                // Attempt 1: Standard Derive/Create
                try {
                    creds = await l1Client.createOrDeriveApiKey()
                } catch (deriveErr) {
                    console.warn("Derive/Create failed. Attempting FORCE NEW KEY (createApiKey)...", deriveErr);
                    // Attempt 2: Force New Key (solves stuck nonce/invalid key issues)
                    creds = await l1Client.createApiKey()
                }

            } catch (keyErr) {
                console.warn(`KeyGen Type ${keyGenType} failed:`, keyErr);

                // Fallback: If 1 failed, try 0.
                if (keyGenType !== 0) {
                    console.log(`Retrying KeyGen as Type 0 (Standard)...`);
                    const fallbackClient = new ClobClient(
                        "https://clob.polymarket.com",
                        137,
                        signer,
                        undefined,
                        0,
                        undefined
                    );
                    creds = await fallbackClient.createOrDeriveApiKey();
                } else {
                    throw keyErr;
                }
            }

            // 4. Init L2 Client with full Auth
            const l2Client = new ClobClient(
                "https://clob.polymarket.com",
                137,
                signer,
                creds,
                signatureType,
                funderAddress
            )

            setClient(l2Client)
            setIsL2Authenticated(true)

            // 5. Fetch Balance
            // asset_type: COLLATERAL (USDC)
            const balanceData = await l2Client.getBalanceAllowance({
                asset_type: "COLLATERAL"
            })

            // Balance is in USDC 6 decimals
            const rawBalance = balanceData.balance || "0"
            const readable = parseFloat(rawBalance) / 1000000
            setCashBalance(readable)

        } catch (authStateErr) {
            console.error("Auth Step Error:", authStateErr)

            // If specific API Key error, FORCE LOGOUT to fix state
            if (authStateErr.message.includes("api key") || authStateErr.message.includes("400")) {
                console.warn("Auth failed - clearing invalid session.");
                localStorage.removeItem('poly_auth_type');
                localStorage.removeItem('poly_priv_key');
                setLoginMethod(null);
                setAddress(null);
                setError("Session was invalid and has been reset. Please click 'Connect Phantom Wallet' again.");
                return;
            }

            const msg = authStateErr.message.includes("api key")
                ? "Auth failed. Try disconnecting and reconnecting your wallet."
                : authStateErr.message;
            setError("Logged in, but L2 Auth (Balance) failed. " + msg)

            if (authStateErr.message.includes("400")) {
                console.error("Client Time:", Math.floor(Date.now() / 1000));
                setError("Auth Failed (400). CHECK YOUR SYSTEM CLOCK! Polymarket requires accurate time. " + authStateErr.message);
            }
        }
    }

    // Connect Phantom Wallet
    const connectWallet = async () => {
        setError(null)
        setLoading(true)
        try {
            if (!window.ethereum) throw new Error('Phantom Wallet not detected')

            const provider = new ethers.providers.Web3Provider(window.ethereum)
            await provider.send("eth_requestAccounts", [])

            // Force specific Polygon Mainnet switch (Chain ID 137)
            const chainId = await provider.send("eth_chainId", []);
            if (chainId !== "0x89") { // 137 in hex
                try {
                    await provider.send("wallet_switchEthereumChain", [{ chainId: "0x89" }]);
                } catch (switchError) {
                    if (switchError.code === 4902) {
                        await provider.send("wallet_addEthereumChain", [{
                            chainId: "0x89",
                            chainName: "Polygon Mainnet",
                            rpcUrls: ["https://polygon-rpc.com/"],
                            blockExplorerUrls: ["https://polygonscan.com/"],
                            nativeCurrency: { name: "MATIC", symbol: "MATIC", decimals: 18 }
                        }]);
                    } else {
                        throw switchError;
                    }
                }
            }

            // Re-get provider/signer after switch
            const newProvider = new ethers.providers.Web3Provider(window.ethereum)
            const signer = newProvider.getSigner()
            const userAddress = await signer.getAddress()

            setAddress(userAddress)
            setLoginMethod('Phantom Wallet')

            // Persist Session
            localStorage.setItem('poly_auth_type', 'Phantom Wallet')

            // Parallel: Fetch Public Data & Do Authentication
            fetchActivePositions(userAddress)
            fetchClosedPositions(userAddress)
            await performL2Login(signer, userAddress, 'Phantom Wallet')

        } catch (err) {
            console.error("Wallet connection error:", err)

            // User-friendly error messages
            let errorMsg = "Wallet connection failed: " + err.message;

            if (err.message.includes("User rejected") || err.code === 4001) {
                errorMsg = "You rejected the connection request. Please try again and approve. / Rechazaste la conexión.";
            } else if (err.message.includes("chain") || err.code === 4902) {
                errorMsg = "Failed to switch to Polygon network. Please add Polygon manually in your wallet. / Error al cambiar a Polygon.";
            } else if (err.message.includes("No Ethereum provider")) {
                errorMsg = "Phantom Wallet not detected. Please install it. / Phantom no detectado.";
            } else if (err.message.includes("Unexpected error")) {
                errorMsg = "Wallet rejected the request. Make sure Phantom is unlocked and try again. / La wallet rechazó la solicitud.";
            }

            setError(errorMsg)
        } finally {
            setLoading(false)
        }
    }

    // Connect with Private Key (Google/Email)
    // Accepts optional key argument for auto-login
    const connectPrivateKey = async (savedKey = null) => {
        setError(null)
        setLoading(true)
        try {
            // Determine key source: argument (auto-login) or state (user input)
            // Note: When called via onClick, the first arg is the event object, so checking type string is safer
            const inputKey = (typeof savedKey === 'string') ? savedKey : privateKeyInput;

            if (!inputKey) throw new Error('Please enter your Private Key')

            let key = inputKey.trim()

            // Validation: Ensure it looks like a hex key
            // Remove 0x prefix for length check if needed, but easiest regex matches both
            const hexRegex = /^(0x)?[0-9a-fA-F]{64}$/
            if (!hexRegex.test(key)) {
                throw new Error("Invalid Private Key format. It should be a 64-character hex string (with or without 0x prefix).")
            }

            if (!key.startsWith('0x')) key = '0x' + key


            const rpcUrl = "https://polygon-rpc.com"
            const provider = new ethers.providers.JsonRpcProvider(rpcUrl)

            // This line crashed before if key was garbage
            const wallet = new ethers.Wallet(key, provider)
            const userAddress = await wallet.getAddress()

            setAddress(userAddress)
            setLoginMethod('email')
            setShowEmailLogin(false)
            setPrivateKeyInput('')

            // Persist Session
            localStorage.setItem('poly_auth_type', 'email')
            localStorage.setItem('poly_priv_key', key)
            if (proxyAddressInput) {
                localStorage.setItem('poly_proxy_address', proxyAddressInput)
            }

            // Parallel: Fetch Public Data & Do Authentication
            console.log("Fetching positions for:", userAddress);
            fetchActivePositions(userAddress)
            fetchClosedPositions(userAddress)
            await performL2Login(wallet, userAddress, 'email')

        } catch (err) {
            console.error(err)
            setError(err.message)
            // Clear invalid session data if it fails
            localStorage.removeItem('poly_auth_type')
            localStorage.removeItem('poly_priv_key')
        } finally {
            setLoading(false)
        }
    }

    const fetchActivePositions = async (userAddress) => {
        try {
            // Explicitly set sizeThreshold=0 to get all dust/fractional positions (default is 1)
            // limit=500 to get maximum items
            const positionsRes = await fetch(`https://data-api.polymarket.com/positions?user=${userAddress}&sizeThreshold=0&limit=500`)
            if (positionsRes.ok) {
                const positionsData = await positionsRes.json()
                const active = positionsData.filter(p => p.size > 0)
                setPositions(active)
            }
        } catch (err) {
            console.warn("Public positions fetch failed:", err)
        }
    }

    const fetchClosedPositions = async (userAddress) => {
        try {
            const res = await fetch(`https://data-api.polymarket.com/v1/closed-positions?user=${userAddress}&limit=50`)
            if (res.ok) {
                const data = await res.json()
                setClosedPositions(data)
            }
        } catch (err) {
            console.warn("Closed positions fetch failed:", err)
        }
    }

    const fetchActivity = async (userAddress) => {
        try {
            // Updated: removed &type=TRADE to get ALL activity (Split, Redeem, Merge, etc.)
            const res = await fetch(`https://data-api.polymarket.com/activity?user=${userAddress}&limit=50&sortBy=TIMESTAMP&sortDirection=DESC`)
            if (res.ok) {
                const data = await res.json()
                setActivity(data)
            }
        } catch (err) {
            console.warn("Activity fetch failed:", err)
        }
    }

    const disconnect = () => {
        setAddress(null)
        setUsername(null)
        setProfileImage(null)
        setPositions([])
        setClosedPositions([])
        setActivity([])
        setClient(null)
        setCashBalance(null)
        setLoginMethod(null)
        setShowEmailLogin(false)
        setIsL2Authenticated(false)
        setViewMode('active')

        localStorage.removeItem('poly_auth_type')
        localStorage.removeItem('poly_priv_key')
    }

    // Auto-Login Effect
    useEffect(() => {
        const savedAuthType = localStorage.getItem('poly_auth_type')
        const savedKey = localStorage.getItem('poly_priv_key')

        if (savedAuthType === 'email' && savedKey) {
            // Auto login with private key
            connectPrivateKey(savedKey)
        } else if (savedAuthType === 'Phantom Wallet') {
            // Auto login with Phantom Wallet (requires it to be unlocked)
            if (window.ethereum) {
                connectWallet()
            }
        }
    }, [])

    const refreshData = async () => {
        if (!address) return;
        setRefreshing(true);
        try {
            await fetchActivePositions(address);
            await fetchClosedPositions(address); // Fetch closed too
            await fetchActivity(address);

            // Also refresh profile in case it changed
            const profile = await getProfileData(address);
            if (profile) {
                const name = profile.name || profile.display_name || profile.slug;
                if (name) setUsername(name);
                if (profile.profileImage) setProfileImage(profile.profileImage);
            }

            if (isL2Authenticated && client) {
                const balanceData = await client.getBalanceAllowance({
                    asset_type: "COLLATERAL"
                })
                const rawBalance = balanceData.balance || "0"
                setCashBalance(parseFloat(rawBalance) / 1000000)
            }
        } catch (e) {
            console.error("Refresh failed", e)
        } finally {
            setRefreshing(false)
        }
    }

    const [refreshing, setRefreshing] = useState(false)

    // ... (rest of logic)

    const totalValue = positions.reduce((sum, p) => sum + (p.curPrice * p.size), 0)
    // Calculate Total PnL across all active positions
    const totalActivePnl = positions.reduce((sum, p) => sum + (p.cashPnl || 0), 0)

    if (!address) {
        // ... (Login view unchanged)
        return (
            <div className="portfolio-login">
                {!showEmailLogin ? (
                    <div className="login-options">

                        <button
                            onClick={() => setShowEmailLogin(true)}
                            className="connect-button google-btn"
                            disabled={loading}
                        >
                            <span className="icon">📧</span>
                            Log in with Google / Email
                        </button>
                        <div className="divider"><span>OR</span></div>
                        <button
                            onClick={connectWallet}
                            className="connect-button Phantom Wallet-btn"
                            disabled={loading}
                        >
                            <span className="icon">👻</span>
                            {loading && loginMethod === 'Phantom Wallet' ? "Connecting..." : "Connect Phantom Wallet"}
                        </button>

                    </div>
                ) : (
                    <div className="email-login-form">
                        <input
                            type="text"
                            placeholder="Private Key (from reveal.magic.link/polymarket)"
                            value={privateKeyInput}
                            onChange={(e) => setPrivateKeyInput(e.target.value)}
                            className="pk-input"
                        />
                        <input
                            type="text"
                            placeholder="Proxy Address (Optional - from polymarket.com/settings)"
                            value={proxyAddressInput}
                            onChange={(e) => setProxyAddressInput(e.target.value)}
                            className="pk-input"
                            style={{ marginTop: '10px', fontSize: '0.85rem', opacity: 0.8 }}
                        />
                        <button
                            onClick={() => connectPrivateKey(privateKeyInput)}
                            className="connect-button email-btn"
                            disabled={loading}
                        >
                            {loading ? "Verifying..." : "Login"}
                        </button>
                        <div className="form-actions">
                            <button
                                onClick={() => setShowEmailLogin(false)}
                                className="cancel-btn"
                            >
                                Back
                            </button>
                            <button
                                onClick={() => connectPrivateKey()}
                                className="submit-btn"
                                disabled={loading}
                            >
                                {loading ? "Verifying..." : "Log In"}
                            </button>
                        </div>
                        <p className="security-note">
                            Note: Your key is only used locally to sign requests and is never saved to any server.
                        </p>
                    </div>
                )}

                {error && <p className="error-text">{error}</p>}
            </div>
        )
    }

    return (
        <div className="portfolio-dashboard">
            <div className="portfolio-header">
                <div className="header-left">
                    <h3>My Portfolio</h3>
                    <div className="user-profile">
                        {profileImage && <img src={profileImage} alt="Profile" className="profile-img" />}
                        <div className="user-details">
                            {username && <span className="username">@{username}</span>}
                            <span className="address" title={address}>
                                {address.slice(0, 6)}...{address.slice(-4)}
                            </span>
                        </div>
                    </div>
                </div>

                <div className="header-right">
                    <button
                        onClick={refreshData}
                        className="refresh-btn"
                        disabled={refreshing}
                    >
                        {refreshing ? "Refreshing..." : "↻ Refresh"}
                    </button>
                    <button onClick={disconnect} className="disconnect-btn">Disconnect</button>
                </div>
            </div>

            <div className="stats-grid">
                <div className="stat-card">
                    <span className="label">Portfolio Value</span>
                    <span className="value">${totalValue.toFixed(2)}</span>
                    <span className={`sub-value ${totalActivePnl >= 0 ? 'profit' : 'loss'}`}>
                        {totalActivePnl >= 0 ? '+' : ''}{totalActivePnl.toFixed(2)} P&L
                    </span>
                </div>
                <div className="stat-card">
                    <span className="label">Cash (USDC)</span>
                    <span className="value">
                        {cashBalance !== null ? `$${cashBalance.toFixed(2)}` : (
                            isL2Authenticated ? 'Loading...' : '---'
                        )}
                    </span>
                </div>
                <div className="stat-card">
                    <span className="label">Active Positions</span>
                    <span className="value">{positions.length}</span>
                </div>
            </div>

            <div className="portfolio-tabs">
                <button
                    className={`tab-btn ${viewMode === 'active' ? 'active' : ''}`}
                    onClick={() => {
                        setViewMode('active')
                        if (address && positions.length === 0) fetchActivePositions(address)
                    }}
                >
                    Active Bets
                </button>
                <button
                    className={`tab-btn ${viewMode === 'closed' ? 'active' : ''}`}
                    onClick={() => {
                        setViewMode('closed')
                        if (address && closedPositions.length === 0) fetchClosedPositions(address)
                    }}
                >
                    Closed Positions
                </button>
                <button
                    className={`tab-btn ${viewMode === 'activity' ? 'active' : ''}`}
                    onClick={() => {
                        setViewMode('activity')
                        if (address && activity.length === 0) fetchActivity(address)
                    }}
                >
                    Activity Log
                </button>
            </div>

            {viewMode === 'active' ? (
                positions.length > 0 ? (
                    <div className="positions-list">
                        <div className="table-wrapper">
                            <table>
                                <thead>
                                    <tr>
                                        <th>Market</th>
                                        <th>Side</th>
                                        <th>Size</th>
                                        <th>Avg Price</th>
                                        <th>Cur Price</th>
                                        <th>Value</th>
                                        <th>P&L</th>
                                        <th>ROI</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {positions.map((pos, idx) => {
                                        const pnl = pos.cashPnl || 0;
                                        const roi = (pos.percentPnl || 0) * 100;
                                        return (
                                            <tr key={idx}>
                                                <td className="market-name">
                                                    <div className="market-title">{pos.title}</div>
                                                </td>
                                                <td>
                                                    <span className={`outcome-tag ${pos.outcome}`}>
                                                        {pos.outcome}
                                                    </span>
                                                </td>
                                                <td>{pos.size.toFixed(1)}</td>
                                                <td>${pos.avgPrice.toFixed(2)}</td>
                                                <td>${pos.curPrice.toFixed(2)}</td>
                                                <td>${(pos.curPrice * pos.size).toFixed(2)}</td>
                                                <td className={pnl >= 0 ? 'text-green' : 'text-red'}>
                                                    {pnl >= 0 ? '+' : ''}${pnl.toFixed(2)}
                                                </td>
                                                <td className={pnl >= 0 ? 'text-green' : 'text-red'}>
                                                    {pnl >= 0 ? '+' : ''}{roi.toFixed(1)}%
                                                </td>
                                            </tr>
                                        )
                                    })}
                                </tbody>
                            </table>
                        </div>
                    </div>
                ) : (
                    <div className="empty-portfolio">
                        <p>No active positions found.</p>
                    </div>
                )
            ) : viewMode === 'closed' ? (
                // CLOSED POSITIONS VIEW
                closedPositions.length > 0 ? (
                    <div className="positions-list">
                        <div className="table-wrapper">
                            <table>
                                <thead>
                                    <tr>
                                        <th>Market</th>
                                        <th>Side</th>
                                        <th>Bought ($)</th>
                                        <th>P&L</th>
                                        <th>ROI</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {closedPositions.map((pos, idx) => {
                                        const pnl = pos.realizedPnl || 0;
                                        const cost = pos.totalBought || 0;
                                        const roi = cost > 0 ? (pnl / cost) * 100 : 0;

                                        return (
                                            <tr key={idx}>
                                                <td className="market-name">
                                                    <div className="market-title">{pos.title}</div>
                                                </td>
                                                <td>
                                                    <span className={`outcome-tag ${pos.outcome}`}>
                                                        {pos.outcome}
                                                    </span>
                                                </td>
                                                <td>${cost.toFixed(2)}</td>
                                                <td className={pnl >= 0 ? 'text-green' : 'text-red'}>
                                                    {pnl >= 0 ? '+' : ''}${pnl.toFixed(2)}
                                                </td>
                                                <td className={pnl >= 0 ? 'text-green' : 'text-red'}>
                                                    {pnl >= 0 ? '+' : ''}{roi.toFixed(1)}%
                                                </td>
                                            </tr>
                                        )
                                    })}
                                </tbody>
                            </table>
                        </div>
                    </div>
                ) : (
                    <div className="empty-portfolio">
                        <p>No closed positions found.</p>
                    </div>
                )
            ) : (
                // ACTIVITY VIEW
                activity.length > 0 ? (
                    <div className="positions-list">
                        <div className="table-wrapper">
                            <table className="activity-table">
                                <thead>
                                    <tr>
                                        <th>ACTIVITY</th>
                                        <th>MARKET</th>
                                        <th className="text-right">VALUE</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {activity.map((act, idx) => {
                                        const isBuy = act.side === 'BUY';
                                        const date = new Date(act.timestamp * 1000);
                                        const timeAgo = (() => {
                                            const diffMs = new Date() - date;
                                            const diffMins = Math.floor(diffMs / 60000);
                                            if (diffMins < 60) return `${diffMins}m ago`;
                                            const diffHrs = Math.floor(diffMins / 60);
                                            if (diffHrs < 24) return `${diffHrs}h ago`;
                                            return `${Math.floor(diffHrs / 24)}d ago`;
                                        })();

                                        return (
                                            <tr key={idx}>
                                                <td className="activity-cell">
                                                    <div className="activity-info">
                                                        <div className={`activity-icon ${isBuy ? 'buy' : 'sell'}`}>
                                                            {isBuy ? '+' : '-'}
                                                        </div>
                                                        <span className="activity-type">{isBuy ? 'Bought' : 'Sold'}</span>
                                                    </div>
                                                </td>
                                                <td className="market-cell">
                                                    <div className="market-row-content">
                                                        {act.image && <img src={act.image} className="mini-icon" onError={(e) => e.target.style.display = 'none'} alt="" />}
                                                        <div className="market-details">
                                                            <div className="market-title-text">{act.title}</div>
                                                            <div className="market-sub">
                                                                <span className={`outcome-text ${act.outcome === 'Yes' ? 'text-green' : 'text-red'}`}>{act.outcome}</span>
                                                                <span className="price-info">{(act.price * 100).toFixed(0)}¢</span>
                                                                <span className="size-info">{act.size.toFixed(1)} shares</span>
                                                            </div>
                                                        </div>
                                                    </div>
                                                </td>
                                                <td className="value-cell text-right">
                                                    <div className={`value-amount ${isBuy ? 'neg' : 'pos'}`}>
                                                        {isBuy ? '-' : '+'}${act.usdcSize.toFixed(2)}
                                                    </div>
                                                    <div className="time-ago">{timeAgo}</div>
                                                </td>
                                            </tr>
                                        )
                                    })}
                                </tbody>
                            </table>
                        </div>
                    </div>
                ) : (
                    <div className="empty-portfolio">
                        <p>No activity found.</p>
                    </div>
                )
            )}
        </div>
    )
}

export default UserPortfolio
