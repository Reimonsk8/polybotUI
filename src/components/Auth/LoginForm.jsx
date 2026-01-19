import { useState } from 'react'
import './LoginForm.css'

const LoginForm = ({ onConnectPrivateKey, onConnectApiKey, onConnectFull, loading, error }) => {
    const [privateKeyInput, setPrivateKeyInput] = useState('')
    const [proxyAddressInput, setProxyAddressInput] = useState('')
    const [apiKeyInput, setApiKeyInput] = useState('')
    const [apiSecretInput, setApiSecretInput] = useState('')
    const [apiPassphraseInput, setApiPassphraseInput] = useState('')
    const [apiAddressInput, setApiAddressInput] = useState('')

    const [showEmailLogin, setShowEmailLogin] = useState(false)

    const handleConnectPrivateKey = () => {
        onConnectPrivateKey(privateKeyInput, proxyAddressInput)
    }

    const handleConnectApiKey = () => {
        onConnectApiKey({
            apiKey: apiKeyInput,
            secret: apiSecretInput,
            passphrase: apiPassphraseInput,
            address: apiAddressInput
        })
    }

    const handleConnectFull = () => {
        onConnectFull(privateKeyInput, proxyAddressInput)
    }

    // "Load from .env" helper
    const loadFromEnv = () => {
        if (import.meta.env.VITE_PRIVATE_KEY) setPrivateKeyInput(import.meta.env.VITE_PRIVATE_KEY)
        if (import.meta.env.VITE_PROXY_ADDRESS) setProxyAddressInput(import.meta.env.VITE_PROXY_ADDRESS)
        if (import.meta.env.VITE_API_KEY) setApiKeyInput(import.meta.env.VITE_API_KEY)
        if (import.meta.env.VITE_API_SECRET) setApiSecretInput(import.meta.env.VITE_API_SECRET)
        if (import.meta.env.VITE_API_PASSPHRASE) setApiPassphraseInput(import.meta.env.VITE_API_PASSPHRASE)
        if (import.meta.env.VITE_ADDRESS) setApiAddressInput(import.meta.env.VITE_ADDRESS) // Assuming VITE_ADDRESS might exist or user adds it
    }

    if (!showEmailLogin) {
        return (
            <div className="portfolio-login">
                <div className="login-options">
                    <div className="login-info-box" style={{ marginBottom: '20px', fontSize: '0.9rem', color: '#ccc', textAlign: 'left', background: 'rgba(0,0,0,0.2)', padding: '15px', borderRadius: '8px' }}>
                        <strong>🔐 Polymarket Authentication</strong>
                        <p style={{ marginTop: '10px', marginBottom: 0, lineHeight: '1.6' }}>
                            Enter your credentials to access your Polymarket portfolio. All fields are processed locally and securely.
                        </p>
                    </div>

                    <button
                        onClick={() => setShowEmailLogin(true)}
                        className="connect-button"
                        style={{ background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)', fontWeight: 'bold' }}
                        disabled={loading}
                    >
                        <span className="icon">🔑</span>
                        Login to Polymarket
                    </button>
                </div>
                {error && <p className="error-text">{error}</p>}
            </div>
        )
    }

    return (
        <div className="portfolio-login">
            <div className="email-login-form">
                <h4>🔐 Polymarket Login</h4>
                <p style={{ fontSize: '0.85rem', color: '#aaa', marginBottom: '20px' }}>
                    Enter your credentials below. Get your Private Key from <strong>reveal.magic.link/polymarket</strong>
                </p>

                {/* Load from .env button */}
                {(import.meta.env.VITE_PRIVATE_KEY || import.meta.env.VITE_API_KEY) && (
                    <button
                        onClick={loadFromEnv}
                        className="connect-button"
                        style={{
                            background: 'linear-gradient(135deg, #10b981 0%, #059669 100%)',
                            marginBottom: '15px',
                            fontSize: '0.9rem',
                            padding: '10px 20px'
                        }}
                    >
                        <span className="icon">📁</span>
                        Load from .env File
                    </button>
                )}

                <h5 style={{ fontSize: '0.9rem', marginTop: '15px', marginBottom: '8px', color: '#ddd', textAlign: 'left' }}>Required:</h5>
                <input
                    type="text"
                    placeholder="Private Key (0x...)"
                    value={privateKeyInput}
                    onChange={(e) => setPrivateKeyInput(e.target.value)}
                    className="pk-input"
                />

                <h5 style={{ fontSize: '0.9rem', marginTop: '15px', marginBottom: '8px', color: '#ddd', textAlign: 'left' }}>Optional (for Magic/Google users):</h5>
                <input
                    type="text"
                    placeholder="Proxy Address (from polymarket.com/settings)"
                    value={proxyAddressInput}
                    onChange={(e) => setProxyAddressInput(e.target.value)}
                    className="pk-input"
                    style={{ opacity: 0.8 }}
                />

                <h5 style={{ fontSize: '0.9rem', marginTop: '15px', marginBottom: '8px', color: '#ddd', textAlign: 'left' }}>Optional (if you have existing API credentials):</h5>
                <input
                    type="text"
                    placeholder="API Key (UUID) - Optional"
                    value={apiKeyInput}
                    onChange={(e) => setApiKeyInput(e.target.value)}
                    className="pk-input"
                    style={{ opacity: 0.7 }}
                />
                <input
                    type="password"
                    placeholder="API Secret - Optional"
                    value={apiSecretInput}
                    onChange={(e) => setApiSecretInput(e.target.value)}
                    className="pk-input"
                    style={{ marginTop: '8px', opacity: 0.7 }}
                />
                <input
                    type="password"
                    placeholder="Passphrase - Optional"
                    value={apiPassphraseInput}
                    onChange={(e) => setApiPassphraseInput(e.target.value)}
                    className="pk-input"
                    style={{ marginTop: '8px', opacity: 0.7 }}
                />
                {/* The original code had separate connectApiKey but logic for Email login integrated parts of it. 
                    The 'Login' button in the original calls connectFullCredentials.
                    Wait, let's re-read UserPortfolio. ORIGINAL CODE: 
                       <button onClick={connectFullCredentials} ... > Login </button>
                    So basically the UI only exposed 'connectFullCredentials' in that view.
                    'connectApiKey' was a separate function but not obviously called in the 'email-login-form' block in the snapshot?
                    Ah, I see `connectApiKey` function in the file but I don't see it being CALLED in the rendered JSX of the snapshot for `email-login-form`. 
                    It seems `connectFullCredentials` is the primary action. 
                    However, `apiAddressInput` was needed for `connectApiKey` but missing from the UI snapshot for `email-login-form`?
                    Wait, looking at lines 463-487 of UserPortfolio.jsx:
                    It has inputs for API Key, Secret, Passphrase.
                    But NOT `apiAddressInput` (Address). 
                    `connectApiKey` function (line 278) CHECKS for `apiAddressInput`.
                    So the UI in `UserPortfolio.jsx` line 415+ `email-login-form` 
                    calls `connectFullCredentials` (line 494).
                    `connectFullCredentials` (line 327) uses `privateKeyInput` and `performL2Login`.
                    It does not seem to explicitly use the manual `apiKeyInput` etc for `performL2Login` unless `performL2Login` reads them?
                    `performL2Login` (line 36) has `creds`.
                    It calls `l1Client.deriveApiKey()` or `createApiKey()`.
                    It DOES NOT read `apiKeyInput` state.
                    So the inputs for "Optional (if you have existing API credentials)" in the UI might be unused or I missed where they are used?
                    
                    Ah, `performL2Login` logic:
                    It derives or creates. It doesn't seem to use the manual inputs.
                    The manual inputs are perhaps for a future feature or I missed something.
                    In `UserPortfolio.jsx`, `connectApiKey` uses them.
                    But `connectApiKey` is NOT called in the `email-login-form`.
                    Wait, is there another view?
                    `!showEmailLogin` shows "Login to Polymarket" button.
                    `showEmailLogin` shows the form.
                    The form calls `connectFullCredentials`.
                    
                    So `connectApiKey` is effectively dead code in the UI or I missed a button.
                    I will preserve the inputs as they are in the screenshot/code, but connectFullCredentials is the main action.
                 */}

                <div className="form-actions" style={{ marginTop: '20px' }}>
                    <button onClick={() => setShowEmailLogin(false)} className="cancel-btn">
                        Back
                    </button>
                    <button
                        onClick={handleConnectFull}
                        className="submit-btn"
                        disabled={loading}
                        style={{ background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)' }}
                    >
                        {loading ? "Authenticating..." : "Login"}
                    </button>
                </div>

                <p className="security-note" style={{ marginTop: '15px', fontSize: '0.8rem', color: '#666' }}>
                    🔒 Your credentials are only used locally and never sent to any server except Polymarket's official API.
                </p>
            </div>
            {error && <p className="error-text">{error}</p>}
        </div>
    )
}

export default LoginForm
