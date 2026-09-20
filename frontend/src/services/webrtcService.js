/**
 * WebRTC Peer-to-Peer File Transfer Service
 * 
 * Features:
 * - Direct P2P RTCDataChannel transmission (no server storage)
 * - 64 KB chunking with backpressure buffering
 * - Event-driven pub/sub architecture (supports multiple listeners)
 * - Automatic binary reassembly and download trigger
 * - Real-time progress, speed, and percent calculation
 */

import { sanitizeFilename } from '../utils/helpers'

const RTC_CONFIG = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
  ],
}

const CHUNK_SIZE = 64 * 1024 // 64 KB chunks
const BUFFER_THRESHOLD = 1024 * 1024 // 1 MB backpressure threshold

/**
 * Trigger file download on demand without automatic browser force
 */
export function downloadFileBlob(blob, fileName) {
  const safeName = sanitizeFilename(fileName)
  const url = typeof blob === 'string' ? blob : URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = safeName
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  if (typeof blob !== 'string') {
    setTimeout(() => URL.revokeObjectURL(url), 60000)
  }
}

export class WebRTCManager {
  constructor(socket) {
    this.socket = socket
    this.peerConnection = null
    this.dataChannel = null
    this.targetSocketId = null
    this.currentTransferId = null

    // Event listeners map (supports multiple subscribers)
    this.events = {
      progress: [],
      fileComplete: [],
      allComplete: [],
      error: [],
    }

    // Receiver state
    this.currentFileMeta = null
    this.receivedChunks = []
    this.receivedBytes = 0

    this.initSocketListeners()
  }

  // Subscribe to an event
  on(event, handler) {
    if (this.events[event]) {
      this.events[event].push(handler)
    }
    // Return unsubscribe function
    return () => this.off(event, handler)
  }

  // Unsubscribe from an event
  off(event, handler) {
    if (this.events[event]) {
      this.events[event] = this.events[event].filter((h) => h !== handler)
    }
  }

  // Emit event to all subscribers
  emit(event, data) {
    // Also trigger legacy single callback if present
    if (event === 'progress' && typeof this.onProgress === 'function') {
      try { this.onProgress(data) } catch (e) { console.error(e) }
    }
    if (event === 'fileComplete' && typeof this.onFileComplete === 'function') {
      try { this.onFileComplete(data) } catch (e) { console.error(e) }
    }
    if (event === 'allComplete' && typeof this.onAllComplete === 'function') {
      try { this.onAllComplete(data) } catch (e) { console.error(e) }
    }
    if (event === 'error' && typeof this.onError === 'function') {
      try { this.onError(data) } catch (e) { console.error(e) }
    }

    if (this.events[event]) {
      this.events[event].forEach((handler) => {
        try {
          handler(data)
        } catch (err) {
          console.error(`[WebRTC] Error in ${event} listener:`, err)
        }
      })
    }
  }

  initSocketListeners() {
    this.socket.on('webrtc:offer', async ({ fromSocketId, offer, transferId }) => {
      console.log('[WebRTC] Received offer from', fromSocketId)
      this.targetSocketId = fromSocketId
      this.currentTransferId = transferId
      await this.handleOffer(offer)
    })

    this.socket.on('webrtc:answer', async ({ answer }) => {
      console.log('[WebRTC] Received answer')
      if (this.peerConnection) {
        await this.peerConnection.setRemoteDescription(new RTCSessionDescription(answer))
      }
    })

    this.socket.on('webrtc:ice-candidate', async ({ candidate }) => {
      if (this.peerConnection && candidate) {
        try {
          await this.peerConnection.addIceCandidate(new RTCIceCandidate(candidate))
        } catch (err) {
          console.error('[WebRTC] Error adding ICE candidate:', err)
        }
      }
    })
  }

  // -------------------------------------------------------------
  // SENDER FLOW
  // -------------------------------------------------------------
  async initiateTransfer(targetSocketId, transferId, files) {
    this.targetSocketId = targetSocketId
    this.currentTransferId = transferId

    this.peerConnection = new RTCPeerConnection(RTC_CONFIG)

    this.peerConnection.onicecandidate = (event) => {
      if (event.candidate) {
        this.socket.emit('webrtc:ice-candidate', {
          targetSocketId: this.targetSocketId,
          candidate: event.candidate,
          transferId: this.currentTransferId,
        })
      }
    }

    // Create DataChannel
    this.dataChannel = this.peerConnection.createDataChannel('fileTransfer', {
      ordered: true,
    })
    this.dataChannel.binaryType = 'arraybuffer'

    this.dataChannel.onopen = () => {
      console.log('[WebRTC] DataChannel opened (Sender)')
      this.sendFiles(files)
    }

    this.dataChannel.onerror = (err) => {
      console.error('[WebRTC] DataChannel error:', err)
      this.emit('error', err)
    }

    // Create and send offer
    const offer = await this.peerConnection.createOffer()
    await this.peerConnection.setLocalDescription(offer)

    this.socket.emit('webrtc:offer', {
      targetSocketId: this.targetSocketId,
      offer,
      transferId: this.currentTransferId,
    })
  }

  async sendFiles(files) {
    const totalFiles = files.length

    for (let i = 0; i < totalFiles; i++) {
      const file = files[i]
      console.log(`[WebRTC] Sending file ${i + 1}/${totalFiles}: ${file.name} (${file.size} bytes)`)

      // 1. Send file metadata header
      const header = JSON.stringify({
        type: 'file_header',
        index: i,
        name: file.name,
        size: file.size,
        mimeType: file.type || 'application/octet-stream',
      })
      this.dataChannel.send(header)

      // 2. Stream chunks
      let offset = 0
      let lastProgressTime = Date.now()
      let lastProgressBytes = 0

      while (offset < file.size) {
        // Handle backpressure
        if (this.dataChannel.bufferedAmount > BUFFER_THRESHOLD) {
          await new Promise((resolve) => {
            this.dataChannel.onbufferedamountlow = () => {
              this.dataChannel.onbufferedamountlow = null
              resolve()
            }
          })
        }

        const slice = file.slice(offset, offset + CHUNK_SIZE)
        const buffer = await slice.arrayBuffer()
        this.dataChannel.send(buffer)

        offset += buffer.byteLength

        // Calculate speed & progress
        const now = Date.now()
        const elapsed = (now - lastProgressTime) / 1000
        if (elapsed >= 0.2 || offset >= file.size) {
          const speed = ((offset - lastProgressBytes) / (elapsed || 0.001) / (1024 * 1024)).toFixed(1)
          const pct = Math.min(100, Math.round((offset / file.size) * 100))

          this.emit('progress', {
            fileIndex: i,
            fileName: file.name,
            transferredBytes: offset,
            totalBytes: file.size,
            speed: `${speed} MB/s`,
            percent: pct,
            isSender: true,
          })

          lastProgressTime = now
          lastProgressBytes = offset
        }
      }

      // 3. Send file completion message
      this.dataChannel.send(JSON.stringify({ type: 'file_end', index: i, name: file.name }))
      this.emit('fileComplete', { fileName: file.name, size: file.size, isSender: true })
    }

    // 4. Send all files done
    this.dataChannel.send(JSON.stringify({ type: 'all_done', transferId: this.currentTransferId }))
    this.socket.emit('transfer:complete', { transferId: this.currentTransferId })
    this.emit('allComplete', { isSender: true })
  }

  // -------------------------------------------------------------
  // RECEIVER FLOW
  // -------------------------------------------------------------
  async handleOffer(offer) {
    this.peerConnection = new RTCPeerConnection(RTC_CONFIG)

    this.peerConnection.onicecandidate = (event) => {
      if (event.candidate) {
        this.socket.emit('webrtc:ice-candidate', {
          targetSocketId: this.targetSocketId,
          candidate: event.candidate,
          transferId: this.currentTransferId,
        })
      }
    }

    this.peerConnection.ondatachannel = (event) => {
      this.dataChannel = event.channel
      this.dataChannel.binaryType = 'arraybuffer'

      this.dataChannel.onopen = () => {
        console.log('[WebRTC] DataChannel opened (Receiver)')
      }

      this.dataChannel.onmessage = (event) => this.handleIncomingMessage(event.data)

      this.dataChannel.onerror = (err) => {
        console.error('[WebRTC] DataChannel receiver error:', err)
        this.emit('error', err)
      }
    }

    await this.peerConnection.setRemoteDescription(new RTCSessionDescription(offer))
    const answer = await this.peerConnection.createAnswer()
    await this.peerConnection.setLocalDescription(answer)

    this.socket.emit('webrtc:answer', {
      targetSocketId: this.targetSocketId,
      answer,
      transferId: this.currentTransferId,
    })
  }

  handleIncomingMessage(data) {
    // String message -> metadata control signal
    if (typeof data === 'string') {
      try {
        const msg = JSON.parse(data)

        if (msg.type === 'file_header') {
          // Sanitize received filename against path traversal & dangerous characters
          const safeName = sanitizeFilename(msg.name || 'received_file')
          msg.name = safeName

          console.log(`[WebRTC] Receiving file: ${safeName} (${msg.size} bytes)`)
          this.currentFileMeta = msg
          this.receivedChunks = []
          this.receivedBytes = 0

          this.emit('progress', {
            fileIndex: msg.index,
            fileName: safeName,
            transferredBytes: 0,
            totalBytes: msg.size,
            speed: 'Receiving...',
            percent: 0,
            isSender: false,
          })
        } else if (msg.type === 'file_end') {
          console.log(`[WebRTC] Completed receiving: ${msg.name}`)

          // Reassemble blob and emit fileComplete (manual download on-demand)
          if (this.currentFileMeta) {
            const blob = new Blob(this.receivedChunks, {
              type: this.currentFileMeta.mimeType || 'application/octet-stream',
            })

            this.emit('fileComplete', {
              fileName: this.currentFileMeta.name,
              size: this.currentFileMeta.size,
              blob,
              isSender: false,
            })

            this.currentFileMeta = null
            this.receivedChunks = []
            this.receivedBytes = 0
          }
        } else if (msg.type === 'all_done') {
          console.log('[WebRTC] All files received successfully')
          this.emit('allComplete', { isSender: false })
        }
      } catch (err) {
        console.error('[WebRTC] Error parsing control message:', err)
      }
      return
    }

    // Binary message -> file chunk
    if (data instanceof ArrayBuffer && this.currentFileMeta) {
      // Guard against malicious oversize buffer bombs (> declared size + 2MB allowance)
      const maxAllowed = (this.currentFileMeta.size || 0) + 2 * 1024 * 1024
      if (this.receivedBytes + data.byteLength > maxAllowed) {
        console.error('[WebRTC] Aborting file reception: payload exceeds declared file size bounds.')
        this.receivedChunks = []
        this.receivedBytes = 0
        this.currentFileMeta = null
        this.emit('error', new Error('File transfer aborted: incoming data exceeded size limit.'))
        return
      }

      this.receivedChunks.push(data)
      this.receivedBytes += data.byteLength

      const total = this.currentFileMeta.size || 1
      const pct = Math.min(100, Math.round((this.receivedBytes / total) * 100))

      this.emit('progress', {
        fileIndex: this.currentFileMeta.index,
        fileName: this.currentFileMeta.name,
        transferredBytes: this.receivedBytes,
        totalBytes: total,
        speed: 'Streaming',
        percent: pct,
        isSender: false,
      })
    }
  }

  // Trigger file download in browser on-demand
  downloadBlob(blob, fileName) {
    downloadFileBlob(blob, fileName)
  }

  // Cleanup connections
  cleanup() {
    if (this.dataChannel) {
      try {
        this.dataChannel.close()
      } catch {}
      this.dataChannel = null
    }
    if (this.peerConnection) {
      try {
        this.peerConnection.close()
      } catch {}
      this.peerConnection = null
    }
    this.targetSocketId = null
    this.currentTransferId = null
    this.currentFileMeta = null
    this.receivedChunks = []
    this.receivedBytes = 0
  }
}
