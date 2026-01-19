import { useState, useEffect } from 'react'
import { ethers } from 'ethers'
import { ClobClient } from '@polymarket/clob-client'
import './components/Portfolio/Portfolio.css' // Import shared styles
import LoginForm from './components/Auth/LoginForm'
import UserHeader from './components/Portfolio/UserHeader'
import PortfolioStats from './components/Portfolio/PortfolioStats'
import PositionsTable from './components/Portfolio/PositionsTable'
import PortfolioTabs from './components/Portfolio/PortfolioTabs'

const UserPortfolio = () => {
    const [address, setAddress] = useState(null)
    const [username, setUsername] = useState(null)
    const [profileImage, setProfileImage] = useState(null)
    const [cashBalance, setCashBalance] = useState(null)
    const [loginMethod, setLoginMethod] = useState(null) // 'metamask' | 'email' | 'l1' | 'l2' | 'full'
    const [isL2Authenticated, setIsL2Authenticated] = useState(false)
    const [positions, setPositions] = useState([])
    const [loading, setLoading] = useState(false)
    const [error, setError] = useState(null)
    const [client, setClient] = useState(null)

    // Authenticate L2 & Fetch Private Data
    const performL2Login = async (signer, userAddress, authType, proxyAddressOverride = null) => {
        try {
            // 1. Get Proxy Address from positions (most reliable method)
            let proxyAddress = proxyAddressOverride
            let name = null
            let image = null

            if (!proxyAddress) {
                try {
                    const posRes = await fetch(`https://data-api.polymarket.com/positions?user=${userAddress}&limit=1`)
                    if (posRes.ok) {
                        const posData = await posRes.json()
                        if (posData.length > 0 && posData[0].proxyWallet) {
                            proxyAddress = posData[0].proxyWallet
                        }
                    }
                } catch (e) {
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
                        }
                    }
                } catch (e) {
                }
            }

            // Final fallback to userAddress
            proxyAddress = proxyAddress || userAddress

            // Set a default username from address
            setUsername(userAddress.slice(0, 6) + '...' + userAddress.slice(-4))

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

            // 7. Fetch Profile Logic
            let profileFound = false

            // Try Gamma API (via Proxy)
            try {
                // UPDATE: Use query param 'address' instead of path param
                const profileRes = await fetch(`http://localhost:3001/gamma-api/public-profile?address=${userAddress}`)


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
                    const activityRes = await fetch(`https://data-api.polymarket.com/activity?user=${userAddress}&limit=1`)

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

            // 8. Fetch Open Positions
            const openPositions = await fetchPositions(userAddress)

            // 9. Fetch Closed Positions
            try {
                const closedRes = await fetch(`https://data-api.polymarket.com/v1/closed-positions?user=${userAddress}&limit=50`)
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

            // Fetch positions
            fetchPositions(userAddress)

            // Perform L2 login
            await performL2Login(wallet, userAddress, 'l1', proxyAddressInput)

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

            // Fetch positions
            fetchPositions(apiAddress)

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

            // Fetch positions
            fetchPositions(userAddress)

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
        setAddress(null)
        setUsername(null)
        setProfileImage(null)
        setPositions([])
        setClient(null)
        setCashBalance(null)
        setLoginMethod(null)
        setIsL2Authenticated(false)
    }

    const totalValue = positions.reduce((sum, p) => sum + (p.curPrice * p.size), 0)

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
                totalValue={totalValue}
                cashBalance={cashBalance}
                isL2Authenticated={isL2Authenticated}
                positionCount={positions.length}
            />

            <PortfolioTabs userAddress={address} client={client} />
        </div>
    )
}

export default UserPortfolio
