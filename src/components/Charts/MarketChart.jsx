import { useState, useEffect, useRef } from 'react'
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from 'recharts'
import './MarketChart.css'

function MarketChart({ market, onClose }) {
    const [priceHistory, setPriceHistory] = useState([])
    const [isConnected, setIsConnected] = useState(false)
    const wsRef = useRef(null)

    useEffect(() => {
        if (!market) return

        const tokenIds = JSON.parse(market.clobTokenIds || '[]')
        if (tokenIds.length === 0) return

        // Connect to Polymarket WebSocket
        const connectWebSocket = () => {
            const ws = new WebSocket('wss://ws-subscriptions-clob.polymarket.com/ws/market')
            wsRef.current = ws

            ws.onopen = () => {
                setIsConnected(true)

                // Subscribe to market updates
                const subscribeMessage = {
                    assets_ids: tokenIds,
                    type: 'market'
                }
                ws.send(JSON.stringify(subscribeMessage))
            }

            ws.onmessage = (event) => {
                try {
                    const data = JSON.parse(event.data)

                    // Handle price_change events (has price_changes array)
                    if (data.event_type === 'price_change' && data.price_changes) {
                        const timestamp = new Date().toLocaleTimeString()

                        setPriceHistory(prev => {
                            const lastEntry = prev[prev.length - 1] || {
                                upPrice: parseFloat(currentPrices[0] || 0),
                                downPrice: parseFloat(currentPrices[1] || 0)
                            }

                            let newUpPrice = lastEntry.upPrice
                            let newDownPrice = lastEntry.downPrice

                            // Process each price change in the array
                            data.price_changes.forEach(change => {
                                const assetId = change.asset_id
                                const price = parseFloat(change.price || 0)

                                if (assetId === tokenIds[0]) {
                                    newUpPrice = price
                                } else if (assetId === tokenIds[1]) {
                                    newDownPrice = price
                                }
                            })

                            const newEntry = {
                                time: timestamp,
                                timestamp: Date.now(),
                                upPrice: newUpPrice,
                                downPrice: newDownPrice
                            }


                            // Keep last 50 data points
                            const updated = [...prev, newEntry].slice(-50)
                            return updated
                        })
                    }
                    // Handle book or last_trade_price events (has direct price field)
                    else if (data.event_type === 'book' || data.event_type === 'last_trade_price') {
                        const timestamp = new Date().toLocaleTimeString()

                        // Extract prices for both outcomes
                        const upPrice = data.asset_id === tokenIds[0] ? parseFloat(data.price || 0) : null
                        const downPrice = data.asset_id === tokenIds[1] ? parseFloat(data.price || 0) : null

                        setPriceHistory(prev => {
                            const lastEntry = prev[prev.length - 1] || {
                                upPrice: parseFloat(currentPrices[0] || 0),
                                downPrice: parseFloat(currentPrices[1] || 0)
                            }

                            const newEntry = {
                                time: timestamp,
                                timestamp: Date.now(),
                                upPrice: upPrice !== null ? upPrice : lastEntry.upPrice,
                                downPrice: downPrice !== null ? downPrice : lastEntry.downPrice
                            }


                            // Keep last 50 data points
                            const updated = [...prev, newEntry].slice(-50)
                            return updated
                        })
                    }
                } catch (error) {
                }
            }

            ws.onerror = (error) => {
                setIsConnected(false)
            }

            ws.onclose = () => {
                setIsConnected(false)
            }
        }

        connectWebSocket()

        // Cleanup on unmount
        return () => {
            if (wsRef.current) {
                wsRef.current.close()
            }
        }
    }, [market])

    // Fetch initial price history
    useEffect(() => {
        if (!market) return

        const fetchInitialPrices = async () => {
            const tokenIds = JSON.parse(market.clobTokenIds || '[]')
            const outcomes = JSON.parse(market.outcomes || '[]')
            const currentPrices = JSON.parse(market.outcomePrices || '[]')

            // Initialize with current prices
            const initialData = [{
                time: new Date().toLocaleTimeString(),
                timestamp: Date.now(),
                upPrice: parseFloat(currentPrices[0] || 0),
                downPrice: parseFloat(currentPrices[1] || 0)
            }]

            setPriceHistory(initialData)
        }

        fetchInitialPrices()
    }, [market])

    if (!market) return null

    const outcomes = JSON.parse(market.outcomes || '[]')
    const currentPrices = JSON.parse(market.outcomePrices || '[]')

    return (
        <div className="chart-modal-overlay" onClick={onClose}>
            <div className="chart-modal" onClick={(e) => e.stopPropagation()}>
                <div className="chart-header">
                    <div className="chart-title-section">
                        <h2 className="chart-title">{market.question}</h2>
                        <div className="connection-status">
                            <span className={`status-dot ${isConnected ? 'connected' : 'disconnected'}`}></span>
                            <span className="status-text">
                                {isConnected ? '🟢 Live WebSocket' : '🔴 Disconnected'}
                            </span>
                        </div>
                    </div>
                    <button className="close-button" onClick={onClose}>✕</button>
                </div>

                <div className="chart-content">
                    {/* Current Prices */}
                    <div className="current-prices">
                        <div className="price-card up">
                            <div className="price-label">
                                <span className="outcome-icon">📈</span>
                                {outcomes[0] || 'UP'}
                            </div>
                            <div className="price-value">{(parseFloat(currentPrices[0] || 0) * 100).toFixed(1)}%</div>
                            <div className="price-subtitle">${parseFloat(currentPrices[0] || 0).toFixed(4)}</div>
                        </div>
                        <div className="price-card down">
                            <div className="price-label">
                                <span className="outcome-icon">📉</span>
                                {outcomes[1] || 'DOWN'}
                            </div>
                            <div className="price-value">{(parseFloat(currentPrices[1] || 0) * 100).toFixed(1)}%</div>
                            <div className="price-subtitle">${parseFloat(currentPrices[1] || 0).toFixed(4)}</div>
                        </div>
                    </div>

                    {/* Real-time Chart */}
                    <div className="chart-container">
                        <h3 className="chart-section-title">
                            📊 Real-Time Price Chart
                            <span className="data-points">({priceHistory.length} data points)</span>
                        </h3>

                        {priceHistory.length > 0 ? (
                            <ResponsiveContainer width="100%" height={400}>
                                <LineChart data={priceHistory}>
                                    <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                                    <XAxis
                                        dataKey="time"
                                        stroke="#94a3b8"
                                        tick={{ fill: '#94a3b8', fontSize: 12 }}
                                    />
                                    <YAxis
                                        stroke="#94a3b8"
                                        tick={{ fill: '#94a3b8', fontSize: 12 }}
                                        domain={[0, 1]}
                                        tickFormatter={(value) => `${(value * 100).toFixed(0)}%`}
                                    />
                                    <Tooltip
                                        contentStyle={{
                                            backgroundColor: '#1a2347',
                                            border: '1px solid #334155',
                                            borderRadius: '8px',
                                            color: '#f1f5f9'
                                        }}
                                        formatter={(value) => `${(value * 100).toFixed(2)}%`}
                                    />
                                    <Legend
                                        wrapperStyle={{ color: '#f1f5f9' }}
                                    />
                                    <Line
                                        type="monotone"
                                        dataKey="upPrice"
                                        stroke="#10b981"
                                        strokeWidth={2}
                                        name="UP"
                                        dot={false}
                                        activeDot={{ r: 6 }}
                                    />
                                    <Line
                                        type="monotone"
                                        dataKey="downPrice"
                                        stroke="#ef4444"
                                        strokeWidth={2}
                                        name="DOWN"
                                        dot={false}
                                        activeDot={{ r: 6 }}
                                    />
                                </LineChart>
                            </ResponsiveContainer>
                        ) : (
                            <div className="chart-loading">
                                <div className="spinner-large"></div>
                                <p>Waiting for real-time data...</p>
                            </div>
                        )}
                    </div>

                    {/* Market Info */}
                    <div className="market-info">
                        <div className="info-item">
                            <span className="info-label">Volume</span>
                            <span className="info-value">
                                ${(market.volumeNum || 0).toLocaleString(undefined, {
                                    maximumFractionDigits: 0
                                })}
                            </span>
                        </div>
                        <div className="info-item">
                            <span className="info-label">Liquidity</span>
                            <span className="info-value">
                                ${(market.liquidityNum || 0).toLocaleString(undefined, {
                                    maximumFractionDigits: 0
                                })}
                            </span>
                        </div>
                        <div className="info-item">
                            <span className="info-label">Data Points</span>
                            <span className="info-value">{priceHistory.length}</span>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    )
}

export default MarketChart
