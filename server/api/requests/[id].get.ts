import { get } from '../../lib/requestStore'

export default defineEventHandler((event) => {
  const r = get(getRouterParam(event, 'id') ?? '')
  if (!r) throw createError({ statusCode: 404, statusMessage: 'not found' })
  return r
})
