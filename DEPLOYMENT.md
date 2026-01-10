# 🚀 GitHub Pages Deployment Guide

## Quick Setup (One-Time)

### 1. Initialize Git Repository

```bash
cd d:\GitHubProjects\polybot-mine
git init
git add .
git commit -m "Initial commit: Bitcoin market tracker with timeline carousel"
```

### 2. Add Remote and Push

```bash
git remote add origin https://github.com/Reimonsk8/polybotUI.git
git branch -M main
git push -u origin main
```

### 3. Enable GitHub Pages

1. Go to your repository: https://github.com/Reimonsk8/polybotUI
2. Click **Settings** → **Pages** (left sidebar)
3. Under **Source**, select:
   - Source: **GitHub Actions**
4. Click **Save**

### 4. Wait for Deployment

- The GitHub Action will automatically run
- Check the **Actions** tab to see deployment progress
- Once complete (green checkmark), your site will be live at:
  **https://reimonsk8.github.io/polybotUI/**

---

## 🔄 Updating Your Site

Every time you push to the `main` branch, the site automatically rebuilds and deploys!

```bash
# Make your changes, then:
git add .
git commit -m "Your update message"
git push
```

---

## ⚠️ Important Notes

### CORS Issue on GitHub Pages

**Problem**: The proxy server (`server.js`) won't run on GitHub Pages (static hosting only).

**Solution**: You have two options:

#### Option 1: Use a Free Backend Service (Recommended)

Deploy the proxy server to a free service:

**Vercel** (Easiest):
```bash
# Install Vercel CLI
npm i -g vercel

# Deploy server
vercel deploy server.js
```

Then update `src/App.jsx` line 17:
```javascript
const response = await fetch(
  `https://your-vercel-url.vercel.app/api/markets?tag_id=102467&limit=20&_t=${Date.now()}`
)
```

**Railway.app** (Alternative):
1. Sign up at https://railway.app
2. Create new project
3. Deploy from GitHub
4. Set start command: `node server.js`

#### Option 2: Direct API Calls (May Have CORS Issues)

Update `src/App.jsx` to call Polymarket API directly:
```javascript
const response = await fetch(
  `https://gamma-api.polymarket.com/events?active=true&closed=false&tag_id=102467&limit=20&_t=${Date.now()}`
)
```

**Note**: This may not work due to CORS restrictions in some browsers.

---

## 📁 Files Created for Deployment

✅ `.github/workflows/deploy.yml` - GitHub Actions workflow  
✅ `vite.config.js` - Updated with base path  
✅ `README.md` - Project documentation  
✅ `.gitignore` - Excludes unnecessary files  

---

## 🐛 Troubleshooting

### Deployment Failed?
- Check the **Actions** tab for error messages
- Ensure `package.json` has all dependencies
- Verify `vite.config.js` has correct base path

### Site Shows Blank Page?
- Check browser console for errors
- Verify base path in `vite.config.js` matches repo name
- Clear browser cache and hard refresh (Ctrl+Shift+R)

### API Not Working?
- Deploy the proxy server separately (see Option 1 above)
- Update API endpoint in `src/App.jsx`

---

## 🎯 Next Steps

1. **Push to GitHub** (see commands above)
2. **Enable GitHub Pages** in repository settings
3. **Deploy proxy server** to Vercel/Railway
4. **Update API endpoint** in code if needed
5. **Share your live site!** 🎉

---

## 📞 Need Help?

- Check GitHub Actions logs for deployment errors
- Review Vite documentation: https://vitejs.dev/guide/static-deploy.html
- Polymarket API docs: https://docs.polymarket.com

---

**Your site will be live at**: https://reimonsk8.github.io/polybotUI/
