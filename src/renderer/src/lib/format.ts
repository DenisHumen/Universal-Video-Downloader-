export function formatBytes(bytes?: number): string {
  if (bytes == null || !Number.isFinite(bytes) || bytes <= 0) return '—'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let value = bytes
  let i = 0
  while (value >= 1024 && i < units.length - 1) {
    value /= 1024
    i++
  }
  return `${value.toFixed(value >= 10 || i === 0 ? 0 : 1)} ${units[i]}`
}

export function formatSpeed(bytesPerSecond?: number): string {
  if (!bytesPerSecond || bytesPerSecond <= 0) return ''
  return `${formatBytes(bytesPerSecond)}/s`
}

export function formatDuration(seconds?: number): string {
  if (seconds == null || !Number.isFinite(seconds) || seconds < 0) return ''
  const s = Math.floor(seconds % 60)
  const m = Math.floor((seconds / 60) % 60)
  const h = Math.floor(seconds / 3600)
  const pad = (n: number): string => n.toString().padStart(2, '0')
  if (h > 0) return `${h}:${pad(m)}:${pad(s)}`
  return `${m}:${pad(s)}`
}

export function formatEta(seconds?: number): string {
  if (seconds == null || !Number.isFinite(seconds) || seconds <= 0) return ''
  if (seconds < 60) return `${Math.round(seconds)}s left`
  const m = Math.floor(seconds / 60)
  const s = Math.round(seconds % 60)
  if (m < 60) return `${m}m ${s}s left`
  const h = Math.floor(m / 60)
  return `${h}h ${m % 60}m left`
}

export function formatCount(n?: number): string {
  if (n == null) return ''
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`
  return String(n)
}

export function isProbablyUrl(text: string): boolean {
  const t = text.trim()
  if (!t) return false
  return /^(https?:\/\/|www\.)\S+\.\S+/i.test(t) || /^[\w-]+\.\w{2,}\/\S+/i.test(t)
}
