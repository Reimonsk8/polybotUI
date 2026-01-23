# ✅ Claim vs Sell Implementation

I have separated the logic for **Selling** (Trading) and **Claiming** (Redeeming) as requested.

## 1. UI Distinction
-   **Active Markets**: Show a **Red "Sell Position"** button. This attempts to trade on the orderbook.
-   **Resolved Markets**: Show a **Blue "🎁 Claim Winnings"** button. This attempts to redeem Collateral from the CTF contract.

## 2. Logic Flow
-   **Detection**: The app automatically detects if a market is resolved (by checking Orderbook status).
-   **Action**: Clicking "Claim" triggers the `redeemPositions` flow explicitly.
-   **Reliability**: This flow now includes the **50 Gwei Gas Floor** to ensure the transaction processes even during network spikes.

## 3. How to Use
1.  **Reload** the app.
2.  Look for your **FC Barcelona** position.
3.  You should see the **Blue "Claim"** button.
4.  Click it to redeem your $1.00/share.
    - If Gasless fails (401), it will fallback and pay gas (MATIC) to complete the claim.

## 4. Technical Note
The transaction `0x34ee9791` you observed is likely a specialized proxy call. However, the standard `CTF.redeemPositions` call (which we use) is the canonical way to redeem and works for all standard Conditional Tokens.
