export const formatBytes = (b) => {
  if (!b) return '–'
  if (b < 1024)       return `${b} B`
  if (b < 1024 ** 2)  return `${(b / 1024).toFixed(1)} KB`
  if (b < 1024 ** 3)  return `${(b / 1024 ** 2).toFixed(1)} MB`
  return `${(b / 1024 ** 3).toFixed(2)} GB`
}

export const timeAgo = (ts) => {
  const s = Math.round((Date.now() - ts) / 1000)
  if (s < 5)    return 'just now'
  if (s < 60)   return `${s}s ago`
  if (s < 3600) return `${Math.round(s / 60)}m ago`
  return `${Math.round(s / 3600)}h ago`
}

export const fileEmoji = (name = '') => {
  const ext = name.split('.').pop().toLowerCase()
  const map = {
    pdf:'📄', doc:'📝', docx:'📝', xls:'📊', xlsx:'📊', ppt:'📑', pptx:'📑',
    jpg:'🖼️', jpeg:'🖼️', png:'🖼️', gif:'🖼️', webp:'🖼️', svg:'🎨',
    mp4:'🎬', mov:'🎬', avi:'🎬', mkv:'🎬', mp3:'🎵', wav:'🎵', flac:'🎵',
    zip:'📦', rar:'📦', '7z':'📦', tar:'📦', gz:'📦',
    js:'💻', ts:'💻', py:'💻', html:'💻', css:'💻', json:'💻', xml:'💻',
    txt:'📃', md:'📃', csv:'📊',
  }
  return map[ext] || '📁'
}

/**
 * Sanitize untrusted filename against path traversal, control characters, and dangerous characters.
 */
export const sanitizeFilename = (filename) => {
  if (!filename || typeof filename !== 'string') {
    return 'unnamed_file'
  }

  // 1. Strip any directory path components
  let clean = filename.replace(/^.*[\\\/]/, '')

  // 2. Remove null bytes and non-printable control characters
  clean = clean.replace(/[\x00-\x1f\x80-\x9f]/g, '')

  // 3. Replace forbidden filesystem characters (< > : " / \ | ? *) with an underscore
  clean = clean.replace(/[<>:"/\\|?*]/g, '_')

  // 4. Prevent relative path traversal sequences
  clean = clean.replace(/\.\.+/g, '.')

  // 5. Trim leading and trailing whitespace and periods
  clean = clean.trim().replace(/^\.+/, '').replace(/\.+$/, '')

  // 6. Check for Windows reserved device names
  const reservedRegex = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i
  if (reservedRegex.test(clean)) {
    clean = `file_${clean}`
  }

  // 7. Enforce maximum filename length (255 chars) while preserving extension
  const MAX_LEN = 255
  if (clean.length > MAX_LEN) {
    const extIndex = clean.lastIndexOf('.')
    if (extIndex !== -1 && extIndex > clean.length - 20) {
      const ext = clean.substring(extIndex)
      clean = clean.substring(0, MAX_LEN - ext.length) + ext
    } else {
      clean = clean.substring(0, MAX_LEN)
    }
  }

  return clean || 'unnamed_file'
}

