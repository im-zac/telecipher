import { describe, it, expect } from 'vitest'
import { setup, $fetch, fetch } from '@nuxt/test-utils/e2e'
import { mkdtempSync, readFileSync, statSync, writeFileSync, realpathSync, symlinkSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const TOKEN = 'e2e-token'
// realpath：macOS 的 tmpdir 是 /var/… → /private/var/…，resolveTarget 回的是 real 拼法
const home = realpathSync(mkdtempSync(join(tmpdir(), 'tc-e2e-home-')))
// 資料檔導去 tmp：production 就跑在這個 repo 目錄，絕不能動到真的 .requests.json / .vapid.json / 訂閱（會真的推播）
const dataDir = realpathSync(mkdtempSync(join(tmpdir(), 'tc-e2e-data-')))
const env = { NUXT_TELECIPHER_TOKEN: TOKEN, NUXT_TELECIPHER_HOME: home, NUXT_TELECIPHER_DATA_DIR: dataDir }
Object.assign(process.env, env)
// 在 teledeck 的 tmux 裡開的 shell 會繼承 PORT/NITRO_PORT=9876、HOST=0.0.0.0；Nitro 偏好 NITRO_PORT，
// 會蓋掉 test-utils 挑的隨機 port 而撞到 teledeck。測試 server 一律清掉這些。
for (const k of ['PORT', 'NITRO_PORT', 'HOST', 'NITRO_HOST']) delete process.env[k]

await setup({ server: true, browser: false, env })

const H = { 'x-telecipher-token': TOKEN }
const api = <T = any>(path: string, init: any = {}) => $fetch<T>(path, { ...init, headers: { ...H, ...(init.headers ?? {}) } })
const post = (path: string, body: unknown) => fetch(path, { method: 'POST', headers: { ...H, 'content-type': 'application/json' }, body: JSON.stringify(body) })

describe('auth', () => {
  it('無 token → 401', async () => { expect((await fetch('/api/requests')).status).toBe(401) })
  it('header token → 200', async () => { expect((await fetch('/api/requests', { headers: H })).status).toBe(200) })
  it('頁面無 cookie → 302 /login', async () => {
    const res = await fetch('/', { redirect: 'manual' }); expect(res.status).toBe(302)
  })
})

describe('requests flow', () => {
  let id: string
  const target = join(home, 'proj', '.env')

  it('POST 建立 → 201，回應無 value，path 為 resolve 後絕對路徑', async () => {
    const res = await post('/api/requests', { session: 'dev', path: '~/proj/.env', mode: 'env', key: 'OPENAI_API_KEY', description: 'OpenAI' })
    expect(res.status).toBe(201)
    const j = await res.json()
    expect(j.path).toBe(target); expect(j.status).toBe('pending'); expect(JSON.stringify(j)).not.toMatch(/value/)
    id = j.id
  })
  it('POST 不合法路徑 → 400 帶 reason', async () => {
    const res = await post('/api/requests', { session: 'dev', path: '~/.ssh/x', mode: 'file', description: 'd' })
    expect(res.status).toBe(400)
    expect((await res.json()).data.reason).toMatch(/拒絕清單/)
  })
  it('GET 列表含該筆；GET 單筆', async () => {
    const { requests } = await api('/api/requests?status=pending')
    expect(requests.some((r: any) => r.id === id)).toBe(true)
    expect((await api(`/api/requests/${id}`)).session).toBe('dev')
  })
  it('wait 超時 → pending', async () => {
    expect((await api(`/api/requests/${id}/wait?timeout=1`)).status).toBe('pending')
  })
  it('fulfill 空值 → 400', async () => {
    expect((await post(`/api/requests/${id}/fulfill`, { value: '' })).status).toBe(400)
  })
  it('wait 中 fulfill → wait 立刻回 fulfilled；檔案寫入 0600、值原樣（含換行與空白）', async () => {
    const waiting = api(`/api/requests/${id}/wait?timeout=20`)
    await new Promise((r) => setTimeout(r, 100))
    const value = '  sk-abc\n'
    const f = await api(`/api/requests/${id}/fulfill`, { method: 'POST', body: { value } })
    expect(f.status).toBe('fulfilled')
    expect((await waiting).status).toBe('fulfilled')
    expect(readFileSync(target, 'utf8')).toBe('OPENAI_API_KEY="  sk-abc\\n"\n')
    expect(statSync(target).mode & 0o777).toBe(0o600)
    expect(statSync(join(home, 'proj')).mode & 0o777).toBe(0o700)
  })
  it('再 fulfill → 409', async () => {
    expect((await post(`/api/requests/${id}/fulfill`, { value: 'x' })).status).toBe(409)
  })
  it('.requests.json 在 dataDir、0600、內搜不到值', async () => {
    const f = join(dataDir, '.requests.json')
    expect(statSync(f).mode & 0o777).toBe(0o600)
    expect(readFileSync(f, 'utf8')).not.toMatch(/sk-abc/)
  })
  it('DELETE pending → 204 cancelled；404 for unknown', async () => {
    const j = await api('/api/requests', { method: 'POST', body: { session: 'dev', path: '~/proj/key.json', mode: 'file', description: 'd' } })
    expect((await fetch(`/api/requests/${j.id}`, { method: 'DELETE', headers: H })).status).toBe(204)
    expect((await api(`/api/requests/${j.id}`)).status).toBe('cancelled')
    expect((await fetch('/api/requests/nope', { method: 'DELETE', headers: H })).status).toBe(404)
  })
  it('file 模式：登錄時目標已存在 → 400', async () => {
    writeFileSync(join(home, 'proj', 'taken'), 'x')
    const res = await post('/api/requests', { session: 'dev', path: '~/proj/taken', mode: 'file', description: 'd' })
    expect(res.status).toBe(400); expect((await res.json()).data.reason).toMatch(/已存在/)
  })
  it('TOCTOU：登錄後目標被換成 symlink → fulfill 500、維持 pending、不寫穿', async () => {
    const victim = join(home, 'proj', 'victim'); writeFileSync(victim, 'untouched')
    const j = await api('/api/requests', { method: 'POST', body: { session: 'dev', path: '~/proj/late-link', mode: 'file', description: 'd' } })
    symlinkSync(victim, join(home, 'proj', 'late-link'))
    const res = await post(`/api/requests/${j.id}/fulfill`, { value: 'evil' })
    expect(res.status).toBe(500)
    expect(readFileSync(victim, 'utf8')).toBe('untouched')
    expect((await api(`/api/requests/${j.id}`)).status).toBe('pending')
    rmSync(join(home, 'proj', 'late-link'))
  })
  it('clear-done 移除非 pending', async () => {
    const { removed } = await api('/api/requests/clear-done', { method: 'POST' })
    expect(removed).toBeGreaterThanOrEqual(2)
    expect((await api('/api/requests?status=done')).requests).toEqual([])
  })
})
