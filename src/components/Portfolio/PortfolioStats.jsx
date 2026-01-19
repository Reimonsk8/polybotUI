import './Portfolio.css'

const PortfolioStats = ({ totalValue, cashBalance, isL2Authenticated, positionCount }) => {
    return (
        <div className="stats-grid">
            <div className="stat-card">
                <span className="label">Portfolio Value</span>
                <span className="value">${totalValue.toFixed(2)}</span>
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
