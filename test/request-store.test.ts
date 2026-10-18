import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdtempSync, rmSync, readFileSync, writeFileSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import * as store from '../server/lib/requestStore'

let dir: string, file: string
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'tc-s-')); file = join(dir, '.requests.json'); store.__reset(); store.configure(file); store.load() })
afterEach(() => rmSync(dir, { recursive: true, force: true }))

const input = (over: Partial<Parameters<typeof store.add>[0]> = {}) => ({
  session: 'dev', path: '/h/p/.env', mode: 'env' as const, key: 'A', description: 'OpenAI key', ...over,
})

describe('requestStore', () => {
  it('add → pending、有 id 與 createdAt，list 新到舊', async () => {
    const a = await store.add(input())
    const b = await store.add(input({ session: 'two' }))
    expect(a.status).toBe('pending')
    expect(a.id).toMatch(/^[a-z2-7]{12}$/)
    expect(Date.parse(a.createdAt)).not.toBeNaN()
    expect(store.list().map((r) => r.id)).toEqual([b.id, a.id])
  })
  it('持久化到檔案（0600），重 load 還在，且檔內無 value 欄位', async () => {
    const a = await store.add(input())
    expect(statSync(file).mode & 0o777).toBe(0o600)
    store.__reset(); store.configure(file); store.load()
    expect(store.get(a.id)?.session).toBe('dev')
    expect(readFileSync(file, 'utf8')).not.toMatch(/value/)
  })
  it('毀損檔 → 空清單＋warn，不覆寫', () => {
    writeFileSync(file, 'nope')
    const spy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    store.__reset(); store.configure(file); store.load()
    expect(store.list()).toEqual([])
    expect(spy).toHaveBeenCalled()
    expect(readFileSync(file, 'utf8')).toBe('nope')
    spy.mockRestore()
  })
  it('markFulfilled → fulfilled + fulfilledAt；再次 → CONFLICT', async () => {
    const a = await store.add(input())
    const f = await store.markFulfilled(a.id)
    expect(f.status).toBe('fulfilled'); expect(f.fulfilledAt).toBeTruthy()
    await expect(store.markFulfilled(a.id)).rejects.toMatchObject({ code: 'CONFLICT' })
  })
  it('cancel pending → cancelled；cancel fulfilled → 不變', async () => {
    const a = await store.add(input()); const b = await store.add(input())
    expect((await store.cancel(a.id)).status).toBe('cancelled')
    await store.markFulfilled(b.id)
    expect((await store.cancel(b.id)).status).toBe('fulfilled')
  })
  it('list filter pending / done', async () => {
    const a = await store.add(input()); const b = await store.add(input())
    await store.markFulfilled(b.id)
    expect(store.list('pending').map((r) => r.id)).toEqual([a.id])
    expect(store.list('done').map((r) => r.id)).toEqual([b.id])
  })
  it('clearDone 刪非 pending，回數量', async () => {
    const a = await store.add(input()); const b = await store.add(input()); const c = await store.add(input())
    await store.markFulfilled(b.id); await store.cancel(c.id)
    expect(await store.clearDone()).toBe(2)
    expect(store.list().map((r) => r.id)).toEqual([a.id])
  })
  it('get 不存在 → undefined；markFulfilled 不存在 → NOT_FOUND', async () => {
    expect(store.get('nope')).toBeUndefined()
    await expect(store.markFulfilled('nope')).rejects.toMatchObject({ code: 'NOT_FOUND' })
  })
})

describe('waitFor', () => {
  it('已非 pending → 立即回', async () => {
    const a = await store.add(input()); await store.markFulfilled(a.id)
    const r = await store.waitFor(a.id, 5000)
    expect(r?.status).toBe('fulfilled')
  })
  it('兩個 waiter 同時等，fulfill 後都醒', async () => {
    const a = await store.add(input())
    const p1 = store.waitFor(a.id, 5000); const p2 = store.waitFor(a.id, 5000)
    setTimeout(() => { void store.markFulfilled(a.id) }, 20)
    const [r1, r2] = await Promise.all([p1, p2])
    expect(r1?.status).toBe('fulfilled'); expect(r2?.status).toBe('fulfilled')
  })
  it('cancel 也會喚醒', async () => {
    const a = await store.add(input())
    const p = store.waitFor(a.id, 5000)
    setTimeout(() => { void store.cancel(a.id) }, 20)
    expect((await p)?.status).toBe('cancelled')
  })
  it('超時回當下狀態（pending）', async () => {
    const a = await store.add(input())
    const r = await store.waitFor(a.id, 30)
    expect(r?.status).toBe('pending')
  })
  it('不存在的 id → undefined', async () => {
    expect(await store.waitFor('nope', 10)).toBeUndefined()
  })
  it('重 load 後的 pending 仍可 wait 與 fulfill', async () => {
    const a = await store.add(input())
    store.__reset(); store.configure(file); store.load()
    const p = store.waitFor(a.id, 5000)
    setTimeout(() => { void store.markFulfilled(a.id) }, 20)
    expect((await p)?.status).toBe('fulfilled')
  })
})

describe('持久化健壯性', () => {
  it('3 個 add 並發 → 全部成功且重 load 後 3 筆都在', async () => {
    await Promise.all([store.add(input()), store.add(input({ key: 'B' })), store.add(input({ key: 'C' }))])
    store.__reset(); store.configure(file); store.load()
    expect(store.list()).toHaveLength(3)
  })
  it('markFulfilled 持久化失敗 → reject、狀態回到 pending、waiter 不醒', async () => {
    const a = await store.add(input())
    // 讓 persist 失敗：把儲存路徑指到「父目錄是一般檔」的位置（mkdir → ENOTDIR）
    writeFileSync(join(dir, 'blocker'), 'x')
    store.configure(join(dir, 'blocker', 'x.json'))
    const woke = vi.fn()
    store.waitFor(a.id, 5000).then(woke)
    await expect(store.markFulfilled(a.id)).rejects.toBeTruthy()
    expect(store.get(a.id)?.status).toBe('pending')
    await new Promise((r) => setTimeout(r, 20))
    expect(woke).not.toHaveBeenCalled()
  })
})
