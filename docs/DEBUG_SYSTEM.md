# 🐞 Debug System Guide

I have integrated a robust **Debug Console** directly into the app to help you confirm exactly what is happening under the hood.

## How to use it

1.  Look for the **🐞 Debug (0)** button at the bottom-right of your screen.
2.  Click it to open the console.
3.  Perform a trade (Buy, Sell, or Redeem).
4.  Watch the logs appear in real-time.

## What logs mean

| Step | Status | Meaning |
| :--- | :--- | :--- |
| **Safe Check** | 🔵 Pending | Checking if your Safe wallet exists... |
| **Safe Check** | 🟢 Success | Your Safe is ready for gasless trades. |
| **Init Relayer** | ℹ️ Info | Shows which API Key you are using (masked). **Verify this!** |
| **Market Order** | ⚠️ Warning | Gasless failed, falling back to standard (usually config issue). |

## Troubleshooting "Invalid Authorization" (401)

If you see `401 Unauthorized` in the logs:
- It means your **API Credentials** are rejected by the Relayer.
- **Solution:** Ensure `VITE_API_KEY` in your `.env` is a **Builder API Key** (from Profile -> API Keys), NOT a temporary session key or L2 proxy key.

## Troubleshooting "Invalid Nonce" (400)

If you see `400 Bad Request` with `invalid nonce`:
1.  Open Debug Console.
2.  Click the **⏰ Time** button.
3.  It will fetch the server time.
4.  If it differs from your computer time by more than **2 seconds**, you must sync your Windows clock (Date & Time settings -> "Sync now").

## Files Added/Modified
- `src/components/Debug/DebugPanel.jsx` (New UI)
- `src/utils/debugLogger.js` (Log logic)
- `src/utils/relayerClient.js` (Added logging)
- `src/utils/marketOrders.js` (Added logging)
