import { useState, useEffect, useRef } from 'react'
import QRCode from 'qrcode'
import { useToast } from '../context/ToastContext'
import { sessionApi, networkApi } from '../services/api'
import { fileEmoji, formatBytes } from '../utils/helpers'
import { downloadFileBlob } from '../services/webrtcService'
import { playChime } from '../utils/audioFeedback'

export default function SessionModal({
  isOpen,
  onClose,
  myDevice,
  activeSession,
  setActiveSession,
  socket,
  sessionBlobs,
  setSessionBlobs,
  prefilledCode = '',
}) {
  const { showToast } = useToast()

  // Tab: 'create' | 'join'
  const [tab, setTab] = useState(prefilledCode ? 'join' : 'create')
  const [durationMinutes, setDurationMinutes] = useState(30)
  const [joinCodeInput, setJoinCodeInput] = useState(prefilledCode || '')
  const [loading, setLoading] = useState(false)
  const [showQr, setShowQr] = useState(false)
  const [lanIp, setLanIp] = useState(myDevice?.lanIp || '')
  const [remainingSec, setRemainingSec] = useState(activeSession?.remainingSeconds || 0)
  const [downloadedMap, setDownloadedMap] = useState({})
  const [previewFile, setPreviewFile] = useState(null)
  const [downloadingAll, setDownloadingAll] = useState(false)

  const canvasRef = useRef(null)
  const fileInputRef = useRef(null)

  // Sync prefilledCode
  useEffect(() => {
    if (prefilledCode) {
      setJoinCodeInput(prefilledCode)
      setTab('join')
    }
  }, [prefilledCode])

  // Fetch host LAN IP for link generation
  useEffect(() => {
    if (isOpen) {
      networkApi
        .getNetworkInfo()
        .then((res) => {
          if (res.lanIp && res.lanIp !== '127.0.0.1') {
            setLanIp(res.lanIp)
          }
        })
        .catch(() => {})
    }
  }, [isOpen])

  // Countdown timer for active session
  useEffect(() => {
    if (!activeSession?.expiresAt) return

    const calculateRemaining = () => {
      const exp = new Date(activeSession.expiresAt).getTime()
      const diff = Math.max(0, Math.floor((exp - Date.now()) / 1000))
      return diff
    }

    setRemainingSec(calculateRemaining())

    const timer = setInterval(() => {
      const rem = calculateRemaining()
      setRemainingSec(rem)
      if (rem <= 0) {
        clearInterval(timer)
        showToast('Temporary session has expired and self-destructed.', 'info')
        setActiveSession(null)
      }
    }, 1000)

    return () => clearInterval(timer)
  }, [activeSession?.expiresAt, setActiveSession, showToast])

  // Render QR Code when active session and QR toggled
  useEffect(() => {
    if (showQr && activeSession && canvasRef.current) {
      const effectiveLanIp =
        lanIp ||
        (myDevice?.lanIp && myDevice.lanIp !== '127.0.0.1' ? myDevice.lanIp : null) ||
        (window.location.hostname !== 'localhost' && window.location.hostname !== '127.0.0.1'
          ? window.location.hostname
          : '127.0.0.1')
      const currentPort = window.location.port || '5173'
      const sessionUrl = `http://${effectiveLanIp}:${currentPort}/?session=${activeSession.sessionCode}`

      QRCode.toCanvas(canvasRef.current, sessionUrl, {
        width: 170,
        margin: 2,
        color: { dark: '#0f172a', light: '#ffffff' },
      }).catch((err) => console.error('QR Render Error:', err))
    }
  }, [showQr, activeSession, lanIp, myDevice?.lanIp])

  // Format seconds to mm:ss or hh:mm:ss
  const formatTimer = (seconds) => {
    if (seconds <= 0) return 'Expired'
    const m = Math.floor(seconds / 60)
    const s = seconds % 60
    if (m >= 60) {
      const h = Math.floor(m / 60)
      const remM = m % 60
      return `${h}h ${remM}m ${s < 10 ? '0' : ''}${s}s`
    }
    return `${m}m ${s < 10 ? '0' : ''}${s}s`
  }

  // Create temporary session
  const handleCreate = async () => {
    setLoading(true)
    try {
      const res = await sessionApi.createSession({
        deviceId: myDevice.deviceId,
        name: myDevice.name,
        durationMinutes,
      })
      if (res.success && res.data) {
        setActiveSession(res.data)
        playChime('paired')
        showToast(`Temporary session created: ${res.data.sessionCode}!`, 'success')

        // Join room on socket
        if (socket) {
          socket.emit('session:join', {
            sessionCode: res.data.sessionCode,
            deviceId: myDevice.deviceId,
            name: myDevice.name,
          })
        }
      }
    } catch (err) {
      showToast(err.message || 'Failed to create temporary session', 'error')
    } finally {
      setLoading(false)
    }
  }

  // Join existing session
  const handleJoin = async (codeToJoin) => {
    const raw = (codeToJoin || joinCodeInput).trim().toUpperCase()
    if (!raw) {
      showToast('Please enter a session code', 'info')
      return
    }

    setLoading(true)
    try {
      const res = await sessionApi.joinSession(raw, {
        deviceId: myDevice.deviceId,
        name: myDevice.name,
        socketId: socket?.id || null,
      })
      if (res.success && res.data) {
        setActiveSession(res.data)
        playChime('paired')
        showToast(`Joined session ${res.data.sessionCode}!`, 'success')

        // Join socket room
        if (socket) {
          socket.emit('session:join', {
            sessionCode: res.data.sessionCode,
            deviceId: myDevice.deviceId,
            name: myDevice.name,
          })
        }
      }
    } catch (err) {
      showToast(err.message || 'Session not found or expired', 'error')
    } finally {
      setLoading(false)
    }
  }

  // Copy shareable session URL to clipboard
  const handleCopyLink = () => {
    if (!activeSession) return
    const effectiveLanIp =
      lanIp ||
      (myDevice?.lanIp && myDevice.lanIp !== '127.0.0.1' ? myDevice.lanIp : null) ||
      (window.location.hostname !== 'localhost' && window.location.hostname !== '127.0.0.1'
        ? window.location.hostname
        : '127.0.0.1')
    const currentPort = window.location.port || '5173'
    const sessionUrl = `http://${effectiveLanIp}:${currentPort}/?session=${activeSession.sessionCode}`

    navigator.clipboard
      .writeText(sessionUrl)
      .then(() => showToast('✓ Session link copied to clipboard!', 'success'))
      .catch(() => showToast('Could not copy link to clipboard', 'info'))
  }

  // Copy session code
  const handleCopyCode = () => {
    if (!activeSession) return
    navigator.clipboard
      .writeText(activeSession.sessionCode)
      .then(() => showToast(`✓ Code ${activeSession.sessionCode} copied!`, 'success'))
      .catch(() => {})
  }

  // Upload/share files into session
  const handleFilesSelected = async (filesList) => {
    if (!filesList || !filesList.length || !activeSession || !socket) return

    for (const file of Array.from(filesList)) {
      const fileId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
      const buffer = await file.arrayBuffer()

      // Store locally
      setSessionBlobs((prev) => ({
        ...prev,
        [fileId]: file,
      }))

      // Emit binary buffer to room members
      socket.emit('session:file-binary', {
        sessionCode: activeSession.sessionCode,
        fileId,
        name: file.name,
        size: file.size,
        type: file.type,
        senderName: myDevice.name,
        senderDeviceId: myDevice.deviceId,
        buffer,
      })

      playChime('send')
      showToast(`Shared "${file.name}" to session`, 'info')
    }
  }

  // Download a single file
  const handleDownloadFile = (file) => {
    const blob = sessionBlobs[file.fileId] || sessionBlobs[file.name]
    if (blob) {
      downloadFileBlob(blob, file.name)
      setDownloadedMap((prev) => ({ ...prev, [file.fileId]: true, [file.name]: true }))
    } else {
      // Request file on-demand if not in memory
      showToast(`Requesting ${file.name} from room…`, 'info')
      if (socket) {
        socket.emit('session:request-file', {
          sessionCode: activeSession.sessionCode,
          fileId: file.fileId,
        })
      }
    }
  }

  // Download all files sequentially
  const handleDownloadAll = async () => {
    const files = activeSession?.files || []
    if (!files.length) return

    setDownloadingAll(true)
    for (const file of files) {
      const blob = sessionBlobs[file.fileId] || sessionBlobs[file.name]
      if (blob) {
        downloadFileBlob(blob, file.name)
        setDownloadedMap((prev) => ({ ...prev, [file.fileId]: true, [file.name]: true }))
        await new Promise((r) => setTimeout(r, 220))
      } else if (socket) {
        socket.emit('session:request-file', {
          sessionCode: activeSession.sessionCode,
          fileId: file.fileId,
        })
      }
    }
    setDownloadingAll(false)
  }

  // Destroy session (Host only)
  const handleDestroy = async () => {
    if (!activeSession) return
    if (!window.confirm(`Are you sure you want to end and destroy session ${activeSession.sessionCode}? All participants will be disconnected.`)) {
      return
    }

    try {
      if (socket) {
        socket.emit('session:destroy', {
          sessionCode: activeSession.sessionCode,
          deviceId: myDevice.deviceId,
        })
      }
      await sessionApi.closeSession(activeSession.sessionCode, {
        deviceId: myDevice.deviceId,
      })
      setActiveSession(null)
      showToast('Session destroyed successfully', 'info')
      onClose()
    } catch (err) {
      showToast(err.message || 'Failed to destroy session', 'error')
    }
  }

  // Leave session (Participant)
  const handleLeave = async () => {
    if (!activeSession) return
    try {
      if (socket) {
        socket.emit('session:leave', {
          sessionCode: activeSession.sessionCode,
          deviceId: myDevice.deviceId,
        })
      }
      await sessionApi.leaveSession(activeSession.sessionCode, {
        deviceId: myDevice.deviceId,
      })
      setActiveSession(null)
      showToast('Left temporary session', 'info')
      onClose()
    } catch {
      setActiveSession(null)
      onClose()
    }
  }

  if (!isOpen) return null

  const isHost = activeSession?.creator?.deviceId === myDevice.deviceId
  const filesList = activeSession?.files || []
  const participantsList = activeSession?.participants || []
  const isExpiringSoon = remainingSec > 0 && remainingSec < 180

  return (
    <div className="modal-overlay">
      <div
        className="modal"
        style={{
          width: '100%',
          maxWidth: activeSession ? '540px' : '440px',
          textAlign: 'left',
          maxHeight: '90vh',
          overflowY: 'auto',
        }}
      >
        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span style={{ fontSize: '20px' }}>⚡</span>
            <h3 style={{ margin: 0, fontSize: '17px' }}>
              {activeSession ? `Session ${activeSession.sessionCode}` : 'Temporary File-Sharing Session'}
            </h3>
          </div>
          <button
            type="button"
            className="btn-ghost"
            style={{ fontSize: '18px', padding: '2px 6px', lineHeight: 1 }}
            onClick={onClose}
            title="Close modal (keeps session active in background)"
          >
            ✕
          </button>
        </div>

        {/* NOT IN SESSION: CREATE OR JOIN TABS */}
        {!activeSession && (
          <>
            <div
              style={{
                display: 'flex',
                background: 'var(--gray-100)',
                padding: '4px',
                borderRadius: '8px',
                marginBottom: '16px',
              }}
            >
              <button
                type="button"
                className={`btn ${tab === 'create' ? 'btn-primary' : 'btn-ghost'}`}
                style={{ flex: 1, padding: '6px 12px', fontSize: '13px', borderRadius: '6px' }}
                onClick={() => setTab('create')}
              >
                Create Session
              </button>
              <button
                type="button"
                className={`btn ${tab === 'join' ? 'btn-primary' : 'btn-ghost'}`}
                style={{ flex: 1, padding: '6px 12px', fontSize: '13px', borderRadius: '6px' }}
                onClick={() => setTab('join')}
              >
                Join With Code
              </button>
            </div>

            {tab === 'create' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
                <div>
                  <label style={{ fontSize: '12px', fontWeight: 600, color: 'var(--gray-700)', display: 'block', marginBottom: '6px' }}>
                    Session Expiration Duration
                  </label>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '8px' }}>
                    {[15, 30, 60].map((mins) => (
                      <button
                        key={mins}
                        type="button"
                        onClick={() => setDurationMinutes(mins)}
                        style={{
                          padding: '10px 8px',
                          borderRadius: '8px',
                          fontSize: '13px',
                          fontWeight: 600,
                          cursor: 'pointer',
                          textAlign: 'center',
                          border: durationMinutes === mins ? '2px solid var(--blue)' : '1px solid var(--gray-200)',
                          background: durationMinutes === mins ? 'rgba(59, 130, 246, 0.08)' : 'var(--white)',
                          color: durationMinutes === mins ? 'var(--blue)' : 'var(--gray-700)',
                        }}
                      >
                        {mins} Minutes
                      </button>
                    ))}
                  </div>
                </div>

                <div
                  style={{
                    padding: '10px 12px',
                    borderRadius: '8px',
                    background: 'var(--gray-50)',
                    border: '1px solid var(--gray-200)',
                    fontSize: '12px',
                    color: 'var(--gray-600)',
                    lineHeight: '1.4',
                  }}
                >
                  🔒 <strong>Self-Destructing:</strong> This session, its shareable invite code, and all shared files will automatically expire and purge after {durationMinutes} minutes.
                </div>

                <button
                  type="button"
                  className="btn btn-primary"
                  style={{ padding: '10px 16px', fontSize: '14px', fontWeight: 600, width: '100%' }}
                  onClick={handleCreate}
                  disabled={loading}
                >
                  {loading ? 'Generating Session…' : '⚡ Start Temporary Session'}
                </button>
              </div>
            )}

            {tab === 'join' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
                <div>
                  <label style={{ fontSize: '12px', fontWeight: 600, color: 'var(--gray-700)', display: 'block', marginBottom: '6px' }}>
                    Enter 6-Character Session Code
                  </label>
                  <input
                    type="text"
                    value={joinCodeInput}
                    onChange={(e) => setJoinCodeInput(e.target.value.toUpperCase())}
                    placeholder="e.g. DROP-8492"
                    maxLength={10}
                    style={{
                      width: '100%',
                      padding: '10px 12px',
                      fontSize: '16px',
                      fontFamily: 'monospace',
                      fontWeight: 700,
                      letterSpacing: '1px',
                      borderRadius: '8px',
                      border: '1px solid var(--gray-300)',
                      boxSizing: 'border-box',
                      outline: 'none',
                    }}
                    onKeyDown={(e) => e.key === 'Enter' && handleJoin()}
                    autoFocus
                  />
                </div>

                <button
                  type="button"
                  className="btn btn-primary"
                  style={{ padding: '10px 16px', fontSize: '14px', fontWeight: 600, width: '100%' }}
                  onClick={() => handleJoin()}
                  disabled={loading || !joinCodeInput.trim()}
                >
                  {loading ? 'Connecting…' : 'Enter Session Room ➔'}
                </button>
              </div>
            )}
          </>
        )}

        {/* ACTIVE SESSION ROOM */}
        {activeSession && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
            {/* Countdown Banner */}
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                padding: '10px 14px',
                borderRadius: '8px',
                background: isExpiringSoon ? 'rgba(239, 68, 68, 0.1)' : 'rgba(59, 130, 246, 0.08)',
                border: isExpiringSoon ? '1px solid var(--red)' : '1px solid rgba(59, 130, 246, 0.2)',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span style={{ fontSize: '16px' }}>⏱️</span>
                <div>
                  <div style={{ fontSize: '11px', color: 'var(--gray-500)', textTransform: 'uppercase', fontWeight: 600 }}>
                    Auto Self-Destruct
                  </div>
                  <div
                    style={{
                      fontSize: '14px',
                      fontWeight: 700,
                      color: isExpiringSoon ? 'var(--red)' : 'var(--blue)',
                    }}
                  >
                    {formatTimer(remainingSec)}
                  </div>
                </div>
              </div>

              <div style={{ display: 'flex', gap: '6px' }}>
                <button
                  type="button"
                  className="btn btn-outline"
                  style={{ padding: '4px 10px', fontSize: '12px' }}
                  onClick={handleCopyCode}
                  title="Copy session code"
                >
                  📋 Code
                </button>
                <button
                  type="button"
                  className="btn btn-outline"
                  style={{ padding: '4px 10px', fontSize: '12px' }}
                  onClick={handleCopyLink}
                  title="Copy direct invite link"
                >
                  🔗 Link
                </button>
                <button
                  type="button"
                  className={`btn ${showQr ? 'btn-primary' : 'btn-outline'}`}
                  style={{ padding: '4px 10px', fontSize: '12px' }}
                  onClick={() => setShowQr(!showQr)}
                  title="Show QR Code"
                >
                  📱 QR
                </button>
              </div>
            </div>

            {/* QR Code Container if toggled */}
            {showQr && (
              <div
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  padding: '12px',
                  background: 'var(--white)',
                  border: '1px solid var(--gray-200)',
                  borderRadius: '8px',
                  textAlign: 'center',
                }}
              >
                <canvas ref={canvasRef} style={{ borderRadius: '6px' }} />
                <p style={{ margin: '8px 0 0', fontSize: '11px', color: 'var(--gray-500)' }}>
                  Scan with mobile camera on the same LAN to instantly join this session
                </p>
              </div>
            )}

            {/* Connected Participants */}
            <div>
              <div style={{ fontSize: '12px', fontWeight: 600, color: 'var(--gray-600)', marginBottom: '6px' }}>
                Participants ({participantsList.length})
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                {participantsList.map((p, idx) => {
                  const isCurrent = p.deviceId === myDevice.deviceId
                  return (
                    <div
                      key={idx}
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '6px',
                        padding: '4px 10px',
                        background: 'var(--gray-100)',
                        borderRadius: '16px',
                        fontSize: '12px',
                        border: isCurrent ? '1px solid var(--blue)' : '1px solid var(--gray-200)',
                      }}
                    >
                      <span
                        style={{
                          width: '7px',
                          height: '7px',
                          borderRadius: '50%',
                          background: 'var(--green)',
                          display: 'inline-block',
                        }}
                      />
                      <span style={{ fontWeight: 500, color: 'var(--gray-800)' }}>
                        {p.name} {isCurrent && '(You)'}
                      </span>
                      {p.isHost && (
                        <span style={{ fontSize: '10px', padding: '1px 5px', background: '#fef08a', color: '#854d0e', borderRadius: '4px', fontWeight: 700 }}>
                          Host
                        </span>
                      )}
                    </div>
                  )
                })}
              </div>
            </div>

            {/* File Drop & Share Box */}
            <div
              style={{
                border: '2px dashed var(--blue)',
                borderRadius: '8px',
                padding: '16px',
                textAlign: 'center',
                background: 'rgba(59, 130, 246, 0.03)',
                cursor: 'pointer',
              }}
              onClick={() => fileInputRef.current?.click()}
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault()
                if (e.dataTransfer.files) {
                  handleFilesSelected(e.dataTransfer.files)
                }
              }}
            >
              <input
                type="file"
                multiple
                ref={fileInputRef}
                style={{ display: 'none' }}
                onChange={(e) => handleFilesSelected(e.target.files)}
              />
              <div style={{ fontSize: '24px', marginBottom: '4px' }}>📤</div>
              <div style={{ fontSize: '13px', fontWeight: 600, color: 'var(--blue)' }}>
                Click or Drop Files to Share in Session
              </div>
              <div style={{ fontSize: '11px', color: 'var(--gray-500)', marginTop: '2px' }}>
                Shared files will be available to all participants in this session
              </div>
            </div>

            {/* Shared Files List */}
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
                <div style={{ fontSize: '12px', fontWeight: 600, color: 'var(--gray-600)' }}>
                  Shared Files ({filesList.length})
                </div>
                {filesList.length > 1 && (
                  <button
                    type="button"
                    className="btn btn-outline"
                    style={{ fontSize: '11px', padding: '3px 8px' }}
                    onClick={handleDownloadAll}
                    disabled={downloadingAll}
                  >
                    {downloadingAll ? 'Downloading…' : `⬇ Download All (${filesList.length})`}
                  </button>
                )}
              </div>

              {filesList.length === 0 ? (
                <div
                  style={{
                    padding: '18px',
                    textAlign: 'center',
                    background: 'var(--gray-50)',
                    borderRadius: '8px',
                    color: 'var(--gray-400)',
                    fontSize: '12px',
                  }}
                >
                  No files shared in this session yet.
                </div>
              ) : (
                <ul
                  style={{
                    listStyle: 'none',
                    padding: 0,
                    margin: 0,
                    maxHeight: '180px',
                    overflowY: 'auto',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '6px',
                  }}
                >
                  {filesList.map((file, idx) => {
                    const isDownloaded = downloadedMap[file.fileId] || downloadedMap[file.name]
                    const hasBlob = !!(sessionBlobs[file.fileId] || sessionBlobs[file.name])
                    const isImg = /\.(jpg|jpeg|png|gif|webp|svg)$/i.test(file.name)

                    return (
                      <li
                        key={idx}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: '10px',
                          padding: '8px 10px',
                          background: 'var(--gray-50)',
                          border: '1px solid var(--gray-200)',
                          borderRadius: '6px',
                        }}
                      >
                        <span style={{ fontSize: '18px', flexShrink: 0 }}>
                          {fileEmoji(file.name)}
                        </span>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div
                            style={{
                              fontSize: '12px',
                              fontWeight: 600,
                              overflow: 'hidden',
                              textOverflow: 'ellipsis',
                              whiteSpace: 'nowrap',
                              color: 'var(--gray-800)',
                            }}
                            title={file.name}
                          >
                            {file.name}
                          </div>
                          <div style={{ fontSize: '10px', color: 'var(--gray-500)', marginTop: '1px' }}>
                            {formatBytes(file.size)} · By {file.senderName || 'Member'}
                          </div>
                        </div>

                        <div style={{ display: 'flex', gap: '4px', alignItems: 'center' }}>
                          {isImg && hasBlob && (
                            <button
                              type="button"
                              className="btn-ghost"
                              style={{ padding: '3px 6px', fontSize: '12px' }}
                              title="Preview image"
                              onClick={() => {
                                const b = sessionBlobs[file.fileId] || sessionBlobs[file.name]
                                setPreviewFile(previewFile?.name === file.name ? null : { name: file.name, blob: b })
                              }}
                            >
                              👁️
                            </button>
                          )}

                          <button
                            type="button"
                            className={`btn ${isDownloaded ? 'btn-success' : 'btn-primary'}`}
                            style={{
                              fontSize: '11px',
                              padding: '4px 10px',
                              borderRadius: '4px',
                              fontWeight: 600,
                              whiteSpace: 'nowrap',
                            }}
                            onClick={() => handleDownloadFile(file)}
                          >
                            {isDownloaded ? '✓ Saved' : '⬇ Download'}
                          </button>
                        </div>
                      </li>
                    )
                  })}
                </ul>
              )}
            </div>

            {/* Image Preview Overlay if selected */}
            {previewFile && previewFile.blob && (
              <div
                style={{
                  padding: '8px',
                  background: 'var(--white)',
                  border: '1px solid var(--gray-200)',
                  borderRadius: '8px',
                  textAlign: 'center',
                }}
              >
                <img
                  src={URL.createObjectURL(previewFile.blob)}
                  alt={previewFile.name}
                  style={{ maxHeight: '140px', maxWidth: '100%', objectFit: 'contain', borderRadius: '4px' }}
                />
              </div>
            )}

            {/* Session Actions Footer */}
            <div
              style={{
                marginTop: '4px',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                paddingTop: '12px',
                borderTop: '1px solid var(--gray-200)',
              }}
            >
              {isHost ? (
                <button
                  type="button"
                  className="btn btn-outline"
                  style={{ color: 'var(--red)', borderColor: 'var(--red)', fontSize: '12px', padding: '6px 12px' }}
                  onClick={handleDestroy}
                >
                  🗑️ Destroy Session
                </button>
              ) : (
                <button
                  type="button"
                  className="btn btn-outline"
                  style={{ fontSize: '12px', padding: '6px 12px' }}
                  onClick={handleLeave}
                >
                  Leave Session
                </button>
              )}

              <button
                type="button"
                className="btn btn-primary"
                style={{ fontSize: '12px', padding: '6px 16px' }}
                onClick={onClose}
              >
                Minimize Room
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
