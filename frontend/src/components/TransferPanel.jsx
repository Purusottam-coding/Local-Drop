import { useState, useCallback, useRef, useEffect } from 'react'
import { useSocket } from '../context/SocketContext'
import { useToast } from '../context/ToastContext'
import DropZone from './DropZone'
import FileQueue from './FileQueue'
import TransferProgress from './TransferProgress'

const STATE = {
  IDLE: 'idle',
  WAITING: 'waiting',
  TRANSFERRING: 'transferring',
}

export default function TransferPanel({ selectedPeer, onDisconnect, onFileDone, onTransferCompleted }) {
  const { socket, webrtcManager } = useSocket()
  const { showToast } = useToast()

  const [state, setState] = useState(STATE.IDLE)
  const [queuedFiles, setQueuedFiles] = useState([])
  const [progressItems, setProgressItems] = useState([])

  const transferIdRef = useRef(null)
  const filesRef = useRef([])

  // Keep filesRef in sync with queuedFiles
  useEffect(() => {
    filesRef.current = queuedFiles
  }, [queuedFiles])

  // Setup WebRTC callbacks
  useEffect(() => {
    if (!webrtcManager) return

    webrtcManager.onProgress = ({ fileIndex, fileName, transferredBytes, totalBytes, speed, percent, isSender }) => {
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

    webrtcManager.onFileComplete = ({ fileName, size, isSender }) => {
      if (isSender) {
        onFileDone?.({ name: fileName, size, direction: 'sent', peer: selectedPeer?.name })
        showToast(`Sent: ${fileName}`, 'success')
      }
    }

    webrtcManager.onAllComplete = ({ isSender }) => {
      if (isSender) {
        showToast('All files sent successfully!', 'success')
        onTransferCompleted?.()
        setTimeout(() => {
          setState(STATE.IDLE)
          setQueuedFiles([])
          setProgressItems([])
        }, 1500)
      }
    }

    webrtcManager.onError = (err) => {
      console.error('[WebRTC Transfer Error]:', err)
      showToast('Transfer failed over WebRTC', 'error')
      setState(STATE.IDLE)
    }
  }, [webrtcManager, selectedPeer, onFileDone, onTransferCompleted, showToast])

  // Add files, avoiding duplicates
  function addFiles(incoming) {
    setQueuedFiles((prev) => {
      const unique = incoming.filter(
        (f) => !prev.find((p) => p.name === f.name && p.size === f.size)
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

    const fileMeta = queuedFiles.map((f) => ({
      name: f.name,
      size: f.size,
      type: f.type,
    }))

    socket.emit('transfer:request', {
      targetSocketId: selectedPeer.id || selectedPeer.socketId,
      targetDeviceId: selectedPeer.deviceId,
      files: fileMeta,
    })

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
      // Initialize progress items
      const initialProgress = files.map((f) => ({
        name: f.name,
        size: f.size,
        transferred: 0,
        pct: 0,
        speed: 'Connecting P2P...',
        done: false,
      }))
      setProgressItems(initialProgress)

      // Initiate real WebRTC DataChannel transfer
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

  if (!selectedPeer) {
    return (
      <div className="panel panel-center">
        <div className="placeholder">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
            <path d="M5.45 5.11L2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z" />
            <line x1="6" y1="12" x2="6.01" y2="12" />
            <line x1="10" y1="12" x2="10.01" y2="12" />
          </svg>
          <h3>Select a device</h3>
          <p>Pick a device from the left panel, then drag & drop files to send directly over WebRTC.</p>
        </div>
      </div>
    )
  }

  return (
    <div className="panel panel-center">
      <div className="transfer-body">
        {/* Target bar */}
        <div className="target-bar">
          <div className="avatar">{selectedPeer.name[0]?.toUpperCase() || 'P'}</div>
          <div>
            <div className="target-name">{selectedPeer.name}</div>
            <div className="target-status">
              {state === STATE.WAITING && 'Waiting for acceptance…'}
              {state === STATE.TRANSFERRING && 'P2P WebRTC Transferring…'}
              {state === STATE.IDLE && 'Ready to send'}
            </div>
          </div>
          <button className="btn btn-outline" style={{ marginLeft: 'auto' }} onClick={onDisconnect}>
            Disconnect
          </button>
        </div>

        <div className="transfer-content">
          {/* IDLE: drop zone and file queue */}
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

          {/* WAITING: acceptance spinner */}
          {state === STATE.WAITING && (
            <div className="waiting">
              <div className="waiting-spinner" />
              <p>Waiting for {selectedPeer.name} to accept the transfer…</p>
              <button className="btn-ghost" onClick={() => setState(STATE.IDLE)}>
                Cancel
              </button>
            </div>
          )}

          {/* TRANSFERRING: real WebRTC progress */}
          {state === STATE.TRANSFERRING && (
            <TransferProgress
              progressItems={progressItems}
              title="Sending Files via WebRTC"
            />
          )}
        </div>
      </div>
    </div>
  )
}
