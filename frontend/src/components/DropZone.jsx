import { useRef } from 'react'

export default function DropZone({ onFiles }) {
  const inputRef = useRef()

  function handleDrop(e) {
    e.preventDefault()
    e.currentTarget.classList.remove('over')
    const files = Array.from(e.dataTransfer.files)
    if (files.length) onFiles(files)
  }

  return (
    <div
      className="drop-zone"
      onDragOver={e => { e.preventDefault(); e.currentTarget.classList.add('over') }}
      onDragLeave={e => e.currentTarget.classList.remove('over')}
      onDrop={handleDrop}
      onClick={() => inputRef.current.click()}
    >
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
        <polyline points="16 16 12 12 8 16"/>
        <line x1="12" y1="12" x2="12" y2="21"/>
        <path d="M20.39 18.39A5 5 0 0 0 18 9h-1.26A8 8 0 1 0 3 16.3"/>
      </svg>
      <strong>Drag files here</strong>
      <p>or click to browse</p>

      <input
        ref={inputRef}
        type="file"
        multiple
        hidden
        onChange={e => { onFiles(Array.from(e.target.files)); e.target.value = '' }}
      />
    </div>
  )
}
