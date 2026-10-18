import type { SecretRequest } from './types'
import { buildNotification, sendToAll } from './pushNotify'

/** 新需求建立 → 推播給所有訂閱裝置。payload 只含 metadata。 */
export async function notifyNewRequest(r: SecretRequest): Promise<void> {
  await sendToAll({ ...buildNotification(r), id: r.id })
}
