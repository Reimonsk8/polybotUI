import { useState, useEffect } from 'react'
import './PortfolioTabs.css'
import { fetchActivityLog as fetchActivityData } from './ActivityLogFetcher'
import { Side, OrderType } from '@polymarket/clob-client'
import { toast } from 'react-toastify'
import ConfirmModal from './ConfirmModal'

const PortfolioTabs = ({ userAddress, client, apiCreds }) => {
    const [activeTab, setActiveTab] = useState('active') // 'active', 'closed', 'activity'
    const [activeBets, setActiveBets] = useState([])
    const [closedPositions, setClosedPositions] = useState([])
    const [activityLog, setActivityLog] = useState([])
    const [loading, setLoading] = useState(false)
    const [liveUpdates, setLiveUpdates] = useState(false)
    const [wsConnected, setWsConnected] = useState(false)
    const [hasFetched, setHasFetched] = useState(false)

    // AUTO-SELL STATE
    const [autoSellEnabled, setAutoSellEnabled] = useState(false)
    const [takeProfitPercent, setTakeProfitPercent] = useState(25)
    const [stopLossPercent, setStopLossPercent] = useState(50)
    const [triggeredOrders, setTriggeredOrders] = useState(new Set()) // Track executed sells to prevent loops

    // MODAL STATE
    const [sellModalOpen, setSellModalOpen] = useState(false)
    const [betToSell, setBetToSell] = useState(null)

    // Fetch Active Bets using Data API /positions endpoint
    const fetchActiveBets = async () => {
        try {
            if (!userAddress) return

            const proxyUrl = import.meta.env.VITE_PROXY_API_URL || 'http://localhost:3001'
            const useProxy = import.meta.env.VITE_USE_PROXY !== 'false'

            const params = new URLSearchParams({
                user: userAddress,
                sizeThreshold: '1', // Filter dust
                limit: '100',
                sortBy: 'TOKENS',
                sortDirection: 'DESC'
            })

            const positionsUrl = useProxy
                ? `${proxyUrl}/api/data-api/positions?${params.toString()}`
                : `https://data-api.polymarket.com/positions?${params.toString()}`

            const response = await fetch(positionsUrl)
            if (!response.ok) {
                setActiveBets([])
                return
            }

            const positions = await response.json()

            if (Array.isArray(positions) && positions.length > 0) {
                const mappedPositions = positions.map(pos => ({
                    ...pos,
                    market: pos.conditionId,
                    conditionId: pos.conditionId,
                    asset: pos.asset, // Important for trading
                    marketData: {
                        question: pos.title,
                        icon: pos.icon,
                        slug: pos.slug,
                        endDate: pos.endDate
                    },
                    image: pos.icon,
                    curPrice: Number(pos.curPrice),
                    avgPrice: Number(pos.avgPrice),
                    pnl: Number(pos.cashPnl),
                    percentPnl: Number(pos.percentPnl), // API Pnl usually reliable
                    size: Number(pos.size)
                }))

                // IF Live Updates are ON, fetch Real-Time Prices from CLOB
                // 2. Standardize P&L Calculation Locally
                // This ensures consistency between API load and Live updates
                const standardizedPositions = mappedPositions.map(pos => {
                    const size = parseFloat(pos.size) || 0
                    const avg = parseFloat(pos.avgPrice) || 0
                    const curr = parseFloat(pos.curPrice) || 0

                    if (avg <= 0) return { ...pos, percentPnl: 0, pnl: 0 } // Avoid division by zero

                    // Formula: (Current - Avg) / Avg
                    const pnlRaw = (curr - avg) * size
                    const percentRaw = (curr - avg) / avg

                    return {
                        ...pos,
                        pnl: pnlRaw,
                        percentPnl: percentRaw
                    }
                })

                setActiveBets(standardizedPositions)

                // IF Live Updates are ON, fetch Real-Time Prices from CLOB
                if (liveUpdates) {
                    try {
                        const updatedPositions = await Promise.all(standardizedPositions.map(async (pos) => {
                            if (!pos.asset) return pos

                            try {
                                let livePrice = 0
                                let priceFound = false

                                // OPTION A: Use Client OrderBook (Best)
                                if (client) {
                                    try {
                                        const book = await client.getOrderBook(pos.asset)
                                        if (book && book.bids && book.bids.length > 0) {
                                            livePrice = parseFloat(book.bids[0].price)
                                            priceFound = !isNaN(livePrice)
                                        }
                                    } catch (err) {
                                        // Ignore 404 (No matching orderbook)
                                        if (err.message && !err.message.includes('404')) {
                                            // console.warn('OrderBook Error:', err)
                                        }
                                    }
                                }

                                // OPTION B: Raw Fetch (Fallback)
                                if (!priceFound) {
                                    try {
                                        const clobRes = await fetch(`https://clob.polymarket.com/price?token_id=${pos.asset}&side=sell`)
                                        if (clobRes.ok) {
                                            const clobData = await clobRes.json()
                                            if (clobData.price) {
                                                livePrice = parseFloat(clobData.price)
                                                priceFound = true
                                            }
                                        }
                                    } catch (err) {
                                        // Ignore network errors on fallback
                                    }
                                }

                                if (priceFound) {
                                    const avg = pos.avgPrice || 0

                                    // Recalculate PnL (Live)
                                    let newPnl = 0
                                    let newPercentPnl = 0

                                    if (avg > 0) {
                                        newPnl = (livePrice - avg) * pos.size
                                        newPercentPnl = (livePrice - avg) / avg
                                    }

                                    return {
                                        ...pos,
                                        curPrice: livePrice,
                                        pnl: newPnl,
                                        percentPnl: newPercentPnl,
                                        isLive: true
                                    }
                                }
                            } catch (e) { /* Ignore */ }
                            return pos
                        }))

                        setActiveBets(updatedPositions)
                        return updatedPositions
                    } catch (err) {
                        console.error("Failed to fetch live CLOB prices", err)
                        // fallback used above
                        return standardizedPositions
                    }
                }

                return standardizedPositions
            } else {
                setActiveBets([])
                return []
            }

        } catch (err) {
            console.error('[Active Bets] Failed to fetch:', err)
            setActiveBets([])
            return []
        }
    }

    // AUTO-SELL LOGIC
    // Check positions whenever activeBets updates
    useEffect(() => {
        if (!autoSellEnabled || !client || activeBets.length === 0) return

        const checkAndSell = async () => {
            for (const bet of activeBets) {
                // Skip if already triggered or invalid
                if (triggeredOrders.has(bet.conditionId)) continue
                // Skip if asset ID is missing (can happen with Gamma positions that don't map to CLOB tokens)
                if (!bet.asset || bet.size <= 0) continue

                // Check profitability
                let shouldSell = false
                let reason = ''

                // Calculate PnL (API vs Local)
                // Use Standardized 'percentPnl' which is already live-updated
                const currentPnlPercent = bet.percentPnl * 100

                // Take Profit
                if (currentPnlPercent >= takeProfitPercent) {
                    shouldSell = true
                    reason = `Take Profit: +${currentPnlPercent.toFixed(1)}%`
                }
                // Stop Loss
                else if (currentPnlPercent <= -stopLossPercent) {
                    shouldSell = true
                    reason = `Stop Loss: ${currentPnlPercent.toFixed(1)}%`
                }

                if (shouldSell) {
                    console.log(`[Auto Sell] Attempting to sell ${bet.title} (${reason})`)

                    // 1. Mark as triggered IMMEDIATELY to prevent loops/race conditions
                    setTriggeredOrders(prev => new Set(prev).add(bet.conditionId))

                    try {
                        if (!client || !client.signer) {
                            console.warn("[Auto Sell] Client not ready or read-only.")
                            continue
                        }

                        // 2. PRE-FLIGHT: Check Liquidity (GET /book)
                        // If book 404s or is empty, we ABORT.
                        let bestBid = 0
                        try {
                            const book = await client.getOrderBook(bet.asset)
                            if (book && book.bids && book.bids.length > 0) {
                                bestBid = parseFloat(book.bids[0].price)
                            } else {
                                throw new Error("No Bids Available")
                            }
                        } catch (e) {
                            console.warn(`[Auto Sell] Skipped ${bet.title}: Market illiquid or invalid token.`, e.message)
                            toast.error(`Auto-Sell Skipped: ${bet.title} has no liquidity.`)
                            // We leave it in 'triggeredOrders' so we don't spam retry. 
                            // User must intervene manually or refresh.
                            continue
                        }

                        // 3. SAFE PRICE LOGIC
                        // Clamp to [0.01, 0.99]
                        let sellPrice = bestBid
                        if (sellPrice >= 1) sellPrice = 0.99
                        if (sellPrice <= 0) sellPrice = 0.01

                        console.log(`[Auto Sell] Execution Price: ${sellPrice} for ${bet.size} shares`)

                        // 4. SUBMIT ORDER
                        const generateNonce = () => Date.now() + Math.floor(Math.random() * 1000)

                        const order = await client.createAndPostOrder({
                            tokenID: bet.asset,
                            price: parseFloat(sellPrice.toFixed(4)),
                            side: Side.SELL,
                            size: bet.size,
                            nonce: generateNonce()
                        })

                        console.log('[Auto Sell] Success:', order)
                        toast.success(`Strategy Triggered: Sold ${bet.title} @ ${sellPrice} (${reason})`)

                    } catch (err) {
                        console.error('[Auto Sell] Failed:', err)
                        toast.error(`Auto-Sell Failed for ${bet.title}: ${err.message}`)
                        // Do NOT remove from triggeredOrders. 
                        // If it failed once (e.g. invalid params), it will likely fail again.
                        // Prevent infinite loop.
                    }
                }
            }
        }

        checkAndSell()

    }, [activeBets, autoSellEnabled, takeProfitPercent, stopLossPercent, client])


    // Fetch Closed Positions using L2 authenticated trades
    const fetchClosedPositions = async () => {
        try {
            if (!client) return
            const trades = await client.getTrades({ limit: 200 })
            const positionMap = new Map()

            trades.forEach(trade => {
                const key = `${trade.market}-${trade.asset_id}`
                if (!positionMap.has(key)) {
                    positionMap.set(key, {
                        market: trade.market,
                        asset_id: trade.asset_id,
                        outcome: trade.outcome,
                        title: trade.outcome || 'Unknown',
                        size: 0,
                        pnl: 0,
                        trades: []
                    })
                }

                const position = positionMap.get(key)
                const tradeSize = parseFloat(trade.size)
                const tradePrice = parseFloat(trade.price)

                if (trade.side === 'BUY') {
                    position.size += tradeSize
                    position.pnl -= tradeSize * tradePrice
                } else {
                    position.size -= tradeSize
                    position.pnl += tradeSize * tradePrice
                }
                position.trades.push(trade)
            })

            const closedPositions = Array.from(positionMap.values())
                .filter(p => Math.abs(p.size) < 0.001 && p.trades.length > 0)

            setClosedPositions(closedPositions)
        } catch (err) { }
    }

    const fetchActivityLog = async () => {
        try {
            const proxyUrl = import.meta.env.VITE_PROXY_API_URL || 'http://localhost:3001'
            const useProxy = import.meta.env.VITE_USE_PROXY !== 'false'
            const data = await fetchActivityData(userAddress, client, proxyUrl, useProxy)
            setActivityLog(data)
        } catch (err) { console.error("Failed to fetch activity log", err) }
    }

    const timeAgo = (timestamp) => {
        if (!timestamp) return ''
        const date = typeof timestamp === 'number' ? new Date(timestamp * 1000) : new Date(timestamp)
        const seconds = Math.floor((new Date() - date) / 1000)
        let interval = seconds / 31536000
        if (interval > 1) return Math.floor(interval) + " years ago"
        interval = seconds / 2592000
        if (interval > 1) return Math.floor(interval) + " months ago"
        interval = seconds / 86400
        if (interval > 1) return Math.floor(interval) + " days ago"
        interval = seconds / 3600
        if (interval > 1) return Math.floor(interval) + " hours ago"
        interval = seconds / 60
        if (interval > 1) return Math.floor(interval) + " minutes ago"
        return Math.floor(seconds) + " seconds ago"
    }

    const handleFetchData = async () => {
        if (!userAddress) return
        setLoading(true)
        if (activeTab === 'active') await fetchActiveBets()
        else if (activeTab === 'closed') await fetchClosedPositions()
        else if (activeTab === 'activity') await fetchActivityLog()
        setLoading(false)
        setHasFetched(true)
    }

    useEffect(() => {
        setActiveBets([])
        setClosedPositions([])
        setActivityLog([])
        if (userAddress) handleFetchData()
    }, [activeTab, userAddress])

    // WebSocket for Live Updates
    useEffect(() => {
        if (!liveUpdates || !apiCreds) {
            setWsConnected(false)
            return
        }

        const ws = new WebSocket('wss://ws-subscriptions-clob.polymarket.com/ws/user')
        let pingInterval

        ws.onopen = () => {
            console.log('[WS] Connected to User Channel')
            setWsConnected(true)

            // Authenticate
            const authMsg = {
                type: "user",
                auth: {
                    apiKey: apiCreds.apiKey,
                    secret: apiCreds.secret,
                    passphrase: apiCreds.passphrase
                }
            }
            ws.send(JSON.stringify(authMsg))

            // Start Ping (every 10s as requested)
            pingInterval = setInterval(() => {
                if (ws.readyState === WebSocket.OPEN) {
                    ws.send(JSON.stringify({ type: 'ping' }))
                }
            }, 10000)
        }

        ws.onmessage = (event) => {
            const msg = JSON.parse(event.data)

            // Ignore pongs
            if (msg.type === 'pong' || msg.type === 'error') return

            console.log('[WS] Received:', msg)

            // If we receive an Order or Trade event, refresh our data
            // Common events: "order_created", "order_canceled", "trade_match"
            // The user said: "Orders are placed, updated, or cancelled" and "Trades are matched"
            if (msg.event_type && (
                msg.event_type.includes('order') ||
                msg.event_type.includes('trade') ||
                msg.event_type.includes('fill')
            )) {
                console.log('[WS] Triggering Refresh due to event:', msg.event_type)

                // Refresh relevant data
                // We add a small delay to ensure the backend DB is consistent
                setTimeout(() => {
                    handleFetchData()
                }, 500)
            }
        }

        ws.onclose = () => {
            console.log('[WS] Disconnected')
            setWsConnected(false)
            clearInterval(pingInterval)
        }

        ws.onerror = (err) => {
            console.error('[WS] Error:', err)
            setWsConnected(false)
        }

        return () => {
            ws.close()
            clearInterval(pingInterval)
        }
    }, [liveUpdates, apiCreds, userAddress]) // Re-connect if toggle or creds change



    // POLL For Prices when Live Updates are ON
    // The WebSocket only tells us about OUR trades (fills/cancels).
    // It DOES NOT tell us if the market price changed.
    // To show "Real Time Value" we must poll valid positions frequently.
    useEffect(() => {
        if (!liveUpdates || !userAddress) return

        // Fetch frequently (every 2s) to keep Current Price and P&L fresh
        const priceInterval = setInterval(() => {
            if (activeTab === 'active') {
                fetchActiveBets()
            }
        }, 2000)

        return () => clearInterval(priceInterval)
    }, [liveUpdates, activeTab, userAddress])

    // Standard Auto-Sell polling (safety fallback)
    useEffect(() => {
        // If Live Updates IS ON, the interval above handles it (2s).
        // If Live Updates IS OFF, but Auto-Sell IS ON, we use this slower poll (10s).
        if (!autoSellEnabled || liveUpdates) return

        const interval = setInterval(() => {
            if (activeTab === 'active') fetchActiveBets()
        }, 10000)

        return () => clearInterval(interval)
    }, [autoSellEnabled, liveUpdates, activeTab, userAddress])

    // SELL LOGIC - TRIGGER (Opens Modal)
    const handleSellClick = (bet) => {
        if (!client) {
            toast.error("L2 Authentication required to sell.")
            return
        }
        setBetToSell(bet)
        setSellModalOpen(true)
    }

    // SELL LOGIC - EXECUTE (Called by Modal)
    const confirmSellPosition = async () => {
        const bet = betToSell
        if (!bet) return

        // Close modal immediately
        setSellModalOpen(false)
        setBetToSell(null)

        const sizeToSell = bet.size
        // Use live price if available, otherwise fetch or use curPrice
        let sellPrice = bet.curPrice

        try {
            // 1. MANDATORY: Fetch Fresh Best Bid (Sell Price)
            // If the orderbook 404s or is empty, we CANNOT sell safely.
            let bestBid = 0

            if (bet.asset) {
                try {
                    const book = await client.getOrderBook(bet.asset)

                    // Logic: To SELL, we match the BID side.
                    // If no bids, there is no liquidity to sell into.
                    if (book && book.bids && book.bids.length > 0) {
                        bestBid = parseFloat(book.bids[0].price)
                        console.log(`[Sell] Found fresh best bid: ${bestBid}`)
                    } else {
                        throw new Error("No buyers (Bids) available on the orderbook.")
                    }
                } catch (e) {
                    console.error("OrderBook fetch failed:", e)
                    // If 404 or other error, we must abort.
                    // "No orderbook exists" means token is not tradable.
                    toast.error(`Cannot Sell: Market data unavailable or illiquid. (${e.message})`)
                    return
                }
            } else {
                toast.error("Invalid position data (missing asset ID).")
                return
            }

            // Price Logic: Sell at Best Bid
            // Clamp to valid range
            if (bestBid >= 1) bestBid = 0.99
            if (bestBid <= 0) bestBid = 0.01 // Should have been caught by "No buyers" check theoretically

            let sellPrice = bestBid

            console.log(`[Sell] Selling ${sizeToSell} of ${bet.asset} @ ${sellPrice}`)

            // 2. Place Order (Create AND Post) with Robust Nonce
            const generateNonce = () => Date.now() + Math.floor(Math.random() * 1000)

            const payload = {
                tokenID: bet.asset,
                price: parseFloat(sellPrice.toFixed(4)), // Ensure precision
                side: Side.SELL,
                size: sizeToSell,
            }

            let response = await client.createAndPostOrder({
                ...payload,
                nonce: generateNonce()
            })

            // Retry for Nonce (Single Retry)
            if (response && response.error && response.error.includes('nonce')) {
                console.warn("Nonce collision on Sell. Retrying in 500ms...")
                await new Promise(r => setTimeout(r, 500))

                response = await client.createAndPostOrder({
                    ...payload,
                    nonce: generateNonce()
                })
            }

            console.log("Sell Order Response:", response)

            // Explicit Error Handling
            if (response && (response.error || (response.status && response.status >= 400))) {
                throw new Error(response.error || response.data?.error || "Order Failed")
            }

            if (response && response.orderID) {
                toast.success(`Sell Order Placed! ID: ${response.orderID}`)
            } else {
                toast.info("Sell Order Submitted (Check Activity)")
            }

            console.log("Sell Order Placed:", response)
            // toast.success(`Sell Order Placed! ID: ${response.orderID || 'Submitted'}`) // logic handled above

            // Refresh
            setTimeout(fetchActiveBets, 1000)

        } catch (err) {
            console.error("Sell Failed:", err)
            toast.error(`Sell Failed: ${err.message}`)
        }
    }

    const formatCurrency = (value) => `$${parseFloat(value).toFixed(2)}`

    return (
        <div className="portfolio-tabs">
            {/* Tab Headers */}
            <div className="tab-headers">
                <button className={`tab-header ${activeTab === 'active' ? 'active' : ''}`} onClick={() => setActiveTab('active')}>Active Bets</button>
                <button className={`tab-header ${activeTab === 'closed' ? 'active' : ''}`} onClick={() => setActiveTab('closed')}>Closed Positions</button>
                <button className={`tab-header ${activeTab === 'activity' ? 'active' : ''}`} onClick={() => setActiveTab('activity')}>Activity Log</button>
            </div>

            {/* Tab Content */}
            <div className="tab-content">
                {/* Auto-Sell Manager UI - Only Active Tab */}
                {activeTab === 'active' && userAddress && (
                    <div className="auto-sell-dashboard" style={{
                        background: 'rgba(15, 23, 42, 0.6)',
                        border: '1px solid #334155',
                        borderRadius: '12px',
                        padding: '16px',
                        marginBottom: '20px',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: '12px'
                    }}>
                        <div className="auto-sell-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                <span style={{ fontSize: '1.2rem' }}>🤖</span>
                                <h3 style={{ margin: 0, fontSize: '1rem', color: '#e2e8f0' }}>Auto-Sell Bot</h3>
                            </div>
                            <label className="switch" style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer' }}>
                                <span style={{ fontSize: '0.9rem', color: autoSellEnabled ? '#10b981' : '#94a3b8' }}>
                                    {autoSellEnabled ? 'ENABLED' : 'DISABLED'}
                                </span>
                                <input
                                    type="checkbox"
                                    checked={autoSellEnabled}
                                    onChange={(e) => {
                                        if (!client && e.target.checked) {
                                            toast.error("Login (L2) required for Auto-Sell")
                                            return
                                        }
                                        setAutoSellEnabled(e.target.checked)
                                        // Force Live Updates ON if Auto-Sell is enabled for better data
                                        if (e.target.checked && !liveUpdates) setLiveUpdates(true)
                                    }}
                                    style={{ accentColor: '#10b981' }}
                                />
                            </label>
                        </div>

                        {/* Controls */}
                        <div className="auto-sell-controls" style={{
                            display: 'grid',
                            gridTemplateColumns: '1fr 1fr',
                            gap: '24px',
                            opacity: autoSellEnabled ? 1 : 0.5,
                            pointerEvents: autoSellEnabled ? 'auto' : 'none',
                            transition: 'opacity 0.2s'
                        }}>
                            {/* Take Profit */}
                            <div className="control-group">
                                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '6px' }}>
                                    <span style={{ color: '#10b981', fontWeight: '600', fontSize: '0.9rem' }}>Take Profit</span>
                                    <span style={{ color: '#10b981', fontWeight: '700' }}>{takeProfitPercent}%</span>
                                </div>
                                <input
                                    type="range"
                                    min="1" max="200" step="1"
                                    value={takeProfitPercent}
                                    onChange={(e) => setTakeProfitPercent(Number(e.target.value))}
                                    style={{ width: '100%', accentColor: '#10b981' }}
                                />
                                <div style={{ fontSize: '0.75rem', color: '#94a3b8', marginTop: '4px' }}>
                                    Sell if profit {'>'} {takeProfitPercent}%
                                </div>
                            </div>

                            {/* Stop Loss */}
                            <div className="control-group">
                                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '6px' }}>
                                    <span style={{ color: '#ef4444', fontWeight: '600', fontSize: '0.9rem' }}>Stop Loss</span>
                                    <span style={{ color: '#ef4444', fontWeight: '700' }}>-{stopLossPercent}%</span>
                                </div>
                                <input
                                    type="range"
                                    min="1" max="99" step="1"
                                    value={stopLossPercent}
                                    onChange={(e) => setStopLossPercent(Number(e.target.value))}
                                    style={{ width: '100%', accentColor: '#ef4444' }}
                                />
                                <div style={{ fontSize: '0.75rem', color: '#94a3b8', marginTop: '4px' }}>
                                    Sell if loss {'>'} {stopLossPercent}%
                                </div>
                            </div>
                        </div>
                    </div>
                )}

                {loading ? (
                    <div className="loading-state">Loading...</div>
                ) : (
                    <>
                        {/* Active Bets Tab */}
                        {activeTab === 'active' && (
                            <div className="tab-panel">
                                {activeBets.length === 0 ? (
                                    <div className="empty-state">No active positions found.</div>
                                ) : (
                                    <div className="positions-grid">
                                        {activeBets.map((bet, idx) => (
                                            <div key={idx} className="position-card">
                                                <div className="position-header">
                                                    <div className="market-title-with-icon">
                                                        {bet.icon && (
                                                            <img
                                                                src={bet.icon}
                                                                alt=""
                                                                className="market-icon"
                                                                onError={(e) => e.target.style.display = 'none'}
                                                            />
                                                        )}
                                                        <h4>{bet.title}</h4>
                                                    </div>
                                                    <span className={`outcome-badge ${bet.outcome.toLowerCase()}`}>
                                                        {bet.outcome}
                                                    </span>
                                                </div>

                                                {bet.description && (
                                                    <p className="market-description">{bet.description}</p>
                                                )}

                                                <div className="position-summary-text" style={{ fontSize: '0.85rem', color: '#94a3b8', marginBottom: '12px' }}>
                                                    ${(bet.size * bet.avgPrice).toFixed(2)} on <span className={`outcome-text-inline ${bet.outcome.toLowerCase()}`} style={{ fontWeight: '600', color: bet.outcome === 'Yes' || bet.outcome === 'Up' ? '#10b981' : '#ef4444' }}>{bet.outcome}</span> to win <span style={{ color: '#e2e8f0', fontWeight: '500' }}>${bet.size.toFixed(2)}</span>
                                                </div>

                                                <div className="position-stats">
                                                    <div className="stat">
                                                        <span className="stat-label">Size</span>
                                                        <span className="stat-value">{bet.size.toFixed(2)}</span>
                                                    </div>
                                                    <div className="stat">
                                                        <span className="stat-label">Entry</span>
                                                        <span className="stat-value">{formatCurrency(bet.avgPrice)}</span>
                                                    </div>
                                                    <div className="stat">
                                                        <span className="stat-label">Price {bet.isLive && '⚡'}</span>
                                                        <span className="stat-value" style={{ color: bet.isLive ? '#10b981' : '#f59e0b' }}>{formatCurrency(bet.curPrice)}</span>
                                                    </div>
                                                    <div className="stat">
                                                        <span className="stat-label">Value</span>
                                                        <span className="stat-value" style={{ fontWeight: '700', color: '#e2e8f0' }}>{formatCurrency(bet.size * bet.curPrice)}</span>
                                                    </div>
                                                    <div className="stat">
                                                        <span className="stat-label">P&L</span>
                                                        <span className={`stat-value ${bet.percentPnl >= 0 ? 'positive' : 'negative'}`}>
                                                            {formatCurrency((bet.curPrice - bet.avgPrice) * bet.size)} ({bet.percentPnl >= 0 ? '+' : ''}{(bet.percentPnl * 100).toFixed(1)}%)
                                                        </span>
                                                    </div>
                                                </div>

                                                {/* SELL BUTTON */}
                                                <div className="position-actions" style={{ marginTop: '12px', borderTop: '1px solid #334155', paddingTop: '12px' }}>
                                                    <button
                                                        className="sell-btn"
                                                        onClick={() => handleSellClick(bet)}
                                                        disabled={!client}
                                                        style={{
                                                            width: '100%',
                                                            padding: '10px',
                                                            borderRadius: '6px',
                                                            background: '#ef4444',
                                                            color: 'white',
                                                            border: 'none',
                                                            fontWeight: '600',
                                                            cursor: client ? 'pointer' : 'not-allowed',
                                                            opacity: client ? 1 : 0.6,
                                                            display: 'flex',
                                                            justifyContent: 'center',
                                                            alignItems: 'center',
                                                            gap: '8px'
                                                        }}
                                                    >
                                                        <span>💸 Sell All</span>
                                                        <span style={{ fontWeight: '400', fontSize: '0.9em', opacity: 0.9 }}>
                                                            (Est. {formatCurrency(bet.size * bet.curPrice)})
                                                        </span>
                                                    </button>
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </div>
                        )}

                        {/* Closed Positions Tab */}
                        {activeTab === 'closed' && (
                            <div className="tab-panel">
                                {closedPositions.length === 0 ? (
                                    <div className="empty-state">No closed positions found.</div>
                                ) : (
                                    <div className="positions-grid">
                                        {closedPositions.map((position, idx) => (
                                            <div key={idx} className="position-card">
                                                <div className="position-header">
                                                    <h4>{position.title}</h4>
                                                    <span className={`outcome-badge ${position.outcome.toLowerCase()}`}>
                                                        {position.outcome}
                                                    </span>
                                                </div>
                                                <div className="position-stats">
                                                    <div className="stat">
                                                        <span className="stat-label">P&L</span>
                                                        <span className={`stat-value ${position.pnl >= 0 ? 'positive' : 'negative'}`}>
                                                            {formatCurrency(position.pnl)}
                                                        </span>
                                                    </div>
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </div>
                        )}

                        {/* Activity Log Tab */}
                        {activeTab === 'activity' && (
                            <div className="tab-panel activity-panel">
                                {activityLog.length === 0 ? (
                                    <div className="empty-state">No activity found.</div>
                                ) : (
                                    <div className="activity-table">
                                        <div className="activity-header-row">
                                            <span className="col-activity">ACTIVITY</span>
                                            <span className="col-market">MARKET</span>
                                            <span className="col-value">VALUE</span>
                                        </div>
                                        {activityLog.map((activity, idx) => {
                                            const side = activity.side || 'TRADE'
                                            const type = activity.type || 'TRADE'
                                            const amount = activity.size || activity.usdcSize || activity.shares
                                            const timestamp = activity.timestamp || activity.match_time
                                            const price = activity.price || 0
                                            const valueChange = (amount * price).toFixed(2)

                                            let icon = '📝'
                                            let actionText = type
                                            let actionClass = 'neutral'

                                            if (side === 'BUY') { icon = '➕'; actionText = 'Bought'; actionClass = 'bought' }
                                            else if (side === 'SELL') { icon = '➖'; actionText = 'Sold'; actionClass = 'sold' }
                                            if (type === 'REDEEM') { icon = '💰'; actionText = 'Redeemed'; actionClass = 'redeem' }

                                            return (
                                                <div key={activity.id || idx} className="activity-row">
                                                    <div className="col-activity">
                                                        <div className={`activity-icon-badge ${actionClass}`}>{icon}</div>
                                                        <span className="activity-action-text">{actionText}</span>
                                                    </div>
                                                    <div className="col-market">
                                                        {activity.market?.image && <img src={activity.market.image} alt="" className="market-icon-small" onError={(e) => e.target.style.display = 'none'} />}
                                                        <div className="market-details">
                                                            <div className="market-question">{activity.market?.question || activity.title || 'Unknown Market'}</div>
                                                            <div className="outcome-details">
                                                                <span className={`outcome-text ${activity.outcome?.toLowerCase()}`}>{activity.outcome}</span>
                                                            </div>
                                                        </div>
                                                    </div>
                                                    <div className="col-value">
                                                        <div className={`value-text ${side === 'BUY' ? 'negative' : 'positive'}`}>
                                                            {side === 'BUY' ? '-' : '+'}${formatCurrency(valueChange).replace('$', '')}
                                                        </div>
                                                        <div className="time-ago">{timeAgo(timestamp)}</div>
                                                    </div>
                                                </div>
                                            )
                                        })}
                                    </div>
                                )}
                            </div>
                        )}
                    </>
                )}

                {/* Auto-refresh Toggle - Footer */}
                <div className="auto-refresh-toggle">
                    <label style={{ opacity: apiCreds ? 1 : 0.5, cursor: apiCreds ? 'pointer' : 'not-allowed' }}>
                        <input
                            type="checkbox"
                            checked={liveUpdates}
                            onChange={(e) => {
                                if (!apiCreds) {
                                    alert("L2 Authentication required for Live Updates. Please login with API Keys or Private Key.")
                                    return
                                }
                                setLiveUpdates(e.target.checked)
                            }}
                            disabled={!apiCreds}
                        />
                        <span className="refresh-icon" style={{ color: liveUpdates ? (wsConnected ? '#10b981' : '#f59e0b') : 'inherit' }}>
                            {liveUpdates ? '⚡' : '⚪'}
                        </span>
                        {liveUpdates ? 'Live' : 'Enable Live Updates (WebSocket/Poll)'}
                    </label>
                </div>
            </div>

            {/* SELL CONFIRMATION MODAL */}
            <ConfirmModal
                isOpen={sellModalOpen}
                title="Confirm Sell Order"
                message={betToSell ? `Are you sure you want to SELL ALL ${betToSell.size.toFixed(2)} shares of:\n\n${betToSell.title} (${betToSell.outcome})?\n\nEstimated Payout: $${(betToSell.size * betToSell.curPrice).toFixed(2)}` : ''}
                onConfirm={confirmSellPosition}
                onCancel={() => {
                    setSellModalOpen(false)
                    setBetToSell(null)
                }}
                confirmText="💸 Sell Position"
                cancelText="Keep"
                isDestructive={true}
            />
        </div >
    )
}

export default PortfolioTabs
