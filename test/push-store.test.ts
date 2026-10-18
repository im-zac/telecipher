import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { rmSync, writeFileSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { configure, load, all, add, removeByEndpoint, __reset, type PushSub } from '../server/lib/pushStore'

const tmp = join(tmpdir(), 'tc-subs-test.json')
const sub = (endpoint: string): PushSub => ({ endpoint, keys: { p256dh: 'p', auth: 'a' } })
beforeEach(async () => { __reset(); configure(tmp); rmSync(tmp, { force: true }) })
afterEach(() => rmSync(tmp, { force: true }))

describe('pushStore', () => {
  it('add／all／dedup', async () => { await add(sub('https://x/1')); await add(sub('https://x/1')); expect(all()).toHaveLength(1) })
  it('持久化 0600，重 load 還在', async () => {
    await add(sub('https://x/1')); expect(statSync(tmp).mode & 0o777).toBe(0o600)
    __reset(); configure(tmp); load(); expect(all().map((s) => s.endpoint)).toEqual(['https://x/1'])
  })
  it('removeByEndpoint', async () => { await add(sub('a')); await add(sub('b')); await removeByEndpoint('a'); expect(all().map((s) => s.endpoint)).toEqual(['b']) })
  it('缺檔 → 空；毀損 → 空＋warn', () => {
    load(); expect(all()).toEqual([])
    writeFileSync(tmp, 'x'); const spy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    load(); expect(all()).toEqual([]); expect(spy).toHaveBeenCalled(); spy.mockRestore()
  })
})
