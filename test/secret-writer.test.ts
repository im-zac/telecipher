import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, readFileSync, statSync, readdirSync, writeFileSync, existsSync } from 'node:fs'
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
    expect(existsSync(p + '.tmp')).toBe(false)
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
    expect(existsSync(p + '.tmp')).toBe(false)
  })
})
