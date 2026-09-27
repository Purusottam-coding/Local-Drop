import { createContext, useContext, useEffect, useState } from 'react'
import { io } from 'socket.io-client'
import { deviceApi, networkApi } from '../services/api'
import { WebRTCManager } from '../services/webrtcService'

const SocketContext = createContext(null)

// Helper: detect device type from user agent
function detectDeviceType() {
  const ua = navigator.userAgent.toLowerCase()
  if (/windows/.test(ua)) return 'windows'
  if (/macintosh|mac os x/.test(ua)) return 'mac'
  if (/android/.test(ua)) return 'android'
  if (/iphone|ipad|ipod/.test(ua)) return 'ios'
  if (/linux/.test(ua)) return 'linux'
  return 'browser'
}

// Helper: get or generate persistent device ID
function getStoredDeviceId() {
  let id = localStorage.getItem('localdrop_device_id')
  if (!id) {
    id = 'dev_' + Math.random().toString(36).substring(2, 10) + Date.now().toString(36)
    localStorage.setItem('localdrop_device_id', id)
  }
  return id
}

// Helper: get or generate default device name
function getStoredDeviceName(type) {
  let name = localStorage.getItem('localdrop_device_name')
  if (!name) {
    const typeLabel = type.charAt(0).toUpperCase() + type.slice(1)
    name = `${typeLabel}-${Math.random().toString(36).substring(2, 6).toUpperCase()}`
    localStorage.setItem('localdrop_device_name', name)
  }
  return name
}

// Determine best socket connection URL: in dev, bypass Vite proxy directly to port 7000
function getSocketUrl() {
  if (typeof window === 'undefined') return '/'
  const { protocol, hostname, port } = window.location
  if (port === '5173') {
    return `${protocol}//${hostname}:7000`
  }
  return '/'
}

export function SocketProvider({ children }) {
  const [socket, setSocket] = useState(null)
  const [webrtcManager, setWebrtcManager] = useState(null)
  const [connected, setConnected] = useState(false)
  const [myDevice, setMyDevice] = useState(() => {
    const type = detectDeviceType()
    const deviceId = getStoredDeviceId()
    const name = getStoredDeviceName(type)
    return { deviceId, name, type, ip: 'Detecting…' }
  })
  const [peers, setPeers] = useState([])
  // Track temporarily dismissed peers in the current session without deleting them from database
  const [dismissedPeerIds, setDismissedPeerIds] = useState(new Set())

  // Pre-fetch LAN IP on mount so device card doesn't stay stuck at "Detecting…"
  useEffect(() => {
    networkApi
      .getNetworkInfo()
      .then((res) => {
        if (res.lanIp && res.lanIp !== '127.0.0.1') {
          setMyDevice((prev) => ({
            ...prev,
            ip: prev.ip === 'Detecting…' ? res.lanIp : prev.ip,
            lanIp: res.lanIp,
          }))
        }
      })
      .catch((err) => {
        console.warn('[SocketContext] Could not fetch initial LAN IP:', err.message)
      })
  }, [])

  useEffect(() => {
    const targetUrl = getSocketUrl()
    console.log('[SocketContext] Connecting to server at:', targetUrl)

    const s = io(targetUrl, {
      transports: ['polling', 'websocket'], // Reliable polling first, auto-upgrade to websocket
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000,
      timeout: 20000,
    })
    setSocket(s)
    const rtc = new WebRTCManager(s)
    setWebrtcManager(rtc)

    const registerSelf = () => {
      const deviceId = getStoredDeviceId()
      const type = detectDeviceType()
      const name = getStoredDeviceName(type)
      s.emit('device:register', { deviceId, name, type })
    }

    s.on('connect', () => {
      console.log('[Socket Connected] ID:', s.id)
      setConnected(true)
      registerSelf()
    })

    s.on('reconnect', (attempt) => {
      console.log('[Socket Reconnected] Attempt:', attempt)
      setConnected(true)
      registerSelf()
    })

    s.on('connect_error', (err) => {
      console.warn('[Socket Connection Error]:', err.message)
      setConnected(false)
    })

    s.on('disconnect', (reason) => {
      console.warn('[Socket Disconnected]:', reason)
      setConnected(false)
    })

    // Received our confirmed device info from server/MongoDB
    s.on('device:registered', (info) => {
      setMyDevice((prev) => ({ ...prev, ...info }))
    })

    s.on('device:info', (info) => {
      setMyDevice((prev) => ({ ...prev, ...info }))
    })

    // Received list of online peers
    s.on('peers:list', (list) => {
      setPeers(list || [])
    })

    s.on('devices:list', (list) => {
      setPeers(list || [])
    })

    // Peer came online
    s.on('device:online', (peer) => {
      setPeers((prev) => {
        const index = prev.findIndex((p) => p.deviceId === peer.deviceId || p.id === peer.id)
        if (index >= 0) {
          const updated = [...prev]
          updated[index] = { ...updated[index], ...peer }
          return updated
        }
        return [...prev, peer]
      })
    })

    // Peer disconnected
    s.on('device:offline', ({ deviceId, id }) => {
      setPeers((prev) => prev.filter((p) => p.deviceId !== deviceId && p.id !== id))
    })

    s.on('peer:left', ({ deviceId, id }) => {
      setPeers((prev) => prev.filter((p) => p.deviceId !== deviceId && p.id !== id))
    })

    // Acknowledge device unpair/dismissal
    s.on('device:removed', ({ deviceId }) => {
      setDismissedPeerIds((prev) => {
        const next = new Set(prev)
        if (deviceId) next.add(deviceId)
        return next
      })
    })

    return () => {
      rtc.cleanup()
      s.disconnect()
    }
  }, [])

  // Function to rename device and sync with MongoDB & Socket
  const updateDeviceName = async (newName) => {
    const trimmed = newName.trim()
    if (!trimmed) return

    localStorage.setItem('localdrop_device_name', trimmed)
    setMyDevice((prev) => ({ ...prev, name: trimmed }))

    const deviceId = getStoredDeviceId()
    const type = detectDeviceType()

    // 1. Update backend via REST API service
    try {
      await deviceApi.updateDevice(deviceId, { name: trimmed })
    } catch (e) {
      console.error('Failed to update device name in database:', e)
    }

    // 2. Re-register via socket so all peers immediately see the new name
    if (socket && socket.connected) {
      socket.emit('device:register', { deviceId, name: trimmed, type })
    }
  }

  // Request peer list refresh - clears dismissed peers on user refresh / scan!
  const refreshPeers = () => {
    setDismissedPeerIds(new Set())
    if (socket && socket.connected) {
      socket.emit('peers:scan')
    }
  }

  // Manual dismissal of a peer from local UI and unpair on socket (does NOT delete from DB)
  const removePeer = (deviceId, targetSocketId) => {
    setDismissedPeerIds((prev) => {
      const next = new Set(prev)
      if (deviceId) next.add(deviceId)
      if (targetSocketId) next.add(targetSocketId)
      return next
    })

    if (socket && socket.connected) {
      socket.emit('device:remove', { targetDeviceId: deviceId, targetSocketId })
    }
  }

  // Manual reconnection helper
  const reconnectSocket = () => {
    if (socket) {
      socket.connect()
    }
  }

  // Visible peers excludes any peer dismissed by the user in this session
  const visiblePeers = peers.filter(
    (p) => !dismissedPeerIds.has(p.deviceId) && !dismissedPeerIds.has(p.id) && !dismissedPeerIds.has(p.socketId)
  )

  return (
    <SocketContext.Provider
      value={{
        socket,
        webrtcManager,
        connected,
        myDevice,
        peers: visiblePeers,
        setPeers,
        removePeer,
        updateDeviceName,
        refreshPeers,
        reconnectSocket,
      }}
    >
      {children}
    </SocketContext.Provider>
  )
}

export const useSocket = () => useContext(SocketContext)
