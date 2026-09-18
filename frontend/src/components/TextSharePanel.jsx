import { useState } from 'react'
import { useSocket } from '../context/SocketContext'
import { useToast } from '../context/ToastContext'

export default function TextSharePanel({ selectedPeer, onTextSent }) {
  const { socket } = useSocket()
  const { showToast } = useToast()
  const [text, setText] = useState('')

  const handlePaste = async () => {
    try {
      const clipText = await navigator.clipboard.readText()
      if (clipText) {
        setText((prev) => (prev ? `${prev}\n${clipText}` : clipText))
        showToast('Pasted from clipboard', 'info')
      } else {
        showToast('Clipboard is empty', 'info')
      }
    } catch {
      showToast('Clipboard permission required', 'error')
    }
  }

  const handleSend = () => {
    if (!text.trim()) {
      showToast('Please type or paste some text first', 'info')
      return
    }

    if (!selectedPeer) {
      showToast('Please select a device to send to', 'error')
      return
    }

    const targetSocketId = selectedPeer.id || selectedPeer.socketId

    socket.emit('text:send', {
      targetSocketId,
      targetDeviceId: selectedPeer.deviceId,
      text: text.trim(),
    })

    showToast(`Sent text to ${selectedPeer.name}!`, 'success')
    onTextSent?.({
      name: `Text: "${text.trim().slice(0, 24)}${text.length > 24 ? '…' : ''}"`,
      size: new Blob([text]).size,
      direction: 'sent',
      peer: selectedPeer.name,
      ts: Date.now(),
    })

    setText('')
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span style={{ fontSize: '13px', fontWeight: 600, color: 'var(--gray-700)' }}>
          Send Text or Clipboard
        </span>
        <div style={{ display: 'flex', gap: '8px' }}>
          <button
            type="button"
            className="btn btn-outline"
            style={{ padding: '4px 10px', fontSize: '12px' }}
            onClick={handlePaste}
          >
            📋 Paste Clipboard
          </button>
          {text && (
            <button
              type="button"
              className="btn-ghost"
              style={{ fontSize: '12px' }}
              onClick={() => setText('')}
            >
              Clear
            </button>
          )}
        </div>
      </div>

      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="Type a message, URL, code snippet, notes, or paste your clipboard..."
        rows={6}
        style={{
          width: '100%',
          padding: '12px',
          borderRadius: 'var(--radius)',
          border: '1px solid var(--gray-300)',
          fontFamily: 'inherit',
          fontSize: '13px',
          resize: 'vertical',
          outline: 'none',
          boxSizing: 'border-box',
        }}
      />

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span style={{ fontSize: '11px', color: 'var(--gray-400)' }}>
          {text.length} characters
        </span>

        <button
          className="btn btn-primary"
          style={{ padding: '8px 18px', fontWeight: 600 }}
          onClick={handleSend}
          disabled={!text.trim()}
        >
          Send to {selectedPeer?.name || 'Device'}
        </button>
      </div>
    </div>
  )
}
