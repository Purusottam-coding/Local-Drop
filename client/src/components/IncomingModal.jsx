import { fileEmoji, formatBytes } from '../utils/helpers'

export default function IncomingModal({ request, onAccept, onReject }) {
  if (!request) return null
  const { from, files } = request

  return (
    <div className="modal-overlay">
      <div className="modal">
        <div className="modal-icon incoming">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <polyline points="8 16 12 20 16 16"/>
            <line x1="12" y1="4" x2="12" y2="20"/>
          </svg>
        </div>

        <h3 className="modal-title">Incoming Transfer</h3>
        <p className="modal-body">
          <strong>{from.name}</strong> wants to send you:
        </p>

        <ul className="modal-file-list">
          {files.map((f, i) => (
            <li key={i}>
              <span className="icon">{fileEmoji(f.name)}</span>
              <span>{f.name}</span>
              <span style={{ marginLeft: 'auto', color: 'var(--text-muted)', fontSize: 11 }}>
                {formatBytes(f.size)}
              </span>
            </li>
          ))}
        </ul>

        <div className="modal-actions">
          <button className="btn-danger"  onClick={onReject}>Decline</button>
          <button className="btn-success" onClick={onAccept}>Accept</button>
        </div>
      </div>
    </div>
  )
}
