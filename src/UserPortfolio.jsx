import { useState, useEffect } from 'react'
import { ethers } from 'ethers'
import { ClobClient } from '@polymarket/clob-client'
import './UserPortfolio.css'

const UserPortfolio = () => {
    const [address, setAddress] = useState(null)
    const [username, setUsername] = useState(null)
    const [profileImage, setProfileImage] = useState(null)
    const [cashBalance, setCashBalance] = useState(null)
    const [loginMethod, setLoginMethod] = useState(null) // 'metamask' | 'email'
    const [privateKeyInput, setPrivateKeyInput] = useState('')
    const [showEmailLogin, setShowEmailLogin] = useState(false)
    const [isL2Authenticated, setIsL2Authenticated] = useState(false)

    const [positions, setPositions] = useState([])
    const [loading, setLoading] = useState(false)
    const [error, setError] = useState(null)
    const [client, setClient] = useState(null)

    // Helper: Fetch Profile (Proxy Address & Username)
    const getProfileData = async (userAddress) => {
        try {
            // Use local proxy /gamma-api which forwards to https://gamma-api.polymarket.com
            // to avoid CORS errors in browser
            const urls = [
                `/gamma-api/profiles/${userAddress}`,
                `/gamma-api/public-profile?address=${userAddress}`
            ]

            for (const url of urls) {
                try {
                    const res = await fetch(url)
                    if (res.ok) {
                        return await res.json()
                    }
                } catch (e) {
                    console.warn(`Fetch failed for ${url}`, e)
                }
            }
            return null
        } catch (e) {
            console.warn("Profile fetch failed:", e)
            return null
        }
    }

    // Authenticate L2 & Fetch Private Data
    const performL2Login = async (signer, userAddress, authType) => {
        try {
            // 1. Fetch Profile to get Proxy Address
            const profile = await getProfileData(userAddress)
            const proxyAddress = profile?.proxyWallet || profile?.address || userAddress
            const name = profile?.name || profile?.display_name || profile?.slug
            const image = profile?.profileImage

            if (name) setUsername(name)
            if (image) setProfileImage(image)

            // 2. Init L1 Client
            // ChainId 137 for Polygon
            const l1Client = new ClobClient("https://clob.polymarket.com", 137, signer)

            // 3. Create or Derive API Keys
            try {
                const creds = await l1Client.createOrDeriveApiKey()

                // 4. Determine Signature Type & Funder
                // Type 0: EOA (MetaMask default if no proxy, but usually Poly users have Safe)
                // Type 1: POLY_PROXY (Magic/Google users)
                // Type 2: GNOSIS_SAFE (MetaMask + Proxy users)

                let signatureType = 0 // Default EOA
                if (authType === 'email') {
                    signatureType = 1 // Google/Email login = PolyProxy
                } else if (authType === 'metamask') {
                    // Most active MM users on Poly have a Gnosis Safe
                    signatureType = 2
                }

                // 5. Init L2 Client with full Auth
                const l2Client = new ClobClient(
                    "https://clob.polymarket.com",
                    137,
                    signer,
                    creds,
                    signatureType,
                    proxyAddress // Funder
                )

                setClient(l2Client)
                setIsL2Authenticated(true)

                // 6. Fetch Balance
                // asset_type: COLLATERAL (USDC)
                const balanceData = await l2Client.getBalanceAllowance({
                    asset_type: "COLLATERAL"
                })

                // Balance is in USDC 6 decimals, so 1000000 = 1 USDC
                const rawBalance = balanceData.balance || "0"
                const readable = parseFloat(rawBalance) / 1000000
                setCashBalance(readable)

            } catch (authStateErr) {
                console.error("Auth Step Error:", authStateErr)
                // Don't block whole login if just L2 fails
                setError("Logged in, but L2 Auth (Balance) failed. " + authStateErr.message)
            }

        } catch (err) {
            console.error("L2 Auth process failed:", err)
            setError(`Login successful, but failed to fetch balance: ${err.message}`)
        }
    }

    // Connect MetaMask
    const connectWallet = async () => {
        setError(null)
        setLoading(true)
        try {
            if (!window.ethereum) throw new Error('MetaMask not detected')

            const provider = new ethers.providers.Web3Provider(window.ethereum)
            await provider.send("eth_requestAccounts", [])
            const signer = provider.getSigner()
            const userAddress = await signer.getAddress()

            setAddress(userAddress)
            setLoginMethod('metamask')

            // Parallel: Fetch Public Data & Do Authentication
            fetchPublicPositions(userAddress)
            await performL2Login(signer, userAddress, 'metamask')

        } catch (err) {
            console.error(err)
            setError(err.message)
        } finally {
            setLoading(false)
        }
    }

    // Connect with Private Key (Google/Email)
    const connectPrivateKey = async () => {
        setError(null)
        setLoading(true)
        try {
            if (!privateKeyInput) throw new Error('Please enter your Private Key')

            let key = privateKeyInput.trim()

            // Validation: Ensure it looks like a hex key
            // Remove 0x prefix for length check if needed, but easiest regex matches both
            const hexRegex = /^(0x)?[0-9a-fA-F]{64}$/
            if (!hexRegex.test(key)) {
                throw new Error("Invalid Private Key format. It should be a 64-character hex string (with or without 0x prefix).")
            }

            if (!key.startsWith('0x')) key = '0x' + key


            const rpcUrl = "https://polygon-rpc.com"
            const provider = new ethers.providers.JsonRpcProvider(rpcUrl)

            // This line crashed before if key was garbage
            const wallet = new ethers.Wallet(key, provider)
            const userAddress = await wallet.getAddress()

            setAddress(userAddress)
            setLoginMethod('email')
            setShowEmailLogin(false)
            setPrivateKeyInput('')

            // Parallel: Fetch Public Data & Do Authentication
            fetchPublicPositions(userAddress)
            await performL2Login(wallet, userAddress, 'email')

        } catch (err) {
            console.error(err)
            setError(err.message)
        } finally {
            setLoading(false)
        }
    }

    const fetchPublicPositions = async (userAddress) => {
        try {
            // This API usually has CORS enabled, so direct fetch might work. 
            // If not, we could proxy it too, but let's try direct first as it worked before.
            const positionsRes = await fetch(`https://data-api.polymarket.com/positions?user=${userAddress}`)
            if (positionsRes.ok) {
                const positionsData = await positionsRes.json()
                const activePositions = positionsData.filter(p => p.size > 0)
                setPositions(activePositions)
            }
        } catch (err) {
            console.warn("Public positions fetch failed:", err)
        }
    }

    const disconnect = () => {
        setAddress(null)
        setUsername(null)
        setProfileImage(null)
        setPositions([])
        setClient(null)
        setCashBalance(null)
        setLoginMethod(null)
        setShowEmailLogin(false)
        setIsL2Authenticated(false)
    }

    const totalValue = positions.reduce((sum, p) => sum + (p.curPrice * p.size), 0)

    if (!address) {
        return (
            <div className="portfolio-login">
                {!showEmailLogin ? (
                    <div className="login-options">
                        <button
                            onClick={connectWallet}
                            className="connect-button metamask-btn"
                            disabled={loading}
                        >
                            <span className="icon">🦊</span>
                            {loading && loginMethod === 'metamask' ? "Connecting..." : "Connect MetaMask"}
                        </button>

                        <div className="divider"><span>OR</span></div>

                        <button
                            onClick={() => setShowEmailLogin(true)}
                            className="connect-button google-btn"
                            disabled={loading}
                        >
                            <span className="icon">📧</span>
                            Log in with Google / Email
                        </button>
                    </div>
                ) : (
                    <div className="email-login-form">
                        <h4>Polymarket Google/Email Login</h4>
                        <p className="instruction-text">
                            To log in with Google, you must export your Private Key from
                            <strong> Polymarket.com &gt; Settings &gt; Export Private Key</strong>.
                        </p>

                        <div className="input-group">
                            <input
                                type="password"
                                placeholder="Paste your Private Key here (0x...)"
                                value={privateKeyInput}
                                onChange={(e) => setPrivateKeyInput(e.target.value)}
                                className="pk-input"
                            />
                            {/* Warning if too short or too long detected during typing/paste? 
                                Not strictly necessary, submit validation handles it. */}
                        </div>

                        <div className="form-actions">
                            <button
                                onClick={() => setShowEmailLogin(false)}
                                className="cancel-btn"
                            >
                                Back
                            </button>
                            <button
                                onClick={connectPrivateKey}
                                className="submit-btn"
                                disabled={loading}
                            >
                                {loading ? "Verifying..." : "Log In"}
                            </button>
                        </div>
                        <p className="security-note">
                            Note: Your key is only used locally to sign requests and is never saved.
                        </p>
                    </div>
                )}

                {error && <p className="error-text">{error}</p>}
            </div>
        )
    }

    return (
        <div className="portfolio-dashboard">
            <div className="portfolio-header">
                <div className="header-left">
                    <h3>My Portfolio</h3>
                    <div className="user-profile">
                        {profileImage && <img src={profileImage} alt="Profile" className="profile-img" />}
                        <div className="user-details">
                            {username && <span className="username">@{username}</span>}
                            <span className="address" title={address}>
                                {address.slice(0, 6)}...{address.slice(-4)}
                            </span>
                        </div>
                    </div>
                </div>

                <div className="header-right">
                    <button onClick={disconnect} className="disconnect-btn">Disconnect</button>
                </div>
            </div>

            <div className="stats-grid">
                <div className="stat-card">
                    <span className="label">Portfolio Value</span>
                    <span className="value">${totalValue.toFixed(2)}</span>
                </div>
                <div className="stat-card">
                    <span className="label">Cash (USDC)</span>
                    <span className="value">
                        {cashBalance !== null ? `$${cashBalance.toFixed(2)}` : (
                            isL2Authenticated ? 'Loading...' : (error && error.includes("L2") ? 'Error' : '---')
                        )}
                    </span>
                </div>
                <div className="stat-card">
                    <span className="label">Active Positions</span>
                    <span className="value">{positions.length}</span>
                </div>
            </div>

            {positions.length > 0 ? (
                <div className="positions-list">
                    <h4>Active Bets</h4>
                    <div className="table-wrapper">
                        <table>
                            <thead>
                                <tr>
                                    <th>Market</th>
                                    <th>Side</th>
                                    <th>Size</th>
                                    <th>Avg Price</th>
                                    <th>Value</th>
                                </tr>
                            </thead>
                            <tbody>
                                {positions.map((pos, idx) => (
                                    <tr key={idx}>
                                        <td className="market-name">{pos.title}</td>
                                        <td>
                                            <span className={`outcome-tag ${pos.outcome}`}>
                                                {pos.outcome}
                                            </span>
                                        </td>
                                        <td>{pos.size.toFixed(1)}</td>
                                        <td>${pos.avgPrice.toFixed(2)}</td>
                                        <td>${(pos.curPrice * pos.size).toFixed(2)}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </div>
            ) : (
                <div className="empty-portfolio">
                    <p>No active positions found.</p>
                </div>
            )}
        </div>
    )
}

export default UserPortfolio
