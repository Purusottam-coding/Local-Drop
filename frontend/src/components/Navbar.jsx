import { useState } from 'react'
import { useSocket } from '../context/SocketContext'

export default function Navbar() {
  const { connected, myDevice, updateDeviceName } = useSocket()
  const [editing, setEditing] = useState(false)
  const [nameInput, setNameInput] = useState('')

  const startEdit = () => {
    setNameInput(myDevice.name)
    setEditing(true)
  }

  const saveEdit = (e) => {
    e.preventDefault()
    if (nameInput.trim()) {
      updateDeviceName(nameInput.trim())
    }
    setEditing(false)
  }

  return (
    <header className="navbar">
      {/* Brand */}
      <div className="nav-brand">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M12 2L2 7l10 5 10-5-10-5z" />
          <path d="M2 17l10 5 10-5" />
          <path d="M2 12l10 5 10-5" />
        </svg>
        LocalDrop
        <span className="nav-badge">LAN</span>
      </div>

      {/* This device info with inline rename */}
      <div className="nav-device">
        {editing ? (
          <form onSubmit={saveEdit} style={{ display: 'inline-flex', gap: '6px', alignItems: 'center' }}>
            <input
              type="text"
              value={nameInput}
              onChange={(e) => setNameInput(e.target.value)}
              autoFocus
              style={{
                padding: '2px 8px',
                fontSize: '13px',
                borderRadius: '4px',
                border: '1px solid var(--blue)',
                outline: 'none',
              }}
            />
            <button type="submit" className="btn-ghost" style={{ padding: '2px 6px', fontWeight: 600, color: 'var(--blue)' }}>
              Save
            </button>
            <button type="button" onClick={() => setEditing(false)} className="btn-ghost" style={{ padding: '2px 6px' }}>
              Cancel
            </button>
          </form>
        ) : (
          <span>
            <strong
              onClick={startEdit}
              title="Click to rename your device"
              style={{ cursor: 'pointer', borderBottom: '1px dashed var(--gray-400)' }}
            >
              {myDevice.name}
            </strong>{' '}
            · {myDevice.ip}
          </span>
        )}
      </div>

      {/* Connection status */}
      <div className="nav-status">
        <div className={`status-dot ${connected ? 'online' : ''}`} />
        {connected ? 'Online' : 'Offline'}
      </div>
    </header>
  )
}
