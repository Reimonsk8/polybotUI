# PolyBot UI - Bitcoin Market Tracker

🎯 Real-time Bitcoin Up/Down prediction market tracker for Polymarket

## 🚀 Live Demo

Visit the live app: **[https://reimonsk8.github.io/polybotUI/](https://reimonsk8.github.io/polybotUI/)**

## ✨ Features

- 📊 **Timeline Carousel** - Horizontal scrolling view of markets sorted by closing time
- ⏰ **Visual Timeline** - Time badges showing countdown to market close
- 🔴 **Urgency Indicators** - Red pulsing badges for markets closing soon (<5 min)
- 💰 **Profit Calculator** - Instant profit calculations for $1 bets
- 🔄 **Auto-Refresh** - Live price updates every 10/30/60 seconds
- 📈 **Real-Time Prices** - Fetches live prices from Polymarket CLOB API
- 🎨 **Premium Dark UI** - Modern design with gradients and animations

## 🛠️ Tech Stack

- **Frontend**: React + Vite
- **Styling**: Vanilla CSS with modern design
- **API**: Polymarket Gamma API + CLOB API
- **Proxy**: Express.js (for CORS bypass)
- **Deployment**: GitHub Pages

## 📦 Installation

```bash
# Clone the repository
git clone https://github.com/Reimonsk8/polybotUI.git
cd polybotUI

# Install dependencies
npm install

# Start development servers
npm run dev      # Frontend (http://localhost:5173)
npm run server   # Proxy server (http://localhost:3001)
```

## 🚀 Deployment

The app automatically deploys to GitHub Pages on every push to `main` branch.

### Manual Deployment

```bash
# Build for production
npm run build

# Preview production build
npm run preview
```

## 📖 How to Use

1. **Fetch Markets**: Click "Fetch Market Data" to load active Bitcoin Up/Down markets
2. **Enable Auto-Refresh**: Toggle auto-refresh for live price updates
3. **Scroll Timeline**: Navigate through markets sorted by closing time
4. **Watch for Urgency**: Red badges indicate markets closing soon
5. **Trade**: Click "Trade →" on any market to go to Polymarket

## 🎯 Market Information

Each market card displays:
- ⏰ Time until close (e.g., "15m", "1h 30m")
- 🎯 Exact closing time
- 📈 UP outcome with probability and profit
- 📉 DOWN outcome with probability and profit
- 💵 Current volume
- 🔗 Direct trade link

## 🔧 Development

### Project Structure

```
polybotUI/
├── src/
│   ├── App.jsx          # Main React component
│   ├── App.css          # Styling
│   └── main.jsx         # Entry point
├── server.js            # Express proxy server
├── .github/
│   └── workflows/
│       └── deploy.yml   # GitHub Pages deployment
└── package.json
```

### API Endpoints

- **Gamma API**: `https://gamma-api.polymarket.com/events`
- **CLOB API**: `https://clob.polymarket.com/price`
- **Local Proxy**: `http://localhost:3001/api/markets`

## 🎨 Features in Detail

### Timeline Carousel
- Horizontal scrolling with snap-to-card behavior
- Markets sorted by closing time (earliest first)
- Visual timeline with dots and connecting lines
- Animated time badges that float

### Auto-Refresh
- Configurable intervals: 10s, 30s, 60s
- Live indicator (🟢 LIVE) when active
- Fetches fresh prices from orderbook
- Updates all markets simultaneously

### Urgency System
- 🔵 Blue badge: >5 minutes remaining
- 🔴 Red pulsing badge: <5 minutes (CLOSING SOON!)
- ⚠️ "CLOSING NOW!": <1 minute remaining

## 📝 License

MIT License - feel free to use and modify!

## 🤝 Contributing

Contributions are welcome! Feel free to:
- Report bugs
- Suggest features
- Submit pull requests

## 🔗 Links

- **Live App**: https://reimonsk8.github.io/polybotUI/
- **GitHub**: https://github.com/Reimonsk8/polybotUI
- **Polymarket**: https://polymarket.com

---

Built with ❤️ for the Polymarket community
