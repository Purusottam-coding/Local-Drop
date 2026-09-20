import { timeAgo, formatBytes } from '../utils/helpers'

export default function HistoryPanel({ history, onClear }) {
  return (
    <div className="panel">
      <div className="panel-header">
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <h2 style={{ margin: 0 }}>History</h2>
          <span
            style={{
              fontSize: '11px',
              padding: '2px 7px',
              borderRadius: '12px',
              background: 'var(--gray-100)',
              color: 'var(--gray-500)',
              fontWeight: 500,
            }}
            title="Transfers are automatically kept up to 24 hours unless cleared manually"
          >
            24h
          </span>
        </div>
        {history.length > 0 && (
          <button className="btn-ghost" onClick={onClear}>Clear</button>
        )}
      </div>

      <ul className="history-list">
        {history.length === 0 ? (
          <li className="empty-state">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <polyline points="12 8 12 12 14 14"/>
              <path d="M3.05 11A9 9 0 1 0 5 5.6"/>
              <polyline points="3 3 3.05 11 11 11"/>
            </svg>
            <span>No transfers yet</span>
          </li>
        ) : (
          history.map((item, i) => (
            <li key={i} className="history-item">
              <div className="history-row">
                <span className="history-name" title={item.name}>
                  {item.name}
                  {item.fileCount > 1 && ` +${item.fileCount - 1} more`}
                </span>
                <span className={`badge ${item.direction}`}>{item.direction}</span>
              </div>
              <div className="history-meta">
                {formatBytes(item.size)} · {item.peer} · {timeAgo(item.ts)}
              </div>
            </li>
          ))
        )}
      </ul>
    </div>
  )
}
