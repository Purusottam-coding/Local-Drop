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
    <div
      className="drop-zone"
      onDragOver={(e) => {
        e.preventDefault()
        e.currentTarget.classList.add('over')
      }}
      onDragLeave={(e) => e.currentTarget.classList.remove('over')}
      onDrop={handleDrop}
    >
      <svg className="drop-zone-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
        <polyline points="16 16 12 12 8 16" />
        <line x1="12" y1="12" x2="12" y2="21" />
        <path d="M20.39 18.39A5 5 0 0 0 18 9h-1.26A8 8 0 1 0 3 16.3" />
      </svg>
      <strong className="drop-zone-title-desktop">Drag files or folders here</strong>
      <p className="drop-zone-sub-desktop">or choose what to send:</p>

      <strong className="drop-zone-title-mobile">Tap to choose files, photos or folder</strong>

      <div style={{ display: 'flex', gap: '8px', marginTop: '6px', flexWrap: 'wrap', justifyContent: 'center' }}>
        <button
          type="button"
          className="btn btn-outline"
          style={{ fontSize: '12px', padding: '6px 14px', borderRadius: '20px' }}
          onClick={(e) => {
            e.stopPropagation()
            fileInputRef.current?.click()
          }}
        >
          📄 Choose Files
        </button>
        <button
          type="button"
          className="btn btn-outline"
          style={{ fontSize: '12px', padding: '6px 14px', borderRadius: '20px' }}
          onClick={(e) => {
            e.stopPropagation()
            folderInputRef.current?.click()
          }}
        >
          📂 Choose Folder
        </button>
      </div>

      <input
        ref={fileInputRef}
        type="file"
        multiple
        hidden
        onChange={(e) => {
          onFiles(Array.from(e.target.files))
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
          onFiles(Array.from(e.target.files))
          e.target.value = ''
        }}
      />
    </div>
  )
}
