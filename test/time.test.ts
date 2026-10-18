import { describe, it, expect } from 'vitest'
import { relativeTime } from '../utils/time'
const now = new Date('2026-10-18T12:00:00Z')
describe('relativeTime', () => {
  it('剛剛', () => expect(relativeTime('2026-10-18T11:59:40Z', now)).toBe('剛剛'))
  it('分鐘', () => expect(relativeTime('2026-10-18T11:45:00Z', now)).toBe('15 分鐘前'))
  it('小時', () => expect(relativeTime('2026-10-18T09:00:00Z', now)).toBe('3 小時前'))
  it('天', () => expect(relativeTime('2026-10-15T12:00:00Z', now)).toBe('3 天前'))
  it('無效', () => expect(relativeTime('x', now)).toBe(''))
})
