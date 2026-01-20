import { useState, useEffect } from 'react'
import './PortfolioTabs.css'

const PortfolioTabs = ({ userAddress, client }) => {
    const [activeTab, setActiveTab] = useState('active') // 'active', 'closed', 'activity'
    const [activeBets, setActiveBets] = useState([])
    const [closedPositions, setClosedPositions] = useState([])
    const [activityLog, setActivityLog] = useState([])
    const [loading, setLoading] = useState(false)
    const [autoRefresh, setAutoRefresh] = useState(false)

    // Fetch Active Bets using L2 authenticated client methods
    const fetchActiveBets = async () => {
        try {
            if (!client) {
                return
            }

            // Get open orders and recent trades to build position data
            const [openOrders, trades] = await Promise.all([
                client.getOpenOrders(),
                client.getTrades({ limit: 100 })
            ])

            // Calculate positions from trades
            const positionMap = new Map()

            trades.forEach(trade => {
                const key = `${trade.market}-${trade.asset_id}`
                if (!positionMap.has(key)) {
                    positionMap.set(key, {
                        market: trade.market,
                        asset_id: trade.asset_id,
                        outcome: trade.outcome,
                        size: 0,
                        totalCost: 0,
                        trades: []
                    })
                }

                const position = positionMap.get(key)
                const tradeSize = parseFloat(trade.size)
                const tradePrice = parseFloat(trade.price)

                if (trade.side === 'BUY') {
                    position.size += tradeSize
                    position.totalCost += tradeSize * tradePrice
                } else {
                    position.size -= tradeSize
                    position.totalCost -= tradeSize * tradePrice
                }
                position.trades.push(trade)
            })

            // Filter to only active positions (size > 0) and enrich with market data
            const activePositions = Array.from(positionMap.values())
                .filter(p => p.size > 0.001) // Small threshold for floating point
                .map(p => ({
                    ...p,
                    avgPrice: p.totalCost / p.size,
                    conditionId: p.market,
                    title: p.outcome || 'Unknown Market'
                }))

            // Enrich with Gamma API market metadata
            const enrichedPositions = await Promise.all(
                activePositions.map(async (position) => {
                    try {
                        const proxyUrl = import.meta.env.VITE_PROXY_API_URL || 'http://localhost:3001'
                        const useProxy = import.meta.env.VITE_USE_PROXY !== 'false'

                        const marketUrl = useProxy
                            ? `${proxyUrl}/gamma-api/markets/${position.conditionId}`
                            : `https://gamma-api.polymarket.com/markets/${position.conditionId}`

                        const marketRes = await fetch(marketUrl)
                        if (marketRes.ok) {
                            const marketData = await marketRes.json()
                            return {
                                ...position,
                                marketData,
                                icon: marketData.icon,
                                description: marketData.description,
                                category: marketData.category,
                                endDate: marketData.endDate,
                                volume: marketData.volume,
                                title: marketData.question || position.title
                            }
                        }
                    } catch (err) {
                        // Silently fail for individual market data
                    }
                    return position
                })
            )

            setActiveBets(enrichedPositions)
        } catch (err) {
            // Silently fail
        }
    }

    // Fetch Closed Positions using L2 authenticated trades
    const fetchClosedPositions = async () => {
        try {
            if (!client) {
                return
            }

            // Get all trades and calculate closed positions
            const trades = await client.getTrades({ limit: 200 })

            // Group by market and calculate P&L
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

            // Filter to closed positions (size near 0)
            const closedPositions = Array.from(positionMap.values())
                .filter(p => Math.abs(p.size) < 0.001 && p.trades.length > 0)

            setClosedPositions(closedPositions)
        } catch (err) {
            // Silently fail
        }
    }

    // Fetch Activity Log using L2 authenticated client
    const fetchActivityLog = async () => {
        try {
            if (!client) {
                // Fallback to public API if no client
                const response = await fetch(`https://data-api.polymarket.com/activity?user=${userAddress}&limit=50&sortBy=TIMESTAMP&sortDirection=DESC`)
                if (response.ok) {
                    const data = await response.json()
                    setActivityLog(data)
                }
                return
            }

            // Use L2 authenticated method to get trades
            const trades = await client.getTrades({ limit: 50 })
            setActivityLog(trades)
        } catch (err) {
            // Silently fail
        }
    }

    // Fetch data based on active tab
    useEffect(() => {
        if (!userAddress) return

        setLoading(true)
        const fetchData = async () => {
            if (activeTab === 'active') {
                await fetchActiveBets()
            } else if (activeTab === 'closed') {
                await fetchClosedPositions()
            } else if (activeTab === 'activity') {
                await fetchActivityLog()
            }
            setLoading(false)
        }

        fetchData()
    }, [activeTab, userAddress])

    // Auto-refresh effect
    useEffect(() => {
        if (!autoRefresh || !userAddress) return

        const interval = setInterval(() => {
            if (activeTab === 'active') fetchActiveBets()
            else if (activeTab === 'closed') fetchClosedPositions()
            else if (activeTab === 'activity') fetchActivityLog()
        }, 30000) // 30 seconds

        return () => clearInterval(interval)
    }, [autoRefresh, activeTab, userAddress])

    const formatDate = (timestamp) => {
        return new Date(timestamp * 1000).toLocaleString()
    }

    const formatCurrency = (value) => {
        return `$${parseFloat(value).toFixed(2)}`
    }

    return (
        <div className="portfolio-tabs">
            {/* Tab Headers */}
            <div className="tab-headers">
                <button
                    className={`tab-header ${activeTab === 'active' ? 'active' : ''}`}
                    onClick={() => setActiveTab('active')}
                >
                    Active Bets
                </button>
                <button
                    className={`tab-header ${activeTab === 'closed' ? 'active' : ''}`}
                    onClick={() => setActiveTab('closed')}
                >
                    Closed Positions
                </button>
                <button
                    className={`tab-header ${activeTab === 'activity' ? 'active' : ''}`}
                    onClick={() => setActiveTab('activity')}
                >
                    Activity Log
                </button>
            </div>

            {/* Tab Content */}
            <div className="tab-content">
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

                                                <div className="position-stats">
                                                    <div className="stat">
                                                        <span className="stat-label">Size</span>
                                                        <span className="stat-value">{bet.size.toFixed(2)}</span>
                                                    </div>
                                                    <div className="stat">
                                                        <span className="stat-label">Avg Price</span>
                                                        <span className="stat-value">{formatCurrency(bet.avgPrice)}</span>
                                                    </div>
                                                    <div className="stat">
                                                        <span className="stat-label">Current Price</span>
                                                        <span className="stat-value">{formatCurrency(bet.curPrice)}</span>
                                                    </div>
                                                    <div className="stat">
                                                        <span className="stat-label">Value</span>
                                                        <span className="stat-value">{formatCurrency(bet.curPrice * bet.size)}</span>
                                                    </div>
                                                </div>

                                                {bet.volume && (
                                                    <div className="market-footer">
                                                        <span className="market-volume">
                                                            Vol: {formatCurrency(bet.volume)}
                                                        </span>
                                                        {bet.category && (
                                                            <span className="market-category">{bet.category}</span>
                                                        )}
                                                    </div>
                                                )}
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
                                                    <div className="stat">
                                                        <span className="stat-label">Size</span>
                                                        <span className="stat-value">{position.size?.toFixed(2) || 'N/A'}</span>
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
                            <div className="tab-panel">
                                {activityLog.length === 0 ? (
                                    <div className="empty-state">No activity found.</div>
                                ) : (
                                    <div className="activity-list">
                                        {activityLog.map((activity, idx) => {
                                            // Handle both Data API format and Trade format from getTrades()
                                            const isTrade = activity.match_time !== undefined
                                            const side = activity.side || 'TRADE'
                                            const type = activity.type || 'TRADE'
                                            const amount = activity.size || activity.usdcSize
                                            const timestamp = activity.match_time || activity.timestamp
                                            const outcome = activity.outcome || ''

                                            return (
                                                <div key={activity.id || idx} className="activity-item">
                                                    <div className="activity-icon">
                                                        {side === 'BUY' && '📈'}
                                                        {side === 'SELL' && '📉'}
                                                        {type === 'REDEEM' && '💰'}
                                                        {type === 'REWARD' && '🎁'}
                                                    </div>
                                                    <div className="activity-details">
                                                        <div className="activity-title">
                                                            <span className="activity-type">{type}</span>
                                                            {side && <span className={`activity-side ${side.toLowerCase()}`}>{side}</span>}
                                                        </div>
                                                        <div className="activity-market">{activity.title || outcome}</div>
                                                        <div className="activity-outcome">{outcome}</div>
                                                    </div>
                                                    <div className="activity-meta">
                                                        <div className="activity-amount">
                                                            {amount && `${parseFloat(amount).toFixed(2)} shares @ ${formatCurrency(activity.price || 0)}`}
                                                        </div>
                                                        <div className="activity-time">
                                                            {timestamp && (isTrade
                                                                ? new Date(timestamp).toLocaleString()
                                                                : formatDate(timestamp)
                                                            )}
                                                        </div>
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

                {/* Auto-refresh Toggle */}
                <div className="auto-refresh-toggle">
                    <label>
                        <input
                            type="checkbox"
                            checked={autoRefresh}
                            onChange={(e) => setAutoRefresh(e.target.checked)}
                        />
                        <span className="refresh-icon">🔄</span>
                        Auto-refresh every 30s
                    </label>
                </div>
            </div>
        </div >
    )
}

export default PortfolioTabs
