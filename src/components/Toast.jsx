import React from 'react'

// Blockchain-confirmation toast. Shows on successful (or failed) mint.
export function Toast({ toast, onClose }) {
  if (!toast) return null
  const ok = toast.kind === 'ok'
  return (
    <div className={'toast ' + (ok ? 'ok' : 'warn')} role="status">
      <div className="toast-icon">
        {ok ? (
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4">
            <path d="M20 6L9 17l-5-5" />
          </svg>
        ) : (
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
            <circle cx="12" cy="12" r="9" /><path d="M12 8v5M12 16h.01" />
          </svg>
        )}
      </div>
      <div className="toast-body">
        <div className="toast-msg">{toast.msg}</div>
        {toast.txId && (
          <a className="toast-link" href={'https://arweave.net/' + toast.txId} target="_blank" rel="noopener noreferrer">
            View on Arweave · {String(toast.txId).slice(0, 8)}…
          </a>
        )}
      </div>
      <button className="toast-x" onClick={onClose} aria-label="Dismiss">×</button>
    </div>
  )
}
