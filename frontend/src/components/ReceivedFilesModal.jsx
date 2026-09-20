import { useState } from 'react'
import { fileEmoji, formatBytes } from '../utils/helpers'
import { downloadFileBlob } from '../services/webrtcService'
import TransferProgress from './TransferProgress'

export default function ReceivedFilesModal({ receiving, onClose }) {
  const [downloadedMap, setDownloadedMap] = useState({})
  const [previewFile, setPreviewFile] = useState(null)
  const [downloadingAll, setDownloadingAll] = useState(false)

  if (!receiving) return null

  const { fromName, progressItems = [], receivedFiles = [], isFinished } = receiving

  // Download a single file
  const handleDownloadSingle = (file) => {
    if (!file?.blob) return
    downloadFileBlob(file.blob, file.name)
    setDownloadedMap((prev) => ({ ...prev, [file.name]: true }))
  }

  // Download all received files sequentially
  const handleDownloadAll = async () => {
    if (!receivedFiles.length) return
    setDownloadingAll(true)

    for (let i = 0; i < receivedFiles.length; i++) {
      const file = receivedFiles[i]
      if (file.blob) {
        downloadFileBlob(file.blob, file.name)
        setDownloadedMap((prev) => ({ ...prev, [file.name]: true }))
        // Brief pause to allow browser download manager to register
        await new Promise((r) => setTimeout(r, 220))
      }
    }
    setDownloadingAll(false)
  }

  // Check if file is previewable image
  const isImageFile = (name = '') => {
    return /\.(jpg|jpeg|png|gif|webp|svg)$/i.test(name)
  }

  return (
    <div className="modal-overlay">
      <div className="modal" style={{ width: '100%', maxWidth: '480px', textAlign: 'left' }}>
        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '4px' }}>
          <h3 style={{ margin: 0, display: 'flex', alignItems: 'center', gap: '8px' }}>
            {isFinished ? '📦 Files Received' : 'Receiving Files P2P'}
          </h3>
          <button
            type="button"
            className="btn-ghost"
            style={{ fontSize: '18px', padding: '0 4px', lineHeight: 1 }}
            onClick={onClose}
            title="Close"
          >
            ✕
          </button>
        </div>

        <p style={{ fontSize: '13px', color: 'var(--gray-500)', margin: '0 0 16px' }}>
          {isFinished
            ? `Transferred from ${fromName || 'Nearby Device'}. Choose files to download:`
            : `Direct WebRTC transfer from ${fromName || 'Nearby Device'}`}
        </p>

        {/* In-progress WebRTC streaming view */}
        {!isFinished && (
          <>
            <TransferProgress
              progressItems={progressItems}
              title="Streaming Over P2P DataChannel"
            />
            <div style={{ marginTop: '16px', display: 'flex', justifyContent: 'flex-end' }}>
              <button
                type="button"
                className="btn btn-outline"
                style={{ fontSize: '12px', padding: '6px 14px' }}
                onClick={onClose}
              >
                Dismiss
              </button>
            </div>
          </>
        )}

        {/* Transfer completed: Downloadable files list */}
        {isFinished && (
          <>
            {/* Scrollable list of files */}
            <ul
              style={{
                listStyle: 'none',
                padding: 0,
                margin: 0,
                maxHeight: '260px',
                overflowY: 'auto',
                display: 'flex',
                flexDirection: 'column',
                gap: '8px',
              }}
            >
              {receivedFiles.map((file, idx) => {
                const isDownloaded = downloadedMap[file.name]
                const isImg = isImageFile(file.name)

                return (
                  <li
                    key={idx}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '10px',
                      padding: '10px 12px',
                      background: 'var(--gray-50)',
                      border: '1px solid var(--gray-200)',
                      borderRadius: '8px',
                    }}
                  >
                    <span style={{ fontSize: '20px', flexShrink: 0 }}>
                      {fileEmoji(file.name)}
                    </span>

                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div
                        style={{
                          fontSize: '13px',
                          fontWeight: 600,
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                          color: 'var(--gray-900)',
                        }}
                        title={file.name}
                      >
                        {file.name}
                      </div>
                      <div style={{ fontSize: '11px', color: 'var(--gray-400)', marginTop: '2px' }}>
                        {formatBytes(file.size)}
                      </div>
                    </div>

                    <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
                      {/* Optional inline preview for images */}
                      {isImg && file.blob && (
                        <button
                          type="button"
                          className="btn-ghost"
                          style={{ padding: '4px 8px', fontSize: '13px' }}
                          title="Preview image"
                          onClick={() => setPreviewFile(previewFile === file ? null : file)}
                        >
                          👁️
                        </button>
                      )}

                      {/* Download button */}
                      <button
                        type="button"
                        className={`btn ${isDownloaded ? 'btn-success' : 'btn-primary'}`}
                        style={{
                          fontSize: '12px',
                          padding: '6px 12px',
                          borderRadius: '6px',
                          whiteSpace: 'nowrap',
                          fontWeight: 600,
                        }}
                        onClick={() => handleDownloadSingle(file)}
                      >
                        {isDownloaded ? '✓ Saved' : '⬇ Download'}
                      </button>
                    </div>
                  </li>
                )
              })}
            </ul>

            {/* Image Preview Overlay if selected */}
            {previewFile && previewFile.blob && (
              <div
                style={{
                  marginTop: '12px',
                  padding: '8px',
                  background: 'var(--white)',
                  border: '1px solid var(--gray-200)',
                  borderRadius: '8px',
                  textAlign: 'center',
                }}
              >
                <img
                  src={URL.createObjectURL(previewFile.blob)}
                  alt={previewFile.name}
                  style={{ maxHeight: '160px', maxWidth: '100%', objectFit: 'contain', borderRadius: '4px' }}
                />
              </div>
            )}

            {/* Action Bar */}
            <div style={{ marginTop: '16px', display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
              <button
                type="button"
                className="btn btn-outline"
                style={{ fontSize: '13px', padding: '8px 16px' }}
                onClick={onClose}
              >
                Done
              </button>

              {receivedFiles.length > 1 && (
                <button
                  type="button"
                  className="btn btn-primary"
                  style={{ fontSize: '13px', padding: '8px 18px', fontWeight: 600 }}
                  onClick={handleDownloadAll}
                  disabled={downloadingAll}
                >
                  {downloadingAll ? 'Downloading…' : `⬇ Download All (${receivedFiles.length})`}
                </button>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  )
}
