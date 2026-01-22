# PolyBot UI - Advanced Polymarket Portfolio & Trading

Detailed and real-time portfolio management dashboard for Polymarket. Monitor live positions, track P&L with real-time CLOB data, and execute instant gas-less trades directly from your dashboard.

## 🚀 Live Demo
**[https://reimonsk8.github.io/polybotUI/](https://reimonsk8.github.io/polybotUI/)**

---

## ✨ Features

### 💼 Portfolio Management
- **Dashboard View**: See all your Active Bets, Closed Positions, and Activity Log in one place.
- **Real-Time P&L**: Live profit/loss updates based on the current Order Book (Best Bid) prices.
- **Visuals**: Position cards with market icons, outcome badges (YES/NO), and detailed stats.
- **Authentication**: Supports Login via Private Key (EOA) or API Credentials.

### ⚡ Direct Trading
- **Instant "Sell All"**: One-click liquidation of positions at the best available market price.
- **Gas-Less Trading**: Fully supports **Type 1 (Poly Proxy)** and **Type 2 (Gnosis Safe)** signatures for free sponsored transactions.
- **Smart Price Execution**: Automatically fetching the real-time Order Book to execute sales at the optimal price, with fallback protection and price clamping.

### 🔌 Real-Time Data
- **WebSocket Integration**: Subscribes to your personal trade events for instant updates.
- **Auto-Refresh**: Polls market prices every 2 seconds to keep portfolio values accurate.
- **Status Indicators**: Visual cues (⚡ Lightning Bolt) showing which data is live from the exchange.

---

## 🛠️ Architecture

This application uses a hybrid approach to ensure speed and bypass CORS restrictions:

1.  **Frontend (React + Vite)**:
    *   **Direct CLOB Connection**: Connects directly to `clob.polymarket.com` for extremely fast trading execution and Order Book checks.
    *   **Live Data**: Uses Polymarket WebSockets for trade confirmation.
2.  **Serverless Proxy (Vercel)**:
    *   **Data API Bridge**: Proxies requests to `data-api.polymarket.com` (Positions, Balance) and `gamma-api.polymarket.com` (Profiles) to bypass browser CORS policies.

---

## 🔐 Authentication Modes

The app supports multiple login methods to match your Polymarket account type:

| Method | User Type | Description |
| :--- | :--- | :--- |
| **Email / Google** | **Type 1 (Poly Proxy)** | **Recommended**. Uses the proxy wallet automatically created by Polymarket for Magic Link users. Fast, gas-less trading. |
| **Metamask** | **Type 2 (Gnosis)** | For users who connect via browser wallet. Also gas-less. |
| **Private Key** | **Type 0 (EOA)** | Direct wallet access. Standard method for bots or advanced users. |

*Note: Your credentials are used locally to sign messages and are stored in your browser's Session Storage only.*

---

## 📦 Installation (Local)

1. **Clone the repository**:
   ```bash
   git clone https://github.com/Reimonsk8/polybotUI.git
   cd polybotUI
   ```

2. **Install dependencies**:
   ```bash
   npm install
   ```

3. **Set up Environment Variables**:
   Create a `.env` file based on `.env.example`:
   ```bash
   # Optional: Your Proxy Wallet Address for faster login
   VITE_PROXY_WALLET_ADDRESS=0x...
   ```

4. **Run Development Server**:
   ```bash
   npm run dev
   # Opens http://localhost:5173
   ```

---

## 📖 How to Use

1.  **Login**: Use the "Login" button to enter your Private Key or API Credentials.
2.  **View Portfolio**: Your active positions will load automatically.
3.  **Toggle Live Updates**: Switch on "Live Updates" to see real-time price changes.
4.  **Sell Positions**: Click the red **"💸 Sell All"** button on any position to exit immediately at the best available price.

---

## 🤝 Contributing
Contributions are welcome! Please fork the repo and submit a PR for any features or fixes.

## 📝 License
MIT License - Open for modification and use.
