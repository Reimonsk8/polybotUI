import { useState, useEffect, useRef } from 'react'
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend, ReferenceLine } from 'recharts'
import './FocusedMarketView.css'

const FocusedMarketView = ({ event }) => {
    const market = event.markets?.[0]
    const outcomes = JSON.parse(market?.outcomes || '[]')

    // Outcome Pricing State
    const [priceHistory, setPriceHistory] = useState([]) // Outcome prices (0-1)
    const [livePrices, setLivePrices] = useState({ up: 0, down: 0 })
    const [isConnected, setIsConnected] = useState(false)
    const wsRef = useRef(null)

    // Asset Pricing State (For the "Bitcoin" chart)
    const [assetSymbol, setAssetSymbol] = useState(null)
    const [targetPrice, setTargetPrice] = useState(null)
    const [assetPriceHistory, setAssetPriceHistory] = useState([])
    const [currentAssetPrice, setCurrentAssetPrice] = useState(null)
    const [isAssetConnected, setIsAssetConnected] = useState(false)
    const assetWsRef = useRef(null)

    // PARSE METADATA
    useEffect(() => {
        if (!event) return

        // 1. Detect Symbol
        const t = event.title.toLowerCase()
        let symbol = null
        if (t.includes('bitcoin') || t.includes('btc')) symbol = 'btcusdt'
        else if (t.includes('ethereum') || t.includes('eth')) symbol = 'ethusdt'
        else if (t.includes('solana') || t.includes('sol')) symbol = 'solusdt'
        setAssetSymbol(symbol)

        // 2. Detect Target Price (Strike)
        // Regex for price with optional commas and decimals
        const desc = event.description || ''
        const title = event.title || ''
        const text = title + " " + desc
        const match = text.match(/\$([0-9,]+(\.[0-9]{2})?)/)
        if (match) {
            setTargetPrice(parseFloat(match[1].replace(/,/g, '')))
        }
    }, [event])


    // WS 1: MARKET OUTCOMES (Existing Logic)
    useEffect(() => {
        if (!market) return

        const tokenIds = JSON.parse(market.clobTokenIds || '[]')
        const currentPrices = JSON.parse(market.outcomePrices || '[]')

        // Initial setup
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
                const data = JSON.parse(e.data)

                if (data.event_type === 'price_change' && data.price_changes) {
                    setLivePrices(prev => {
                        let newUp = prev.up
                        let newDown = prev.down
                        let changed = false

                        data.price_changes.forEach(change => {
                            const price = parseFloat(change.price)
                            if (change.asset_id === tokenIds[0]) {
                                newUp = price
                                changed = true
                            } else if (change.asset_id === tokenIds[1]) {
                                newDown = price
                                changed = true
                            }
                        })

                        if (changed) {
                            setPriceHistory(h => [...h, {
                                time: new Date().toLocaleTimeString(),
                                timestamp: Date.now(),
                                upPrice: newUp,
                                downPrice: newDown
                            }].slice(-50))
                        }
                        return { up: newUp, down: newDown }
                    })
                }
            } catch (err) { }
        }

        ws.onclose = () => setIsConnected(false)
        return () => ws.close()
    }, [market])


    // WS 2: ASSET PRICES (New Logic)
    useEffect(() => {
        if (!assetSymbol) return

        const ws = new WebSocket('wss://ws-subscriptions-clob.polymarket.com/ws/market')
        assetWsRef.current = ws

        ws.onopen = () => {
            setIsAssetConnected(true)
            // Subscribe to crypto_prices topic
            // Tried formats: "filters": "btcusdt"
            ws.send(JSON.stringify({
                action: "subscribe",
                subscriptions: [
                    {
                        topic: "crypto_prices",
                        type: "update",
                        filters: [assetSymbol] // Try array format
                    }
                ]
            }))
        }

        ws.onmessage = (e) => {
            try {
                const msg = JSON.parse(e.data)
                // Expected: { topic: "crypto_prices", payload: { symbol: "btcusdt", value: 67234.50, timestamp: ... } }
                if (msg.topic === 'crypto_prices' && msg.payload) {
                    const price = parseFloat(msg.payload.value)
                    setCurrentAssetPrice(price)
                    setAssetPriceHistory(h => [...h, {
                        time: new Date(msg.payload.timestamp || Date.now()).toLocaleTimeString(),
                        timestamp: msg.payload.timestamp,
                        price: price
                    }].slice(-50))
                }
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

    // Determine which chart to show
    const showAssetChart = assetSymbol && currentAssetPrice

    // Calculate Y-Axis domain for Asset Chart to be tight
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
                    stroke="#f59e0b" // Gold for Bitcoin
                    strokeWidth={3}
                    dot={false}
                    animationDuration={300}
                />
            </LineChart>
        </ResponsiveContainer>
    ) : (
        // Fallback to Outcome Chart (Existing)
        <ResponsiveContainer width="100%" height="100%" minHeight={450}>
            <LineChart data={priceHistory}>
                <CartesianGrid strokeDasharray="3 3" stroke="#334155" opacity={0.3} />
                <XAxis dataKey="time" stroke="#64748b" tick={{ fontSize: 11 }} />
                <YAxis stroke="#64748b" domain={[0, 1]} tickFormatter={v => `${(v * 100).toFixed(0)}%`} />
                <Tooltip contentStyle={{ background: '#0f172a' }} formatter={v => `${(v * 100).toFixed(1)}%`} />
                <Legend />
                <Line type="stepAfter" dataKey="upPrice" stroke="#10b981" strokeWidth={3} dot={false} name="UP" />
                <Line type="stepAfter" dataKey="downPrice" stroke="#ef4444" strokeWidth={3} dot={false} name="DOWN" />
            </LineChart>
        </ResponsiveContainer>
    )

    return (
        <div className="focused-market-view">
            {/* Header */}
            <div className="focused-header">
                <div className="focused-title">
                    <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                        <img src={event.icon} alt="" style={{ width: 48, height: 48, borderRadius: '50%' }} onError={e => e.target.style.display = 'none'} />
                        <div>
                            <h2 style={{ fontSize: '1.8rem', margin: 0 }}>{event.title}</h2>
                            <div className="focused-meta">
                                <span>{new Date(event.startDate).toLocaleString()} - {new Date(event.endDate).toLocaleString()}</span>
                            </div>
                        </div>
                    </div>
                </div>

                {/* Price Stats (Asset Chart Mode) */}
                {showAssetChart && targetPrice && (
                    <div className="price-stats-header" style={{ display: 'flex', gap: '3rem', alignItems: 'center' }}>
                        <div style={{ textAlign: 'right' }}>
                            <div style={{ color: '#94a3b8', fontSize: '0.9rem', fontWeight: '600' }}>PRICE TO BEAT</div>
                            <div style={{ fontSize: '1.6rem', fontWeight: '700', color: '#e2e8f0' }}>${targetPrice.toLocaleString()}</div>
                        </div>
                        <div style={{ textAlign: 'right' }}>
                            <div style={{ color: '#f59e0b', fontSize: '0.9rem', fontWeight: '600' }}>CURRENT PRICE</div>
                            <div style={{ fontSize: '1.6rem', fontWeight: '700', color: '#f59e0b' }}>${currentAssetPrice.toLocaleString()}</div>
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
                {/* UP Outcome */}
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

                {/* DOWN Outcome */}
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
