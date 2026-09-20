export default function PairingModal({
  incomingPairing,
  pendingPairing,
  onAccept,
  onReject,
  onCancel,
}) {
  if (!incomingPairing && !pendingPairing) return null

  // 1. Incoming pairing request (Receiver side)
  if (incomingPairing) {
    const { from, pin } = incomingPairing
    return (
      <div className="modal-overlay">
        <div className="modal" style={{ width: '100%', maxWidth: '400px', textAlign: 'center' }}>
          <div style={{ fontSize: '32px', marginBottom: '4px' }}>🔐</div>
          <h3>Connection Request</h3>
          <p style={{ fontSize: '13px', color: 'var(--gray-600)', margin: '8px 0 16px' }}>
            <strong>{from?.name}</strong> wants to pair with your device.
          </p>

          <div
            style={{
              background: 'var(--blue-light)',
              border: '1px solid var(--blue)',
              borderRadius: '8px',
              padding: '16px',
              marginBottom: '20px',
            }}
          >
            <div style={{ fontSize: '11px', textTransform: 'uppercase', letterSpacing: '1px', color: 'var(--blue)', fontWeight: 600 }}>
              Pairing PIN
            </div>
            <div
              style={{
                fontSize: '32px',
                fontWeight: 700,
                letterSpacing: '8px',
                fontFamily: 'monospace',
                color: 'var(--blue-dark)',
                marginTop: '4px',
              }}
            >
              {pin}
            </div>
            <div style={{ fontSize: '11px', color: 'var(--gray-500)', marginTop: '6px' }}>
              Confirm that this PIN matches on both devices
            </div>
          </div>

          <div className="modal-actions" style={{ display: 'flex', gap: '10px' }}>
            <button className="btn btn-outline" style={{ flex: 1 }} onClick={onReject}>
              Decline
            </button>
            <button className="btn btn-primary" style={{ flex: 1, fontWeight: 600 }} onClick={onAccept}>
              Accept & Trust
            </button>
          </div>
        </div>
      </div>
    )
  }

  // 2. Pending pairing request (Sender side)
  if (pendingPairing) {
    const { targetDeviceName, pin } = pendingPairing
    return (
      <div className="modal-overlay">
        <div className="modal" style={{ width: '100%', maxWidth: '400px', textAlign: 'center' }}>
          <div className="scan-spinner" style={{ margin: '0 auto 12px' }} />
          <h3>Pairing with {targetDeviceName}</h3>
          <p style={{ fontSize: '13px', color: 'var(--gray-600)', margin: '8px 0 16px' }}>
            Waiting for {targetDeviceName} to accept the connection...
          </p>

          <div
            style={{
              background: 'var(--gray-50)',
              border: '1px solid var(--gray-200)',
              borderRadius: '8px',
              padding: '16px',
              marginBottom: '20px',
            }}
          >
            <div style={{ fontSize: '11px', textTransform: 'uppercase', letterSpacing: '1px', color: 'var(--gray-500)', fontWeight: 600 }}>
              Verify PIN
            </div>
            <div
              style={{
                fontSize: '32px',
                fontWeight: 700,
                letterSpacing: '8px',
                fontFamily: 'monospace',
                color: 'var(--gray-900)',
                marginTop: '4px',
              }}
            >
              {pin}
            </div>
          </div>

          <button className="btn btn-outline" style={{ width: '100%' }} onClick={onCancel}>
            Cancel
          </button>
        </div>
      </div>
    )
  }

  return null
}
