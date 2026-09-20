import { useState } from 'react'
import { useSocket } from '../context/SocketContext'
import { isSoundEnabled, setSoundEnabled, playChime } from '../utils/audioFeedback'

export default function Navbar({ onOpenQR, onOpenSession, activeSession }) {
  const { connected, myDevice, updateDeviceName } = useSocket()
  const [editing, setEditing] = useState(false)
  const [nameInput, setNameInput] = useState('')
  const [soundOn, setSoundOn] = useState(isSoundEnabled)

  const toggleSound = () => {
    const next = !soundOn
    setSoundOn(next)
    setSoundEnabled(next)
    if (next) playChime('paired')
  }

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
          <span className="nav-device-label">
            <strong
              onClick={startEdit}
              className="nav-device-name"
              title="Click to rename your device"
              style={{ cursor: 'pointer', borderBottom: '1px dashed var(--gray-400)' }}
            >
              {myDevice.name}
            </strong>
            <span className="nav-device-ip"> · {myDevice.ip}</span>
          </span>
        )}
      </div>

      {/* Actions and connection status */}
      <div className="nav-actions">
        {/* Temporary File-Sharing Session Button */}
        <button
          type="button"
          className={`btn ${activeSession ? 'btn-primary' : 'btn-outline'} nav-session-btn`}
          onClick={onOpenSession}
          title={activeSession ? `Active Session: ${activeSession.sessionCode}` : 'Temporary File-Sharing Session'}
          style={{
            fontSize: '12px',
            padding: '6px 12px',
            display: 'inline-flex',
            alignItems: 'center',
            gap: '6px',
            fontWeight: 600,
          }}
        >
          {activeSession ? (
            <>
              <span
                style={{
                  width: '8px',
                  height: '8px',
                  borderRadius: '50%',
                  background: '#4ade80',
                  boxShadow: '0 0 6px #4ade80',
                  display: 'inline-block',
                }}
              />
              <span>{activeSession.sessionCode}</span>
            </>
          ) : (
            <>
              <span>⚡</span>
              <span className="nav-session-label">Session</span>
            </>
          )}
        </button>

        <button
          type="button"
          className="btn btn-outline nav-qr-btn"
          onClick={onOpenQR}
          title="Show Pairing QR Code"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ width: '15px', height: '15px' }}>
            <rect x="3" y="3" width="7" height="7" />
            <rect x="14" y="3" width="7" height="7" />
            <rect x="14" y="14" width="7" height="7" />
            <rect x="3" y="14" width="7" height="7" />
          </svg>
          <span className="nav-qr-label">Show QR</span>
        </button>

        <button
          type="button"
          className="btn-icon-sm"
          onClick={toggleSound}
          title={soundOn ? 'Sound alerts enabled (click to mute)' : 'Sound alerts muted (click to unmute)'}
          style={{ border: 'none', background: 'none', fontSize: '15px', cursor: 'pointer', padding: '2px' }}
        >
          {soundOn ? '🔔' : '🔕'}
        </button>

        <div className="nav-status">
          <div className={`status-dot ${connected ? 'online' : ''}`} />
          <span className="nav-status-text">{connected ? 'Online' : 'Offline'}</span>
        </div>
      </div>
    </header>
  )
}
