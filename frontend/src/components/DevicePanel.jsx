import { useState } from 'react'
import { useSocket } from '../context/SocketContext'

function getDeviceIcon(type = '') {
  const t = type.toLowerCase()
  if (t === 'mobile' || t === 'android' || t === 'ios') {
    return (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <rect x="5" y="2" width="14" height="20" rx="2" />
        <line x1="12" y1="18" x2="12.01" y2="18" />
      </svg>
    )
  }
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <rect x="2" y="3" width="20" height="14" rx="2" />
      <line x1="8" y1="21" x2="16" y2="21" />
      <line x1="12" y1="17" x2="12" y2="21" />
    </svg>
  )
}

export default function DevicePanel({ selectedPeer, onSelect }) {
  const { myDevice, peers, refreshPeers } = useSocket()
  const [scanning, setScanning] = useState(false)

  function scan() {
    setScanning(true)
    refreshPeers()
    setTimeout(() => setScanning(false), 1200)
  }

  return (
    <div className="panel">
      <div className="panel-header">
        <h2>Devices</h2>
        <button className={`btn-icon-sm ${scanning ? 'spinning' : ''}`} onClick={scan} title="Scan for devices">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <polyline points="23 4 23 10 17 10" />
            <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
          </svg>
        </button>
      </div>

      {/* This device card */}
      <div className="my-device">
        <div className="avatar">{getDeviceIcon(myDevice.type)}</div>
        <div className="device-info">
          <div className="name">{myDevice.name}</div>
          <div className="ip">{myDevice.ip}</div>
        </div>
        <span className="you-tag">You</span>
      </div>

      <div className="section-label">Nearby Online</div>

      {/* Peer list */}
      <ul className="peer-list">
        {scanning && (
          <li className="empty-state">
            <div className="scan-spinner" />
            <span>Scanning…</span>
          </li>
        )}

        {!scanning && peers.length === 0 && (
          <li className="empty-state">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="12" cy="12" r="10" />
              <line x1="12" y1="8" x2="12" y2="12" />
              <line x1="12" y1="16" x2="12.01" y2="16" />
            </svg>
            <span>No devices found on this LAN</span>
          </li>
        )}

        {!scanning &&
          peers.map((peer) => (
            <li
              key={peer.deviceId || peer.id}
              className={`peer-item ${selectedPeer?.id === peer.id || selectedPeer?.deviceId === peer.deviceId ? 'selected' : ''}`}
              onClick={() => onSelect(peer)}
            >
              <div className="peer-avatar">{getDeviceIcon(peer.type)}</div>
              <div className="device-info">
                <div className="name">{peer.name}</div>
                <div className="ip">{peer.ip}</div>
              </div>
              <div className="online-dot" />
            </li>
          ))}
      </ul>
    </div>
  )
}
