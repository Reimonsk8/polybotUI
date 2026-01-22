import React from 'react'
import './ConfirmModal.css'

const ConfirmModal = ({ isOpen, title, message, children, onConfirm, onCancel, confirmText = 'Confirm', cancelText = 'Cancel', isDestructive = false }) => {
    if (!isOpen) return null

    return (
        <div className="modal-overlay">
            <div className="modal-content">
                <div className="modal-header">
                    <h3>{title}</h3>
                </div>
                <div className="modal-body">
                    {children ? children : <p style={{ whiteSpace: 'pre-line' }}>{message}</p>}
                </div>
                <div className="modal-actions">
                    <button className="btn-cancel" onClick={onCancel}>
                        {cancelText}
                    </button>
                    <button
                        className={`btn-confirm ${isDestructive ? 'destructive' : ''}`}
                        onClick={onConfirm}
                    >
                        {confirmText}
                    </button>
                </div>
            </div>
        </div>
    )
}

export default ConfirmModal
