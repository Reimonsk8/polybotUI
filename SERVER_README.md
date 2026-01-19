# Polymarket Proxy Server

This proxy server handles CORS issues for Polymarket APIs.

## Deployment

This server is deployed to Vercel at: https://polybot-mine.vercel.app

## Routes

- `/` - Health check
- `/api/data` - Proxy for Polymarket events
- `/api/health` - Health endpoint
- `/gamma-api/*` - Proxy for Gamma API (profiles, etc.)

## Local Development

```bash
npm run server
```

Server runs on http://localhost:3001

## Vercel Deployment

The server automatically deploys to Vercel on push to main branch.

Last updated: 2026-01-18
