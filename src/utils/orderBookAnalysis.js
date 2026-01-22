/**
 * Order Book Analysis Utilities
 * Based on examples from bits_and_bobs/polymarket_python.ipynb
 */

/**
 * Calculate midpoint price from order book
 * @param {Object} book - Order book with bids and asks arrays
 * @returns {number|null} Midpoint price or null if no valid prices
 */
export function getMidpoint(book) {
    if (!book || !book.bids || !book.asks) return null
    
    const bestBid = book.bids.length > 0 ? parseFloat(book.bids[0].price) : null
    const bestAsk = book.asks.length > 0 ? parseFloat(book.asks[0].price) : null
    
    if (bestBid === null || bestAsk === null) return null
    
    return (bestBid + bestAsk) / 2
}

/**
 * Calculate spread from order book
 * @param {Object} book - Order book with bids and asks arrays
 * @returns {Object|null} Spread object with absolute and percentage, or null
 */
export function getSpread(book) {
    if (!book || !book.bids || !book.asks) return null
    
    const bestBid = book.bids.length > 0 ? parseFloat(book.bids[0].price) : null
    const bestAsk = book.asks.length > 0 ? parseFloat(book.asks[0].price) : null
    
    if (bestBid === null || bestAsk === null) return null
    
    const absoluteSpread = bestAsk - bestBid
    const midpoint = (bestBid + bestAsk) / 2
    const percentageSpread = midpoint > 0 ? (absoluteSpread / midpoint) * 100 : 0
    
    return {
        absolute: absoluteSpread,
        percentage: percentageSpread,
        bestBid,
        bestAsk
    }
}

/**
 * Get best price for a side
 * @param {Object} book - Order book with bids and asks arrays
 * @param {string} side - "BUY" or "SELL"
 * @returns {number|null} Best price or null
 */
export function getBestPrice(book, side) {
    if (!book) return null
    
    if (side === "BUY" || side === "buy") {
        // To buy, we need to match against asks (sellers)
        if (book.asks && book.asks.length > 0) {
            return parseFloat(book.asks[0].price)
        }
    } else if (side === "SELL" || side === "sell") {
        // To sell, we need to match against bids (buyers)
        if (book.bids && book.bids.length > 0) {
            return parseFloat(book.bids[0].price)
        }
    }
    
    return null
}

/**
 * Analyze order book depth
 * @param {Object} book - Order book with bids and asks arrays
 * @param {number} depth - Number of levels to analyze (default: 5)
 * @returns {Object} Depth analysis with total size and average price
 */
export function analyzeDepth(book, depth = 5) {
    if (!book) return { bids: null, asks: null }
    
    const bids = book.bids || []
    const asks = book.asks || []
    
    const bidsDepth = bids.slice(0, depth).reduce((acc, bid) => {
        const price = parseFloat(bid.price)
        const size = parseFloat(bid.size)
        return {
            totalSize: acc.totalSize + size,
            weightedPrice: acc.weightedPrice + (price * size),
            levels: acc.levels + 1
        }
    }, { totalSize: 0, weightedPrice: 0, levels: 0 })
    
    const asksDepth = asks.slice(0, depth).reduce((acc, ask) => {
        const price = parseFloat(ask.price)
        const size = parseFloat(ask.size)
        return {
            totalSize: acc.totalSize + size,
            weightedPrice: acc.weightedPrice + (price * size),
            levels: acc.levels + 1
        }
    }, { totalSize: 0, weightedPrice: 0, levels: 0 })
    
    return {
        bids: {
            totalSize: bidsDepth.totalSize,
            averagePrice: bidsDepth.totalSize > 0 ? bidsDepth.weightedPrice / bidsDepth.totalSize : null,
            levels: bidsDepth.levels
        },
        asks: {
            totalSize: asksDepth.totalSize,
            averagePrice: asksDepth.totalSize > 0 ? asksDepth.weightedPrice / asksDepth.totalSize : null,
            levels: asksDepth.levels
        }
    }
}

/**
 * Estimate slippage for a given order size
 * @param {Object} book - Order book with bids and asks arrays
 * @param {string} side - "BUY" or "SELL"
 * @param {number} size - Order size in shares
 * @returns {Object|null} Slippage estimate or null
 */
export function estimateSlippage(book, side, size) {
    if (!book || !size || size <= 0) return null
    
    const isBuy = side === "BUY" || side === "buy"
    const orders = isBuy ? (book.asks || []) : (book.bids || [])
    
    if (orders.length === 0) return null
    
    let remainingSize = size
    let totalCost = 0
    let levelsUsed = 0
    
    for (const order of orders) {
        const orderPrice = parseFloat(order.price)
        const orderSize = parseFloat(order.size)
        
        if (remainingSize <= 0) break
        
        const sizeToTake = Math.min(remainingSize, orderSize)
        totalCost += sizeToTake * orderPrice
        remainingSize -= sizeToTake
        levelsUsed++
    }
    
    if (remainingSize > 0) {
        // Not enough liquidity
        return {
            canFill: false,
            fillableSize: size - remainingSize,
            estimatedPrice: totalCost / (size - remainingSize),
            levelsUsed
        }
    }
    
    const averagePrice = totalCost / size
    const bestPrice = isBuy 
        ? (book.asks?.[0] ? parseFloat(book.asks[0].price) : null)
        : (book.bids?.[0] ? parseFloat(book.bids[0].price) : null)
    
    const slippage = bestPrice ? Math.abs(averagePrice - bestPrice) : 0
    const slippagePercent = bestPrice ? (slippage / bestPrice) * 100 : 0
    
    return {
        canFill: true,
        fillableSize: size,
        estimatedPrice: averagePrice,
        bestPrice,
        slippage,
        slippagePercent,
        levelsUsed
    }
}

