import { loadVapid } from '../../lib/vapid'
import { dataFile } from '../../lib/dataDir'

export default defineEventHandler(() => ({ key: loadVapid(dataFile('.vapid.json'))?.publicKey ?? null }))
