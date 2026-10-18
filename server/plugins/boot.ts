import { configure as configureRequests, load as loadRequests } from '../lib/requestStore'
import { configure as configureSubs, load as loadSubs } from '../lib/pushStore'
import { startPush } from '../lib/pushNotify'
import { dataFile } from '../lib/dataDir'

export default defineNitroPlugin(() => {
  configureRequests(dataFile('.requests.json'))
  loadRequests()
  configureSubs(dataFile('.push-subscriptions.json'))
  loadSubs()
  startPush(dataFile('.vapid.json'))
})
