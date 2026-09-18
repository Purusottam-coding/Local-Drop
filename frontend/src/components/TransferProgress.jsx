import { formatBytes } from '../utils/helpers'

export default function TransferProgress({ progressItems = [], title = 'Transfer in Progress' }) {
  if (!progressItems || progressItems.length === 0) return null

  const doneCount = progressItems.filter((i) => i.done).length

  return (
    <div className="progress-section">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h4>{title}</h4>
        <span style={{ fontSize: '12px', color: 'var(--gray-500)', fontWeight: 500 }}>
          {doneCount} of {progressItems.length} completed
        </span>
      </div>

      {progressItems.map((item, i) => {
        const pct = Math.min(100, Math.max(0, Math.round(item.pct || 0)))
        return (
          <div key={i} className="progress-item">
            <div className="progress-row">
              <span className="progress-name" title={item.name}>
                {item.name}
                {item.size ? (
                  <span style={{ fontSize: '11px', color: 'var(--gray-400)', marginLeft: '6px' }}>
                    ({formatBytes(item.size)})
                  </span>
                ) : null}
              </span>
              <span className="progress-pct" style={{ color: item.done ? 'var(--green)' : 'var(--blue)' }}>
                {item.done ? '✓ Done' : `${pct}%`}
              </span>
            </div>

            <div className="progress-track">
              <div
                className={`progress-fill ${item.done ? 'done' : ''}`}
                style={{ width: `${pct}%`, transition: 'width 0.15s ease' }}
              />
            </div>

            <div className="progress-meta">
              <span>{item.done ? 'Completed' : item.speed || 'Streaming...'}</span>
              {item.transferred && item.size ? (
                <span style={{ marginLeft: 'auto' }}>
                  {formatBytes(item.transferred)} / {formatBytes(item.size)}
                </span>
              ) : null}
            </div>
          </div>
        )
      })}
    </div>
  )
}
