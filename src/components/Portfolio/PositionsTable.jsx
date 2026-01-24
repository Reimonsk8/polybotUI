import './Portfolio.css'

const PositionsTable = ({ positions }) => {
    if (positions.length === 0) {
        return (
            <div className="empty-portfolio">
                <p>No active positions found.</p>
            </div>
        )
    }

    return (
        <div className="positions-list">
            <h4>Active Positions</h4>
            <div className="table-wrapper">
                <table>
                    <thead>
                        <tr>
                            <th>Market</th>
                            <th>Side</th>
                            <th>Size</th>
                            <th>Avg Price</th>
                            <th>Cur Price</th>
                            <th>Value</th>
                        </tr>
                    </thead>
                    <tbody>
                        {positions.map((pos, idx) => (
                            <tr key={idx}>
                                <td className="market-name">
                                    <a href={`https://polymarket.com/event/${pos.slug}`} target="_blank" rel="noopener noreferrer" style={{ textDecoration: 'none', color: 'inherit' }}>
                                        {pos.title}
                                    </a>
                                </td>
                                <td>
                                    <span className={`outcome-tag ${pos.outcome}`}>
                                        {pos.outcome}
                                    </span>
                                </td>
                                <td>{pos.size.toFixed(1)}</td>
                                <td>${pos.avgPrice.toFixed(2)}</td>
                                <td>${pos.curPrice.toFixed(2)}</td>
                                <td>${(pos.curPrice * pos.size).toFixed(2)}</td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        </div>
    )
}

export default PositionsTable
