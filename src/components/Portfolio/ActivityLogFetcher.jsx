// Fetch Activity Log using Data API with full metadata and fallback to client
export const fetchActivityLog = async (userAddress, client, proxyUrl, useProxy) => {
    try {
        if (!userAddress) {
            console.warn("No user address available for activity fetch")
            return []
        }

        // Build the Data API activity endpoint URL with proper query parameters
        const params = new URLSearchParams({
            user: userAddress,
            limit: '100',
            offset: '0',
            sortBy: 'TIMESTAMP',
            sortDirection: 'DESC'
        })

        const activityUrl = useProxy
            ? `${proxyUrl}/api/data-api/activity?${params.toString()}`
            : `https://data-api.polymarket.com/activity?${params.toString()}`

        console.log('[Activity Log] Fetching from:', activityUrl)

        const response = await fetch(activityUrl)

        console.log('[Activity Log] Response status:', response.status)

        if (!response.ok) {
            const errorText = await response.text()
            console.error('[Activity Log] API error:', response.status, errorText)

            // Fallback: Try using client.getTrades if Data API fails
            if (client) {
                console.log('[Activity Log] Falling back to client.getTrades()')
                const trades = await client.getTrades({ limit: 50 })
                if (trades && trades.length > 0) {
                    // Enrich with market metadata
                    const uniqueMarketIds = [...new Set(trades.map(t => t.market))]
                    const metadataMap = new Map()

                    await Promise.all(uniqueMarketIds.map(async (conditionId) => {
                        try {
                            const marketUrl = useProxy
                                ? `${proxyUrl}/api/gamma-api/markets?condition_id=${conditionId}`
                                : `https://gamma-api.polymarket.com/markets?condition_id=${conditionId}`

                            const res = await fetch(marketUrl)
                            if (res.ok) {
                                const json = await res.json()
                                const marketData = Array.isArray(json) ? json[0] : json
                                if (marketData) {
                                    metadataMap.set(conditionId, marketData)
                                }
                            }
                        } catch (e) {
                            console.warn("Failed to fetch metadata for", conditionId)
                        }
                    }))

                    const mappedTrades = trades.map(trade => {
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
                    return mappedTrades
                }
            }
            return []
        }

        const contentType = response.headers.get("content-type")
        if (!contentType || !contentType.includes("application/json")) {
            console.error('[Activity Log] Non-JSON response:', await response.text())
            return []
        }

        const data = await response.json()
        console.log('[Activity Log] Received data:', data?.length || 0, 'items')

        // The Data API returns an array of activity items with rich metadata
        // Each item includes: proxyWallet, timestamp, conditionId, type, size, usdcSize,
        // transactionHash, price, asset, side, outcomeIndex, title, slug, icon, 
        // eventSlug, outcome, name, pseudonym, bio, profileImage, profileImageOptimized

        if (Array.isArray(data) && data.length > 0) {
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
            console.warn('[Activity Log] No activity data returned')
            return []
        }

    } catch (err) {
        console.error("[Activity Log] Failed to fetch:", err)
        return []
    }
}
