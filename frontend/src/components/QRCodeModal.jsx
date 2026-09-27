import { useEffect, useRef, useState, useCallback } from 'react'
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
  const [timeLeft, setTimeLeft] = useState(300) // 5 minutes in seconds
  const [autoRenewNotice, setAutoRenewNotice] = useState('')

  // Generate a fresh 5-minute temporary QR pairing PIN
  const generateFreshQR = useCallback(
    (isAuto = false) => {
      const generatedPin = Math.floor(100000 + Math.random() * 900000).toString()
      setPin(generatedPin)
      setTimeLeft(300)

      if (socket && socket.connected) {
        socket.emit('qr:create', {
          pin: generatedPin,
          expiresIn: 300,
          deviceId: myDevice?.deviceId,
        })
      }

      if (isAuto) {
        setAutoRenewNotice('Auto-generated new QR code')
        setTimeout(() => setAutoRenewNotice(''), 3000)
      }
    },
    [socket, myDevice?.deviceId]
  )

  // Countdown timer for 5-minute QR code expiration
  useEffect(() => {
    if (!isOpen) return

    const timer = setInterval(() => {
      setTimeLeft((prev) => (prev > 0 ? prev - 1 : 0))
    }, 1000)

    return () => clearInterval(timer)
  }, [isOpen])

  // Automatically generate a new QR code when the 5-minute timer expires
  useEffect(() => {
    if (!isOpen) return

    if (timeLeft === 0) {
      generateFreshQR(true)
    }
  }, [timeLeft, isOpen, generateFreshQR])

  // Fetch host LAN IP & generate PIN whenever modal opens
  useEffect(() => {
    if (!isOpen) {
      setConnectedPeerName(null)
      setAutoRenewNotice('')
      return
    }

    generateFreshQR(false)

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
  }, [isOpen, generateFreshQR])

  // Format seconds to MM:SS
  const formatTimer = (seconds) => {
    const mins = Math.floor(seconds / 60)
    const secs = seconds % 60
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`
  }

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

  const handleManualRefresh = () => {
    generateFreshQR(false)
    showToast('New QR code generated', 'info')
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

        <p style={{ fontSize: '13px', color: 'var(--gray-500)', margin: '0 0 12px' }}>
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
            {/* Live Expiry Countdown & Auto-Renewal Badge */}
            <div style={{ marginBottom: '10px' }}>
              {autoRenewNotice ? (
                <span
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '5px',
                    fontSize: '11px',
                    padding: '3px 12px',
                    borderRadius: '20px',
                    background: '#ecfdf5',
                    color: '#059669',
                    fontWeight: 600,
                    border: '1px solid #a7f3d0',
                  }}
                >
                  🔄 {autoRenewNotice}
                </span>
              ) : (
                <span
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '5px',
                    fontSize: '11px',
                    padding: '3px 12px',
                    borderRadius: '20px',
                    background: timeLeft <= 30 ? '#fef2f2' : '#eff6ff',
                    color: timeLeft <= 30 ? '#dc2626' : '#2563eb',
                    fontWeight: 600,
                    border: `1px solid ${timeLeft <= 30 ? '#fecaca' : '#bfdbfe'}`,
                  }}
                >
                  ⏱️ {timeLeft <= 30 ? 'Auto-renewing in' : 'Auto-renews in'} {formatTimer(timeLeft)}
                </span>
              )}

              {/* Progress Bar for the 5-Minute Window */}
              <div
                style={{
                  width: '140px',
                  height: '3px',
                  background: 'var(--gray-200)',
                  borderRadius: '2px',
                  margin: '5px auto 0',
                  overflow: 'hidden',
                }}
              >
                <div
                  style={{
                    width: `${(timeLeft / 300) * 100}%`,
                    height: '100%',
                    background: timeLeft <= 30 ? '#ef4444' : 'var(--blue)',
                    transition: 'width 1s linear',
                  }}
                />
              </div>
            </div>

            {/* QR Code Canvas */}
            <div
              style={{
                position: 'relative',
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
              <canvas
                ref={canvasRef}
                style={{
                  display: 'block',
                  borderRadius: '4px',
                }}
              />
            </div>

            {/* Network Address & Instructions */}
            <div
              style={{
                background: 'var(--gray-50)',
                border: '1px solid var(--gray-200)',
                borderRadius: '8px',
                padding: '10px 14px',
                marginBottom: '10px',
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

            <p style={{ fontSize: '11px', color: 'var(--gray-400)', margin: '0 0 14px' }}>
              Temporary QR code valid for 5 min • Auto-generates a new QR upon expiration
            </p>
          </>
        )}

        <div style={{ display: 'flex', gap: '8px' }}>
          <button
            type="button"
            className="btn btn-outline"
            style={{ flex: 1, fontSize: '12px' }}
            onClick={handleManualRefresh}
            title="Generate a new QR code now"
          >
            🔄 New QR
          </button>
          <button
            type="button"
            className="btn btn-outline"
            style={{ flex: 1, fontSize: '12px' }}
            onClick={handleCopyLink}
          >
            {copied ? '✓ Copied' : '🔗 Copy Link'}
          </button>
          <button
            type="button"
            className="btn btn-primary"
            style={{ minWidth: '70px', fontSize: '12px' }}
            onClick={onClose}
          >
            Done
          </button>
        </div>
      </div>
    </div>
  )
}
