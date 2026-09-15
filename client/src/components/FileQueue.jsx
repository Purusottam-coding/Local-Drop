import { fileEmoji, formatBytes } from '../utils/helpers'

export default function FileQueue({ files, onRemove, onClear, onSend }) {
  if (files.length === 0) return null

  return (
    <div className="file-queue">
      <div className="queue-header">
        <h4>Ready to send ({files.length})</h4>
        <button className="btn-ghost" onClick={onClear}>Clear all</button>
      </div>

      <ul className="queue-list">
        {files.map((file, i) => (
          <li key={i} className="queue-item">
            <span className="file-type-icon">{fileEmoji(file.name)}</span>
            <span className="queue-name" title={file.name}>{file.name}</span>
            <span className="queue-size">{formatBytes(file.size)}</span>
            <button className="remove-btn" onClick={() => onRemove(i)}>×</button>
          </li>
        ))}
      </ul>

      <button className="btn-send" onClick={onSend}>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <line x1="22" y1="2" x2="11" y2="13"/>
          <polygon points="22 2 15 22 11 13 2 9 22 2"/>
        </svg>
        Send {files.length} file{files.length > 1 ? 's' : ''}
      </button>
    </div>
  )
}
