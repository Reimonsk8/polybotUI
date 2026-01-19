import { useState, useEffect } from 'react'
import './PortfolioTabs.css'

const PortfolioTabs = ({ userAddress, client }) => {
    const [activeTab, setActiveTab] = useState('active') // 'active', 'closed', 'activity'
    const [activeBets, setActiveBets] = useState([])
    const [closedPositions, setClosedPositions] = useState([])
    const [activityLog, setActivityLog] = useState([])
    const [loading, setLoading] = useState(false)
    const [autoRefresh, setAutoRefresh] = useState(false)

    // Fetch Active Bets with enriched market data from Gamma API
    const fetchActiveBets = async () => {
        try {
            // First, get positions from Data API
            const response = await fetch(`https://data-api.polymarket.com/positions?user=${userAddress}`)
            if (response.ok) {
                const positions = await response.json()
                const activePositions = positions.filter(p => p.size > 0)

                // Enrich each position with market metadata from Gamma API
                const enrichedPositions = await Promise.all(
                    activePositions.map(async (position) => {
                        try {
                            // Fetch market details from Gamma API using condition ID
                            const marketRes = await fetch(`https://gamma-api.polymarket.com/markets/${position.conditionId}`)
                            if (marketRes.ok) {
                                const marketData = await marketRes.json()
                                return {
                                    ...position,
                                    marketData, // Add full market metadata
                                    icon: marketData.icon,
                                    description: marketData.description,
                                    category: marketData.category,
                                    endDate: marketData.endDate,
                                    volume: marketData.volume
                                }
                            }
                        } catch (err) {
                            // Silently fail for individual market data
                        }
                        return position // Return original if Gamma fetch fails
                    })
                )

                setActiveBets(enrichedPositions)
            }
        } catch (err) {
            // Silently fail
        }
    }

    // Fetch Closed Positions
    const fetchClosedPositions = async () => {
        try {
            const response = await fetch(`https://data-api.polymarket.com/v1/closed-positions?user=${userAddress}&limit=50`)
            if (response.ok) {
                const data = await response.json()
                setClosedPositions(data)
            }
        } catch (err) {
            // Silently fail
        }
    }

    // Fetch Activity Log
    const fetchActivityLog = async () => {
        try {
            const response = await fetch(`https://data-api.polymarket.com/activity?user=${userAddress}&limit=50&sortBy=TIMESTAMP&sortDirection=DESC`)
            if (response.ok) {
                const data = await response.json()
                setActivityLog(data)
            }
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
                                        {activityLog.map((activity, idx) => (
                                            <div key={idx} className="activity-item">
                                                <div className="activity-icon">
                                                    {activity.type === 'TRADE' && (activity.side === 'BUY' ? '📈' : '📉')}
                                                    {activity.type === 'REDEEM' && '💰'}
                                                    {activity.type === 'REWARD' && '🎁'}
                                                </div>
                                                <div className="activity-details">
                                                    <div className="activity-title">
                                                        <span className="activity-type">{activity.type}</span>
                                                        {activity.side && <span className={`activity-side ${activity.side.toLowerCase()}`}>{activity.side}</span>}
                                                    </div>
                                                    <div className="activity-market">{activity.title}</div>
                                                    <div className="activity-outcome">{activity.outcome}</div>
                                                </div>
                                                <div className="activity-meta">
                                                    <div className="activity-amount">
                                                        {activity.usdcSize && formatCurrency(activity.usdcSize)}
                                                    </div>
                                                    <div className="activity-time">
                                                        {formatDate(activity.timestamp)}
                                                    </div>
                                                </div>
                                            </div>
                                        ))}
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
        </div>
    )
}

export default PortfolioTabs
