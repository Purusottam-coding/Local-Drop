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
