import { useState, useEffect, useRef } from 'react'
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend, ReferenceLine } from 'recharts'
import { toast } from 'react-toastify'
import ConfirmModal from './Portfolio/ConfirmModal'
import { placeMarketOrder, getSyncedNonce } from '../utils/marketOrders'
import './FocusedMarketView.css'

const FocusedMarketView = ({ event, client, userAddress, positions = [] }) => {
    const market = event.markets?.[0]
    const outcomes = JSON.parse(market?.outcomes || '[]')

    // Outcome Pricing State
    const [priceHistory, setPriceHistory] = useState([])
    // Structure: { bid: 0, ask: 0, last: 0 }
    const [livePrices, setLivePrices] = useState({
        up: { bid: 0, ask: 0, last: 0, bidSize: 0, askSize: 0 },
        down: { bid: 0, ask: 0, last: 0, bidSize: 0, askSize: 0 }
    })
    const [tradeAmount, setTradeAmount] = useState(10) // Default trade amount

    // Auto-Buy State
    const [autoBuy, setAutoBuy] = useState({
        up: { active: false, targetReturn: '' },
        down: { active: false, targetReturn: '' }
    })

    // State Ref for WebSocket (Zero Latency Access)
    const stateRef = useRef({ autoBuy, tradeAmount, client })
    useEffect(() => { stateRef.current = { autoBuy, tradeAmount, client } }, [autoBuy, tradeAmount, client])

    // Trigger Lock (Prevent 42x Fires)
    const triggerLockRef = useRef({ up: false, down: false })

    // Reset lock when re-enbled
    useEffect(() => {
        if (autoBuy.up.active) triggerLockRef.current.up = false
        if (autoBuy.down.active) triggerLockRef.current.down = false
    }, [autoBuy])

    // Trading Flow State
    const [confirmModalOpen, setConfirmModalOpen] = useState(false)
    const [pendingTrade, setPendingTrade] = useState(null)
    const [orderStatus, setOrderStatus] = useState('IDLE') // IDLE, SUBMITTING, OPEN, FILLED, CANCELLED
    const [activeOrderId, setActiveOrderId] = useState(null)

    const [isConnected, setIsConnected] = useState(false)
    const wsRef = useRef(null)



    // Asset Pricing State
    const [assetSymbol, setAssetSymbol] = useState(null)
    const [targetPrice, setTargetPrice] = useState(null)
    const [assetPriceHistory, setAssetPriceHistory] = useState([])
    const [currentAssetPrice, setCurrentAssetPrice] = useState(null)
    const [isAssetConnected, setIsAssetConnected] = useState(false)
    const assetWsRef = useRef(null)
    const [assetError, setAssetError] = useState(null)

    // View State
    const [chartType, setChartType] = useState('asset') // 'asset' | 'outcome'

    // Help State
    const [marketBuyHelpOpen, setMarketBuyHelpOpen] = useState(false)

    // Countdown State
    const [timeLeft, setTimeLeft] = useState('')



    // 1. PARSE METADATA & SYMBOL
    useEffect(() => {
        if (!event) return

        const t = event.title.toLowerCase()
        let symbol = null
        if (t.includes('bitcoin') || t.includes('btc')) symbol = 'btcusdt'
        else if (t.includes('ethereum') || t.includes('eth')) symbol = 'ethusdt'
        else if (t.includes('solana') || t.includes('sol')) symbol = 'solusdt'
        setAssetSymbol(symbol)

        // Default to asset view if symbol exists, otherwise outcome view
        if (!symbol) setChartType('outcome')
        else setChartType('asset')

        const desc = event.description || ''
        const title = event.title || ''
        const text = title + " " + desc
        const match = text.match(/\$([0-9,]+(\.[0-9]{2})?)/)
        if (match) {
            setTargetPrice(parseFloat(match[1].replace(/,/g, '')))
        }
    }, [event?.id])

    // 2. COUNTDOWN TIMER
    useEffect(() => {
        if (!event?.endDate) return
        const end = new Date(event.endDate).getTime()

        const updateTimer = () => {
            const now = Date.now()
            const diff = end - now

            if (diff <= 0) {
                setTimeLeft('Ended')
                return
            }

            const mins = Math.floor(diff / 60000)
            const secs = Math.floor((diff % 60000) / 1000)
            setTimeLeft(`${mins}m ${secs}s`)
        }

        updateTimer()
        const interval = setInterval(updateTimer, 1000)
        return () => clearInterval(interval)
    }, [event?.endDate])


    // 3. WS LOGIC (Refined for Bids/Asks)
    const processOutcomeMessage = (data, tIds) => {
        if (!data) return
        const upId = tIds[0]
        const downId = tIds[1]
        let updates = {} // { up: {}, down: {} }

        const addUpdate = (type, field, val) => {
            if (!updates[type]) updates[type] = {}
            updates[type][field] = parseFloat(val)
        }

        // Price Changes (Last Trade)
        const changes = data.price_changes || data.changes
        if ((data.event_type === 'price_change' || data.event_type === 'diff') && changes) {
            changes.forEach(c => {
                if (c.asset_id === upId) addUpdate('up', 'last', c.price)
                if (c.asset_id === downId) addUpdate('down', 'last', c.price)
            })
        }

        // Orderbook Snapshots (Bids/Asks)
        if (data.event_type === 'book') {
            const type = data.asset_id === upId ? 'up' : (data.asset_id === downId ? 'down' : null)
            if (type) {
                if (data.bids?.length > 0) {
                    // Find Max Bid
                    const bestBidObj = data.bids.reduce((curr, b) =>
                        parseFloat(b.price) > parseFloat(curr.price) ? b : curr
                        , data.bids[0])
                    addUpdate(type, 'bid', bestBidObj.price)
                    addUpdate(type, 'bidSize', bestBidObj.size)
                }
                if (data.asks?.length > 0) {
                    // Find Min Ask
                    const bestAskObj = data.asks.reduce((curr, a) =>
                        parseFloat(a.price) < parseFloat(curr.price) ? a : curr
                        , data.asks[0])
                    const bestAskPrice = parseFloat(bestAskObj.price)
                    addUpdate(type, 'ask', bestAskPrice)
                    addUpdate(type, 'askSize', bestAskObj.size)

                    // SUPER FAST AUTO-BUY CHECK (Zero Latency)
                    const currentAutoBuy = stateRef.current.autoBuy
                    const config = type === 'up' ? currentAutoBuy.up : currentAutoBuy.down
                    const isLocked = type === 'up' ? triggerLockRef.current.up : triggerLockRef.current.down

                    if (config.active && config.targetReturn && bestAskPrice > 0 && !isLocked) {
                        const potentialReturn = 1 / bestAskPrice

                        // Debug log every update to verify it's checking
                        // console.log(`[AutoBuy Check] ${type} Return: ${potentialReturn.toFixed(2)}x vs Target: ${config.targetReturn}x | Locked: ${isLocked}`)

                        if (potentialReturn >= parseFloat(config.targetReturn)) {

                            // Check Client FIRST before locking
                            const { tradeAmount, client } = stateRef.current
                            if (!client) {
                                // Don't lock, just warn once per frequent interval? 
                                // Actually better to trigger notification and maybe disable? 
                                // For now, just toast and don't lock, so it retries when connected.
                                console.warn("Auto-Buy Triggered but Client not connected")
                                return
                            }

                            // SYNC LOCK IMMEDIATELY
                            if (type === 'up') triggerLockRef.current.up = true
                            else triggerLockRef.current.down = true

                            // TRIGGER MATCHED!
                            console.log(`[AutoBuy] Triggered ${type.toUpperCase()} at ${potentialReturn.toFixed(2)}x (Price: ${bestAskPrice})`)

                            const outcomeIndex = type === 'up' ? 0 : 1
                            const tradeObj = {
                                strategy: 'AGGRESSIVE',
                                side: 'BUY',
                                outcomeName: outcomes[outcomeIndex],
                                outcomeIndex,
                                tokenId: tIds[outcomeIndex], // Use tIds passed to function
                                price: bestAskPrice,
                                worstCasePrice: 0.99,
                                shares: tradeAmount / bestAskPrice,
                                estCost: tradeAmount,
                                timestamp: Date.now()
                            }

                            // Execute Interaction-Free
                            confirmTrade(tradeObj)

                            // Disable Trigger in State (React Update)
                            setAutoBuy(prev => ({
                                ...prev,
                                [type]: { ...prev[type], active: false }
                            }))

                            toast.success(`🚀 Auto-Buy Fired! ${potentialReturn.toFixed(2)}x`)
                        }
                    }
                }
            }
        }

        return updates
    }

    // Connect Market WS
    useEffect(() => {
        if (!market) return
        const tokenIds = JSON.parse(market.clobTokenIds || '[]')
        if (tokenIds.length === 0) return

        const iPrice = JSON.parse(market.outcomePrices || '[]')
        const p0 = parseFloat(iPrice[0] || 0)
        const p1 = parseFloat(iPrice[1] || 0)

        setLivePrices({
            up: { bid: p0, ask: p0, last: p0 },
            down: { bid: p1, ask: p1, last: p1 }
        })
        setPriceHistory([{ time: new Date().toLocaleTimeString(), timestamp: Date.now(), upPrice: p0, downPrice: p1 }])

        const ws = new WebSocket('wss://ws-subscriptions-clob.polymarket.com/ws/market')
        wsRef.current = ws

        ws.onopen = () => {
            setIsConnected(true)
            ws.send(JSON.stringify({ assets_ids: tokenIds, type: 'market' }))
        }

        ws.onmessage = (e) => {
            try {
                const raw = JSON.parse(e.data)
                const msgs = Array.isArray(raw) ? raw : [raw]

                let combinedUpdates = {} // { up: {}, down: {} }

                msgs.forEach(m => {
                    const u = processOutcomeMessage(m, tokenIds)
                    if (u) {
                        if (u.up) combinedUpdates.up = { ...(combinedUpdates.up || {}), ...u.up }
                        if (u.down) combinedUpdates.down = { ...(combinedUpdates.down || {}), ...u.down }
                    }
                })

                if (Object.keys(combinedUpdates).length > 0) {
                    setLivePrices(prev => {
                        const next = { ...prev }
                        if (combinedUpdates.up) next.up = { ...next.up, ...combinedUpdates.up }
                        if (combinedUpdates.down) next.down = { ...next.down, ...combinedUpdates.down }

                        // Update Chart History
                        const uLast = next.up.last || prev.up.last
                        const dLast = next.down.last || prev.down.last

                        if (combinedUpdates.up?.last || combinedUpdates.down?.last) {
                            setPriceHistory(h => [...h, { time: new Date().toLocaleTimeString(), timestamp: Date.now(), upPrice: uLast, downPrice: dLast }].slice(-50))
                        }
                        return next
                    })
                }
            } catch (e) { }
        }

        ws.onclose = () => setIsConnected(false)
        return () => {
            if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
                ws.close()
            }
        }
    }, [market?.conditionId])


    // 4. WS 2: ASSET PRICES (RTDS Endpoint with Binance Fallback)
    useEffect(() => {
        if (!assetSymbol) return

        let ws = null
        let pingInterval = null
        let pollingInterval = null
        let isFallback = false

        // Fallback: Poll Binance API directly if WS fails
        const startPolling = () => {
            if (pollingInterval) return; // Already polling

            console.log('[Asset Price] Switching to Binance API polling fallback')
            isFallback = true

            const fetchBinance = async () => {
                try {
                    // Symbol mapping: btcusdt -> BTCUSDT
                    const symbol = assetSymbol.toUpperCase()
                    const res = await fetch(`https://api.binance.com/api/v3/ticker/price?symbol=${symbol}`)
                    if (res.ok) {
                        const data = await res.json()
                        const price = parseFloat(data.price)
                        // Only add if changed or periodically? Add to history.
                        setCurrentAssetPrice(price)
                        setAssetPriceHistory(h => [...h, {
                            time: new Date().toLocaleTimeString(),
                            timestamp: Date.now(),
                            price: price
                        }].slice(-60)) // Keep last 60 points
                    }
                } catch (err) {
                    console.warn('[Asset Price] Binance fallback failed', err)
                }
            }

            fetchBinance()
            pollingInterval = setInterval(fetchBinance, 3000) // Poll every 3s
        }

        // Primary: WebSocket
        const connect = () => {
            try {
                console.log('[RTDS] Connecting to wss://ws-live-data.polymarket.com ...')
                ws = new WebSocket('wss://ws-live-data.polymarket.com')
                assetWsRef.current = ws

                ws.onopen = () => {
                    console.log('[RTDS] Connected!')
                    setIsAssetConnected(true)
                    setAssetError(null)

                    setTimeout(() => {
                        if (ws.readyState === WebSocket.OPEN) {
                            ws.send(JSON.stringify({
                                action: "subscribe",
                                subscriptions: [{ topic: "crypto_prices", type: "update", filters: [assetSymbol] }]
                            }))
                            ws.send(JSON.stringify({
                                action: "subscribe",
                                subscriptions: [{ topic: "crypto_prices", type: "update", filters: assetSymbol }]
                            }))
                        }
                    }, 500)

                    pingInterval = setInterval(() => {
                        if (ws.readyState === WebSocket.OPEN) ws.send("PING")
                    }, 5000)
                }

                ws.onmessage = (e) => {
                    try {
                        const raw = JSON.parse(e.data)
                        const messages = Array.isArray(raw) ? raw : [raw]
                        messages.forEach(msg => {
                            if (msg.topic === 'crypto_prices' && msg.payload) {
                                const price = parseFloat(msg.payload.value)
                                setCurrentAssetPrice(price)
                                setAssetPriceHistory(h => [...h, {
                                    time: new Date(msg.payload.timestamp || Date.now()).toLocaleTimeString(),
                                    timestamp: msg.payload.timestamp,
                                    price: price
                                }].slice(-60))
                            }
                        })
                    } catch (err) { }
                }

                ws.onclose = (e) => {
                    console.warn('[RTDS] WS Closed. Starting fallback.', e.code)
                    setIsAssetConnected(false)
                    clearInterval(pingInterval)
                    startPolling()
                }

                ws.onerror = (err) => {
                    console.error("[RTDS] Error:", err)
                    // Don't close here, onclose will trigger
                }

            } catch (err) {
                console.error("WS Setup Error", err)
                startPolling()
            }
        }

        connect()

        return () => {
            if (ws) ws.close()
            clearInterval(pingInterval)
            clearInterval(pollingInterval)
        }

    }, [assetSymbol])

    // 5. FETCH HISTORICAL ASSET DATA (Binance Kline)
    useEffect(() => {
        if (!assetSymbol) return

        const fetchHistory = async () => {
            try {
                // Fetch last 60 minutes of data to fill chart
                const symbol = assetSymbol.toUpperCase()
                const res = await fetch(`https://api.binance.com/api/v3/klines?symbol=${symbol}&interval=1m&limit=60`)
                if (res.ok) {
                    const data = await res.json()
                    // Binance kline format: [ot, open, high, low, close, ...]
                    const history = data.map(d => ({
                        time: new Date(d[0]).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
                        timestamp: d[0],
                        price: parseFloat(d[4])
                    }))
                    setAssetPriceHistory(history)

                    if (history.length > 0) {
                        setCurrentAssetPrice(history[history.length - 1].price)
                    }
                }
            } catch (err) {
                console.warn("[Chart] Failed to load history", err)
            }
        }

        fetchHistory()

    }, [assetSymbol])


    if (!market) return <div className="loading">Loading Market Data...</div>

    const calculateProfit = (price) => {
        if (!price || price === 0) return 0
        return ((1 / price) - 1)
    }

    // 4. TRADING LOGIC - STRATEGIES
    // 4. TRADING WORKFLOW

    // STEP A: Initiate Trade (Pre-Check & Modal)
    const initiateTrade = async (outcomeIndex, strategy) => {
        if (!client) {
            toast.error("Please Login (L2) to trade.")
            return
        }

        const tokenIds = JSON.parse(market.clobTokenIds || '[]')
        const tokenId = tokenIds[outcomeIndex]
        const outcomeName = outcomes[outcomeIndex]
        const currentPriceObj = outcomeIndex === 0 ? livePrices.up : livePrices.down

        // Estimates based on Strategy
        let estPrice = 0
        let worstCasePrice = 0

        try {
            // Fetch fresh book for estimate
            let bestBid = currentPriceObj.bid
            let bestAsk = currentPriceObj.ask

            // If missing from WS, try fetch
            if (!bestBid || !bestAsk) {
                const book = await client.getOrderBook(tokenId)
                if (book.bids.length > 0) bestBid = parseFloat(book.bids[0].price)
                if (book.asks.length > 0) bestAsk = parseFloat(book.asks[0].price)
            }

            if (strategy === 'PASSIVE') {
                // Buying at Best Bid (Maker)
                if (!bestBid) throw new Error("No Bid Price available to join.")
                estPrice = bestBid
                worstCasePrice = estPrice // Fixed price limit
            } else {
                // Buying at Best Ask (Taker)
                if (!bestAsk) throw new Error("No Ask Liquidity.")
                estPrice = bestAsk
                worstCasePrice = Math.min(bestAsk + 0.005, 0.99) // 0.5% Slippage
            }

            // Calculate Shares
            let shares = tradeAmount / estPrice
            if (shares * estPrice < 1.0001) shares = 1.0001 / estPrice // Min size check

            const tradeObj = {
                strategy,
                side: 'BUY',
                outcomeName,
                outcomeIndex,
                tokenId,
                price: estPrice,
                worstCasePrice,
                shares,
                estCost: shares * estPrice,
                timestamp: Date.now()
            }

            if (strategy === 'AGGRESSIVE') {
                // INSTANT EXECUTION (Bypass Modal & State Delay)
                confirmTrade(tradeObj)
            } else {
                // STANDARD FLOW (Modal)
                setPendingTrade(tradeObj)
                setConfirmModalOpen(true)
            }

        } catch (e) {
            toast.error(`Cannot initiate trade: ${e.message}`)
        }
    }

    // STEP B: Confirm & Execute (Double-Check & Submit)
    const isSubmittingRef = useRef(false)

    // Unlock on unmount to be safe
    useEffect(() => {
        return () => { isSubmittingRef.current = false }
    }, [])

    const confirmTrade = async (tradeOverride = null) => {
        // Use override if provided (Fast Buy), else use State (Modal Confirm)
        const currentTrade = tradeOverride || pendingTrade
        const activeClient = stateRef.current.client || client // Use Fresh Client
        if (!currentTrade || !activeClient) return

        // 1. MUTEX LOCK
        if (isSubmittingRef.current) return
        isSubmittingRef.current = true

        setConfirmModalOpen(false)
        setOrderStatus('SUBMITTING')
        const toastId = toast.loading(`Submitting ${currentTrade.side} Order...`)

        try {
            // 2. SAFETY CHECK: Re-verify Market Conditions
            const book = await client.getOrderBook(currentTrade.tokenId)
            const hasAsks = book.asks && book.asks.length > 0

            // Aggressive Liquidity Check
            if (currentTrade.strategy !== 'PASSIVE') {
                if (!hasAsks) {
                    throw new Error("Liquidity dried up! No sellers available.")
                }
            }

            // 3. SUBMIT ORDER
            let order;

            if (currentTrade.strategy === 'PASSIVE') {
                // PASSIVE: Limit Order at Bid (Maker)
                const nonce = getSyncedNonce()
                const payload = {
                    tokenID: currentTrade.tokenId,
                    price: parseFloat(currentTrade.price.toFixed(4)),
                    side: 'BUY',
                    size: currentTrade.shares,
                    nonce: nonce,
                    feeRateBps: 1000
                }
                order = await client.createAndPostOrder(payload)
            } else {
                // AGGRESSIVE: Fast Market Buy
                // Use Dollar Amount to be safe against Price Mismatch/Spikes
                order = await placeMarketOrder(
                    client,
                    currentTrade.tokenId,
                    'BUY',
                    currentTrade.estCost, // Send Dollars
                    {
                        slippage: 0.10,
                        sizeInDollars: true
                    }
                )
            }

            // 4. HANDLE RESPONSE
            if (order && (order.error || (order.status && order.status >= 400))) {
                throw new Error(order.error || order.data?.error || "Order Submission Failed")
            }

            console.log("Trade Submitted:", order)
            setActiveOrderId(order.orderID)
            setOrderStatus('OPEN')

            toast.update(toastId, {
                render: `Order Open! ID: ${order.orderID?.slice(0, 8)}...`,
                type: "success",
                isLoading: false,
                autoClose: 2000
            })

            // 5. AUTO-CANCEL SAFEGUARDS
            const timeoutMs = currentTrade.strategy === 'PASSIVE' ? 30000 : 2000
            setTimeout(() => {
                cancelActiveOrder(order.orderID)
            }, timeoutMs)

        } catch (err) {
            console.error("Trade Error:", err)
            setOrderStatus('IDLE')
            toast.update(toastId, {
                render: `Failed: ${err.message}`,
                type: "error",
                isLoading: false,
                autoClose: 5000
            })
        } finally {
            // RELEASE MUTEX LOCK
            isSubmittingRef.current = false
            setPendingTrade(null)
        }
    }

    const cancelActiveOrder = async (idToCancel) => {
        const id = idToCancel || activeOrderId
        if (!id || !client) return

        try {
            if (typeof client.cancel === 'function') {
                await client.cancel(id)
            } else if (typeof client.cancelOrder === 'function') {
                await client.cancelOrder(id) // Try alternate method name
            } else {
                console.warn("[FocusedMarketView] Client does not have a cancel method")
                return
            }
            toast.info("Active Order Cancelled")
            setOrderStatus('CANCELLED')
            setTimeout(() => setOrderStatus('IDLE'), 2000)
            setActiveOrderId(null)
        } catch (e) {
            console.warn("Cancel failed (maybe filled?):", e)
            setOrderStatus('IDLE') // Assume done if cancel fails
            setActiveOrderId(null)
        }
    }

    // Determine which chart to show
    const showAssetChart = assetSymbol && chartType === 'asset'

    // Y-Domain with padding
    const yDomain = showAssetChart && targetPrice && currentAssetPrice
        ? [Math.min(currentAssetPrice, targetPrice) * 0.999, Math.max(currentAssetPrice, targetPrice) * 1.001]
        : ['auto', 'auto']

    // Price Stats
    const priceDiff = (showAssetChart && targetPrice && currentAssetPrice)
        ? (currentAssetPrice - targetPrice)
        : null

    const diffColor = priceDiff ? (priceDiff > 0 ? '#10b981' : '#ef4444') : '#94a3b8'

    // Refine tick format for Y-Axis
    const formatYAxis = (val) => {
        if (val >= 1000) return `$${(val / 1000).toFixed(1)}k`
        return `$${val.toFixed(2)}`
    }

    const ChartComponent = showAssetChart ? (
        <ResponsiveContainer width="100%" height="100%" minHeight={450}>
            <LineChart data={assetPriceHistory}>
                <CartesianGrid strokeDasharray="3 3" stroke="#334155" opacity={0.3} />
                <XAxis
                    dataKey="time"
                    stroke="#64748b"
                    tick={{ fontSize: 11 }}
                    minTickGap={60}
                />
                <YAxis
                    stroke="#64748b"
                    domain={yDomain}
                    tickFormatter={formatYAxis}
                    width={60}
                    orientation="right"
                />
                <Tooltip
                    contentStyle={{ background: '#0f172a', border: '1px solid #334155' }}
                    itemStyle={{ color: '#f59e0b' }}
                    formatter={v => [`$${parseFloat(v).toLocaleString()}`, 'Price']}
                />

                {targetPrice && (
                    <ReferenceLine
                        y={targetPrice}
                        stroke="#94a3b8"
                        strokeDasharray="5 5"
                        label={{
                            value: 'Target',
                            position: 'left',
                            fill: '#94a3b8',
                            fontSize: 12
                        }}
                    />
                )}

                <Line
                    type="monotone"
                    dataKey="price"
                    stroke="#f59e0b"
                    strokeWidth={3}
                    dot={false}
                    animationDuration={500}
                />
            </LineChart>
        </ResponsiveContainer>
    ) : (
        <ResponsiveContainer width="100%" height="100%" minHeight={450}>
            <LineChart data={priceHistory}>
                <CartesianGrid strokeDasharray="3 3" stroke="#334155" opacity={0.3} />
                <XAxis dataKey="time" stroke="#64748b" tick={{ fontSize: 11 }} minTickGap={50} />
                <YAxis stroke="#64748b" domain={[0, 1]} tickFormatter={v => `${(v * 100).toFixed(0)}%`} orientation="right" />
                <Tooltip contentStyle={{ background: '#0f172a' }} formatter={v => `${(v * 100).toFixed(1)}%`} />
                <Legend />
                <Line type="stepAfter" dataKey="upPrice" stroke="#10b981" strokeWidth={3} dot={false} name="UP" animationDuration={500} />
                <Line type="stepAfter" dataKey="downPrice" stroke="#ef4444" strokeWidth={3} dot={false} name="DOWN" animationDuration={500} />

                {/* Entry Lines for User Positions */}
                {positions.filter(p => p.conditionId === market?.conditionId).map((pos, idx) => {
                    const isUp = pos.outcome === 'Yes' || pos.outcome === 'Up'
                    const color = isUp ? '#10b981' : '#ef4444'
                    return (
                        <ReferenceLine
                            key={`entry-${idx}`}
                            y={pos.avgPrice}
                            stroke={color}
                            strokeDasharray="3 3"
                            label={{
                                value: `You (${pos.outcome}): ${pos.avgPrice.toFixed(2)}`,
                                position: 'insideRight',
                                fill: color,
                                fontSize: 11,
                                fontWeight: 'bold'
                            }}
                        />
                    )
                })}
            </LineChart>
        </ResponsiveContainer>
    )

    return (
        <div className="focused-market-view">
            {/* Header */}
            <div className="focused-header">
                <div className="focused-title">
                    <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
                        <img src={event.icon} alt="" style={{ width: 56, height: 56, borderRadius: '50%' }} onError={e => e.target.style.display = 'none'} />
                        <div>
                            <h2 style={{ fontSize: '1.8rem', margin: 0, letterSpacing: '-0.5px' }}>{event.title}</h2>
                            <div className="focused-meta">
                                <span style={{
                                    color: '#f59e0b',
                                    fontWeight: '700',
                                    fontSize: '1.2rem',
                                    fontVariantNumeric: 'tabular-nums'
                                }}>
                                    ⏱ {timeLeft}
                                </span>
                                <span style={{ opacity: 0.7 }}>| Vol: ${(market.volumeNum || 0).toLocaleString(undefined, { maximumFractionDigits: 0 })}</span>
                            </div>
                        </div>
                    </div>
                </div>

                {/* Stat Headers */}
                {showAssetChart && targetPrice && (
                    <div className="price-stats-header" style={{ display: 'flex', gap: '3rem', alignItems: 'center' }}>
                        {/* Target */}
                        <div style={{ textAlign: 'right' }}>
                            <div style={{ color: '#94a3b8', fontSize: '0.75rem', fontWeight: '600', textTransform: 'uppercase', letterSpacing: '1px' }}>Price to Beat</div>
                            <div style={{ fontSize: '1.8rem', fontWeight: '500', color: '#cbd5e1', lineHeight: 1 }}>${targetPrice.toLocaleString()}</div>
                        </div>

                        {/* Current */}
                        {currentAssetPrice && (
                            <div style={{ textAlign: 'right' }}>
                                <div style={{ color: '#f59e0b', fontSize: '0.75rem', fontWeight: '600', textTransform: 'uppercase', letterSpacing: '1px' }}>Current Price</div>
                                <div style={{ fontSize: '1.8rem', fontWeight: '700', color: '#f59e0b', lineHeight: 1 }}>${currentAssetPrice.toLocaleString()}</div>
                            </div>
                        )}

                        {/* Difference (NEW) */}
                        {priceDiff !== null && (
                            <div style={{ textAlign: 'right', background: 'rgba(255,255,255,0.05)', padding: '8px 16px', borderRadius: '8px' }}>
                                <div style={{ color: diffColor, fontSize: '0.75rem', fontWeight: '600', textTransform: 'uppercase', letterSpacing: '1px' }}>
                                    {priceDiff >= 0 ? 'ABOVE TARGET' : 'BELOW TARGET'}
                                </div>
                                <div style={{ fontSize: '1.8rem', fontWeight: '700', color: diffColor, lineHeight: 1 }}>
                                    {priceDiff >= 0 ? '+' : '-'}${Math.abs(priceDiff).toFixed(2)}
                                </div>
                            </div>
                        )}
                    </div>
                )}

                {/* Stats removed from here as they are in cards */}

                {/* Status Message removed by user request */}

                <div style={{ display: 'flex', gap: '1rem', alignItems: 'center' }}>
                    {/* CHART TOGGLES (Moved here) */}
                    {assetSymbol && (
                        <div className="chart-toggles" style={{ display: 'flex', gap: '8px' }}>
                            <button
                                className={`toggle-btn ${chartType === 'outcome' ? 'active' : ''}`}
                                onClick={() => setChartType('outcome')}
                                style={{
                                    background: chartType === 'outcome' ? '#334155' : 'rgba(15, 23, 42, 0.8)',
                                    border: '1px solid #334155',
                                    borderRadius: '4px',
                                    padding: '6px 12px',
                                    color: chartType === 'outcome' ? '#f8fafc' : '#94a3b8',
                                    cursor: 'pointer',
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: '6px',
                                    fontSize: '0.85rem',
                                    fontWeight: '500'
                                }}
                            >
                                <span>📈</span> Probs
                            </button>
                            <button
                                className={`toggle-btn ${chartType === 'asset' ? 'active' : ''}`}
                                onClick={() => setChartType('asset')}
                                style={{
                                    background: chartType === 'asset' ? '#334155' : 'rgba(15, 23, 42, 0.8)',
                                    border: '1px solid #334155',
                                    borderRadius: '4px',
                                    padding: '6px 12px',
                                    color: chartType === 'asset' ? '#f8fafc' : '#94a3b8',
                                    cursor: 'pointer',
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: '6px',
                                    fontSize: '0.85rem',
                                    fontWeight: '500'
                                }}
                            >
                                <span>₿</span> Price
                            </button>
                        </div>
                    )}

                    <div className="live-indicator">
                        <div className="live-dot" style={{ background: isConnected || isAssetConnected ? '#10b981' : '#64748b', animation: (isConnected || isAssetConnected) ? 'pulse 2s infinite' : 'none' }}></div>
                        {(isConnected || isAssetConnected) ? 'LIVE' : '...'}
                    </div>
                </div>
            </div>

            {/* Main Content Grid */}
            <div className="focused-main-layout">
                {/* Chart Column */}
                <div className="chart-column">
                    <div className="focused-chart-container" style={{
                        background: '#0b1221',
                        border: '1px solid #1e293b',
                        position: 'relative',
                        width: '100%',
                        height: '100%', // Fill the column
                        minHeight: '350px', // REDUCED HEIGHT
                        borderRadius: '12px',
                        overflow: 'hidden'
                    }}>
                        {ChartComponent}
                    </div>
                </div>

                {/* Outcomes Column (Vertical Stack) */}
                <div className="focused-outcomes">
                    {/* UP CARD */}
                    <div className="focused-outcome-card up">
                        <div className="outcome-header-row">
                            <div className="outcome-label">📈 {outcomes[0] || 'UP'}</div>
                            <div className="prob-badge" style={{ color: '#10b981' }}>{(livePrices.up.last * 100).toFixed(1)}%</div>
                        </div>
                        {/* SPREAD INFO */}
                        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.75rem', color: '#94a3b8', margin: '4px 0' }}>
                            <span>Bid: <strong style={{ color: '#cbd5e1' }}>{livePrices.up.bid || '-'}</strong> <span style={{ fontSize: '0.65rem', opacity: 0.7 }}>({parseFloat(livePrices.up.bidSize || 0).toFixed(0)})</span></span>
                            <span>Ask: <strong style={{ color: '#f59e0b' }}>{livePrices.up.ask || '-'}</strong> <span style={{ fontSize: '0.65rem', opacity: 0.7 }}>({parseFloat(livePrices.up.askSize || 0).toFixed(0)})</span></span>
                        </div>

                        <div className="profit-grid" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '0' }}>
                            <div className="p-item">
                                <div className="p-label">Price</div>
                                <div className="p-val">${livePrices.up.last.toFixed(3)}</div>
                            </div>
                            <div className="p-item border-left">
                                <div className="p-label">Return</div>
                                <div className="p-val gold">x{(1 / Math.max(livePrices.up.last, 0.01)).toFixed(2)}</div>
                            </div>
                            <div className="p-item border-left">
                                <div className="p-label">Total</div>
                                <div className="p-val" style={{ color: livePrices.up.last < 1 ? '#10b981' : '#ef4444' }}>
                                    ${(tradeAmount * (1 / Math.max(livePrices.up.last, 0.01))).toFixed(2)}
                                </div>
                            </div>
                        </div>

                        {/* TRADING ACTIONS */}
                        <div style={{ marginTop: '8px', width: '100%' }}>
                            {/* Amount Selector */}
                            <div style={{ display: 'flex', gap: '4px', marginBottom: '6px' }}>
                                {[1, 2, 5].map(amt => (
                                    <button
                                        key={amt}
                                        onClick={() => setTradeAmount(amt)}
                                        style={{
                                            flex: 1,
                                            padding: '4px',
                                            background: tradeAmount == amt ? '#10b981' : '#334155',
                                            color: 'white',
                                            border: 'none',
                                            borderRadius: '4px',
                                            fontSize: '0.75rem',
                                            cursor: 'pointer',
                                            fontWeight: tradeAmount == amt ? 'bold' : 'normal'
                                        }}
                                    >
                                        ${amt}
                                    </button>
                                ))}
                                <input
                                    type="number"
                                    value={tradeAmount}
                                    onChange={(e) => setTradeAmount(e.target.value)}
                                    placeholder="$"
                                    style={{
                                        width: '40px',
                                        background: '#0f172a',
                                        border: '1px solid #334155',
                                        color: 'white',
                                        borderRadius: '4px',
                                        fontSize: '0.75rem',
                                        padding: '4px',
                                        textAlign: 'center',
                                        outline: 'none',
                                        colorScheme: 'dark'
                                    }}
                                />
                            </div>

                            {/* Auto-Buy Trigger Input */}
                            <div style={{ display: 'flex', gap: '6px', marginBottom: '6px' }}>
                                <input
                                    type="number"
                                    placeholder="Target Return (x)"
                                    className="dark-input"
                                    style={{ flex: 1, padding: '4px 8px', fontSize: '0.75rem', color: 'white', background: '#0f172a', border: '1px solid #334155', borderRadius: '4px' }}
                                    value={autoBuy.up.targetReturn}
                                    onChange={(e) => setAutoBuy(prev => ({ ...prev, up: { ...prev.up, targetReturn: e.target.value } }))}
                                />
                                <button
                                    onClick={() => setAutoBuy(prev => ({ ...prev, up: { ...prev.up, active: !prev.up.active } }))}
                                    style={{
                                        flex: 1,
                                        background: autoBuy.up.active ? '#f59e0b' : '#334155',
                                        color: 'white',
                                        border: '1px solid #f59e0b',
                                        borderRadius: '4px',
                                        fontSize: '0.75rem',
                                        cursor: 'pointer',
                                        fontWeight: 'bold'
                                    }}
                                >
                                    {autoBuy.up.active ? '🛑 Stop' : '⚡ Auto'}
                                </button>
                            </div>

                            {/* Strategy Buttons */}
                            <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: '6px' }}>
                                <button
                                    disabled={orderStatus !== 'IDLE'}
                                    onClick={() => initiateTrade(0, 'AGGRESSIVE')}
                                    style={{ background: '#10b981', border: 'none', color: '#0f172a', padding: '8px', borderRadius: '4px', cursor: 'pointer', fontWeight: 'bold', fontSize: '0.75rem', opacity: orderStatus !== 'IDLE' ? 0.5 : 1 }}
                                >
                                    ⚡ Buy (Fast)
                                </button>
                            </div>
                        </div>
                        {!client && <div style={{ fontSize: '0.7rem', color: '#94a3b8', marginTop: '4px', textAlign: 'center' }}>Login to Trade</div>}
                    </div>

                    {/* DOWN CARD */}
                    <div className="focused-outcome-card down">
                        <div className="outcome-header-row">
                            <div className="outcome-label">📉 {outcomes[1] || 'DOWN'}</div>
                            <div className="prob-badge" style={{ color: '#ef4444' }}>{(livePrices.down.last * 100).toFixed(1)}%</div>
                        </div>
                        {/* SPREAD INFO */}
                        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.75rem', color: '#94a3b8', margin: '4px 0' }}>
                            <span>Bid: <strong style={{ color: '#cbd5e1' }}>{livePrices.down.bid || '-'}</strong> <span style={{ fontSize: '0.65rem', opacity: 0.7 }}>({parseFloat(livePrices.down.bidSize || 0).toFixed(0)})</span></span>
                            <span>Ask: <strong style={{ color: '#f59e0b' }}>{livePrices.down.ask || '-'}</strong> <span style={{ fontSize: '0.65rem', opacity: 0.7 }}>({parseFloat(livePrices.down.askSize || 0).toFixed(0)})</span></span>
                        </div>

                        <div className="profit-grid" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '0' }}>
                            <div className="p-item">
                                <div className="p-label">Price</div>
                                <div className="p-val">${livePrices.down.last.toFixed(3)}</div>
                            </div>
                            <div className="p-item border-left">
                                <div className="p-label">Return</div>
                                <div className="p-val gold">x{(1 / Math.max(livePrices.down.last, 0.01)).toFixed(2)}</div>
                            </div>
                            <div className="p-item border-left">
                                <div className="p-label">Total</div>
                                <div className="p-val" style={{ color: livePrices.down.last < 1 ? '#10b981' : '#ef4444' }}>
                                    ${(tradeAmount * (1 / Math.max(livePrices.down.last, 0.01))).toFixed(2)}
                                </div>
                            </div>
                        </div>

                        {/* TRADING ACTIONS */}
                        <div style={{ marginTop: '8px', width: '100%' }}>
                            {/* Amount Selector */}
                            <div style={{ display: 'flex', gap: '4px', marginBottom: '6px' }}>
                                {[1, 2, 5].map(amt => (
                                    <button
                                        key={amt}
                                        onClick={() => setTradeAmount(amt)}
                                        style={{
                                            flex: 1,
                                            padding: '4px',
                                            background: tradeAmount == amt ? '#ef4444' : '#334155',
                                            color: 'white',
                                            border: 'none',
                                            borderRadius: '4px',
                                            fontSize: '0.75rem',
                                            cursor: 'pointer',
                                            fontWeight: tradeAmount == amt ? 'bold' : 'normal'
                                        }}
                                    >
                                        ${amt}
                                    </button>
                                ))}
                                <input
                                    type="number"
                                    value={tradeAmount}
                                    onChange={(e) => setTradeAmount(e.target.value)}
                                    placeholder="$"
                                    style={{
                                        width: '40px',
                                        background: '#0f172a',
                                        border: '1px solid #334155',
                                        color: 'white',
                                        borderRadius: '4px',
                                        fontSize: '0.75rem',
                                        padding: '4px',
                                        textAlign: 'center',
                                        outline: 'none',
                                        colorScheme: 'dark'
                                    }}
                                />
                            </div>

                            {/* Auto-Buy Trigger Input */}
                            <div style={{ display: 'flex', gap: '6px', marginBottom: '6px' }}>
                                <input
                                    type="number"
                                    placeholder="Target Return (x)"
                                    className="dark-input"
                                    style={{ flex: 1, padding: '4px 8px', fontSize: '0.75rem', color: 'white', background: '#0f172a', border: '1px solid #334155', borderRadius: '4px' }}
                                    value={autoBuy.down.targetReturn}
                                    onChange={(e) => setAutoBuy(prev => ({ ...prev, down: { ...prev.down, targetReturn: e.target.value } }))}
                                />
                                <button
                                    onClick={() => setAutoBuy(prev => ({ ...prev, down: { ...prev.down, active: !prev.down.active } }))}
                                    style={{
                                        flex: 1,
                                        background: autoBuy.down.active ? '#f59e0b' : '#334155',
                                        color: 'white',
                                        border: '1px solid #f59e0b',
                                        borderRadius: '4px',
                                        fontSize: '0.75rem',
                                        cursor: 'pointer',
                                        fontWeight: 'bold'
                                    }}
                                >
                                    {autoBuy.down.active ? '🛑 Stop' : '⚡ Auto'}
                                </button>
                            </div>

                            {/* Strategy Buttons */}
                            <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: '6px' }}>
                                <button
                                    disabled={orderStatus !== 'IDLE'}
                                    onClick={() => initiateTrade(1, 'AGGRESSIVE')}
                                    style={{ background: '#ef4444', border: 'none', color: '#white', padding: '8px', borderRadius: '4px', cursor: 'pointer', fontWeight: 'bold', fontSize: '0.75rem', opacity: orderStatus !== 'IDLE' ? 0.5 : 1 }}
                                >
                                    ⚡ Buy (Fast)
                                </button>
                            </div>
                        </div>
                        {!client && <div style={{ fontSize: '0.7rem', color: '#94a3b8', marginTop: '4px', textAlign: 'center' }}>Login to Trade</div>}
                    </div>
                </div>
            </div>


            {/* MY POSITIONS SECTION */}
            {positions && positions.length > 0 && (
                <div className="focused-positions-section" style={{ marginTop: '24px', padding: '0 1rem' }}>
                    {(() => {
                        const marketPositions = positions.filter(p => p.conditionId === market?.conditionId)
                        if (marketPositions.length === 0) return null

                        return (
                            <div style={{ background: '#1e293b', borderRadius: '12px', padding: '16px', border: '1px solid #334155' }}>
                                <h3 style={{ marginTop: 0, marginBottom: '16px', fontSize: '1.2rem' }}>My Positions</h3>
                                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.9rem' }}>
                                    <thead>
                                        <tr style={{ color: '#94a3b8', borderBottom: '1px solid #334155', textAlign: 'left', textTransform: 'uppercase', fontSize: '0.75rem' }}>
                                            <th style={{ padding: '8px' }}>Outcome</th>
                                            <th style={{ padding: '8px' }}>Qty</th>
                                            <th style={{ padding: '8px' }}>Avg</th>
                                            <th style={{ padding: '8px' }}>Value</th>
                                            <th style={{ padding: '8px' }}>Return</th>
                                            <th style={{ padding: '8px', textAlign: 'right' }}>Action</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {marketPositions.map((pos, idx) => {
                                            const isUp = pos.outcome === 'Yes' || pos.outcome === 'Up'

                                            // Formatting Avg Price
                                            const avgPriceDisplay = pos.avgPrice < 1
                                                ? `${Math.round(pos.avgPrice * 100)}¢`
                                                : `$${pos.avgPrice.toFixed(2)}`

                                            // Value & Cost
                                            const currentVal = pos.size * pos.curPrice
                                            const costBasis = pos.size * pos.avgPrice

                                            // PnA
                                            const pnlValue = currentVal - costBasis
                                            const pnlPercent = (pnlValue / costBasis) * 100

                                            return (
                                                <tr key={idx} style={{ borderBottom: '1px solid #334155' }}>
                                                    <td style={{ padding: '12px 8px' }}>
                                                        <span className={`outcome-badge ${pos.outcome.toLowerCase()}`} style={{ fontSize: '0.8rem', padding: '4px 8px' }}>
                                                            {pos.outcome}
                                                        </span>
                                                    </td>
                                                    <td style={{ padding: '12px 8px', color: '#e2e8f0' }}>{pos.size.toFixed(2)}</td>
                                                    <td style={{ padding: '12px 8px', color: '#e2e8f0' }}>{avgPriceDisplay}</td>
                                                    <td style={{ padding: '12px 8px' }}>
                                                        <div style={{ display: 'flex', flexDirection: 'column' }}>
                                                            <span style={{ color: '#e2e8f0', fontWeight: '600' }}>
                                                                ${currentVal.toFixed(2)}
                                                            </span>
                                                            <span style={{ fontSize: '0.75rem', color: '#64748b' }}>
                                                                Cost ${costBasis.toFixed(2)}
                                                            </span>
                                                        </div>
                                                    </td>
                                                    <td style={{ padding: '12px 8px' }}>
                                                        <div style={{ display: 'flex', flexDirection: 'column' }}>
                                                            <span style={{ color: pnlValue >= 0 ? '#10b981' : '#ef4444', fontWeight: '600' }}>
                                                                {pnlValue >= 0 ? '+' : ''}${pnlValue.toFixed(2)}
                                                            </span>
                                                            <span style={{ fontSize: '0.75rem', color: pnlValue >= 0 ? '#10b981' : '#ef4444' }}>
                                                                ({pnlPercent.toFixed(2)}%)
                                                            </span>
                                                        </div>
                                                    </td>
                                                    <td style={{ padding: '12px 8px', textAlign: 'right' }}>
                                                        <button
                                                            className="sell-btn-compact"
                                                            style={{
                                                                background: '#1e293b',
                                                                border: '1px solid #334155',
                                                                borderRadius: '6px',
                                                                color: '#e2e8f0',
                                                                padding: '6px 16px',
                                                                cursor: 'pointer',
                                                                fontWeight: '600',
                                                                fontSize: '0.8rem',
                                                                transition: 'all 0.2s'
                                                            }}
                                                            onMouseOver={(e) => e.target.style.background = '#334155'}
                                                            onMouseOut={(e) => e.target.style.background = '#1e293b'}
                                                            onClick={async () => {
                                                                if (!client) {
                                                                    toast.error('Please login to sell')
                                                                    return
                                                                }
                                                                try {
                                                                    const order = await placeMarketOrder(client, pos.asset, 'SELL', pos.size, { sizeInDollars: false })
                                                                    if (order.success) {
                                                                        toast.success(`Sold ${pos.outcome}!`)
                                                                    }
                                                                } catch (e) {
                                                                    toast.error('Sell failed: ' + e.message)
                                                                }
                                                            }}
                                                        >
                                                            Sell
                                                        </button>
                                                    </td>
                                                </tr>
                                            )
                                        })}
                                    </tbody>
                                </table>
                            </div>
                        )
                    })()}
                </div>
            )}

            {/* TRADING CONFIRMATION MODAL */}
            <ConfirmModal
                isOpen={confirmModalOpen}
                title="Confirm Buy Order"
                onConfirm={confirmTrade}
                onCancel={() => setConfirmModalOpen(false)}
                confirmText={orderStatus === 'SUBMITTING' ? "Submitting..." : "✅ Confirm Buy"}
            >
                {pendingTrade && (
                    <div style={{ fontSize: '0.9rem', color: '#cbd5e1' }}>
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', marginBottom: '12px' }}>
                            <div>Outcome:</div>
                            <div style={{ textAlign: 'right', fontWeight: 'bold', color: 'white' }}>{pendingTrade.outcomeName}</div>

                            <div>Side:</div>
                            <div style={{ textAlign: 'right', fontWeight: 'bold', color: '#10b981' }}>BUY</div>

                            <div>Strategy:</div>
                            <div style={{ textAlign: 'right' }}>{pendingTrade.strategy === 'PASSIVE' ? '🛡️ Passive (Maker)' : '⚡ Fast (Taker)'}</div>

                            <div>Size:</div>
                            <div style={{ textAlign: 'right' }}>{pendingTrade.shares.toFixed(2)} Shares</div>

                            <div>Est. Price:</div>
                            <div style={{ textAlign: 'right' }}>${pendingTrade.price.toFixed(3)}</div>

                            <div>Cost:</div>
                            <div style={{ textAlign: 'right', color: '#fbbf24' }}>${pendingTrade.estCost.toFixed(2)}</div>

                            {pendingTrade.strategy === 'AGGRESSIVE' && (
                                <>
                                    <div style={{ color: '#ef4444' }}>Limit Price:</div>
                                    <div style={{ textAlign: 'right', color: '#ef4444' }}>${pendingTrade.worstCasePrice.toFixed(3)}</div>
                                </>
                            )}
                        </div>
                        <div style={{ fontSize: '0.75rem', color: '#94a3b8', fontStyle: 'italic', background: '#1e293b', padding: '8px', borderRadius: '4px' }}>
                            ⚠️ Price may change. Order rejects if price exceeds limit.
                        </div>
                    </div>
                )}
            </ConfirmModal>
            {/* Help Modal for Market Buy */}
            {marketBuyHelpOpen && (
                <div style={{
                    position: 'fixed',
                    top: 0, left: 0, right: 0, bottom: 0,
                    backgroundColor: 'rgba(0,0,0,0.8)',
                    display: 'flex',
                    justifyContent: 'center',
                    alignItems: 'center',
                    zIndex: 10000
                }} onClick={() => setMarketBuyHelpOpen(false)}>
                    <div style={{
                        width: '90%',
                        maxWidth: '550px',
                        maxHeight: '90vh',
                        overflowY: 'auto',
                        backgroundColor: '#0f172a',
                        borderRadius: '16px',
                        padding: '32px',
                        position: 'relative',
                        border: '1px solid #334155',
                        boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.5)'
                    }} onClick={e => e.stopPropagation()}>

                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '24px' }}>
                            <h3 style={{ fontSize: '1.5rem', fontWeight: 'bold', color: 'white', margin: 0 }}>
                                🛒 How Buying Works
                            </h3>
                            <button
                                onClick={() => setMarketBuyHelpOpen(false)}
                                style={{
                                    background: 'transparent',
                                    border: 'none',
                                    color: '#94a3b8',
                                    fontSize: '1.5rem',
                                    cursor: 'pointer',
                                    padding: '4px'
                                }}
                            >
                                ✕
                            </button>
                        </div>

                        <div style={{ color: '#cbd5e1', lineHeight: '1.6' }}>
                            <div style={{ marginBottom: '24px' }}>
                                <p style={{ fontSize: '1rem', marginBottom: '16px' }}>
                                    These buttons allow you to quickly enter a position. You are placing a <strong>Market Order</strong>, which means you buy immediately at the best available price.
                                </p>
                            </div>

                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px', marginBottom: '24px' }}>
                                <div style={{ background: 'rgba(16, 185, 129, 0.1)', padding: '16px', borderRadius: '8px', border: '1px solid rgba(16, 185, 129, 0.2)' }}>
                                    <h4 style={{ color: '#10b981', fontSize: '1.1rem', marginTop: 0, marginBottom: '8px' }}>🚀 Aggressive</h4>
                                    <p style={{ margin: 0, fontSize: '0.9rem' }}>
                                        <strong>Instant Buy.</strong> No confirmation modal. Best for catching fast moves.
                                        <br />
                                        <span style={{ fontSize: '0.8rem', opacity: 0.8 }}>(Careful: Slippage/Fees apply)</span>
                                    </p>
                                </div>
                                <div style={{ background: 'rgba(59, 130, 246, 0.1)', padding: '16px', borderRadius: '8px', border: '1px solid rgba(59, 130, 246, 0.2)' }}>
                                    <h4 style={{ color: '#60a5fa', fontSize: '1.1rem', marginTop: 0, marginBottom: '8px' }}>🛡 Passive</h4>
                                    <p style={{ margin: 0, fontSize: '0.9rem' }}>
                                        <strong>Limit Order at Bid.</strong> You join the queue as a "Maker".
                                        <br />
                                        <span style={{ fontSize: '0.8rem', opacity: 0.8 }}>(Lower fees, but might not fill if price moves away)</span>
                                    </p>
                                </div>
                            </div>

                            <div style={{ marginBottom: '16px' }}>
                                <h4 style={{ color: '#f59e0b', fontSize: '1rem', marginBottom: '8px' }}>⚙️ Trade Amount</h4>
                                <p style={{ margin: 0, fontSize: '0.95rem' }}>
                                    The slider controls how much <strong>USDC</strong> you want to spend (e.g., $10, $50).
                                </p>
                            </div>

                            <div style={{ background: 'rgba(51, 65, 85, 0.3)', padding: '12px', borderRadius: '8px', border: '1px solid rgba(51, 65, 85, 0.5)' }}>
                                <p style={{ margin: 0, fontSize: '0.85rem', color: '#94a3b8' }}>
                                    💡 <strong>Tip:</strong> Use "Aggressive" when you just want in <em>now</em>. Use "Passive" if you're patient and want to save on fees.
                                </p>
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </div >
    )
}

export default FocusedMarketView
