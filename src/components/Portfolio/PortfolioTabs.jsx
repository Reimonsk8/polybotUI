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
    const [hasFetched, setHasFetched] = useState(false)

    // AUTO-SELL STATE
    const [autoSellEnabled, setAutoSellEnabled] = useState(false)
    const [takeProfitPercent, setTakeProfitPercent] = useState(25)
    const [stopLossPercent, setStopLossPercent] = useState(50)
    const [triggeredOrders, setTriggeredOrders] = useState(new Set()) // Track executed sells to prevent loops

    // Fetch Active Bets using Data API /positions endpoint
    const fetchActiveBets = async () => {
        try {
            if (!userAddress) return

            const proxyUrl = import.meta.env.VITE_PROXY_API_URL || 'http://localhost:3001'
            const useProxy = import.meta.env.VITE_USE_PROXY !== 'false'

            const params = new URLSearchParams({
                user: userAddress,
                sizeThreshold: '1', // Filter dust
                limit: '100',
                sortBy: 'TOKENS',
                sortDirection: 'DESC'
            })

            const positionsUrl = useProxy
                ? `${proxyUrl}/api/data-api/positions?${params.toString()}`
                : `https://data-api.polymarket.com/positions?${params.toString()}`

            const response = await fetch(positionsUrl)
            if (!response.ok) {
                setActiveBets([])
                return
            }

            const positions = await response.json()

            if (Array.isArray(positions) && positions.length > 0) {
                const mappedPositions = positions.map(pos => ({
                    ...pos,
                    market: pos.conditionId,
                    conditionId: pos.conditionId,
                    asset: pos.asset, // Important for trading
                    marketData: {
                        question: pos.title,
                        icon: pos.icon,
                        slug: pos.slug,
                        endDate: pos.endDate
                    },
                    image: pos.icon,
                    curPrice: Number(pos.curPrice),
                    avgPrice: Number(pos.avgPrice),
                    pnl: Number(pos.cashPnl),
                    percentPnl: Number(pos.percentPnl), // API Pnl usually reliable
                    size: Number(pos.size)
                }))

                setActiveBets(mappedPositions)
                return mappedPositions // Return for chaining
            } else {
                setActiveBets([])
                return []
            }

        } catch (err) {
            console.error('[Active Bets] Failed to fetch:', err)
            setActiveBets([])
            return []
        }
    }

    // AUTO-SELL LOGIC
    // Check positions whenever activeBets updates
    useEffect(() => {
        if (!autoSellEnabled || !client || activeBets.length === 0) return

        const checkAndSell = async () => {
            for (const bet of activeBets) {
                // Skip if already triggered or invalid
                if (triggeredOrders.has(bet.conditionId)) continue
                if (!bet.asset || bet.size <= 0) continue

                // Calculate PnL locally to be sure (API PnL can be stale or calculated differently)
                // (Current - Avg) / Avg
                // Avoid division by zero
                if (bet.avgPrice <= 0) continue

                const priceChange = (bet.curPrice - bet.avgPrice)
                const currentPnlPercent = (priceChange / bet.avgPrice) * 100

                let shouldSell = false
                let reason = ''

                // Take Profit Logic
                if (currentPnlPercent >= takeProfitPercent) {
                    shouldSell = true
                    reason = `Take Profit hit: +${currentPnlPercent.toFixed(1)}% (Threshold: ${takeProfitPercent}%)`
                }

                // Stop Loss Logic (Loss is negative PnL)
                // If PnL is -51% and Limit is 50%, we sell
                else if (currentPnlPercent <= -stopLossPercent) {
                    shouldSell = true
                    reason = `Stop Loss hit: ${currentPnlPercent.toFixed(1)}% (Threshold: -${stopLossPercent}%)`
                }

                if (shouldSell) {
                    console.log(`[Auto Sell] TRIGGERING SELL for ${bet.title}: ${reason}`)

                    // Prevent double-fire immediately
                    setTriggeredOrders(prev => new Set(prev).add(bet.conditionId))

                    try {
                        // Execute Market Sell (Limit 0)
                        // Note: Depending on Client setup, we might need to derive signer
                        // But client passed from UserPortfolio should be ready

                        // We use a safe low price to act as "Market Sell" (e.g. 0.05 or lower?)
                        // Polymarket usually matches best bid. 0 may be rejected. 0.01 is returned as minimum tick often.
                        // Let's us 0.0 if library allows, or 0.001

                        if (!client.signer) {
                            console.warn("Cannot sell: Read-only client")
                            continue
                        }

                        // We need the Token ID (asset_id)
                        const order = await client.createOrder({
                            tokenID: bet.asset,
                            price: 0.005, // Basically Market Sell
                            side: 'SELL',
                            size: bet.size,
                            feeRateBps: 1000,
                            nonce: Date.now()
                        })

                        console.log('[Auto Sell] Order Placed:', order)
                        // We could show a notification here
                        alert(`Auto-Sold ${bet.title}\nReason: ${reason}`)

                    } catch (err) {
                        console.error('[Auto Sell] Order Failed:', err)
                        // Allow retry?
                        setTriggeredOrders(prev => {
                            const newSet = new Set(prev)
                            newSet.delete(bet.conditionId) // Remove from blocklist so we retry next tick
                            return newSet
                        })
                    }
                }
            }
        }

        checkAndSell()

    }, [activeBets, autoSellEnabled, takeProfitPercent, stopLossPercent, client])


    // Fetch Closed Positions using L2 authenticated trades
    const fetchClosedPositions = async () => {
        try {
            if (!client) return
            const trades = await client.getTrades({ limit: 200 })
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

            const closedPositions = Array.from(positionMap.values())
                .filter(p => Math.abs(p.size) < 0.001 && p.trades.length > 0)

            setClosedPositions(closedPositions)
        } catch (err) { }
    }

    const fetchActivityLog = async () => {
        try {
            const proxyUrl = import.meta.env.VITE_PROXY_API_URL || 'http://localhost:3001'
            const useProxy = import.meta.env.VITE_USE_PROXY !== 'false'
            const data = await fetchActivityData(userAddress, client, proxyUrl, useProxy)
            setActivityLog(data)
        } catch (err) { console.error("Failed to fetch activity log", err) }
    }

    const timeAgo = (timestamp) => {
        if (!timestamp) return ''
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

    const handleFetchData = async () => {
        if (!userAddress) return
        setLoading(true)
        if (activeTab === 'active') await fetchActiveBets()
        else if (activeTab === 'closed') await fetchClosedPositions()
        else if (activeTab === 'activity') await fetchActivityLog()
        setLoading(false)
        setHasFetched(true)
    }

    useEffect(() => {
        setActiveBets([])
        setClosedPositions([])
        setActivityLog([])
        if (userAddress) handleFetchData()
    }, [activeTab, userAddress])

    // Auto-refresh loop
    useEffect(() => {
        if (!autoRefresh && !autoSellEnabled) return
        if (!userAddress) return

        // Speed up refresh if Auto-Sell is Enabled (10s), otherwise 30s
        const intervalTime = autoSellEnabled ? 10000 : 30000

        const interval = setInterval(() => {
            if (activeTab === 'active') fetchActiveBets()
            else if (activeTab === 'closed') fetchClosedPositions()
            else if (activeTab === 'activity') fetchActivityLog()
        }, intervalTime)

        return () => clearInterval(interval)
    }, [autoRefresh, autoSellEnabled, activeTab, userAddress])

    const formatCurrency = (value) => `$${parseFloat(value).toFixed(2)}`

    return (
        <div className="portfolio-tabs">
            {/* Tab Headers */}
            <div className="tab-headers">
                <button className={`tab-header ${activeTab === 'active' ? 'active' : ''}`} onClick={() => setActiveTab('active')}>Active Bets</button>
                <button className={`tab-header ${activeTab === 'closed' ? 'active' : ''}`} onClick={() => setActiveTab('closed')}>Closed Positions</button>
                <button className={`tab-header ${activeTab === 'activity' ? 'active' : ''}`} onClick={() => setActiveTab('activity')}>Activity Log</button>
            </div>

            {/* Tab Content */}
            <div className="tab-content">
                {/* Auto-Sell Manager UI - Only Active Tab */}
                {activeTab === 'active' && userAddress && (
                    <div className="auto-sell-dashboard" style={{
                        background: 'rgba(15, 23, 42, 0.6)',
                        border: '1px solid #334155',
                        borderRadius: '12px',
                        padding: '16px',
                        marginBottom: '20px',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: '12px'
                    }}>
                        <div className="auto-sell-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                <span style={{ fontSize: '1.2rem' }}>🤖</span>
                                <h3 style={{ margin: 0, fontSize: '1rem', color: '#e2e8f0' }}>Auto-Sell Bot</h3>
                            </div>
                            <label className="switch" style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer' }}>
                                <span style={{ fontSize: '0.9rem', color: autoSellEnabled ? '#10b981' : '#94a3b8' }}>
                                    {autoSellEnabled ? 'ENABLED' : 'DISABLED'}
                                </span>
                                <input
                                    type="checkbox"
                                    checked={autoSellEnabled}
                                    onChange={(e) => {
                                        if (!client && e.target.checked) {
                                            alert("Login (L2) required for Auto-Sell")
                                            return
                                        }
                                        setAutoSellEnabled(e.target.checked)
                                        if (e.target.checked) setAutoRefresh(true) // Force auto-refresh on
                                    }}
                                    style={{ accentColor: '#10b981' }}
                                />
                            </label>
                        </div>

                        {/* Controls */}
                        <div className="auto-sell-controls" style={{
                            display: 'grid',
                            gridTemplateColumns: '1fr 1fr',
                            gap: '24px',
                            opacity: autoSellEnabled ? 1 : 0.5,
                            pointerEvents: autoSellEnabled ? 'auto' : 'none',
                            transition: 'opacity 0.2s'
                        }}>
                            {/* Take Profit */}
                            <div className="control-group">
                                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '6px' }}>
                                    <span style={{ color: '#10b981', fontWeight: '600', fontSize: '0.9rem' }}>Take Profit</span>
                                    <span style={{ color: '#10b981', fontWeight: '700' }}>{takeProfitPercent}%</span>
                                </div>
                                <input
                                    type="range"
                                    min="1" max="200" step="1"
                                    value={takeProfitPercent}
                                    onChange={(e) => setTakeProfitPercent(Number(e.target.value))}
                                    style={{ width: '100%', accentColor: '#10b981' }}
                                />
                                <div style={{ fontSize: '0.75rem', color: '#94a3b8', marginTop: '4px' }}>
                                    Sell if profit {'>'} {takeProfitPercent}%
                                </div>
                            </div>

                            {/* Stop Loss */}
                            <div className="control-group">
                                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '6px' }}>
                                    <span style={{ color: '#ef4444', fontWeight: '600', fontSize: '0.9rem' }}>Stop Loss</span>
                                    <span style={{ color: '#ef4444', fontWeight: '700' }}>-{stopLossPercent}%</span>
                                </div>
                                <input
                                    type="range"
                                    min="1" max="99" step="1"
                                    value={stopLossPercent}
                                    onChange={(e) => setStopLossPercent(Number(e.target.value))}
                                    style={{ width: '100%', accentColor: '#ef4444' }}
                                />
                                <div style={{ fontSize: '0.75rem', color: '#94a3b8', marginTop: '4px' }}>
                                    Sell if loss {'>'} {stopLossPercent}%
                                </div>
                            </div>
                        </div>
                    </div>
                )}

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
                                                        <span className="stat-label">Entry</span>
                                                        <span className="stat-value">{formatCurrency(bet.avgPrice)}</span>
                                                    </div>
                                                    <div className="stat">
                                                        <span className="stat-label">Price</span>
                                                        <span className="stat-value" style={{ color: '#f59e0b' }}>{formatCurrency(bet.curPrice)}</span>
                                                    </div>
                                                    <div className="stat">
                                                        <span className="stat-label">P&L</span>
                                                        <span className={`stat-value ${bet.percentPnl >= 0 ? 'positive' : 'negative'}`}>
                                                            {bet.percentPnl >= 0 ? '+' : ''}{(bet.percentPnl * 100).toFixed(1)}%
                                                        </span>
                                                    </div>
                                                </div>
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

                                            let icon = '📝'
                                            let actionText = type
                                            let actionClass = 'neutral'

                                            if (side === 'BUY') { icon = '➕'; actionText = 'Bought'; actionClass = 'bought' }
                                            else if (side === 'SELL') { icon = '➖'; actionText = 'Sold'; actionClass = 'sold' }
                                            if (type === 'REDEEM') { icon = '💰'; actionText = 'Redeemed'; actionClass = 'redeem' }

                                            return (
                                                <div key={activity.id || idx} className="activity-row">
                                                    <div className="col-activity">
                                                        <div className={`activity-icon-badge ${actionClass}`}>{icon}</div>
                                                        <span className="activity-action-text">{actionText}</span>
                                                    </div>
                                                    <div className="col-market">
                                                        {activity.market?.image && <img src={activity.market.image} alt="" className="market-icon-small" onError={(e) => e.target.style.display = 'none'} />}
                                                        <div className="market-details">
                                                            <div className="market-question">{activity.market?.question || activity.title || 'Unknown Market'}</div>
                                                            <div className="outcome-details">
                                                                <span className={`outcome-text ${activity.outcome?.toLowerCase()}`}>{activity.outcome}</span>
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

                {/* Auto-refresh Toggle - Footer */}
                <div className="auto-refresh-toggle">
                    <label>
                        <input
                            type="checkbox"
                            checked={autoRefresh}
                            onChange={(e) => setAutoRefresh(e.target.checked)}
                        />
                        <span className="refresh-icon">🔄</span>
                        Auto-refresh every {autoSellEnabled ? '10' : '30'}s
                    </label>
                </div>
            </div>
        </div>
    )
}

export default PortfolioTabs
