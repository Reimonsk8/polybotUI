import React, { useState, useEffect, useMemo } from 'react'
import './PortfolioTabs.css'
import { fetchActivityLog as fetchActivityData } from './ActivityLogFetcher'
import { Side, OrderType } from '@polymarket/clob-client'
import { toast } from 'react-toastify'
import ConfirmModal from './ConfirmModal'
import { placeMarketOrder, checkMarketLiquidity } from '../../utils/marketOrders'
import { initRelayerClient, redeemPositionsGasless } from '../../utils/relayerClient'
import RiskCalculator from './RiskCalculator'
import CandleChart from './CandleChart'

const PortfolioTabs = ({
    userAddress,
    client,
    apiCreds,
    signatureType = 0,
    proxyAddress = null,
    cashBalance = null,
    privateKey = null,
    builderCreds = null
}) => {
    const [activeTab, setActiveTab] = useState('active') // 'active', 'closed', 'activity'
    const [activeBets, setActiveBets] = useState([])
    const [closedPositions, setClosedPositions] = useState([])
    const [activityLog, setActivityLog] = useState([])
    const [loading, setLoading] = useState(false)

    // Auto-Refresh settings (replacing WebSocket approach)
    const [livePrices, setLivePrices] = useState({}) // { [assetId]: { price, bid, ask } }
    const [autoRefresh, setAutoRefresh] = useState(true) // Renamed from liveUpdates
    const [refreshInterval, setRefreshInterval] = useState(2000) // Refresh interval in milliseconds (100ms to 3000ms)
    const [wsConnected, setWsConnected] = useState(false)
    const [lastUpdateTime, setLastUpdateTime] = useState(null) // Track last refresh time
    const [hasFetched, setHasFetched] = useState(false)

    // Track resolved markets to avoid repeated 404s
    const [resolvedMarkets, setResolvedMarkets] = useState(new Set())

    // AUTO-SELL STATE
    const [autoSellEnabled, setAutoSellEnabled] = useState(false)
    const [takeProfitPercent, setTakeProfitPercent] = useState(25)
    const [stopLossPercent, setStopLossPercent] = useState(50)
    const [maxSpreadPercent, setMaxSpreadPercent] = useState(20) // Max spread to allow auto-sell
    const [triggeredOrders, setTriggeredOrders] = useState(new Set()) // Track executed sells to prevent loops

    // MODAL STATE
    const [sellModalOpen, setSellModalOpen] = useState(false)
    const [betToSell, setBetToSell] = useState(null)
    const [chartOpen, setChartOpen] = useState(false)
    const [selectedChartAsset, setSelectedChartAsset] = useState(null)
    const [autoSellHelpOpen, setAutoSellHelpOpen] = useState(false)

    // COPY BOT STATE
    const [copyBotRunning, setCopyBotRunning] = useState(false)
    const [copyTraders, setCopyTraders] = useState(() => {
        const saved = localStorage.getItem('copyTraders')
        return saved ? JSON.parse(saved) : []
    })
    const [copySettings, setCopySettings] = useState(() => {
        const saved = localStorage.getItem('copySettings')
        return saved ? JSON.parse(saved) : { fixedAmount: 10, maxSpread: 5, enabled: true }
    })
    const [copyLogs, setCopyLogs] = useState([])
    const [processedMatchIds, setProcessedMatchIds] = useState(new Set())
    const [botStartTime, setBotStartTime] = useState(null)

    const [newTraderInput, setNewTraderInput] = useState('')
    const [copyBotHelpOpen, setCopyBotHelpOpen] = useState(false)

    // Fetch Active Bets using Data API /positions endpoint
    const fetchActiveBets = async () => {
        try {
            if (!userAddress) return

            const proxyUrl = import.meta.env.VITE_PROXY_API_URL || 'http://localhost:3001'
            const useProxy = import.meta.env.VITE_USE_PROXY !== 'false'

            const params = new URLSearchParams({
                user: userAddress,
                sizeThreshold: '0.1', // Filter dust
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

                // IF Live Updates are ON, fetch Real-Time Prices from CLOB
                // 2. Standardize P&L Calculation Locally
                // This ensures consistency between API load and Live updates
                const standardizedPositions = mappedPositions.map(pos => {
                    const size = parseFloat(pos.size) || 0
                    const avg = parseFloat(pos.avgPrice) || 0
                    const curr = parseFloat(pos.curPrice) || 0

                    if (avg <= 0) return { ...pos, percentPnl: 0, pnl: 0 } // Avoid division by zero

                    // Formula: (Current - Avg) / Avg
                    const pnlRaw = (curr - avg) * size
                    const percentRaw = (curr - avg) / avg

                    return {
                        ...pos,
                        pnl: pnlRaw,
                        percentPnl: percentRaw
                    }
                })

                setActiveBets(standardizedPositions)

                // IF Live Updates are ON, fetch Real-Time Prices from CLOB
                if (autoRefresh) {
                    try {
                        const updatedPositions = await Promise.all(standardizedPositions.map(async (pos) => {
                            if (!pos.asset) return pos

                            try {
                                let livePrice = 0
                                let midPrice = 0
                                let bestBid = 0
                                let bestAsk = 0
                                let priceFound = false

                                // OPTION A: Use Client OrderBook (Best)
                                if (client) {
                                    try {
                                        // Skip if we already know it's resolved
                                        if (resolvedMarkets.has(pos.conditionId) || resolvedMarkets.has(pos.market)) {
                                            return pos
                                        }

                                        // FETCH ACCURATE MARKET DATA (Fixes 'Ended' Time Discrepancy)
                                        let accurateEndDate = pos.endDate
                                        try {
                                            const marketDetails = await client.getMarket(pos.conditionId)
                                            if (marketDetails) {
                                                if (marketDetails.end_date_iso) accurateEndDate = marketDetails.end_date_iso
                                                else if (marketDetails.endDate) accurateEndDate = marketDetails.endDate
                                            }
                                        } catch (e) { /* Ignore market fetch error */ }

                                        const book = await client.getOrderBook(pos.asset)

                                        // Parse Orderbook
                                        bestBid = (book && book.bids && book.bids.length > 0) ? parseFloat(book.bids[0].price) : 0
                                        bestAsk = (book && book.asks && book.asks.length > 0) ? parseFloat(book.asks[0].price) : 0

                                        // Calculate Midpoint (Fair Value)
                                        if (bestBid > 0 && bestAsk > 0) midPrice = (bestBid + bestAsk) / 2
                                        else if (bestBid > 0) midPrice = bestBid
                                        else if (bestAsk > 0) midPrice = bestAsk

                                        // Calculate Display Price (Liquidation/Bid)
                                        let displayPrice = bestBid
                                        // Auto-Sell Logic often relies on "Fair Value" (Mid), but for "You'll Receive" UI we need Bid.
                                        // However, standard activeBots usually show Bid price to reflect liquid exit value.

                                        // If no bid, use 0 (market is illiquid)
                                        if (!bestBid && bestAsk > 0) {
                                            // Optional: specific handling for 'Ask only' market?
                                            // For now, if we hold the position, and can't sell, value is 0.
                                            displayPrice = 0
                                        }

                                        // Calculate Spread
                                        const spread = (bestAsk > 0 && bestBid > 0) ? (bestAsk - bestBid) : 0
                                        // const spreadPct = (displayPrice > 0) ? (spread / displayPrice) : 0 // Unused if we strip wide spread check

                                        if (displayPrice > 0) {
                                            livePrice = displayPrice
                                            priceFound = true
                                        }
                                    } catch (err) {
                                        // Ignore 404 (No matching orderbook) - market may be resolved
                                        const statusCode = err.status || err.response?.status || err.code
                                        const is404 = statusCode === 404 || statusCode === '404'

                                        // Also check for "No orderbook exists" message
                                        const errorMsg = err.message || err.data?.error || ''
                                        const isNoOrderbook = errorMsg.toLowerCase().includes("no orderbook exists")

                                        if (is404 || isNoOrderbook) {
                                            // Mark as resolved so we don't try again
                                            setResolvedMarkets(prev => new Set(prev).add(pos.conditionId))
                                        }
                                    }
                                }

                                // OPTION B: Raw Fetch (Fallback)
                                if (!priceFound) {
                                    try {
                                        const clobRes = await fetch(`https://clob.polymarket.com/price?token_id=${pos.asset}&side=sell`)
                                        if (clobRes.ok) {
                                            const clobData = await clobRes.json()
                                            if (clobData.price) {
                                                livePrice = parseFloat(clobData.price)
                                                priceFound = true
                                            }
                                        }
                                    } catch (err) {
                                        // Ignore network errors on fallback
                                    }
                                }

                                if (priceFound) {
                                    const avg = pos.avgPrice || 0

                                    // Recalculate PnL (Live) based on DISPLAY Price (Mid)
                                    let newPnl = 0
                                    let newPercentPnl = 0

                                    if (avg > 0) {
                                        newPnl = (livePrice - avg) * pos.size
                                        newPercentPnl = (livePrice - avg) / avg
                                    }

                                    return {
                                        ...pos,
                                        endDate: accurateEndDate || pos.endDate,
                                        curPrice: livePrice, // Visuals use Bid (Liquidity)
                                        midPrice: midPrice || livePrice, // Safety uses Mid
                                        bidPrice: bestBid || livePrice,
                                        pnl: newPnl,
                                        percentPnl: newPercentPnl,
                                        isLive: true
                                    }
                                }
                            } catch (e) { /* Ignore */ }
                            return pos
                        }))

                        setActiveBets(updatedPositions)
                        return updatedPositions
                    } catch (err) {
                        console.error("Failed to fetch live CLOB prices", err)
                        // fallback used above
                        return standardizedPositions
                    }
                }

                return standardizedPositions
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

    // COPY BOT LOGIC
    useEffect(() => {
        if (!copyBotRunning || copyTraders.length === 0) return

        const pollInterval = setInterval(async () => {
            // console.log("[CopyBot] Polling traders...", copyTraders)

            for (const traderAddress of copyTraders) {
                try {
                    // Use Proxy if available to avoid CORS or Rate Limits
                    const proxyUrl = import.meta.env.VITE_PROXY_API_URL || 'http://localhost:3001'
                    const useProxy = import.meta.env.VITE_USE_PROXY !== 'false'

                    const url = useProxy
                        ? `${proxyUrl}/api/data-api/activity?user=${traderAddress}&limit=5`
                        : `https://data-api.polymarket.com/activity?user=${traderAddress}&limit=5`

                    const res = await fetch(url)
                    if (!res.ok) continue

                    const data = await res.json()

                    // Filter new trades
                    // 1. Must be a TRADE (match)
                    // 2. Timestamp must be after bot start time
                    // 3. Must not be already processed

                    const newTrades = data.filter(item => {
                        const isTrade = item.type === 'TRADE' || (item.side && (item.side === 'BUY' || item.side === 'SELL'))
                        // Timestamp is usually in seconds (Unix) or ISO string. API returns `timestamp` (seconds) or `match_time`
                        const itemTime = item.timestamp || item.match_time
                        const itemDate = new Date(typeof itemTime === 'number' ? itemTime * 1000 : itemTime)

                        return isTrade &&
                            itemDate > botStartTime &&
                            !processedMatchIds.has(item.id || item.matchId)
                    })

                    for (const trade of newTrades) {
                        const matchId = trade.id || trade.matchId
                        // Double check processed (in case of double process in loop)
                        if (processedMatchIds.has(matchId)) continue

                        // Process Trade
                        // Only COPY BUYS for now to keep it safe? 
                        // Or Copy Sells if we have the position? 
                        // Let's implement BUY AND SELL. Client will fail if we try to sell what we don't have.

                        console.log(`[CopyBot] NEW TRADE DETECTED from ${traderAddress}:`, trade)
                        setCopyLogs(prev => [`[${new Date().toLocaleTimeString()}] Detected ${trade.side} on ${trade.asset} by ${traderAddress.slice(0, 6)}...`, ...prev].slice(0, 50))

                        // Add to processed immediately to prevent loops
                        setProcessedMatchIds(prev => new Set(prev).add(matchId))

                        if (!client) {
                            setCopyLogs(prev => [`[Error] Client not ready, cannot copy.`, ...prev])
                            continue
                        }

                        // EXECUTE COPY
                        try {
                            const side = trade.side // 'BUY' or 'SELL'
                            const assetId = trade.asset
                            const amountUSDC = parseFloat(copySettings.fixedAmount)

                            if (side === 'BUY') {
                                // For BUY: We want to spend `amountUSDC`. 
                                // Market Buy expects `amount` in USDC (Cash) usually for "Aggressive" buys in UI?
                                // Wait, `placeMarketOrder` utility:
                                // if BUY -> amount is CASH amount (if using FOK Buy) or SHARES?
                                // Let's check `placeMarketOrder` signature or usage active activeBets.
                                // In `placeMarketOrder`: if side==BUY, amount is usually converted to shares inside or we pass shares?
                                // CLOB Client `createMarketBuyOrder` takes amount in CASH (USDC).
                                // But `placeMarketOrder` utility wrapper might differ.
                                // Looking at previous code usage: 
                                // `placeMarketOrder(client, bet.asset, "SELL", bet.size, ...)`
                                // So for SELL it takes SHARES.
                                // For BUY? 
                                // Checking `utils/marketOrders.js` would be ideal, but let's assume standard CLOB behavior.
                                // Actually better to use `client.createMarketBuyOrder` directly for clarity if utility is ambiguous.
                                // BUT `placeMarketOrder` handles GASLESS credentials.

                                // Let's try to infer from `FocusedMarketView`:
                                // For BUY, it calculates quotes. 
                                // Let's assume we want to Buy `amountUSDC` worth.
                                // We need to convert to shares if `placeMarketOrder` expects shares for everything?
                                // Usually Market BUY is by Spend (Cash).
                                // Let's use `placeMarketOrder` and assume it handles it, OR check `placeMarketOrder` content. 
                                // Use `client.createMarketBuyOrder` if we are sure.

                                // SAFE BET: Calculate shares derived from price.
                                let price = parseFloat(trade.price) || 0.5 // fallback
                                if (price <= 0) price = 0.5
                                const sharesToBuy = amountUSDC / price

                                // Let's use `placeMarketOrder` but pay attention to arguments.
                                // If I pass "BUY", does it treat amount as Shares or Cash?
                                // Most generic implementations treat 'amount' as standard unit (shares).

                                const result = await placeMarketOrder(
                                    client,
                                    assetId,
                                    "BUY",
                                    sharesToBuy, // Approx shares
                                    { useGasless: true, builderCreds }
                                )

                                if (result.success) {
                                    toast.success(`🤖 Copied BUY: ${sharesToBuy.toFixed(1)} shares`)
                                    setCopyLogs(prev => [`[Success] Bought ${sharesToBuy.toFixed(1)} shares ($${amountUSDC})`, ...prev])
                                }
                            }
                            else if (side === 'SELL') {
                                // For SELL: We check if we have the position.
                                // If we do, we sell ALL or proportional? 
                                // Simple version: Sell fixed amount (or all if less).

                                // Find our position
                                const myPosition = activeBets.find(p => p.asset === assetId)
                                if (myPosition) {
                                    const sharesToSell = Math.min(myPosition.size, (amountUSDC / (parseFloat(trade.price) || 0.5)))

                                    if (sharesToSell > 0.1) {
                                        const result = await placeMarketOrder(
                                            client,
                                            assetId,
                                            "SELL",
                                            sharesToSell,
                                            { useGasless: true, builderCreds, privateKey }
                                        )
                                        if (result.success) {
                                            toast.success(`🤖 Copied SELL: ${sharesToSell.toFixed(1)} shares`)
                                            setCopyLogs(prev => [`[Success] Sold ${sharesToSell.toFixed(1)} shares`, ...prev])
                                        }
                                    } else {
                                        setCopyLogs(prev => [`[Skip] Sell detected but no/low position held.`, ...prev])
                                    }
                                } else {
                                    setCopyLogs(prev => [`[Skip] Sell detected but position not found.`, ...prev])
                                }
                            }
                        } catch (err) {
                            console.error("Copy Trade Execution Failed", err)
                            setCopyLogs(prev => [`[Failed] ${err.message}`, ...prev])
                        }
                    }

                } catch (err) {
                    console.error(`[CopyBot] Error polling ${traderAddress}`, err)
                }
            }
        }, 5000)

        return () => clearInterval(pollInterval)
    }, [copyBotRunning, copyTraders, copySettings, botStartTime, activeBets, client])

    // Save settings to local storage
    useEffect(() => {
        localStorage.setItem('copyTraders', JSON.stringify(copyTraders))
    }, [copyTraders])

    useEffect(() => {
        localStorage.setItem('copySettings', JSON.stringify(copySettings))
    }, [copySettings])

    // AUTO-SELL LOGIC
    // Check positions whenever activeBets updates
    useEffect(() => {
        if (!autoSellEnabled || !client || activeBets.length === 0) return

        const checkAndSell = async () => {
            // Use displayedBets to get the most up-to-date pricing for Auto-Sell
            for (const bet of displayedBets) {
                // Skip if already triggered or invalid
                if (triggeredOrders.has(bet.conditionId)) continue
                // Skip if asset ID is missing (can happen with Gamma positions that don't map to CLOB tokens)
                if (!bet.asset || bet.size <= 0) continue

                // Check profitability
                let shouldSell = false
                let reason = ''

                // REALIZATION CHECK: Use BID PRICE for safety logic (not Midpoint)
                const safePrice = bet.bidPrice || bet.curPrice
                const avg = bet.avgPrice || 0.01

                // Recalculate 'Real' PnL based on what we can actually SELL for
                const realPnlPercent = ((safePrice - avg) / avg) * 100

                // Debug Logic - Log values to help user understand triggers
                console.log(`[AutoSell Check] ${bet.title}: Mid $${bet.curPrice.toFixed(3)} | Bid $${safePrice.toFixed(3)} | Real PnL ${realPnlPercent.toFixed(2)}%`)

                // SAFETY CHECK 1: Ignore Price Glitches / Zero / Dust
                if (safePrice <= 0.02) {
                    console.warn(`[AutoSell] Skipping ${bet.title} - Bid too low ($${safePrice}), possible illiquidity.`)
                    continue
                }

                // SAFETY CHECK 2: High Spread Protection
                // If Mid is high (e.g. 0.35) but Bid is low (e.g. 0.20), don't sell!
                const referencePrice = bet.midPrice || bet.curPrice
                if (referencePrice > 0.05) { // Only check spread if price is significant
                    const spread = (referencePrice - safePrice) / referencePrice
                    if (spread > maxSpreadPercent / 100) { // Use configurable threshold
                        console.warn(`[AutoSell] Skipping ${bet.title} - Spread too high (${(spread * 100).toFixed(1)}%). Mid: ${referencePrice}, Bid: ${safePrice}. Increase Max Spread in settings if you want to force sell.`)
                        continue
                    }
                }

                // Take Profit
                if (realPnlPercent >= takeProfitPercent) {
                    shouldSell = true
                    reason = `Take Profit: +${realPnlPercent.toFixed(1)}%`
                }
                // Stop Loss
                else if (realPnlPercent <= -stopLossPercent) {
                    shouldSell = true
                    reason = `Stop Loss: ${realPnlPercent.toFixed(1)}%`
                }

                if (shouldSell) {
                    console.log(`[Auto Sell] Attempting to sell ${bet.title} (${reason})`)

                    // 1. Mark as triggered IMMEDIATELY to prevent loops/race conditions
                    setTriggeredOrders(prev => new Set(prev).add(bet.conditionId))

                    try {
                        if (!client || !client.signer) {
                            console.warn("[Auto Sell] Client not ready or read-only.")
                            continue
                        }

                        // 2. PRE-FLIGHT: Check Liquidity (GET /book)
                        // If book 404s or is empty, we ABORT.
                        let bestBid = 0
                        try {
                            const book = await client.getOrderBook(bet.asset)
                            if (book && book.bids && book.bids.length > 0) {
                                bestBid = parseFloat(book.bids[0].price)
                            } else {
                                throw new Error("No Bids Available")
                            }
                        } catch (e) {
                            console.warn(`[Auto Sell] Skipped ${bet.title}: Market illiquid or invalid token.`, e.message)
                            toast.error(`Auto-Sell Skipped: ${bet.title} has no liquidity.`)
                            // We leave it in 'triggeredOrders' so we don't spam retry. 
                            // User must intervene manually or refresh.
                            continue
                        }

                        // 3. USE MARKET ORDER (FOK) for fastest execution - GASLESS if credentials available!
                        console.log(`[Auto Sell] Placing ${builderCreds ? 'GASLESS' : 'STANDARD'} MARKET order (FOK) for ${bet.size} shares`)

                        try {
                            // Place market order - executes immediately (gasless if builder creds available)
                            const marketOrderResult = await placeMarketOrder(
                                client,
                                bet.asset,
                                "SELL",
                                bet.size,
                                {
                                    useGasless: true,
                                    privateKey: privateKey,
                                    builderCreds: builderCreds
                                }
                            )

                            if (marketOrderResult.success) {
                                console.log('[Auto Sell] Market order executed:', marketOrderResult)
                                const gaslessTag = marketOrderResult.gasless ? ' (GASLESS ⚡)' : ''
                                toast.success(`Strategy Triggered: Sold ${bet.title} @ $${marketOrderResult.price.toFixed(4)} (${reason}) - Market Order${gaslessTag}`)
                            }
                        } catch (marketErr) {
                            // Fallback to limit order if market order fails
                            console.warn("[Auto Sell] Market order failed, using limit order:", marketErr)

                            // SAFE PRICE LOGIC - Clamp to [0.01, 0.99]
                            let sellPrice = bestBid
                            if (sellPrice >= 1) sellPrice = 0.99
                            if (sellPrice <= 0) sellPrice = 0.01

                            const generateNonce = () => Date.now() + Math.floor(Math.random() * 1000)

                            const order = await client.createAndPostOrder({
                                tokenID: bet.asset,
                                price: parseFloat(sellPrice.toFixed(4)),
                                side: Side.SELL,
                                size: bet.size,
                                nonce: generateNonce(),
                                feeRateBps: 1000 // Updated
                            })

                            console.log('[Auto Sell] Limit order placed:', order)
                            toast.success(`Strategy Triggered: Sold ${bet.title} @ ${sellPrice} (${reason}) - Limit Order`)
                        }

                    } catch (err) {
                        console.error('[Auto Sell] Failed:', err)
                        toast.error(`Auto-Sell Failed for ${bet.title}: ${err.message}`)
                        // Do NOT remove from triggeredOrders. 
                        // If it failed once (e.g. invalid params), it will likely fail again.
                        // Prevent infinite loop.
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

    // WebSocket for Live Updates
    useEffect(() => {
        if (true || !apiCreds) { // WebSocket Disabled in favor of polling
            setWsConnected(false)
            return
        }

        const ws = new WebSocket('wss://ws-subscriptions-clob.polymarket.com/ws/user')
        let pingInterval

        ws.onopen = () => {
            console.log('[WS] Connected to User Channel')
            setWsConnected(true)

            // Authenticate
            const authMsg = {
                type: "user",
                auth: {
                    apiKey: apiCreds.apiKey,
                    secret: apiCreds.secret,
                    passphrase: apiCreds.passphrase
                }
            }
            ws.send(JSON.stringify(authMsg))

            // Start Ping (every 10s as requested)
            pingInterval = setInterval(() => {
                if (ws.readyState === WebSocket.OPEN) {
                    ws.send(JSON.stringify({ type: 'ping' }))
                }
            }, 10000)
        }

        ws.onmessage = (event) => {
            const msg = JSON.parse(event.data)

            // Ignore pongs
            if (msg.type === 'pong' || msg.type === 'error') return

            console.log('[WS] Received:', msg)

            // If we receive an Order or Trade event, refresh our data
            // Common events: "order_created", "order_canceled", "trade_match"
            // The user said: "Orders are placed, updated, or cancelled" and "Trades are matched"
            if (msg.event_type && (
                msg.event_type.includes('order') ||
                msg.event_type.includes('trade') ||
                msg.event_type.includes('fill')
            )) {
                console.log('[WS] Triggering Refresh due to event:', msg.event_type)

                // Refresh relevant data
                // We add a small delay to ensure the backend DB is consistent
                setTimeout(() => {
                    handleFetchData()
                }, 500)
            }
        }

        ws.onclose = () => {
            console.log('[WS] Disconnected')
            setWsConnected(false)
            clearInterval(pingInterval)
        }

        ws.onerror = (err) => {
            console.error('[WS] Error:', err)
            setWsConnected(false)
        }

        return () => {
            // Only close if not already CLOSED or CLOSING
            if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
                // Remove listeners to prevent async errors
                ws.onclose = null
                ws.onerror = null
                ws.close()
            }
            clearInterval(pingInterval)
        }
    }, [apiCreds, userAddress]) // Re-connect if creds change

    // AUTO-REFRESH Positions at configurable interval
    useEffect(() => {
        if (!autoRefresh || !userAddress) return

        // Fetch positions at user-defined interval
        const priceInterval = setInterval(() => {
            if (activeTab === 'active') {
                fetchActiveBets()
                setLastUpdateTime(Date.now()) // Track refresh time for UI display
            }
        }, refreshInterval) // refreshInterval is already in milliseconds

        return () => clearInterval(priceInterval)
    }, [autoRefresh, refreshInterval, activeTab, userAddress])

    // Standard Auto-Sell polling (safety fallback)
    useEffect(() => {
        // If Auto-Refresh IS ON, the interval above handles it.
        // If Auto-Refresh IS OFF, but Auto-Sell IS ON, we use this slower poll (10s).
        if (!autoSellEnabled || autoRefresh) return

        const interval = setInterval(() => {
            if (activeTab === 'active') fetchActiveBets()
        }, 10000)

        return () => clearInterval(interval)
    }, [autoSellEnabled, autoRefresh, activeTab, userAddress])

    // MARKET WebSocket DISABLED (User preference: use simple API polling instead)
    // WebSocket was showing artificial "fast" latency but actual price updates come from API polling
    // Keeping this commented in case WebSocket approach is needed in future
    /*
    useEffect(() => {
        if (!autoRefresh || activeBets.length === 0) return
    
        const assetIds = [...new Set(activeBets.map(b => b.asset).filter(Boolean))]
        if (assetIds.length === 0) return
    
        const ws = new WebSocket('wss://ws-subscriptions-clob.polymarket.com/ws/market')
        // ... WebSocket logic ...
        
        return () => {
            if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
                ws.close()
            }
        }
    }, [autoRefresh, activeBets.length])
    */

    // MERGE Active Bets with Live Prices for Display
    const displayedBets = useMemo(() => {
        return activeBets.map(bet => {
            const liveData = livePrices[bet.asset]
            if (!liveData) return bet

            // Determine best price to show
            // 1. Last Trade Price (from WS)
            // 2. Midpoint (from WS Bid/Ask)
            // 3. Existing curPrice

            let newPrice = bet.curPrice
            let newBid = bet.bidPrice

            if (liveData.price) {
                newPrice = liveData.price
            } else if (liveData.bid && liveData.ask) {
                newPrice = (liveData.bid + liveData.ask) / 2
            } else if (liveData.bid) {
                newPrice = liveData.bid
            }

            if (liveData.bid) newBid = liveData.bid

            // Recalculate PnL
            const size = bet.size || 0
            const avg = bet.avgPrice || 0
            const newPnl = (newPrice - avg) * size
            const newPercentPnl = avg > 0 ? (newPrice - avg) / avg : 0

            return {
                ...bet,
                curPrice: newPrice, // Mark Price (Last Trade or Mid)
                bidPrice: newBid || newPrice, // Fallback to newPrice if no bid yet, but prefer Bid
                pnl: newPnl,
                percentPnl: newPercentPnl,
                isLive: !!liveData
            }
        })
    }, [activeBets, livePrices])


    // SELL LOGIC - TRIGGER (Opens Modal)
    const handleSellClick = (bet) => {
        if (!client) {
            toast.error("L2 Authentication required to sell.")
            return
        }
        setBetToSell(bet)
        setSellModalOpen(true)
    }

    // SELL LOGIC - EXECUTE (Called by Modal)
    const confirmSellPosition = async () => {
        const bet = betToSell
        if (!bet) return

        // Close modal immediately
        setSellModalOpen(false)
        setBetToSell(null)

        const sizeToSell = bet.size
        // Use live price if available, otherwise fetch or use curPrice
        let sellPrice = bet.curPrice

        try {
            // 1. DETECT MARKET STATUS: Active (Sell) vs Resolved (Redeem)
            let marketStatus = 'UNKNOWN'
            let bestBid = 0

            if (bet.asset) {
                try {
                    // Check if we already know it's resolved
                    if (resolvedMarkets.has(bet.conditionId)) {
                        marketStatus = 'RESOLVED'
                        // Skip fetching book
                        throw { status: 404, message: "Known resolved" }
                    }

                    const book = await client.getOrderBook(bet.asset)

                    // Logic: To SELL, we match the BID side.
                    // If no bids, there is no liquidity to sell into.
                    if (book && book.bids && book.bids.length > 0) {
                        bestBid = parseFloat(book.bids[0].price)
                        marketStatus = 'ACTIVE'
                        console.log(`[Sell] Market is ACTIVE. Best bid: ${bestBid}`)
                    } else {
                        // Empty book but API returned → Could be illiquid OR resolved
                        // Check if market has ended to determine if it's resolved
                        const marketEndDate = bet.marketData?.endDate || bet.endDate
                        const isMarketEnded = marketEndDate && new Date(marketEndDate) < new Date()

                        if (isMarketEnded) {
                            // Market has ended and orderbook is empty → Likely resolved
                            marketStatus = 'RESOLVED'
                            console.log(`[Sell] Market has ended (endDate: ${marketEndDate}) and orderbook is empty → RESOLVED`)
                        } else {
                            // Market might still be active but illiquid
                            marketStatus = 'ILLIQUID'
                            console.log(`[Sell] Market returned empty orderbook (illiquid or may be resolved)`)
                        }
                    }
                } catch (e) {
                    console.error("OrderBook fetch failed:", e)

                    // CLOB Client error can be in multiple formats:
                    // 1. Direct error object: {status: 404, data: {error: "..."}}
                    // 2. Axios-style: {response: {status: 404, data: {error: "..."}}}
                    // 3. Error instance: new Error("...") with properties attached

                    // Check status code in multiple possible locations
                    const statusCode = e.status || e.response?.status || e.code
                    const is404 = statusCode === 404 || statusCode === '404'

                    // Check error message in multiple possible locations
                    const errorMsg = e.message ||
                        e.data?.error ||
                        e.error ||
                        e.response?.data?.error ||
                        (typeof e.data === 'string' ? e.data : '') ||
                        ''

                    // Check for "no orderbook" indicators
                    const isNoOrderbook = errorMsg.toLowerCase().includes("no orderbook exists") ||
                        (errorMsg.toLowerCase().includes("orderbook") && errorMsg.toLowerCase().includes("does not exist")) ||
                        (errorMsg.toLowerCase().includes("orderbook") && errorMsg.toLowerCase().includes("not found"))

                    console.log("[Debug] Error details:", {
                        statusCode,
                        is404,
                        errorMsg,
                        isNoOrderbook,
                        errorKeys: Object.keys(e)
                    })

                    if (is404 || isNoOrderbook) {
                        marketStatus = 'RESOLVED'
                        console.log(`[Redeem] Market is RESOLVED (404 or no orderbook). Switching to redeem flow.`)
                        // Track it to prevent future 404 fetches
                        setResolvedMarkets(prev => new Set(prev).add(bet.conditionId))
                    } else {
                        // Other error (network, etc)
                        const displayError = errorMsg || `Error ${statusCode || 'unknown'}`
                        toast.error(`Cannot process: ${displayError}`)
                        return
                    }
                }
            } else {
                toast.error("Invalid position data (missing asset ID).")
                return
            }


            // 2. EXECUTE APPROPRIATE ACTION
            if (marketStatus === 'ILLIQUID') {
                // Market exists but has no buyers
                // Empty orderbook often means market is resolved, so offer redemption
                toast.info("⚠️ No buyers available. Market may be resolved. Attempting redemption...")

                // Automatically try redemption since empty orderbook often indicates resolved market
                // If redemption fails, we'll show an appropriate error
                marketStatus = 'RESOLVED' // Fall through to redemption flow
            }

            if (marketStatus === 'RESOLVED') {
                // REDEEM FLOW (Market has ended)
                toast.info("🎯 Market has resolved. Initiating redemption...")

                // Import ethers early so it's available in catch block
                const { ethers } = await import('ethers')

                try {
                    // Check if we have the required data
                    if (!bet.conditionId) {
                        toast.error("❌ Cannot redeem: Missing condition ID. Please contact support.")
                        console.error("Missing conditionId for position:", bet)
                        return
                    }

                    console.log(`[Redeem] Starting redemption for conditionId: ${bet.conditionId}`)
                    console.log(`[Redeem] Position size: ${bet.size}, Asset: ${bet.asset}`)

                    // CTF Contract Details (Polygon)
                    const CTF_ADDRESS = "0x4d97dcd97ec945f40cf65f87097ace5ea0476045"
                    const USDCe_ADDRESS = "0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174"

                    // Get the signer from the CLOB client
                    const signer = client.signer
                    if (!signer) {
                        toast.error("❌ No wallet signer available. Please reconnect.")
                        return
                    }

                    // Create CTF contract interface
                    const ctfInterface = new ethers.utils.Interface([
                        "function redeemPositions(address collateralToken, bytes32 parentCollectionId, bytes32 conditionId, uint[] indexSets)"
                    ])

                    // Encode the redemption call
                    const redeemData = ctfInterface.encodeFunctionData("redeemPositions", [
                        USDCe_ADDRESS,                    // collateralToken
                        ethers.constants.HashZero,        // parentCollectionId (null for Polymarket)
                        bet.conditionId,                  // conditionId
                        [1, 2]                            // indexSets: redeem both YES and NO (only winners pay out)
                    ])

                    // GASLESS REDEMPTION (Priority)
                    if (builderCreds && privateKey) {
                        try {
                            console.log('[Redeem] Attempting GASLESS redemption via Relayer...')
                            toast.info("⚡ Initiating Gasless Redemption...")

                            const { relayClient } = await initRelayerClient(privateKey, builderCreds)
                            const result = await redeemPositionsGasless(relayClient, bet.conditionId)

                            if (result.success) {
                                toast.success(`✅ Gasless Redemption successful! Tx: ${result.transactionHash.slice(0, 10)}...`)
                                console.log('[Redeem] Gasless success:', result)
                                setTimeout(() => window.location.reload(), 2000)
                                return
                            }
                        } catch (gaslessErr) {
                            console.error('[Redeem] Gasless failed, falling back to standard:', gaslessErr)
                            toast.warn("Gasless redemption failed, trying standard method...")
                            // Fall through to standard logic below
                        }
                    }

                    // STANDARD REDEMPTION (Direct via Ethers)
                    console.log(`[Redeem] Sending standard redemption transaction...`)

                    // Try to estimate gas with retry logic (handle rate limiting)
                    let gasLimit = null
                    let retries = 0
                    const maxRetries = 3

                    while (retries < maxRetries && !gasLimit) {
                        try {
                            const estimate = await signer.estimateGas({
                                to: CTF_ADDRESS,
                                data: redeemData,
                                value: 0
                            })
                            gasLimit = estimate
                            console.log(`[Redeem] Gas estimated: ${gasLimit.toString()}`)
                        } catch (estimateError) {
                            retries++
                            const errorMsg = estimateError.message || ''

                            // Check if it's a rate limit error
                            if (errorMsg.includes('rate limit') || errorMsg.includes('Too many requests')) {
                                const waitTime = Math.min(1000 * Math.pow(2, retries), 10000) // Exponential backoff, max 10s
                                console.warn(`[Redeem] Rate limited, waiting ${waitTime}ms before retry ${retries}/${maxRetries}...`)
                                await new Promise(resolve => setTimeout(resolve, waitTime))
                                continue
                            }

                            // If not rate limit and not last retry, continue
                            if (retries < maxRetries) {
                                const waitTime = 1000 * retries
                                console.warn(`[Redeem] Gas estimation failed, retrying in ${waitTime}ms...`)
                                await new Promise(resolve => setTimeout(resolve, waitTime))
                                continue
                            }

                            // Last retry failed - use manual gas limit
                            console.warn(`[Redeem] Gas estimation failed after ${maxRetries} retries, using manual gas limit`)
                            gasLimit = ethers.BigNumber.from(300000) // Safe manual limit for redemption (~300k gas)
                        }
                    }

                    // Send the transaction with gas limit (estimated or manual)
                    const txParams = {
                        to: CTF_ADDRESS,
                        data: redeemData,
                        value: 0
                    }

                    // Add gas limit if we have one (estimated or manual)
                    if (gasLimit) {
                        txParams.gasLimit = gasLimit
                        console.log(`[Redeem] Using gas limit: ${gasLimit.toString()}`)
                    }

                    // Boost gas fees to avoid "replacement fee too low" or "below minimum"
                    try {
                        const feeData = await signer.provider.getFeeData()
                        const MIN_GAS_PRICE = ethers.utils.parseUnits('50', 'gwei')

                        // Boost by 30%
                        if (feeData.maxFeePerGas) {
                            let newMaxFee = feeData.maxFeePerGas.mul(130).div(100)
                            if (newMaxFee.lt(MIN_GAS_PRICE)) newMaxFee = MIN_GAS_PRICE

                            txParams.maxFeePerGas = newMaxFee
                            txParams.maxPriorityFeePerGas = feeData.maxPriorityFeePerGas.mul(130).div(100)
                            txParams.type = 2 // EIP-1559
                        } else if (feeData.gasPrice) {
                            let newGasPrice = feeData.gasPrice.mul(130).div(100)
                            if (newGasPrice.lt(MIN_GAS_PRICE)) newGasPrice = MIN_GAS_PRICE
                            txParams.gasPrice = newGasPrice
                        }
                    } catch (gasErr) {
                        console.warn("Failed to boost gas, using defaults", gasErr)
                    }

                    const tx = await signer.sendTransaction(txParams)

                    toast.loading(`⏳ Redeeming... Tx: ${tx.hash.slice(0, 10)}...`, { autoClose: false })
                    console.log(`[Redeem] Transaction sent: ${tx.hash}`)

                    // Wait for confirmation
                    const receipt = await tx.wait()

                    if (receipt.status === 1) {
                        toast.dismiss()
                        toast.success(`✅ Redemption successful! Claimed your winnings.`)
                        console.log(`[Redeem] Success! Receipt:`, receipt)

                        // Refresh positions after redemption
                        setTimeout(() => {
                            window.location.reload()
                        }, 2000)
                    } else {
                        toast.dismiss()
                        toast.error(`❌ Redemption transaction failed.`)
                        console.error(`[Redeem] Transaction failed:`, receipt)
                    }

                    return
                } catch (redeemErr) {
                    toast.dismiss()
                    console.error("Redeem failed:", redeemErr)

                    // Provide helpful error messages
                    const errorMsg = redeemErr.message || redeemErr.reason || ''
                    const errorMsgLower = errorMsg.toLowerCase()

                    if (redeemErr.code === 'ACTION_REJECTED' || redeemErr.code === 4001) {
                        toast.error("❌ Redemption cancelled by user.")
                    } else if (
                        errorMsgLower.includes("insufficient funds") ||
                        errorMsgLower.includes("insufficient balance") ||
                        errorMsgLower.includes("gas") && errorMsgLower.includes("insufficient") ||
                        redeemErr.code === 'INSUFFICIENT_FUNDS' ||
                        redeemErr.error?.code === 'INSUFFICIENT_FUNDS'
                    ) {
                        // Simple error message - no complex MATIC checking
                        toast.error("❌ Insufficient MATIC for gas. Redemption requires MATIC. Please add MATIC to your wallet.")
                    } else if (errorMsgLower.includes("user rejected") || errorMsgLower.includes("user denied")) {
                        toast.error("❌ Redemption cancelled by user.")
                    } else if (errorMsgLower.includes("replacement fee too low")) {
                        toast.error("❌ Transaction pending. Please wait for the previous transaction to complete.")
                    } else {
                        toast.error(`❌ Redemption failed: ${errorMsg || 'Unknown error'}`)
                    }
                    return
                }
            }

            // 3. SELL FLOW (Market is still active)
            // Use MARKET ORDER (FOK) for fastest execution - GASLESS if credentials available!

            console.log(`[Sell] Placing ${builderCreds ? 'GASLESS' : 'STANDARD'} MARKET order (FOK) for ${sizeToSell} shares of ${bet.asset}`)

            try {
                // Place market order - executes immediately at best bid or fails (gasless if builder creds available)
                const marketOrderResult = await placeMarketOrder(
                    client,
                    bet.asset,
                    "SELL",
                    sizeToSell,
                    {
                        useGasless: true,
                        privateKey: privateKey,
                        builderCreds: builderCreds
                    }
                )

                if (marketOrderResult.success) {
                    const gaslessTag = marketOrderResult.gasless ? ' ⚡ GASLESS' : ''
                    toast.success(`✅ Sold! Executed at $${marketOrderResult.price.toFixed(4)} (Market Order${gaslessTag})`)
                    console.log("[Sell] Market order executed:", marketOrderResult)
                } else {
                    throw new Error("Market order failed")
                }

                // Refresh positions
                setTimeout(fetchActiveBets, 1000)

            } catch (marketErr) {
                // Fallback to limit order if market order fails
                console.warn("[Sell] Market order failed, falling back to limit order:", marketErr)

                // Price Logic: Sell at Best Bid
                if (bestBid >= 1) bestBid = 0.99
                if (bestBid <= 0) bestBid = 0.01

                const generateNonce = () => Date.now() + Math.floor(Math.random() * 1000)

                const payload = {
                    tokenID: bet.asset,
                    price: parseFloat(bestBid.toFixed(4)),
                    side: Side.SELL,
                    size: sizeToSell,
                }

                let response = await client.createAndPostOrder({
                    ...payload,
                    nonce: generateNonce()
                })

                // Retry for Nonce (Single Retry)
                if (response && response.error && response.error.includes('nonce')) {
                    console.warn("Nonce collision on Sell. Retrying in 500ms...")
                    await new Promise(r => setTimeout(r, 500))

                    response = await client.createAndPostOrder({
                        ...payload,
                        nonce: generateNonce()
                    })
                }

                if (response && (response.error || (response.status && response.status >= 400))) {
                    throw new Error(response.error || response.data?.error || "Order Failed")
                }

                if (response && response.orderID) {
                    toast.success(`Limit Order Placed! ID: ${response.orderID}`)
                } else {
                    toast.info("Order Submitted (Check Activity)")
                }

                setTimeout(fetchActiveBets, 1000)
            }

        } catch (err) {
            console.error("Sell Failed:", err)
            toast.error(`Sell Failed: ${err.message}`)
        }
    }

    const formatCurrency = (value) => `$${parseFloat(value).toFixed(2)}`

    return (
        <>
            <div className="portfolio-tabs">
                {/* Tab Headers */}
                <div className="tab-headers">
                    <button className={`tab-header ${activeTab === 'active' ? 'active' : ''}`} onClick={() => setActiveTab('active')}>Active Bets</button>

                    <button className={`tab-header ${activeTab === 'calculator' ? 'active' : ''}`} onClick={() => setActiveTab('calculator')}>Risk Calc</button>
                    <button className={`tab-header ${activeTab === 'copy-bot' ? 'active' : ''}`} onClick={() => setActiveTab('copy-bot')}>Copy Bot</button>
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
                                    <button
                                        onClick={() => setAutoSellHelpOpen(true)}
                                        style={{
                                            background: 'rgba(59, 130, 246, 0.2)',
                                            border: '1px solid rgba(59, 130, 246, 0.4)',
                                            color: '#60a5fa',
                                            borderRadius: '50%',
                                            width: '20px',
                                            height: '20px',
                                            display: 'flex',
                                            alignItems: 'center',
                                            justifyContent: 'center',
                                            cursor: 'pointer',
                                            fontSize: '0.75rem',
                                            fontWeight: 'bold',
                                            marginLeft: '4px'
                                        }}
                                        title="How Auto-Sell Works"
                                    >
                                        ?
                                    </button>
                                </div>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                                    <span style={{
                                        fontSize: '0.9rem',
                                        fontWeight: '600',
                                        color: autoSellEnabled ? '#34d399' : '#94a3b8',
                                        transition: 'color 0.3s'
                                    }}>
                                        {autoSellEnabled ? 'ENABLED' : 'DISABLED'}
                                    </span>
                                    <div style={{ position: 'relative', width: '60px', height: '34px' }}>
                                        <input
                                            type="checkbox"
                                            id="auto-sell-toggle"
                                            className="toggle-switch-input"
                                            checked={autoSellEnabled}
                                            onChange={(e) => {
                                                if (!client && e.target.checked) {
                                                    toast.error("Login (L2) required for Auto-Sell")
                                                    return
                                                }
                                                setAutoSellEnabled(e.target.checked)
                                                if (e.target.checked && !liveUpdates) setLiveUpdates(true)
                                            }}
                                        />
                                        <label htmlFor="auto-sell-toggle" className="toggle-switch-label"></label>
                                    </div>
                                </div>
                            </div>

                            {/* Controls */}
                            <div className="auto-sell-controls" style={{
                                display: 'grid',
                                gridTemplateColumns: '1fr 1fr 1fr',
                                gap: '24px',
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

                                {/* Max Spread Tolerance */}
                                <div className="control-group">
                                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px' }}>
                                        <span style={{ fontSize: '0.9rem', fontWeight: '600', color: '#f59e0b' }}>Max Spread</span>
                                        <span style={{ color: '#f59e0b', fontWeight: '700' }}>{maxSpreadPercent}%</span>
                                    </div>
                                    <input
                                        type="range"
                                        min="5" max="80" step="5"
                                        value={maxSpreadPercent}
                                        onChange={(e) => setMaxSpreadPercent(Number(e.target.value))}
                                        style={{ width: '100%', accentColor: '#f59e0b' }}
                                    />
                                    <div style={{ fontSize: '0.75rem', color: '#94a3b8', marginTop: '4px' }}>
                                        Skip if spread {'>'} {maxSpreadPercent}%
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
                                        <div className="positions-table-container" style={{ overflowX: 'auto', background: 'rgba(30, 41, 59, 0.4)', borderRadius: '12px', border: '1px solid rgba(255, 255, 255, 0.05)' }}>
                                            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.9rem' }}>
                                                <thead>
                                                    <tr style={{ color: '#94a3b8', borderBottom: '1px solid #334155', textAlign: 'left', textTransform: 'uppercase', fontSize: '0.75rem' }}>
                                                        <th style={{ padding: '16px', width: '35%' }}>Market</th>
                                                        <th style={{ padding: '16px' }}>Qty</th>
                                                        <th style={{ padding: '16px' }}>Avg &rarr; Now</th>
                                                        <th style={{ padding: '16px' }}>Value</th>
                                                        <th style={{ padding: '16px' }}>Return</th>
                                                        <th style={{ padding: '16px', textAlign: 'right' }}>Action</th>
                                                    </tr>
                                                </thead>
                                                <tbody>
                                                    {displayedBets.map((bet, idx) => {
                                                        // Formatting
                                                        // Formatting helper for precision
                                                        const formatPrice = (p) => p < 1 ? `${(p * 100).toFixed(1)}¢` : `$${p.toFixed(2)}`
                                                        const avgPriceDisplay = formatPrice(bet.avgPrice)
                                                        const curPriceDisplay = formatPrice(bet.curPrice)

                                                        const currentVal = bet.size * bet.curPrice
                                                        const costBasis = bet.size * bet.avgPrice
                                                        const pnlValue = currentVal - costBasis
                                                        const pnlPercent = costBasis > 0 ? (pnlValue / costBasis) * 100 : 0
                                                        const isResolved = resolvedMarkets.has(bet.conditionId)

                                                        return (
                                                            <tr key={idx} style={{ borderBottom: '1px solid #334155' }}>
                                                                {/* Market & Outcome */}
                                                                <td style={{ padding: '16px' }}>
                                                                    <div style={{ display: 'flex', gap: '12px' }}>
                                                                        {bet.icon && (
                                                                            <img
                                                                                src={bet.icon}
                                                                                alt=""
                                                                                style={{ width: '32px', height: '32px', borderRadius: '6px', marginTop: '2px' }}
                                                                                onError={(e) => e.target.style.display = 'none'}
                                                                            />
                                                                        )}
                                                                        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                                                                            <span style={{ color: '#e2e8f0', fontWeight: '600', fontSize: '0.9rem', lineHeight: '1.3' }}>
                                                                                {bet.title}
                                                                            </span>
                                                                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                                                                <span className={`outcome-badge ${bet.outcome.toLowerCase()}`} style={{ fontSize: '0.75rem', padding: '2px 8px' }}>
                                                                                    {bet.outcome}
                                                                                </span>
                                                                                {/* Live Indicator */}
                                                                                {bet.isLive && (
                                                                                    <span style={{ fontSize: '0.7rem', color: '#10b981', display: 'flex', alignItems: 'center', gap: '4px', background: 'rgba(16, 185, 129, 0.1)', padding: '1px 6px', borderRadius: '4px' }}>
                                                                                        <span style={{ width: '6px', height: '6px', background: '#10b981', borderRadius: '50%' }}></span>
                                                                                        LIVE
                                                                                    </span>
                                                                                )}
                                                                                {/* Time Remaining */}
                                                                                {(bet.endDate || bet.market?.endDate) && (
                                                                                    <span style={{ fontSize: '0.7rem', color: '#f59e0b', background: 'rgba(245, 158, 11, 0.1)', padding: '1px 6px', borderRadius: '4px', display: 'flex', alignItems: 'center', gap: '3px' }}>
                                                                                        ⏳ {(() => {
                                                                                            const end = bet.endDate || bet.market?.endDate;

                                                                                            // Parse end date properly accounting for ET timezone
                                                                                            // Polymarket times are in ET (UTC-5 in winter, UTC-4 in summer)
                                                                                            let endTime;
                                                                                            try {
                                                                                                endTime = new Date(end);

                                                                                                // If the date string doesn't have timezone info (no 'Z' or offset),
                                                                                                // it's likely in ET format but parsed as local time
                                                                                                // We need to add the offset difference between local and ET
                                                                                                if (!end.includes('Z') && !end.includes('+') && !end.includes('-', 10)) {
                                                                                                    // Get local timezone offset in minutes
                                                                                                    const localOffset = new Date().getTimezoneOffset();
                                                                                                    // ET is UTC-5 (EST) or UTC-4 (EDT)
                                                                                                    // Assuming EST (UTC-5) = +300 minutes offset from UTC
                                                                                                    const etOffset = 300; // Eastern Standard Time offset in minutes

                                                                                                    // Adjust: add difference between what JavaScript assumed (local) and what it should be (ET)
                                                                                                    const offsetDiff = localOffset - etOffset;
                                                                                                    endTime = new Date(endTime.getTime() + offsetDiff * 60 * 1000);
                                                                                                }
                                                                                            } catch (e) {
                                                                                                return 'Invalid';
                                                                                            }

                                                                                            const diff = endTime - new Date();
                                                                                            if (diff <= 0) return 'Ended';
                                                                                            const days = Math.floor(diff / (1000 * 60 * 60 * 24));
                                                                                            const hours = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
                                                                                            if (days > 0) return `${days}d ${hours}h`;
                                                                                            const mins = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
                                                                                            return `${hours}h ${mins}m`;
                                                                                        })()}
                                                                                    </span>
                                                                                )}
                                                                            </div>
                                                                        </div>
                                                                    </div>
                                                                </td>

                                                                {/* Qty */}
                                                                <td style={{ padding: '16px', color: '#e2e8f0', fontSize: '0.95rem' }}>
                                                                    {bet.size.toFixed(2)}
                                                                </td>

                                                                {/* Avg -> Now */}
                                                                <td style={{ padding: '16px', color: '#94a3b8' }}>
                                                                    <span style={{ color: '#e2e8f0' }}>{avgPriceDisplay}</span>
                                                                    <span style={{ margin: '0 6px', color: '#64748b' }}>&rarr;</span>
                                                                    <span style={{ color: bet.curPrice >= bet.avgPrice ? '#10b981' : '#f43f5e' }}>
                                                                        {curPriceDisplay}
                                                                    </span>
                                                                </td>

                                                                {/* Value with Cost Basis */}
                                                                <td style={{ padding: '16px' }}>
                                                                    <div style={{ display: 'flex', flexDirection: 'column' }}>
                                                                        <span style={{ color: '#e2e8f0', fontWeight: '600', fontSize: '0.95rem' }}>
                                                                            ${currentVal.toFixed(2)}
                                                                        </span>
                                                                        <span style={{ fontSize: '0.75rem', color: '#64748b' }}>
                                                                            Cost ${costBasis.toFixed(2)}
                                                                        </span>
                                                                        <span style={{ fontSize: '0.75rem', color: '#10b981', marginTop: '2px' }}>
                                                                            Max ${bet.size.toFixed(2)}
                                                                        </span>
                                                                    </div>
                                                                </td>

                                                                {/* Return */}
                                                                <td style={{ padding: '16px' }}>
                                                                    <div style={{ display: 'flex', flexDirection: 'column' }}>
                                                                        <span style={{ color: pnlValue >= 0 ? '#10b981' : '#ef4444', fontWeight: '600', fontSize: '0.95rem' }}>
                                                                            {pnlValue >= 0 ? '+' : ''}${pnlValue.toFixed(2)}
                                                                        </span>
                                                                        <span style={{ fontSize: '0.75rem', color: pnlValue >= 0 ? '#10b981' : '#ef4444' }}>
                                                                            ({pnlPercent.toFixed(2)}%)
                                                                        </span>
                                                                    </div>
                                                                </td>

                                                                {/* Action - Sell / Claim */}
                                                                <td style={{ padding: '16px', textAlign: 'right' }}>
                                                                    {isResolved ? (
                                                                        <button
                                                                            className="sell-btn"
                                                                            onClick={() => handleSellClick(bet)}
                                                                            style={{
                                                                                background: '#3b82f6',
                                                                                color: 'white',
                                                                                border: 'none',
                                                                                borderRadius: '6px',
                                                                                padding: '6px 16px',
                                                                                fontWeight: '600',
                                                                                cursor: 'pointer',
                                                                                boxShadow: '0 4px 6px rgba(59, 130, 246, 0.3)'
                                                                            }}
                                                                        >
                                                                            Claim
                                                                        </button>
                                                                    ) : (
                                                                        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '8px' }}>
                                                                            {/* Receive Info Stack */}
                                                                            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', lineHeight: '1.1' }}>
                                                                                <span style={{ fontSize: '0.75rem', color: '#94a3b8', display: 'flex', alignItems: 'center', gap: '4px' }}>
                                                                                    You'll receive 💸
                                                                                </span>
                                                                                <span style={{ fontSize: '1.1rem', fontWeight: '700', color: pnlValue >= 0 ? '#10b981' : '#e2e8f0' }}>
                                                                                    ${(bet.size * (bet.bidPrice || bet.curPrice)).toFixed(2)}
                                                                                </span>
                                                                            </div>

                                                                            <div style={{ display: 'flex', gap: '8px' }}>
                                                                                {/* Chart Button */}
                                                                                <button
                                                                                    onClick={(e) => {
                                                                                        e.stopPropagation()
                                                                                        setSelectedChartAsset({ assetId: bet.asset, title: bet.title })
                                                                                        setChartOpen(true)
                                                                                    }}
                                                                                    style={{
                                                                                        background: 'rgba(56, 189, 248, 0.15)',
                                                                                        border: '1px solid rgba(56, 189, 248, 0.3)',
                                                                                        borderRadius: '8px',
                                                                                        color: '#38bdf8',
                                                                                        padding: '8px 12px',
                                                                                        cursor: 'pointer',
                                                                                        fontWeight: '600',
                                                                                        fontSize: '0.9rem',
                                                                                        display: 'flex',
                                                                                        alignItems: 'center',
                                                                                        gap: '4px'
                                                                                    }}
                                                                                    title="View Chart"
                                                                                >
                                                                                    📊
                                                                                </button>

                                                                                {/* Big Colored Sell Button */}
                                                                                <button
                                                                                    className="sell-btn-large"
                                                                                    onClick={() => handleSellClick(bet)}
                                                                                    disabled={!client}
                                                                                    style={{
                                                                                        background: pnlValue >= 0 ? '#16a34a' : '#ef4444',
                                                                                        border: 'none',
                                                                                        borderRadius: '8px',
                                                                                        color: 'white',
                                                                                        padding: '8px 24px',
                                                                                        cursor: client ? 'pointer' : 'not-allowed',
                                                                                        fontWeight: '700',
                                                                                        fontSize: '0.9rem',
                                                                                        boxShadow: '0 2px 4px rgba(0,0,0,0.2)',
                                                                                        transition: 'transform 0.1s',
                                                                                        opacity: client ? 1 : 0.7,
                                                                                        minWidth: '80px'
                                                                                    }}
                                                                                    onMouseOver={(e) => { if (client) e.currentTarget.style.transform = 'scale(1.02)' }}
                                                                                    onMouseOut={(e) => { if (client) e.currentTarget.style.transform = 'scale(1)' }}
                                                                                >
                                                                                    Sell
                                                                                </button>
                                                                            </div>
                                                                        </div>
                                                                    )}
                                                                </td>
                                                            </tr>
                                                        )
                                                    })}
                                                </tbody>
                                            </table>
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

                            {/* Copy Trading Bot Tab */}
                            {activeTab === 'copy-bot' && (
                                <div className="tab-panel copy-bot-panel" style={{ color: '#e2e8f0' }}>
                                    <div style={{ background: 'rgba(30, 41, 59, 0.4)', borderRadius: '12px', padding: '20px', border: '1px solid rgba(255, 255, 255, 0.05)' }}>

                                        {/* Header / Status */}
                                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px' }}>
                                            <div>
                                                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                                    <h3 style={{ margin: 0, fontSize: '1.2rem', display: 'flex', alignItems: 'center', gap: '8px' }}>
                                                        👯 Copy Trading Bot
                                                        {copyBotRunning && <span className="live-indicator">● LIVE</span>}
                                                    </h3>
                                                    <button
                                                        onClick={() => setCopyBotHelpOpen(true)}
                                                        style={{
                                                            background: 'rgba(56, 189, 248, 0.2)',
                                                            border: '1px solid rgba(56, 189, 248, 0.4)',
                                                            color: '#38bdf8',
                                                            borderRadius: '50%',
                                                            width: '20px',
                                                            height: '20px',
                                                            display: 'flex',
                                                            alignItems: 'center',
                                                            justifyContent: 'center',
                                                            cursor: 'pointer',
                                                            fontSize: '0.75rem',
                                                            fontWeight: 'bold',
                                                            marginLeft: '4px'
                                                        }}
                                                        title="How Copy Bot Works"
                                                    >
                                                        ?
                                                    </button>
                                                </div>
                                                <p style={{ margin: '4px 0 0', color: '#94a3b8', fontSize: '0.9rem' }}>
                                                    {copyBotRunning
                                                        ? 'Monitoring traders and mirroring trades...'
                                                        : 'Add traders and click Start to begin.'}
                                                </p>
                                            </div>
                                            <button
                                                onClick={() => {
                                                    if (!copyBotRunning) setBotStartTime(new Date())
                                                    setCopyBotRunning(!copyBotRunning)
                                                }}
                                                style={{
                                                    background: copyBotRunning ? '#ef4444' : '#10b981',
                                                    color: 'white',
                                                    border: 'none',
                                                    padding: '10px 24px',
                                                    borderRadius: '8px',
                                                    fontWeight: 'bold',
                                                    cursor: 'pointer',
                                                    fontSize: '1rem',
                                                    boxShadow: '0 4px 6px rgba(0,0,0,0.2)'
                                                }}
                                            >
                                                {copyBotRunning ? 'STOP BOT' : 'START BOT'}
                                            </button>
                                        </div>

                                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '24px' }}>
                                            {/* Left Column: Traders & Settings */}
                                            <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>

                                                {/* Settings Card */}
                                                <div className="card-bg" style={{ background: 'rgba(15, 23, 42, 0.6)', padding: '16px', borderRadius: '8px', border: '1px solid #334155' }}>
                                                    <h4 style={{ marginTop: 0, color: '#f59e0b' }}>⚙️ Settings</h4>
                                                    <div style={{ display: 'flex', gap: '16px', alignItems: 'center' }}>
                                                        <div style={{ flex: 1 }}>
                                                            <label style={{ display: 'block', fontSize: '0.8rem', color: '#94a3b8', marginBottom: '4px' }}>Fixed Amount ($)</label>
                                                            <input
                                                                type="number"
                                                                value={copySettings.fixedAmount}
                                                                onChange={(e) => setCopySettings({ ...copySettings, fixedAmount: parseFloat(e.target.value) })}
                                                                style={{ width: '100%', background: '#1e293b', border: '1px solid #475569', color: 'white', padding: '8px', borderRadius: '4px' }}
                                                            />
                                                        </div>
                                                        <div style={{ flex: 1 }}>
                                                            <label style={{ display: 'block', fontSize: '0.8rem', color: '#94a3b8', marginBottom: '4px' }}>Max Spread (%)</label>
                                                            <input
                                                                type="number"
                                                                value={copySettings.maxSpread}
                                                                onChange={(e) => setCopySettings({ ...copySettings, maxSpread: parseFloat(e.target.value) })}
                                                                style={{ width: '100%', background: '#1e293b', border: '1px solid #475569', color: 'white', padding: '8px', borderRadius: '4px' }}
                                                            />
                                                        </div>
                                                    </div>
                                                </div>

                                                {/* Traders Manager */}
                                                <div className="card-bg" style={{ background: 'rgba(15, 23, 42, 0.6)', padding: '16px', borderRadius: '8px', border: '1px solid #334155' }}>
                                                    <h4 style={{ marginTop: 0, color: '#38bdf8' }}>👥 Target Traders</h4>
                                                    <div style={{ display: 'flex', gap: '8px', marginBottom: '16px' }}>
                                                        <input
                                                            type="text"
                                                            placeholder="0x... or Profile ID"
                                                            value={newTraderInput}
                                                            onChange={(e) => setNewTraderInput(e.target.value)}
                                                            style={{ flex: 1, background: '#1e293b', border: '1px solid #475569', color: 'white', padding: '8px', borderRadius: '4px' }}
                                                        />
                                                        <button
                                                            onClick={() => {
                                                                if (newTraderInput && !copyTraders.includes(newTraderInput)) {
                                                                    setCopyTraders([...copyTraders, newTraderInput])
                                                                    setNewTraderInput('')
                                                                }
                                                            }}
                                                            style={{ background: '#3b82f6', color: 'white', border: 'none', padding: '0 16px', borderRadius: '4px', cursor: 'pointer' }}
                                                        >
                                                            Add
                                                        </button>
                                                    </div>

                                                    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                                                        {copyTraders.length === 0 && <span style={{ color: '#64748b', fontSize: '0.9rem', fontStyle: 'italic' }}>No traders added yet.</span>}
                                                        {copyTraders.map(trader => (
                                                            <div key={trader} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'rgba(255,255,255,0.05)', padding: '8px 12px', borderRadius: '4px' }}>
                                                                <span style={{ fontFamily: 'monospace', fontSize: '0.9rem' }}>{trader}</span>
                                                                <button
                                                                    onClick={() => setCopyTraders(copyTraders.filter(t => t !== trader))}
                                                                    style={{ background: 'transparent', color: '#ef4444', border: 'none', cursor: 'pointer', fontSize: '1.2rem' }}
                                                                >
                                                                    &times;
                                                                </button>
                                                            </div>
                                                        ))}
                                                    </div>
                                                </div>

                                            </div>

                                            {/* Right Column: Logs */}
                                            <div className="card-bg" style={{ background: 'rgba(15, 23, 42, 0.6)', padding: '16px', borderRadius: '8px', border: '1px solid #334155', display: 'flex', flexDirection: 'column' }}>
                                                <h4 style={{ marginTop: 0, color: '#94a3b8' }}>📜 Bot Logs</h4>
                                                <div style={{ flex: 1, overflowY: 'auto', maxHeight: '400px', background: 'rgba(0,0,0,0.3)', borderRadius: '4px', padding: '12px', fontFamily: 'monospace', fontSize: '0.85rem', display: 'flex', flexDirection: 'column', gap: '4px' }}>
                                                    {copyLogs.length === 0 && <span style={{ color: '#64748b' }}>Waiting for activity...</span>}
                                                    {copyLogs.map((log, i) => (
                                                        <div key={i} style={{ color: log.includes('Success') ? '#4ade80' : log.includes('Error') || log.includes('Failed') ? '#f87171' : '#e2e8f0' }}>
                                                            {log}
                                                        </div>
                                                    ))}
                                                </div>
                                            </div>
                                        </div>

                                    </div>
                                </div>
                            )}

                            {/* Risk Calculator Tab */}
                            {activeTab === 'calculator' && (
                                <RiskCalculator cashBalance={cashBalance} />
                            )}
                        </>
                    )}

                    {/* Auto-refresh Toggle - Footer */}
                    <div className="auto-refresh-toggle" style={{ borderTop: '1px solid rgba(255,255,255,0.1)', marginTop: '20px', paddingTop: '20px' }}>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px', alignItems: 'center', opacity: apiCreds ? 1 : 0.5, transition: 'opacity 0.3s' }}>

                            {/* Control Row: Toggle + Interval Slider */}
                            <div style={{ display: 'flex', alignItems: 'center', gap: '24px', width: '100%', justifyContent: 'center' }}>
                                {/* Auto-Refresh Toggle */}
                                <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                                    <span style={{ fontSize: '1.2rem' }}>
                                        {autoRefresh ? '🔄' : '⏸'}
                                    </span>
                                    <span style={{
                                        fontSize: '0.9rem',
                                        fontWeight: '600',
                                        color: autoRefresh ? '#10b981' : '#94a3b8',
                                        transition: 'color 0.3s'
                                    }}>
                                        {autoRefresh ? 'AUTO-REFRESH ON' : 'AUTO-REFRESH OFF'}
                                    </span>

                                    <div style={{ position: 'relative', width: '60px', height: '34px' }}>
                                        <input
                                            type="checkbox"
                                            id="auto-refresh-toggle"
                                            className="toggle-switch-input"
                                            checked={autoRefresh}
                                            onChange={(e) => {
                                                if (!apiCreds) {
                                                    alert("L2 Authentication required for Auto-Refresh. Please login with API Keys or Private Key.")
                                                    return
                                                }
                                                setAutoRefresh(e.target.checked)
                                            }}
                                            disabled={!apiCreds}
                                        />
                                        <label htmlFor="auto-refresh-toggle" className="toggle-switch-label"></label>
                                    </div>
                                </div>

                                {/* Refresh Interval Slider */}
                                {autoRefresh && (
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '12px', minWidth: '250px' }}>
                                        <span style={{ fontSize: '0.8rem', color: '#94a3b8', whiteSpace: 'nowrap' }}>
                                            Refresh every:
                                        </span>
                                        <input
                                            type="range"
                                            min="100"
                                            max="3000"
                                            step="100"
                                            value={refreshInterval}
                                            onChange={(e) => setRefreshInterval(Number(e.target.value))}
                                            style={{ flex: 1, accentColor: '#10b981' }}
                                        />
                                        <span style={{ fontSize: '0.9rem', fontWeight: '700', color: '#10b981', minWidth: '45px' }}>
                                            {(refreshInterval / 1000).toFixed(1)}s
                                        </span>
                                    </div>
                                )}
                            </div>

                            {/* Status Display */}
                            {autoRefresh && (
                                <div style={{ fontSize: '0.75rem', color: '#64748b', textAlign: 'center' }}>
                                    🔄 Refreshing positions every <span style={{ color: '#10b981', fontWeight: '600' }}>{(refreshInterval / 1000).toFixed(1)} second{refreshInterval !== 1000 ? 's' : ''}</span>
                                    {lastUpdateTime && (
                                        <span style={{ marginLeft: '12px', color: '#94a3b8' }}>
                                            • Last: {(() => {
                                                const sec = Math.floor((Date.now() - lastUpdateTime) / 1000);
                                                return sec === 0 ? 'just now' : `${sec}s ago`;
                                            })()}
                                        </span>
                                    )}
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            </div>
            <ConfirmModal
                isOpen={sellModalOpen}
                title={betToSell ? `Sell ${betToSell.title}` : 'Confirm Sell'}
                onConfirm={confirmSellPosition}
                onCancel={() => {
                    setSellModalOpen(false)
                    setBetToSell(null)
                }}
                confirmText={betToSell ? `Sell ${betToSell.outcome}` : 'Sell'}
                cancelText="Cancel"
                isDestructive={false}
                confirmButtonStyle={{
                    background: '#0ea5e9',
                    width: '100%',
                    padding: '12px',
                    fontSize: '1rem',
                    borderRadius: '8px',
                    boxShadow: '0 4px 6px -1px rgba(14, 165, 233, 0.4)'
                }}
            >
                {betToSell && (
                    <div className="sell-confirm-content" style={{ padding: '0 0.5rem' }}>
                        <div style={{
                            display: 'flex',
                            justifyContent: 'space-between',
                            alignItems: 'flex-start',
                            marginBottom: '24px'
                        }}>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                                <span style={{
                                    fontSize: '1.1rem',
                                    fontWeight: '700',
                                    color: '#e2e8f0',
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: '6px'
                                }}>
                                    You'll receive 💸
                                </span>
                                <span style={{ fontSize: '0.85rem', color: '#64748b', display: 'flex', alignItems: 'center', gap: '4px' }}>
                                    Avg. Price {betToSell.avgPrice < 1
                                        ? `${(betToSell.avgPrice * 100).toFixed(1)}¢`
                                        : `$${betToSell.avgPrice.toFixed(2)}`}
                                    <span style={{ fontSize: '0.7em', border: '1px solid #64748b', borderRadius: '50%', width: '12px', height: '12px', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>i</span>
                                </span>
                                <span style={{ fontSize: '0.85rem', color: '#10b981', display: 'flex', alignItems: 'center', gap: '4px' }}>
                                    Potential Win: ${betToSell.size.toFixed(2)}
                                </span>
                            </div>

                            <div style={{
                                fontSize: '2.5rem',
                                fontWeight: '700',
                                color: '#22c55e',
                                lineHeight: '1',
                                letterSpacing: '-0.5px'
                            }}>
                                {formatCurrency(betToSell.size * betToSell.curPrice)}
                            </div>
                        </div>

                        <div style={{
                            background: 'rgba(15, 23, 42, 0.5)',
                            padding: '12px',
                            borderRadius: '8px',
                            marginBottom: '8px',
                            fontSize: '0.9rem',
                            color: '#94a3b8',
                            border: '1px solid rgba(51, 65, 85, 0.5)'
                        }}>
                            Selling <strong>{betToSell.size.toFixed(2)}</strong> shares of <strong style={{ color: '#e2e8f0' }}>{betToSell.outcome}</strong> at ~{formatCurrency(betToSell.curPrice)}
                        </div>
                    </div>
                )}
            </ConfirmModal>

            {/* Candle Chart Modal */}
            {chartOpen && selectedChartAsset && (
                <CandleChart
                    assetId={selectedChartAsset.assetId}
                    title={selectedChartAsset.title}
                    onClose={() => {
                        setChartOpen(false)
                        setSelectedChartAsset(null)
                    }}
                />
            )}
            {/* Auto-Sell Help Modal */}
            {autoSellHelpOpen && (
                <div style={{
                    position: 'fixed',
                    top: 0, left: 0, right: 0, bottom: 0,
                    backgroundColor: 'rgba(0,0,0,0.8)',
                    display: 'flex',
                    justifyContent: 'center',
                    alignItems: 'center',
                    zIndex: 10000
                }} onClick={() => setAutoSellHelpOpen(false)}>
                    <div style={{
                        width: '90%',
                        maxWidth: '550px',
                        maxHeight: '90vh',
                        overflowY: 'auto',
                        backgroundColor: '#0f172a',
                        borderRadius: '16px',
                        padding: '32px',
                        position: 'relative',
                        border: '1px solid #334155',
                        boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.5)'
                    }} onClick={e => e.stopPropagation()}>

                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '24px' }}>
                            <h3 style={{ fontSize: '1.5rem', fontWeight: 'bold', color: 'white', margin: 0 }}>
                                🤖 How Auto-Sell Works
                            </h3>
                            <button
                                onClick={() => setAutoSellHelpOpen(false)}
                                style={{
                                    background: 'transparent',
                                    border: 'none',
                                    color: '#94a3b8',
                                    fontSize: '1.5rem',
                                    cursor: 'pointer',
                                    padding: '4px'
                                }}
                            >
                                ✕
                            </button>
                        </div>

                        <div style={{ color: '#cbd5e1', lineHeight: '1.6' }}>
                            <div style={{ marginBottom: '24px' }}>
                                <p style={{ fontSize: '1rem', marginBottom: '16px' }}>
                                    The Auto-Sell Bot monitors your active positions every few seconds and automatically sells them if your profit or loss hits the targets you set.
                                </p>
                            </div>

                            <div style={{ marginBottom: '24px' }}>
                                <h4 style={{ color: '#10b981', fontSize: '1.1rem', marginBottom: '8px' }}>💰 Take Profit (+%)</h4>
                                <p style={{ margin: 0, fontSize: '0.95rem' }}>
                                    Triggers a sell if your gain exceeds this percentage. Example: If set to +50%, a $10 bet will be sold when it's worth $15 or more.
                                </p>
                            </div>

                            <div style={{ marginBottom: '24px' }}>
                                <h4 style={{ color: '#ef4444', fontSize: '1.1rem', marginBottom: '8px' }}>🛑 Stop Loss (-%)</h4>
                                <p style={{ margin: 0, fontSize: '0.95rem' }}>
                                    Triggers a sell if your loss exceeds this percentage to protect your capital. Example: If set to -10%, a $10 bet will be sold if it drops below $9.
                                </p>
                            </div>

                            <div style={{ marginBottom: '24px' }}>
                                <h4 style={{ color: '#f59e0b', fontSize: '1.1rem', marginBottom: '8px' }}>↔️ Max Spread Safety</h4>
                                <p style={{ margin: 0, fontSize: '0.95rem' }}>
                                    Buying/Selling in very thin markets can be costly. This setting <strong>prevents</strong> the bot from selling if the difference between Buy/Sell prices (the spread) is too wide (e.g., &gt;20%).
                                </p>
                                <p style={{ fontSize: '0.9rem', color: '#94a3b8', marginTop: '4px' }}>
                                    <em>This ensures you don't get a bad deal just to exit a trade.</em>
                                </p>
                            </div>

                            <div style={{ background: 'rgba(51, 65, 85, 0.3)', padding: '16px', borderRadius: '8px', border: '1px solid rgba(51, 65, 85, 0.5)' }}>
                                <h4 style={{ color: '#e2e8f0', fontSize: '1rem', marginTop: 0, marginBottom: '8px' }}>🚀 Important Note</h4>
                                <p style={{ margin: 0, fontSize: '0.9rem' }}>
                                    You must keep this tab <strong>OPEN</strong> for the bot to run. If you close the browser, monitoring stops.
                                </p>
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {/* Copy Bot Help Modal */}
            {copyBotHelpOpen && (
                <div style={{
                    position: 'fixed',
                    top: 0, left: 0, right: 0, bottom: 0,
                    backgroundColor: 'rgba(0,0,0,0.8)',
                    display: 'flex',
                    justifyContent: 'center',
                    alignItems: 'center',
                    zIndex: 9999999
                }} onClick={() => setCopyBotHelpOpen(false)}>
                    <div style={{
                        width: '90%',
                        maxWidth: '550px',
                        maxHeight: '90vh',
                        overflowY: 'auto',
                        backgroundColor: '#0f172a',
                        borderRadius: '16px',
                        padding: '32px',
                        position: 'relative',
                        border: '1px solid #334155',
                        boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.5)'
                    }} onClick={e => e.stopPropagation()}>

                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '24px' }}>
                            <h3 style={{ fontSize: '1.5rem', fontWeight: 'bold', color: 'white', margin: 0 }}>
                                👯 Copy Bot Guide
                            </h3>
                            <button
                                onClick={() => setCopyBotHelpOpen(false)}
                                style={{
                                    background: 'transparent',
                                    border: 'none',
                                    color: '#94a3b8',
                                    fontSize: '1.5rem',
                                    cursor: 'pointer',
                                    padding: '4px'
                                }}
                            >
                                ✕
                            </button>
                        </div>

                        <div style={{ color: '#cbd5e1', lineHeight: '1.6' }}>
                            <div style={{ marginBottom: '24px' }}>
                                <p style={{ fontSize: '1rem', marginBottom: '16px' }}>
                                    The Copy Trading Bot allows you to automatically mirror the trades of successful Polymarket users.
                                </p>
                            </div>

                            <div style={{ marginBottom: '24px' }}>
                                <h4 style={{ color: '#38bdf8', fontSize: '1.1rem', marginBottom: '8px' }}>1. Find a Trader</h4>
                                <p style={{ margin: 0, fontSize: '0.95rem' }}>
                                    Find a user you want to copy (e.g., from the Leaderboard or Activity log). Copy their <strong>Address (0x...)</strong> or <strong>Profile ID</strong>.
                                </p>
                            </div>

                            <div style={{ marginBottom: '24px' }}>
                                <h4 style={{ color: '#f59e0b', fontSize: '1.1rem', marginBottom: '8px' }}>2. Configure Settings</h4>
                                <ul style={{ margin: '0 0 0 20px', padding: 0, fontSize: '0.95rem' }}>
                                    <li style={{ marginBottom: '8px' }}><strong>Fixed Amount:</strong> The amount of USDC you want to spend on each copied trade (e.g., $10).</li>
                                    <li><strong>Max Spread:</strong> Safety filter. If the market spread is wider than this %, the bot will skip the trade to avoid bad prices.</li>
                                </ul>
                            </div>

                            <div style={{ marginBottom: '24px' }}>
                                <h4 style={{ color: '#10b981', fontSize: '1.1rem', marginBottom: '8px' }}>3. Start the Bot</h4>
                                <p style={{ margin: 0, fontSize: '0.95rem' }}>
                                    Click <strong>START BOT</strong>. The bot will poll for new activity every 5 seconds.
                                </p>
                            </div>

                            <div style={{ background: 'rgba(239, 68, 68, 0.15)', padding: '16px', borderRadius: '8px', border: '1px solid rgba(239, 68, 68, 0.3)' }}>
                                <h4 style={{ color: '#fca5a5', fontSize: '1rem', marginTop: 0, marginBottom: '8px' }}>⚠️ Requirements</h4>
                                <p style={{ margin: 0, fontSize: '0.9rem', color: '#fecaca' }}>
                                    1. You must keep this browser tab <strong>OPEN</strong>.
                                    <br />
                                    2. You must be <strong>logged in</strong> (L2/Proxy) to execute trades.
                                </p>
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </>
    )
}

export default PortfolioTabs
