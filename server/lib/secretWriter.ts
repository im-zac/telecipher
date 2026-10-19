import { mkdir, open, rename, readFile, chmod, lstat, unlink } from 'node:fs/promises'
import { readdirSync, unlinkSync } from 'node:fs'
import { randomBytes } from 'node:crypto'
import { dirname, join } from 'node:path'
import { upsertEnvLine } from './envfile'

/** 同一路徑的讀改寫串行化：並發 upsert 不會互相蓋掉。 */
const locks = new Map<string, Promise<unknown>>()
export async function withPathLock<T>(path: string, fn: () => Promise<T>): Promise<T> {
  const prev = locks.get(path) ?? Promise.resolve()
  const run = prev.catch(() => {}).then(fn)
  locks.set(path, run)
  try { return await run } finally { if (locks.get(path) === run) locks.delete(path) }
}

/** 寫到唯一名稱的 tmp 再 rename。tmp 以 0600 建立；父目錄不存在就 0700 建。 */
export async function atomicWrite(path: string, data: string, mode = 0o600): Promise<void> {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 })
  // 唯一 tmp 名：並發寫同一路徑不會撞 EEXIST；O_EXCL 保證絕不寫穿既有路徑或被植入的 symlink。
  const tmp = `${path}.${process.pid}.${randomBytes(6).toString('hex')}.tmp`
  const fh = await open(tmp, 'wx', mode)
  try {
    await fh.writeFile(data, 'utf8')
    await fh.sync()
  } finally { await fh.close() }
  try { await rename(tmp, path) } catch (e) { await unlink(tmp).catch(() => {}); throw e }
  await chmod(path, mode)   // rename 不改既有檔的 mode，這裡保證 0600
}

/** atomicWrite 寫自家資料檔時，若程序在 rename 前中斷留下的 tmp 名稱。 */
const STALE_TMP_RE = /^\.(requests|push-subscriptions|vapid)\.json\.\d+\.[a-z0-9]+\.tmp$/

/**
 * 啟動時清掉 data dir 裡自家資料檔的殘留 tmp。只比對上面三種檔名，不碰使用者目標檔。
 * 同步執行：boot plugin 在載入 store 之前呼叫。回傳刪掉的檔名。
 */
export function sweepStaleTmp(dir: string): string[] {
  let names: string[]
  try { names = readdirSync(dir) } catch { return [] }
  const removed: string[] = []
  for (const name of names) {
    if (!STALE_TMP_RE.test(name)) continue
    try { unlinkSync(join(dir, name)); removed.push(name) } catch { /* 已被刪或無權限：略過 */ }
  }
  return removed
}

/** file 模式：整檔寫入。目標已存在 → throw { code: 'EEXIST' }。 */
export async function writeSecretFile(path: string, value: string): Promise<void> {
  return withPathLock(path, async () => {
    const st = await lstat(path).catch((e: any) => (e?.code === 'ENOENT' ? null : Promise.reject(e)))
    if (st) { const err: any = new Error('目標檔已存在'); err.code = 'EEXIST'; throw err }
    await atomicWrite(path, value)
  })
}

/** env 模式：讀現有內容（無檔視為空）→ upsert → 原子寫回。同路徑串行。 */
export async function writeSecretEnvKey(path: string, key: string, value: string): Promise<void> {
  return withPathLock(path, async () => {
    const current = await readFile(path, 'utf8').catch((e: any) => (e?.code === 'ENOENT' ? '' : Promise.reject(e)))
    await atomicWrite(path, upsertEnvLine(current, key, value))
  })
}
