# Polymarket L2 Authentication & WebSocket

## L2 Authentication
- **Requirements**:
    - `POLY_API_KEY`
    - `POLY_API_SECRET`
    - `POLY_PASSPHRASE`
- **Signature**: Requests must be signed using the L2 Key (not necessarily the wallet private key, though often derived from it).
- **Header**: `POLY_SIGNATURE` header is required for private endpoints (`POST /order`, `DELETE /order`).

## WebSocket Integration
- **Endpoint**: `wss://ws-subscriptions-clob.polymarket.com/ws/market`
- **Heartbeat**: Send `{"type": "ping"}` every 30s to keep connection alive.
- **Subscriptions**:
    - `{"assets_ids": ["..."], "type": "market"}` (Orderbook updates)
    - `{"assets_ids": ["..."], "type": "price"}` (Price updates - optional, derived from market)
- **Data Handling**:
    - WebSocket messages provide "delta" or "snapshot" updates.
    - Always handle "reconnect" logic for dropped connections.

## Auth Headers Example (Pseudo-code)
```javascript
const headers = {
    'POLY-API-KEY': apiKey,
    'POLY-TIMESTAMP': timestamp,
    'POLY-SIGNATURE': sign(timestamp + method + path + body, apiSecret),
    'POLY-PASSPHRASE': passphrase
}
```
