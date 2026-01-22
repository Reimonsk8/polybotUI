# Fast & Fee-Free Trading Guide

## Overview

Polymarket offers **gasless, fee-free trading** for most markets when using proxy wallets. This guide explains how to optimize for speed and avoid fees.

## Key Points

### ✅ Gasless Trading (Proxy Wallets)
- **Proxy wallets** (created via email/Google signup) are **completely gasless**
- Polymarket pays all gas fees through their relayer
- **No MATIC needed** for trading (only needed for direct blockchain transactions like redemption)
- Applies to:
  - Safe wallets (Gnosis Safe)
  - Proxy wallets (Magic Link users)

### ✅ Fee-Free Trading
- **Most markets have NO trading fees**
- Only 15-minute crypto markets charge taker fees
- Standard prediction markets are fee-free

### ✅ Fastest Execution: Market Orders
- **Market orders** execute immediately at best available price
- No waiting for limit orders to fill
- Better UX for urgent trades
- Implemented as limit orders at best bid/ask (crossing the spread)

## Implementation

### Market Orders (FOK - Fill or Kill)

We've implemented market orders that:
1. Get the order book
2. Find best bid (for SELL) or best ask (for BUY)
3. Place limit order at that price
4. Executes immediately (crosses the spread)

**Usage:**
```javascript
import { placeMarketOrder } from '../utils/marketOrders'

// Sell immediately at best bid
const result = await placeMarketOrder(client, tokenId, "SELL", size)

// Buy immediately at best ask
const result = await placeMarketOrder(client, tokenId, "BUY", dollarAmount, { sizeInDollars: true })
```

### Auto-Sell Bot

The auto-sell bot now uses **market orders by default** for:
- ✅ Fastest execution
- ✅ Immediate fills
- ✅ Better user experience

Falls back to limit orders if market order fails.

### Manual Selling

When users click "Sell All":
1. **First tries**: Market order (FOK) - instant execution
2. **Falls back to**: Limit order if market order fails

## Wallet Detection

The app automatically detects:
- **Proxy wallets** (signatureType 1 or 2) → Gasless trading
- **EOA wallets** (signatureType 0) → May need MATIC for some operations

For proxy wallets:
- ✅ Trading is gasless
- ✅ No MATIC needed
- ⚠️ Redemption still needs MATIC (direct blockchain transaction)

## Best Practices

### 1. Use Market Orders for Speed
```javascript
// Fast execution
await placeMarketOrder(client, tokenId, "SELL", size)
```

### 2. Check Liquidity First
```javascript
import { checkMarketLiquidity } from '../utils/marketOrders'

const liquidity = await checkMarketLiquidity(client, tokenId, "SELL")
if (!liquidity.available) {
    // Handle no liquidity
}
```

### 3. Proxy Wallet Priority
- Always prefer proxy wallets for gasless trading
- Only check MATIC balance for redemption (not trading)

## Error Handling

Market orders will fail if:
- No liquidity (no buyers/sellers)
- Market is closed/resolved
- Order size too large for available liquidity

The app automatically falls back to limit orders in these cases.

## Performance

**Market Orders:**
- ⚡ Instant execution (if liquidity available)
- 💰 No fees (on most markets)
- 🚀 Best user experience

**Limit Orders:**
- ⏳ May take time to fill
- 💰 No fees (on most markets)
- 📊 Better price control

## Summary

1. **Proxy wallets = Gasless trading** ✅
2. **Market orders = Fastest execution** ⚡
3. **Most markets = Fee-free** 💰
4. **MATIC only needed for redemption** (not trading)

The bot is now optimized for fast, fee-free trading!

