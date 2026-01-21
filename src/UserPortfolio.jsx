import { useState, useEffect } from 'react'
import { ethers } from 'ethers'
import { ClobClient } from '@polymarket/clob-client'
import './components/Portfolio/Portfolio.css' // Import shared styles
import LoginForm from './components/Auth/LoginForm'
import UserHeader from './components/Portfolio/UserHeader'
import PortfolioStats from './components/Portfolio/PortfolioStats'
import PositionsTable from './components/Portfolio/PositionsTable'
import PortfolioTabs from './components/Portfolio/PortfolioTabs'

const UserPortfolio = ({ onStateChange }) => {
    const [address, setAddress] = useState(null)
    const [proxyAddress, setProxyAddress] = useState(() => {
        // Initialize from localStorage on first load
        const saved = localStorage.getItem('polymarket_proxy_address')
        console.log('[UserPortfolio] Restoring proxy address from localStorage:', saved)
        return saved
    })
    const [username, setUsername] = useState(null)
    const [profileImage, setProfileImage] = useState(null)
    const [cashBalance, setCashBalance] = useState(null)
    const [loginMethod, setLoginMethod] = useState(null) // 'metamask' | 'email' | 'l1' | 'l2' | 'full'
    const [isL2Authenticated, setIsL2Authenticated] = useState(false)
    const [positions, setPositions] = useState([])
    const [portfolioValue, setPortfolioValue] = useState(null)
    const [loading, setLoading] = useState(false)
    const [error, setError] = useState(null)
    const [client, setClient] = useState(null)

    // Session management constants
    const SESSION_KEY = 'polymarket_session'
    const PROXY_ADDRESS_KEY = 'polymarket_proxy_address'
    const INACTIVITY_TIMEOUT = 30 * 60 * 1000 // 30 minutes in milliseconds

    // Restore session on mount
    useEffect(() => {
        const savedSession = localStorage.getItem(SESSION_KEY)
        if (savedSession) {
            try {
                const session = JSON.parse(savedSession)
                const now = Date.now()

                // Check if session is still valid (not expired)
                if (session.expiresAt && now < session.expiresAt) {
                    // Restore session data directly
                    setAddress(session.address)
                    setUsername(session.username)
                    setProfileImage(session.profileImage)
                    setCashBalance(session.cashBalance)
                    setLoginMethod(session.loginMethod)
                    setIsL2Authenticated(session.isL2Authenticated)
                    setPositions(session.positions || [])
                    setPortfolioValue(session.portfolioValue || null)

                    // Note: Client will need to be re-initialized on first action
                    // This is acceptable as we're just restoring the UI state
                } else {
                    // Session expired, clear it
                    localStorage.removeItem(SESSION_KEY)
                }
            } catch (err) {
                // Invalid session data, clear it
                localStorage.removeItem(SESSION_KEY)
            }
        }
    }, [])

    // Track user activity and update session expiry
    useEffect(() => {
        if (!address) return

        let inactivityTimer

        const resetInactivityTimer = () => {
            clearTimeout(inactivityTimer)

            // Update session expiry
            const savedSession = localStorage.getItem(SESSION_KEY)
            if (savedSession) {
                try {
                    const session = JSON.parse(savedSession)
                    session.expiresAt = Date.now() + INACTIVITY_TIMEOUT
                    localStorage.setItem(SESSION_KEY, JSON.stringify(session))
                } catch (err) {
                    // Ignore
                }
            }

            // Set new timeout for auto-logout
            inactivityTimer = setTimeout(() => {
                disconnect()
                alert('Session expired due to inactivity. Please log in again.')
            }, INACTIVITY_TIMEOUT)
        }

        // Activity event listeners
        const events = ['mousedown', 'keydown', 'scroll', 'touchstart']
        events.forEach(event => {
            document.addEventListener(event, resetInactivityTimer)
        })

        // Initialize timer
        resetInactivityTimer()

        // Cleanup
        return () => {
            clearTimeout(inactivityTimer)
            events.forEach(event => {
                document.removeEventListener(event, resetInactivityTimer)
            })
        }
    }, [address])

    // Save session to localStorage
    const saveSession = (sessionData) => {
        const session = {
            ...sessionData,
            expiresAt: Date.now() + INACTIVITY_TIMEOUT
        }
        localStorage.setItem(SESSION_KEY, JSON.stringify(session))
    }

    // Auto-save session whenever important state changes
    useEffect(() => {
        if (address && loginMethod) {
            saveSession({
                address,
                username,
                profileImage,
                cashBalance,
                loginMethod,
                isL2Authenticated,
                positions,
                portfolioValue
            })
        }
    }, [address, username, profileImage, cashBalance, loginMethod, isL2Authenticated, positions, portfolioValue])

    // Propagate State to Parent (App.jsx) for Trading Views
    useEffect(() => {
        if (onStateChange) {
            onStateChange({
                client,
                address: proxyAddress || address, // Use proxy if available (L2), else L1
                isConnected: !!address
            })
        }
    }, [client, address, proxyAddress, onStateChange])

    const fetchPortfolioValue = async (userAddress) => {
        try {
            const res = await fetch(`https://data-api.polymarket.com/value?user=${userAddress}`)
            if (res.ok) {
                // The API usually returns the value directly as json number or string
                const data = await res.json()
                const val = parseFloat(data)
                if (!isNaN(val)) {
                    setPortfolioValue(val)
                }
            }
        } catch (err) {
            console.error("Failed to fetch portfolio value", err)
        }
    }

    // Authenticate L2 & Fetch Private Data
    const performL2Login = async (signer, userAddress, authType, proxyAddressOverride = null) => {
        try {
            // 1. Get Proxy Address - Priority order:
            // a) LocalStorage (saved from previous session - HIGHEST PRIORITY)
            // b) Environment variable VITE_PROXY_WALLET_ADDRESS (from .env)
            // c) Override passed in as parameter
            // d) API detection from positions/activity
            // e) Fallback to user address

            // Start with localStorage, then env, then override
            let proxyAddress = localStorage.getItem('polymarket_proxy_address')
                || import.meta.env.VITE_PROXY_WALLET_ADDRESS
                || proxyAddressOverride
            let name = null
            let image = null

            console.log('[L2 Login] Checking proxy address from localStorage:', localStorage.getItem('polymarket_proxy_address'))
            console.log('[L2 Login] Checking proxy address from env:', import.meta.env.VITE_PROXY_WALLET_ADDRESS)
            console.log('[L2 Login] Starting with proxy address:', proxyAddress || 'will detect')

            // Try to detect from API only if not provided in env or override
            if (!proxyAddress) {
                console.log('[L2 Login] No proxy in env, attempting API detection')
                try {
                    const posRes = await fetch(`https://data-api.polymarket.com/positions?user=${userAddress}&limit=1`)
                    if (posRes.ok) {
                        const posData = await posRes.json()
                        if (posData.length > 0 && posData[0].proxyWallet) {
                            proxyAddress = posData[0].proxyWallet
                            console.log('[L2 Login] Detected proxy from positions API:', proxyAddress)
                        }
                    }
                } catch (e) {
                    console.warn('[L2 Login] Failed to fetch from positions API')
                }
            }

            // Try Activity if still not found
            if (!proxyAddress) {
                try {
                    const actRes = await fetch(`https://data-api.polymarket.com/activity?user=${userAddress}&limit=1`)
                    if (actRes.ok) {
                        const actData = await actRes.json()
                        if (actData.length > 0 && actData[0].proxyWallet) {
                            proxyAddress = actData[0].proxyWallet
                            console.log('[L2 Login] Detected proxy from activity API:', proxyAddress)
                        }
                    }
                } catch (e) {
                    console.warn('[L2 Login] Failed to fetch from activity API')
                }
            }

            // Final fallback to userAddress
            proxyAddress = proxyAddress || userAddress
            console.log('[L2 Login] Using proxy address:', proxyAddress)

            // Set a default username from PROXY address (this is the trading identity)
            setUsername(proxyAddress.slice(0, 6) + '...' + proxyAddress.slice(-4))

            // 2. Init L1 Client
            // ChainId 137 for Polygon
            const l1Client = new ClobClient("https://clob.polymarket.com", 137, signer)

            // 3. Try to derive API Keys first (nonce 0), then create if needed
            let creds
            try {
                creds = await l1Client.deriveApiKey()
            } catch (deriveErr) {
                try {
                    creds = await l1Client.createApiKey()
                } catch (createErr) {
                    throw new Error("Could not obtain API credentials. " + createErr.message)
                }
            }

            // 4. Determine Signature Type & Funder
            // Type 0: EOA (MetaMask default if no proxy)
            // Type 1: POLY_PROXY (Magic/Google users)
            // Type 2: GNOSIS_SAFE (MetaMask + Proxy users)

            let signatureType = 0 // Default EOA
            if (authType === 'email' || authType === 'l1' || authType === 'full') {
                // For private key login, use EOA if no proxy, otherwise POLY_PROXY
                signatureType = (proxyAddress !== userAddress) ? 1 : 0
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

            // Store proxy address both in state AND localStorage for persistence
            setProxyAddress(proxyAddress)
            localStorage.setItem('polymarket_proxy_address', proxyAddress)
            console.log('[L2 Login] Saved proxy address to localStorage:', proxyAddress)

            setIsL2Authenticated(true)

            // 6. Fetch Balance
            try {
                const balanceData = await l2Client.getBalanceAllowance({
                    asset_type: "COLLATERAL"
                })

                // Balance is in USDC 6 decimals, so 1000000 = 1 USDC
                const rawBalance = balanceData.balance || "0"
                const readable = parseFloat(rawBalance) / 1000000
                setCashBalance(readable)
            } catch (balanceErr) {
                setCashBalance(0) // Set to 0 instead of leaving as null
            }

            // 7. Fetch Profile Logic - Use PROXY ADDRESS for profile
            let profileFound = false

            // Try Gamma API (via Proxy if available, otherwise direct)
            try {
                // Use proxy if VITE_PROXY_API_URL is set, otherwise try direct (will fail on GitHub Pages due to CORS)
                const proxyUrl = import.meta.env.VITE_PROXY_API_URL || 'http://localhost:3001'
                const useProxy = import.meta.env.VITE_USE_PROXY !== 'false'

                // IMPORTANT: Use proxyAddress (proxy wallet) not userAddress (regular wallet)
                const profileUrl = useProxy
                    ? `${proxyUrl}/gamma-api/public-profile?address=${proxyAddress}`
                    : `https://gamma-api.polymarket.com/public-profile?address=${proxyAddress}`

                const profileRes = await fetch(profileUrl)


                if (profileRes.ok) {
                    const profile = await profileRes.json()

                    if (profile.name || profile.displayUsernamePublic) {
                        const displayName = profile.name || profile.displayUsernamePublic
                        setUsername(displayName)
                        profileFound = true
                    }

                    if (profile.profileImage || profile.profile_picture || profile.optimized_profile_picture) {
                        const img = profile.profileImage || profile.optimized_profile_picture || profile.profile_picture
                        setProfileImage(img)
                    }
                } else {
                }
            } catch (err) {
            }

            // Fallback to Activity API if Gamma profile yielded no name (or failed)
            // This is expected for many users who haven't set up a public profile or if proxy is down
            if (!profileFound) {
                try {
                    // Use PROXY address for activity lookup
                    const activityRes = await fetch(`https://data-api.polymarket.com/activity?user=${proxyAddress}&limit=1`)

                    if (activityRes.ok) {
                        const activityData = await activityRes.json()
                        if (activityData.length > 0) {
                            const p = activityData[0]
                            const name = p.name || p.pseudonym
                            const img = p.profileImageOptimized || p.profileImage

                            // Only set if we didn't find them already (though !profileFound implies we didn't get name)
                            if (name && !username) {
                                setUsername(name)
                            }
                            if (img && !profileImage) {
                                setProfileImage(img)
                            }
                        }
                    }
                } catch (err) {
                }
            }

            // 8. Fetch Open Positions - Use PROXY address
            fetchPositions(proxyAddress)

            // 9. Fetch Portfolio Value - Use PROXY address
            fetchPortfolioValue(proxyAddress)

            // 10. Fetch Closed Positions - Use PROXY address
            try {
                const closedRes = await fetch(`https://data-api.polymarket.com/v1/closed-positions?user=${proxyAddress}&limit=50`)
                if (closedRes.ok) {
                    const closedData = await closedRes.json()

                    // Add 'closed: true' flag to closed positions
                    const processedClosed = closedData.map(p => ({ ...p, closed: true }))

                    // Merge with open positions (avoiding duplicates if any)
                    setPositions(prev => {
                        // Create a map of existing open positions by conditionId to avoid dupes
                        const existingIds = new Set(prev.map(p => p.conditionId))
                        const newClosed = processedClosed.filter(p => !existingIds.has(p.conditionId))
                        return [...prev, ...newClosed]
                    })
                }
            } catch (err) {
            }

        } catch (authErr) {
            setError("L2 Authentication failed. You can still view your positions. " + authErr.message)
            setIsL2Authenticated(false)
            setCashBalance(0) // Ensure balance is set even on error
        }
    }

    // Connect with Private Key (L1 Login) - Updated for Prop access
    const connectPrivateKey = async (privateKeyInput, proxyAddressInput) => {
        setError(null)
        setLoading(true)
        try {
            if (!privateKeyInput) throw new Error('Please enter your Private Key')

            let key = privateKeyInput.trim()
            if (!key.startsWith('0x')) key = '0x' + key

            const rpcUrl = "https://polygon-rpc.com"
            const provider = new ethers.providers.JsonRpcProvider(rpcUrl)
            const wallet = new ethers.Wallet(key, provider)
            const userAddress = await wallet.getAddress()

            setAddress(userAddress)
            setLoginMethod('l1')

            // Fetch info
            fetchPositions(userAddress)
            fetchPortfolioValue(userAddress)

            // Perform L2 login
            await performL2Login(wallet, userAddress, 'l1', proxyAddressInput)

            // Save session after successful login
            saveSession({
                address: userAddress,
                username,
                profileImage,
                cashBalance,
                loginMethod: 'l1',
                isL2Authenticated,
                privateKey: privateKeyInput,
                proxyAddress: proxyAddressInput
            })

        } catch (err) {
            setError(err.message)
        } finally {
            setLoading(false)
        }
    }

    // Connect with API Credentials (L2 Login) - Updated for Prop access
    const connectApiKey = async (credsInput) => {
        setError(null)
        setLoading(true)
        try {
            const { apiKey, secret, passphrase, address: apiAddress } = credsInput
            if (!apiKey || !secret || !passphrase || !apiAddress) {
                throw new Error("All fields (Key, Secret, Passphrase, Address) are required for L2 Login.")
            }

            const creds = {
                apiKey,
                secret,
                passphrase
            }

            const l2Client = new ClobClient(
                "https://clob.polymarket.com",
                137,
                undefined, // No Signer for L2-only
                creds
            )

            setAddress(apiAddress)
            setLoginMethod('l2')
            setClient(l2Client)
            setIsL2Authenticated(true)

            // Try to fetch balance
            try {
                const balanceData = await l2Client.getBalanceAllowance({ asset_type: "COLLATERAL" })
                const rawBalance = balanceData.balance || "0"
                setCashBalance(parseFloat(rawBalance) / 1000000)
            } catch (l2Err) {
            }

            // Fetch info
            fetchPositions(apiAddress)
            fetchPortfolioValue(apiAddress)

        } catch (e) {
            setError(e.message)
        } finally {
            setLoading(false)
        }
    }

    // Connect with Full Credentials (L1 + L2) - Updated for Prop access (assuming privateKeyInput is enough)
    const connectFullCredentials = async (privateKeyInput, proxyAddressInput) => {
        setError(null)
        setLoading(true)
        try {
            if (!privateKeyInput) {
                throw new Error("Private Key is required for Full Access login.")
            }

            let key = privateKeyInput.trim()
            if (!key.startsWith('0x')) key = '0x' + key

            const rpcUrl = "https://polygon-rpc.com"
            const provider = new ethers.providers.JsonRpcProvider(rpcUrl)
            const wallet = new ethers.Wallet(key, provider)
            const userAddress = await wallet.getAddress()

            setAddress(userAddress)
            setLoginMethod('full')

            // Fetch info
            fetchPositions(userAddress)
            fetchPortfolioValue(userAddress)

            // Perform L2 login
            await performL2Login(wallet, userAddress, 'full', proxyAddressInput)

        } catch (err) {
            setError(err.message)
        } finally {
            setLoading(false)
        }
    }

    const fetchPositions = async (userAddress) => {
        try {
            const positionsRes = await fetch(`https://data-api.polymarket.com/positions?user=${userAddress}`)
            if (positionsRes.ok) {
                const positionsData = await positionsRes.json()
                const active = positionsData.filter(p => p.size > 0)
                setPositions(active)
            }
        } catch (err) {
        }
    }

    const disconnect = () => {
        // Clear session from localStorage
        localStorage.removeItem(SESSION_KEY)
        localStorage.removeItem(PROXY_ADDRESS_KEY) // Clear persisted proxy address

        // Clear state
        setAddress(null)
        setProxyAddress(null)
        setUsername(null)
        setProfileImage(null)
        setPositions([])
        setClient(null)
        setCashBalance(null)
        setLoginMethod(null)
        setIsL2Authenticated(false)
        setPortfolioValue(null)
    }

    // Use API portfolio value if available, otherwise fallback to calculated
    const calculatedValue = positions.reduce((sum, p) => sum + (p.curPrice * p.size), 0)
    const displayValue = portfolioValue !== null ? portfolioValue : calculatedValue

    if (!address) {
        return (
            <LoginForm
                onConnectPrivateKey={connectPrivateKey}
                onConnectApiKey={connectApiKey}
                onConnectFull={connectFullCredentials}
                loading={loading}
                error={error}
            />
        )
    }

    return (
        <div className="portfolio-dashboard">
            <UserHeader
                username={username}
                address={address}
                profileImage={profileImage}
                isL2Authenticated={isL2Authenticated}
                onDisconnect={disconnect}
            />

            <PortfolioStats
                totalValue={displayValue}
                cashBalance={cashBalance}
                isL2Authenticated={isL2Authenticated}
                positionCount={positions.length}
            />


            {console.log('[UserPortfolio] Rendering with:', { address, proxyAddress, using: proxyAddress || address })}
            <PortfolioTabs userAddress={proxyAddress || address} client={client} />
        </div>
    )
}

export default UserPortfolio
