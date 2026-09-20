import { useState, useEffect, useCallback } from 'react'
import { useSocket } from './context/SocketContext'
import { useToast } from './context/ToastContext'
import { transferApi, deviceApi } from './services/api'
import { playChime } from './utils/audioFeedback'
import Navbar from './components/Navbar'
import DevicePanel from './components/DevicePanel'
import TransferPanel from './components/TransferPanel'
import HistoryPanel from './components/HistoryPanel'
import IncomingModal from './components/IncomingModal'
import IncomingTextModal from './components/IncomingTextModal'
import PairingModal from './components/PairingModal'
import QRCodeModal from './components/QRCodeModal'
import ReceivedFilesModal from './components/ReceivedFilesModal'

export default function App() {
  const { socket, peers, myDevice, webrtcManager, connected } = useSocket()
  const { showToast } = useToast()

  const [selectedPeer, setSelectedPeer] = useState(null)
  const [incomingRequest, setIncomingRequest] = useState(null)
  const [incomingText, setIncomingText] = useState(null)
  const [receiving, setReceiving] = useState(null)
  const [history, setHistory] = useState([])
  const [qrOpen, setQrOpen] = useState(false)
  const [mobileTab, setMobileTab] = useState('devices') // 'devices' | 'transfer' | 'history'

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

  // Handle auto-pairing from QR code scan URL query parameters
  useEffect(() => {
    if (!socket || !connected) return
    const params = new URLSearchParams(window.location.search)
    const pairDeviceId = params.get('pair')
    const pairName = params.get('name')
    const pairPin = params.get('pin')

    if (pairDeviceId) {
      showToast(`Connecting with ${pairName || 'Nearby Device'} via QR...`, 'info')
      socket.emit('qr:pair', { hostDeviceId: pairDeviceId, pin: pairPin })
      window.history.replaceState({}, document.title, window.location.pathname)
    }
  }, [socket, connected, showToast])

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
        isFinished: false,
        receivedFiles: [],
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
      playChime('incoming')
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
      playChime('error')
      showToast(`${by?.name || 'Peer'} declined: ${reason || 'Transfer rejected'}`, 'error')
    })

    // Received text or clipboard message from a peer
    socket.on('text:receive', (data) => {
      playChime('incoming')
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
      playChime('incoming')
      setIncomingPairing(data)
    })

    socket.on('pairing:pending', (data) => {
      setPendingPairing(data)
    })

    socket.on('pairing:success', ({ pairedDevice }) => {
      playChime('paired')
      setIncomingPairing(null)
      setPendingPairing(null)
      setTrustedDeviceIds((prev) =>
        prev.includes(pairedDevice.deviceId) ? prev : [...prev, pairedDevice.deviceId]
      )
      showToast(`✓ Paired & trusted with ${pairedDevice.name}!`, 'success')
    })

    socket.on('pairing:rejected', ({ reason }) => {
      playChime('error')
      setIncomingPairing(null)
      setPendingPairing(null)
      showToast(`Pairing declined: ${reason || 'Rejected by peer'}`, 'info')
    })

    // Instant QR code pairing success handler
    socket.on('qr:paired', ({ pairedDevice, message }) => {
      playChime('paired')
      setIncomingPairing(null)
      setPendingPairing(null)
      setQrOpen(false)
      if (pairedDevice?.deviceId) {
        setTrustedDeviceIds((prev) =>
          prev.includes(pairedDevice.deviceId) ? prev : [...prev, pairedDevice.deviceId]
        )
        // Automatically select paired device and switch to transfer tab
        setSelectedPeer((current) => {
          if (!current || current.deviceId === pairedDevice.deviceId) {
            return pairedDevice
          }
          return current || pairedDevice
        })
        setMobileTab('transfer')
      }
      showToast(message || `✓ Connected to ${pairedDevice?.name || 'Device'}!`, 'success')
    })

    socket.on('qr:error', ({ message }) => {
      playChime('error')
      showToast(message || 'QR pairing failed', 'error')
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
      socket.off('qr:paired')
      socket.off('qr:error')
    }
  }, [socket, trustedDeviceIds, acceptTransfer, showToast])

  // Keep selectedPeer updated with latest socketId / connection info from peers list
  useEffect(() => {
    if (!selectedPeer || !peers || peers.length === 0) return
    const updated = peers.find((p) => p.deviceId === selectedPeer.deviceId)
    if (updated && (updated.socketId !== selectedPeer.socketId || updated.id !== selectedPeer.id)) {
      setSelectedPeer(updated)
    }
  }, [peers, selectedPeer])

  // WebRTC receiver-side callbacks using pub/sub listeners
  useEffect(() => {
    if (!webrtcManager) return

    const unsubProgress = webrtcManager.on('progress', (info) => {
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
    })

    const unsubFileComplete = webrtcManager.on('fileComplete', ({ fileName, size, blob, isSender }) => {
      if (!isSender) {
        showToast(`Received: ${fileName}`, 'info')
        loadHistory()
        setReceiving((prev) => {
          if (!prev) return prev
          const nextItems = (prev.progressItems || []).map((item) =>
            item.name === fileName
              ? { ...item, pct: 100, done: true, speed: '✓ Received' }
              : item
          )
          const newFile = { name: fileName, size, blob }
          const remaining = (prev.receivedFiles || []).filter((f) => f.name !== fileName)
          return {
            ...prev,
            receivedFiles: [...remaining, newFile],
            progressItems: nextItems,
          }
        })
      }
    })

    const unsubAllComplete = webrtcManager.on('allComplete', ({ isSender }) => {
      if (!isSender) {
        playChime('success')
        showToast('All files received! Ready to download.', 'success')
        loadHistory()
        setReceiving((prev) => (prev ? { ...prev, isFinished: true } : null))
      }
    })

    return () => {
      unsubProgress()
      unsubFileComplete()
      unsubAllComplete()
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
    } catch {
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
      <Navbar onOpenQR={() => setQrOpen(true)} />

      <main className="app-layout">
        <div className={`panel-wrapper panel-devices ${mobileTab === 'devices' ? 'active-mobile' : ''}`}>
          <DevicePanel
            selectedPeer={selectedPeer}
            onSelect={(peer) => {
              setSelectedPeer(peer)
              setMobileTab('transfer')
            }}
            trustedDeviceIds={trustedDeviceIds}
            onPairRequest={handlePairRequest}
            onToggleTrust={handleToggleTrust}
          />
        </div>

        <div className={`panel-wrapper panel-transfer ${mobileTab === 'transfer' ? 'active-mobile' : ''}`}>
          <TransferPanel
            selectedPeer={selectedPeer}
            onDisconnect={() => {
              setSelectedPeer(null)
              setMobileTab('devices')
            }}
            onSwitchToDevices={() => setMobileTab('devices')}
            onFileDone={addToHistory}
            onTransferCompleted={loadHistory}
          />
        </div>

        <div className={`panel-wrapper panel-history ${mobileTab === 'history' ? 'active-mobile' : ''}`}>
          <HistoryPanel history={history} onClear={handleClearHistory} />
        </div>
      </main>

      {/* Mobile Bottom Tab Bar */}
      <nav className="mobile-nav-bar" aria-label="Mobile Navigation">
        <button
          type="button"
          className={`mobile-nav-item ${mobileTab === 'devices' ? 'active' : ''}`}
          onClick={() => setMobileTab('devices')}
        >
          <div className="mobile-nav-icon-wrapper">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <rect x="2" y="3" width="20" height="14" rx="2" />
              <line x1="8" y1="21" x2="16" y2="21" />
              <line x1="12" y1="17" x2="12" y2="21" />
            </svg>
            {peers.length > 0 && <span className="mobile-nav-badge">{peers.length}</span>}
          </div>
          <span>Devices</span>
        </button>

        <button
          type="button"
          className={`mobile-nav-item ${mobileTab === 'transfer' ? 'active' : ''}`}
          onClick={() => setMobileTab('transfer')}
        >
          <div className="mobile-nav-icon-wrapper">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M7 17l9.2-9.2M17 17V8H8" />
            </svg>
            {selectedPeer && <span className="mobile-nav-dot" />}
          </div>
          <span>{selectedPeer ? selectedPeer.name : 'Transfer'}</span>
        </button>

        <button
          type="button"
          className={`mobile-nav-item ${mobileTab === 'history' ? 'active' : ''}`}
          onClick={() => setMobileTab('history')}
        >
          <div className="mobile-nav-icon-wrapper">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="12" cy="12" r="10" />
              <polyline points="12 6 12 12 16 14" />
            </svg>
            {history.length > 0 && <span className="mobile-nav-badge">{history.length}</span>}
          </div>
          <span>History</span>
        </button>
      </nav>

      {/* Incoming transfer request modal */}
      <IncomingModal
        request={incomingRequest}
        onAccept={() => acceptTransfer(incomingRequest)}
        onReject={rejectIncoming}
      />

      {/* Receiver WebRTC download & files modal */}
      <ReceivedFilesModal
        receiving={receiving}
        onClose={() => setReceiving(null)}
      />

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

      {/* QR Code Pairing Modal */}
      <QRCodeModal
        myDevice={myDevice}
        isOpen={qrOpen}
        onClose={() => setQrOpen(false)}
      />
    </>
  )
}
