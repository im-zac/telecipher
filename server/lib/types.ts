export type RequestStatus = 'pending' | 'fulfilled' | 'cancelled'
export type WriteMode = 'file' | 'env'

export interface SecretRequest {
  id: string
  session: string
  path: string          // resolve 後絕對路徑
  mode: WriteMode
  key?: string
  description: string
  status: RequestStatus
  createdAt: string     // UTC ISO
  fulfilledAt?: string
}
