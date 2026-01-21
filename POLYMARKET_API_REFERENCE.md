# Polymarket API Documentation Reference

## Base Endpoints

### Gamma API (Market Data)
- **Base URL**: `https://gamma-api.polymarket.com`
- **Purpose**: Fetch market information, events, tags, profiles, search

### Data API (User Activity)
- **Base URL**: `https://data-api.polymarket.com`
- **Purpose**: User activity, trades, positions, historical data

### CLOB API (Order Book & Trading)
- **Base URL**: `https://clob.polymarket.com`
- **Purpose**: Central Limit Order Book - placing orders, getting prices, trade execution

---

## Data API Endpoints

### GET /activity
Returns on-chain activity for a user.

**Query Parameters:**
- `user` (string, required): User Profile Address (0x-prefixed, 40 hex chars)
  - Example: "0x56687bf447db6ffa42ffe2204a05edaa20f55839"
- `limit` (integer, default: 100): Range 0-500
- `offset` (integer, default: 0): Range 0-10000
- `market` (string[]): Comma-separated list of condition IDs (mutually exclusive with eventId)  
  - Format: 0x-prefixed 64-hex string
- `eventId` (integer[]): Comma-separated list of event IDs (mutually exclusive with market)
  - Range: x >= 1
- `type` (enum<string>[]): Activity types
  - Options: TRADE, SPLIT, MERGE, REDEEM, REWARD, CONVERSION, MAKER_REBATE
- `start` (integer): Range x >= 0
- `end` (integer): Range x >= 0  
- `sortBy` (enum<string>, default: TIMESTAMP): Options: TIMESTAMP, TOKENS, CASH
- `sortDirection` (enum<string>, default: DESC): Options: ASC, DESC
- `side` (enum<string>): Options: BUY, SELL

**Response (200):**
```json
{
  "proxyWallet": "string",        // User Profile Address
  "timestamp": "integer<int64>",
  "conditionId": "string",        // 0x-prefixed 64-hex string
  "type": "enum<string>",         // TRADE, SPLIT, MERGE, REDEEM, etc
  "size": "number",
  "usdcSize": "number",
  "transactionHash": "string",
  "price": "number",
  "asset": "string",
  "side": "enum<string>",         // BUY, SELL
  "outcomeIndex": "integer",
  "title": "string",              // Market title/question
  "slug": "string",
  "icon": "string",               // Market icon URL
  "eventSlug": "string",
  "outcome": "string",
  "name": "string",               // User name
  "pseudonym": "string",
  "bio": "string",
  "profileImage": "string",
  "profileImageOptimized": "string"
}
```

---

## Gamma API Endpoints

### GET /markets
Fetch market data by condition ID or other parameters.

**Query Parameters:**
- `condition_id` (string): 0x-prefixed 64-hex string
- Other filters available (see full documentation)

**Response:**
Returns array of market objects with:
- `question`: Market question/title
- `icon`: Market icon URL
- `image`: Market image URL  
- `slug`: Market slug for URL
- `category`: Market category
- `description`: Market description
- `endDate`: Market end date
- `volume`: Trading volume
- `outcomePrices`: Array of current outcome prices
- `outcomes`: Array of outcome names

---

## CLOB API Endpoints

### Client Methods (via polymarket-clob-client)

#### client.getTrades(params)
Get trades for authenticated user.

**Parameters:**
- `limit` (number, optional): Number of trades to return

**Returns:** Array of trade objects:
```javascript
{
  market: "string",      // Condition ID
  side: "BUY" | "SELL",
  outcome: "string",     // Outcome name (e.g., "Yes", "No")
  size: "string",        // Trade size
  price: "string",       // Trade price
  match_time: number,    // Unix timestamp
  timestamp: number      // Alternative timestamp field
}
```

---

## Usage Notes

### CORS Handling
- All API endpoints require CORS proxy for browser usage
- Use Vercel proxy at `/api/gamma-api/*` and `/api/data-api/*`

### Rate Limits
- Gamma API: Rate limits apply (check API Rate Limits documentation)
- Data API: Rate limits apply
- CLOB: Authenticated requests have higher limits

### Authentication
- Data API `/activity`: Works without auth for public data
- CLOB client methods: Require L2 authentication (API key)
- Use `client.createApiKey()` or `client.deriveApiKey()` for auth

---

## Example Calls

### Fetch User Activity
```javascript
const params = new URLSearchParams({
    user: '0x...',
    limit: '100',
    offset: '0',
    sortBy: 'TIMESTAMP',
    sortDirection: 'DESC'
})
const response = await fetch(`https://data-api.polymarket.com/activity?${params}`)
const activities = await response.json()
```

### Fetch Market Data
```javascript
const conditionId = '0x...'
const response = await fetch(`https://gamma-api.polymarket.com/markets?condition_id=${conditionId}`)
const markets = await response.json()
const market = Array.isArray(markets) ? markets[0] : markets
```

### Get User Trades (Authenticated)
```javascript
const trades = await client.getTrades({ limit: 100 })
// Sort by most recent
trades.sort((a, b) => (b.match_time || b.timestamp) - (a.match_time || a.timestamp))
```

---

## Additional Resources

- Full Documentation: https://docs.polymarket.com
- GitHub: https://github.com/polymarket
- Discord: https://discord.gg/polymarket
