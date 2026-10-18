export function relativeTime(iso: string, now = new Date()): string {
  const t = Date.parse(iso)
  if (Number.isNaN(t)) return ''
  const s = Math.max(0, Math.floor((now.getTime() - t) / 1000))
  if (s < 60) return '剛剛'
  const m = Math.floor(s / 60); if (m < 60) return `${m} 分鐘前`
  const h = Math.floor(m / 60); if (h < 24) return `${h} 小時前`
  return `${Math.floor(h / 24)} 天前`
}
