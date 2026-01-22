import { useState, useEffect } from 'react'
import { ToastContainer } from 'react-toastify'
import 'react-toastify/dist/ReactToastify.css'
import './App.css'
import MarketChart from './components/Charts/MarketChart'
import MiniChart from './components/Charts/MiniChart'
import UserPortfolio from './UserPortfolio'
import FocusedMarketView from './components/FocusedMarketView'

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

  const fetchMarkets = async () => {
    setLoading(true)
    setError(null)

    try {
      // Use local proxy server (now running on port 3001)
      const API_URL = import.meta.env.VITE_PROXY_API_URL || 'http://localhost:3001'

      const response = await fetch(
        `${API_URL}/api/data?tag_id=102467&limit=100&_t=${Date.now()}`
      )

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`)
      }

      const data = await response.json()

      // Fetch live prices for each market from CLOB
      const marketsWithLivePrices = await Promise.all(
        data.map(async (event) => {
          const market = event.markets?.[0]
          if (!market) return event

          try {
            const tokenIds = JSON.parse(market.clobTokenIds || '[]')
            const originalPrices = JSON.parse(market.outcomePrices || '[]')
            const livePrices = []

            // Fetch live price for each outcome
            for (let i = 0; i < tokenIds.length; i++) {
              const tokenId = tokenIds[i]
              try {
                const priceResponse = await fetch(
                  `https://clob.polymarket.com/price?token_id=${tokenId}&side=buy`,
                  { signal: AbortSignal.timeout(5000) } // 5 second timeout
                )
                if (priceResponse.ok) {
                  const priceData = await priceResponse.json()
                  livePrices.push(priceData.price || originalPrices[i] || '0')
                } else {
                  // Use original price if CLOB fails (e.g., 404)
                  livePrices.push(originalPrices[i] || '0')
                }
              } catch (fetchErr) {
                // Use original price on timeout or network error
                livePrices.push(originalPrices[i] || '0')
              }
            }

            // Update market with live prices
            return {
              ...event,
              markets: [{
                ...market,
                outcomePrices: JSON.stringify(livePrices),
                livePrices: livePrices,
                lastUpdated: new Date().toISOString()
              }]
            }
          } catch (err) {
            return event
          }
        })
      )

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
  }, [autoRefresh, refreshInterval, markets.length])

  return (
    <div className="app">
      <ToastContainer position="bottom-right" theme="dark" />
      <div className="container">
        <UserPortfolio onStateChange={setUserState} />

        {/* Controls Section */}
        {markets.length > 0 && (
          <div className="controls">
            {/* Auto refresh controls... (keep existing) */}
            <div className="auto-refresh-controls">
              <label className="toggle-label">
                <input
                  type="checkbox"
                  checked={autoRefresh}
                  onChange={(e) => setAutoRefresh(e.target.checked)}
                  className="toggle-checkbox"
                />
                <span className="toggle-text">
                  🔄 Auto-refresh every {refreshInterval}s
                </span>
              </label>

              {autoRefresh && (
                <select
                  value={refreshInterval}
                  onChange={(e) => setRefreshInterval(Number(e.target.value))}
                  className="interval-select"
                >
                  <option value={10}>10 seconds</option>
                  <option value={30}>30 seconds</option>
                  <option value={60}>1 minute</option>
                </select>
              )}
            </div>

            {lastUpdate && (
              <p className="last-update">
                Last updated: <strong>{lastUpdate}</strong>
                {autoRefresh && <span className="live-indicator"> 🟢 LIVE</span>}
              </p>
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
        )}

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
            <h3>Load Market Data</h3>
            <p>Click below to fetch the latest Bitcoin markets from Polymarket.</p>
            <button className="load-markets-btn" onClick={fetchMarkets}>
              🚀 Load Markets
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
                <span className="market-count">{markets.length} active markets</span>
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
                    />
                  ) : null
                })()}
              </div>
            ) : (
              <div className="timeline-carousel">
                {markets
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
                            <h3 className="market-title-compact">{event.title}</h3>
                            <div className="market-meta">
                              <span className="meta-item">
                                🎯 {endTime.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                              </span>
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
                            <a
                              href={`https://polymarket.com/event/${event.slug}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="trade-link-compact"
                            >
                              Trade on Poly →
                            </a>
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
    </div>
  )
}

export default App
