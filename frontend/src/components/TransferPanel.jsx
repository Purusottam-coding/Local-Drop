import { useState, useCallback, useRef } from 'react'
import { useSocket } from '../context/SocketContext'
import { useToast } from '../context/ToastContext'
import DropZone from './DropZone'
import FileQueue from './FileQueue'
import TransferProgress from './TransferProgress'

const STATE = {
  IDLE:         'idle',         // showing drop zone
  WAITING:      'waiting',      // request sent, waiting for acceptance
  TRANSFERRING: 'transferring', // files are being transferred
}

export default function TransferPanel({ selectedPeer, onDisconnect, onFileDone }) {
  const { socket } = useSocket()
  const { showToast } = useToast()

  const [state,       setState]       = useState(STATE.IDLE)
  const [queuedFiles, setQueuedFiles] = useState([])
  const [activeFiles, setActiveFiles] = useState([])

  // Keep track of the current transferId so we can emit transfer:complete later
  const transferIdRef = useRef(null)

  // Add files, skip duplicates
  function addFiles(incoming) {
    setQueuedFiles(prev => {
      const unique = incoming.filter(
        f => !prev.find(p => p.name === f.name && p.size === f.size)
      )
      return [...prev, ...unique]
    })
  }

  function removeFile(index) {
    setQueuedFiles(prev => prev.filter((_, i) => i !== index))
  }

  function clearFiles() {
    setQueuedFiles([])
  }

  // Send a transfer request to the selected peer
  function sendRequest() {
    if (!selectedPeer || queuedFiles.length === 0) return

    const fileMeta = queuedFiles.map(f => ({ name: f.name, size: f.size, type: f.type }))
    socket.emit('transfer:request', { to: selectedPeer.id, files: fileMeta })
    setState(STATE.WAITING)
    showToast(`Waiting for ${selectedPeer.name} to accept…`, 'info')

    // Auto-cancel waiting after 15 seconds if no response
    setTimeout(() => {
      setState(prev => prev === STATE.WAITING ? STATE.IDLE : prev)
    }, 15000)
  }

  // Called by App.jsx when peer accepted — receives the transferId from server
  const startTransfer = useCallback((transferId) => {
    transferIdRef.current = transferId
    setActiveFiles(queuedFiles.map(f => ({ name: f.name, size: f.size })))
    setQueuedFiles([])
    setState(STATE.TRANSFERRING)
  }, [queuedFiles])

  // Expose so App.jsx can call it after receiving transfer:accepted
  TransferPanel._startTransfer = startTransfer

  // Called when a single file finishes (by TransferProgress)
  function handleFileDone(fileInfo) {
    onFileDone?.({ ...fileInfo, direction: 'sent', peer: selectedPeer?.name })
    showToast(`Sent: ${fileInfo.name}`, 'success')
  }

  // Called when ALL files are done (by TransferProgress)
  function handleAllDone() {
    if (transferIdRef.current) {
      // Tell the backend this transfer is complete so it can save the record
      socket.emit('transfer:complete', { transferId: transferIdRef.current })
      transferIdRef.current = null
    }
    setState(STATE.IDLE)
  }

  // No device selected yet — show placeholder
  if (!selectedPeer) {
    return (
      <div className="panel panel-center">
        <div className="placeholder">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
            <path d="M5.45 5.11L2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"/>
            <line x1="6" y1="12" x2="6.01" y2="12"/>
            <line x1="10" y1="12" x2="10.01" y2="12"/>
          </svg>
          <h3>Select a device</h3>
          <p>Pick a device from the left panel, then drag files to send them.</p>
        </div>
      </div>
    )
  }

  return (
    <div className="panel panel-center">
      <div className="transfer-body">

        {/* Target device bar */}
        <div className="target-bar">
          <div className="avatar">{selectedPeer.name[0].toUpperCase()}</div>
          <div>
            <div className="target-name">{selectedPeer.name}</div>
            <div className="target-status">
              {state === STATE.WAITING      && 'Waiting for acceptance…'}
              {state === STATE.TRANSFERRING && 'Sending files…'}
              {state === STATE.IDLE         && 'Ready'}
            </div>
          </div>
          <button className="btn btn-outline" style={{ marginLeft: 'auto' }} onClick={onDisconnect}>
            Disconnect
          </button>
        </div>

        <div className="transfer-content">

          {/* IDLE: drop zone + file queue */}
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

          {/* WAITING: spinner */}
          {state === STATE.WAITING && (
            <div className="waiting">
              <div className="waiting-spinner" />
              <p>Waiting for {selectedPeer.name} to accept the transfer…</p>
              <button className="btn-ghost" onClick={() => setState(STATE.IDLE)}>Cancel</button>
            </div>
          )}

          {/* TRANSFERRING: progress bars */}
          {state === STATE.TRANSFERRING && (
            <TransferProgress
              files={activeFiles}
              onFileDone={handleFileDone}
              onAllDone={handleAllDone}
            />
          )}

        </div>
      </div>
    </div>
  )
}
