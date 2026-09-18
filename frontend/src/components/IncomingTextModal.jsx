import { useState } from 'react'
import { useToast } from '../context/ToastContext'

export default function IncomingTextModal({ textData, onClose }) {
  const { showToast } = useToast()
  const [copied, setCopied] = useState(false)

  if (!textData) return null

  const { from, text, timestamp } = textData

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      showToast('Copied to clipboard!', 'success')
      setTimeout(() => setCopied(false), 2000)
    } catch {
      showToast('Could not access clipboard', 'error')
    }
  }

  return (
    <div className="modal-overlay">
      <div className="modal" style={{ width: '480px', maxWidth: '92vw' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <h3>Text from {from?.name || 'Peer'}</h3>
          <span style={{ fontSize: '11px', color: 'var(--gray-400)' }}>
            {new Date(timestamp).toLocaleTimeString()}
          </span>
        </div>

        <div
          style={{
            background: 'var(--gray-50)',
            border: '1px solid var(--gray-200)',
            borderRadius: 'var(--radius)',
            padding: '12px',
            maxHeight: '220px',
            overflowY: 'auto',
            fontFamily: 'monospace, sans-serif',
            fontSize: '13px',
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-word',
            color: 'var(--gray-900)',
            userSelect: 'text',
          }}
        >
          {text}
        </div>

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ fontSize: '12px', color: 'var(--gray-500)' }}>
            {text.length} characters · {text.trim().split(/\s+/).filter(Boolean).length} words
          </span>

          <div style={{ display: 'flex', gap: '8px' }}>
            <button className="btn btn-outline" onClick={onClose}>
              Dismiss
            </button>
            <button className="btn btn-primary" onClick={handleCopy}>
              {copied ? '✓ Copied!' : '📋 Copy to Clipboard'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
