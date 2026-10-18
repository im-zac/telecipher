import { get, markFulfilled } from '../../../lib/requestStore'
import { writeSecretFile, writeSecretEnvKey } from '../../../lib/secretWriter'
import { resolveTarget } from '../../../lib/pathjail'

export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id') ?? ''
  const r = get(id)
  if (!r) throw createError({ statusCode: 404, statusMessage: 'not found' })
  if (r.status !== 'pending') throw createError({ statusCode: 409, statusMessage: 'already processed' })
  const body = await readBody<{ value?: unknown }>(event).catch(() => ({} as { value?: unknown }))
  const value = body.value
  if (typeof value !== 'string' || value.length === 0) throw createError({ statusCode: 400, statusMessage: 'value required' })

  // 登錄到填值可能隔很久（TOCTOU）：寫檔前重跑一次路徑檢查，中間被植入 symlink 或 file 目標出現都擋下。
  const recheck = await resolveTarget(useRuntimeConfig().telecipherHome, r.path, r.mode, { repoDir: process.cwd() })
  if (!recheck.ok || recheck.path !== r.path) {
    console.warn('[fulfill] 路徑重檢失敗', r.path, recheck.ok ? 'path changed' : recheck.reason)
    throw createError({ statusCode: 500, statusMessage: 'write failed', data: { reason: recheck.ok ? '路徑解析結果改變' : recheck.reason } })
  }
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
