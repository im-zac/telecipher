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

/** 啟動時呼叫：設 VAPID；缺檔 → 推播停用，不 throw。 */
export function startPush(vapidPath: string): void {
  const keys = loadVapid(vapidPath)
  if (!keys) { console.warn('[push] 找不到 .vapid.json，推播停用（執行 bun run setup）'); return }
  try { webpush.setVapidDetails('mailto:telecipher@localhost', keys.publicKey, keys.privateKey); ready = true }
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
