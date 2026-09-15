import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { SocketProvider } from './context/SocketContext'
import { ToastProvider } from './context/ToastContext'
import App from './App.jsx'
import './index.css'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <SocketProvider>
      <ToastProvider>
        <App />
      </ToastProvider>
    </SocketProvider>
  </StrictMode>,
)
