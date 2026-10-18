import { describe, it, expect } from 'vitest'
import { validateCreate } from '../server/lib/validate'

const good = { session: 'dev', path: '~/p/.env', mode: 'env', key: 'A', description: 'd' }
const bad = (over: object) => { const r = validateCreate({ ...good, ...over }); if (r.ok) throw new Error('expected fail'); return r.reason }

describe('validateCreate', () => {
  it('合法 env', () => { expect(validateCreate(good)).toEqual({ ok: true, value: good }) })
  it('合法 file，無 key', () => {
    const { key, ...g } = good
    expect(validateCreate({ ...g, mode: 'file' })).toEqual({ ok: true, value: { ...g, mode: 'file' } })
  })
  it('file 模式帶 key → 忽略 key', () => {
    const r = validateCreate({ ...good, mode: 'file' }); expect(r.ok && r.value.key).toBeUndefined()
  })
  it('非物件', () => { const r = validateCreate(null); expect(r.ok).toBe(false) })
  it('session 空／過長', () => { expect(bad({ session: '' })).toMatch(/session/); expect(bad({ session: 'x'.repeat(81) })).toMatch(/session/) })
  it('description 空／過長', () => { expect(bad({ description: ' ' })).toMatch(/description/); expect(bad({ description: 'x'.repeat(501) })).toMatch(/description/) })
  it('mode 不合法', () => { expect(bad({ mode: 'blob' })).toMatch(/mode/) })
  it('env 缺 key／key 不合法', () => { expect(bad({ key: undefined })).toMatch(/key/); expect(bad({ key: '1A' })).toMatch(/key/) })
  it('path 非字串', () => { expect(bad({ path: 3 })).toMatch(/path/) })
  it('trim session 與 description', () => {
    const r = validateCreate({ ...good, session: ' dev ', description: ' d ' })
    expect(r.ok && r.value.session).toBe('dev'); expect(r.ok && r.value.description).toBe('d')
  })
})
