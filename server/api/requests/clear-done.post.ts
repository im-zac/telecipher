import { clearDone } from '../../lib/requestStore'

export default defineEventHandler(async () => ({ removed: await clearDone() }))
