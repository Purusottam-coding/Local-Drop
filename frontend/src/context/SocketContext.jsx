import { createContext, useContext, useEffect, useState } from 'react'
import { io } from 'socket.io-client'
import { deviceApi } from '../services/api'

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

export function SocketProvider({ children }) {
  const [socket, setSocket] = useState(null)
  const [connected, setConnected] = useState(false)
  const [myDevice, setMyDevice] = useState(() => {
    const type = detectDeviceType()
    const deviceId = getStoredDeviceId()
    const name = getStoredDeviceName(type)
    return { deviceId, name, type, ip: 'Detecting…' }
  })
  const [peers, setPeers] = useState([])

  useEffect(() => {
    const s = io('/', { transports: ['websocket', 'polling'] })
    setSocket(s)

    s.on('connect', () => {
      setConnected(true)
      // Register device identity upon connection
      const deviceId = getStoredDeviceId()
      const type = detectDeviceType()
      const name = getStoredDeviceName(type)
      s.emit('device:register', { deviceId, name, type })
    })

    s.on('disconnect', () => {
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

    return () => s.disconnect()
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

  // Refresh peer list
  const refreshPeers = () => {
    if (socket && socket.connected) {
      socket.emit('devices:refresh')
    }
  }

  return (
    <SocketContext.Provider
      value={{
        socket,
        connected,
        myDevice,
        peers,
        setPeers,
        updateDeviceName,
        refreshPeers,
      }}
    >
      {children}
    </SocketContext.Provider>
  )
}

export const useSocket = () => useContext(SocketContext)
