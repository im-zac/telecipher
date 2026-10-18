import { cancel } from '../../lib/requestStore'

export default defineEventHandler(async (event) => {
  try { await cancel(getRouterParam(event, 'id') ?? '') }
  catch (e: any) { if (e?.code === 'NOT_FOUND') throw createError({ statusCode: 404, statusMessage: 'not found' }); throw e }
  setResponseStatus(event, 204)
  return null
})
