import { configure as configureRequests, load as loadRequests } from '../lib/requestStore'
import { configure as configureSubs, load as loadSubs } from '../lib/pushStore'
import { startPush } from '../lib/pushNotify'
import { dataDir, dataFile } from '../lib/dataDir'
import { sweepStaleTmp } from '../lib/secretWriter'

export default defineNitroPlugin(() => {
  const swept = sweepStaleTmp(dataDir())
  if (swept.length) console.log('[boot] 清掉殘留 tmp', swept.length, '個')
  configureRequests(dataFile('.requests.json'))
  loadRequests()
  configureSubs(dataFile('.push-subscriptions.json'))
  loadSubs()
  startPush(dataFile('.vapid.json'), useRuntimeConfig().telecipherPushSubject)
})
