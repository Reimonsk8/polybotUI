# 📊 Real-Time WebSocket Chart Feature

## Overview

Click on any market card to open a **real-time chart modal** with live price updates via WebSocket connection to Polymarket's CLOB API!

## ✨ Features

### 🔴 **Live WebSocket Connection**
- Direct connection to `wss://ws-subscriptions-clob.polymarket.com/ws/market`
- Real-time price updates as they happen
- Connection status indicator (🟢 Connected / 🔴 Disconnected)
- Automatic subscription to market token IDs

### 📈 **Interactive Chart**
- **Dual-line chart** showing UP and DOWN prices simultaneously
- **Real-time updates** - chart updates as new data arrives
- **50 data points** kept in memory (last ~5-10 minutes of data)
- **Smooth animations** with Recharts library
- **Hover tooltips** showing exact prices at any point

### 💰 **Current Price Display**
- Large, prominent price cards for both outcomes
- **Percentage probability** (e.g., 52.3%)
- **Exact price** in dollars (e.g., $0.523)
- Color-coded: Green for UP, Red for DOWN

### 📊 **Market Statistics**
- **Volume**: Total trading volume
- **Liquidity**: Available liquidity
- **Data Points**: Number of real-time updates received

## 🎮 How to Use

### Opening the Chart
1. **Fetch market data** (click "Fetch Market Data" button)
2. **Click on any market card** in the timeline
3. **Chart modal opens** with WebSocket connection

### Interacting with the Chart
- **Hover** over the chart to see exact prices at any time
- **Watch** the connection indicator (top right)
- **View** real-time price changes as they happen
- **Close** by clicking the X button or clicking outside the modal

## 🔧 Technical Details

### WebSocket Protocol

The chart connects to Polymarket's WebSocket API:

```javascript
// Connection
wss://ws-subscriptions-clob.polymarket.com/ws/market

// Subscribe Message
{
  "assets_ids": ["TOKEN_ID_1", "TOKEN_ID_2"],
  "type": "market"
}

// Received Messages
{
  "event_type": "book" | "last_trade_price",
  "asset_id": "TOKEN_ID",
  "price": "0.523",
  ...
}
```

### Data Flow

```
User Click → Open Modal → WebSocket Connect → Subscribe to Tokens
                                ↓
                        Receive Price Updates
                                ↓
                        Update Chart in Real-Time
```

### Chart Library

Uses **Recharts** for smooth, responsive charting:
- Automatic scaling
- Responsive container
- Custom tooltips
- Gradient colors matching theme

## 📊 Chart Features

### X-Axis (Time)
- Shows local time (HH:MM:SS)
- Updates automatically with new data
- Scrolls to show latest data

### Y-Axis (Price)
- Range: 0% to 100%
- Formatted as percentages
- Auto-scales based on data

### Lines
- **Green Line**: UP outcome probability
- **Red Line**: DOWN outcome probability
- **Smooth curves**: Monotone interpolation
- **Active dots**: Hover to see exact values

## 🎨 Design

### Modal
- **Dark theme** matching app design
- **Glassmorphism** backdrop blur
- **Smooth animations** on open/close
- **Responsive** - works on all screen sizes

### Colors
- **UP**: Green (#10b981)
- **DOWN**: Red (#ef4444)
- **Background**: Dark blue gradient
- **Accents**: Purple/blue gradient

## 🔄 Auto-Updates

The chart automatically:
- ✅ Connects to WebSocket on open
- ✅ Subscribes to market tokens
- ✅ Updates chart as data arrives
- ✅ Maintains last 50 data points
- ✅ Disconnects on close

## 📱 Responsive Design

Works perfectly on:
- 💻 **Desktop**: Full-width modal with large chart
- 📱 **Mobile**: Full-screen modal, touch-friendly
- 📊 **Tablet**: Optimized layout

## 🚀 Performance

- **Lightweight**: Only loads when modal opens
- **Efficient**: Limits data points to 50
- **Fast**: WebSocket for instant updates
- **Clean**: Auto-disconnects on close

## 🎯 Example Use Cases

### 1. **Active Trading**
- Open chart for market closing soon
- Watch real-time price movements
- Make informed trading decisions

### 2. **Market Analysis**
- Compare UP vs DOWN trends
- Identify price patterns
- Track volatility

### 3. **Quick Checks**
- Click any market for instant chart
- See current prices at a glance
- Monitor multiple markets

## 💡 Pro Tips

1. **Watch the connection indicator** - ensure you're getting live data
2. **Hover over the chart** to see exact prices at any point
3. **Keep modal open** to accumulate more data points
4. **Compare markets** by opening different charts
5. **Use with auto-refresh** for best experience

## 🔧 Troubleshooting

### WebSocket Won't Connect?
- Check your internet connection
- Ensure no firewall blocking WebSocket
- Try refreshing the page

### No Data Appearing?
- Wait a few seconds for first update
- Check console for errors
- Verify market has active trading

### Chart Not Updating?
- Check connection status (should be green)
- Ensure WebSocket is connected
- Try closing and reopening modal

---

**Click any market card to see it in action!** 📊🚀
