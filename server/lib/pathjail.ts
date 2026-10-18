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
  // macOS 預設檔案系統不分大小寫：~/.SSH 就是 ~/.ssh。拒絕清單一律小寫比對。
  const relLower = rel.toLowerCase()
  if (DENY_PREFIXES.some((d) => relLower === d.toLowerCase() || relLower.startsWith(d.toLowerCase() + sep))) return { ok: false, reason: `路徑在拒絕清單（${rel.split(sep)[0]}）` }
  if (DENY_PATTERNS.some((re) => re.test(relLower))) return { ok: false, reason: '路徑在拒絕清單（.claude/settings*）' }
  if (opts.repoDir) {
    const repoReal = await realpath(opts.repoDir).catch(() => resolve(opts.repoDir!))
    if (under(repoReal, abs)) return { ok: false, reason: '路徑在拒絕清單（telecipher 自己的目錄）' }
  }

  // 由 home 往下逐層檢查：存在的每一層都不能是 symlink；目標存在時依 mode 決定。
  const parts = rel.split(sep)
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
