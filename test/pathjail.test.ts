import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync, rmSync, realpathSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { resolveTarget } from '../server/lib/pathjail'

let home: string
let outside: string
beforeAll(() => {
  home = realpathSync(mkdtempSync(join(tmpdir(), 'tc-home-')))
  outside = realpathSync(mkdtempSync(join(tmpdir(), 'tc-out-')))
  mkdirSync(join(home, 'proj'))
  writeFileSync(join(home, 'proj', 'exists.txt'), 'x')
  symlinkSync(outside, join(home, 'link-dir'))
  symlinkSync(join(outside, 'f'), join(home, 'link-file'))
  mkdirSync(join(home, '.ssh'))
  mkdirSync(join(home, 'telecipher'))
})
afterAll(() => { rmSync(home, { recursive: true, force: true }); rmSync(outside, { recursive: true, force: true }) })

const ok = async (p: string, mode: 'file' | 'env' = 'file') => {
  const r = await resolveTarget(home, p, mode)
  if (!r.ok) throw new Error(r.reason)
  return r.path
}
const bad = async (p: string, mode: 'file' | 'env' = 'file') => {
  const r = await resolveTarget(home, p, mode)
  if (r.ok) throw new Error('expected rejection for ' + p)
  return r.reason
}

describe('resolveTarget', () => {
  it('絕對路徑在 home 內 → 回 resolve 後路徑', async () => {
    expect(await ok(join(home, 'proj', 'new.env'))).toBe(join(home, 'proj', 'new.env'))
  })
  it('~/ 前綴 → 相對 home', async () => {
    expect(await ok('~/proj/new.env')).toBe(join(home, 'proj', 'new.env'))
  })
  it('相對路徑 → 相對 home', async () => {
    expect(await ok('proj/new.env')).toBe(join(home, 'proj', 'new.env'))
  })
  it('.. 逃逸 → 拒絕', async () => {
    expect(await bad(join(home, '..', 'x'))).toMatch(/home/)
  })
  it('home 外絕對路徑 → 拒絕', async () => {
    expect(await bad(join(outside, 'x'))).toMatch(/home/)
  })
  it('結尾 / → 拒絕（是目錄）', async () => {
    expect(await bad('~/proj/')).toMatch(/目錄/)
  })
  it('父層是 symlink → 拒絕', async () => {
    expect(await bad('~/link-dir/x')).toMatch(/symlink/)
  })
  it('目標本身是 symlink → 拒絕', async () => {
    expect(await bad('~/link-file', 'env')).toMatch(/symlink/)
  })
  it('拒絕清單：.ssh、.zshrc、Library、.claude/settings.json、.gnupg', async () => {
    for (const p of ['~/.ssh/id_ed25519', '~/.zshrc', '~/Library/x', '~/.claude/settings.json', '~/.claude/settings.local.json', '~/.gnupg/x']) {
      expect(await bad(p, 'env')).toMatch(/拒絕清單/)
    }
  })
  it('.claude 底下非 settings 可以', async () => {
    expect(await ok('~/.claude/foo.env', 'env')).toBe(join(home, '.claude', 'foo.env'))
  })
  it('repoDir 內 → 拒絕', async () => {
    const r = await resolveTarget(home, '~/telecipher/.env', 'env', { repoDir: join(home, 'telecipher') })
    expect(r.ok).toBe(false)
  })
  it('file 模式目標已存在 → 拒絕', async () => {
    expect(await bad('~/proj/exists.txt', 'file')).toMatch(/已存在/)
  })
  it('env 模式目標已存在 → 可以', async () => {
    expect(await ok('~/proj/exists.txt', 'env')).toBe(join(home, 'proj', 'exists.txt'))
  })
  it('空字串 → 拒絕', async () => {
    expect(await bad('')).toMatch(/空/)
  })
})

describe('resolveTarget 大小寫（macOS 檔案系統不分大小寫）', () => {
  it('拒絕清單比對忽略大小寫', async () => {
    for (const p of ['~/.SSH/id', '~/library/x', '~/.Zshrc', '~/.claude/Settings.json']) {
      expect(await bad(p, 'env')).toMatch(/拒絕清單/)
    }
  })
})
