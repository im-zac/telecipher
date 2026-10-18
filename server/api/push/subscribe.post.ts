import { add, type PushSub } from '../../lib/pushStore'

export default defineEventHandler(async (event) => {
  const body = await readBody(event).catch(() => null) as PushSub | null
  if (!body?.endpoint || !body?.keys?.p256dh || !body?.keys?.auth) throw createError({ statusCode: 400, statusMessage: 'invalid subscription' })
  await add(body)
  setResponseStatus(event, 204)
  return null
})
