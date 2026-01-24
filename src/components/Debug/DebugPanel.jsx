import { useState, useEffect, useRef } from 'react'

const DebugPanel = () => {
    const [logs, setLogs] = useState([])
    const [isOpen, setIsOpen] = useState(false)
    const [serverTimeOffset, setServerTimeOffset] = useState(null)
    const logsEndRef = useRef(null)

    useEffect(() => {
        const handleLog = (e) => {
            const newLog = e.detail
            setLogs(prev => [...prev, newLog])
            // Auto open on error
            if (newLog.status === 'error' || newLog.status === 'warning') {
                setIsOpen(true)
            }
        }

        const handleClear = () => setLogs([])

        window.addEventListener('POLYBOT_DEBUG', handleLog)
        window.addEventListener('POLYBOT_DEBUG_CLEAR', handleClear)

        return () => {
            window.removeEventListener('POLYBOT_DEBUG', handleLog)
            window.removeEventListener('POLYBOT_DEBUG_CLEAR', handleClear)
        }
    }, [])

    // Auto scroll
    useEffect(() => {
        if (logsEndRef.current && isOpen) {
            logsEndRef.current.scrollIntoView({ behavior: 'smooth' })
        }
    }, [logs, isOpen])

    const checkTimeSync = async () => {
        try {
            const start = Date.now()
            const res = await fetch('https://clob.polymarket.com/time')
            const serverData = await res.json()
            const end = Date.now()

            // Server time is usually ISO string or timestamp
            // Actual API returns { time: "2024-..." } or just string?
            // Usually CLOB returns ISO string
            // Assuming simplified check

            console.log("Server Time Check:", serverData)
            alert(`Server Time Response: ${JSON.stringify(serverData)}`)

        } catch (e) {
            alert("Failed to fetch server time: " + e.message)
        }
    }

    if (!isOpen) {
        return (
            <div
                onClick={() => setIsOpen(true)}
                style={{
                    position: 'fixed',
                    bottom: '10px',
                    left: '10px',
                    background: '#1a1a1a',
                    color: '#00cc00',
                    padding: '8px 12px',
                    borderRadius: '4px',
                    cursor: 'pointer',
                    zIndex: 9999,
                    border: '1px solid #333',
                    fontSize: '12px',
                    opacity: 0.8
                }}
            >
                🐞 Debug ({logs.length})
            </div>
        )
    }

    return (
        <div style={{
            position: 'fixed',
            bottom: '10px',
            left: '10px',
            width: '400px',
            height: '300px',
            background: '#0a0a0a',
            color: '#e0e0e0',
            border: '1px solid #333',
            borderRadius: '8px',
            display: 'flex',
            flexDirection: 'column',
            zIndex: 9999,
            boxShadow: '0 4px 12px rgba(0,0,0,0.5)',
            fontSize: '12px',
            fontFamily: 'monospace'
        }}>
            {/* Header */}
            <div style={{
                padding: '8px',
                borderBottom: '1px solid #333',
                display: 'flex',
                justifyContent: 'space-between',
                background: '#151515',
                borderTopLeftRadius: '8px',
                borderTopRightRadius: '8px'
            }}>
                <span style={{ fontWeight: 'bold', color: '#00cc00' }}>🐞 Debug Console</span>
                <div>
                    <button onClick={checkTimeSync} style={{ marginRight: '8px', background: 'none', border: 'none', color: '#666', cursor: 'pointer' }}>⏰ Time</button>
                    <button onClick={() => setLogs([])} style={{ marginRight: '8px', background: 'none', border: 'none', color: '#666', cursor: 'pointer' }}>🚫 Clear</button>
                    <button onClick={() => setIsOpen(false)} style={{ background: 'none', border: 'none', color: '#aaa', cursor: 'pointer' }}>✖</button>
                </div>
            </div>

            {/* Logs Area */}
            <div style={{
                flex: 1,
                overflowY: 'auto',
                padding: '8px',
                display: 'flex',
                flexDirection: 'column',
                gap: '4px'
            }}>
                {logs.length === 0 && <div style={{ color: '#444', textAlign: 'center', marginTop: '20px' }}>Waiting for logs...</div>}

                {logs.map((log) => (
                    <div key={log.id} style={{
                        padding: '4px 6px',
                        background: '#111',
                        borderLeft: `3px solid ${getStatusColor(log.status)}`,
                        borderRadius: '2px'
                    }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '2px' }}>
                            <span style={{ color: '#888' }}>[{log.timestamp}]</span>
                            <span style={{ fontWeight: 'bold', color: getStatusColor(log.status) }}>{log.step}</span>
                        </div>
                        <div style={{ color: '#ccc' }}>{log.message}</div>
                        {log.data && (
                            <pre style={{
                                margin: '4px 0 0',
                                padding: '4px',
                                background: '#000',
                                color: '#aaa',
                                overflowX: 'auto',
                                fontSize: '10px'
                            }}>
                                {JSON.stringify(log.data, null, 2)}
                            </pre>
                        )}
                    </div>
                ))}
                <div ref={logsEndRef} />
            </div>
        </div>
    )
}

const getStatusColor = (status) => {
    switch (status) {
        case 'success': return '#00cc00'
        case 'error': return '#ff3333'
        case 'warning': return '#ffaa00'
        case 'pending': return '#0088ff'
        default: return '#888'
    }
}

export default DebugPanel
