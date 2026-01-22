# Redeeming Winning Positions

## When to Redeem vs Sell

### SELL (Active Markets)
- Market is still open/trading
- Order book exists (`/book` returns data)
- Use `client.createAndPostOrder()` with `side: SELL`

### REDEEM (Resolved Markets)
- Market has ended and outcome is determined
- Order book is closed (`/book` returns 404)
- Use `client.redeemPositions()` or CTF contract directly

---

## Redeeming Tokens (Resolved Markets)

Once a market has resolved and payouts are reported, users with winning shares can redeem them for USDC collateral.

### Using CLOB Client SDK

```javascript
// Check if position is redeemable
const position = {
  conditionId: "0x...",  // From position data
  tokenId: "...",        // The winning outcome token
  size: 100              // Number of shares
}

// Redeem winning position
await client.redeemPositions({
  conditionId: position.conditionId,
  indexSets: [1, 2]  // Always [1, 2] for Polymarket binary markets
})
```

### CTF Contract Direct Call

```javascript
// Parameters for redeemPositions
const params = {
  collateralToken: "0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174", // USDCe on Polygon
  parentCollectionId: "0x0000000000000000000000000000000000000000000000000000000000000000", // Null for Polymarket
  conditionId: position.conditionId,
  indexSets: [1, 2]  // Binary outcome partition (YES | NO)
}

await ctfContract.redeemPositions(
  params.collateralToken,
  params.parentCollectionId,
  params.conditionId,
  params.indexSets
)
```

---

## Detection Logic

```javascript
// Try to fetch orderbook
try {
  const book = await client.getOrderBook(tokenId)
  // Book exists → Market is ACTIVE → Use SELL
  return "ACTIVE"
} catch (e) {
  if (e.message.includes("No orderbook exists")) {
    // Book doesn't exist → Market is RESOLVED → Use REDEEM
    return "RESOLVED"
  }
  throw e
}
```

---

## Important Notes

1. **Only winning positions can be redeemed**
   - Losing positions have zero value
   - Check `position.outcome` matches the resolved outcome

2. **Gas costs**
   - Direct CTF calls require gas (ETH/MATIC)
   - Use Relayer Client for gasless redemption

3. **Index Sets**
   - Always `[1, 2]` for Polymarket binary markets
   - Represents the partition: Outcome A | Outcome B

4. **Collateral Token**
   - Polygon: `0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174` (USDCe)
   - This is what you receive when redeeming
