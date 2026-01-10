# Deployment Guide

## Problem
- Direct API calls to Polymarket are blocked by CORS
- Need a backend proxy server
- Friends can't access `localhost:3001`

## Solution: Deploy Backend to Vercel

### Step 1: Install Vercel CLI
```bash
npm install -g vercel
```

### Step 2: Deploy the Backend
```bash
# Login to Vercel
vercel login

# Deploy the project
vercel

# Follow the prompts:
# - Set up and deploy? Yes
# - Which scope? (select your account)
# - Link to existing project? No
# - Project name? polybot-api (or whatever you want)
# - Directory? ./
# - Override settings? No
```

### Step 3: Get Your Production URL
After deployment, Vercel will give you a URL like:
```
https://polybot-api-xxxxx.vercel.app
```

### Step 4: Update GitHub Pages Environment Variable
Create a file `.env.production` in your project:
```
VITE_API_URL=https://polybot-api-xxxxx.vercel.app
```

### Step 5: Update GitHub Actions Workflow
The workflow needs to use the production API URL when building.

Add this to `.github/workflows/deploy.yml` in the "Build" step:
```yaml
- name: Build
  run: npm run build
  env:
    NODE_ENV: production
    VITE_API_URL: https://polybot-api-xxxxx.vercel.app  # Add your Vercel URL here
```

### Step 6: Push and Deploy
```bash
git add .
git commit -m "Add Vercel backend deployment"
git push origin main
```

## For Local Development
The app will automatically use `http://localhost:3001` when running locally.

Just make sure `npm run server` is running!

## Testing
1. **Local**: `npm run dev` + `npm run server` → Uses localhost:3001
2. **Production**: GitHub Pages → Uses Vercel backend

---

## Quick Commands
```bash
# Deploy backend to Vercel
vercel

# Deploy backend to production
vercel --prod

# Check deployment status
vercel ls
```
