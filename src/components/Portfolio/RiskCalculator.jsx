import React, { useState, useEffect } from 'react'

const RiskCalculator = ({ cashBalance = 0 }) => {
    // Inputs
    const [balance, setBalance] = useState(cashBalance)
    const [riskPercent, setRiskPercent] = useState(2.0)
    const [entryPrice, setEntryPrice] = useState('')
    const [stopLoss, setStopLoss] = useState('')

    // Outputs
    const [positionSizeNative, setPositionSizeNative] = useState(0) // In currency (e.g. USDC)
    const [positionSizeShares, setPositionSizeShares] = useState(0) // Number of shares
    const [riskedAmount, setRiskedAmount] = useState(0)
    const [helpOpen, setHelpOpen] = useState(false)

    // Sync balance prop if it changes and user hasn't heavily modified it (optional UX choice, 
    // here we just set it initially or if it was 0)
    useEffect(() => {
        if (cashBalance > 0 && (balance === 0 || balance === '')) {
            setBalance(cashBalance)
        }
    }, [cashBalance])

    // Calculation Logic
    useEffect(() => {
        const bal = parseFloat(balance) || 0
        const risk = parseFloat(riskPercent) || 0
        const entry = parseFloat(entryPrice) || 0
        const stop = parseFloat(stopLoss) || 0

        if (bal > 0 && risk > 0 && entry > 0 && stop > 0 && entry !== stop) {
            // Risk Amount = Balance * (Risk% / 100)
            const riskAmt = bal * (risk / 100)
            setRiskedAmount(riskAmt)

            // Formula: Position Size = Risk Amount / (Distance to Stop Loss %)
            // Distance % = |Entry - Stop| / Entry
            // Wait, standard formula: 
            // Loss per share = |Entry - Stop|
            // Number of Shares = Risk Amount / Loss per share

            const lossPerShare = Math.abs(entry - stop)
            const numShares = riskAmt / lossPerShare

            // Total Position Value (Native) = Num Shares * Entry Price
            const totalPosValue = numShares * entry

            // Safety check for crazy numbers
            if (isFinite(numShares) && isFinite(totalPosValue)) {
                setPositionSizeShares(numShares)
                setPositionSizeNative(totalPosValue)
            } else {
                setPositionSizeShares(0)
                setPositionSizeNative(0)
            }
        } else {
            setRiskedAmount(0)
            setPositionSizeShares(0)
            setPositionSizeNative(0)
        }
    }, [balance, riskPercent, entryPrice, stopLoss])

    // Handlers
    const handlePresetRisk = (val) => setRiskPercent(val)

    const inputStyle = {
        background: 'rgba(255, 255, 255, 0.05)',
        border: '1px solid rgba(255, 255, 255, 0.1)',
        padding: '12px',
        borderRadius: '8px',
        color: '#fff',
        width: '100%',
        fontSize: '1rem',
        outline: 'none'
    }

    const labelStyle = {
        display: 'block',
        color: '#94a3b8',
        marginBottom: '6px',
        fontSize: '0.9rem',
        fontWeight: '500'
    }

    const resultBoxStyle = {
        background: 'rgba(16, 185, 129, 0.1)',
        border: '1px solid rgba(16, 185, 129, 0.2)',
        borderRadius: '12px',
        padding: '20px',
        marginTop: '24px',
        textAlign: 'center'
    }

    return (
        <div style={{ padding: '24px', maxWidth: '600px', margin: '0 auto', color: 'white' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
                <h2 style={{ fontSize: '1.5rem', fontWeight: 'bold', margin: 0 }}>
                    Risk & Position Size Calculator
                </h2>
                <button
                    onClick={() => setHelpOpen(true)}
                    style={{
                        background: 'rgba(59, 130, 246, 0.2)',
                        border: '1px solid rgba(59, 130, 246, 0.4)',
                        color: '#60a5fa',
                        borderRadius: '50%',
                        width: '24px',
                        height: '24px',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        cursor: 'pointer',
                        fontSize: '0.9rem',
                        fontWeight: 'bold'
                    }}
                    title="How it works"
                >
                    ?
                </button>
            </div>
            <p style={{ color: '#94a3b8', marginBottom: '32px' }}>
                Calculate the optimal position size based on your account balance and risk tolerance.
            </p>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '24px', marginBottom: '24px' }}>
                {/* Account Balance */}
                <div>
                    <label style={labelStyle}>Account Balance ($)</label>
                    <input
                        type="number"
                        value={balance}
                        onChange={(e) => setBalance(e.target.value)}
                        placeholder="0.00"
                        style={inputStyle}
                    />
                </div>

                {/* Risk Percentage */}
                <div>
                    <label style={labelStyle}>Risk per Trade (%)</label>
                    <div style={{ display: 'flex', gap: '8px', marginBottom: '8px', flexWrap: 'wrap' }}>
                        {[0.5, 1, 2, 5].map(pct => (
                            <button
                                key={pct}
                                onClick={() => handlePresetRisk(pct)}
                                style={{
                                    padding: '4px 8px',
                                    borderRadius: '4px',
                                    border: 'none',
                                    background: riskPercent === pct ? '#3b82f6' : 'rgba(255, 255, 255, 0.1)',
                                    color: riskPercent === pct ? 'white' : '#cbd5e1',
                                    cursor: 'pointer',
                                    fontSize: '0.8rem',
                                    transition: 'all 0.2s'
                                }}
                            >
                                {pct}%
                            </button>
                        ))}
                    </div>
                    <input
                        type="number"
                        value={riskPercent}
                        onChange={(e) => setRiskPercent(e.target.value)}
                        placeholder="2.0"
                        style={inputStyle}
                        step="0.1"
                    />
                </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '24px', marginBottom: '24px' }}>
                {/* Entry Price */}
                <div>
                    <label style={labelStyle}>Entry Price ($)</label>
                    <input
                        type="number"
                        value={entryPrice}
                        onChange={(e) => setEntryPrice(e.target.value)}
                        placeholder="0.50"
                        style={inputStyle}
                        step="0.01"
                    />
                </div>

                {/* Stop Loss */}
                <div>
                    <label style={labelStyle}>Stop Loss ($)</label>
                    <input
                        type="number"
                        value={stopLoss}
                        onChange={(e) => setStopLoss(e.target.value)}
                        placeholder="0.00"
                        style={inputStyle}
                        step="0.01"
                    />
                </div>
            </div>

            {/* Warning if stop loss >= entry for long (basic check) */}
            {parseFloat(entryPrice) > 0 && parseFloat(stopLoss) >= parseFloat(entryPrice) && (
                <div style={{ color: '#ef4444', fontSize: '0.9rem', marginBottom: '16px' }}>
                    ⚠️ Stop Loss must be lower than Entry Price for long positions (or check logic).
                </div>
            )}

            {/* Results */}
            <div style={resultBoxStyle}>
                <div style={{ marginBottom: '16px' }}>
                    <div style={{ color: '#94a3b8', fontSize: '0.9rem', marginBottom: '4px' }}>
                        Recommended Position Size
                    </div>
                    <div style={{ fontSize: '2rem', fontWeight: 'bold', color: '#10b981' }}>
                        ${positionSizeNative.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </div>
                    <div style={{ color: '#cbd5e1', fontSize: '1rem', marginTop: '4px' }}>
                        {positionSizeShares.toLocaleString(undefined, { maximumFractionDigits: 0 })} Shares
                    </div>
                </div>

                <div style={{ height: '1px', background: 'rgba(255,255,255,0.1)', margin: '16px 0' }}></div>

                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ color: '#ef4444', fontWeight: '500' }}>
                        Risk Amount: ${riskedAmount.toFixed(2)}
                    </span>
                    <span style={{ color: '#64748b', fontSize: '0.85rem' }}>
                        ({riskPercent}% of Balance)
                    </span>
                </div>
            </div>
            {/* Help Modal */}
            {helpOpen && (
                <div style={{
                    position: 'fixed',
                    top: 0, left: 0, right: 0, bottom: 0,
                    backgroundColor: 'rgba(0,0,0,0.8)',
                    display: 'flex',
                    justifyContent: 'center',
                    alignItems: 'center',
                    zIndex: 10000
                }} onClick={() => setHelpOpen(false)}>
                    <div style={{
                        width: '90%',
                        maxWidth: '550px',
                        maxHeight: '90vh',
                        overflowY: 'auto',
                        backgroundColor: '#0f172a',
                        borderRadius: '16px',
                        padding: '32px',
                        position: 'relative',
                        border: '1px solid #334155',
                        boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.5)'
                    }} onClick={e => e.stopPropagation()}>

                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '24px' }}>
                            <h3 style={{ fontSize: '1.5rem', fontWeight: 'bold', color: 'white', margin: 0 }}>
                                📌 How It Works
                            </h3>
                            <button
                                onClick={() => setHelpOpen(false)}
                                style={{
                                    background: 'transparent',
                                    border: 'none',
                                    color: '#94a3b8',
                                    fontSize: '1.5rem',
                                    cursor: 'pointer',
                                    padding: '4px'
                                }}
                            >
                                ✕
                            </button>
                        </div>

                        <div style={{ color: '#cbd5e1', lineHeight: '1.6' }}>
                            <div style={{ marginBottom: '24px' }}>
                                <h4 style={{ color: '#38bdf8', fontSize: '1.1rem', marginBottom: '12px' }}>You input:</h4>
                                <ul style={{ listStyle: 'none', padding: 0, display: 'flex', flexDirection: 'column', gap: '8px' }}>
                                    <li>💰 <strong>Account Balance</strong> → Total money in your account.</li>
                                    <li>⚠️ <strong>Risk per Trade (%)</strong> → Percentage of your balance you're willing to lose.</li>
                                    <li>📉 <strong>Entry Price</strong> → Price you plan to buy at.</li>
                                    <li>🛑 <strong>Stop Loss</strong> → Price where you'll sell to cut losses.</li>
                                </ul>
                            </div>

                            <div style={{ marginBottom: '24px' }}>
                                <h4 style={{ color: '#34d399', fontSize: '1.1rem', marginBottom: '12px' }}>The calculator tells you:</h4>
                                <ul style={{ listStyle: 'none', padding: 0, display: 'flex', flexDirection: 'column', gap: '8px' }}>
                                    <li>💎 <strong>Rec. Position Size ($)</strong> → How much to invest.</li>
                                    <li>📊 <strong>Shares/Units</strong> → Exact quantity to buy.</li>
                                    <li>💸 <strong>Risk Amount</strong> → Actual $ you lose if stop loss is hit.</li>
                                </ul>
                            </div>

                            <div style={{ background: 'rgba(51, 65, 85, 0.3)', padding: '16px', borderRadius: '8px', marginBottom: '24px', border: '1px solid rgba(51, 65, 85, 0.5)' }}>
                                <h4 style={{ color: '#e2e8f0', fontSize: '1rem', marginTop: 0, marginBottom: '12px' }}>📐 Example</h4>
                                <div style={{ fontSize: '0.9rem', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                                    <p style={{ margin: 0 }}><strong>Balance:</strong> $100 • <strong>Risk:</strong> 5% ($5 max loss)</p>
                                    <p style={{ margin: 0 }}><strong>Entry:</strong> $1.00 • <strong>Stop:</strong> $0.50 (Loss/share = $0.50)</p>
                                    <div style={{ height: '1px', background: 'rgba(255,255,255,0.1)', margin: '4px 0' }}></div>
                                    <p style={{ margin: 0 }}>You can buy <strong>10 shares</strong> ($5 risk ÷ $0.50/share).</p>
                                    <p style={{ margin: 0, color: '#10b981' }}><strong>Position Size: $10</strong> (10 shares × $1.00)</p>
                                </div>
                            </div>

                            <div style={{ fontSize: '0.95rem', fontStyle: 'italic', color: '#94a3b8' }}>
                                "The point is to manage risk first. even if the trade goes bad, you only lose a small % and can continue trading."
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </div>
    )
}

export default RiskCalculator
