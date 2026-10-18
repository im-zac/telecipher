import { waitFor } from '../../../lib/requestStore'

export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id') ?? ''
  const raw = Number(getQuery(event).timeout ?? 55)
  const sec = Number.isFinite(raw) ? Math.min(55, Math.max(1, Math.floor(raw))) : 55
  const r = await waitFor(id, sec * 1000)
  if (!r) throw createError({ statusCode: 404, statusMessage: 'not found' })
  return { id: r.id, status: r.status, ...(r.fulfilledAt ? { fulfilledAt: r.fulfilledAt } : {}) }
})
