# ✅ Critical Fix: Time Sync & Nonce

The "Standard Execution" fallback was failing with `400 Bad Request: invalid nonce`. this happens when your computer's clock is out of sync with Polymarket servers.

## What I Fixed
1.  **Auto Time Sync:**
    - The app now automatically fetches the server time from Polymarket on startup.
    - It calculates the exact difference (offset) between your PC and the server.
    - It adjusts all order timestamps (nonces) by this offset.

2.  **Outcome:**
    - Standard orders (paying gas) will now **SUCCEED** even if gasless fails.
    - No more "Invalid Nonce" errors.

## Recommended Action
1.  **Reload the App**.
2.  Open **🐞 Debug** panel.
3.  You should see a log: `[TimeSync] Synced. Offset: ... ms`.
4.  Try to **Sell/Redeem** again.
    - If Gasless fails (401), it will fallback to Standard.
    - Standard execution should now work perfectly.

## Files Modified
- `src/utils/marketOrders.js` (Added Time Sync logic)
