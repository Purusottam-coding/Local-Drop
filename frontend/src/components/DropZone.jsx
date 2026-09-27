import { useRef } from 'react'

async function traverseEntry(entry) {
  if (entry.isFile) {
    return new Promise((resolve) => {
      entry.file((file) => {
        if (entry.fullPath) {
          file.relativePath = entry.fullPath.replace(/^\//, '')
        }
        resolve([file])
      })
    })
  } else if (entry.isDirectory) {
    const dirReader = entry.createReader()
    const entries = await new Promise((resolve) => {
      const allEntries = []
      const readNext = () => {
        dirReader.readEntries(
          (results) => {
            if (!results.length) {
              resolve(allEntries)
            } else {
              allEntries.push(...results)
              readNext()
            }
          },
          () => resolve(allEntries)
        )
      }
      readNext()
    })

    const nestedFiles = await Promise.all(entries.map(traverseEntry))
    return nestedFiles.flat()
  }
  return []
}

export default function DropZone({ onFiles }) {
  const fileInputRef = useRef()
  const folderInputRef = useRef()

  async function handleDrop(e) {
    e.preventDefault()
    e.currentTarget.classList.remove('over')

    const items = e.dataTransfer.items
    if (items && items.length) {
      const filePromises = []
      for (let i = 0; i < items.length; i++) {
        const item = items[i]
        if (item.webkitGetAsEntry) {
          const entry = item.webkitGetAsEntry()
          if (entry) {
            filePromises.push(traverseEntry(entry))
            continue
          }
        }
        const file = item.getAsFile()
        if (file) filePromises.push(Promise.resolve([file]))
      }
      const fileArrays = await Promise.all(filePromises)
      const allFiles = fileArrays.flat().filter(Boolean)
      if (allFiles.length) onFiles(allFiles)
    } else {
      const files = Array.from(e.dataTransfer.files)
      if (files.length) onFiles(files)
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
      {/* Specific Quick Selection Cards: Send Files vs Send Folder */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          style={{
            background: 'var(--white)',
            border: '1.5px solid var(--blue)',
            borderRadius: '10px',
            padding: '14px 12px',
            cursor: 'pointer',
            textAlign: 'center',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: '6px',
            transition: 'all 0.15s ease',
            boxShadow: 'var(--shadow-sm)',
          }}
          className="send-option-card"
        >
          <div style={{ fontSize: '24px', lineHeight: 1 }}>📄</div>
          <div style={{ fontSize: '13px', fontWeight: 700, color: 'var(--blue)' }}>
            Send Files
          </div>
          <div style={{ fontSize: '11px', color: 'var(--gray-500)', lineHeight: 1.3 }}>
            Choose individual or multiple files
          </div>
        </button>

        <button
          type="button"
          onClick={() => folderInputRef.current?.click()}
          style={{
            background: 'var(--white)',
            border: '1.5px solid #059669',
            borderRadius: '10px',
            padding: '14px 12px',
            cursor: 'pointer',
            textAlign: 'center',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: '6px',
            transition: 'all 0.15s ease',
            boxShadow: 'var(--shadow-sm)',
          }}
          className="send-option-card"
        >
          <div style={{ fontSize: '24px', lineHeight: 1 }}>📂</div>
          <div style={{ fontSize: '13px', fontWeight: 700, color: '#059669' }}>
            Send Folder
          </div>
          <div style={{ fontSize: '11px', color: 'var(--gray-500)', lineHeight: 1.3 }}>
            Send entire folder with subfolders
          </div>
        </button>
      </div>

      {/* Drag & Drop Area */}
      <div
        className="drop-zone"
        onDragOver={(e) => {
          e.preventDefault()
          e.currentTarget.classList.add('over')
        }}
        onDragLeave={(e) => e.currentTarget.classList.remove('over')}
        onDrop={handleDrop}
        style={{ padding: '28px 20px', minHeight: '130px' }}
      >
        <svg className="drop-zone-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
          <polyline points="16 16 12 12 8 16" />
          <line x1="12" y1="12" x2="12" y2="21" />
          <path d="M20.39 18.39A5 5 0 0 0 18 9h-1.26A8 8 0 1 0 3 16.3" />
        </svg>
        <strong className="drop-zone-title-desktop" style={{ fontSize: '13px' }}>
          Or drag & drop files or folders here
        </strong>
        <p className="drop-zone-sub-desktop" style={{ fontSize: '11px', margin: 0 }}>
          All subfolders and directory structure are preserved
        </p>
      </div>

      {/* Hidden file inputs */}
      <input
        ref={fileInputRef}
        type="file"
        multiple
        hidden
        onChange={(e) => {
          if (e.target.files?.length) {
            onFiles(Array.from(e.target.files))
          }
          e.target.value = ''
        }}
      />
      <input
        ref={folderInputRef}
        type="file"
        webkitdirectory=""
        directory=""
        multiple
        hidden
        onChange={(e) => {
          if (e.target.files?.length) {
            const files = Array.from(e.target.files).map((f) => {
              if (f.webkitRelativePath) {
                f.relativePath = f.webkitRelativePath
              }
              return f
            })
            onFiles(files)
          }
          e.target.value = ''
        }}
      />
    </div>
  )
}
