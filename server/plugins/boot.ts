import { configure as configureRequests, load as loadRequests } from '../lib/requestStore'
import { dataFile } from '../lib/dataDir'

export default defineNitroPlugin(() => {
  configureRequests(dataFile('.requests.json'))
  loadRequests()
})
