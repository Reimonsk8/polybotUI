# Polymarket Builders Program - Relayer Client

Use Polymarket's Polygon relayer to execute gasless transactions for your users

## Overview

The Relayer Client routes onchain transactions through Polymarket's infrastructure, providing gasless transactions for your users. Builder authentication is required to access the relayer.

### Key Features

- **Gasless Transactions**: Polymarket pays all gas fees
- **Wallet Deployment**: Deploy Safe or Proxy wallets
- **CTF Operations**: Split, merge, and redeem positions

## Builder API Credentials

Each builder receives API credentials from their Builder Profile:

| Credential | Description |
|------------|-------------|
| `key` | Your builder API key identifier |
| `secret` | Secret key for signing requests |
| `passphrase` | Additional authentication passphrase |

> **Security Notice**: Your Builder API keys must be kept secure. Never expose them in client-side code.

## Installation

### TypeScript
```bash
npm install @polymarket/builder-relayer-client
```

### Python
```bash
pip install py-order-utils
```

## Relayer Endpoint

All relayer requests are sent to Polymarket's relayer service on Polygon:

```
https://relayer-v2.polymarket.com/
```

## Signing Methods

### Remote Signing (Recommended)

Remote signing keeps your credentials secure on a server you control.

**How it works:**
1. Client sends request details to your signing server
2. Your server generates the HMAC signature
3. Client attaches headers and sends to relayer

#### Server Implementation

Your signing server receives request details and returns the authentication headers:

**TypeScript:**
```typescript
import { 
  buildHmacSignature, 
  BuilderApiKeyCreds 
} from "@polymarket/builder-signing-sdk";

const BUILDER_CREDENTIALS: BuilderApiKeyCreds = {
  key: process.env.POLY_BUILDER_API_KEY!,
  secret: process.env.POLY_BUILDER_SECRET!,
  passphrase: process.env.POLY_BUILDER_PASSPHRASE!,
};

// POST /sign - receives { method, path, body } from the client SDK
export async function handleSignRequest(request) {
  const { method, path, body } = await request.json();
  
  const timestamp = Date.now().toString();
  
  const signature = buildHmacSignature(
    BUILDER_CREDENTIALS.secret,
    parseInt(timestamp),
    method,
    path,
    body
  );

  return {
    POLY_BUILDER_SIGNATURE: signature,
    POLY_BUILDER_TIMESTAMP: timestamp,
    POLY_BUILDER_API_KEY: BUILDER_CREDENTIALS.key,
    POLY_BUILDER_PASSPHRASE: BUILDER_CREDENTIALS.passphrase,
  };
}
```

> **Important**: Never commit credentials to version control. Use environment variables or a secrets manager.

#### Client Configuration

Point your client to your signing server:

**TypeScript:**
```typescript
import { createWalletClient, http, Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { polygon } from "viem/chains";
import { RelayClient } from "@polymarket/builder-relayer-client";
import { BuilderConfig } from "@polymarket/builder-signing-sdk";

// Create wallet
const account = privateKeyToAccount(process.env.PRIVATE_KEY as Hex);
const wallet = createWalletClient({
  account,
  chain: polygon,
  transport: http(process.env.RPC_URL)
});

// Configure remote signing
const builderConfig = new BuilderConfig({
  remoteBuilderConfig: { 
    url: "https://your-server.com/sign" 
  }
});

const RELAYER_URL = "https://relayer-v2.polymarket.com/";
const CHAIN_ID = 137;

const client = new RelayClient(
  RELAYER_URL,
  CHAIN_ID,
  wallet,
  builderConfig
);
```

### Local Signing

With local signing, the SDK constructs and attaches authentication headers automatically using credentials stored locally.

## Authentication Headers

The SDK automatically generates and attaches these headers to each request:

| Header | Description |
|--------|-------------|
| `POLY_BUILDER_API_KEY` | Your builder API key |
| `POLY_BUILDER_TIMESTAMP` | Unix timestamp of signature creation |
| `POLY_BUILDER_PASSPHRASE` | Your builder passphrase |
| `POLY_BUILDER_SIGNATURE` | HMAC signature of the request |

With local signing, the SDK constructs and attaches these headers automatically. With remote signing, your server must return these headers (see Server Implementation above), and the SDK attaches them to the request.

## Wallet Types

Choose your wallet type before using the relayer:

### Safe Wallets

Gnosis Safe-based proxy wallets that require explicit deployment before use.

- **Best for**: Most builder integrations
- **Deployment**: Call `client.deploy()` before first transaction
- **Gas fees**: Paid by Polymarket

**TypeScript:**
```typescript
const client = new RelayClient(
  "https://relayer-v2.polymarket.com", 
  137,
  eoaSigner, 
  builderConfig, 
  RelayerTxType.SAFE  // Default
);

// Deploy before first use
const response = await client.deploy();
const result = await response.wait();
console.log("Safe Address:", result?.proxyAddress);
```

### Proxy Wallets

Alternative wallet type for specific use cases.

## Usage

### Deploy a Wallet

For Safe wallets, deploy before executing transactions:

**TypeScript:**
```typescript
const response = await client.deploy();
const result = await response.wait();

if (result) {
  console.log("Safe deployed successfully!");
  console.log("Transaction Hash:", result.transactionHash);
  console.log("Safe Address:", result.proxyAddress);
}
```

### Execute Transactions

The execute method sends transactions through the relayer. Pass an array of transactions to batch multiple operations in a single call.

**TypeScript:**
```typescript
interface Transaction {
  to: string;    // Target contract or wallet address
  data: string;  // Encoded function call (use "0x" for simple transfers)
  value: string; // Amount of MATIC to send (usually "0")
}

const response = await client.execute(transactions, "Description");
const result = await response.wait();

if (result) {
  console.log("Transaction confirmed:", result.transactionHash);
}
```

## Transaction Examples

### Transfer

Transfer tokens to any address (e.g., withdrawals):

**TypeScript:**
```typescript
import { encodeFunctionData, parseUnits } from "viem";

const transferTx = {
  to: "0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174", // USDCe
  data: encodeFunctionData({
    abi: [{
      name: "transfer",
      type: "function",
      inputs: [
        { name: "to", type: "address" },
        { name: "amount", type: "uint256" }
      ],
      outputs: [{ type: "bool" }]
    }],
    functionName: "transfer",
    args: [
      "0xRecipientAddressHere",
      parseUnits("100", 6) // 100 USDCe (6 decimals)
    ]
  }),
  value: "0"
};

const response = await client.execute([transferTx], "Transfer USDCe");
await response.wait();
```

### Approve

Approve a contract to spend tokens on your behalf:

**TypeScript:**
```typescript
import { encodeFunctionData, parseUnits } from "viem";

const approveTx = {
  to: "0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174", // USDCe
  data: encodeFunctionData({
    abi: [{
      name: "approve",
      type: "function",
      inputs: [
        { name: "spender", type: "address" },
        { name: "amount", type: "uint256" }
      ],
      outputs: [{ type: "bool" }]
    }],
    functionName: "approve",
    args: [
      "0x4bFb41d5B3570DeFd03C39a9A4D8dE6Bd8B8982E", // CTF Exchange
      parseUnits("1000", 6) // Approve 1000 USDCe
    ]
  }),
  value: "0"
};

const response = await client.execute([approveTx], "Approve USDCe");
await response.wait();
```

### Redeem Positions

Redeem winning positions from resolved markets:

**TypeScript:**
```typescript
import { encodeFunctionData } from "viem";

const redeemTx = {
  to: "0x4d97dcd97ec945f40cf65f87097ace5ea0476045", // CTF
  data: encodeFunctionData({
    abi: [{
      name: "redeemPositions",
      type: "function",
      inputs: [
        { name: "collateralToken", type: "address" },
        { name: "parentCollectionId", type: "bytes32" },
        { name: "conditionId", type: "bytes32" },
        { name: "indexSets", type: "uint256[]" }
      ]
    }],
    functionName: "redeemPositions",
    args: [
      "0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174", // USDCe
      "0x0000000000000000000000000000000000000000000000000000000000000000",
      conditionId,
      [1, 2] // Index sets for YES and NO
    ]
  }),
  value: "0"
};

const response = await client.execute([redeemTx], "Redeem positions");
await response.wait();
```

### Split Positions

Split collateral into outcome tokens:

**TypeScript:**
```typescript
import { encodeFunctionData, parseUnits } from "viem";

const splitTx = {
  to: "0x4d97dcd97ec945f40cf65f87097ace5ea0476045", // CTF
  data: encodeFunctionData({
    abi: [{
      name: "splitPosition",
      type: "function",
      inputs: [
        { name: "collateralToken", type: "address" },
        { name: "parentCollectionId", type: "bytes32" },
        { name: "conditionId", type: "bytes32" },
        { name: "partition", type: "uint256[]" },
        { name: "amount", type: "uint256" }
      ]
    }],
    functionName: "splitPosition",
    args: [
      "0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174", // USDCe
      "0x0000000000000000000000000000000000000000000000000000000000000000",
      conditionId,
      [1, 2],
      parseUnits("100", 6) // Split 100 USDCe
    ]
  }),
  value: "0"
};

const response = await client.execute([splitTx], "Split position");
await response.wait();
```

### Merge Positions

Merge outcome tokens back into collateral:

**TypeScript:**
```typescript
import { encodeFunctionData, parseUnits } from "viem";

const mergeTx = {
  to: "0x4d97dcd97ec945f40cf65f87097ace5ea0476045", // CTF
  data: encodeFunctionData({
    abi: [{
      name: "mergePositions",
      type: "function",
      inputs: [
        { name: "collateralToken", type: "address" },
        { name: "parentCollectionId", type: "bytes32" },
        { name: "conditionId", type: "bytes32" },
        { name: "partition", type: "uint256[]" },
        { name: "amount", type: "uint256" }
      ]
    }],
    functionName: "mergePositions",
    args: [
      "0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174", // USDCe
      "0x0000000000000000000000000000000000000000000000000000000000000000",
      conditionId,
      [1, 2],
      parseUnits("50", 6) // Merge 50 tokens
    ]
  }),
  value: "0"
};

const response = await client.execute([mergeTx], "Merge positions");
await response.wait();
```

### Batch Transactions

Execute multiple transactions in a single call:

**TypeScript:**
```typescript
const transactions = [
  approveTx,
  splitTx,
  // ... more transactions
];

const response = await client.execute(
  transactions, 
  "Batch: Approve and Split"
);
await response.wait();
```

## Reference

### Contracts & Approvals

| Contract | Address | USDCe | Outcome Tokens |
|----------|---------|-------|----------------|
| USDCe | `0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174` | — | — |
| CTF | `0x4d97dcd97ec945f40cf65f87097ace5ea0476045` | ✅ | — |
| CTF Exchange | `0x4bFb41d5B3570DeFd03C39a9A4D8dE6Bd8B8982E` | ✅ | ✅ |
| Neg Risk CTF Exchange | `0xC5d563A36AE78145C45a50134d48A1215220f80a` | ✅ | ✅ |
| Neg Risk Adapter | `0xd91E80cF2E7be2e162c6513ceD06f1dD0dA35296` | — | ✅ |

### Transaction States

| State | Description |
|-------|-------------|
| `STATE_NEW` | Transaction received by relayer |
| `STATE_EXECUTED` | Transaction executed onchain |
| `STATE_MINED` | Transaction included in a block |
| `STATE_CONFIRMED` | Transaction confirmed (final ✅) |
| `STATE_FAILED` | Transaction failed (terminal ❌) |
| `STATE_INVALID` | Transaction rejected as invalid (terminal ❌) |

### TypeScript Types

```typescript
interface Transaction {
  to: string;
  data: string;
  value: string;
}

interface TransactionResult {
  transactionHash: string;
  proxyAddress?: string;
  status: string;
}

enum RelayerTxType {
  SAFE = "SAFE",
  PROXY = "PROXY"
}

interface BuilderApiKeyCreds {
  key: string;
  secret: string;
  passphrase: string;
}
```

## Next Steps

- **Order Attribution**: Attribute orders to your builder account
- **Example Apps**: Complete integration examples
- **API Documentation**: Full API reference at [Polymarket Docs](https://docs.polymarket.com)

## Related Documentation

- [Polymarket API Overview](./polymarket-api-overview.md)
- [Polymarket Authentication](./polymarket-auth.md)
- [Polymarket CLOB](./polymarket-clob.md)
- [Redeeming Positions](./redeeming-positions.md)
- [Redemption Implementation](./redemption-implementation.md)
