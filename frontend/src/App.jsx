import { useState, useEffect } from 'react'
import { useSocket } from './context/SocketContext'
import { useToast } from './context/ToastContext'
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

  // Load transfer history from backend when app starts
  useEffect(() => {
    fetch('/api/transfers')
      .then(res => res.json())
      .then(data => {
        // Convert backend records to the shape HistoryPanel expects
        const entries = data.map(t => ({
          name:      t.files[0]?.name || 'Unknown',   // show first file name
          size:      t.files[0]?.size || 0,
          direction: 'sent',                           // server-side records are sent transfers
          peer:      t.receiver?.name || '–',
          ts:        new Date(t.requestedAt).getTime(),
          status:    t.status,
          fileCount: t.files.length,
        }))
        setHistory(entries)
      })
      .catch(() => {})  // silently ignore if backend is unreachable
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

        <HistoryPanel history={history} onClear={() => setHistory([])} />
      </main>

      <IncomingModal
        request={incomingRequest}
        onAccept={acceptIncoming}
        onReject={rejectIncoming}
      />
    </>
  )
}
