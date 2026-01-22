import React, { useState, useEffect } from 'react'
import './PortfolioTabs.css'
import { fetchActivityLog as fetchActivityData } from './ActivityLogFetcher'
import { Side, OrderType } from '@polymarket/clob-client'
import { toast } from 'react-toastify'
import ConfirmModal from './ConfirmModal'
import { placeMarketOrder, checkMarketLiquidity } from '../../utils/marketOrders'
import { initRelayerClient, redeemPositionsGasless } from '../../utils/relayerClient'

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
    const [liveUpdates, setLiveUpdates] = useState(false)
    const [wsConnected, setWsConnected] = useState(false)
    const [hasFetched, setHasFetched] = useState(false)

    // Track resolved markets to avoid repeated 404s
    const [resolvedMarkets, setResolvedMarkets] = useState(new Set())

    // AUTO-SELL STATE
    const [autoSellEnabled, setAutoSellEnabled] = useState(false)
    const [takeProfitPercent, setTakeProfitPercent] = useState(25)
    const [stopLossPercent, setStopLossPercent] = useState(50)
    const [triggeredOrders, setTriggeredOrders] = useState(new Set()) // Track executed sells to prevent loops

    // MODAL STATE
    const [sellModalOpen, setSellModalOpen] = useState(false)
    const [betToSell, setBetToSell] = useState(null)

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
                if (liveUpdates) {
                    try {
                        const updatedPositions = await Promise.all(standardizedPositions.map(async (pos) => {
                            if (!pos.asset) return pos

                            try {
                                let livePrice = 0
                                let priceFound = false

                                // OPTION A: Use Client OrderBook (Best)
                                if (client) {
                                    try {
                                        // Skip if we already know it's resolved
                                        if (resolvedMarkets.has(pos.conditionId) || resolvedMarkets.has(pos.market)) {
                                            // Keeping existing price or 0 if resolved
                                            return pos
                                        }

                                        const book = await client.getOrderBook(pos.asset)
                                        if (book && book.bids && book.bids.length > 0) {
                                            livePrice = parseFloat(book.bids[0].price)
                                            priceFound = !isNaN(livePrice)
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
                                        } else {
                                            // Only log non-404 errors (network issues, etc.)
                                            // console.warn('OrderBook Error:', err)
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

                                    // Recalculate PnL (Live)
                                    let newPnl = 0
                                    let newPercentPnl = 0

                                    if (avg > 0) {
                                        newPnl = (livePrice - avg) * pos.size
                                        newPercentPnl = (livePrice - avg) / avg
                                    }

                                    return {
                                        ...pos,
                                        curPrice: livePrice,
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

    // AUTO-SELL LOGIC
    // Check positions whenever activeBets updates
    useEffect(() => {
        if (!autoSellEnabled || !client || activeBets.length === 0) return

        const checkAndSell = async () => {
            for (const bet of activeBets) {
                // Skip if already triggered or invalid
                if (triggeredOrders.has(bet.conditionId)) continue
                // Skip if asset ID is missing (can happen with Gamma positions that don't map to CLOB tokens)
                if (!bet.asset || bet.size <= 0) continue

                // Check profitability
                let shouldSell = false
                let reason = ''

                // Calculate PnL (API vs Local)
                // Use Standardized 'percentPnl' which is already live-updated
                const currentPnlPercent = bet.percentPnl * 100

                // Take Profit
                if (currentPnlPercent >= takeProfitPercent) {
                    shouldSell = true
                    reason = `Take Profit: +${currentPnlPercent.toFixed(1)}%`
                }
                // Stop Loss
                else if (currentPnlPercent <= -stopLossPercent) {
                    shouldSell = true
                    reason = `Stop Loss: ${currentPnlPercent.toFixed(1)}%`
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
                                nonce: generateNonce()
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
        if (!liveUpdates || !apiCreds) {
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
            ws.close()
            clearInterval(pingInterval)
        }
    }, [liveUpdates, apiCreds, userAddress]) // Re-connect if toggle or creds change



    // POLL For Prices when Live Updates are ON
    // The WebSocket only tells us about OUR trades (fills/cancels).
    // It DOES NOT tell us if the market price changed.
    // To show "Real Time Value" we must poll valid positions frequently.
    useEffect(() => {
        if (!liveUpdates || !userAddress) return

        // Fetch frequently (every 2s) to keep Current Price and P&L fresh
        const priceInterval = setInterval(() => {
            if (activeTab === 'active') {
                fetchActiveBets()
            }
        }, 2000)

        return () => clearInterval(priceInterval)
    }, [liveUpdates, activeTab, userAddress])

    // Standard Auto-Sell polling (safety fallback)
    useEffect(() => {
        // If Live Updates IS ON, the interval above handles it (2s).
        // If Live Updates IS OFF, but Auto-Sell IS ON, we use this slower poll (10s).
        if (!autoSellEnabled || liveUpdates) return

        const interval = setInterval(() => {
            if (activeTab === 'active') fetchActiveBets()
        }, 10000)

        return () => clearInterval(interval)
    }, [autoSellEnabled, liveUpdates, activeTab, userAddress])

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
                                            toast.error("Login (L2) required for Auto-Sell")
                                            return
                                        }
                                        setAutoSellEnabled(e.target.checked)
                                        // Force Live Updates ON if Auto-Sell is enabled for better data
                                        if (e.target.checked && !liveUpdates) setLiveUpdates(true)
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

                                                <div className="position-summary-text" style={{ fontSize: '0.85rem', color: '#94a3b8', marginBottom: '12px' }}>
                                                    ${(bet.size * bet.avgPrice).toFixed(2)} on <span className={`outcome-text-inline ${bet.outcome.toLowerCase()}`} style={{ fontWeight: '600', color: bet.outcome === 'Yes' || bet.outcome === 'Up' ? '#10b981' : '#ef4444' }}>{bet.outcome}</span> to win <span style={{ color: '#e2e8f0', fontWeight: '500' }}>${bet.size.toFixed(2)}</span>
                                                </div>

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
                                                        <span className="stat-label">Price {bet.isLive && '⚡'}</span>
                                                        <span className="stat-value" style={{ color: bet.isLive ? '#10b981' : '#f59e0b' }}>{formatCurrency(bet.curPrice)}</span>
                                                    </div>
                                                    <div className="stat">
                                                        <span className="stat-label">Value</span>
                                                        <span className="stat-value" style={{ fontWeight: '700', color: '#e2e8f0' }}>{formatCurrency(bet.size * bet.curPrice)}</span>
                                                    </div>
                                                    <div className="stat">
                                                        <span className="stat-label">P&L</span>
                                                        <span className={`stat-value ${bet.percentPnl >= 0 ? 'positive' : 'negative'}`}>
                                                            {formatCurrency((bet.curPrice - bet.avgPrice) * bet.size)} ({bet.percentPnl >= 0 ? '+' : ''}{(bet.percentPnl * 100).toFixed(1)}%)
                                                        </span>
                                                    </div>
                                                </div>

                                                {/* SELL / CLAIM BUTTON */}
                                                {/* SELL / CLAIM BUTTON */}
                                                <div className="position-actions" style={{ marginTop: '12px', borderTop: '1px solid #334155', paddingTop: '12px' }}>
                                                    {resolvedMarkets.has(bet.conditionId) ? (
                                                        <button
                                                            className="sell-btn"
                                                            style={{
                                                                width: '100%',
                                                                padding: '10px',
                                                                borderRadius: '6px',
                                                                background: '#3b82f6',
                                                                color: 'white',
                                                                border: 'none',
                                                                fontWeight: '600',
                                                                cursor: 'pointer',
                                                                display: 'flex',
                                                                justifyContent: 'center',
                                                                alignItems: 'center',
                                                                gap: '8px',
                                                                boxShadow: '0 4px 6px -1px rgba(59, 130, 246, 0.5)'
                                                            }}
                                                            onClick={() => handleSellClick(bet)}
                                                        >
                                                            <span>🎁 Claim Winnings</span>
                                                        </button>
                                                    ) : (
                                                        <button
                                                            className="sell-btn"
                                                            onClick={() => handleSellClick(bet)}
                                                            disabled={!client}
                                                            style={{
                                                                width: '100%',
                                                                padding: '10px',
                                                                borderRadius: '6px',
                                                                background: '#ef4444',
                                                                color: 'white',
                                                                border: 'none',
                                                                fontWeight: '600',
                                                                cursor: client ? 'pointer' : 'not-allowed',
                                                                opacity: client ? 1 : 0.6,
                                                                display: 'flex',
                                                                justifyContent: 'center',
                                                                alignItems: 'center',
                                                                gap: '8px'
                                                            }}
                                                        >
                                                            <span>💸 Sell All</span>
                                                            <span style={{ fontWeight: '400', fontSize: '0.9em', opacity: 0.9 }}>
                                                                (Est. {formatCurrency(bet.size * bet.curPrice)})
                                                            </span>
                                                        </button>
                                                    )}
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
                    <label style={{ opacity: apiCreds ? 1 : 0.5, cursor: apiCreds ? 'pointer' : 'not-allowed' }}>
                        <input
                            type="checkbox"
                            checked={liveUpdates}
                            onChange={(e) => {
                                if (!apiCreds) {
                                    alert("L2 Authentication required for Live Updates. Please login with API Keys or Private Key.")
                                    return
                                }
                                setLiveUpdates(e.target.checked)
                            }}
                            disabled={!apiCreds}
                        />
                        <span className="refresh-icon" style={{ color: liveUpdates ? (wsConnected ? '#10b981' : '#f59e0b') : 'inherit' }}>
                            {liveUpdates ? '⚡' : '⚪'}
                        </span>
                        {liveUpdates ? 'Live' : 'Enable Live Updates (WebSocket/Poll)'}
                    </label>
                </div>
            </div>

            {/* SELL CONFIRMATION MODAL */}
            <ConfirmModal
                isOpen={sellModalOpen}
                title="Confirm Sell Order"
                message={betToSell ? `Are you sure you want to SELL ALL ${betToSell.size.toFixed(2)} shares of:\n\n${betToSell.title} (${betToSell.outcome})?\n\nEstimated Payout: $${(betToSell.size * betToSell.curPrice).toFixed(2)}` : ''}
                onConfirm={confirmSellPosition}
                onCancel={() => {
                    setSellModalOpen(false)
                    setBetToSell(null)
                }}
                confirmText="💸 Sell Position"
                cancelText="Keep"
                isDestructive={true}
            />
        </div >
    )
}

export default PortfolioTabs
