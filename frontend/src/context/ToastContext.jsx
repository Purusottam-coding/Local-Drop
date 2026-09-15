import { createContext, useContext, useState, useCallback } from 'react'

const ToastContext = createContext(null)

let nextId = 0

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([])

  const showToast = useCallback((msg, type = 'info') => {
    const id = ++nextId
    setToasts(prev => [...prev, { id, msg, type }])
    // Auto remove after 4 seconds
    setTimeout(() => removeToast(id), 4000)
  }, [])

  function removeToast(id) {
    setToasts(prev => prev.filter(t => t.id !== id))
  }

  return (
    <ToastContext.Provider value={{ showToast }}>
      {children}

      {/* Toast container rendered here so it's always on top */}
      <div className="toast-container">
        {toasts.map(t => (
          <div key={t.id} className={`toast ${t.type}`}>
            <span>{t.msg}</span>
            <button className="toast-close" onClick={() => removeToast(t.id)}>×</button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  )
}

export const useToast = () => useContext(ToastContext)
