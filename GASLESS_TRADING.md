# 🚀 Gasless Trading - Quick Start

## What's New?

Your Polybot now supports **GASLESS, FEE-FREE trading** using Polymarket's Builder Relayer! 

### Benefits
- ⚡ **Zero Gas Fees** - Polymarket pays all transaction costs
- 💰 **Zero Trading Fees** - No fees on buy/sell orders  
- 🔄 **Automatic** - Works transparently in the background
- 🛡️ **Safe** - Automatic fallback to standard trading if needed

## Quick Setup (2 minutes)

### 1. Get API Credentials

Your Polymarket API credentials serve **two purposes**:
1. L2 Authentication (access your account)
2. Gasless Trading (zero fees!)

Get them from:
- `client.createApiKey()` or `client.deriveApiKey()` in your code
- polymarket.com/settings
- Your Builder Profile at polymarket.com/builders

### 2. Add to `.env`

```bash
# Copy .env.example to .env if you haven't already
cp .env.example .env

# Add your API credentials (used for BOTH L2 auth AND gasless trading)
VITE_API_KEY=your_api_key_here
VITE_API_SECRET=your_secret_here
VITE_API_PASSPHRASE=your_passphrase_here

# Your private key (required)
VITE_PRIVATE_KEY=0xyour_private_key_here
```

### 3. Restart Dev Server

```bash
npm run dev
```

## That's It! 🎉

All your trades now execute **gaslessly**:
- Manual sells: Click "Sell" → Executes with no gas ⚡
- Auto-sell: Automatic gasless execution ⚡
- Redemptions: Claim winnings gaslessly ⚡

## How to Verify

Look for these indicators:

**Console:**
```
[Market Order] ✅ Gasless SELL executed successfully!
```

**Toast Notifications:**
```
✅ Sold! Executed at $0.6234 (Market Order ⚡ GASLESS)
```

## Troubleshooting

### Not seeing "GASLESS" indicator?

1. **Check `.env` file** - Ensure all 3 API credentials are set:
   - `VITE_API_KEY`
   - `VITE_API_SECRET`
   - `VITE_API_PASSPHRASE`
2. **Restart dev server** - `npm run dev`
3. **Check console** - Look for `[Market Order] Attempting gasless execution...`
4. **Verify login** - Must be logged in with private key

### Still using gas?

The system automatically falls back to standard trading if:
- API credentials are missing or incomplete
- Relayer is unavailable
- Network issues occur

This ensures you can always trade, even if gasless fails!

## Full Documentation

For detailed information, see:
- [Gasless Trading Guide](./docs/gasless-trading-guide.md)
- [Relayer Client Docs](./docs/polymarket-relayer-client.md)

## Security Note

⚠️ **Never commit `.env` to git!** 

Your `.env` file contains sensitive credentials and is already in `.gitignore`.

---

**Happy Gasless Trading! ⚡💰**
