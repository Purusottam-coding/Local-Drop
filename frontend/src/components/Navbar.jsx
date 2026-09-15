import { useSocket } from '../context/SocketContext'

export default function Navbar() {
  const { connected, myDevice } = useSocket()

  return (
    <header className="navbar">
      {/* Brand */}
      <div className="nav-brand">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M12 2L2 7l10 5 10-5-10-5z"/>
          <path d="M2 17l10 5 10-5"/>
          <path d="M2 12l10 5 10-5"/>
        </svg>
        LocalDrop
        <span className="nav-badge">LAN</span>
      </div>

      {/* This device */}
      <div className="nav-device">
        <strong>{myDevice.name}</strong> · {myDevice.ip}
      </div>

      {/* Connection status */}
      <div className="nav-status">
        <div className={`status-dot ${connected ? 'online' : ''}`} />
        {connected ? 'Online' : 'Offline'}
      </div>
    </header>
  )
}
