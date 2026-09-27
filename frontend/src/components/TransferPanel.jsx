import { useState, useCallback, useRef, useEffect } from 'react'
import { useSocket } from '../context/SocketContext'
import { useToast } from '../context/ToastContext'
import { playChime } from '../utils/audioFeedback'
import { fileEmoji, formatBytes } from '../utils/helpers'
import { downloadFileBlob } from '../services/webrtcService'
import DropZone from './DropZone'
import FileQueue from './FileQueue'
import TransferProgress from './TransferProgress'
import TextSharePanel from './TextSharePanel'

const STATE = {
  IDLE: 'idle',
  WAITING: 'waiting',
  TRANSFERRING: 'transferring',
}

export default function TransferPanel({
  selectedPeer,
  isPaired,
  onPairRequest,
  onDisconnect,
  onSwitchToDevices,
  onFileDone,
  onTransferCompleted,
  onRemoveDevice,
  receiving,
  onOpenQR,
  history = [],
}) {
  const { socket, webrtcManager } = useSocket()
  const { showToast } = useToast()

  // Primary mode: 'send' | 'receive' | 'text'
  const [activeMode, setActiveMode] = useState('send')
  const [state, setState] = useState(STATE.IDLE)
  const [queuedFiles, setQueuedFiles] = useState([])
  const [progressItems, setProgressItems] = useState([])
  const [downloadedMap, setDownloadedMap] = useState({})
  const [downloadingAll, setDownloadingAll] = useState(false)

  const transferIdRef = useRef(null)
  const filesRef = useRef([])

  // Keep filesRef in sync with queuedFiles
  useEffect(() => {
    filesRef.current = queuedFiles
  }, [queuedFiles])

  // Automatically switch or badge receive mode if an incoming transfer starts
  useEffect(() => {
    if (receiving && !receiving.isFinished) {
      setActiveMode('receive')
    }
  }, [receiving])

  // Setup WebRTC callbacks using pub/sub listeners
  useEffect(() => {
    if (!webrtcManager) return

    const unsubProgress = webrtcManager.on(
      'progress',
      ({ fileIndex, fileName, transferredBytes, totalBytes, speed, percent, isSender }) => {
        if (!isSender) return // Sender UI progress
        setProgressItems((prev) => {
          const next = [...prev]
          if (!next[fileIndex]) {
            next[fileIndex] = { name: fileName, size: totalBytes, pct: 0 }
          }
          next[fileIndex] = {
            ...next[fileIndex],
            name: fileName,
            size: totalBytes,
            transferred: transferredBytes,
            pct: percent,
            speed,
            done: percent >= 100,
          }
          return next
        })
      }
    )

    const unsubFileComplete = webrtcManager.on('fileComplete', ({ fileName, size, isSender }) => {
      if (isSender) {
        onFileDone?.({ name: fileName, size, direction: 'sent', peer: selectedPeer?.name })
        showToast(`Sent: ${fileName}`, 'success')
      }
    })

    const unsubAllComplete = webrtcManager.on('allComplete', ({ isSender }) => {
      if (isSender) {
        playChime('success')
        showToast('All files sent successfully!', 'success')
        onTransferCompleted?.()
        setTimeout(() => {
          setState(STATE.IDLE)
          setQueuedFiles([])
          setProgressItems([])
        }, 1500)
      }
    })

    const unsubError = (err) => {
      console.error('[WebRTC Transfer Error]:', err)
      playChime('error')
      showToast('Transfer failed over WebRTC', 'error')
      setState(STATE.IDLE)
    }

    const unsubErr = webrtcManager.on('error', unsubError)

    return () => {
      unsubProgress()
      unsubFileComplete()
      unsubAllComplete()
      unsubErr()
    }
  }, [webrtcManager, selectedPeer, onFileDone, onTransferCompleted, showToast])

  // Add files, avoiding duplicates
  function addFiles(incoming) {
    setQueuedFiles((prev) => {
      const unique = incoming.filter(
        (f) => !prev.find((p) => p.name === f.name && p.size === f.size && p.relativePath === f.relativePath)
      )
      return [...prev, ...unique]
    })
  }

  function removeFile(index) {
    setQueuedFiles((prev) => prev.filter((_, i) => i !== index))
  }

  function clearFiles() {
    setQueuedFiles([])
    setProgressItems([])
  }

  // Send transfer request via socket signaling
  function sendRequest() {
    if (!selectedPeer || queuedFiles.length === 0) return
    if (!isPaired) {
      showToast(`You must pair with ${selectedPeer.name} before sending files.`, 'error')
      return
    }

    const fileMeta = queuedFiles.map((f) => ({
      name: f.name,
      relativePath: f.relativePath || '',
      size: f.size,
      type: f.type,
    }))

    socket.emit('transfer:request', {
      targetSocketId: selectedPeer.id || selectedPeer.socketId,
      targetDeviceId: selectedPeer.deviceId,
      files: fileMeta,
    })

    playChime('send')
    setState(STATE.WAITING)
    showToast(`Waiting for ${selectedPeer.name} to accept…`, 'info')

    // Timeout fallback after 20s
    setTimeout(() => {
      setState((prev) => (prev === STATE.WAITING ? STATE.IDLE : prev))
    }, 20000)
  }

  // Called by App.jsx when receiver accepts the transfer request
  const startTransfer = useCallback(
    (transferId, receiverSocketId) => {
      transferIdRef.current = transferId
      setState(STATE.TRANSFERRING)

      const files = filesRef.current
      const initialProgress = files.map((f) => ({
        name: f.name,
        size: f.size,
        transferred: 0,
        pct: 0,
        speed: 'Connecting P2P...',
        done: false,
      }))
      setProgressItems(initialProgress)

      const targetId = receiverSocketId || selectedPeer?.id || selectedPeer?.socketId
      if (webrtcManager && targetId) {
        webrtcManager.initiateTransfer(targetId, transferId, files)
      } else {
        console.error('Missing target socket ID or WebRTCManager')
      }
    },
    [webrtcManager, selectedPeer]
  )

  TransferPanel._startTransfer = startTransfer

  // Download a single received file
  const handleDownloadSingle = (file) => {
    if (!file?.blob) return
    downloadFileBlob(file.blob, file.name)
    setDownloadedMap((prev) => ({ ...prev, [file.name]: true }))
  }

  // Download all received files sequentially
  const handleDownloadAll = async (filesList) => {
    if (!filesList?.length) return
    setDownloadingAll(true)

    for (let i = 0; i < filesList.length; i++) {
      const file = filesList[i]
      if (file.blob) {
        downloadFileBlob(file.blob, file.name)
        setDownloadedMap((prev) => ({ ...prev, [file.name]: true }))
        await new Promise((r) => setTimeout(r, 220))
      }
    }
    setDownloadingAll(false)
  }

  // Filter history for received items from this peer
  const receivedFromPeer = history.filter(
    (h) => h.direction === 'received' && (h.peer === selectedPeer?.name || h.peer === selectedPeer?.deviceId)
  )

  if (!selectedPeer) {
    return (
      <div className="panel panel-center">
        <div className="placeholder" style={{ padding: '30px 20px', maxWidth: '440px', margin: '0 auto' }}>
          <div style={{ fontSize: '42px', marginBottom: '4px' }}>⚡</div>
          <h3 style={{ margin: 0, fontSize: '18px', color: 'var(--gray-800)' }}>LocalDrop Transfer Center</h3>
          <p style={{ margin: '4px 0 16px', fontSize: '13px', color: 'var(--gray-500)' }}>
            Choose an action to send or receive files and folders seamlessly over your local network:
          </p>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', width: '100%', marginBottom: '16px' }}>
            <div
              style={{
                background: 'var(--white)',
                border: '1.5px solid var(--blue)',
                borderRadius: '10px',
                padding: '16px 12px',
                textAlign: 'center',
                boxShadow: 'var(--shadow-sm)',
              }}
            >
              <div style={{ fontSize: '24px', marginBottom: '6px' }}>📤</div>
              <div style={{ fontWeight: 700, fontSize: '13px', color: 'var(--blue)' }}>Send Files & Folder</div>
              <div style={{ fontSize: '11px', color: 'var(--gray-500)', marginTop: '4px' }}>
                Select a nearby device from the left panel to begin sending
              </div>
            </div>

            <div
              style={{
                background: 'var(--white)',
                border: '1.5px solid #059669',
                borderRadius: '10px',
                padding: '16px 12px',
                textAlign: 'center',
                boxShadow: 'var(--shadow-sm)',
              }}
            >
              <div style={{ fontSize: '24px', marginBottom: '6px' }}>📥</div>
              <div style={{ fontWeight: 700, fontSize: '13px', color: '#059669' }}>Receive Files & Folder</div>
              <div style={{ fontSize: '11px', color: 'var(--gray-500)', marginTop: '4px' }}>
                Your device is discoverable and ready to receive transfers
              </div>
            </div>
          </div>

          <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', justifyContent: 'center' }}>
            {onSwitchToDevices && (
              <button
                type="button"
                className="btn btn-primary"
                onClick={onSwitchToDevices}
                style={{ fontSize: '13px' }}
              >
                Choose Nearby Device
              </button>
            )}
            {onOpenQR && (
              <button
                type="button"
                className="btn btn-outline"
                onClick={onOpenQR}
                style={{ fontSize: '13px' }}
              >
                📱 Show QR Code
              </button>
            )}
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="panel panel-center">
      <div className="transfer-body">
        {/* Target peer bar */}
        <div className="target-bar">
          <div className="avatar">{selectedPeer.name[0]?.toUpperCase() || 'P'}</div>
          <div style={{ minWidth: 0, flex: 1 }}>
            <div className="target-name" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {selectedPeer.name}
            </div>
            <div className="target-status">
              {state === STATE.WAITING && 'Waiting for peer to accept…'}
              {state === STATE.TRANSFERRING && 'P2P WebRTC Transferring…'}
              {state === STATE.IDLE && (isPaired ? '● Connected · Direct P2P Active' : '🔒 Not Paired · Pairing Required')}
            </div>
          </div>
          <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
            <button className="btn btn-outline target-disconnect-btn" onClick={onDisconnect}>
              Change
            </button>
            {onRemoveDevice && (
              <button
                type="button"
                className="btn btn-outline"
                style={{
                  color: '#dc2626',
                  borderColor: '#fca5a5',
                  padding: '6px 12px',
                  fontSize: '12px',
                }}
                title="Remove this device"
                onClick={() => onRemoveDevice(selectedPeer)}
              >
                ✕ Remove
              </button>
            )}
          </div>
        </div>

        {!isPaired ? (
          <div
            style={{
              padding: '36px 20px',
              textAlign: 'center',
              background: 'var(--white)',
              borderRadius: '10px',
              margin: '24px 16px',
              border: '1px dashed var(--gray-300)',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: '12px',
            }}
          >
            <div style={{ fontSize: '40px', lineHeight: 1 }}>🔐</div>
            <h3 style={{ margin: 0, fontSize: '17px', color: 'var(--gray-900)' }}>
              Pairing Required to Transfer
            </h3>
            <p style={{ fontSize: '13px', color: 'var(--gray-500)', margin: 0, maxWidth: '340px', lineHeight: 1.5 }}>
              Pair with <strong>{selectedPeer.name}</strong> to enable sending and receiving files, folders, and notes over direct WebRTC.
            </p>
            <button
              type="button"
              className="btn btn-primary"
              style={{
                fontSize: '14px',
                padding: '10px 22px',
                fontWeight: 600,
                marginTop: '6px',
                display: 'inline-flex',
                alignItems: 'center',
                gap: '6px',
              }}
              onClick={() => onPairRequest && onPairRequest(selectedPeer)}
            >
              <span>🤝</span>
              <span>Pair with {selectedPeer.name}</span>
            </button>
          </div>
        ) : (
          <>
            {/* Primary Mode Tabs: 📤 Send | 📥 Receive | 📋 Text */}
            <div
              style={{
                display: 'flex',
                borderBottom: '1px solid var(--gray-200)',
                background: 'var(--white)',
                padding: '0 16px',
                gap: '4px',
              }}
            >
              <button
                type="button"
                style={{
                  padding: '12px 16px',
                  border: 'none',
                  borderBottom: activeMode === 'send' ? '2px solid var(--blue)' : '2px solid transparent',
                  background: 'none',
                  color: activeMode === 'send' ? 'var(--blue)' : 'var(--gray-500)',
                  fontWeight: 600,
                  cursor: 'pointer',
                  fontSize: '13px',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px',
                }}
                onClick={() => setActiveMode('send')}
              >
                <span>📤</span>
                <span>Send</span>
              </button>

              <button
                type="button"
                style={{
                  padding: '12px 16px',
                  border: 'none',
                  borderBottom: activeMode === 'receive' ? '2px solid #059669' : '2px solid transparent',
                  background: 'none',
                  color: activeMode === 'receive' ? '#059669' : 'var(--gray-500)',
                  fontWeight: 600,
                  cursor: 'pointer',
                  fontSize: '13px',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px',
                }}
                onClick={() => setActiveMode('receive')}
              >
                <span>📥</span>
                <span>Receive</span>
                {receiving && !receiving.isFinished && (
                  <span
                    style={{
                      background: '#10b981',
                      color: '#ffffff',
                      fontSize: '10px',
                      padding: '1px 6px',
                      borderRadius: '10px',
                      fontWeight: 700,
                      animation: 'pulse 1.2s infinite',
                    }}
                  >
                    Active
                  </span>
                )}
                {receiving?.receivedFiles?.length > 0 && receiving.isFinished && (
                  <span
                    style={{
                      background: '#059669',
                      color: '#ffffff',
                      fontSize: '10px',
                      padding: '1px 6px',
                      borderRadius: '10px',
                    }}
                  >
                    {receiving.receivedFiles.length}
                  </span>
                )}
              </button>

              <button
                type="button"
                style={{
                  padding: '12px 16px',
                  border: 'none',
                  borderBottom: activeMode === 'text' ? '2px solid var(--blue)' : '2px solid transparent',
                  background: 'none',
                  color: activeMode === 'text' ? 'var(--blue)' : 'var(--gray-500)',
                  fontWeight: 600,
                  cursor: 'pointer',
                  fontSize: '13px',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px',
                }}
                onClick={() => setActiveMode('text')}
              >
                <span>📋</span>
                <span>Text</span>
              </button>
            </div>

            <div className="transfer-content">
              {/* ────────────────────────────────────────────────────────────
                  1. SEND MODE
                  ──────────────────────────────────────────────────────────── */}
              {activeMode === 'send' && (
                <>
                  {state === STATE.IDLE && (
                    <>
                      <DropZone onFiles={addFiles} />
                      <FileQueue
                        files={queuedFiles}
                        onRemove={removeFile}
                        onClear={clearFiles}
                        onSend={sendRequest}
                      />
                    </>
                  )}

                  {state === STATE.WAITING && (
                    <div className="waiting" style={{ padding: '36px 16px', textAlign: 'center' }}>
                      <div className="waiting-spinner" style={{ margin: '0 auto 12px' }} />
                      <h4 style={{ margin: '0 0 6px', fontSize: '15px' }}>Waiting for Acceptance</h4>
                      <p style={{ margin: '0 0 16px', fontSize: '13px', color: 'var(--gray-500)' }}>
                        Waiting for <strong>{selectedPeer.name}</strong> to accept your transfer request…
                      </p>
                      <button
                        type="button"
                        className="btn btn-outline"
                        style={{ fontSize: '12px' }}
                        onClick={() => setState(STATE.IDLE)}
                      >
                        Cancel Request
                      </button>
                    </div>
                  )}

                  {state === STATE.TRANSFERRING && (
                    <TransferProgress
                      progressItems={progressItems}
                      title={`Sending to ${selectedPeer.name} via WebRTC`}
                    />
                  )}
                </>
              )}

              {/* ────────────────────────────────────────────────────────────
                  2. RECEIVE MODE
                  ──────────────────────────────────────────────────────────── */}
              {activeMode === 'receive' && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
                  {/* Receiver Status Banner */}
                  <div
                    style={{
                      background: 'var(--white)',
                      border: '1px solid #a7f3d0',
                      borderRadius: '10px',
                      padding: '16px',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '14px',
                      boxShadow: 'var(--shadow-sm)',
                    }}
                  >
                    <div
                      style={{
                        width: '44px',
                        height: '44px',
                        borderRadius: '50%',
                        background: '#ecfdf5',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        fontSize: '22px',
                        flexShrink: 0,
                      }}
                    >
                      📡
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                        <span style={{ fontWeight: 700, fontSize: '14px', color: '#065f46' }}>
                          Ready to Receive Files & Folders
                        </span>
                        <span
                          style={{
                            background: '#10b981',
                            color: '#fff',
                            fontSize: '9px',
                            fontWeight: 700,
                            padding: '1px 6px',
                            borderRadius: '10px',
                            textTransform: 'uppercase',
                          }}
                        >
                          Listening
                        </span>
                      </div>
                      <div style={{ fontSize: '12px', color: '#047857', marginTop: '2px' }}>
                        Connected with <strong>{selectedPeer.name}</strong> via end-to-end encrypted WebRTC.
                      </div>
                    </div>
                  </div>

                  {/* Active In-flight receiving progress */}
                  {receiving && !receiving.isFinished && (
                    <div
                      style={{
                        background: 'var(--white)',
                        border: '1px solid var(--blue)',
                        borderRadius: '10px',
                        padding: '16px',
                      }}
                    >
                      <h4 style={{ margin: '0 0 10px', fontSize: '14px', color: 'var(--blue)', display: 'flex', alignItems: 'center', gap: '6px' }}>
                        <span>⚡</span>
                        <span>Receiving from {selectedPeer.name}</span>
                      </h4>
                      <TransferProgress
                        progressItems={receiving.progressItems || []}
                        title="Streaming Over Direct DataChannel"
                      />
                    </div>
                  )}

                  {/* Received Files & Folders list (Current transfer) */}
                  {receiving?.receivedFiles && receiving.receivedFiles.length > 0 && (
                    <div
                      style={{
                        background: 'var(--white)',
                        border: '1px solid var(--gray-200)',
                        borderRadius: '10px',
                        padding: '16px',
                      }}
                    >
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
                        <div>
                          <h4 style={{ margin: 0, fontSize: '14px', color: 'var(--gray-900)' }}>
                            Received Items ({receiving.receivedFiles.length})
                          </h4>
                          <span style={{ fontSize: '11px', color: 'var(--gray-500)' }}>
                            From {receiving.fromName || selectedPeer.name}
                          </span>
                        </div>
                        {receiving.receivedFiles.length > 1 && (
                          <button
                            type="button"
                            className="btn btn-primary"
                            style={{ fontSize: '11px', padding: '5px 12px' }}
                            disabled={downloadingAll}
                            onClick={() => handleDownloadAll(receiving.receivedFiles)}
                          >
                            {downloadingAll ? 'Downloading…' : '⬇ Download All'}
                          </button>
                        )}
                      </div>

                      <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: '8px' }}>
                        {receiving.receivedFiles.map((file, idx) => {
                          const isFolderItem = Boolean(file.relativePath && file.relativePath.includes('/'))
                          const isDownloaded = downloadedMap[file.name]

                          return (
                            <li
                              key={idx}
                              style={{
                                display: 'flex',
                                alignItems: 'center',
                                gap: '10px',
                                padding: '8px 10px',
                                background: 'var(--gray-50)',
                                borderRadius: '8px',
                                border: '1px solid var(--gray-200)',
                              }}
                            >
                              <div style={{ fontSize: '20px', lineHeight: 1 }}>
                                {isFolderItem ? '📂' : fileEmoji(file.name)}
                              </div>
                              <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
                                <span
                                  style={{
                                    fontSize: '13px',
                                    fontWeight: 600,
                                    overflow: 'hidden',
                                    textOverflow: 'ellipsis',
                                    whiteSpace: 'nowrap',
                                  }}
                                  title={file.name}
                                >
                                  {file.name}
                                </span>
                                {isFolderItem && (
                                  <span style={{ fontSize: '10px', color: '#059669' }}>
                                    Folder: {file.relativePath.substring(0, file.relativePath.lastIndexOf('/'))}
                                  </span>
                                )}
                                <span style={{ fontSize: '11px', color: 'var(--gray-500)' }}>
                                  {formatBytes(file.size)}
                                </span>
                              </div>
                              <button
                                type="button"
                                className="btn btn-outline"
                                style={{
                                  fontSize: '11px',
                                  padding: '4px 10px',
                                  borderRadius: '6px',
                                  color: isDownloaded ? 'var(--gray-500)' : 'var(--blue)',
                                  borderColor: isDownloaded ? 'var(--gray-300)' : 'var(--blue)',
                                }}
                                onClick={() => handleDownloadSingle(file)}
                              >
                                {isDownloaded ? '✓ Saved' : '⬇ Download'}
                              </button>
                            </li>
                          )
                        })}
                      </ul>
                    </div>
                  )}

                  {/* Empty state when no transfers have arrived yet */}
                  {(!receiving || (!receiving.receivedFiles?.length && receiving.isFinished)) && (
                    <div
                      style={{
                        padding: '30px 16px',
                        textAlign: 'center',
                        background: 'var(--white)',
                        borderRadius: '10px',
                        border: '1px dashed var(--gray-300)',
                      }}
                    >
                      <div style={{ fontSize: '32px', marginBottom: '8px' }}>📥</div>
                      <div style={{ fontSize: '14px', fontWeight: 600, color: 'var(--gray-800)', marginBottom: '4px' }}>
                        Waiting for Incoming Files or Folders
                      </div>
                      <p style={{ fontSize: '12px', color: 'var(--gray-500)', margin: '0 auto 14px', maxWidth: '300px', lineHeight: 1.4 }}>
                        When <strong>{selectedPeer.name}</strong> sends files or folders, they will immediately stream and appear here for download.
                      </p>
                      {onOpenQR && (
                        <button
                          type="button"
                          className="btn btn-outline"
                          style={{ fontSize: '12px' }}
                          onClick={onOpenQR}
                        >
                          📱 Show QR Code for Phone Transfer
                        </button>
                      )}
                    </div>
                  )}
                </div>
              )}

              {/* ────────────────────────────────────────────────────────────
                  3. TEXT & CLIPBOARD MODE
                  ──────────────────────────────────────────────────────────── */}
              {activeMode === 'text' && (
                <TextSharePanel
                  selectedPeer={selectedPeer}
                  onTextSent={onFileDone}
                />
              )}
            </div>
          </>
        )}
      </div>
    </div>
  )
}
