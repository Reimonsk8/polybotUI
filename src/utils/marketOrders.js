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
import { ethers } from 'ethers'
import { CONTRACTS } from './relayerClient'

// Time Sync Logic
let timeOffset = 0
let timeSynced = false

export const syncTime = async () => {
    try {
        // Use CLOB endpoint which is reliable
        const response = await fetch('/clob/time')
        const text = await response.text()

        let serverTimeMs = Date.now()
        try {
            // Try JSON first
            const json = JSON.parse(text)
            if (json.iso) {
                serverTimeMs = new Date(json.iso).getTime()
            } else if (json.timestamp) {
                serverTimeMs = json.timestamp * 1000 // usually seconds
            } else if (typeof json === 'number') {
                serverTimeMs = json * 1000
            }
        } catch (e) {
            // If text is just a number string
            if (!isNaN(text)) {
                serverTimeMs = parseInt(text) * 1000
            }
        }

        const localTime = Date.now()
        timeOffset = serverTimeMs - localTime
        console.log(`[TimeSync] Synced. Offset: ${timeOffset}ms (Server: ${serverTimeMs})`)
        addLog('TimeSync', `Synced. Offset: ${Math.round(timeOffset)}ms`, STEP_STATUS.INFO)
    } catch (e) {
        console.warn('Time sync failed, defaulting to 0', e)
        timeOffset = 0
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
                // Convert dollars to shares and add a small buffer (0.1%) to ensure order value > $1
                // This prevents "400 Bad Request: invalid amount ... ($0.9999)" due to float precision
                orderSize = (size / bestPrice) * 1.001
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

        // 4.5. Check & Approve Allowance (Fallback for Standard Execution)
        // Only works if we have the private key and MATIC for gas
        if (options.privateKey && side.toUpperCase() === 'BUY') {
            try {
                console.log("[Market Order] Checking USDC Allowance (Standard)...")
                const provider = new ethers.providers.JsonRpcProvider("https://polygon.drpc.org")
                const wallet = new ethers.Wallet(options.privateKey, provider)

                // USDC Contract
                const usdcAbi = [
                    "function allowance(address owner, address spender) view returns (uint256)",
                    "function approve(address spender, uint256 amount) returns (bool)"
                ]
                const usdc = new ethers.Contract(CONTRACTS.USDCe, usdcAbi, wallet)
                const spender = CONTRACTS.CTF_Exchange

                // Check Allowance
                // Estimate cost: orderSize * marketPrice (approx)
                // Safety: Check against $1000 or full balance? Best to verify specific amount.
                // Since we don't have exact USDC amount handy (orderSize is shares), we estimate.
                const estimatedCostUsdc = orderSize * marketPrice
                const requiredAllowance = ethers.utils.parseUnits(Math.ceil(estimatedCostUsdc).toString(), 6)

                const currentAllowance = await usdc.allowance(wallet.address, spender)

                if (currentAllowance.lt(requiredAllowance)) {
                    console.log("[Market Order] Allowance too low. Approving...", currentAllowance.toString(), requiredAllowance.toString())
                    addLog('Market Order', 'Approving USDC (Standard)', STEP_STATUS.PENDING)

                    try {
                        const tx = await usdc.approve(spender, ethers.constants.MaxUint256)
                        await tx.wait()

                        console.log("[Market Order] Approval Confirmed!", tx.hash)
                        addLog('Market Order', 'USDC Approved', STEP_STATUS.SUCCESS, { tx: tx.hash })
                    } catch (approveErr) {
                        console.error("[Market Order] Approval Tx Failed:", approveErr)
                        throw new Error(`Approval failed: ${approveErr.message || "Insufficient funds for gas?"}`)
                    }
                } else {
                    console.log("[Market Order] Allowance sufficient.")
                }
            } catch (err) {
                console.warn("[Market Order] Helper Error:", err)
                // If it was the approval error we just threw, rethrow it to stop execution
                if (err.message.includes('Approval failed')) throw err

                // Otherwise, it might be a read error? We probably shouldn't continue but let's be careful.
                addLog('Market Order', 'Pre-flight Check Failed', STEP_STATUS.WARNING, { error: err.message })
                throw err // STOP EXECUTION
            }
        }

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
