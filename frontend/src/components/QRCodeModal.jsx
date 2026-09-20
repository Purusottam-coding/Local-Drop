import { useEffect, useRef, useState } from 'react'
import QRCode from 'qrcode'
import { useSocket } from '../context/SocketContext'
import { useToast } from '../context/ToastContext'
import { networkApi } from '../services/api'

export default function QRCodeModal({ myDevice, isOpen, onClose }) {
  const { socket } = useSocket()
  const { showToast } = useToast()
  const canvasRef = useRef(null)
  const [pin, setPin] = useState('')
  const [lanIp, setLanIp] = useState(myDevice?.lanIp || '')
  const [copied, setCopied] = useState(false)
  const [connectedPeerName, setConnectedPeerName] = useState(null)

  // Fetch host LAN IP whenever modal opens
  useEffect(() => {
    if (!isOpen) {
      setConnectedPeerName(null)
      return
    }

    // Generate a temporary 6-digit pairing PIN
    const generatedPin = Math.floor(100000 + Math.random() * 900000).toString()
    setPin(generatedPin)

    // Fetch network IP from backend
    networkApi
      .getNetworkInfo()
      .then((res) => {
        if (res.lanIp && res.lanIp !== '127.0.0.1') {
          setLanIp(res.lanIp)
        }
      })
      .catch((err) => {
        console.warn('[QRCodeModal] Could not fetch LAN IP:', err.message)
      })
  }, [isOpen])

  // Resolve host address for mobile QR scanning
  const effectiveLanIp =
    lanIp ||
    (myDevice?.lanIp && myDevice.lanIp !== '127.0.0.1' ? myDevice.lanIp : null) ||
    (window.location.hostname !== 'localhost' && window.location.hostname !== '127.0.0.1'
      ? window.location.hostname
      : null)

  const resolvedHost = effectiveLanIp ? `${effectiveLanIp}:5173` : window.location.host

  const pairingUrl = `${window.location.protocol}//${resolvedHost}/?pair=${myDevice?.deviceId || ''}&name=${encodeURIComponent(
    myDevice?.name || 'Device'
  )}&pin=${pin}`

  // Render QR Canvas
  useEffect(() => {
    if (!isOpen || !canvasRef.current || !pin) return

    QRCode.toCanvas(
      canvasRef.current,
      pairingUrl,
      {
        width: 220,
        margin: 2,
        color: {
          dark: '#0f172a',
          light: '#ffffff',
        },
      },
      (err) => {
        if (err) console.error('[QR Code Error]:', err)
      }
    )
  }, [isOpen, pairingUrl, pin])

  // Auto-close on successful QR connection
  useEffect(() => {
    if (!socket || !isOpen) return

    const handleQrPaired = ({ pairedDevice }) => {
      setConnectedPeerName(pairedDevice?.name || 'Nearby Device')
      setTimeout(() => {
        onClose()
      }, 1400)
    }

    socket.on('qr:paired', handleQrPaired)
    return () => {
      socket.off('qr:paired', handleQrPaired)
    }
  }, [socket, isOpen, onClose])

  if (!isOpen) return null

  const handleCopyLink = async () => {
    try {
      await navigator.clipboard.writeText(pairingUrl)
      setCopied(true)
      showToast('Pairing link copied!', 'success')
      setTimeout(() => setCopied(false), 2000)
    } catch {
      showToast('Could not copy link', 'error')
    }
  }

  return (
    <div className="modal-overlay">
      <div className="modal" style={{ width: '100%', maxWidth: '400px', textAlign: 'center' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
          <h3 style={{ margin: 0 }}>Scan to Connect</h3>
          <button
            type="button"
            className="btn-ghost"
            style={{ fontSize: '18px', padding: '0 4px', lineHeight: 1 }}
            onClick={onClose}
          >
            ✕
          </button>
        </div>

        <p style={{ fontSize: '13px', color: 'var(--gray-500)', margin: '0 0 14px' }}>
          Scan with any mobile camera on the same Wi-Fi to pair and transfer files instantly
        </p>

        {/* Connected Success Notification */}
        {connectedPeerName ? (
          <div
            style={{
              padding: '24px 16px',
              background: '#ecfdf5',
              border: '1px solid #a7f3d0',
              borderRadius: '12px',
              marginBottom: '16px',
              color: '#065f46',
            }}
          >
            <div style={{ fontSize: '32px', marginBottom: '8px' }}>✓</div>
            <div style={{ fontWeight: 600, fontSize: '16px' }}>Connected to {connectedPeerName}!</div>
            <div style={{ fontSize: '12px', color: '#047857', marginTop: '4px' }}>
              Devices paired successfully. Closing...
            </div>
          </div>
        ) : (
          <>
            {/* QR Code Canvas */}
            <div
              style={{
                background: 'var(--white)',
                border: '1px solid var(--gray-200)',
                borderRadius: '12px',
                padding: '12px',
                display: 'inline-flex',
                justifyContent: 'center',
                boxShadow: 'var(--shadow-sm)',
                marginBottom: '12px',
              }}
            >
              <canvas ref={canvasRef} style={{ display: 'block', borderRadius: '4px' }} />
            </div>

            {/* Network Address & Instructions */}
            <div
              style={{
                background: 'var(--gray-50)',
                border: '1px solid var(--gray-200)',
                borderRadius: '8px',
                padding: '10px 14px',
                marginBottom: '14px',
                textAlign: 'left',
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div>
                  <div style={{ fontSize: '10px', color: 'var(--gray-500)', textTransform: 'uppercase', fontWeight: 700 }}>
                    Target Address
                  </div>
                  <div style={{ fontSize: '13px', fontWeight: 600, color: 'var(--blue)', fontFamily: 'monospace' }}>
                    http://{resolvedHost}
                  </div>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <div style={{ fontSize: '10px', color: 'var(--gray-500)', textTransform: 'uppercase', fontWeight: 700 }}>
                    PIN
                  </div>
                  <div style={{ fontSize: '16px', fontWeight: 700, fontFamily: 'monospace', color: 'var(--gray-800)' }}>
                    {pin}
                  </div>
                </div>
              </div>
            </div>
          </>
        )}

        <div style={{ display: 'flex', gap: '8px' }}>
          <button
            type="button"
            className="btn btn-outline"
            style={{ flex: 1, fontSize: '12px' }}
            onClick={handleCopyLink}
          >
            {copied ? '✓ Link Copied' : '🔗 Copy Link'}
          </button>
          <button
            type="button"
            className="btn btn-primary"
            style={{ flex: 1, fontSize: '12px' }}
            onClick={onClose}
          >
            Done
          </button>
        </div>
      </div>
    </div>
  )
}
