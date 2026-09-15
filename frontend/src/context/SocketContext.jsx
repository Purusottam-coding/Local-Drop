import { createContext, useContext, useEffect, useState } from 'react'
import { io } from 'socket.io-client'

const SocketContext = createContext(null)

export function SocketProvider({ children }) {
  const [socket, setSocket] = useState(null)
  const [connected, setConnected] = useState(false)
  const [myDevice, setMyDevice] = useState({ name: 'This Device', ip: 'Detecting…' })
  const [peers, setPeers] = useState([])

  useEffect(() => {
    const s = io('/', { transports: ['websocket', 'polling'] })
    setSocket(s)

    s.on('connect',    () => setConnected(true))
    s.on('disconnect', () => setConnected(false))

    s.on('device:info', ({ name, ip }) => setMyDevice({ name, ip }))

    s.on('peers:list', (list) => setPeers(list))

    s.on('peer:joined', (peer) =>
      setPeers(prev => prev.find(p => p.id === peer.id) ? prev : [...prev, peer])
    )
    s.on('peer:left', ({ id }) =>
      setPeers(prev => prev.filter(p => p.id !== id))
    )

    return () => s.disconnect()
  }, [])

  return (
    <SocketContext.Provider value={{ socket, connected, myDevice, peers, setPeers }}>
      {children}
    </SocketContext.Provider>
  )
}

export const useSocket = () => useContext(SocketContext)
