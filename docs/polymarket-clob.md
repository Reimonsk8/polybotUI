# Polymarket CLOB API Documentation (Snapshot)

## Base URLs
- **REST**: `https://clob.polymarket.com`
- **WebSocket**: `wss://ws-subscriptions-clob.polymarket.com/ws/market`

## Endpoints

### Orderbook
**GET** `/book`
- **Params**: `token_id` (The asset ID from market outcomes, NOT the token address)
- **Description**: Returns the active bids and asks for a specific outcome token.
- **Rules**: 
    - Always check if book exists before ordering.
    - **404 Error** means "No orderbook exists for the requested token id"
    
**Understanding 404 Errors:**

A 404 response typically occurs when:

1. **Market is closed/resolved** ✅ (Most common - orderbooks are removed after resolution)
2. **Invalid token ID** ❌ (Token ID is incorrect or malformed)
3. **Market not yet active** ⏳ (Orderbook hasn't been created yet)

**How to Handle:**
```javascript
try {
  const book = await client.getOrderBook(tokenId)
  // Market is active, proceed with trading
} catch (e) {
  if (e.status === 404 || e.data?.error?.includes("No orderbook exists")) {
    // Market is resolved - switch to redemption flow
    toast.warn("Market has ended. Please redeem your shares.")
    // await client.redeemPositions({ conditionId, indexSets: [1, 2] })
  }
}
```

**Verification:**
- Check if token exists: `GET https://gamma-api.polymarket.com/markets?clob_token_ids=YOUR_TOKEN_ID`
- Check market status: Look for `closed: true` in the response

### Place Order
**POST** `/order`
- **Headers**: Requires L2 Authentication (API Key, Signature, Timestamp, Passphrase).
- **Body**:
    - `tokenID`: The outcome token ID.
    - `price`: Limit price (strictly between 0 and 1).
    - `side`: "BUY" or "SELL".
    - `size`: Amount of shares.
    - `nonce`: Unique, strictly increasing integer (e.g. `Date.now()`).
    - `feeRateBps`: Should be 0 (or omitted) for standard trading unless specified.
- **Response**: Returns `orderID` if successful.

### Cancel Order
**DELETE** `/order` (or via Client SDK `cancel(id)`)
- **Params**: `orderID`
- **Description**: Cancels an active open order.

### Order Status
**GET** `/data/order/{order_id}` (Check SDK for exact method)
- **Description**: Checks status (Open, Filled, Cancelled).

## Important Invariants (DO NOT VIOLATE)

1.  **Token ID**: 
    - `token_id` is the **Asset ID** (e.g. `2174...`), NOT the ERC20 address or Market ID.
    - It must be obtained from the Market Metadata (`clobTokenIds` or similar).

2.  **No Price Endpoint**:
    - `GET /price` **DOES NOT EXIST**.
    - Do not attempt to call it.
    - Derive price from the **Orderbook** (`best_bid`, `best_ask`) or WebSocket stream.

3.  **Nonce Rules**:
    - Must be **strictly increasing**.
    - Must be **unique**.
    - **NEVER** reuse a nonce from a failed request.
    - Recommended: `Date.now() + RandomInt` to avoid collisions.

4.  **Order Types**:
    - Only **LIMIT** orders are supported (FOK/IOC/GTC).
    - No "Market" orders (simulate Market by crossing the spread with a Limit order).
