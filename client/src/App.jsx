import { useState, useEffect, useRef } from 'react'
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
  const [incomingRequest, setIncomingRequest] = useState(null)   // { from, files }
  const [history,         setHistory]         = useState([])

  const transferPanelRef = useRef(null)

  /* ── Socket events for transfer handshake ─────────────── */
  useEffect(() => {
    if (!socket) return

    /* Incoming request from another peer */
    socket.on('transfer:request', ({ from, files }) => {
      setIncomingRequest({ from, files })
    })

    /* Our outgoing request was accepted */
    socket.on('transfer:accepted', ({ by }) => {
      showToast(`${by.name} accepted the transfer`, 'success')
      // Trigger the transfer panel to start progress
      TransferPanel._startTransfer?.([])
    })

    /* Our outgoing request was rejected */
    socket.on('transfer:rejected', ({ by }) => {
      showToast(`${by.name} declined the transfer`, 'error')
      // Revert waiting state — TransferPanel handles internally via timeout
    })

    return () => {
      socket.off('transfer:request')
      socket.off('transfer:accepted')
      socket.off('transfer:rejected')
    }
  }, [socket])

  /* Deselect peer if they disconnect */
  useEffect(() => {
    if (selectedPeer && !peers.find(p => p.id === selectedPeer.id)) {
      showToast(`${selectedPeer.name} left the network`, 'info')
      setSelectedPeer(null)
    }
  }, [peers, selectedPeer])

  /* ── Incoming modal handlers ─────────────────────────── */
  const handleAccept = () => {
    const { from, files } = incomingRequest
    socket.emit('transfer:accept', { from: from.id })
    setIncomingRequest(null)
    showToast('Transfer accepted', 'success')
    // Simulate receiving the files
    addHistory(files, 'received', from.name)
  }

  const handleReject = () => {
    socket.emit('transfer:reject', { from: incomingRequest.from.id })
    setIncomingRequest(null)
    showToast('Transfer declined', 'info')
  }

  /* ── History ─────────────────────────────────────────── */
  const addHistory = (files, direction, peerName) => {
    const entries = files.map(f => ({
      name: f.name, size: f.size, direction,
      peer: peerName, ts: Date.now(),
    }))
    setHistory(prev => [...entries, ...prev])
  }

  const handleTransferDone = (entry) => {
    setHistory(prev => [entry, ...prev])
  }

  return (
    <>
      <Navbar />
      <main className="app-layout">
        <DevicePanel
          selectedPeer={selectedPeer}
          onSelectPeer={peer => { setSelectedPeer(peer) }}
        />
        <TransferPanel
          selectedPeer={selectedPeer}
          onDisconnect={() => setSelectedPeer(null)}
          onTransferDone={handleTransferDone}
        />
        <HistoryPanel
          history={history}
          onClear={() => setHistory([])}
        />
      </main>

      <IncomingModal
        request={incomingRequest}
        onAccept={handleAccept}
        onReject={handleReject}
      />
    </>
  )
}
