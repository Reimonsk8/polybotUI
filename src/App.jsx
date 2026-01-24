import { useState, useEffect } from 'react'
import { ToastContainer } from 'react-toastify'
import 'react-toastify/dist/ReactToastify.css'
import './App.css'
import MarketChart from './components/Charts/MarketChart'
import MiniChart from './components/Charts/MiniChart'
import UserPortfolio from './UserPortfolio'
import FocusedMarketView from './components/FocusedMarketView'
import DebugPanel from './components/Debug/DebugPanel'

function App() {
  const [markets, setMarkets] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [lastUpdate, setLastUpdate] = useState(null)
  const [autoRefresh, setAutoRefresh] = useState(false)
  const [refreshInterval, setRefreshInterval] = useState(30) // seconds
  const [expandedMarketId, setExpandedMarketId] = useState(null) // For inline mini chart
  const [modalMarket, setModalMarket] = useState(null) // For full modal
  const [selectedEventId, setSelectedEventId] = useState(null) // Focus mode state

  const [userState, setUserState] = useState({ client: null, address: null, isConnected: false })
  const [selectedAsset, setSelectedAsset] = useState('Bitcoin') // Default asset filter
  const [selectedTimeframe, setSelectedTimeframe] = useState('15m') // Default timeframe

  const fetchMarkets = async () => {
    setLoading(true)
    setError(null)

    try {
      // Use local proxy server (now running on port 3001)
      const API_URL = import.meta.env.VITE_PROXY_API_URL || 'http://localhost:3001'

      const fetchUrl = `${API_URL}/api/data?limit=500&active=true&closed=false&_t=${Date.now()}&asset=${selectedAsset}&timeframe=${selectedTimeframe}`
      console.log(`[App] Fetching markets: ${selectedAsset} - ${selectedTimeframe}`, fetchUrl)

      const response = await fetch(fetchUrl)

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`)
      }

      const data = await response.json()
      console.log(`[App] Received ${data.length} markets`)

      // Fetch live prices for each market from CLOB
      // Use Gamma API data directly - Do not fetch /price from CLOB (it 404s)
      const marketsWithLivePrices = data

      setMarkets(marketsWithLivePrices)
      setLastUpdate(new Date().toLocaleTimeString())
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  const calculateProfit = (price) => {
    if (!price || price === 0) return { shares: 0, profit: 0 }
    const priceNum = parseFloat(price)
    if (priceNum === 0) return { shares: 0, profit: 0 }
    const shares = 1.0 / priceNum
    const profit = shares - 1.0
    return { shares, profit }
  }

  // Auto-refresh effect
  useEffect(() => {
    let intervalId
    if (autoRefresh && markets.length > 0) {
      intervalId = setInterval(() => {
        fetchMarkets()
      }, refreshInterval * 1000)
    }
    return () => {
      if (intervalId) clearInterval(intervalId)
    }
  }, [autoRefresh, refreshInterval, markets.length, selectedAsset, selectedTimeframe]) // Add dependencies

  // Fetch when filters change
  useEffect(() => {
    fetchMarkets()
  }, [selectedAsset, selectedTimeframe])

  return (
    <div className="app">
      <ToastContainer position="bottom-right" theme="dark" />
      <div className="container">
        <UserPortfolio onStateChange={setUserState} />

        {/* Controls Section */}
        {/* Controls Section - Always Visible */}
        <div className="controls" style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          background: 'linear-gradient(to right, #4c1d95, #312e81)', // Purple gradient
          padding: '12px 24px',
          borderRadius: '12px',
          border: '1px solid #6d28d9', // Lighter purple border
          marginBottom: '24px',
          flexWrap: 'wrap',
          gap: '16px',
          boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.3)'
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '24px' }}>
            {/* Asset Selector */}
            <div className="asset-selector" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span style={{ color: '#e9d5ff', fontSize: '0.9rem', fontWeight: '600' }}>Market:</span>
              <select
                value={selectedAsset}
                onChange={(e) => {
                  setSelectedAsset(e.target.value)
                  // Loading state will be handled by useEffect
                }}
                style={{
                  background: 'rgba(0, 0, 0, 0.4)',
                  color: 'white',
                  border: '1px solid #7c3aed',
                  padding: '6px 12px',
                  borderRadius: '6px',
                  fontWeight: 'bold',
                  cursor: 'pointer',
                  minWidth: '120px'
                }}
              >
                <option value="Bitcoin">Bitcoin</option>
                <option value="Ethereum">Ethereum</option>
                <option value="Solana">Solana</option>
                <option value="XRP">XRP</option>
              </select>
            </div>

            {/* Timeframe Selector (New) */}
            <div className="timeframe-selector" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span style={{ color: '#94a3b8', fontSize: '0.9rem', fontWeight: '600' }}>Time:</span>
              <select
                value={selectedTimeframe}
                onChange={(e) => {
                  setSelectedTimeframe(e.target.value)
                  // Loading state will be handled by useEffect
                }}
                style={{
                  background: '#0f172a',
                  color: 'white',
                  border: '1px solid #475569',
                  padding: '6px 12px',
                  borderRadius: '6px',
                  fontWeight: 'bold',
                  cursor: 'pointer',
                  minWidth: '80px'
                }}
              >
                <option value="15m">15 Min</option>
                <option value="1h">Hourly</option>
                <option value="4h">4 Hour</option>
                <option value="daily">Daily</option>
              </select>
            </div>

            {/* Divider */}
            <div style={{ width: '1px', height: '24px', background: '#334155' }}></div>

            {/* Auto refresh controls */}
            <div className="auto-refresh-controls" style={{ display: 'flex', alignItems: 'center', gap: '12px', margin: 0 }}>
              <label className="toggle-label" style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  checked={autoRefresh}
                  onChange={(e) => setAutoRefresh(e.target.checked)}
                  className="toggle-checkbox"
                  style={{ accentColor: '#3b82f6', width: '16px', height: '16px' }}
                />
                <span className="toggle-text" style={{ fontSize: '0.9rem', color: '#e2e8f0' }}>
                  Auto-refresh
                </span>
              </label>

              {autoRefresh && (
                <select
                  value={refreshInterval}
                  onChange={(e) => setRefreshInterval(Number(e.target.value))}
                  className="interval-select"
                  style={{
                    padding: '4px 8px',
                    borderRadius: '4px',
                    background: '#0f172a',
                    color: '#cbd5e1',
                    border: '1px solid #334155',
                    fontSize: '0.85rem'
                  }}
                >
                  <option value={10}>10s</option>
                  <option value={30}>30s</option>
                  <option value={60}>1m</option>
                </select>
              )}
            </div>
          </div>

          {/* Status */}
          {lastUpdate && (
            <div className="last-update" style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '0.85rem', color: '#64748b' }}>
              <span>Last updated: <strong style={{ color: '#94a3b8' }}>{lastUpdate}</strong></span>
              {autoRefresh && (
                <span className="live-indicator" style={{
                  color: '#10b981',
                  background: 'rgba(16, 185, 129, 0.1)',
                  padding: '2px 8px',
                  borderRadius: '4px',
                  fontSize: '0.75rem',
                  fontWeight: 'bold',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '4px'
                }}>
                  <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: '#10b981', display: 'inline-block', animation: 'pulse 2s infinite' }}></span>
                  LIVE
                </span>
              )}
            </div>
          )}

          {/* Back Button for Focus Mode */}
          {selectedEventId && (
            <button
              onClick={() => setSelectedEventId(null)}
              style={{
                background: 'var(--bg-card)',
                border: '1px solid var(--border)',
                color: 'var(--text-primary)',
                padding: '0.5rem 1.5rem',
                borderRadius: '8px',
                cursor: 'pointer',
                marginTop: '1rem',
                fontWeight: '600'
              }}
            >
              ← Back to Markets
            </button>
          )}
        </div>

        {/* Error and Empty States... (keep existing) */}
        {error && (
          <div className="error-card">
            <span className="error-icon">⚠️</span>
            <p>Error: {error}</p>
            <button className="retry-btn" onClick={fetchMarkets}>Retry Connection</button>
          </div>
        )}

        {markets.length === 0 && !loading && !error && (
          <div className="empty-state">
            <div className="empty-icon">📊</div>
            <h3>No Markets Found</h3>
            <p>No active markets found for <strong>{selectedAsset}</strong> ({selectedTimeframe})</p>
            <p>Try switching the Asset or Timeframe above.</p>
            <button className="load-markets-btn" onClick={fetchMarkets}>
              ↻ Refresh
            </button>
          </div>
        )}

        {/* Markets Display - Swaps between Carousel and Focus View */}
        {markets.length > 0 && (
          <div className="timeline-container">
            {!selectedEventId && (
              <h2 className="timeline-header">
                <span className="timeline-icon">⏰</span>
                Market Timeline
                <span className="market-count">{markets.filter(e => new Date(e.endDate) > new Date()).length} active markets</span>
              </h2>
            )}

            {selectedEventId ? (
              <div style={{ width: '100%', display: 'flex', justifyContent: 'center', padding: '2rem 0' }}>
                {(() => {
                  const event = markets.find(e => String(e.id) === String(selectedEventId))
                  return event ? (
                    <FocusedMarketView
                      event={event}
                      client={userState.client}
                      userAddress={userState.address}
                      positions={userState.positions}
                      privateKey={userState.privateKey}
                      builderCreds={userState.builderCreds}
                    />
                  ) : null
                })()}
              </div>
            ) : (
              <div className="timeline-carousel">
                {markets
                  .filter(event => new Date(event.endDate) > new Date()) // Hide closed markets
                  .sort((a, b) => new Date(a.endDate) - new Date(b.endDate))
                  .map((event, index) => {
                    const market = event.markets?.[0]
                    if (!market) return null

                    const outcomes = JSON.parse(market.outcomes || '[]')
                    const prices = JSON.parse(market.outcomePrices || '[]')
                    const endTime = new Date(event.endDate)
                    const now = new Date()
                    const timeUntilEnd = Math.max(0, endTime - now)
                    const minutesUntilEnd = Math.floor(timeUntilEnd / 60000)
                    const isClosingSoon = minutesUntilEnd < 5

                    return (
                      <div key={event.id} className="timeline-card">
                        <div className={`timeline-indicator ${isClosingSoon ? 'closing-soon' : ''}`}>
                          <div className="time-badge">
                            {minutesUntilEnd < 1 ? (
                              <span className="closing-now">CLOSING NOW!</span>
                            ) : minutesUntilEnd < 60 ? (
                              <span>{minutesUntilEnd}m</span>
                            ) : (
                              <span>{Math.floor(minutesUntilEnd / 60)}h {minutesUntilEnd % 60}m</span>
                            )}
                          </div>
                          <div className="timeline-dot"></div>
                          <div className="timeline-line"></div>
                        </div>

                        <div className="market-card-timeline">
                          <div className="market-header">
                            <a
                              href={`https://polymarket.com/event/${event.slug}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              style={{ textDecoration: 'none', color: 'inherit', flex: 1 }}
                            >
                              <h3 className="market-title-compact">{event.title}</h3>
                            </a>
                            <div className="market-meta">
                              <span className="meta-item">
                                🎯 {endTime.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                              </span>
                            </div>
                          </div>

                          <div className="outcomes-compact">
                            {outcomes.map((outcome, idx) => {
                              const price = parseFloat(prices[idx] || 0)
                              const probability = price * 100
                              const { profit } = calculateProfit(price)

                              return (
                                <div
                                  key={idx}
                                  className={`outcome-card-compact ${outcome.toLowerCase()}`}
                                >
                                  <div className="outcome-header-compact">
                                    <span className="outcome-icon">
                                      {outcome === 'Up' ? '📈' : '📉'}
                                    </span>
                                    <h4 className="outcome-name-compact">{outcome.toUpperCase()}</h4>
                                    <span className="probability-compact">{probability.toFixed(1)}%</span>
                                  </div>

                                  <div className="outcome-stats">
                                    <div className="stat-compact">
                                      <span className="stat-label-compact">Price</span>
                                      <span className="stat-value-compact">${price.toFixed(3)}</span>
                                    </div>
                                    <div className="stat-compact highlight-stat">
                                      <span className="stat-label-compact">$1 → Profit</span>
                                      <span className="profit-value-compact">${profit.toFixed(2)}</span>
                                    </div>
                                  </div>
                                </div>
                              )
                            })}
                          </div>

                          {/* Mini Chart if Expanded */}
                          {expandedMarketId === market.id && (
                            <MiniChart
                              market={market}
                              onClick={() => setModalMarket(market)}
                            />
                          )}

                          <div className="market-footer">
                            <div className="volume-indicator">
                              <span className="volume-label">Vol:</span>
                              <span className="volume-value">
                                ${(market.volumeNum || 0).toLocaleString(undefined, {
                                  maximumFractionDigits: 0
                                })}
                              </span>
                            </div>
                            <button
                              className="chart-toggle-btn"
                              onClick={(e) => {
                                e.stopPropagation()
                                setSelectedEventId(String(event.id))
                              }}
                              style={{ background: 'var(--accent-primary)' }}
                            >
                              👉 Select Trade
                            </button>
                          </div>
                        </div>
                      </div>
                    )
                  })}
              </div>
            )}

            {!selectedEventId && (
              <div className="scroll-hint">
                ← Scroll to see more markets →
              </div>
            )}
          </div>
        )}
      </div>

      {/* Market Chart Modal */}
      {modalMarket && (
        <MarketChart
          market={modalMarket}
          onClose={() => setModalMarket(null)}
        />
      )}
      <DebugPanel />
    </div>
  )
}

export default App
