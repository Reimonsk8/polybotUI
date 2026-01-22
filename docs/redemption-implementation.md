# Redemption Logic & Implementation

## How Redemption Works

To redeem your winning position after a market resolves, you need to call the `redeemPositions` function on the CTF (Conditional Token Framework) contract.

### Key points:

-   Each winning token redeems for **$1 USDCe**.
-   Losing tokens are worthless (redeem for $0).
-   You can redeem **both YES and NO tokens in one call** — only winners pay out.
-   This removes the need to know which specific token won; you just redeem the Condition ID.

### Gasless Redemption with Relayer

The most efficient way to redeem is using the Relayer Client, which pays the gas fees for you.

```javascript
const redeemTx = {
  to: CTF_ADDRESS, // 0x4d97dcd97ec945f40cf65f87097ace5ea0476045
  data: ctfInterface.encodeFunctionData("redeemPositions", [
    USDCe_ADDRESS,
    ethers.constants.HashZero,
    conditionId,
    [1, 2]  // Redeem both YES and NO index sets
  ]),
  value: "0"
};

// Execute via Relayer
await client.execute([redeemTx], "Redeem winning tokens");
```

## Implementation Details

### `relayerClient.js`
Our application implements this in `redeemPositionsGasless`:
1.  **Checks Safe:** Ensures your Safe wallet is deployed.
2.  **Constructs Transaction:** Uses the binary index sets `[1, 2]` to attempt redemption for both outcomes.
3.  **Executes:** Sends to Polymarket Relayer.

### `PortfolioTabs.jsx`
1.  **Automatic Detection:** When you click "Sell", the app checks if the market is **Resolved**.
    - It does this by checking if the Orderbook fetches `404` or empty.
2.  **Route to Redeem:** If resolved, it calls `redeemPositionsGasless`.
3.  **Fallback:** If gasless fails (e.g., auth error), it falls back to a standard `signer.sendTransaction` call (paying MATIC), now optimized with **gas price boosting** to ensure success.

## References
- [Conditional Token Frameworks](https://docs.gnosis.io/conditionaltokens/)
- [Polymarket CTF Contract](https://polygonscan.com/address/0x4d97dcd97ec945f40cf65f87097ace5ea0476045)
