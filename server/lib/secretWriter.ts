import { mkdir, open, rename, readFile, chmod, lstat, unlink } from 'node:fs/promises'
import { dirname } from 'node:path'
import { upsertEnvLine } from './envfile'

/** `.tmp` 寫完 rename。tmp 以 0600 建立；父目錄不存在就 0700 建。 */
export async function atomicWrite(path: string, data: string, mode = 0o600): Promise<void> {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 })
  const tmp = path + '.tmp'
  // 先移掉任何殘留／被植入的 tmp（unlink 不跟 symlink），再以 O_EXCL 建立：絕不寫穿既有路徑。
  await unlink(tmp).catch((e: any) => (e?.code === 'ENOENT' ? null : Promise.reject(e)))
  const fh = await open(tmp, 'wx', mode)
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
