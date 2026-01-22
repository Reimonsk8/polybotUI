# Polymarket Trading Rules (STRICT)

**All code writing trading logic MUST adhere to these rules.**
Violations are considered critical bugs.

## 1. Safety & Validation
- **Pre-Flight Check**: BEFORE submitting any order, you MUST fetch the Orderbook (`GET /book`) for the target `token_id`.
    - If the book returns 404 or is empty (no liquidity), **ABORT THE TRADE**.
    - Do not "hope" it works.
- **Sanity Check**: Ensure prices are strictly `0 < price < 1`. Clamping to `0.01 - 0.99` is recommended.

## 2. Order Submission
- **Nonce Integrity**: 
    - Generate `nonce` **immediately before** the POST request.
    - Use `Date.now() + Random` or a similar collision-resistant method.
    - **NEVER** reuse a nonce if a request fails. Always generate a fresh one for retries.
- **Confirmation**: All trades must be explicitly confirmed by the user via a UI modal showing strict values (Price, Size, Cost).
- **Limit Orders Only**: Always set a specific price. Never place "blind" orders.

## 3. Error Handling
- **No Automatic Retries**: If an order fails (other than a specific, handled nonce collision), **DO NOT** autoretry.
    - Show the error to the user.
    - Let the user decide to try again.
- **Ignore 404s on Poll**: If fetching prices in a background loop, silently ignore 404s (market might be closed/invalid), but **LOG** them if in a debug environment.

## 4. Endpoints
- **Forbidden**: `GET /price` (Does not exist).
- **Authoritative Source**: Use `GET /book` or WebSocket `level2` channel for pricing data.

## 5. User Feedback
- **Feedback Loop**: UI must show "Submitting" -> "Open" -> "Filled/Cancelled".
- **Visuals**: Disable "Buy/Sell" buttons while an order is pending (`ordering` state).
