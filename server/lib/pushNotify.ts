import webpush from 'web-push'
import { basename } from 'node:path'
import type { SecretRequest } from './types'
import { loadVapid } from './vapid'
import { all, removeByEndpoint, type PushSub } from './pushStore'

export interface NotifyPayload { title: string; body: string; tag: string; url: string; id: string }

export function buildNotification(r: SecretRequest): { title: string; body: string; tag: string; url: string } {
  const what = r.mode === 'env' && r.key ? r.key : basename(r.path)
  return { title: `🔑 ${r.session} · 需要 ${what}`, body: r.description, tag: `telecipher-${r.id}`, url: `/requests/${r.id}` }
}

export function shouldPrune(statusCode?: number): boolean { return statusCode === 404 || statusCode === 410 }

let ready = false

/**
 * VAPID subject：Apple Web Push 會驗 JWT 的 sub，`mailto:…@localhost` 回 403 BadJwtToken，
 * FCM 不檢查。預設用專案網址；可用 NUXT_TELECIPHER_PUSH_SUBJECT 覆寫（mailto: 或 https:）。
 */
export const DEFAULT_VAPID_SUBJECT = 'https://github.com/im-zac/telecipher'
export function vapidSubject(configured: string | undefined): string {
  return configured && configured.trim() ? configured.trim() : DEFAULT_VAPID_SUBJECT
}

/** 啟動時呼叫：設 VAPID；缺檔 → 推播停用，不 throw。 */
export function startPush(vapidPath: string, subject?: string): void {
  const keys = loadVapid(vapidPath)
  if (!keys) { console.warn('[push] 找不到 .vapid.json，推播停用（執行 bun run setup）'); return }
  try { webpush.setVapidDetails(vapidSubject(subject), keys.publicKey, keys.privateKey); ready = true }
  catch (e: any) { console.warn('[push] VAPID 金鑰無效，推播停用', e?.message) }
}

async function sendOne(sub: PushSub, payload: NotifyPayload): Promise<void> {
  try { await webpush.sendNotification(sub as any, JSON.stringify(payload)) }
  catch (e: any) {
    if (shouldPrune(e?.statusCode)) await removeByEndpoint(sub.endpoint)
    else console.warn('[push] 送出失敗', e?.statusCode ?? e?.message)
  }
}

export async function sendToAll(payload: NotifyPayload): Promise<void> {
  if (!ready) return
  await Promise.all(all().map((s) => sendOne(s, payload)))
}
