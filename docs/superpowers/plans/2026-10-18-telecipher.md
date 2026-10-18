# telecipher 實作計畫

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 做出 telecipher web app（Nuxt 4）＋ `telecipher` skill plugin，讓其他 Claude Code session 登錄 secret 需求、Zac 收 Web Push、在頁面填值、值直接寫進目標檔、session 收到完成。

**Architecture:** Nuxt 4 flat layout、`ssr: false`、Nitro `node-server`，server 綁 `127.0.0.1:9877`，Tailscale Serve `:8444` 對外。server lib 為純函式＋檔案持久化（`.requests.json` 只存 metadata），API 薄包。Web Push 照 teledeck 搬。skill 是 zac-skills 的新 plugin，附 `request.sh` 包掉 curl 與 long-poll。

**Tech Stack:** Nuxt ^4、Vue 3、Nitro、web-push、Vitest ^4、@nuxt/test-utils、bun（只當 package manager）、Node 26、launchd、Tailscale Serve。

**Spec:** `docs/superpowers/specs/2026-10-18-telecipher-design.md`

## Global Constraints

- Node runtime；bun 只做 `bun install`／`bun add`；跑 script 用 `bun run <script>`，絕不加 `--bun`。
- Nuxt 4 flat layout：`~` = repo root，沒有 `app/` 目錄，不設 srcDir。
- server 只 listen `127.0.0.1`，port `9877`。
- API 永不回傳 secret 值；任何 `console.*` 不印 request body。
- telecipher 自己的檔案（`.token`、`.vapid.json`、`.push-subscriptions.json`、`.requests.json`、`~/.telecipher/token`）mode 0600；寫檔一律 `.tmp` ＋ `rename`。
- 寫進目標檔 mode 0600；新建父目錄 mode 0700。
- 路徑必須在 `$HOME` 下；目標或任一父層是 symlink 拒絕；拒絕清單見 Task 3。
- `file` 模式不覆蓋既有檔。`env` 模式值一律 `KEY="value"`，跳脫 `\`、`"`，換行寫 `\n`，保留 `export ` 前綴。
- `wait` 的 timeout 1–55 秒，預設 55。
- repo 是 public：repo 內不寫死 `/Users/zac`，deploy 腳本由位置推導。
- commit message 用繁體中文，結尾加 `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>` 與 `Claude-Session: https://claude.ai/code/session_011isrhay5op9wh4NpmsPEuu`。

## Review Focus

1. `path` 傳 `~/x`、相對路徑、或結尾 `/`：應 resolve 到 `$HOME` 下的絕對檔案路徑，或 400 說明原因（Task 3 加測試）。
2. `env` 模式目標檔含 CRLF 或只有註解：upsert 後其他行原樣、不多出空行（Task 4 加測試）。
3. 兩個 waiter 同時等同一個 id，fulfill 後兩個都要醒；server 重啟後 pending 需求仍在列表、再 wait 仍可被 fulfill（Task 6 加測試）。
4. `fulfill` 的 `value` 含換行、前後空白、空字串：空字串 400，其他原樣寫入不 trim（Task 7 加測試）。
5. `request.sh` 在 telecipher 未啟動、token 缺檔、路徑 400 時要有不同 exit code 與清楚訊息，不能卡在 poll（Task 12 加測試）。

---

### Task 1: 專案骨架、authz、auth middleware、登入

**Files:**
- Create: `package.json`、`nuxt.config.ts`、`tsconfig.json`、`app.vue`、`assets/css/main.css`、`pages/index.vue`（暫時空頁）、`pages/login.vue`、`server/utils/authz.ts`、`server/middleware/auth.ts`、`server/api/login.post.ts`、`server/api/health.get.ts`、`test/authz.test.ts`、`CLAUDE.md`
- Modify: `.gitignore`（已有）

**Interfaces:**
- Produces: `isAuthorized(provided: string | undefined, configured: string): boolean`；runtimeConfig `telecipherToken`（env `NUXT_TELECIPHER_TOKEN`）、`telecipherHome`（`NUXT_TELECIPHER_HOME`，預設 `process.env.HOME`）、`telecipherDataDir`（`NUXT_TELECIPHER_DATA_DIR`，空字串 = `process.cwd()`；測試用它把資料檔導去 tmp，避免動到 production 的 store、VAPID、訂閱）；cookie 名 `telecipher_token`；header 名 `x-telecipher-token`。

- [ ] **Step 1: 建 package.json 並安裝**

```json
{
  "name": "telecipher",
  "type": "module",
  "private": true,
  "scripts": {
    "dev": "nuxt dev --host 127.0.0.1 --port 9877",
    "build": "nuxt build",
    "test": "vitest run",
    "setup": "node scripts/setup.mjs",
    "icons": "node scripts/gen-icons.mjs"
  },
  "dependencies": {
    "nuxt": "^4.4.8",
    "vue": "^3.5.38",
    "vue-router": "^5.1.0",
    "web-push": "^3.6.7"
  },
  "devDependencies": {
    "@nuxt/test-utils": "^4.0.3",
    "@resvg/resvg-js": "^2.6.2",
    "@types/web-push": "^3.6.4",
    "happy-dom": "^20.10.6",
    "vitest": "^4.1.9"
  },
  "peerDependencies": { "typescript": "^5" }
}
```

Run: `cd /Users/zac/services/telecipher && bun install`
Expected: 無錯誤，出現 `node_modules/`、`bun.lock`。

- [ ] **Step 2: nuxt.config.ts、tsconfig.json、app.vue、main.css**

`nuxt.config.ts`：
```ts
// Runtime = Node（照 teledeck）。Bun 只當 package manager。
export default defineNuxtConfig({
  ssr: false,
  devtools: { enabled: false },
  nitro: { preset: 'node-server' },
  runtimeConfig: {
    telecipherToken: '',                      // NUXT_TELECIPHER_TOKEN
    telecipherHome: process.env.HOME || '',   // NUXT_TELECIPHER_HOME，pathjail root
    telecipherDataDir: '',                    // NUXT_TELECIPHER_DATA_DIR，.requests.json/.vapid.json/.push-subscriptions.json 所在；空 = process.cwd()
  },
  app: {
    head: {
      title: 'telecipher',
      link: [
        { rel: 'icon', type: 'image/svg+xml', href: '/favicon.svg' },
        { rel: 'apple-touch-icon', sizes: '180x180', href: '/apple-touch-icon.png' },
        { rel: 'manifest', href: '/manifest.webmanifest' },
      ],
      meta: [
        { name: 'viewport', content: 'width=device-width, initial-scale=1, viewport-fit=cover' },
        { name: 'theme-color', content: '#201c1a' },
      ],
    },
  },
  css: ['~/assets/css/main.css'],
})
```

`tsconfig.json`：
```json
{ "extends": "./.nuxt/tsconfig.json" }
```

`app.vue`：
```vue
<template>
  <NuxtPage />
</template>
```

`assets/css/main.css`（ember 配色照 teledeck，但頁面可捲動）：
```css
:root {
  --bg: oklch(0.17 0.012 65);
  --surface: oklch(0.205 0.012 65);
  --surface-2: oklch(0.235 0.013 65);
  --text: oklch(0.92 0.012 75);
  --muted: oklch(0.66 0.012 70);
  --faint: oklch(0.50 0.010 68);
  --hairline: oklch(0.30 0.010 65);
  --ember: oklch(0.78 0.15 65);
  --ember-dim: oklch(0.78 0.15 65 / 0.16);
  --ember-line: oklch(0.78 0.15 65 / 0.45);
  --green: oklch(0.74 0.10 150);
  --danger: oklch(0.74 0.14 25);
  --ui: "Geist", "SF Pro Text", system-ui, sans-serif;
  --mono: "SF Mono", ui-monospace, "Sarasa Mono TC", "PingFang TC", monospace;
}
* { box-sizing: border-box; margin: 0; padding: 0; }
html, body, #__nuxt { min-height: 100%; }
body {
  background: var(--bg); color: var(--text);
  font-family: var(--ui); font-size: 14px; line-height: 1.5;
  -webkit-font-smoothing: antialiased;
  padding: env(safe-area-inset-top) 0 env(safe-area-inset-bottom);
}
a { color: inherit; text-decoration: none; }
button { font: inherit; cursor: pointer; }
input, textarea { font: inherit; color: var(--text); background: var(--surface); border: 1px solid var(--hairline); border-radius: 8px; padding: 9px 12px; }
textarea { font-family: var(--mono); resize: vertical; }
.wrap { max-width: 720px; margin: 0 auto; padding: 20px 16px 48px; }
.brand { font-weight: 600; letter-spacing: .14em; }
.brand b { color: var(--ember); font-weight: 600; }
.card { background: var(--surface); border: 1px solid var(--hairline); border-radius: 12px; padding: 14px 16px; display: block; }
.card + .card { margin-top: 10px; }
.mono { font-family: var(--mono); font-size: 12.5px; word-break: break-all; }
.muted { color: var(--muted); }
.faint { color: var(--faint); font-size: 12px; }
.btn { padding: 9px 14px; border: 1px solid var(--ember-line); border-radius: 8px; background: transparent; color: var(--text); }
.btn.primary { background: var(--ember-dim); }
.btn:disabled { opacity: .5; cursor: default; }
.btn.ghost { border-color: var(--hairline); color: var(--muted); }
.badge { display: inline-block; font-size: 11px; padding: 1px 8px; border-radius: 999px; border: 1px solid var(--hairline); color: var(--muted); }
.badge.pending { color: var(--ember); border-color: var(--ember-line); }
.badge.fulfilled { color: var(--green); }
.badge.cancelled { color: var(--faint); }
.err { color: var(--danger); font-size: 13px; }
.ok { color: var(--green); font-size: 13px; }
h2 { font-size: 13px; letter-spacing: .08em; text-transform: uppercase; color: var(--muted); margin: 22px 0 10px; }
```

- [ ] **Step 3: 寫 authz 失敗測試**

`test/authz.test.ts`：
```ts
import { describe, it, expect } from 'vitest'
import { isAuthorized } from '../server/utils/authz'

describe('isAuthorized', () => {
  it('接受相同 token', () => { expect(isAuthorized('s3cret', 's3cret')).toBe(true) })
  it('拒絕錯誤 token', () => { expect(isAuthorized('nope', 's3cret')).toBe(false) })
  it('拒絕長度不同的 token', () => { expect(isAuthorized('s3cre', 's3cret')).toBe(false) })
  it('未設定 token 時一律拒絕', () => { expect(isAuthorized('anything', '')).toBe(false) })
  it('provided 為 undefined 時拒絕', () => { expect(isAuthorized(undefined, 's3cret')).toBe(false) })
})
```

Run: `bun run test test/authz.test.ts`
Expected: FAIL，找不到模組 `../server/utils/authz`。

- [ ] **Step 4: 實作 authz（timing-safe）**

`server/utils/authz.ts`：
```ts
import { createHash, timingSafeEqual } from 'node:crypto'

/** 常數時間比對：先 sha256 再 timingSafeEqual，避免長度洩漏。 */
export function isAuthorized(provided: string | undefined, configured: string): boolean {
  if (!configured || typeof provided !== 'string') return false
  const a = createHash('sha256').update(provided).digest()
  const b = createHash('sha256').update(configured).digest()
  return timingSafeEqual(a, b)
}
```

Run: `bun run test test/authz.test.ts`
Expected: 5 passed。

- [ ] **Step 5: auth middleware、login API、health API、login 頁、暫時首頁**

`server/middleware/auth.ts`：
```ts
import { isAuthorized } from '../utils/authz'

const PUBLIC_PREFIXES = ['/_nuxt', '/__nuxt', '/favicon', '/apple-touch-icon', '/icon-']
const PUBLIC_EXACT = new Set(['/login', '/api/login', '/sw.js', '/manifest.webmanifest'])

export default defineEventHandler((event) => {
  const path = getRequestURL(event).pathname
  if (PUBLIC_EXACT.has(path) || PUBLIC_PREFIXES.some((p) => path.startsWith(p))) return

  const configured = useRuntimeConfig().telecipherToken
  // skill 從 loopback 用 header；瀏覽器用 cookie。兩者同一把 token。
  const header = getHeader(event, 'x-telecipher-token')
  const cookie = getCookie(event, 'telecipher_token')
  if (isAuthorized(header, configured) || isAuthorized(cookie, configured)) return

  if (path.startsWith('/api')) throw createError({ statusCode: 401, statusMessage: 'unauthorized' })
  return sendRedirect(event, '/login')
})
```

`server/api/login.post.ts`：
```ts
import { isAuthorized } from '../utils/authz'

export default defineEventHandler(async (event) => {
  const body = await readBody<{ token?: string }>(event).catch(() => ({} as { token?: string }))
  if (!isAuthorized(body.token, useRuntimeConfig().telecipherToken)) {
    throw createError({ statusCode: 401, statusMessage: 'invalid token' })
  }
  setCookie(event, 'telecipher_token', body.token!, {
    httpOnly: true, sameSite: 'lax', secure: true, path: '/', maxAge: 60 * 60 * 24 * 365,
  })
  return { ok: true }
})
```

`server/api/health.get.ts`：
```ts
export default defineEventHandler(() => ({ ok: true }))
```

`pages/login.vue`：
```vue
<script setup lang="ts">
const token = ref('')
const error = ref('')
async function submit() {
  error.value = ''
  try {
    await $fetch('/api/login', { method: 'POST', body: { token: token.value } })
    await navigateTo('/')
  } catch { error.value = 'token 不正確' }
}
</script>
<template>
  <main style="display:grid;place-items:center;min-height:100dvh">
    <form @submit.prevent="submit" style="display:flex;flex-direction:column;gap:12px;width:280px">
      <div class="brand">tele<b>cipher</b></div>
      <input v-model="token" type="password" placeholder="access token" autofocus autocomplete="off" />
      <button type="submit" class="btn primary">進入</button>
      <div v-if="error" class="err">{{ error }}</div>
    </form>
  </main>
</template>
```

`pages/index.vue`（暫時）：
```vue
<template>
  <main class="wrap"><div class="brand">tele<b>cipher</b></div></main>
</template>
```

- [ ] **Step 6: 手動驗證 dev server 認證**

Run（終端 1）：`NUXT_TELECIPHER_TOKEN=devtoken bun run dev`
Run（終端 2）：
```bash
curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:9877/api/health            # 401
curl -s -H 'x-telecipher-token: devtoken' http://127.0.0.1:9877/api/health            # {"ok":true}
curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:9877/                       # 302
```
Expected: 依序 `401`、`{"ok":true}`、`302`。停掉 dev server。

- [ ] **Step 7: 寫 CLAUDE.md**

```markdown
# telecipher

個人敏感資料交付站：其他 Claude Code session 登錄「我需要某個 token」，Zac 收 Web Push、在頁面填值，server 直接寫進目標檔。值不經 Claude context。

- 設計：`docs/superpowers/specs/2026-10-18-telecipher-design.md`
- 計畫：`docs/superpowers/plans/`
- 踩雷與根因：`docs/superpowers/notes/`

## 技術棧

Nuxt 4 flat layout（`~` = repo root，無 `app/`）、SPA（`ssr:false`）＋Nitro `node-server`、Vitest。**Node runtime；bun 只當 package manager**（`bun run <script>`，不加 `--bun`）。

## 指令

bun run dev / build / test / setup（產 .token、.vapid.json、~/.telecipher/token）

## 安全邊界（改之前先讀）

- 邊界是 Claude 的對話紀錄，不是檔案系統。API 永不回傳值、log 不印 body、`.requests.json` 只存 metadata。
- server 只綁 127.0.0.1:9877；對外走 Tailscale Serve :8444。
- 所有自家檔案 0600、原子寫。寫目標檔 0600、父目錄 0700。
- 路徑走 `server/lib/pathjail.ts`：$HOME 內、拒 symlink、拒絕清單。file 模式不覆蓋。

## 部署

見 README「部署」。重部署：`bun run build && sudo launchctl kickstart -k system/com.telecipher.server`。

## 慣例

commit message 繁體中文。新功能先 TDD。前端靠 Claude in Chrome 實機驗證。
```

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "feat：Nuxt 骨架、token 認證 middleware 與登入頁

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_011isrhay5op9wh4NpmsPEuu"
```

---

### Task 2: 型別與 ID

**Files:**
- Create: `server/lib/types.ts`、`server/lib/id.ts`、`test/id.test.ts`

**Interfaces:**
- Produces: `RequestStatus`、`WriteMode`、`SecretRequest`（照 spec）；`newId(): string`（12 碼小寫 base32）。

- [ ] **Step 1: 型別**

`server/lib/types.ts`：
```ts
export type RequestStatus = 'pending' | 'fulfilled' | 'cancelled'
export type WriteMode = 'file' | 'env'

export interface SecretRequest {
  id: string
  session: string
  path: string          // resolve 後絕對路徑
  mode: WriteMode
  key?: string
  description: string
  status: RequestStatus
  createdAt: string     // UTC ISO
  fulfilledAt?: string
}
```

- [ ] **Step 2: 失敗測試**

`test/id.test.ts`：
```ts
import { describe, it, expect } from 'vitest'
import { newId } from '../server/lib/id'

describe('newId', () => {
  it('12 碼小寫 base32', () => { expect(newId()).toMatch(/^[a-z2-7]{12}$/) })
  it('不重複', () => {
    const s = new Set(Array.from({ length: 1000 }, newId))
    expect(s.size).toBe(1000)
  })
})
```

Run: `bun run test test/id.test.ts` → FAIL（模組不存在）。

- [ ] **Step 3: 實作**

`server/lib/id.ts`：
```ts
import { randomBytes } from 'node:crypto'

const ALPHABET = 'abcdefghijklmnopqrstuvwxyz234567'

/** 12 碼 base32（60 bits），來自 8 bytes 隨機。 */
export function newId(): string {
  const bytes = randomBytes(8)
  let bits = 0n
  for (const b of bytes) bits = (bits << 8n) | BigInt(b)
  let out = ''
  for (let i = 0; i < 12; i++) {
    out = ALPHABET[Number(bits & 31n)] + out
    bits >>= 5n
  }
  return out
}
```

Run: `bun run test test/id.test.ts` → 2 passed。

- [ ] **Step 4: Commit**

```bash
git add server/lib/types.ts server/lib/id.ts test/id.test.ts
git commit -m "feat：需求型別與 base32 id

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_011isrhay5op9wh4NpmsPEuu"
```

---

### Task 3: pathjail（含拒絕清單與 symlink 檢查）

**Files:**
- Create: `server/lib/pathjail.ts`、`test/pathjail.test.ts`

**Interfaces:**
- Produces:
  ```ts
  type ResolveResult = { ok: true; path: string } | { ok: false; reason: string }
  resolveTarget(home: string, rawPath: string, mode: WriteMode, opts?: { repoDir?: string }): Promise<ResolveResult>
  ```
  `rawPath` 可為絕對、`~/…`、相對（相對於 home）。結尾 `/` 視為目錄 → 拒絕。

- [ ] **Step 1: 失敗測試**

`test/pathjail.test.ts`：
```ts
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
```

Run: `bun run test test/pathjail.test.ts` → FAIL（模組不存在）。

- [ ] **Step 2: 實作**

`server/lib/pathjail.ts`：
```ts
import { resolve, sep, isAbsolute, dirname, relative } from 'node:path'
import { lstat, realpath } from 'node:fs/promises'
import type { WriteMode } from './types'

export type ResolveResult = { ok: true; path: string } | { ok: false; reason: string }

/** 相對 home 的拒絕前綴（目錄或檔案）。比對 resolve 後的路徑。 */
const DENY_PREFIXES = ['.ssh', '.gnupg', 'Library', '.zshrc', '.zprofile', '.zshenv', '.bashrc', '.bash_profile', '.profile']
/** `.claude/settings*`（settings.json、settings.local.json…） */
const DENY_PATTERNS = [/^\.claude\/settings[^/]*$/]

function under(root: string, p: string): boolean {
  return p === root || p.startsWith(root + sep)
}

/**
 * 把 session 給的路徑變成 home 內、無 symlink、可寫的絕對檔案路徑。
 * 不存在的部分允許（之後 secretWriter 會建），但存在的每一層都要是真目錄。
 */
export async function resolveTarget(
  home: string, rawPath: string, mode: WriteMode, opts: { repoDir?: string } = {},
): Promise<ResolveResult> {
  if (!rawPath || !rawPath.trim()) return { ok: false, reason: '路徑為空' }
  if (rawPath.endsWith('/')) return { ok: false, reason: '路徑是目錄，需要檔案路徑' }

  const homeReal = await realpath(home).catch(() => resolve(home))
  let abs: string
  if (rawPath.startsWith('~/')) abs = resolve(homeReal, rawPath.slice(2))
  else if (isAbsolute(rawPath)) abs = resolve(rawPath)
  else abs = resolve(homeReal, rawPath)

  // home 本身可能是 symlink（macOS /var → /private/var）：接受兩種拼法，統一成 real 拼法再往下。
  const homeLogical = resolve(home)
  if (under(homeLogical, abs) && !under(homeReal, abs)) abs = resolve(homeReal, relative(homeLogical, abs))
  if (!under(homeReal, abs)) return { ok: false, reason: '路徑不在 home 底下' }
  if (abs === homeReal) return { ok: false, reason: '路徑是目錄，需要檔案路徑' }

  const rel = relative(homeReal, abs)
  if (DENY_PREFIXES.some((d) => rel === d || rel.startsWith(d + sep))) return { ok: false, reason: `路徑在拒絕清單（${rel.split(sep)[0]}）` }
  if (DENY_PATTERNS.some((re) => re.test(rel))) return { ok: false, reason: '路徑在拒絕清單（.claude/settings*）' }
  if (opts.repoDir) {
    const repoReal = await realpath(opts.repoDir).catch(() => resolve(opts.repoDir!))
    if (under(repoReal, abs)) return { ok: false, reason: '路徑在拒絕清單（telecipher 自己的目錄）' }
  }

  // 由 home 往下逐層檢查：存在的每一層都不能是 symlink；目標存在時依 mode 決定。
  const parts = relative(homeReal, abs).split(sep)
  let cur = homeReal
  for (let i = 0; i < parts.length; i++) {
    cur = resolve(cur, parts[i]!)
    const st = await lstat(cur).catch((e: any) => (e?.code === 'ENOENT' ? null : Promise.reject(e)))
    if (!st) break                                   // 之後都不存在，交給 writer 建
    if (st.isSymbolicLink()) return { ok: false, reason: `路徑含 symlink（${cur}）` }
    const isLast = i === parts.length - 1
    if (!isLast && !st.isDirectory()) return { ok: false, reason: `父層不是目錄（${cur}）` }
    if (isLast) {
      if (st.isDirectory()) return { ok: false, reason: '路徑是目錄，需要檔案路徑' }
      if (mode === 'file') return { ok: false, reason: '目標檔已存在（file 模式不覆蓋）' }
    }
  }
  return { ok: true, path: abs }
}

/** 給 secretWriter 用：目標的父目錄。 */
export function parentDir(p: string): string { return dirname(p) }
```

Run: `bun run test test/pathjail.test.ts` → 全部 passed。若 `.. 逃逸` 測試拿到的 reason 不含「home」，檢查 `resolve` 是否已收掉 `..`（會），應回「不在 home 底下」。

- [ ] **Step 3: Commit**

```bash
git add server/lib/pathjail.ts test/pathjail.test.ts
git commit -m "feat：pathjail，home 內、拒 symlink、拒絕清單、file 模式不覆蓋

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_011isrhay5op9wh4NpmsPEuu"
```

---

### Task 4: envfile.upsertEnvLine

**Files:**
- Create: `server/lib/envfile.ts`、`test/envfile.test.ts`

**Interfaces:**
- Produces: `upsertEnvLine(content: string, key: string, value: string): string`；`isValidEnvKey(key: string): boolean`（`^[A-Za-z_][A-Za-z0-9_]*$`）。

- [ ] **Step 1: 失敗測試**

`test/envfile.test.ts`：
```ts
import { describe, it, expect } from 'vitest'
import { upsertEnvLine, isValidEnvKey } from '../server/lib/envfile'

describe('upsertEnvLine', () => {
  it('空檔 → 一行', () => {
    expect(upsertEnvLine('', 'A', 'x')).toBe('A="x"\n')
  })
  it('append 到檔尾，保留其他行', () => {
    expect(upsertEnvLine('# c\nB=1\n', 'A', 'x')).toBe('# c\nB=1\nA="x"\n')
  })
  it('檔尾無換行先補', () => {
    expect(upsertEnvLine('B=1', 'A', 'x')).toBe('B=1\nA="x"\n')
  })
  it('覆蓋既有 key，位置不變', () => {
    expect(upsertEnvLine('A=old\nB=1\n', 'A', 'new')).toBe('A="new"\nB=1\n')
  })
  it('保留 export 前綴', () => {
    expect(upsertEnvLine('export A=old\n', 'A', 'new')).toBe('export A="new"\n')
  })
  it('key 前後空白的既有行也算同一 key', () => {
    expect(upsertEnvLine('  A = old\n', 'A', 'new')).toBe('A="new"\n')
  })
  it('不誤中前綴相同的 key', () => {
    expect(upsertEnvLine('AB=1\n', 'A', 'x')).toBe('AB=1\nA="x"\n')
  })
  it('跳脫 " 與 \\，換行寫成 \\n', () => {
    expect(upsertEnvLine('', 'A', 'a"b\\c\nd')).toBe('A="a\\"b\\\\c\\nd"\n')
  })
  it('CRLF 檔：其他行原樣，新行用 LF', () => {
    expect(upsertEnvLine('B=1\r\n', 'A', 'x')).toBe('B=1\r\nA="x"\n')
  })
  it('只有註解的檔', () => {
    expect(upsertEnvLine('# only\n', 'A', 'x')).toBe('# only\nA="x"\n')
  })
  it('同 key 出現多次只改第一個，其餘刪除', () => {
    expect(upsertEnvLine('A=1\nB=2\nA=3\n', 'A', 'x')).toBe('A="x"\nB=2\n')
  })
})

describe('isValidEnvKey', () => {
  it.each(['A', 'a_b', '_X1', 'OPENAI_API_KEY'])('接受 %s', (k) => expect(isValidEnvKey(k)).toBe(true))
  it.each(['', '1A', 'A-B', 'A B', 'A=', 'é'])('拒絕 %j', (k) => expect(isValidEnvKey(k)).toBe(false))
})
```

Run: `bun run test test/envfile.test.ts` → FAIL。

- [ ] **Step 2: 實作**

`server/lib/envfile.ts`：
```ts
const KEY_RE = /^[A-Za-z_][A-Za-z0-9_]*$/

export function isValidEnvKey(key: string): boolean { return KEY_RE.test(key) }

function quote(value: string): string {
  return '"' + value.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\r?\n/g, '\\n') + '"'
}

/**
 * 在 env 檔內 upsert 一行 `KEY="value"`。
 * 其他行（含註解、空行、CRLF）原樣；既有同名 key 替換第一個、刪掉其餘；保留 `export `。
 */
export function upsertEnvLine(content: string, key: string, value: string): string {
  const lineRe = new RegExp('^\\s*(export\\s+)?' + key + '\\s*=')
  const lines = content.split('\n')
  if (lines[lines.length - 1] === '') lines.pop()   // 檔尾有換行 → 去掉空尾元素；最後統一補 LF
  let replaced = false
  const out: string[] = []
  for (const line of lines) {
    if (lineRe.test(line.replace(/\r$/, ''))) {
      if (replaced) continue
      const exp = /^\s*export\s+/.test(line) ? 'export ' : ''
      out.push(`${exp}${key}=${quote(value)}`)
      replaced = true
    } else out.push(line)
  }
  if (!replaced) out.push(`${key}=${quote(value)}`)
  return out.join('\n') + '\n'
}
```

Run: `bun run test test/envfile.test.ts` → 全部 passed。

- [ ] **Step 3: Commit**

```bash
git add server/lib/envfile.ts test/envfile.test.ts
git commit -m "feat：env 檔單一 key upsert 純函式

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_011isrhay5op9wh4NpmsPEuu"
```

---

### Task 5: secretWriter（0600、原子、父目錄 0700）

**Files:**
- Create: `server/lib/secretWriter.ts`、`test/secret-writer.test.ts`

**Interfaces:**
- Consumes: `upsertEnvLine`。
- Produces: `writeSecretFile(path: string, value: string): Promise<void>`（已存在 throw `EEXIST`）；`writeSecretEnvKey(path: string, key: string, value: string): Promise<void>`；`atomicWrite(path: string, data: string, mode?: number): Promise<void>`（匯出給 store 共用）。

- [ ] **Step 1: 失敗測試**

`test/secret-writer.test.ts`：
```ts
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
```

Run: `bun run test test/secret-writer.test.ts` → FAIL。

- [ ] **Step 2: 實作**

`server/lib/secretWriter.ts`：
```ts
import { mkdir, open, rename, readFile, chmod, lstat, unlink } from 'node:fs/promises'
import { dirname } from 'node:path'
import { upsertEnvLine } from './envfile'

/** `.tmp` 寫完 rename。tmp 以 0600 建立；父目錄不存在就 0700 建。 */
export async function atomicWrite(path: string, data: string, mode = 0o600): Promise<void> {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 })
  const tmp = path + '.tmp'
  const fh = await open(tmp, 'w', mode)
  try {
    await fh.writeFile(data, 'utf8')
    await fh.sync()
  } finally { await fh.close() }
  try { await rename(tmp, path) } catch (e) { await unlink(tmp).catch(() => {}); throw e }
  await chmod(path, mode)   // rename 不改既有檔的 mode，這裡保證 0600
}

/** file 模式：整檔寫入。目標已存在 → throw { code: 'EEXIST' }。 */
export async function writeSecretFile(path: string, value: string): Promise<void> {
  const st = await lstat(path).catch((e: any) => (e?.code === 'ENOENT' ? null : Promise.reject(e)))
  if (st) { const err: any = new Error('目標檔已存在'); err.code = 'EEXIST'; throw err }
  await atomicWrite(path, value)
}

/** env 模式：讀現有內容（無檔視為空）→ upsert → 原子寫回。 */
export async function writeSecretEnvKey(path: string, key: string, value: string): Promise<void> {
  const current = await readFile(path, 'utf8').catch((e: any) => (e?.code === 'ENOENT' ? '' : Promise.reject(e)))
  await atomicWrite(path, upsertEnvLine(current, key, value))
}
```

Run: `bun run test test/secret-writer.test.ts` → 全部 passed。`mkdir` 的 `mode` 受 umask 影響，若 0700 測試失敗，在 `mkdir` 後對每一層新建目錄 `chmod 0o700`：改成逐層 `mkdir` 並 `chmod`。

- [ ] **Step 3: Commit**

```bash
git add server/lib/secretWriter.ts test/secret-writer.test.ts
git commit -m "feat：secretWriter，0600 原子寫、父目錄 0700、file 不覆蓋

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_011isrhay5op9wh4NpmsPEuu"
```

---

### Task 6: requestStore（持久化＋waitFor）

**Files:**
- Create: `server/lib/requestStore.ts`、`test/request-store.test.ts`

**Interfaces:**
- Consumes: `SecretRequest`、`newId`、`atomicWrite`。
- Produces:
  ```ts
  configure(filePath: string): void
  load(): void
  list(filter?: 'pending' | 'done'): SecretRequest[]           // 新到舊
  get(id: string): SecretRequest | undefined
  add(input: { session: string; path: string; mode: WriteMode; key?: string; description: string }): Promise<SecretRequest>
  markFulfilled(id: string): Promise<SecretRequest>          // 非 pending throw { code: 'CONFLICT' }
  cancel(id: string): Promise<SecretRequest>                 // 非 pending 原樣回
  clearDone(): Promise<number>
  waitFor(id: string, timeoutMs: number): Promise<SecretRequest | undefined>
  __reset(): void
  ```

- [ ] **Step 1: 失敗測試**

`test/request-store.test.ts`：
```ts
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
```

Run: `bun run test test/request-store.test.ts` → FAIL。

- [ ] **Step 2: 實作**

`server/lib/requestStore.ts`：
```ts
import { readFileSync } from 'node:fs'
import type { SecretRequest, WriteMode } from './types'
import { newId } from './id'
import { atomicWrite } from './secretWriter'

let filePath = '.requests.json'          // repo 根 = server cwd
let items: SecretRequest[] = []          // 舊到新
const waiters = new Map<string, Set<(r: SecretRequest) => void>>()

export function configure(path: string): void { filePath = path }

/** 啟動時載入；不存在 → 空；毀損 → 空＋warn，不覆寫。 */
export function load(): void {
  items = []
  try {
    const o = JSON.parse(readFileSync(filePath, 'utf8'))
    if (Array.isArray(o?.requests)) items = o.requests.filter((r: any) => r && typeof r.id === 'string')
  } catch (e: any) {
    if (e?.code !== 'ENOENT') console.warn('[store] .requests.json 讀取失敗，視為空清單：', e?.message)
  }
}

async function persist(): Promise<void> {
  await atomicWrite(filePath, JSON.stringify({ requests: items }, null, 2) + '\n', 0o600)
}

export function list(filter?: 'pending' | 'done'): SecretRequest[] {
  const all = [...items].reverse()
  if (filter === 'pending') return all.filter((r) => r.status === 'pending')
  if (filter === 'done') return all.filter((r) => r.status !== 'pending')
  return all
}

export function get(id: string): SecretRequest | undefined { return items.find((r) => r.id === id) }

export async function add(input: { session: string; path: string; mode: WriteMode; key?: string; description: string }): Promise<SecretRequest> {
  const r: SecretRequest = {
    id: newId(), session: input.session, path: input.path, mode: input.mode,
    ...(input.key ? { key: input.key } : {}),
    description: input.description, status: 'pending', createdAt: new Date().toISOString(),
  }
  items.push(r)
  await persist()
  return r
}

function err(code: string, msg: string): Error { const e: any = new Error(msg); e.code = code; return e }

function wake(r: SecretRequest): void {
  const set = waiters.get(r.id)
  if (!set) return
  waiters.delete(r.id)
  for (const fn of set) fn(r)
}

export async function markFulfilled(id: string): Promise<SecretRequest> {
  const r = get(id)
  if (!r) throw err('NOT_FOUND', '需求不存在')
  if (r.status !== 'pending') throw err('CONFLICT', '需求已處理')
  r.status = 'fulfilled'; r.fulfilledAt = new Date().toISOString()
  await persist()
  wake(r)
  return r
}

export async function cancel(id: string): Promise<SecretRequest> {
  const r = get(id)
  if (!r) throw err('NOT_FOUND', '需求不存在')
  if (r.status !== 'pending') return r
  r.status = 'cancelled'; r.fulfilledAt = new Date().toISOString()
  await persist()
  wake(r)
  return r
}

export async function clearDone(): Promise<number> {
  const before = items.length
  items = items.filter((r) => r.status === 'pending')
  const removed = before - items.length
  if (removed) await persist()
  return removed
}

/** 狀態已非 pending 立即回；否則掛起直到 fulfill/cancel 或超時（回當下狀態）。 */
export function waitFor(id: string, timeoutMs: number): Promise<SecretRequest | undefined> {
  const r = get(id)
  if (!r) return Promise.resolve(undefined)
  if (r.status !== 'pending') return Promise.resolve(r)
  return new Promise((resolve) => {
    const set = waiters.get(id) ?? new Set()
    waiters.set(id, set)
    const timer = setTimeout(() => { set.delete(fn); if (!set.size) waiters.delete(id); resolve(get(id)) }, timeoutMs)
    const fn = (done: SecretRequest) => { clearTimeout(timer); resolve(done) }
    set.add(fn)
  })
}

/** 測試用。 */
export function __reset(): void { items = []; waiters.clear(); filePath = '.requests.json' }
```

Run: `bun run test test/request-store.test.ts` → 全部 passed。

- [ ] **Step 3: Commit**

```bash
git add server/lib/requestStore.ts test/request-store.test.ts
git commit -m "feat：requestStore，metadata 持久化與 long-poll 喚醒

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_011isrhay5op9wh4NpmsPEuu"
```

---

### Task 7: 需求 API（建立、列表、單筆、wait、cancel、fulfill、clear-done）＋ boot plugin

**Files:**
- Create: `server/lib/validate.ts`、`server/lib/dataDir.ts`、`server/plugins/boot.ts`、`server/api/requests/index.get.ts`、`server/api/requests/index.post.ts`、`server/api/requests/[id].get.ts`、`server/api/requests/[id].delete.ts`、`server/api/requests/[id]/wait.get.ts`、`server/api/requests/[id]/fulfill.post.ts`、`server/api/requests/clear-done.post.ts`、`server/lib/notify.ts`（本 task 先留空殼，Task 8 填）、`test/validate.test.ts`、`test/api.e2e.test.ts`

**Interfaces:**
- Consumes: `resolveTarget`、store 全部、`writeSecretFile`、`writeSecretEnvKey`、`isValidEnvKey`。
- Produces: `validateCreate(body: unknown): { ok: true; value: CreateInput } | { ok: false; reason: string }`；`CreateInput = { session: string; path: string; mode: WriteMode; key?: string; description: string }`；`notifyNewRequest(r: SecretRequest): Promise<void>`（Task 8 實作，本 task 是 no-op）。

- [ ] **Step 1: validate 失敗測試**

`test/validate.test.ts`：
```ts
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
```

Run: `bun run test test/validate.test.ts` → FAIL。

- [ ] **Step 2: 實作 validate**

`server/lib/validate.ts`：
```ts
import type { WriteMode } from './types'
import { isValidEnvKey } from './envfile'

export interface CreateInput { session: string; path: string; mode: WriteMode; key?: string; description: string }
export type ValidateResult = { ok: true; value: CreateInput } | { ok: false; reason: string }

export function validateCreate(body: unknown): ValidateResult {
  if (!body || typeof body !== 'object') return { ok: false, reason: 'body 必須是 JSON 物件' }
  const b = body as Record<string, unknown>
  const session = typeof b.session === 'string' ? b.session.trim() : ''
  if (!session || session.length > 80) return { ok: false, reason: 'session 需為 1–80 字' }
  const description = typeof b.description === 'string' ? b.description.trim() : ''
  if (!description || description.length > 500) return { ok: false, reason: 'description 需為 1–500 字' }
  if (typeof b.path !== 'string') return { ok: false, reason: 'path 需為字串' }
  if (b.mode !== 'file' && b.mode !== 'env') return { ok: false, reason: 'mode 需為 file 或 env' }
  const value: CreateInput = { session, path: b.path, mode: b.mode, description }
  if (b.mode === 'env') {
    if (typeof b.key !== 'string' || !isValidEnvKey(b.key)) return { ok: false, reason: 'env 模式的 key 需符合 ^[A-Za-z_][A-Za-z0-9_]*$' }
    value.key = b.key
  }
  return { ok: true, value }
}
```

Run: `bun run test test/validate.test.ts` → 全部 passed。

- [ ] **Step 3: boot plugin、notify 空殼、API handlers**

`server/lib/notify.ts`（Task 8 會換成真的）：
```ts
import type { SecretRequest } from './types'
export async function notifyNewRequest(_r: SecretRequest): Promise<void> { /* Task 8 */ }
```

`server/lib/dataDir.ts`：
```ts
import { join } from 'node:path'
/** 資料檔目錄：runtimeConfig.telecipherDataDir，空 = server cwd（repo 根）。 */
export function dataDir(): string { return useRuntimeConfig().telecipherDataDir || process.cwd() }
export function dataFile(name: string): string { return join(dataDir(), name) }
```

`server/plugins/boot.ts`：
```ts
import { configure as configureRequests, load as loadRequests } from '../lib/requestStore'
import { dataFile } from '../lib/dataDir'

export default defineNitroPlugin(() => {
  configureRequests(dataFile('.requests.json'))
  loadRequests()
})
```

`server/api/requests/index.get.ts`：
```ts
import { list } from '../../lib/requestStore'

export default defineEventHandler((event) => {
  const q = getQuery(event)
  const status = q.status === 'pending' || q.status === 'done' ? q.status : undefined
  return { requests: list(status) }
})
```

`server/api/requests/index.post.ts`：
```ts
import { validateCreate } from '../../lib/validate'
import { resolveTarget } from '../../lib/pathjail'
import { add } from '../../lib/requestStore'
import { notifyNewRequest } from '../../lib/notify'

export default defineEventHandler(async (event) => {
  const body = await readBody(event).catch(() => null)
  const v = validateCreate(body)
  if (!v.ok) throw createError({ statusCode: 400, statusMessage: 'invalid request', data: { error: 'invalid', reason: v.reason } })
  const home = useRuntimeConfig().telecipherHome
  const resolved = await resolveTarget(home, v.value.path, v.value.mode, { repoDir: process.cwd() })
  if (!resolved.ok) throw createError({ statusCode: 400, statusMessage: 'invalid path', data: { error: 'path', reason: resolved.reason } })
  const r = await add({ ...v.value, path: resolved.path })
  void notifyNewRequest(r).catch((e) => console.warn('[notify] 失敗', e?.message))
  setResponseStatus(event, 201)
  return { id: r.id, path: r.path, mode: r.mode, ...(r.key ? { key: r.key } : {}), status: r.status }
})
```

`server/api/requests/[id].get.ts`：
```ts
import { get } from '../../lib/requestStore'

export default defineEventHandler((event) => {
  const r = get(getRouterParam(event, 'id') ?? '')
  if (!r) throw createError({ statusCode: 404, statusMessage: 'not found' })
  return r
})
```

`server/api/requests/[id].delete.ts`：
```ts
import { cancel } from '../../lib/requestStore'

export default defineEventHandler(async (event) => {
  try { await cancel(getRouterParam(event, 'id') ?? '') }
  catch (e: any) { if (e?.code === 'NOT_FOUND') throw createError({ statusCode: 404, statusMessage: 'not found' }); throw e }
  setResponseStatus(event, 204)
  return null
})
```

`server/api/requests/[id]/wait.get.ts`：
```ts
import { waitFor } from '../../../lib/requestStore'

export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id') ?? ''
  const raw = Number(getQuery(event).timeout ?? 55)
  const sec = Number.isFinite(raw) ? Math.min(55, Math.max(1, Math.floor(raw))) : 55
  const r = await waitFor(id, sec * 1000)
  if (!r) throw createError({ statusCode: 404, statusMessage: 'not found' })
  return { id: r.id, status: r.status, ...(r.fulfilledAt ? { fulfilledAt: r.fulfilledAt } : {}) }
})
```

`server/api/requests/[id]/fulfill.post.ts`：
```ts
import { get, markFulfilled } from '../../../lib/requestStore'
import { writeSecretFile, writeSecretEnvKey } from '../../../lib/secretWriter'

export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id') ?? ''
  const r = get(id)
  if (!r) throw createError({ statusCode: 404, statusMessage: 'not found' })
  if (r.status !== 'pending') throw createError({ statusCode: 409, statusMessage: 'already processed' })
  const body = await readBody<{ value?: unknown }>(event).catch(() => ({} as { value?: unknown }))
  const value = body.value
  if (typeof value !== 'string' || value.length === 0) throw createError({ statusCode: 400, statusMessage: 'value required' })
  try {
    if (r.mode === 'env') await writeSecretEnvKey(r.path, r.key!, value)
    else await writeSecretFile(r.path, value)
  } catch (e: any) {
    // 只 log 路徑與錯誤碼，絕不 log body
    console.warn('[fulfill] 寫檔失敗', r.path, e?.code ?? e?.message)
    throw createError({ statusCode: 500, statusMessage: 'write failed', data: { reason: e?.code === 'EEXIST' ? '目標檔已存在（file 模式不覆蓋）' : `寫檔失敗：${e?.code ?? 'unknown'}` } })
  }
  const done = await markFulfilled(id)
  return { id: done.id, status: done.status, fulfilledAt: done.fulfilledAt }
})
```

`server/api/requests/clear-done.post.ts`：
```ts
import { clearDone } from '../../lib/requestStore'

export default defineEventHandler(async () => ({ removed: await clearDone() }))
```

- [ ] **Step 4: e2e 測試（@nuxt/test-utils 起真 server）**

`test/api.e2e.test.ts`：
```ts
import { describe, it, expect, beforeAll } from 'vitest'
import { setup, $fetch, fetch } from '@nuxt/test-utils/e2e'
import { mkdtempSync, readFileSync, statSync, writeFileSync, realpathSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const TOKEN = 'e2e-token'
// realpath：macOS 的 tmpdir 是 /var/… → /private/var/…，resolveTarget 回的是 real 拼法
const home = realpathSync(mkdtempSync(join(tmpdir(), 'tc-e2e-home-')))
// 資料檔導去 tmp：production 就跑在這個 repo 目錄，絕不能動到真的 .requests.json / .vapid.json / 訂閱（會真的推播）
const dataDir = realpathSync(mkdtempSync(join(tmpdir(), 'tc-e2e-data-')))
const env = { NUXT_TELECIPHER_TOKEN: TOKEN, NUXT_TELECIPHER_HOME: home, NUXT_TELECIPHER_DATA_DIR: dataDir }
Object.assign(process.env, env)

await setup({ server: true, browser: false, env })

const H = { 'x-telecipher-token': TOKEN }
const api = <T = any>(path: string, init: any = {}) => $fetch<T>(path, { ...init, headers: { ...H, ...(init.headers ?? {}) } })

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
    const res = await fetch('/api/requests', { method: 'POST', headers: { ...H, 'content-type': 'application/json' },
      body: JSON.stringify({ session: 'dev', path: '~/proj/.env', mode: 'env', key: 'OPENAI_API_KEY', description: 'OpenAI' }) })
    expect(res.status).toBe(201)
    const j = await res.json()
    expect(j.path).toBe(target); expect(j.status).toBe('pending'); expect(JSON.stringify(j)).not.toMatch(/value/)
    id = j.id
  })
  it('POST 不合法路徑 → 400 帶 reason', async () => {
    const res = await fetch('/api/requests', { method: 'POST', headers: { ...H, 'content-type': 'application/json' },
      body: JSON.stringify({ session: 'dev', path: '~/.ssh/x', mode: 'file', description: 'd' }) })
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
    const res = await fetch(`/api/requests/${id}/fulfill`, { method: 'POST', headers: { ...H, 'content-type': 'application/json' }, body: JSON.stringify({ value: '' }) })
    expect(res.status).toBe(400)
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
    const res = await fetch(`/api/requests/${id}/fulfill`, { method: 'POST', headers: { ...H, 'content-type': 'application/json' }, body: JSON.stringify({ value: 'x' }) })
    expect(res.status).toBe(409)
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
    const res = await fetch('/api/requests', { method: 'POST', headers: { ...H, 'content-type': 'application/json' },
      body: JSON.stringify({ session: 'dev', path: '~/proj/taken', mode: 'file', description: 'd' }) })
    expect(res.status).toBe(400); expect((await res.json()).data.reason).toMatch(/已存在/)
  })
  it('clear-done 移除非 pending', async () => {
    const { removed } = await api('/api/requests/clear-done', { method: 'POST' })
    expect(removed).toBeGreaterThanOrEqual(2)
    expect((await api('/api/requests?status=done')).requests).toEqual([])
  })
})
```

Run: `bun run test test/api.e2e.test.ts`
Expected: 全部 passed（第一次會 build nuxt，約 30–60 秒）。若 `NUXT_TELECIPHER_HOME` 沒生效，確認 `nuxt.config.ts` 的 `runtimeConfig.telecipherHome` 鍵名（Nuxt 以 `NUXT_` ＋ 大寫蛇形覆寫）。

- [ ] **Step 5: 全部測試**

Run: `bun run test` → 全部 passed。

- [ ] **Step 6: Commit**

```bash
git add server test
git commit -m "feat：需求 API（建立、列表、wait、fulfill、cancel、clear-done）與 e2e 測試

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_011isrhay5op9wh4NpmsPEuu"
```

---

### Task 8: Web Push（server 端＋sw.js＋client plugin＋usePush）

**Files:**
- Create: `server/lib/vapid.ts`、`server/lib/pushStore.ts`、`server/lib/pushNotify.ts`、`server/api/push/vapid-public-key.get.ts`、`server/api/push/subscribe.post.ts`、`server/api/push/unsubscribe.post.ts`、`public/sw.js`、`plugins/push.client.ts`、`composables/usePush.ts`、`test/push-store.test.ts`、`test/push-notify.test.ts`
- Modify: `server/lib/notify.ts`、`server/plugins/boot.ts`

**Interfaces:**
- Produces: `buildNotification(r: SecretRequest): { title: string; body: string; tag: string; url: string }`；`startPush(): void`；`sendToAll(payload): Promise<void>`；`notifyNewRequest(r)` 變成真的送 push。SW 訊息：`{ type: 'openRequest', id }`。

- [ ] **Step 1: pushStore 與 pushNotify 失敗測試**

`test/push-store.test.ts`（照 teledeck，改檔名與 0600）：
```ts
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
```

`test/push-notify.test.ts`：
```ts
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
```

Run: `bun run test test/push-store.test.ts test/push-notify.test.ts` → FAIL。

- [ ] **Step 2: 實作 server 端**

`server/lib/vapid.ts`：
```ts
import { readFileSync } from 'node:fs'
export interface VapidKeys { publicKey: string; privateKey: string }
let cache: VapidKeys | null | undefined
export function readVapid(path: string): VapidKeys | null {
  try {
    const o = JSON.parse(readFileSync(path, 'utf8'))
    return typeof o?.publicKey === 'string' && typeof o?.privateKey === 'string' ? { publicKey: o.publicKey, privateKey: o.privateKey } : null
  } catch { return null }
}
export function loadVapid(path = '.vapid.json'): VapidKeys | null { if (cache === undefined) cache = readVapid(path); return cache }
export function __resetVapid(): void { cache = undefined }
```

`server/lib/pushStore.ts`：
```ts
import { readFileSync } from 'node:fs'
import { atomicWrite } from './secretWriter'

export interface PushSub { endpoint: string; keys: { p256dh: string; auth: string }; [k: string]: unknown }
let subs = new Map<string, PushSub>()
let filePath = '.push-subscriptions.json'
export function configure(path: string): void { filePath = path }
export function load(): void {
  subs = new Map()
  try {
    const arr = JSON.parse(readFileSync(filePath, 'utf8'))
    if (Array.isArray(arr)) for (const s of arr) if (s?.endpoint) subs.set(s.endpoint, s)
  } catch (e: any) { if (e?.code !== 'ENOENT') console.warn('[push] 訂閱檔讀取失敗，視為空清單：', e?.message) }
}
export function all(): PushSub[] { return [...subs.values()] }
export async function add(sub: PushSub): Promise<void> { if (!sub?.endpoint) return; subs.set(sub.endpoint, sub); await persist() }
export async function removeByEndpoint(endpoint: string): Promise<void> { if (subs.delete(endpoint)) await persist() }
async function persist(): Promise<void> { await atomicWrite(filePath, JSON.stringify([...subs.values()], null, 2) + '\n', 0o600) }
export function __reset(): void { subs = new Map(); filePath = '.push-subscriptions.json' }
```

`server/lib/pushNotify.ts`：
```ts
import webpush from 'web-push'
import { basename } from 'node:path'
import type { SecretRequest } from './types'
import { loadVapid } from './vapid'
import { all, removeByEndpoint, type PushSub } from './pushStore'

export interface NotifyPayload { title: string; body: string; tag: string; url: string; id: string }

export function buildNotification(r: SecretRequest): { title: string; body: string; tag: string; url: string } {
  const what = r.mode === 'env' && r.key ? r.key : basename(r.path)
  return { title: `🔑 ${r.session} · 需要 ${what}`, body: r.description, tag: `telecipher-${r.id}`, url: `/requests/${r.id}` }
}

export function shouldPrune(statusCode?: number): boolean { return statusCode === 404 || statusCode === 410 }

let ready = false
/** 啟動時呼叫：設 VAPID；缺檔 → 推播停用，不 throw。 */
export function startPush(vapidPath: string): void {
  const keys = loadVapid(vapidPath)
  if (!keys) { console.warn('[push] 找不到 .vapid.json，推播停用（執行 bun run setup）'); return }
  try { webpush.setVapidDetails('mailto:telecipher@localhost', keys.publicKey, keys.privateKey); ready = true }
  catch (e: any) { console.warn('[push] VAPID 金鑰無效，推播停用', e?.message) }
}

async function sendOne(sub: PushSub, payload: NotifyPayload): Promise<void> {
  try { await webpush.sendNotification(sub as any, JSON.stringify(payload)) }
  catch (e: any) {
    if (shouldPrune(e?.statusCode)) await removeByEndpoint(sub.endpoint)
    else console.warn('[push] 送出失敗', e?.statusCode ?? e?.message)
  }
}

export async function sendToAll(payload: NotifyPayload): Promise<void> {
  if (!ready) return
  await Promise.all(all().map((s) => sendOne(s, payload)))
}
```

`server/lib/notify.ts`（取代空殼）：
```ts
import type { SecretRequest } from './types'
import { buildNotification, sendToAll } from './pushNotify'

export async function notifyNewRequest(r: SecretRequest): Promise<void> {
  await sendToAll({ ...buildNotification(r), id: r.id })
}
```

`server/plugins/boot.ts`：
```ts
import { configure as configureRequests, load as loadRequests } from '../lib/requestStore'
import { configure as configureSubs, load as loadSubs } from '../lib/pushStore'
import { startPush } from '../lib/pushNotify'
import { dataFile } from '../lib/dataDir'

export default defineNitroPlugin(() => {
  configureRequests(dataFile('.requests.json'))
  loadRequests()
  configureSubs(dataFile('.push-subscriptions.json'))
  loadSubs()
  startPush(dataFile('.vapid.json'))
})
```

`startPush` 簽名改為 `startPush(vapidPath: string): void`，內部 `loadVapid(vapidPath)`。

`server/api/push/vapid-public-key.get.ts`：
```ts
import { loadVapid } from '../../lib/vapid'
import { dataFile } from '../../lib/dataDir'
export default defineEventHandler(() => ({ key: loadVapid(dataFile('.vapid.json'))?.publicKey ?? null }))
```

`server/api/push/subscribe.post.ts`：
```ts
import { add, type PushSub } from '../../lib/pushStore'
export default defineEventHandler(async (event) => {
  const body = await readBody(event).catch(() => null) as PushSub | null
  if (!body?.endpoint || !body?.keys?.p256dh || !body?.keys?.auth) throw createError({ statusCode: 400, statusMessage: 'invalid subscription' })
  await add(body)
  setResponseStatus(event, 204); return null
})
```

`server/api/push/unsubscribe.post.ts`：
```ts
import { removeByEndpoint } from '../../lib/pushStore'
export default defineEventHandler(async (event) => {
  const body = await readBody(event).catch(() => null) as { endpoint?: string } | null
  if (!body?.endpoint) throw createError({ statusCode: 400, statusMessage: 'missing endpoint' })
  await removeByEndpoint(body.endpoint)
  setResponseStatus(event, 204); return null
})
```

Run: `bun run test test/push-store.test.ts test/push-notify.test.ts` → 全部 passed。

- [ ] **Step 3: sw.js、client plugin、usePush**

`public/sw.js`：
```js
// telecipher service worker：只做 Web Push，不攔截 fetch。新版立即接管。
self.addEventListener('install', () => self.skipWaiting())
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()))

self.addEventListener('push', (event) => {
  let p = {}
  try { p = event.data ? event.data.json() : {} } catch { p = {} }
  event.waitUntil(self.registration.showNotification(p.title || 'telecipher', {
    body: p.body || '',
    tag: p.tag || 'telecipher',
    renotify: true,
    icon: '/icon-192.png',
    badge: '/icon-192.png',
    data: { id: p.id, url: p.url || '/' },
  }))
})

self.addEventListener('notificationclick', (event) => {
  const data = event.notification.data || {}
  event.notification.close()
  event.waitUntil((async () => {
    const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
    if (clients.length) {
      try { await clients[0].focus() } catch (_) {}
      clients[0].postMessage({ type: 'openRequest', id: data.id })
    } else {
      await self.clients.openWindow(data.url || '/')
    }
  })())
})
```

`plugins/push.client.ts`：
```ts
export default defineNuxtPlugin(() => {
  if (!('serviceWorker' in navigator)) return
  navigator.serviceWorker.register('/sw.js').catch((e) => console.warn('[push] SW 註冊失敗', e))
  navigator.serviceWorker.addEventListener('message', (event) => {
    const d = event.data || {}
    if (d.type === 'openRequest' && d.id) navigateTo(`/requests/${d.id}`)
  })
})
```

`composables/usePush.ts`（照 teledeck）：
```ts
// PWA 推播訂閱狀態與操作。瀏覽器 API，靠實機驗證。
export function usePush() {
  const supported = useState('push-supported', () => false)
  const permission = useState<NotificationPermission>('push-permission', () => 'default')
  const subscribed = useState('push-subscribed', () => false)

  async function refresh() {
    supported.value = import.meta.client && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window
    if (!supported.value) return
    permission.value = Notification.permission
    const reg = await navigator.serviceWorker.ready
    subscribed.value = !!(await reg.pushManager.getSubscription())
  }

  async function subscribe() {
    if (!supported.value) return
    permission.value = await Notification.requestPermission()
    if (permission.value !== 'granted') return
    const { key } = await $fetch<{ key: string | null }>('/api/push/vapid-public-key')
    if (!key) { console.warn('[push] server 未設定 VAPID'); return }
    const reg = await navigator.serviceWorker.ready
    const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(key) as BufferSource })
    await $fetch('/api/push/subscribe', { method: 'POST', body: sub.toJSON() })
    subscribed.value = true
  }

  async function unsubscribe() {
    if (!supported.value) return
    const reg = await navigator.serviceWorker.ready
    const sub = await reg.pushManager.getSubscription()
    if (sub) {
      await $fetch('/api/push/unsubscribe', { method: 'POST', body: { endpoint: sub.endpoint } }).catch(() => {})
      await sub.unsubscribe()
    }
    subscribed.value = false
  }

  return { supported, permission, subscribed, refresh, subscribe, unsubscribe }
}

function urlBase64ToUint8Array(base64: string): Uint8Array {
  const padding = '='.repeat((4 - (base64.length % 4)) % 4)
  const b64 = (base64 + padding).replace(/-/g, '+').replace(/_/g, '/')
  const raw = atob(b64)
  const arr = new Uint8Array(raw.length)
  for (let i = 0; i < raw.length; i++) arr[i] = raw.charCodeAt(i)
  return arr
}
```

- [ ] **Step 4: 手動驗證 SW 與 VAPID 端點**

Run: `NUXT_TELECIPHER_TOKEN=devtoken bun run dev`，另一終端：
```bash
curl -s -H 'x-telecipher-token: devtoken' http://127.0.0.1:9877/api/push/vapid-public-key   # {"key":null}（尚無 .vapid.json）
curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:9877/sw.js                        # 200（不被導去 /login）
```
Expected：如註解。停掉 dev server。

- [ ] **Step 5: Commit**

```bash
git add server public plugins composables test
git commit -m "feat：Web Push（VAPID、訂閱持久化、新需求推播、service worker）

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_011isrhay5op9wh4NpmsPEuu"
```

---

### Task 9: 頁面（首頁列表、需求頁、鈴鐺）＋ icons／manifest

**Files:**
- Create: `composables/useRequests.ts`、`components/BellButton.vue`、`components/RequestCard.vue`、`pages/requests/[id].vue`、`utils/time.ts`、`scripts/gen-icons.mjs`、`public/manifest.webmanifest`、`public/favicon.svg`、`public/icon-192.png`、`public/icon-512.png`、`public/icon-512-maskable.png`、`public/apple-touch-icon.png`、`test/time.test.ts`
- Modify: `pages/index.vue`

**Interfaces:**
- Consumes: API（Task 7）、`usePush`（Task 8）。
- Produces: `useRequests()` → `{ pending, done, loading, error, refresh(), fulfill(id, value), clearDone() }`；`relativeTime(iso: string, now?: Date): string`。

- [ ] **Step 1: relativeTime 失敗測試**

`test/time.test.ts`：
```ts
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
```

Run: `bun run test test/time.test.ts` → FAIL。

- [ ] **Step 2: 實作 utils/time.ts**

```ts
export function relativeTime(iso: string, now = new Date()): string {
  const t = Date.parse(iso)
  if (Number.isNaN(t)) return ''
  const s = Math.max(0, Math.floor((now.getTime() - t) / 1000))
  if (s < 60) return '剛剛'
  const m = Math.floor(s / 60); if (m < 60) return `${m} 分鐘前`
  const h = Math.floor(m / 60); if (h < 24) return `${h} 小時前`
  return `${Math.floor(h / 24)} 天前`
}
```

Run: `bun run test test/time.test.ts` → passed。

- [ ] **Step 3: useRequests、元件、頁面**

`composables/useRequests.ts`：
```ts
import type { SecretRequest } from '~/server/lib/types'

export function useRequests() {
  const all = useState<SecretRequest[]>('requests', () => [])
  const loading = useState('requests-loading', () => false)
  const error = useState('requests-error', () => '')
  const pending = computed(() => all.value.filter((r) => r.status === 'pending'))
  const done = computed(() => all.value.filter((r) => r.status !== 'pending').slice(0, 50))

  async function refresh() {
    loading.value = true; error.value = ''
    try { all.value = (await $fetch<{ requests: SecretRequest[] }>('/api/requests')).requests }
    catch (e: any) { if (e?.statusCode === 401) await navigateTo('/login'); else error.value = '載入失敗' }
    finally { loading.value = false }
  }
  async function fulfill(id: string, value: string): Promise<{ ok: true } | { ok: false; reason: string }> {
    try {
      await $fetch(`/api/requests/${id}/fulfill`, { method: 'POST', body: { value } })
      await refresh(); return { ok: true }
    } catch (e: any) {
      const reason = e?.data?.data?.reason ?? e?.data?.statusMessage ?? (e?.statusCode === 409 ? '需求已處理' : '儲存失敗')
      return { ok: false, reason }
    }
  }
  async function clearDone() { await $fetch('/api/requests/clear-done', { method: 'POST' }); await refresh() }
  return { all, pending, done, loading, error, refresh, fulfill, clearDone }
}
```

`components/BellButton.vue`：
```vue
<script setup lang="ts">
const { supported, permission, subscribed, refresh, subscribe, unsubscribe } = usePush()
onMounted(refresh)
function onBell() { if (!supported.value || permission.value === 'denied') return; subscribed.value ? unsubscribe() : subscribe() }
const title = computed(() => !supported.value ? '此裝置不支援推播（需安裝為 PWA）'
  : permission.value === 'denied' ? '通知已被封鎖（去設定解鎖）'
  : subscribed.value ? '關閉新需求通知' : '開啟新需求通知')
</script>
<template>
  <button class="bell" :class="{ on: subscribed, dim: !supported || permission === 'denied' }" :title="title" :aria-label="title" @click="onBell">
    <svg viewBox="0 0 16 16" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round">
      <path d="M8 2a3.5 3.5 0 0 0-3.5 3.5c0 3-1.2 4-1.5 4.5h10c-.3-.5-1.5-1.5-1.5-4.5A3.5 3.5 0 0 0 8 2z" />
      <path d="M6.7 12.5a1.4 1.4 0 0 0 2.6 0" />
      <path v-if="!supported || permission === 'denied'" d="M3 3l10 10" stroke-width="1.4" />
    </svg>
  </button>
</template>
<style scoped>
.bell { background: transparent; border: 1px solid var(--hairline); border-radius: 8px; padding: 6px; color: var(--muted); display: grid; place-items: center; }
.bell.on { color: var(--ember); border-color: var(--ember-line); background: var(--ember-dim); }
.bell.dim { opacity: .5; }
</style>
```

`components/RequestCard.vue`：
```vue
<script setup lang="ts">
import type { SecretRequest } from '~/server/lib/types'
import { relativeTime } from '~/utils/time'
defineProps<{ r: SecretRequest }>()
const label: Record<string, string> = { pending: '待處理', fulfilled: '已寫入', cancelled: '已取消' }
</script>
<template>
  <NuxtLink :to="`/requests/${r.id}`" class="card">
    <div style="display:flex;justify-content:space-between;gap:8px;align-items:baseline">
      <div style="font-weight:600">{{ r.session }}</div>
      <span class="badge" :class="r.status">{{ label[r.status] }}</span>
    </div>
    <div class="mono muted" style="margin-top:4px">{{ r.mode === 'env' ? `${r.key} → ` : '' }}{{ r.path }}</div>
    <div style="margin-top:6px">{{ r.description }}</div>
    <div class="faint" style="margin-top:6px">{{ relativeTime(r.createdAt) }}</div>
  </NuxtLink>
</template>
```

`pages/index.vue`：
```vue
<script setup lang="ts">
const { pending, done, loading, error, refresh, clearDone } = useRequests()
onMounted(refresh)
let timer: ReturnType<typeof setInterval> | undefined
onMounted(() => { timer = setInterval(refresh, 15000) })
onUnmounted(() => clearInterval(timer))
</script>
<template>
  <main class="wrap">
    <header style="display:flex;justify-content:space-between;align-items:center">
      <div class="brand">tele<b>cipher</b></div>
      <BellButton />
    </header>
    <div v-if="error" class="err" style="margin-top:12px">{{ error }}</div>

    <h2>待處理 <span class="faint">{{ pending.length }}</span></h2>
    <div v-if="!pending.length && !loading" class="faint">沒有待處理的需求。</div>
    <RequestCard v-for="r in pending" :key="r.id" :r="r" />

    <h2 style="display:flex;justify-content:space-between;align-items:baseline">
      <span>已處理</span>
      <button v-if="done.length" class="btn ghost" style="padding:4px 10px;font-size:12px;text-transform:none;letter-spacing:0" @click="clearDone">清除已處理</button>
    </h2>
    <div v-if="!done.length && !loading" class="faint">尚無已處理項目。</div>
    <RequestCard v-for="r in done" :key="r.id" :r="r" />
  </main>
</template>
```

`pages/requests/[id].vue`：
```vue
<script setup lang="ts">
import type { SecretRequest } from '~/server/lib/types'
import { relativeTime } from '~/utils/time'
const route = useRoute()
const id = String(route.params.id)
const { fulfill } = useRequests()
const r = ref<SecretRequest | null>(null)
const notFound = ref(false)
const value = ref('')
const saving = ref(false)
const msg = ref<{ kind: 'ok' | 'err'; text: string } | null>(null)

async function load() {
  try { r.value = await $fetch<SecretRequest>(`/api/requests/${id}`) }
  catch (e: any) { if (e?.statusCode === 401) await navigateTo('/login'); else notFound.value = true }
}
onMounted(load)

async function save() {
  if (!value.value || saving.value) return
  saving.value = true; msg.value = null
  const res = await fulfill(id, value.value)
  saving.value = false
  if (res.ok) { value.value = ''; msg.value = { kind: 'ok', text: `已寫入 ${r.value?.path}` }; await load() }
  else msg.value = { kind: 'err', text: res.reason }
}
const label: Record<string, string> = { pending: '待處理', fulfilled: '已寫入', cancelled: '已取消' }
</script>
<template>
  <main class="wrap">
    <header style="display:flex;justify-content:space-between;align-items:center">
      <NuxtLink to="/" class="brand">tele<b>cipher</b></NuxtLink>
      <BellButton />
    </header>
    <div v-if="notFound" class="err" style="margin-top:20px">找不到這筆需求。</div>
    <template v-else-if="r">
      <h2>需求 <span class="mono faint">{{ r.id }}</span></h2>
      <section class="card">
        <dl class="dl">
          <dt>Session</dt><dd style="font-weight:600">{{ r.session }}</dd>
          <dt>寫入位置</dt><dd class="mono">{{ r.path }}</dd>
          <dt>模式</dt><dd class="mono">{{ r.mode === 'env' ? `env · ${r.key}` : 'file（整檔）' }}</dd>
          <dt>說明</dt><dd>{{ r.description }}</dd>
          <dt>建立</dt><dd class="muted">{{ relativeTime(r.createdAt) }}</dd>
          <dt>狀態</dt><dd><span class="badge" :class="r.status">{{ label[r.status] }}</span>
            <span v-if="r.fulfilledAt" class="faint"> · {{ relativeTime(r.fulfilledAt) }}</span></dd>
        </dl>
      </section>

      <form v-if="r.status === 'pending'" class="card" style="margin-top:14px" @submit.prevent="save">
        <label for="v" class="muted" style="display:block;margin-bottom:6px">貼上值（原樣寫入，不會 trim）</label>
        <textarea id="v" v-model="value" rows="4" autocomplete="off" autocapitalize="off" spellcheck="false" style="width:100%" :disabled="saving" />
        <div style="display:flex;gap:10px;align-items:center;margin-top:10px">
          <button type="submit" class="btn primary" :disabled="!value || saving">{{ saving ? '寫入中…' : '儲存' }}</button>
          <span v-if="msg" :class="msg.kind">{{ msg.text }}</span>
        </div>
      </form>
      <div v-else-if="msg" :class="msg.kind" style="margin-top:14px">{{ msg.text }}</div>
    </template>
  </main>
</template>
<style scoped>
.dl { display: grid; grid-template-columns: 84px 1fr; gap: 8px 12px; }
.dl dt { color: var(--faint); font-size: 12px; padding-top: 2px; }
.dl dd { word-break: break-all; }
</style>
```

- [ ] **Step 4: icons 與 manifest**

`scripts/gen-icons.mjs`：
```js
// 產 PWA icons：ember 底、白色鑰匙。bun run icons
import { Resvg } from '@resvg/resvg-js'
import { writeFileSync } from 'node:fs'

const svg = (size, pad) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="${size}" height="${size}">
  <rect width="64" height="64" rx="${pad ? 0 : 14}" fill="#201c1a"/>
  <g transform="translate(${pad ? 8 : 4} ${pad ? 8 : 4}) scale(${pad ? 0.75 : 0.875})" fill="none" stroke="#e8a94a" stroke-width="5" stroke-linecap="round" stroke-linejoin="round">
    <circle cx="22" cy="24" r="11"/>
    <path d="M30 32 L54 56 M44 46 L50 40 M38 40 L44 34"/>
  </g>
</svg>`
const png = (s, pad = false) => new Resvg(svg(s, pad), { fitTo: { mode: 'width', value: s } }).render().asPng()
writeFileSync('public/favicon.svg', svg(64))
writeFileSync('public/icon-192.png', png(192))
writeFileSync('public/icon-512.png', png(512))
writeFileSync('public/icon-512-maskable.png', png(512, true))
writeFileSync('public/apple-touch-icon.png', png(180))
console.log('icons 已產生到 public/')
```

Run: `bun run icons` → 5 個檔案出現在 `public/`。

`public/manifest.webmanifest`：
```json
{
  "name": "telecipher",
  "short_name": "telecipher",
  "start_url": "/",
  "scope": "/",
  "display": "standalone",
  "theme_color": "#201c1a",
  "background_color": "#201c1a",
  "icons": [
    { "src": "/icon-192.png", "sizes": "192x192", "type": "image/png" },
    { "src": "/icon-512.png", "sizes": "512x512", "type": "image/png" },
    { "src": "/icon-512-maskable.png", "sizes": "512x512", "type": "image/png", "purpose": "maskable" }
  ]
}
```

- [ ] **Step 5: 實機驗證（Claude in Chrome）**

Run: `NUXT_TELECIPHER_TOKEN=devtoken bun run dev`。建一筆需求：
```bash
curl -s -X POST -H 'x-telecipher-token: devtoken' -H 'content-type: application/json' \
  -d '{"session":"demo","path":"~/tmp/telecipher-demo/.env","mode":"env","key":"DEMO_KEY","description":"示範用，填任何字"}' \
  http://127.0.0.1:9877/api/requests
```
用 Claude in Chrome 開 `http://127.0.0.1:9877/login`，貼 `devtoken`，確認：首頁待處理 1 筆 → 點進需求頁 → 填 `hello` 儲存 → 顯示「已寫入 …」、badge 變「已寫入」→ 回首頁該筆在已處理區 → 「清除已處理」後消失。終端 `cat ~/tmp/telecipher-demo/.env` 為 `DEMO_KEY="hello"`，`stat -f %Lp` 為 `600`。清掉 `rm -rf ~/tmp/telecipher-demo`。停 dev server。

- [ ] **Step 6: 全部測試並 Commit**

Run: `bun run test` → 全部 passed。
```bash
git add -A
git commit -m "feat：首頁需求列表、需求頁填值、鈴鐺、PWA icons 與 manifest

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_011isrhay5op9wh4NpmsPEuu"
```

---

### Task 10: setup 腳本、run.sh、launchd、Tailscale Serve、README

**Files:**
- Create: `scripts/setup.mjs`、`run.sh`、`deploy/com.telecipher.server.plist.template`、`deploy/install-launchd.sh`、`deploy/uninstall-launchd.sh`、`README.md`
- Modify: `.gitignore`（加 `deploy/*.plist`，只進版控 template）

**Interfaces:**
- Produces：`~/.telecipher/token`（skill 讀）；daemon label `com.telecipher.server`；對外 `https://m1-pro.tail521001.ts.net:8444`。

- [ ] **Step 1: scripts/setup.mjs**

```js
// 一次性：產 .token、.vapid.json、~/.telecipher/token。已存在的一律跳過，不重產。
import { existsSync, mkdirSync, writeFileSync, chmodSync, readFileSync } from 'node:fs'
import { randomBytes } from 'node:crypto'
import { join } from 'node:path'
import { homedir } from 'node:os'
import webpush from 'web-push'

function writeSecret(path, data) {
  writeFileSync(path, data, { mode: 0o600 }); chmodSync(path, 0o600)
}

if (!existsSync('.token')) { writeSecret('.token', randomBytes(32).toString('hex') + '\n'); console.log('.token 已產生') }
else console.log('.token 已存在，跳過')

if (!existsSync('.vapid.json')) { writeSecret('.vapid.json', JSON.stringify(webpush.generateVAPIDKeys(), null, 2) + '\n'); console.log('.vapid.json 已產生（請勿重產，會讓訂閱失效）') }
else console.log('.vapid.json 已存在，跳過')

const dir = join(homedir(), '.telecipher')
mkdirSync(dir, { recursive: true, mode: 0o700 }); chmodSync(dir, 0o700)
const tokenPath = join(dir, 'token')
const token = readFileSync('.token', 'utf8')
if (!existsSync(tokenPath) || readFileSync(tokenPath, 'utf8') !== token) { writeSecret(tokenPath, token); console.log(`${tokenPath} 已寫入`) }
else console.log(`${tokenPath} 已同步，跳過`)
```

Run: `bun run setup && ls -la .token .vapid.json ~/.telecipher/token`
Expected: 三個檔都 `-rw-------`。

- [ ] **Step 2: run.sh**

```zsh
#!/bin/zsh
# supervisor 迴圈：node 掉了 1 秒後重啟。路徑由腳本位置推導。
cd "$(dirname "$0")"
export NUXT_TELECIPHER_TOKEN=$(cat .token)
export NUXT_TELECIPHER_HOME="${HOME}"
export HOST=127.0.0.1 NITRO_HOST=127.0.0.1 PORT=9877 NITRO_PORT=9877
NODE="${TELECIPHER_NODE:-$(command -v node)}"
while true; do
  "$NODE" .output/server/index.mjs
  echo "[run.sh] node exited (code=$?) — restarting in 1s…"
  sleep 1
done
```

Run: `chmod +x run.sh`。

- [ ] **Step 3: plist template 與 install／uninstall**

`deploy/com.telecipher.server.plist.template`：
```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>com.telecipher.server</string>
  <key>ProgramArguments</key><array><string>__REPO__/run.sh</string></array>
  <key>UserName</key><string>__USER__</string>
  <key>GroupName</key><string>staff</string>
  <key>WorkingDirectory</key><string>__REPO__</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>HOME</key><string>__HOME__</string>
    <key>USER</key><string>__USER__</string>
    <key>LOGNAME</key><string>__USER__</string>
    <key>PATH</key><string>/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin</string>
    <key>LANG</key><string>zh_TW.UTF-8</string>
  </dict>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>ProcessType</key><string>Interactive</string>
  <key>StandardOutPath</key><string>__REPO__/logs/telecipher-server.log</string>
  <key>StandardErrorPath</key><string>__REPO__/logs/telecipher-server.log</string>
</dict>
</plist>
```

`deploy/install-launchd.sh`：
```zsh
#!/bin/zsh
# 安裝 telecipher LaunchDaemon（開機即起、免登入）。路徑由腳本位置推導。
set -e
REPO="$(cd "$(dirname "$0")/.." && pwd)"
LABEL=com.telecipher.server
DST=/Library/LaunchDaemons/$LABEL.plist
RENDERED="$REPO/deploy/$LABEL.plist"

[[ -f "$REPO/.token" ]] || { echo "缺 .token，先跑 bun run setup"; exit 1 }
[[ -f "$REPO/.output/server/index.mjs" ]] || { echo "缺 .output，先跑 bun run build"; exit 1 }
mkdir -p "$REPO/logs"

echo "== 1) 渲染 plist =="
sed -e "s|__REPO__|$REPO|g" -e "s|__USER__|$USER|g" -e "s|__HOME__|$HOME|g" "$REPO/deploy/$LABEL.plist.template" > "$RENDERED"

echo "== 2) 停舊實例 =="
pkill -f "$REPO/run.sh" 2>/dev/null || true
pkill -f "$REPO/.output/server/index.mjs" 2>/dev/null || true
sleep 1

echo "== 3) 安裝 plist（需 sudo）=="
sudo cp "$RENDERED" "$DST"; sudo chown root:wheel "$DST"; sudo chmod 644 "$DST"
sudo launchctl bootout system/$LABEL 2>/dev/null || true
sudo launchctl bootstrap system "$DST"
sudo launchctl enable system/$LABEL

echo "== 4) 驗證 =="
sleep 3
echo -n "  daemon: "; sudo launchctl print system/$LABEL 2>/dev/null | grep -E "state = " | head -1 | tr -s ' '
echo -n "  REST:   "; curl -s -o /dev/null -w "HTTP %{http_code}\n" -H "x-telecipher-token: $(cat "$REPO/.token")" http://127.0.0.1:9877/api/health
echo "  log:"; tail -3 "$REPO/logs/telecipher-server.log" 2>/dev/null | sed 's/^/    /'
echo
echo "重部署： bun run build && sudo launchctl kickstart -k system/$LABEL"
```

`deploy/uninstall-launchd.sh`：
```zsh
#!/bin/zsh
set -e
LABEL=com.telecipher.server
sudo launchctl bootout system/$LABEL 2>/dev/null || true
sudo rm -f /Library/LaunchDaemons/$LABEL.plist
echo "已移除 $LABEL"
```

Run: `chmod +x deploy/*.sh`；`.gitignore` 加一行 `deploy/*.plist`（渲染後的檔不進版控）。

- [ ] **Step 4: build、安裝 daemon、開 Tailscale Serve**

⚠️ 需要 Zac 在鍵盤前（`sudo` 密碼）。執行者先把 orchestrator 報表 `status` 改 `waiting` 並發通知，再等 Zac。

```bash
bun run build
deploy/install-launchd.sh
/Applications/Tailscale.app/Contents/MacOS/Tailscale serve --bg --https=8444 http://127.0.0.1:9877
/Applications/Tailscale.app/Contents/MacOS/Tailscale serve status
curl -s -o /dev/null -w '%{http_code}\n' https://m1-pro.tail521001.ts.net:8444/login
```
Expected: install 印 `HTTP 200`；serve status 多一行 `https://m1-pro.tail521001.ts.net:8444 (tailnet only) → http://127.0.0.1:9877`；最後 `200`。`:443` 與 `:8443` 不變。

- [ ] **Step 5: README.md**

```markdown
# telecipher

個人敏感資料交付站。其他 Claude Code session 需要 token／API key 時，用 `telecipher` skill 登錄需求；你收到 Web Push，在頁面填值，server 直接寫進目標檔。**值不經 Claude 的對話紀錄。**

## 流程

1. session 載入 skill → `request.sh` → `POST /api/requests`（session、路徑、mode、說明）。
2. telecipher 推播「🔑 {session} · 需要 {key}」。
3. 點通知 → 需求頁 → 填值 → 儲存。server 以 0600 寫入（`file` 整檔／`env` upsert 一個 key）。
4. session 的 `request.sh` long-poll 到 `fulfilled`，繼續工作。session 不讀檔內容。

## 安裝（m1-pro）

    bun install
    bun run build
    bun run setup                 # .token、.vapid.json、~/.telecipher/token（皆 0600）
    deploy/install-launchd.sh     # LaunchDaemon com.telecipher.server，127.0.0.1:9877
    /Applications/Tailscale.app/Contents/MacOS/Tailscale serve --bg --https=8444 http://127.0.0.1:9877

瀏覽器開 `https://<host>.ts.net:8444`，貼 `.token` 內容登入。iPhone／macOS 要收通知：加到主畫面／程式塢後，點右上鈴鐺。

## 重部署

    bun run build && sudo launchctl kickstart -k system/com.telecipher.server

## 開發

    NUXT_TELECIPHER_TOKEN=devtoken bun run dev     # 127.0.0.1:9877
    bun run test

## 安全邊界

見 `docs/superpowers/specs/2026-10-18-telecipher-design.md`〈安全模型〉。
```

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat：setup 腳本、run.sh、launchd 部署腳本與 README

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_011isrhay5op9wh4NpmsPEuu"
git push
```

---

### Task 11: 真機 PWA 推播驗證＋踩雷筆記

**Files:**
- Create: `docs/superpowers/notes/2026-10-18-deploy-and-push.md`

- [ ] **Step 1: iPhone 安裝 PWA 並訂閱**

⚠️ 整個 Task 11 需要 Zac 拿著 iPhone。先把報表 `status` 改 `waiting` 並發通知。

Zac 手動：Safari 開 `https://m1-pro.tail521001.ts.net:8444` → 登入 → 分享 → 加入主畫面 → 從主畫面開 → 點鈴鐺 → 允許。確認 `.push-subscriptions.json` 多一筆：`ls -la .push-subscriptions.json`（0600）。

- [ ] **Step 2: 觸發一筆需求，手機收到通知**

```bash
curl -s -X POST -H "x-telecipher-token: $(cat .token)" -H 'content-type: application/json' \
  -d '{"session":"push-test","path":"~/tmp/telecipher-push/.env","mode":"env","key":"PUSH_TEST","description":"推播測試"}' \
  http://127.0.0.1:9877/api/requests
```
Expected: iPhone 鎖屏出現「🔑 push-test · 需要 PUSH_TEST」。點通知開到該需求頁。填值儲存。`cat ~/tmp/telecipher-push/.env`。清掉 `rm -rf ~/tmp/telecipher-push`。

- [ ] **Step 3: 筆記**

`docs/superpowers/notes/2026-10-18-deploy-and-push.md` 記：實際安裝步驟輸出、Tailscale Serve 指令、iOS 是否需重新安裝 PWA、任何踩到的雷與根因。沒有雷就寫「無」。

- [ ] **Step 4: Commit**

```bash
git add docs/superpowers/notes
git commit -m "docs：部署與推播實機驗證筆記

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_011isrhay5op9wh4NpmsPEuu"
git push
```

---

### Task 12: skill plugin `telecipher`（zac-skills）

**Files（repo `~/.claude/plugins/marketplaces/zac-skills`）:**
- Create: `plugins/telecipher/.claude-plugin/plugin.json`、`plugins/telecipher/README.md`、`plugins/telecipher/skills/request-secret/SKILL.md`、`plugins/telecipher/skills/request-secret/scripts/request.sh`、`plugins/telecipher/skills/request-secret/scripts/request.test.sh`
- Modify: `.claude-plugin/marketplace.json`

**Interfaces:**
- Consumes: API（Task 7）、`~/.telecipher/token`（Task 10）。
- Produces: `request.sh` stdout 最後一行 `REGISTERED <id> <path>` 後接 `FULFILLED <id>`｜`CANCELLED <id>`｜`TIMEOUT <id>`；exit 0／5／6；2 缺 token、3 400、4 連不上。

- [ ] **Step 1: request.sh 的失敗測試（shell）**

`scripts/request.test.sh`：
```bash
#!/bin/bash
# 需要 dev server：NUXT_TELECIPHER_TOKEN=devtoken bun run dev（telecipher repo）
set -u
HERE="$(cd "$(dirname "$0")" && pwd)"
SH="$HERE/request.sh"
TOKEN_FILE="$(mktemp)"; echo devtoken > "$TOKEN_FILE"
fail=0
check() { if [ "$1" = "$2" ]; then echo "ok   $3"; else echo "FAIL $3: got $1 want $2"; fail=1; fi }

TELECIPHER_TOKEN_FILE=/nonexistent "$SH" --path ~/tmp/x --mode file --description d >/dev/null 2>&1
check $? 2 "缺 token → exit 2"

TELECIPHER_URL=http://127.0.0.1:1 TELECIPHER_TOKEN_FILE="$TOKEN_FILE" "$SH" --path ~/tmp/x --mode file --description d >/dev/null 2>&1
check $? 4 "連不上 → exit 4"

TELECIPHER_TOKEN_FILE="$TOKEN_FILE" "$SH" --path ~/.ssh/x --mode file --description d >/dev/null 2>&1
check $? 3 "拒絕路徑 → exit 3"

out=$(TELECIPHER_TOKEN_FILE="$TOKEN_FILE" "$SH" --path ~/tmp/telecipher-sh-test/.env --mode env --key K --description d --wait-minutes 0 2>/dev/null)
check $? 6 "wait 0 分 → TIMEOUT exit 6"
echo "$out" | grep -q '^REGISTERED [a-z2-7]\{12\} ' ; check $? 0 "印 REGISTERED"
echo "$out" | tail -1 | grep -q '^TIMEOUT ' ; check $? 0 "最後一行 TIMEOUT"
id=$(echo "$out" | grep '^REGISTERED' | awk '{print $2}')
curl -s -X DELETE -H 'x-telecipher-token: devtoken' "http://127.0.0.1:9877/api/requests/$id" >/dev/null

# fulfill 路徑：背景跑 request.sh，1 秒後 fulfill
TELECIPHER_TOKEN_FILE="$TOKEN_FILE" "$SH" --path ~/tmp/telecipher-sh-test/.env --mode env --key K2 --description d --wait-minutes 1 > /tmp/tc-req-out.txt 2>/dev/null &
pid=$!
sleep 1
id=$(grep '^REGISTERED' /tmp/tc-req-out.txt | awk '{print $2}')
curl -s -X POST -H 'x-telecipher-token: devtoken' -H 'content-type: application/json' -d '{"value":"v"}' "http://127.0.0.1:9877/api/requests/$id/fulfill" >/dev/null
wait $pid; check $? 0 "fulfill → exit 0"
tail -1 /tmp/tc-req-out.txt | grep -q "^FULFILLED $id" ; check $? 0 "最後一行 FULFILLED"
rm -rf ~/tmp/telecipher-sh-test /tmp/tc-req-out.txt "$TOKEN_FILE"
exit $fail
```

Run（telecipher dev server 開著）：`bash scripts/request.test.sh` → 全部 FAIL（request.sh 不存在）。

- [ ] **Step 2: request.sh**

```bash
#!/bin/bash
# 向 telecipher 登錄 secret 需求並等待完成。值永遠不經過這支腳本。
# 用法：request.sh --path <path> --mode file|env [--key KEY] --description "<text>" [--session <name>] [--wait-minutes 120]
# stdout：REGISTERED <id> <path>，然後 FULFILLED <id> | CANCELLED <id> | TIMEOUT <id>
# exit：0 fulfilled｜2 缺 token｜3 登錄被拒（400）｜4 連不上｜5 cancelled｜6 timeout｜7 參數錯
set -u
URL="${TELECIPHER_URL:-http://127.0.0.1:9877}"
TOKEN_FILE="${TELECIPHER_TOKEN_FILE:-$HOME/.telecipher/token}"
PATH_ARG=""; MODE=""; KEY=""; DESC=""; SESSION=""; WAIT_MIN=120
while [ $# -gt 0 ]; do
  case "$1" in
    --path) PATH_ARG="$2"; shift 2;;
    --mode) MODE="$2"; shift 2;;
    --key) KEY="$2"; shift 2;;
    --description) DESC="$2"; shift 2;;
    --session) SESSION="$2"; shift 2;;
    --wait-minutes) WAIT_MIN="$2"; shift 2;;
    *) echo "未知參數：$1" >&2; exit 7;;
  esac
done
[ -n "$PATH_ARG" ] && [ -n "$MODE" ] && [ -n "$DESC" ] || { echo "需要 --path --mode --description" >&2; exit 7; }
[ "$MODE" = env ] && [ -z "$KEY" ] && { echo "env 模式需要 --key" >&2; exit 7; }
[ -r "$TOKEN_FILE" ] || { echo "找不到 $TOKEN_FILE。請在 telecipher repo 跑 bun run setup。" >&2; exit 2; }
TOKEN="$(tr -d '\n' < "$TOKEN_FILE")"

if [ -z "$SESSION" ]; then
  SESSION="$(tmux display-message -p '#S' 2>/dev/null || true)"
  [ -n "$SESSION" ] || SESSION="$(basename "$PWD")"
fi

# 跳脫 \ 與 "；換行改成空白（description 應為一句話）
json_escape() { printf '%s' "$1" | sed -e 's/\\/\\\\/g' -e 's/"/\\"/g' | tr '\n' ' '; }
BODY="{\"session\":\"$(json_escape "$SESSION")\",\"path\":\"$(json_escape "$PATH_ARG")\",\"mode\":\"$MODE\",\"description\":\"$(json_escape "$DESC")\""
[ -n "$KEY" ] && BODY="$BODY,\"key\":\"$(json_escape "$KEY")\""
BODY="$BODY}"

RESP="$(curl -s -w '\n%{http_code}' -X POST -H "x-telecipher-token: $TOKEN" -H 'content-type: application/json' -d "$BODY" "$URL/api/requests" 2>/dev/null)"
CODE="$(printf '%s' "$RESP" | tail -1)"
JSON="$(printf '%s' "$RESP" | sed '$d')"
# 連線失敗時 curl 仍印 write-out，http_code 是 000
if [ -z "$CODE" ] || [ "$CODE" = "000" ]; then echo "連不上 telecipher（$URL）。確認 daemon 有在跑。" >&2; exit 4; fi
if [ "$CODE" = "401" ]; then echo "token 不被接受。重跑 bun run setup 同步 ~/.telecipher/token。" >&2; exit 2; fi
if [ "$CODE" != "201" ]; then
  REASON="$(printf '%s' "$JSON" | sed -n 's/.*"reason":"\([^"]*\)".*/\1/p')"
  echo "登錄被拒（HTTP $CODE）：${REASON:-$JSON}" >&2
  exit 3
fi
ID="$(printf '%s' "$JSON" | sed -n 's/.*"id":"\([a-z2-7]*\)".*/\1/p')"
RPATH="$(printf '%s' "$JSON" | sed -n 's/.*"path":"\([^"]*\)".*/\1/p')"
echo "REGISTERED $ID $RPATH"

DEADLINE=$(( $(date +%s) + WAIT_MIN * 60 ))
while :; do
  NOW=$(date +%s)
  [ "$NOW" -lt "$DEADLINE" ] || { echo "TIMEOUT $ID"; exit 6; }
  LEFT=$(( DEADLINE - NOW )); T=55; [ "$LEFT" -lt 55 ] && T=$LEFT
  W="$(curl -s --max-time $((T + 10)) -H "x-telecipher-token: $TOKEN" "$URL/api/requests/$ID/wait?timeout=$T" 2>/dev/null)"
  STATUS="$(printf '%s' "$W" | sed -n 's/.*"status":"\([a-z]*\)".*/\1/p')"
  case "$STATUS" in
    fulfilled) echo "FULFILLED $ID"; exit 0;;
    cancelled) echo "CANCELLED $ID"; exit 5;;
    pending) ;;
    *) sleep 5;;   # 連線中斷：稍後重試，直到 deadline
  esac
done
```

Run: `chmod +x request.sh && bash scripts/request.test.sh` → 全部 ok。

- [ ] **Step 3: SKILL.md、plugin.json、README、marketplace.json**

`skills/request-secret/SKILL.md`：
```markdown
---
name: request-secret
description: 需要使用者提供 token、API key、密碼、憑證檔等敏感資料時使用。向 telecipher 登錄需求，使用者在 telecipher 頁面填值，值直接寫進目標檔，不經過這個對話。絕不要請使用者把 secret 貼進終端機。
---

# request-secret：向 telecipher 要 secret

值不會經過你。你只知道「需求已登錄」與「已寫入」。

## 流程

1. 決定寫法：
   - 單一 key（API token、密碼）→ `--mode env --key KEY --path <專案>/.env`。
   - 整個檔（service account JSON、私鑰）→ `--mode file --path <絕對路徑>`。目標不能已存在。
   - 路徑必須在使用者 home 內。`~/.ssh`、`~/Library`、shell rc、`~/.claude/settings*` 會被拒絕。
2. 用 Bash 的 `run_in_background: true` 執行（前景 Bash 有 10 分鐘上限，使用者可能一小時後才填）：
   ```bash
   bash ${CLAUDE_SKILL_DIR}/scripts/request.sh --path ~/dev/app/.env --mode env --key OPENAI_API_KEY --description "OpenAI API key，給 app 的 LLM 呼叫用"
   ```
   `--description` 一句話說明用途，1–500 字。`--session` 預設取 tmux session 名，可覆寫。`--wait-minutes` 預設 120。
3. 立刻告訴使用者：「已向 telecipher 登錄需求，請到 telecipher 填 OPENAI_API_KEY（寫入 ~/dev/app/.env）」。繼續做不依賴這個值的工作。
4. 背景任務結束時看 stdout 最後一行與 exit code：
   - `FULFILLED <id>`（exit 0）→ 值已在目標檔，繼續。
   - `CANCELLED <id>`（exit 5）→ 使用者取消了，問使用者下一步。
   - `TIMEOUT <id>`（exit 6）→ 告訴使用者需求還在 telecipher 待處理，可再跑一次等待。
   - exit 2／3／4 → 把 stderr 的訊息告訴使用者（缺 token、路徑被拒、telecipher 未啟動）。

## 禁止

- 完成後**不要**用 `cat`、`Read`、`echo $KEY`、`grep` 或任何方式讀目標檔的內容。要用值就讓程式在 runtime 讀檔或讀 env。
- 不要把值寫進 log、commit、對話。
- 不要替使用者猜值或放 placeholder 進目標檔。
```

`plugins/telecipher/.claude-plugin/plugin.json`：
```json
{
  "name": "telecipher",
  "description": "session 需要 token／API key 時向 telecipher 登錄需求，使用者在 telecipher 頁面填值直接寫檔，值不經 Claude 對話。",
  "author": { "name": "im-zac", "url": "https://github.com/im-zac" },
  "homepage": "https://github.com/im-zac/zac-skills/tree/main/plugins/telecipher",
  "repository": "https://github.com/im-zac/zac-skills",
  "license": "MIT",
  "keywords": ["secret", "token", "api-key", "telecipher", "notification"]
}
```

`plugins/telecipher/README.md`：
```markdown
# telecipher plugin

搭配 https://github.com/im-zac/telecipher 使用。安裝 telecipher 後跑 `bun run setup` 產生 `~/.telecipher/token`，這個 skill 就能用。

Skill：`request-secret`。session 需要敏感資料時登錄需求、背景等待，值由使用者在 telecipher 頁面填入、直接寫檔。
```

`.claude-plugin/marketplace.json` 的 `plugins` 陣列加：
```json
{
  "name": "telecipher",
  "description": "session 需要 token／API key 時向 telecipher 登錄需求，使用者在 telecipher 頁面填值直接寫檔，值不經 Claude 對話。",
  "author": { "name": "im-zac", "url": "https://github.com/im-zac" },
  "source": "./plugins/telecipher",
  "category": "productivity",
  "homepage": "https://github.com/im-zac/zac-skills/tree/main/plugins/telecipher"
}
```

- [ ] **Step 4: Commit 到 zac-skills 並 push**

```bash
cd ~/.claude/plugins/marketplaces/zac-skills
git add -A
git commit -m "telecipher：新增 request-secret skill，向 telecipher 登錄 secret 需求並背景等待

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_011isrhay5op9wh4NpmsPEuu"
git push
```

- [ ] **Step 5: 安裝 plugin**

Run: `claude plugin marketplace update zac-skills && claude plugin install telecipher@zac-skills`（若 CLI 子指令名稱不同，改用 Claude Code 內的 `/plugin` 介面安裝）
Expected: 安裝成功，`ls ~/.claude/plugins/cache/zac-skills/telecipher/*/skills/request-secret/SKILL.md` 存在。

---

### Task 13: 端到端驗證

**Files:**
- Modify: `docs/superpowers/notes/2026-10-18-deploy-and-push.md`（追加端到端結果）

- [ ] **Step 1: 另開 session 走完整流程**

⚠️ 需要 Zac 操作另一個 session 與 iPhone。先把報表 `status` 改 `waiting` 並發通知。

在 tmux 開一個新 Claude Code session（cwd 任一專案），下指令：「用 telecipher:request-secret 幫我要一個 DEMO_E2E_KEY，寫到 ~/tmp/telecipher-e2e/.env，說明『端到端測試』」。
Expected：session 背景跑 `request.sh`、回報「已登錄需求」。iPhone 收到「🔑 {session} · 需要 DEMO_E2E_KEY」。

- [ ] **Step 2: 填值**

點通知 → 需求頁 → 填 `e2e-ok` → 儲存。
Expected：session 收到背景完成，最後一行 `FULFILLED <id>`，session 說「值已寫入」且**沒有**讀檔。

- [ ] **Step 3: 檢查檔案與 store**

```bash
cat ~/tmp/telecipher-e2e/.env            # DEMO_E2E_KEY="e2e-ok"
stat -f '%Lp' ~/tmp/telecipher-e2e/.env  # 600
grep -c 'e2e-ok' ~/services/telecipher/.requests.json || echo "store 無值 ✅"
grep -c 'e2e-ok' ~/services/telecipher/logs/telecipher-server.log || echo "log 無值 ✅"
rm -rf ~/tmp/telecipher-e2e
```

- [ ] **Step 4: 筆記並 Commit**

把結果追加到 notes 檔；`git commit -m "docs：端到端驗證結果"`（同樣加 Co-Authored-By 與 Claude-Session 兩行）；`git push`。
