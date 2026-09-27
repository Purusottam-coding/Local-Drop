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

export default function DevicePanel({
  selectedPeer,
  onSelect,
  trustedDeviceIds = [],
  onPairRequest,
  onToggleTrust,
  onRemoveDevice,
}) {
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

      {/* When no devices are available, show clean searching state */}
      {!scanning && peers.length === 0 && (
        <div style={{ marginTop: '16px' }}>
          <div className="section-label">Nearby Devices</div>
          <div
            className="empty-state"
            style={{
              padding: '28px 14px',
              textAlign: 'center',
              background: 'var(--gray-50)',
              borderRadius: '10px',
              border: '1px dashed var(--gray-200)',
              marginTop: '6px',
            }}
          >
            <div style={{ fontSize: '24px', marginBottom: '8px' }}>📡</div>
            <div style={{ fontSize: '13px', fontWeight: 600, color: 'var(--gray-800)', marginBottom: '4px' }}>
              No nearby devices found
            </div>
            <div style={{ fontSize: '11px', color: 'var(--gray-500)', lineHeight: '1.4' }}>
              Connect another device to the same Wi-Fi or scan your QR code to connect.
            </div>
          </div>
        </div>
      )}

      {/* Peer list - Only shown when nearby devices are available or scanning */}
      {(scanning || peers.length > 0) && (
        <>
          <div className="section-label" style={{ display: 'flex', justifyContent: 'space-between' }}>
            <span>Nearby Online ({peers.length})</span>
          </div>

          <ul className="peer-list">
            {scanning && (
              <li className="empty-state">
                <div className="scan-spinner" />
                <span>Scanning LAN…</span>
              </li>
            )}

            {!scanning &&
              peers.map((peer) => {
                const isConnected = trustedDeviceIds.includes(peer.deviceId)

                return (
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

                    {/* Action buttons */}
                    <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: '6px' }}>
                      {isConnected ? (
                        <button
                          type="button"
                          className="badge sent"
                          style={{
                            border: 'none',
                            cursor: 'pointer',
                            fontSize: '10px',
                            padding: '3px 8px',
                            background: 'var(--green-light)',
                            color: 'var(--green)',
                            fontWeight: 600,
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: '4px',
                          }}
                          title="Connected (Click to disconnect)"
                          onClick={(e) => {
                            e.stopPropagation()
                            onToggleTrust?.(peer, false)
                          }}
                        >
                          ● Connected
                        </button>
                      ) : (
                        <button
                          type="button"
                          className="btn-ghost"
                          style={{
                            fontSize: '11px',
                            padding: '2px 6px',
                            color: 'var(--blue)',
                            border: '1px solid var(--blue-light)',
                            borderRadius: '4px',
                          }}
                          title="Pair with this device"
                          onClick={(e) => {
                            e.stopPropagation()
                            onPairRequest?.(peer)
                          }}
                        >
                          Pair
                        </button>
                      )}

                      {/* Manual Remove Device Button */}
                      <button
                        type="button"
                        style={{
                          background: 'none',
                          border: 'none',
                          color: 'var(--gray-400)',
                          cursor: 'pointer',
                          padding: '2px 6px',
                          fontSize: '13px',
                          borderRadius: '4px',
                          lineHeight: 1,
                          transition: 'color 0.15s ease',
                        }}
                        onMouseEnter={(e) => (e.currentTarget.style.color = '#ef4444')}
                        onMouseLeave={(e) => (e.currentTarget.style.color = 'var(--gray-400)')}
                        title="Remove device from list"
                        onClick={(e) => {
                          e.stopPropagation()
                          onRemoveDevice?.(peer)
                        }}
                      >
                        ✕
                      </button>

                      <div className="online-dot" />
                    </div>
                  </li>
                )
              })}
          </ul>
        </>
      )}
    </div>
  )
}
