/**
 * Gasless Market Order Utilities
 * Enhanced version that uses Polymarket's Relayer for zero-fee, gasless trading
 * 
 * Features:
 * - Automatic fallback: Relayer (gasless) → Standard CLOB (with gas)
 * - No trading fees when using relayer
 * - All gas paid by Polymarket
 */

import { OrderType } from '@polymarket/clob-client'
import {
    initRelayerClient,
    placeGaslessBuyOrder,
    placeGaslessSellOrder
} from './relayerClient'
import { addLog, STEP_STATUS } from './debugLogger'

// Time Sync Logic
let timeOffset = 0
let timeSynced = false

async function syncTime() {
    try {
        const start = Date.now()
        const res = await fetch('https://clob.polymarket.com/time')
        const data = await res.json()

        // Helper to parse ISO string safely
        const serverTime = new Date(data.time).getTime()
        const end = Date.now()
        const latency = (end - start) / 2

        // Calculate offset: Server - Local
        timeOffset = serverTime - (end - latency)
        timeSynced = true
        console.log(`[TimeSync] Synced! Offset: ${timeOffset}ms`)
        addLog('TimeSync', `Synced. Offset: ${Math.round(timeOffset)}ms`, STEP_STATUS.INFO)
    } catch (e) {
        console.warn('[TimeSync] Failed', e)
        addLog('TimeSync', 'Failed to sync time', STEP_STATUS.WARNING)
    }
}
// Attempt sync immediately
syncTime()

/**
 * Place a market order with automatic gasless execution
 * @param {Object} client - Authenticated CLOB client
 * @param {string} tokenId - Token ID to trade
 * @param {string} side - "BUY" or "SELL"
 * @param {number} size - Size in shares (for SELL) or dollar amount (for BUY)
 * @param {Object} options - Additional options
 * @returns {Promise<Object>} Order response
 */
export async function placeMarketOrder(client, tokenId, side, size, options = {}) {
    const useGasless = options.useGasless !== false // Default to true
    const privateKey = options.privateKey
    const builderCreds = options.builderCreds

    // Try gasless execution first if enabled and credentials available
    if (useGasless && privateKey) {
        try {
            console.log('[Market Order] Attempting gasless execution via Relayer...')

            // Initialize relayer client
            const { relayClient, address, isGasless } = await initRelayerClient(
                privateKey,
                builderCreds
            )

            // Safe deployment is handled internally by placeGasless*Order functions now using ensureSafeDeployed
            // so we don't need manual check here.

            // Execute gasless trade
            if (side === "BUY" || side === "buy") {
                const result = await placeGaslessBuyOrder(
                    relayClient,
                    client,
                    tokenId,
                    size,
                    options
                )
                addLog('Market Order', `Gasless BUY Success`, STEP_STATUS.SUCCESS, { tx: result.transactionHash })
                console.log('[Market Order] ✅ Gasless BUY executed successfully!')
                return result
            } else if (side === "SELL" || side === "sell") {
                const result = await placeGaslessSellOrder(
                    relayClient,
                    client,
                    tokenId,
                    size
                )
                addLog('Market Order', `Gasless SELL Success`, STEP_STATUS.SUCCESS, { tx: result.transactionHash })
                console.log('[Market Order] ✅ Gasless SELL executed successfully!')
                return result
            }
        } catch (gaslessError) {
            addLog('Market Order', 'Gasless Failed -> Fallback', STEP_STATUS.WARNING, { error: gaslessError.message })
            console.warn('[Market Order] Gasless execution failed, falling back to standard:', gaslessError.message)
            // Fall through to standard execution
        }
    }

    // Standard execution (with gas fees)
    return await placeStandardMarketOrder(client, tokenId, side, size, options)
}

/**
 * Standard market order execution (original implementation with gas)
 * @param {Object} client - Authenticated CLOB client
 * @param {string} tokenId - Token ID to trade
 * @param {string} side - "BUY" or "SELL"
 * @param {number} size - Size in shares (for SELL) or dollar amount (for BUY)
 * @param {Object} options - Additional options
 * @returns {Promise<Object>} Order response
 */
async function placeStandardMarketOrder(client, tokenId, side, size, options = {}) {
    try {
        addLog('Market Order', 'Starting Standard Execution (Gas)', STEP_STATUS.INFO)
        console.log('[Market Order] Using standard execution (with gas)...')

        // 1. Get order book to find best price
        const book = await client.getOrderBook(tokenId)

        if (!book || (!book.bids && !book.asks)) {
            throw new Error("No orderbook available - market may be closed")
        }

        // 2. Determine best price based on side
        let bestPrice = null
        let orderSize = size

        if (side === "BUY" || side === "buy") {
            // To buy, we match against asks (sellers)
            if (!book.asks || book.asks.length === 0) {
                throw new Error("No sellers available")
            }
            bestPrice = parseFloat(book.asks[0].price)

            // For BUY, size can be in dollars - convert to shares
            if (options.sizeInDollars) {
                orderSize = size / bestPrice // Convert dollars to shares
            }
        } else if (side === "SELL" || side === "sell") {
            // To sell, we match against bids (buyers)
            if (!book.bids || book.bids.length === 0) {
                throw new Error("No buyers available")
            }
            bestPrice = parseFloat(book.bids[0].price)
        } else {
            throw new Error(`Invalid side: ${side}. Must be "BUY" or "SELL"`)
        }

        // 3. Safety checks
        if (bestPrice <= 0 || bestPrice >= 1) {
            throw new Error(`Invalid price: ${bestPrice}. Price must be between 0 and 1`)
        }

        if (orderSize <= 0) {
            throw new Error(`Invalid size: ${orderSize}. Size must be greater than 0`)
        }

        // 4. Apply Slippage for "Market Order" behavior (Default 5%)
        // This ensures aggressive matching even if price moves slightly
        const slippage = options.slippage || 0.05
        let marketPrice = bestPrice

        if (side.toUpperCase() === 'BUY') {
            marketPrice = bestPrice * (1 + slippage)
            // Strict API Max is 0.99
            if (marketPrice > 0.99) {
                marketPrice = 0.99
            }
        } else {
            marketPrice = bestPrice * (1 - slippage)
            // Strict API Min is 0.01
            if (marketPrice < 0.01) {
                marketPrice = 0.01
            }
        }

        // Final safety clamp just in case
        if (marketPrice > 0.99) marketPrice = 0.99
        if (marketPrice < 0.01) marketPrice = 0.01

        console.log(`[Market Order] Price with Slippage: ${marketPrice.toFixed(4)} (Base: ${bestPrice}, Slippage: ${slippage * 100}%)`)

        // 5. Generate nonce with Time Offset
        const nonce = getSyncedNonce()

        // 6. Create and post order at best price (simulates market order)
        const payload = {
            tokenID: tokenId,
            price: parseFloat(marketPrice.toFixed(4)),
            side: side.toUpperCase(),
            size: orderSize,
            nonce: nonce,
            feeRateBps: 1000 // Error explicitly demanded 1000
        }

        // Place order - it will execute immediately since we're crossing the spread
        const response = await client.createAndPostOrder(payload)

        return {
            success: true,
            orderID: response.orderID,
            price: marketPrice,
            size: orderSize,
            side: side.toUpperCase(),
            type: "MARKET_FOK",
            gasless: false
        }

    } catch (error) {
        console.error("[Market Order] Failed:", error)
        throw error
    }
}

/**
 * Generate a nonce synchronized with Polymarket server time
 */
export function getSyncedNonce() {
    const now = Date.now() + timeOffset
    return now + Math.floor(Math.random() * 1000)
}

/**
 * Check if market order is feasible (has liquidity)
 * @param {Object} client - CLOB client (can be read-only)
 * @param {string} tokenId - Token ID to check
 * @param {string} side - "BUY" or "SELL"
 * @returns {Promise<Object>} Liquidity info
 */
export async function checkMarketLiquidity(client, tokenId, side) {
    try {
        const book = await client.getOrderBook(tokenId)

        if (!book) {
            return { available: false, reason: "No orderbook" }
        }

        if (side === "BUY" || side === "buy") {
            const hasAsks = book.asks && book.asks.length > 0
            if (!hasAsks) {
                return { available: false, reason: "No sellers available" }
            }
            return {
                available: true,
                bestPrice: parseFloat(book.asks[0].price),
                depth: book.asks.length
            }
        } else {
            const hasBids = book.bids && book.bids.length > 0
            if (!hasBids) {
                return { available: false, reason: "No buyers available" }
            }
            return {
                available: true,
                bestPrice: parseFloat(book.bids[0].price),
                depth: book.bids.length
            }
        }
    } catch (error) {
        return { available: false, reason: error.message }
    }
}
