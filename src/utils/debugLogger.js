/**
 * Simple Event-Based Logger for the Debug Panel
 * Can be imported by non-React utility files.
 */

export const STEP_STATUS = {
    PENDING: 'pending',
    SUCCESS: 'success',
    ERROR: 'error',
    WARNING: 'warning',
    INFO: 'info'
}

export const addLog = (step, message, status = STEP_STATUS.INFO, data = null) => {
    // Dispatch event for React component to pick up
    const event = new CustomEvent('POLYBOT_DEBUG', {
        detail: {
            id: Date.now() + Math.random(),
            timestamp: new Date().toLocaleTimeString(),
            step,
            message,
            status,
            data
        }
    })
    window.dispatchEvent(event)

    // Console fallback
    const icon = status === 'success' ? '✅' : status === 'error' ? '❌' : status === 'warning' ? '⚠️' : 'ℹ️'
    console.log(`${icon} [${step}] ${message}`, data || '')
}

export const clearLogs = () => {
    window.dispatchEvent(new CustomEvent('POLYBOT_DEBUG_CLEAR'))
}
