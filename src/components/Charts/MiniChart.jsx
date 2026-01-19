import { useState, useEffect, useRef } from 'react'
import { LineChart, Line, ResponsiveContainer } from 'recharts'
import './MiniChart.css'

function MiniChart({ market, onClick }) {
    const [priceHistory, setPriceHistory] = useState([])
    const [isConnected, setIsConnected] = useState(false)
    const wsRef = useRef(null)

    useEffect(() => {
        if (!market) return

        const tokenIds = JSON.parse(market.clobTokenIds || '[]')
        const currentPrices = JSON.parse(market.outcomePrices || '[]')

        if (tokenIds.length === 0) return

        // Initialize with current prices
        setPriceHistory([{
            timestamp: Date.now(),
            upPrice: parseFloat(currentPrices[0] || 0),
            downPrice: parseFloat(currentPrices[1] || 0)
        }])

        // Connect to WebSocket
        const ws = new WebSocket('wss://ws-subscriptions-clob.polymarket.com/ws/market')
        wsRef.current = ws

        ws.onopen = () => {
            setIsConnected(true)
            ws.send(JSON.stringify({
                assets_ids: tokenIds,
                type: 'market'
            }))
        }

        ws.onmessage = (event) => {
            try {
                const data = JSON.parse(event.data)

                if (data.event_type === 'price_change' && data.price_changes) {
                    setPriceHistory(prev => {
                        const lastEntry = prev[prev.length - 1] || {
                            upPrice: parseFloat(currentPrices[0] || 0),
                            downPrice: parseFloat(currentPrices[1] || 0)
                        }

                        let newUpPrice = lastEntry.upPrice
                        let newDownPrice = lastEntry.downPrice

                        data.price_changes.forEach(change => {
                            const price = parseFloat(change.price || 0)
                            if (change.asset_id === tokenIds[0]) {
                                newUpPrice = price
                            } else if (change.asset_id === tokenIds[1]) {
                                newDownPrice = price
                            }
                        })

                        const newEntry = {
                            timestamp: Date.now(),
                            upPrice: newUpPrice,
                            downPrice: newDownPrice
                        }

                        // Keep last 20 data points for mini chart
                        return [...prev, newEntry].slice(-20)
                    })
                }
            } catch (error) {
            }
        }

        ws.onerror = () => setIsConnected(false)
        ws.onclose = () => setIsConnected(false)

        // Cleanup
        return () => {
            if (wsRef.current) {
                wsRef.current.close()
            }
        }
    }, [market])

    if (!market || priceHistory.length === 0) return null

    return (
        <div className="mini-chart-container" onClick={onClick}>
            <div className="mini-chart-header">
                <span className="mini-chart-label">📊 Live Chart</span>
                <span className={`mini-status ${isConnected ? 'connected' : 'disconnected'}`}>
                    {isConnected ? '🟢' : '🔴'}
                </span>
            </div>
            <div className="mini-chart">
                <ResponsiveContainer width="100%" height={80}>
                    <LineChart data={priceHistory}>
                        <Line
                            type="monotone"
                            dataKey="upPrice"
                            stroke="#10b981"
                            strokeWidth={2}
                            dot={false}
                            isAnimationActive={false}
                        />
                        <Line
                            type="monotone"
                            dataKey="downPrice"
                            stroke="#ef4444"
                            strokeWidth={2}
                            dot={false}
                            isAnimationActive={false}
                        />
                    </LineChart>
                </ResponsiveContainer>
            </div>
            <div className="mini-chart-hint">Click to expand →</div>
        </div>
    )
}

export default MiniChart
