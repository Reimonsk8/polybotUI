// Fetch Activity Log using Data API with authentication headers
export const fetchActivityLog = async (userAddress, client, proxyUrl, useProxy) => {
    try {
        if (!userAddress) {
            console.warn("[Activity Log] No user address available")
            return []
        }

        console.log('[Activity Log] Starting fetch for user:', userAddress)

        // Try to get authentication headers from client if available
        let authHeaders = {}
        if (client && client.creds) {
            try {
                // Check if we have API key credentials
                if (client.creds.apiKey || client.creds.secret || client.creds.passphrase) {
                    const timestamp = Date.now()
                    authHeaders = {
                        'POLY-ADDRESS': userAddress,
                        'POLY-TIMESTAMP': timestamp.toString(),
                        'POLY-NONCE': timestamp.toString()
                    }
                    // Add API key if available
                    if (client.creds.apiKey) {
                        authHeaders['POLY-SIGNATURE'] = client.creds.apiKey
                    }
                    console.log('[Activity Log] Using authenticated request')
                }
            } catch (authErr) {
                console.warn('[Activity Log] Could not create auth headers:', authErr)
            }
        }

        // Build the Data API activity endpoint URL with proper query parameters
        const params = new URLSearchParams({
            user: userAddress,
            limit: '100',
            offset: '0',
            sortBy: 'TIMESTAMP',
            sortDirection: 'DESC'
        })

        // ALWAYS use proxy to avoid CORS
        const activityUrl = `${proxyUrl}/api/data-api/activity?${params.toString()}`

        console.log('[Activity Log] Fetching from proxy')

        const response = await fetch(activityUrl, {
            headers: {
                'Content-Type': 'application/json',
                ...authHeaders
            }
        })

        console.log('[Activity Log] Response status:', response.status)

        if (!response.ok) {
            const errorText = await response.text()
            console.error('[Activity Log] Data API error:', response.status, errorText)

            // Fallback: Try using client.getTrades if Data API fails
            if (client) {
                console.log('[Activity Log] Falling back to client.getTrades() method')
                try {
                    const trades = await client.getTrades({ limit: 100 })
                    console.log('[Activity Log] client.getTrades() returned:', trades?.length || 0, 'trades')

                    if (trades && trades.length > 0) {
                        // Sort by timestamp descending (most recent first)
                        const sortedTrades = trades.sort((a, b) => {
                            const timeA = a.match_time || a.timestamp || 0
                            const timeB = b.match_time || b.timestamp || 0
                            return timeB - timeA
                        })

                        const firstTradeTime = sortedTrades[0].match_time || sortedTrades[0].timestamp
                        console.log('[Activity Log] Most recent trade:', new Date(firstTradeTime * 1000).toLocaleString())

                        // Enrich with market metadata via proxy
                        const uniqueMarketIds = [...new Set(sortedTrades.map(t => t.market))]
                        console.log('[Activity Log] Fetching metadata for', uniqueMarketIds.length, 'unique markets')
                        const metadataMap = new Map()

                        // Fetch metadata sequentially to avoid rate limits
                        for (const conditionId of uniqueMarketIds) {
                            try {
                                const marketUrl = `${proxyUrl}/api/gamma-api/markets?condition_id=${conditionId}`
                                const res = await fetch(marketUrl)

                                if (res.ok) {
                                    const json = await res.json()
                                    const marketData = Array.isArray(json) ? json[0] : json
                                    if (marketData) {
                                        metadataMap.set(conditionId, marketData)
                                    }
                                }
                                // Small delay to be nice to the API
                                await new Promise(resolve => setTimeout(resolve, 100))
                            } catch (e) {
                                console.warn("[Activity Log] Failed to fetch metadata for market")
                            }
                        }

                        const mappedTrades = sortedTrades.map(trade => {
                            const marketData = metadataMap.get(trade.market)
                            return {
                                ...trade,
                                type: 'TRADE',
                                timestamp: trade.match_time || trade.timestamp,
                                conditionId: trade.market,
                                title: marketData?.question || trade.outcome || 'Unknown',
                                slug: marketData?.slug,
                                icon: marketData?.icon || marketData?.image,
                                outcome: trade.outcome,
                                size: parseFloat(trade.size),
                                price: parseFloat(trade.price),
                                usdcSize: parseFloat(trade.size) * parseFloat(trade.price),
                                market: {
                                    image: marketData?.icon || marketData?.image,
                                    question: marketData?.question || trade.outcome || 'Unknown'
                                }
                            }
                        })

                        console.log('[Activity Log] Successfully enriched', mappedTrades.length, 'trades')
                        return mappedTrades
                    }
                } catch (clientErr) {
                    console.error('[Activity Log] client.getTrades() failed:', clientErr)
                }
            }
            return []
        }

        const contentType = response.headers.get("content-type")
        if (!contentType || !contentType.includes("application/json")) {
            console.error('[Activity Log] Non-JSON response received')
            return []
        }

        const data = await response.json()
        console.log('[Activity Log] Data API returned:', data?.length || 0, 'activity items')

        if (Array.isArray(data) && data.length > 0) {
            console.log('[Activity Log] First activity type:', data[0].type, 'at', new Date(data[0].timestamp * 1000).toLocaleString())

            // Map to ensure consistent structure with market object for UI
            const enrichedData = data.map(item => ({
                ...item,
                market: {
                    image: item.icon,
                    question: item.title
                }
            }))
            return enrichedData
        } else {
            console.warn('[Activity Log] Data API returned empty array')
            return []
        }

    } catch (err) {
        console.error("[Activity Log] Fetch failed with error:", err.message)
        return []
    }
}
