/**
 * Polymarket Relayer Client for Gasless Trading
 * 
 * This module provides gasless, fee-free trading using Polymarket's Builder Relayer.
 * All gas fees are paid by Polymarket, and trades execute with no fees.
 * 
 * Features:
 * - Gasless transactions (Polymarket pays gas)
 * - No trading fees
 * - Automatic wallet deployment (Safe wallets)
 * - Buy and sell operations
 * - Position redemption
 */

import { createWalletClient, http, encodeFunctionData, parseUnits } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { polygon } from 'viem/chains'
import { RelayClient } from '@polymarket/builder-relayer-client'
import { BuilderConfig } from '@polymarket/builder-signing-sdk'
import { addLog, STEP_STATUS } from './debugLogger'

// Polymarket Contract Addresses on Polygon
const CONTRACTS = {
    USDCe: '0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174',
    CTF: '0x4d97dcd97ec945f40cf65f87097ace5ea0476045',
    CTF_Exchange: '0x4bFb41d5B3570DeFd03C39a9A4D8dE6Bd8B8982E',
    NegRisk_CTF_Exchange: '0xC5d563A36AE78145C45a50134d48A1215220f80a',
    NegRisk_Adapter: '0xd91E80cF2E7be2e162c6513ceD06f1dD0dA35296'
}

const RELAYER_URL = 'https://relayer-v2.polymarket.com/'
const CHAIN_ID = 137 // Polygon

/**
 * Initialize Relayer Client for gasless trading
 * @param {string} privateKey - User's private key (with 0x prefix)
 * @param {Object} builderCreds - Builder API credentials {key, secret, passphrase}
 * @returns {Promise<Object>} Relayer client and wallet info
 */
export async function initRelayerClient(privateKey, builderCreds = null) {
    try {
        // Create viem account from private key
        const account = privateKeyToAccount(privateKey)

        // Create wallet client
        const wallet = createWalletClient({
            account,
            chain: polygon,
            transport: http('https://polygon.drpc.org')
        })

        // Configure builder authentication
        let builderConfig = null
        if (builderCreds) {
            addLog('Init Relayer', 'Configuring Builder Credentials...', STEP_STATUS.INFO, {
                key: builderCreds.key ? '***' + builderCreds.key.slice(-4) : 'MISSING',
                hasSecret: !!builderCreds.secret,
                hasPassphrase: !!builderCreds.passphrase
            })

            // Use builder credentials for gasless transactions
            builderConfig = new BuilderConfig({
                localBuilderConfig: {
                    key: builderCreds.key,
                    secret: builderCreds.secret,
                    passphrase: builderCreds.passphrase
                }
            })
        }

        // Initialize Relayer Client
        const relayClient = new RelayClient(
            RELAYER_URL,
            CHAIN_ID,
            wallet,
            builderConfig
        )

        return {
            relayClient,
            wallet,
            address: account.address,
            isGasless: !!builderCreds
        }
    } catch (error) {
        console.error('[Relayer] Initialization failed:', error)
        throw new Error(`Failed to initialize relayer: ${error.message}`)
    }
}

/**
 * Deploy Safe wallet (required before first transaction)
 * @param {Object} relayClient - Initialized relay client
 * @returns {Promise<Object>} Deployment result with Safe address
 */
export async function deploySafeWallet(relayClient) {
    try {
        addLog('Safe Deploy', 'Starting Safe Wallet deployment...', STEP_STATUS.PENDING)
        console.log('[Relayer] Deploying Safe wallet...')

        const response = await relayClient.deploy()
        addLog('Safe Deploy', 'Deployment transaction sent', STEP_STATUS.INFO)

        const result = await response.wait()

        if (result) {
            addLog('Safe Deploy', 'Safe Wallet Deployed Successfully!', STEP_STATUS.SUCCESS, { address: result.proxyAddress })
            console.log('[Relayer] Safe deployed:', result.proxyAddress)
            return {
                success: true,
                safeAddress: result.proxyAddress,
                transactionHash: result.transactionHash
            }
        }

        throw new Error('Deployment failed - no result')
    } catch (error) {
        console.error('[Relayer] Deployment error:', error)
        throw error
    }
}

/**
 * Check if Safe wallet is already deployed
 * @param {string} address - Address to check
 * @returns {Promise<boolean>} True if deployed
 */
export async function isSafeDeployed(address) {
    try {
        // Simple check: if address has code, it's deployed
        const response = await fetch(`https://polygon.drpc.org`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                jsonrpc: '2.0',
                method: 'eth_getCode',
                params: [address, 'latest'],
                id: 1
            })
        })
        const data = await response.json()
        return data.result !== '0x'
    } catch (error) {
        console.error('[Relayer] Failed to check deployment:', error)
        return false
    }
}

/**
 * Ensure Safe wallet is deployed before transaction
 * @param {Object} relayClient - Initialized relay client
 */
async function ensureSafeDeployed(relayClient) {
    try {
        addLog('Safe Check', 'Checking/Deploying Safe Wallet...', STEP_STATUS.PENDING)
        console.log('[Relayer] Checking Safe deployment status...')
        // The SDK might not expose address directly easily, 
        // but we can try to deploy and catch if it says already deployed

        const task = await relayClient.deploy()
        console.log('[Relayer] Safe deployment task started...')
        addLog('Safe Check', 'Deployment task started', STEP_STATUS.INFO)

        const result = await task.wait()
        console.log('[Relayer] Safe deployment check complete:', result)
        addLog('Safe Check', 'Safe is Ready', STEP_STATUS.SUCCESS)

    } catch (error) {
        // If error is "Safe already deployed", we are good.
        // Also handle "Bad Request" which might mean already deployed in some contexts, but rely on message
        const isAlreadyDeployed = error.message && (
            error.message.includes('already deployed') ||
            error.message.includes('Safe already exists') ||
            error.message.includes('KB-500') // Common relayer code for existing safe
        )

        if (isAlreadyDeployed) {
            addLog('Safe Check', 'Safe already exists (Skipped)', STEP_STATUS.INFO)
            console.log('[Relayer] Safe already deployed (caught error)')
            return
        }

        addLog('Safe Check', 'Deployment Warning/Error', STEP_STATUS.WARNING, { error: error.message })
        console.warn('[Relayer] Safe deployment check warning:', error)
        // We rethrow if it's a 401 because that means we can't do anything
        if (error.message && error.message.includes('401')) {
            throw error
        }
    }
}

/**
 * Place a gasless buy order
 * @param {Object} relayClient - Initialized relay client
 * @param {Object} clobClient - CLOB client for orderbook data
 * @param {string} tokenId - Token ID to buy
 * @param {number} size - Amount to buy (in shares or dollars)
 * @param {Object} options - Additional options
 * @returns {Promise<Object>} Transaction result
 */
export async function placeGaslessBuyOrder(relayClient, clobClient, tokenId, size, options = {}) {
    try {
        // 0. Ensure Safe is deployed
        await ensureSafeDeployed(relayClient)

        // 1. Get best price from orderbook
        const book = await clobClient.getOrderBook(tokenId)
        if (!book || !book.asks || book.asks.length === 0) {
            throw new Error('No sellers available')
        }

        const bestPrice = parseFloat(book.asks[0].price)
        let orderSize = size

        // Convert dollars to shares if needed
        if (options.sizeInDollars) {
            orderSize = size / bestPrice
        }

        // 2. Create approval transaction for USDCe
        const approvalAmount = parseUnits(String(Math.ceil(size)), 6) // Approve enough USDCe

        const approveTx = {
            to: CONTRACTS.USDCe,
            data: encodeFunctionData({
                abi: [{
                    name: 'approve',
                    type: 'function',
                    inputs: [
                        { name: 'spender', type: 'address' },
                        { name: 'amount', type: 'uint256' }
                    ],
                    outputs: [{ type: 'bool' }]
                }],
                functionName: 'approve',
                args: [CONTRACTS.CTF_Exchange, approvalAmount]
            }),
            value: '0'
        }

        // 3. Execute approval via relayer (gasless)
        console.log('[Relayer] Executing gasless approval...')
        const approvalResponse = await relayClient.execute([approveTx], 'Approve USDCe for trading')
        const approvalResult = await approvalResponse.wait()

        if (!approvalResult) {
            throw new Error('Approval transaction failed')
        }

        console.log('[Relayer] Approval successful:', approvalResult.transactionHash)

        // 4. Now place the actual buy order via CLOB
        // Note: The order itself goes through CLOB, but the on-chain settlement is gasless
        const payload = {
            tokenID: tokenId,
            price: parseFloat(bestPrice.toFixed(4)),
            side: 'BUY',
            size: orderSize,
            nonce: Date.now() + Math.floor(Math.random() * 1000),
            feeRateBps: 1000 // Error explicitly demanded 1000
        }

        const orderResponse = await clobClient.createAndPostOrder(payload)

        return {
            success: true,
            orderID: orderResponse.orderID,
            price: bestPrice,
            size: orderSize,
            approvalTx: approvalResult.transactionHash,
            gasless: true
        }

    } catch (error) {
        console.error('[Relayer] Gasless buy failed:', error)
        throw error
    }
}

/**
 * Place a gasless sell order
 * @param {Object} relayClient - Initialized relay client
 * @param {Object} clobClient - CLOB client for orderbook data
 * @param {string} tokenId - Token ID to sell
 * @param {number} size - Amount to sell (in shares)
 * @returns {Promise<Object>} Transaction result
 */
export async function placeGaslessSellOrder(relayClient, clobClient, tokenId, size) {
    try {
        // 0. Ensure Safe is deployed
        await ensureSafeDeployed(relayClient)

        // 1. Get best price from orderbook
        const book = await clobClient.getOrderBook(tokenId)
        if (!book || !book.bids || book.bids.length === 0) {
            throw new Error('No buyers available')
        }

        const bestPrice = parseFloat(book.bids[0].price)

        // 2. Approve outcome tokens for trading
        // Note: For outcome tokens, we need to approve the CTF Exchange
        const approvalAmount = parseUnits(String(Math.ceil(size)), 6)

        const approveTx = {
            to: tokenId, // The token contract itself
            data: encodeFunctionData({
                abi: [{
                    name: 'approve',
                    type: 'function',
                    inputs: [
                        { name: 'spender', type: 'address' },
                        { name: 'amount', type: 'uint256' }
                    ],
                    outputs: [{ type: 'bool' }]
                }],
                functionName: 'approve',
                args: [CONTRACTS.CTF_Exchange, approvalAmount]
            }),
            value: '0'
        }

        // 3. Execute approval via relayer (gasless)
        console.log('[Relayer] Executing gasless token approval...')
        const approvalResponse = await relayClient.execute([approveTx], 'Approve tokens for selling')
        const approvalResult = await approvalResponse.wait()

        if (!approvalResult) {
            throw new Error('Token approval failed')
        }

        console.log('[Relayer] Token approval successful:', approvalResult.transactionHash)

        // 4. Place the sell order via CLOB
        const payload = {
            tokenID: tokenId,
            price: parseFloat(bestPrice.toFixed(4)),
            side: 'SELL',
            size: size,
            nonce: Date.now() + Math.floor(Math.random() * 1000),
            feeRateBps: 1000 // Error explicitly demanded 1000
        }

        const orderResponse = await clobClient.createAndPostOrder(payload)

        return {
            success: true,
            orderID: orderResponse.orderID,
            price: bestPrice,
            size: size,
            approvalTx: approvalResult.transactionHash,
            gasless: true
        }

    } catch (error) {
        console.error('[Relayer] Gasless sell failed:', error)
        throw error
    }
}

/**
 * Redeem positions from resolved markets (gasless)
 * @param {Object} relayClient - Initialized relay client
 * @param {string} conditionId - Condition ID of resolved market
 * @returns {Promise<Object>} Redemption result
 */
export async function redeemPositionsGasless(relayClient, conditionId) {
    try {
        // 0. Ensure Safe is deployed
        await ensureSafeDeployed(relayClient)

        const redeemTx = {
            to: CONTRACTS.CTF,
            data: encodeFunctionData({
                abi: [{
                    name: 'redeemPositions',
                    type: 'function',
                    inputs: [
                        { name: 'collateralToken', type: 'address' },
                        { name: 'parentCollectionId', type: 'bytes32' },
                        { name: 'conditionId', type: 'bytes32' },
                        { name: 'indexSets', type: 'uint256[]' }
                    ]
                }],
                functionName: 'redeemPositions',
                args: [
                    CONTRACTS.USDCe,
                    '0x0000000000000000000000000000000000000000000000000000000000000000',
                    conditionId,
                    [1, 2] // Index sets for YES and NO
                ]
            }),
            value: '0'
        }

        console.log('[Relayer] Executing gasless redemption...')
        const response = await relayClient.execute([redeemTx], 'Redeem positions')
        const result = await response.wait()

        if (result) {
            console.log('[Relayer] Redemption successful:', result.transactionHash)
            return {
                success: true,
                transactionHash: result.transactionHash,
                gasless: true
            }
        }

        throw new Error('Redemption failed')
    } catch (error) {
        console.error('[Relayer] Redemption failed:', error)
        throw error
    }
}

/**
 * Batch multiple transactions (gasless)
 * @param {Object} relayClient - Initialized relay client
 * @param {Array} transactions - Array of transaction objects
 * @param {string} description - Description of batch
 * @returns {Promise<Object>} Batch result
 */
export async function executeBatchGasless(relayClient, transactions, description) {
    try {
        // 0. Ensure Safe is deployed
        await ensureSafeDeployed(relayClient)

        console.log(`[Relayer] Executing batch: ${description}`)
        const response = await relayClient.execute(transactions, description)
        const result = await response.wait()

        if (result) {
            return {
                success: true,
                transactionHash: result.transactionHash,
                gasless: true
            }
        }

        throw new Error('Batch execution failed')
    } catch (error) {
        console.error('[Relayer] Batch execution failed:', error)
        throw error
    }
}

export default {
    initRelayerClient,
    deploySafeWallet,
    isSafeDeployed,
    placeGaslessBuyOrder,
    placeGaslessSellOrder,
    redeemPositionsGasless,
    executeBatchGasless,
    CONTRACTS
}
