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

  // Listen for socket events related to transfer handshake
  useEffect(() => {
    if (!socket) return

    // Another device is requesting to send us files
    socket.on('transfer:request', ({ from, files }) => {
      setIncomingRequest({ from, files })
    })

    // Our send request was accepted — start the transfer
    socket.on('transfer:accepted', ({ by }) => {
      showToast(`${by.name} accepted`, 'success')
      TransferPanel._startTransfer?.()
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
    const { from, files } = incomingRequest
    socket.emit('transfer:accept', { from: from.id })
    setIncomingRequest(null)
    // Add received files to history
    const entries = files.map(f => ({
      name: f.name, size: f.size,
      direction: 'received', peer: from.name, ts: Date.now()
    }))
    setHistory(prev => [...entries, ...prev])
    showToast('Transfer accepted', 'success')
  }

  function rejectIncoming() {
    socket.emit('transfer:reject', { from: incomingRequest.from.id })
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
