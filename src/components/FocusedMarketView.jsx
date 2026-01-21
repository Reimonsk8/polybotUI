import { useState, useEffect, useRef } from 'react'
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend, ReferenceLine } from 'recharts'
import './FocusedMarketView.css'

const FocusedMarketView = ({ event }) => {
    const market = event.markets?.[0]
    const outcomes = JSON.parse(market?.outcomes || '[]')

    // Outcome Pricing State
    const [priceHistory, setPriceHistory] = useState([])
    const [livePrices, setLivePrices] = useState({ up: 0, down: 0 })
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
    }, [event])

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


    // HELPER: Process generic Outcome Updates (Price Change & Book)
    const processOutcomeMessage = (data, tokenIds) => {
        if (!data) return false

        let newUp = null
        let newDown = null
        let changed = false

        // A. Handle 'price_change' or 'diff'
        const changes = data.price_changes || data.changes
        if ((data.event_type === 'price_change' || data.event_type === 'diff') && changes) {
            changes.forEach(change => {
                const price = parseFloat(change.price)
                if (change.asset_id === tokenIds[0]) newUp = price
                else if (change.asset_id === tokenIds[1]) newDown = price
            })
        }

        // B. Handle 'book' snapshots (Bids/Asks)
        if (data.event_type === 'book') {
            const assetId = data.asset_id
            if (data.bids && data.bids.length > 0) {
                // Use BEST BID as approximate price
                const bestBid = data.bids.reduce((max, b) => Math.max(max, parseFloat(b.price)), 0)
                if (assetId === tokenIds[0]) newUp = bestBid
                else if (assetId === tokenIds[1]) newDown = bestBid
            }
        }

        // Apply changes
        if (newUp !== null || newDown !== null) {
            setLivePrices(prev => {
                const updatedUp = newUp !== null ? newUp : prev.up
                const updatedDown = newDown !== null ? newDown : prev.down

                if (updatedUp !== prev.up || updatedDown !== prev.down) {
                    changed = true
                    setPriceHistory(h => [...h, {
                        time: new Date().toLocaleTimeString(),
                        timestamp: Date.now(),
                        upPrice: updatedUp,
                        downPrice: updatedDown
                    }].slice(-50))
                    return { up: updatedUp, down: updatedDown }
                }
                return prev
            })
            return true
        }
        return false
    }

    // 3. WS 1: MARKET OUTCOMES (CLOB)
    useEffect(() => {
        if (!market) return

        const tokenIds = JSON.parse(market.clobTokenIds || '[]')
        const currentPrices = JSON.parse(market.outcomePrices || '[]')

        const initialUp = parseFloat(currentPrices[0] || 0)
        const initialDown = parseFloat(currentPrices[1] || 0)
        setLivePrices({ up: initialUp, down: initialDown })

        setPriceHistory([{
            time: new Date().toLocaleTimeString(),
            timestamp: Date.now(),
            upPrice: initialUp,
            downPrice: initialDown
        }])

        if (tokenIds.length === 0) return

        const ws = new WebSocket('wss://ws-subscriptions-clob.polymarket.com/ws/market')
        wsRef.current = ws

        ws.onopen = () => {
            setIsConnected(true)
            ws.send(JSON.stringify({
                assets_ids: tokenIds,
                type: 'market'
            }))
        }

        ws.onmessage = (e) => {
            try {
                const raw = JSON.parse(e.data)
                const messages = Array.isArray(raw) ? raw : [raw]
                messages.forEach(msg => processOutcomeMessage(msg, tokenIds))
            } catch (err) { }
        }

        ws.onclose = () => setIsConnected(false)
        return () => ws.close()
    }, [market])


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

                {/* Fallback for Probs view */}
                {!showAssetChart && (
                    <div className="price-stats-header" style={{ display: 'flex', gap: '3rem', alignItems: 'center' }}>
                        <div style={{ textAlign: 'right' }}>
                            <div style={{ color: '#10b981', fontSize: '0.85rem', fontWeight: '600', textTransform: 'uppercase' }}>UP</div>
                            <div style={{ fontSize: '1.8rem', fontWeight: '700', color: '#10b981', lineHeight: 1 }}>{(livePrices.up * 100).toFixed(1)}%</div>
                        </div>
                        <div style={{ textAlign: 'right' }}>
                            <div style={{ color: '#ef4444', fontSize: '0.85rem', fontWeight: '600', textTransform: 'uppercase' }}>DOWN</div>
                            <div style={{ fontSize: '1.8rem', fontWeight: '700', color: '#ef4444', lineHeight: 1 }}>{(livePrices.down * 100).toFixed(1)}%</div>
                        </div>
                    </div>
                )}

                <div className="live-indicator">
                    <div className="live-dot" style={{ background: isConnected || isAssetConnected ? '#10b981' : '#64748b', animation: (isConnected || isAssetConnected) ? 'pulse 2s infinite' : 'none' }}></div>
                    {(isConnected || isAssetConnected) ? 'LIVE' : '...'}
                </div>
            </div>

            {/* Main Chart */}
            <div className="focused-chart-container" style={{
                background: '#0b1221',
                border: '1px solid #1e293b',
                position: 'relative',
                width: '100%',
                height: '500px',
                borderRadius: '12px',
                overflow: 'hidden'
            }}>
                {ChartComponent}

                {/* CHART TOGGLES */}
                {assetSymbol && (
                    <div className="chart-toggles" style={{
                        position: 'absolute',
                        bottom: '20px',
                        right: '20px',
                        display: 'flex',
                        gap: '8px',
                        zIndex: 10
                    }}>
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
            </div>

            {/* Outcomes & Profit Calc */}
            <div className="focused-outcomes">
                <div className="focused-outcome-card up">
                    <div className="outcome-header-row">
                        <div className="outcome-label">📈 {outcomes[0] || 'UP'}</div>
                        <div className="prob-badge" style={{ color: '#10b981' }}>{(livePrices.up * 100).toFixed(1)}%</div>
                    </div>
                    <div className="profit-section">
                        <div className="profit-header">With <strong>$1.00</strong> investment:</div>
                        <div className="profit-values">
                            <span>Potential Profit:</span>
                            <span className="profit-amount">+${calculateProfit(livePrices.up).toFixed(2)}</span>
                        </div>
                    </div>
                    <a href={`https://polymarket.com/event/${event.slug}`} target="_blank" rel="noreferrer" className="trade-btn-large">Bet UP</a>
                </div>

                <div className="focused-outcome-card down">
                    <div className="outcome-header-row">
                        <div className="outcome-label">📉 {outcomes[1] || 'DOWN'}</div>
                        <div className="prob-badge" style={{ color: '#ef4444' }}>{(livePrices.down * 100).toFixed(1)}%</div>
                    </div>
                    <div className="profit-section">
                        <div className="profit-header">With <strong>$1.00</strong> investment:</div>
                        <div className="profit-values">
                            <span>Potential Profit:</span>
                            <span className="profit-amount">+${calculateProfit(livePrices.down).toFixed(2)}</span>
                        </div>
                    </div>
                    <a href={`https://polymarket.com/event/${event.slug}`} target="_blank" rel="noreferrer" className="trade-btn-large">Bet DOWN</a>
                </div>
            </div>
        </div>
    )
}

export default FocusedMarketView
