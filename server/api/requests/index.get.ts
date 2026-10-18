import { list } from '../../lib/requestStore'

export default defineEventHandler((event) => {
  const q = getQuery(event)
  const status = q.status === 'pending' || q.status === 'done' ? q.status : undefined
  return { requests: list(status) }
})
