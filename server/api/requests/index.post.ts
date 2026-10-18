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
