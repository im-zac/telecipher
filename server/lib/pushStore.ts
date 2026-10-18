import { readFileSync } from 'node:fs'
import { atomicWrite, withPathLock } from './secretWriter'

export interface PushSub { endpoint: string; keys: { p256dh: string; auth: string }; [k: string]: unknown }

let subs = new Map<string, PushSub>()
let filePath = '.push-subscriptions.json'

export function configure(path: string): void { filePath = path }

/** 啟動時載入；不存在或毀損 → 視為空清單（毀損時 log 警告，不覆寫）。 */
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
async function persist(): Promise<void> { const snap = JSON.stringify([...subs.values()], null, 2) + '\n'; await withPathLock(filePath, () => atomicWrite(filePath, snap, 0o600)) }

/** 測試用。 */
export function __reset(): void { subs = new Map(); filePath = '.push-subscriptions.json' }
