import { describe, it, expect } from 'vitest'
import { newId } from '../server/lib/id'

describe('newId', () => {
  it('12 碼小寫 base32', () => { expect(newId()).toMatch(/^[a-z2-7]{12}$/) })
  it('不重複', () => {
    const s = new Set(Array.from({ length: 1000 }, newId))
    expect(s.size).toBe(1000)
  })
})
