import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, readFileSync, statSync, readdirSync, writeFileSync, lstatSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { writeSecretFile, writeSecretEnvKey, atomicWrite } from '../server/lib/secretWriter'

let dir: string
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'tc-w-')) })
afterEach(() => rmSync(dir, { recursive: true, force: true }))
const mode = (p: string) => statSync(p).mode & 0o777

describe('writeSecretFile', () => {
  it('寫入原樣、mode 0600', async () => {
    const p = join(dir, 'k.json')
    await writeSecretFile(p, '{"a":1}\n')
    expect(readFileSync(p, 'utf8')).toBe('{"a":1}\n')
    expect(mode(p)).toBe(0o600)
  })
  it('建不存在的父目錄 0700', async () => {
    const p = join(dir, 'a', 'b', 'k')
    await writeSecretFile(p, 'v')
    expect(mode(join(dir, 'a'))).toBe(0o700)
    expect(mode(join(dir, 'a', 'b'))).toBe(0o700)
    expect(readFileSync(p, 'utf8')).toBe('v')
  })
  it('已存在 → 拒絕且不改內容', async () => {
    const p = join(dir, 'k'); writeFileSync(p, 'old')
    await expect(writeSecretFile(p, 'new')).rejects.toMatchObject({ code: 'EEXIST' })
    expect(readFileSync(p, 'utf8')).toBe('old')
  })
  it('不殘留 .tmp', async () => {
    await writeSecretFile(join(dir, 'k'), 'v')
    expect(readdirSync(dir)).toEqual(['k'])
  })
})

describe('writeSecretEnvKey', () => {
  it('檔不存在 → 建檔 0600', async () => {
    const p = join(dir, '.env')
    await writeSecretEnvKey(p, 'A', 'x')
    expect(readFileSync(p, 'utf8')).toBe('A="x"\n')
    expect(mode(p)).toBe(0o600)
  })
  it('既有檔 → upsert、其他行保留、mode 變 0600', async () => {
    const p = join(dir, '.env'); writeFileSync(p, 'B=1\n', { mode: 0o644 })
    await writeSecretEnvKey(p, 'A', 'x')
    expect(readFileSync(p, 'utf8')).toBe('B=1\nA="x"\n')
    expect(mode(p)).toBe(0o600)
  })
})

describe('atomicWrite', () => {
  it('預設 0600 且不留 tmp', async () => {
    const p = join(dir, 'f.json')
    await atomicWrite(p, '{}')
    expect(mode(p)).toBe(0o600)
    expect(readdirSync(dir)).toEqual(['f.json'])
  })
})

describe('atomicWrite 對抗被植入的 .tmp symlink', () => {
  it('path.tmp 是指向別處的 symlink → 不寫穿、目標仍正確寫入', async () => {
    const { symlinkSync } = await import('node:fs')
    const victim = join(dir, 'victim'); writeFileSync(victim, 'untouched')
    const p = join(dir, 'f'); symlinkSync(victim, p + '.tmp')
    await atomicWrite(p, 'secret')
    expect(readFileSync(victim, 'utf8')).toBe('untouched')
    expect(readFileSync(p, 'utf8')).toBe('secret')
    // tmp 名稱唯一，被植入的 f.tmp 與我們無關：不寫它、也不動它
    expect(lstatSync(p + '.tmp').isSymbolicLink()).toBe(true)
  })
})

describe('並發寫入', () => {
  it('同一路徑 5 個 atomicWrite 並發 → 全部成功、結果是其中一個完整內容、不留 tmp', async () => {
    const p = join(dir, 'k')
    const payloads = [0, 1, 2, 3, 4].map((i) => `payload-${i}\n`)
    await Promise.all(payloads.map((d) => atomicWrite(p, d)))
    expect(payloads).toContain(readFileSync(p, 'utf8'))
    expect(readdirSync(dir)).toEqual(['k'])
  })
  it('同一 .env 兩個 key 並發 upsert → 兩個 key 都在', async () => {
    const p = join(dir, '.env')
    await Promise.all([writeSecretEnvKey(p, 'A', '1'), writeSecretEnvKey(p, 'B', '2')])
    const c = readFileSync(p, 'utf8')
    expect(c).toMatch(/^A="1"$/m)
    expect(c).toMatch(/^B="2"$/m)
  })
})
