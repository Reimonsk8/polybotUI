import { useState, useEffect, useRef } from 'react'
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from 'recharts'
import './FocusedMarketView.css'

const FocusedMarketView = ({ event }) => {
    const market = event.markets?.[0]
    const [priceHistory, setPriceHistory] = useState([])
    const [livePrices, setLivePrices] = useState({ up: 0, down: 0 })
    const [isConnected, setIsConnected] = useState(false)
    const wsRef = useRef(null)

    // WebSocket Connection
    useEffect(() => {
        if (!market) return

        const tokenIds = JSON.parse(market.clobTokenIds || '[]')
        const currentPrices = JSON.parse(market.outcomePrices || '[]')

        // Initial setup
        const initialUp = parseFloat(currentPrices[0] || 0)
        const initialDown = parseFloat(currentPrices[1] || 0)
        setLivePrices({ up: initialUp, down: initialDown })

        // Initialize history
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
                            setPriceHistory(h => {
                                const newPoint = {
                                    time: new Date().toLocaleTimeString(),
                                    timestamp: Date.now(),
                                    upPrice: newUp,
                                    downPrice: newDown
                                }
                                return [...h, newPoint].slice(-100)
                            })
                        }
                        return { up: newUp, down: newDown }
                    })
                } else if (data.event_type === 'book' || data.event_type === 'last_trade_price') {
                    // Fallback for direct price updates
                    setLivePrices(prev => {
                        let newUp = prev.up
                        let newDown = prev.down
                        let changed = false

                        const price = parseFloat(data.price)
                        if (!isNaN(price)) {
                            if (data.asset_id === tokenIds[0]) {
                                newUp = price
                                changed = true
                            } else if (data.asset_id === tokenIds[1]) {
                                newDown = price
                                changed = true
                            }
                        }

                        if (changed) {
                            setPriceHistory(h => {
                                const newPoint = {
                                    time: new Date().toLocaleTimeString(),
                                    timestamp: Date.now(),
                                    upPrice: newUp,
                                    downPrice: newDown
                                }
                                return [...h, newPoint].slice(-100)
                            })
                        }
                        return { up: newUp, down: newDown }
                    })
                }
            } catch (err) {
                console.error("WS Error", err)
            }
        }

        ws.onclose = () => setIsConnected(false)

        return () => ws.close()
    }, [market])

    if (!market) return <div className="loading">Loading Market Data...</div>

    const outcomes = JSON.parse(market.outcomes || '[]')

    const calculateProfit = (price) => {
        if (!price || price === 0) return 0
        // Profit for $1 bet = (1 / price) - 1 (cost basis)
        // Or simply: Payout $1 / Price = Shares. Shares - $1 cost = Profit.
        // Or simpler: $1 buys (1/Price) shares. At $1 payout: (1/Price) * $1 = Value. Value - $1 = Profit.
        return ((1 / price) - 1)
    }

    return (
        <div className="focused-market-view">
            {/* Header */}
            <div className="focused-header">
                <div className="focused-title">
                    <h2>{event.title}</h2>
                    <div className="focused-meta">
                        <span>End: {new Date(event.endDate).toLocaleString()}</span>
                        <span>Vol: ${(market.volumeNum || 0).toLocaleString(undefined, { maximumFractionDigits: 0 })}</span>
                    </div>
                </div>
                <div className="live-indicator">
                    <div className="live-dot" style={{ background: isConnected ? '#10b981' : '#64748b', animation: isConnected ? 'pulse 2s infinite' : 'none' }}></div>
                    {isConnected ? 'LIVE FEED ACTIVE' : 'CONNECTING...'}
                </div>
            </div>

            {/* Main Chart */}
            <div className="focused-chart-container">
                <ResponsiveContainer width="100%" height="100%" minHeight={400}>
                    <LineChart data={priceHistory}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#334155" opacity={0.5} />
                        <XAxis
                            dataKey="time"
                            stroke="#94a3b8"
                            tick={{ fill: '#94a3b8', fontSize: 11 }}
                            minTickGap={50}
                        />
                        <YAxis
                            stroke="#94a3b8"
                            tick={{ fill: '#94a3b8', fontSize: 11 }}
                            domain={[0, 1]}
                            tickFormatter={v => `${(v * 100).toFixed(0)}%`}
                        />
                        <Tooltip
                            contentStyle={{ background: '#0f172a', border: '1px solid #334155' }}
                            formatter={v => `${(v * 100).toFixed(1)}%`}
                        />
                        <Legend />
                        <Line type="stepAfter" dataKey="upPrice" stroke="#10b981" strokeWidth={3} dot={false} name={outcomes[0] || 'UP'} animationDuration={300} />
                        <Line type="stepAfter" dataKey="downPrice" stroke="#ef4444" strokeWidth={3} dot={false} name={outcomes[1] || 'DOWN'} animationDuration={300} />
                    </LineChart>
                </ResponsiveContainer>
            </div>

            {/* Outcomes & Profit Calc */}
            <div className="focused-outcomes">
                {/* UP Outcome */}
                <div className="focused-outcome-card up">
                    <div className="outcome-header-row">
                        <div className="outcome-label">
                            📈 {outcomes[0] || 'UP'}
                        </div>
                        <div className="prob-badge" style={{ color: '#10b981' }}>
                            {(livePrices.up * 100).toFixed(1)}%
                        </div>
                    </div>

                    <div className="profit-section">
                        <div className="profit-header">
                            With <strong>$1.00</strong> investment:
                        </div>
                        <div className="profit-values">
                            <span>Potential Profit:</span>
                            <span className="profit-amount">
                                +${calculateProfit(livePrices.up).toFixed(2)}
                            </span>
                        </div>
                    </div>

                    <a
                        href={`https://polymarket.com/event/${event.slug}`}
                        target="_blank"
                        rel="noreferrer"
                        className="trade-btn-large"
                    >
                        Bet UP
                    </a>
                </div>

                {/* DOWN Outcome */}
                <div className="focused-outcome-card down">
                    <div className="outcome-header-row">
                        <div className="outcome-label">
                            📉 {outcomes[1] || 'DOWN'}
                        </div>
                        <div className="prob-badge" style={{ color: '#ef4444' }}>
                            {(livePrices.down * 100).toFixed(1)}%
                        </div>
                    </div>

                    <div className="profit-section">
                        <div className="profit-header">
                            With <strong>$1.00</strong> investment:
                        </div>
                        <div className="profit-values">
                            <span>Potential Profit:</span>
                            <span className="profit-amount">
                                +${calculateProfit(livePrices.down).toFixed(2)}
                            </span>
                        </div>
                    </div>

                    <a
                        href={`https://polymarket.com/event/${event.slug}`}
                        target="_blank"
                        rel="noreferrer"
                        className="trade-btn-large"
                    >
                        Bet DOWN
                    </a>
                </div>
            </div>
        </div>
    )
}

export default FocusedMarketView
