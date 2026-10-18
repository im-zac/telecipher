import { describe, it, expect } from 'vitest'
import { buildNotification, shouldPrune } from '../server/lib/pushNotify'
import type { SecretRequest } from '../server/lib/types'

const base: SecretRequest = { id: 'abc', session: 'dev', path: '/h/p/.env', mode: 'env', key: 'OPENAI_API_KEY', description: 'OpenAI key', status: 'pending', createdAt: '2026-10-18T00:00:00Z' }

describe('buildNotification', () => {
  it('env：title 用 key', () => {
    expect(buildNotification(base)).toEqual({ title: '🔑 dev · 需要 OPENAI_API_KEY', body: 'OpenAI key', tag: 'telecipher-abc', url: '/requests/abc' })
  })
  it('file：title 用檔名', () => {
    const { key, ...r } = base
    expect(buildNotification({ ...r, mode: 'file', path: '/h/p/sa.json' }).title).toBe('🔑 dev · 需要 sa.json')
  })
})
describe('shouldPrune', () => {
  it('404/410 → true，其他 false', () => { expect(shouldPrune(410)).toBe(true); expect(shouldPrune(404)).toBe(true); expect(shouldPrune(500)).toBe(false); expect(shouldPrune(undefined)).toBe(false) })
})
