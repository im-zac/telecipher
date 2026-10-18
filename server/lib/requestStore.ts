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
    const fn = (done: SecretRequest) => { clearTimeout(timer); resolve(done) }
    const timer = setTimeout(() => { set.delete(fn); if (!set.size) waiters.delete(id); resolve(get(id)) }, timeoutMs)
    set.add(fn)
  })
}

/** 測試用。 */
export function __reset(): void { items = []; waiters.clear(); filePath = '.requests.json' }
