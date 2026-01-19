import './Portfolio.css'

const UserHeader = ({ username, address, profileImage, isL2Authenticated, onDisconnect }) => {
    return (
        <div className="portfolio-header">
            <div className="header-left">
                <h3>My Portfolio</h3>
                <div className="user-profile">
                    {profileImage && <img src={profileImage} alt="Profile" className="profile-img" />}
                    <div className="user-details">
                        {username && <span className="username">@{username}</span>}
                        <span className="address" title={address}>
                            {address ? `${address.slice(0, 6)}...${address.slice(-4)}` : ''}
                        </span>
                    </div>
                </div>
            </div>

            <div className="header-right">
                {/* Auth Status Badges */}
                <div style={{ display: 'flex', gap: '8px', marginRight: '12px', alignItems: 'center' }}>
                    <span
                        className="method-badge"
                        style={{
                            background: 'linear-gradient(135deg, #10b981 0%, #059669 100%)',
                            padding: '4px 10px',
                            fontSize: '0.75rem',
                            fontWeight: '600'
                        }}
                        title="L1 authentication allows signing messages and creating API keys"
                    >
                        ✓ L1 Auth
                    </span>
                    {isL2Authenticated ? (
                        <span
                            className="method-badge"
                            style={{
                                background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
                                padding: '4px 10px',
                                fontSize: '0.75rem',
                                fontWeight: '600'
                            }}
                            title="L2 authentication enables trading, balance checks, and order management"
                        >
                            ✓ L2 Auth
                        </span>
                    ) : (
                        <span
                            className="method-badge"
                            style={{
                                background: 'rgba(255, 255, 255, 0.1)',
                                padding: '4px 10px',
                                fontSize: '0.75rem',
                                opacity: 0.5
                            }}
                            title="L2 authentication not active - limited functionality"
                        >
                            ✗ L2 Auth
                        </span>
                    )}
                </div>
                <button onClick={onDisconnect} className="disconnect-btn">Disconnect</button>
            </div>
        </div>
    )
}

export default UserHeader
