import { useState, useEffect } from 'react'
import { useSocket } from './context/SocketContext'
import { useToast } from './context/ToastContext'
import { transferApi } from './services/api'
import Navbar from './components/Navbar'
import DevicePanel from './components/DevicePanel'
import TransferPanel from './components/TransferPanel'
import HistoryPanel from './components/HistoryPanel'
import IncomingModal from './components/IncomingModal'

export default function App() {
  const { socket, peers } = useSocket()
  const { showToast } = useToast()

  const [selectedPeer,    setSelectedPeer]    = useState(null)
  const [incomingRequest, setIncomingRequest] = useState(null)
  const [history,         setHistory]         = useState([])

  // Load transfer history from MongoDB via transferApi service
  useEffect(() => {
    transferApi
      .getTransfers()
      .then((res) => {
        const records = res.data || []
        const entries = records.map((t) => ({
          name:      t.files[0]?.name || 'Unknown',
          size:      t.files[0]?.size || 0,
          direction: 'sent',
          peer:      t.receiver?.name || '–',
          ts:        new Date(t.requestedAt || t.createdAt).getTime(),
          status:    t.status,
          fileCount: t.files ? t.files.length : 1,
        }))
        setHistory(entries)
      })
      .catch((err) => {
        console.warn('Could not load history from API:', err.message)
      })
  }, [])

  // Listen for socket events related to transfer handshake
  useEffect(() => {
    if (!socket) return

    // Another device is requesting to send us files — store transferId too
    socket.on('transfer:request', ({ from, files, transferId }) => {
      setIncomingRequest({ from, files, transferId })
    })

    // Our send request was accepted — start the transfer with the transferId
    socket.on('transfer:accepted', ({ by, transferId }) => {
      showToast(`${by.name} accepted`, 'success')
      TransferPanel._startTransfer?.(transferId)
    })

    // Our send request was declined
    socket.on('transfer:rejected', ({ by }) => {
      showToast(`${by.name} declined`, 'error')
    })

    return () => {
      socket.off('transfer:request')
      socket.off('transfer:accepted')
      socket.off('transfer:rejected')
    }
  }, [socket])

  // If the selected peer disconnects, deselect them
  useEffect(() => {
    if (selectedPeer && !peers.find(p => p.id === selectedPeer.id)) {
      showToast(`${selectedPeer.name} disconnected`, 'info')
      setSelectedPeer(null)
    }
  }, [peers])

  function acceptIncoming() {
    const { from, files, transferId } = incomingRequest
    // Pass transferId so backend can update the record to "accepted"
    socket.emit('transfer:accept', { from: from.id, transferId })
    setIncomingRequest(null)
    const entries = files.map(f => ({
      name: f.name, size: f.size,
      direction: 'received', peer: from.name, ts: Date.now()
    }))
    setHistory(prev => [...entries, ...prev])
    showToast('Transfer accepted', 'success')
  }

  function rejectIncoming() {
    const { from, transferId } = incomingRequest
    // Pass transferId so backend can save the record as "rejected"
    socket.emit('transfer:reject', { from: from.id, transferId })
    setIncomingRequest(null)
  }

  function addToHistory(entry) {
    setHistory(prev => [entry, ...prev])
  }

  const handleClearHistory = async () => {
    try {
      await transferApi.clearTransfers()
      setHistory([])
      showToast('History cleared from database', 'info')
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
        />

        <HistoryPanel history={history} onClear={handleClearHistory} />
      </main>

      <IncomingModal
        request={incomingRequest}
        onAccept={acceptIncoming}
        onReject={rejectIncoming}
      />
    </>
  )
}
