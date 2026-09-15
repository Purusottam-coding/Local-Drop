import { timeAgo, formatBytes } from '../utils/helpers'

export default function HistoryPanel({ history, onClear }) {
  return (
    <aside className="panel panel-history">
      <div className="panel-header">
        <h2>History</h2>
        {history.length > 0 && (
          <button className="btn-link" onClick={onClear}>Clear</button>
        )}
      </div>

      <ul className="history-list">
        {history.length === 0 ? (
          <li className="history-empty">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <polyline points="12 8 12 12 14 14"/>
              <path d="M3.05 11A9 9 0 1 0 5 5.6"/>
              <polyline points="3 3 3.05 11 11 11"/>
            </svg>
            <p>No transfers yet</p>
          </li>
        ) : (
          history.map((h, i) => (
            <li key={i} className="history-item">
              <div className="history-item-header">
                <span className="history-item-name" title={h.name}>{h.name}</span>
                <span className={`history-badge ${h.direction}`}>
                  {h.direction.toUpperCase()}
                </span>
              </div>
              <p className="history-meta">
                {formatBytes(h.size)} · {h.peer} · {timeAgo(h.ts)}
              </p>
            </li>
          ))
        )}
      </ul>
    </aside>
  )
}
