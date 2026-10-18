import { removeByEndpoint } from '../../lib/pushStore'

export default defineEventHandler(async (event) => {
  const body = await readBody(event).catch(() => null) as { endpoint?: string } | null
  if (!body?.endpoint) throw createError({ statusCode: 400, statusMessage: 'missing endpoint' })
  await removeByEndpoint(body.endpoint)
  setResponseStatus(event, 204)
  return null
})
