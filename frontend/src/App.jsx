import { useState, useEffect, useCallback } from 'react'
import { useSocket } from './context/SocketContext'
import { useToast } from './context/ToastContext'
import { transferApi, deviceApi } from './services/api'
import Navbar from './components/Navbar'
import DevicePanel from './components/DevicePanel'
import TransferPanel from './components/TransferPanel'
import HistoryPanel from './components/HistoryPanel'
import IncomingModal from './components/IncomingModal'
import IncomingTextModal from './components/IncomingTextModal'
import PairingModal from './components/PairingModal'
import TransferProgress from './components/TransferProgress'

export default function App() {
  const { socket, peers, myDevice, webrtcManager } = useSocket()
  const { showToast } = useToast()

  const [selectedPeer, setSelectedPeer] = useState(null)
  const [incomingRequest, setIncomingRequest] = useState(null)
  const [incomingText, setIncomingText] = useState(null)
  const [receiving, setReceiving] = useState(null)
  const [history, setHistory] = useState([])

  // Pairing states
  const [trustedDeviceIds, setTrustedDeviceIds] = useState([])
  const [incomingPairing, setIncomingPairing] = useState(null)
  const [pendingPairing, setPendingPairing] = useState(null)

  // Load transfer history from MongoDB
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

  // Load trusted devices from MongoDB
  const loadTrusted = useCallback(async () => {
    if (!myDevice?.deviceId) return
    try {
      const res = await deviceApi.getTrustedDevices(myDevice.deviceId)
      const list = res.data || []
      setTrustedDeviceIds(list.map((d) => d.deviceId))
    } catch (err) {
      console.warn('Could not load trusted devices:', err.message)
    }
  }, [myDevice?.deviceId])

  useEffect(() => {
    loadHistory()
    loadTrusted()
  }, [loadHistory, loadTrusted])

  // Accept transfer helper
  const acceptTransfer = useCallback(
    ({ from, files, transferId }) => {
      const senderSocketId = from.socketId || from.id

      socket.emit('transfer:accept', {
        from: senderSocketId,
        senderSocketId,
        transferId,
      })

      setIncomingRequest(null)

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
    },
    [socket, showToast]
  )

  // Socket event listeners for transfer requests and pairing
  useEffect(() => {
    if (!socket) return

    // Incoming transfer request from another peer
    socket.on('transfer:request', ({ from, files, transferId }) => {
      if (trustedDeviceIds.includes(from.deviceId)) {
        showToast(`Auto-accepting transfer from trusted device: ${from.name}`, 'info')
        acceptTransfer({ from, files, transferId })
      } else {
        setIncomingRequest({ from, files, transferId })
      }
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

    // Received text or clipboard message from a peer
    socket.on('text:receive', (data) => {
      setIncomingText(data)
      showToast(`Incoming text from ${data.from?.name || 'Peer'}!`, 'info')
      setHistory((prev) => [
        {
          name: `Text: "${data.text.slice(0, 24)}${data.text.length > 24 ? '…' : ''}"`,
          size: new Blob([data.text]).size,
          direction: 'received',
          peer: data.from?.name || 'Peer',
          ts: Date.now(),
        },
        ...prev,
      ])
    })

    // Pairing Socket Handshake
    socket.on('pairing:incoming', (data) => {
      setIncomingPairing(data)
    })

    socket.on('pairing:pending', (data) => {
      setPendingPairing(data)
    })

    socket.on('pairing:success', ({ pairedDevice }) => {
      setIncomingPairing(null)
      setPendingPairing(null)
      setTrustedDeviceIds((prev) =>
        prev.includes(pairedDevice.deviceId) ? prev : [...prev, pairedDevice.deviceId]
      )
      showToast(`✓ Paired & trusted with ${pairedDevice.name}!`, 'success')
    })

    socket.on('pairing:rejected', ({ reason }) => {
      setIncomingPairing(null)
      setPendingPairing(null)
      showToast(`Pairing declined: ${reason || 'Rejected by peer'}`, 'info')
    })

    return () => {
      socket.off('transfer:request')
      socket.off('transfer:accepted')
      socket.off('transfer:rejected')
      socket.off('text:receive')
      socket.off('pairing:incoming')
      socket.off('pairing:pending')
      socket.off('pairing:success')
      socket.off('pairing:rejected')
    }
  }, [socket, trustedDeviceIds, acceptTransfer, showToast])

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

  // Handle Pairing Requests
  const handlePairRequest = (peer) => {
    const targetSocketId = peer.id || peer.socketId
    socket.emit('pairing:request', {
      targetSocketId,
      targetDeviceId: peer.deviceId,
    })
  }

  const handleAcceptPairing = () => {
    if (!incomingPairing) return
    const senderSocketId = incomingPairing.from?.socketId || incomingPairing.from?.id
    socket.emit('pairing:accept', {
      senderSocketId,
      senderDeviceId: incomingPairing.from?.deviceId,
    })
    setIncomingPairing(null)
  }

  const handleRejectPairing = () => {
    if (!incomingPairing) return
    const senderSocketId = incomingPairing.from?.socketId || incomingPairing.from?.id
    socket.emit('pairing:reject', {
      senderSocketId,
      reason: 'Declined by user',
    })
    setIncomingPairing(null)
  }

  const handleToggleTrust = async (peer, shouldTrust) => {
    try {
      if (shouldTrust) {
        await deviceApi.addTrustedDevice(myDevice.deviceId, peer.deviceId)
        setTrustedDeviceIds((prev) => [...prev, peer.deviceId])
        showToast(`Marked ${peer.name} as trusted`, 'success')
      } else {
        await deviceApi.removeTrustedDevice(myDevice.deviceId, peer.deviceId)
        setTrustedDeviceIds((prev) => prev.filter((id) => id !== peer.deviceId))
        showToast(`Removed trust for ${peer.name}`, 'info')
      }
    } catch (err) {
      showToast('Failed to update trust in database', 'error')
    }
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
        <DevicePanel
          selectedPeer={selectedPeer}
          onSelect={setSelectedPeer}
          trustedDeviceIds={trustedDeviceIds}
          onPairRequest={handlePairRequest}
          onToggleTrust={handleToggleTrust}
        />

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
        onAccept={() => acceptTransfer(incomingRequest)}
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

      {/* Incoming text message modal with 1-click clipboard copy */}
      <IncomingTextModal
        textData={incomingText}
        onClose={() => setIncomingText(null)}
      />

      {/* Device PIN Pairing Modal */}
      <PairingModal
        incomingPairing={incomingPairing}
        pendingPairing={pendingPairing}
        onAccept={handleAcceptPairing}
        onReject={handleRejectPairing}
        onCancel={() => setPendingPairing(null)}
      />
    </>
  )
}
