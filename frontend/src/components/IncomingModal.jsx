import { fileEmoji, formatBytes } from '../utils/helpers'

export default function IncomingModal({ request, onAccept, onReject }) {
  if (!request) return null

  const { from, files } = request

  return (
    <div className="modal-overlay">
      <div className="modal">
        <h3>Incoming Transfer</h3>
        <p><strong>{from.name}</strong> wants to send you {files.length} file{files.length > 1 ? 's' : ''}:</p>

        <ul className="modal-files">
          {files.map((f, i) => (
            <li key={i}>
              <span>{fileEmoji(f.name)}</span>
              <span>{f.name}</span>
              <span>{formatBytes(f.size)}</span>
            </li>
          ))}
        </ul>

        <div className="modal-actions">
          <button className="btn btn-outline" onClick={onReject}>Decline</button>
          <button className="btn btn-primary" onClick={onAccept}>Accept</button>
        </div>
      </div>
    </div>
  )
}
