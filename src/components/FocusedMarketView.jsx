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
        // Helper: get best price from bids/asks (mid price or just match)
        // Polymarket 'price' usually refers to the last trade or mid price.
        // Let's use the BEST BID as the sell price, or BEST ASK as buy price.
        // For simplicity, let's look for `last_trade_price` if available, or best bid.
        if (data.event_type === 'book') {
            const assetId = data.asset_id

            // If data has explicit bids array
            if (data.bids && data.bids.length > 0) {
                // Best bid is usually first? Or parse.
                // The array is sorted? Usually best bid is highest price.
                // let's assume sorted descending or check.
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

    // 3. WS 1: MARKET OUTCOMES (Book & Diff)
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


    // 4. WS 2: ASSET PRICES (Try multiple endpoints if needed)
    useEffect(() => {
        if (!assetSymbol) return

        // NOTE: Trying separate endpoint based on documentation hints
        // But main doc says crypto_prices is a topic on the main channel?
        // Let's try `ws/market` first (default) but ensure we catch the 'updates'.
        // If that fails, the fallback is harder without a proxy.
        // User provided screenshot implies they connect to `ws-subscriptions-clob`.

        const ws = new WebSocket('wss://ws-subscriptions-clob.polymarket.com/ws/market')
        assetWsRef.current = ws

        ws.onopen = () => {
            setIsAssetConnected(true)
            ws.send(JSON.stringify({
                action: "subscribe",
                subscriptions: [
                    {
                        topic: "crypto_prices",
                        type: "update",
                        filters: [assetSymbol] // Try array again? Or string.
                        // Filter logic on server might require array of strings for multiple.
                    }
                ]
            }))
            // Redundancy: send string format too
            ws.send(JSON.stringify({
                action: "subscribe",
                subscriptions: [
                    {
                        topic: "crypto_prices",
                        type: "update",
                        filters: assetSymbol
                    }
                ]
            }))
        }

        ws.onmessage = (e) => {
            try {
                const raw = JSON.parse(e.data)
                const messages = Array.isArray(raw) ? raw : [raw]

                messages.forEach(msg => {
                    // Check for Crypto Price Update
                    if ((msg.topic === 'crypto_prices' || msg.event_type === 'crypto_prices') && msg.payload) {
                        const price = parseFloat(msg.payload.value)
                        setCurrentAssetPrice(price)
                        setAssetPriceHistory(h => [...h, {
                            time: new Date(msg.payload.timestamp || Date.now()).toLocaleTimeString(),
                            timestamp: msg.payload.timestamp,
                            price: price
                        }].slice(-50))
                    }
                })
            } catch (err) { }
        }

        ws.onclose = () => setIsAssetConnected(false)
        return () => ws.close()

    }, [assetSymbol])

    if (!market) return <div className="loading">Loading Market Data...</div>

    const calculateProfit = (price) => {
        if (!price || price === 0) return 0
        return ((1 / price) - 1)
    }

    const showAssetChart = assetSymbol && currentAssetPrice

    // Y-Domain
    const yDomain = showAssetChart && targetPrice
        ? [Math.min(currentAssetPrice, targetPrice) * 0.999, Math.max(currentAssetPrice, targetPrice) * 1.001]
        : ['auto', 'auto']

    const ChartComponent = showAssetChart ? (
        <ResponsiveContainer width="100%" height="100%" minHeight={450}>
            <LineChart data={assetPriceHistory}>
                <CartesianGrid strokeDasharray="3 3" stroke="#334155" opacity={0.3} />
                <XAxis dataKey="time" stroke="#64748b" tick={{ fontSize: 11 }} minTickGap={50} />
                <YAxis
                    stroke="#64748b"
                    domain={yDomain}
                    tickFormatter={v => `$${v.toLocaleString()}`}
                    width={80}
                />
                <Tooltip
                    contentStyle={{ background: '#0f172a', border: '1px solid #334155' }}
                    formatter={v => [`$${parseFloat(v).toLocaleString()}`, 'Price']}
                />

                {targetPrice && (
                    <ReferenceLine
                        y={targetPrice}
                        stroke="#94a3b8"
                        strokeDasharray="5 5"
                        label={{ value: 'Target', position: 'right', fill: '#94a3b8' }}
                    />
                )}

                <Line
                    type="monotone"
                    dataKey="price"
                    stroke="#f59e0b" // Gold
                    strokeWidth={3}
                    dot={false}
                    animationDuration={300}
                    isAnimationActive={false}
                />
            </LineChart>
        </ResponsiveContainer>
    ) : (
        <ResponsiveContainer width="100%" height="100%" minHeight={450}>
            <LineChart data={priceHistory}>
                <CartesianGrid strokeDasharray="3 3" stroke="#334155" opacity={0.3} />
                <XAxis dataKey="time" stroke="#64748b" tick={{ fontSize: 11 }} minTickGap={50} />
                <YAxis stroke="#64748b" domain={[0, 1]} tickFormatter={v => `${(v * 100).toFixed(0)}%`} />
                <Tooltip contentStyle={{ background: '#0f172a' }} formatter={v => `${(v * 100).toFixed(1)}%`} />
                <Legend />
                <Line type="stepAfter" dataKey="upPrice" stroke="#10b981" strokeWidth={3} dot={false} name="UP" isAnimationActive={false} />
                <Line type="stepAfter" dataKey="downPrice" stroke="#ef4444" strokeWidth={3} dot={false} name="DOWN" isAnimationActive={false} />
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
                        <div style={{ textAlign: 'right' }}>
                            <div style={{ color: '#94a3b8', fontSize: '0.85rem', fontWeight: '600', textTransform: 'uppercase' }}>Price to Beat</div>
                            <div style={{ fontSize: '1.8rem', fontWeight: '700', color: '#e2e8f0', lineHeight: 1 }}>${targetPrice.toLocaleString()}</div>
                        </div>
                        <div style={{ textAlign: 'right' }}>
                            <div style={{ color: '#f59e0b', fontSize: '0.85rem', fontWeight: '600', textTransform: 'uppercase' }}>Current Price</div>
                            <div style={{ fontSize: '1.8rem', fontWeight: '700', color: '#f59e0b', lineHeight: 1 }}>${currentAssetPrice.toLocaleString()}</div>
                        </div>
                    </div>
                )}

                <div className="live-indicator">
                    <div className="live-dot" style={{ background: isConnected ? '#10b981' : '#64748b', animation: isConnected ? 'pulse 2s infinite' : 'none' }}></div>
                    {isConnected ? 'LIVE' : '...'}
                </div>
            </div>

            {/* Main Chart */}
            <div className="focused-chart-container" style={{ background: '#0b1221', border: '1px solid #1e293b' }}>
                {ChartComponent}
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
