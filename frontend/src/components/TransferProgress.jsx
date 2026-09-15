import { useEffect, useRef, useState } from 'react'

export default function TransferProgress({ files, onFileDone }) {
  const [items, setItems] = useState([])
  const timers = useRef([])

  useEffect(() => {
    // Clear any running timers from previous transfer
    timers.current.forEach(clearInterval)
    timers.current = []

    const initial = files.map(f => ({
      name: f.name,
      size: f.size || 0,
      pct: 0,
      speed: '',
      done: false,
    }))

    setItems(initial)

    // Simulate progress for each file
    initial.forEach((_, index) => {
      const totalDuration = 2000 + Math.random() * 3000 // 2 – 5 seconds
      const tickMs = 80
      const increment = 100 / (totalDuration / tickMs)

      const interval = setInterval(() => {
        setItems(prev => {
          const next = [...prev]
          const item = { ...next[index] }

          item.pct = Math.min(100, item.pct + increment + Math.random() * increment * 0.5)
          item.speed = `${(Math.random() * 4 + 1).toFixed(1)} MB/s`

          if (item.pct >= 100) {
            item.done = true
            clearInterval(interval)
            onFileDone?.({ name: item.name, size: item.size })
          }

          next[index] = item
          return next
        })
      }, tickMs)

      timers.current.push(interval)
    })

    return () => timers.current.forEach(clearInterval)
  }, [files])

  if (items.length === 0) return null

  const doneCount = items.filter(i => i.done).length

  return (
    <div className="progress-section">
      <h4>Transferring — {doneCount} of {items.length} done</h4>

      {items.map((item, i) => {
        const pct = Math.round(item.pct)
        return (
          <div key={i} className="progress-item">
            <div className="progress-row">
              <span className="progress-name">{item.name}</span>
              <span className="progress-pct">
                {item.done ? '✓ Done' : `${pct}%`}
              </span>
            </div>

            <div className="progress-track">
              <div
                className={`progress-fill ${item.done ? 'done' : ''}`}
                style={{ width: `${pct}%` }}
              />
            </div>

            {!item.done && (
              <div className="progress-meta">
                <span>{item.speed}</span>
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}
