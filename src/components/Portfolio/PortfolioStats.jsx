import './Portfolio.css'

const PortfolioStats = ({ totalValue, cashBalance, isL2Authenticated, positionCount }) => {
    // Safely format total value, handling NaN and null
    const formatValue = (val) => {
        if (val === null || val === undefined || isNaN(val)) {
            return '---'
        }
        return `$${parseFloat(val).toFixed(2)}`
    }

    return (
        <div className="stats-grid">
            <div className="stat-card">
                <span className="label">Portfolio Value</span>
                <span className="value">{formatValue(totalValue)}</span>
            </div>
            <div className="stat-card">
                <span className="label">Cash (USDC)</span>
                <span className="value">
                    {cashBalance !== null ? `$${cashBalance.toFixed(2)}` : (
                        isL2Authenticated ? 'Loading...' : '---'
                    )}
                </span>
            </div>
            <div className="stat-card">
                <span className="label">Active Positions</span>
                <span className="value">{positionCount}</span>
            </div>
        </div>
    )
}

export default PortfolioStats
