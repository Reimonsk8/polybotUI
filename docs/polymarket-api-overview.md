# Polymarket API Overview

## APIs at a Glance

### Markets & Data

#### Gamma API
**Market discovery & metadata**
- Fetch events, markets, categories, and resolution data
- This is where you discover what's tradeable
- Base URL: `https://gamma-api.polymarket.com`

#### CLOB API
**Prices, orderbooks & trading**
- Get real-time prices, orderbook depth, and place orders
- The core trading API
- Base URL: `https://clob.polymarket.com`

#### Data API
**Positions, activity & history**
- Query user positions, trade history, and portfolio data
- Base URL: `https://data-api.polymarket.com`

#### WebSocket
**Real-time updates**
- Subscribe to orderbook changes, price updates, and order status
- Base URL: `wss://ws-subscriptions-clob.polymarket.com`

---

## Additional Data Sources

### RTDS
**Low-latency data stream**
- Real-time crypto prices and comments
- Optimized for market makers

### Subgraph
**Onchain queries**
- Query blockchain state directly via GraphQL

---

## Trading Infrastructure

### CTF Operations
**Token split/merge/redeem**
- Convert between USDC and outcome tokens
- Essential for inventory management

### Relayer Client
**Gasless transactions**
- Builders can offer gasfree transactions via Polymarket's relayer

---

## SDKs & Libraries

### CLOB Client (TypeScript)
```bash
npm install @polymarket/clob-client
```

### CLOB Client (Python)
```bash
pip install py-clob-client
```

### For Builders Routing Orders for Users:
- **Relayer Client**: Gasless wallet operations
- **Signing SDK**: Builder authentication headers

---

## What Can You Build?

| If you want to...                  | Start here                    |
|------------------------------------|-------------------------------|
| Fetch markets & prices             | Gamma API + CLOB API          |
| Place orders for yourself          | CLOB Client SDK               |
| Build a trading app for users      | Builders Program + Relayer    |
| Provide liquidity                  | Market Makers (CLOB API)      |

---

## Quick Start Workflow

1. **Discovery**: Use Gamma API to find markets
2. **Pricing**: Use CLOB API `/book` to get orderbook
3. **Trading**: Use CLOB Client SDK to place orders
4. **Monitoring**: Subscribe to WebSocket for real-time updates
5. **History**: Use Data API to query positions and trades
