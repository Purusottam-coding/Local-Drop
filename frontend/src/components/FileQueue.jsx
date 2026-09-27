import { fileEmoji, formatBytes } from '../utils/helpers'

export default function FileQueue({ files, onRemove, onClear, onSend }) {
  if (files.length === 0) return null

  // Calculate folder vs individual file metrics
  const folderSet = new Set()
  let folderFilesCount = 0

  files.forEach((f) => {
    if (f.relativePath && f.relativePath.includes('/')) {
      const rootFolder = f.relativePath.split('/')[0]
      folderSet.add(rootFolder)
      folderFilesCount++
    }
  })

  const folderCount = folderSet.size
  const singleFileCount = files.length - folderFilesCount
  const totalBytes = files.reduce((acc, f) => acc + (f.size || 0), 0)

  return (
    <div className="file-queue">
      <div className="queue-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <h4 style={{ margin: 0, fontSize: '13px', fontWeight: 600 }}>
            Ready to send: {folderCount > 0 && <span style={{ color: '#059669' }}>{folderCount} folder{folderCount > 1 ? 's' : ''}, </span>}
            {singleFileCount > 0 && <span>{singleFileCount} file{singleFileCount > 1 ? 's' : ''} </span>}
            <span style={{ color: 'var(--gray-500)', fontWeight: 400 }}>({formatBytes(totalBytes)})</span>
          </h4>
        </div>
        <button type="button" className="btn-ghost" style={{ fontSize: '12px', padding: '2px 6px' }} onClick={onClear}>
          Clear all
        </button>
      </div>

      <ul className="queue-list" style={{ maxHeight: '200px', overflowY: 'auto' }}>
        {files.map((file, i) => {
          const isFolderItem = Boolean(file.relativePath && file.relativePath.includes('/'))

          return (
            <li key={i} className="queue-item" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span className="file-type-icon">{isFolderItem ? '📂' : fileEmoji(file.name)}</span>
              <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
                <span className="queue-name" title={file.relativePath || file.name} style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {file.name}
                </span>
                {isFolderItem && (
                  <span style={{ fontSize: '10px', color: '#059669', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    In: {file.relativePath.substring(0, file.relativePath.lastIndexOf('/'))}
                  </span>
                )}
              </div>
              <span className="queue-size">{formatBytes(file.size)}</span>
              <button type="button" className="remove-btn" onClick={() => onRemove(i)} title="Remove item">
                ×
              </button>
            </li>
          )
        })}
      </ul>

      <button type="button" className="btn-send" onClick={onSend}>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <line x1="22" y1="2" x2="11" y2="13" />
          <polygon points="22 2 15 22 11 13 2 9 22 2" />
        </svg>
        Send {folderCount > 0 ? `${folderCount} Folder${folderCount > 1 ? 's' : ''} & ` : ''}{files.length} Item{files.length > 1 ? 's' : ''}
      </button>
    </div>
  )
}
