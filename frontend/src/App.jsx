import { useState, useEffect, useCallback } from 'react'
import { useSocket } from './context/SocketContext'
import { useToast } from './context/ToastContext'
import { transferApi } from './services/api'
import Navbar from './components/Navbar'
import DevicePanel from './components/DevicePanel'
import TransferPanel from './components/TransferPanel'
import HistoryPanel from './components/HistoryPanel'
import IncomingModal from './components/IncomingModal'
import TransferProgress from './components/TransferProgress'

export default function App() {
  const { socket, peers, webrtcManager } = useSocket()
  const { showToast } = useToast()

  const [selectedPeer, setSelectedPeer] = useState(null)
  const [incomingRequest, setIncomingRequest] = useState(null)
  const [receiving, setReceiving] = useState(null)
  const [history, setHistory] = useState([])

  // Function to load transfer history from MongoDB
  const loadHistory = useCallback(async () => {
    try {
      const res = await transferApi.getTransfers()
      const records = res.data || []
      const entries = records.map((t) => ({
        name: t.files && t.files[0] ? t.files[0].name : 'File Transfer',
        size: t.files && t.files[0] ? t.files[0].size : 0,
        direction: 'sent',
        peer: t.receiver?.name || t.sender?.name || '–',
        ts: new Date(t.requestedAt || t.createdAt).getTime(),
        status: t.status,
        fileCount: t.files ? t.files.length : 1,
      }))
      setHistory(entries)
    } catch (err) {
      console.warn('Could not load history from API:', err.message)
    }
  }, [])

  useEffect(() => {
    loadHistory()
  }, [loadHistory])

  // Socket event listeners for transfer requests and handshake
  useEffect(() => {
    if (!socket) return

    // Incoming transfer request from another peer
    socket.on('transfer:request', ({ from, files, transferId }) => {
      setIncomingRequest({ from, files, transferId })
    })

    // Our transfer request was accepted by the receiver
    socket.on('transfer:accepted', ({ by, transferId, receiverSocketId }) => {
      showToast(`${by?.name || 'Peer'} accepted the transfer!`, 'success')
      const targetId = receiverSocketId || by?.socketId
      TransferPanel._startTransfer?.(transferId, targetId)
    })

    // Our transfer request was rejected
    socket.on('transfer:rejected', ({ by, reason }) => {
      showToast(`${by?.name || 'Peer'} declined: ${reason || 'Transfer rejected'}`, 'error')
    })

    return () => {
      socket.off('transfer:request')
      socket.off('transfer:accepted')
      socket.off('transfer:rejected')
    }
  }, [socket, showToast])

  // WebRTC receiver-side callbacks
  useEffect(() => {
    if (!webrtcManager) return

    webrtcManager.onProgress = (info) => {
      if (!info.isSender) {
        setReceiving((prev) => {
          if (!prev) return prev
          const next = [...prev.progressItems]
          next[info.fileIndex] = {
            name: info.fileName,
            size: info.totalBytes,
            transferred: info.transferredBytes,
            pct: info.percent,
            speed: info.speed,
            done: info.percent >= 100,
          }
          return { ...prev, progressItems: next }
        })
      }
    }

    webrtcManager.onFileComplete = ({ fileName, isSender }) => {
      if (!isSender) {
        showToast(`Downloaded: ${fileName}`, 'success')
        loadHistory()
      }
    }

    webrtcManager.onAllComplete = ({ isSender }) => {
      if (!isSender) {
        showToast('All files received and saved!', 'success')
        setTimeout(() => setReceiving(null), 1500)
        loadHistory()
      }
    }
  }, [webrtcManager, loadHistory, showToast])

  // If the selected peer disconnects, deselect them
  useEffect(() => {
    if (selectedPeer && !peers.find((p) => p.id === selectedPeer.id || p.deviceId === selectedPeer.deviceId)) {
      showToast(`${selectedPeer.name} disconnected`, 'info')
      setSelectedPeer(null)
    }
  }, [peers, selectedPeer, showToast])

  // Handle accepting incoming transfer
  function acceptIncoming() {
    const { from, files, transferId } = incomingRequest
    const senderSocketId = from.socketId || from.id

    socket.emit('transfer:accept', {
      from: senderSocketId,
      senderSocketId,
      transferId,
    })

    setIncomingRequest(null)

    // Open live receiving progress overlay
    setReceiving({
      fromName: from.name,
      files,
      transferId,
      progressItems: files.map((f) => ({
        name: f.name,
        size: f.size,
        transferred: 0,
        pct: 0,
        speed: 'Connecting P2P...',
        done: false,
      })),
    })

    showToast(`Connecting to ${from.name} over WebRTC…`, 'info')
  }

  // Handle rejecting incoming transfer
  function rejectIncoming() {
    const { from, transferId } = incomingRequest
    socket.emit('transfer:reject', {
      from: from.socketId || from.id,
      senderSocketId: from.socketId || from.id,
      transferId,
      reason: 'Declined by receiver',
    })
    setIncomingRequest(null)
  }

  function addToHistory(entry) {
    setHistory((prev) => [entry, ...prev])
  }

  const handleClearHistory = async () => {
    try {
      await transferApi.clearTransfers()
      setHistory([])
      showToast('Transfer history cleared', 'info')
    } catch {
      setHistory([])
    }
  }

  return (
    <>
      <Navbar />

      <main className="app-layout">
        <DevicePanel selectedPeer={selectedPeer} onSelect={setSelectedPeer} />

        <TransferPanel
          selectedPeer={selectedPeer}
          onDisconnect={() => setSelectedPeer(null)}
          onFileDone={addToHistory}
          onTransferCompleted={loadHistory}
        />

        <HistoryPanel history={history} onClear={handleClearHistory} />
      </main>

      {/* Incoming transfer request modal */}
      <IncomingModal
        request={incomingRequest}
        onAccept={acceptIncoming}
        onReject={rejectIncoming}
      />

      {/* Receiver live WebRTC download progress overlay */}
      {receiving && (
        <div className="modal-overlay">
          <div className="modal" style={{ width: '440px', textAlign: 'left' }}>
            <h3 style={{ marginBottom: '4px' }}>Receiving Files P2P</h3>
            <p style={{ fontSize: '13px', color: 'var(--gray-500)', marginBottom: '16px' }}>
              Direct WebRTC transfer from <strong>{receiving.fromName}</strong>
            </p>
            <TransferProgress
              progressItems={receiving.progressItems}
              title="Downloading Directly to Browser"
            />
          </div>
        </div>
      )}
    </>
  )
}
