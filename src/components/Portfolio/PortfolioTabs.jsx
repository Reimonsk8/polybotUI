import { useState, useEffect } from 'react'
import './PortfolioTabs.css'
import { fetchActivityLog as fetchActivityData } from './ActivityLogFetcher'

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

            // Enrich with Gamma API market metadata (Sequential to avoid 429s)
            const enrichedPositions = []
            for (const position of activePositions) {
                try {
                    const proxyUrl = import.meta.env.VITE_PROXY_API_URL || 'http://localhost:3001'
                    const useProxy = import.meta.env.VITE_USE_PROXY !== 'false'

                    const marketUrl = useProxy
                        ? `${proxyUrl}/api/gamma-api/markets?condition_id=${position.conditionId}`
                        : `https://gamma-api.polymarket.com/markets?condition_id=${position.conditionId}`

                    const marketRes = await fetch(marketUrl)
                    if (marketRes.ok) {
                        const marketDataList = await marketRes.json()
                        const marketData = Array.isArray(marketDataList) ? marketDataList[0] : marketDataList

                        if (marketData) {
                            enrichedPositions.push({
                                ...position,
                                marketData,
                                title: marketData.question || position.title,
                                image: marketData.icon || marketData.image,
                                icon: marketData.icon || marketData.image,
                                slug: marketData.slug,
                                description: marketData.description,
                                category: marketData.category,
                                endDate: marketData.endDate,
                                volume: marketData.volume
                            })
                            continue
                        }
                    }
                } catch (err) {
                    console.warn(`Failed to fetch metadata for ${position.conditionId}`, err)
                }
                // Fallback if fetch failed
                enrichedPositions.push(position)

                // Small delay to be nice to the API
                await new Promise(resolve => setTimeout(resolve, 100))
            }

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

    // Fetch Activity Log using Data API with fallback to client.getTrades
    const fetchActivityLog = async () => {
        try {
            const proxyUrl = import.meta.env.VITE_PROXY_API_URL || 'http://localhost:3001'
            const useProxy = import.meta.env.VITE_USE_PROXY !== 'false'

            const data = await fetchActivityData(userAddress, client, proxyUrl, useProxy)
            setActivityLog(data)
            return // Exit early after setting activity log
        } catch (err) {
            console.error("Failed to fetch activity log", err)
        }
    }

    const timeAgo = (timestamp) => {
        if (!timestamp) return ''
        // Handle both unix timestamp (seconds) and ISO strings if client returns that
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



    const [hasFetched, setHasFetched] = useState(false)

    const handleFetchData = async () => {
        if (!userAddress) return
        setLoading(true)
        if (activeTab === 'active') {
            await fetchActiveBets()
        } else if (activeTab === 'closed') {
            await fetchClosedPositions()
        } else if (activeTab === 'activity') {
            await fetchActivityLog()
        }
        setLoading(false)
        setHasFetched(true)
    }

    // Reset fetch state on tab change, but don't auto-fetch
    useEffect(() => {
        setHasFetched(false)
        setActiveBets([])
        setClosedPositions([])
        setActivityLog([])
    }, [activeTab])

    // Auto-refresh effect - Only runs if manual fetch has happened
    useEffect(() => {
        if (!autoRefresh || !userAddress || !hasFetched) return

        const interval = setInterval(() => {
            // Use handleFetchData to keep state consistent, but manage loading state carefully if needed
            // For background refresh, we might not want to show full loading spinner, 
            // but for simplicity reusing the fetchers is fine as they handle state updates.
            if (activeTab === 'active') fetchActiveBets()
            else if (activeTab === 'closed') fetchClosedPositions()
            else if (activeTab === 'activity') fetchActivityLog()
            // Note: We don't call setHasFetched(true) here as it's already true
        }, 30000) // 30 seconds

        return () => clearInterval(interval)
    }, [autoRefresh, activeTab, userAddress, hasFetched])

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
                {!hasFetched && !loading ? (
                    <div className="fetch-prompt-container">
                        <button className="fetch-data-btn" onClick={handleFetchData}>
                            Load {activeTab === 'active' ? 'Active Bets' : activeTab === 'closed' ? 'Closed Positions' : 'Activity Log'}
                        </button>
                    </div>
                ) : loading ? (
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

                                            // Determine icon and color
                                            let icon = '📝'
                                            let actionText = type
                                            let actionClass = 'neutral'

                                            if (side === 'BUY') {
                                                icon = '➕'
                                                actionText = 'Bought'
                                                actionClass = 'bought'
                                            } else if (side === 'SELL') {
                                                icon = '➖'
                                                actionText = 'Sold'
                                                actionClass = 'sold'
                                            }
                                            if (type === 'REDEEM') {
                                                icon = '💰'
                                                actionText = 'Redeemed'
                                                actionClass = 'redeem'
                                            }

                                            return (
                                                <div key={activity.id || idx} className="activity-row">
                                                    <div className="col-activity">
                                                        <div className={`activity-icon-badge ${actionClass}`}>
                                                            {icon}
                                                        </div>
                                                        <span className="activity-action-text">{actionText}</span>
                                                    </div>

                                                    <div className="col-market">
                                                        {activity.market?.image && (
                                                            <img
                                                                src={activity.market.image}
                                                                alt=""
                                                                className="market-icon-small"
                                                                onError={(e) => e.target.style.display = 'none'}
                                                            />
                                                        )}
                                                        <div className="market-details">
                                                            <div className="market-question">{activity.market?.question || activity.title || 'Unknown Market'}</div>
                                                            <div className="outcome-details">
                                                                <span className={`outcome-text ${activity.outcome?.toLowerCase()}`}>
                                                                    {activity.outcome} {price > 0 && `${(price * 100).toFixed(0)}¢`}
                                                                </span>
                                                                <span className="separator">|</span>
                                                                <span className="share-count">{parseFloat(amount || 0).toFixed(1)} shares</span>
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

                {/* Auto-refresh Toggle */}
                {/* Auto-refresh Toggle - Only show after initial load */}
                {hasFetched && (
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
                )}
            </div>
        </div >
    )
}

export default PortfolioTabs
