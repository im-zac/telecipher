import { createHash, timingSafeEqual } from 'node:crypto'

/** 常數時間比對：先 sha256 再 timingSafeEqual，避免長度洩漏。 */
export function isAuthorized(provided: string | undefined, configured: string): boolean {
  if (!configured || typeof provided !== 'string') return false
  const a = createHash('sha256').update(provided).digest()
  const b = createHash('sha256').update(configured).digest()
  return timingSafeEqual(a, b)
}
