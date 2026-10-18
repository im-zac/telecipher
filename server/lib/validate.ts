import type { WriteMode } from './types'
import { isValidEnvKey } from './envfile'

export interface CreateInput { session: string; path: string; mode: WriteMode; key?: string; description: string }
export type ValidateResult = { ok: true; value: CreateInput } | { ok: false; reason: string }

export function validateCreate(body: unknown): ValidateResult {
  if (!body || typeof body !== 'object') return { ok: false, reason: 'body 必須是 JSON 物件' }
  const b = body as Record<string, unknown>
  const session = typeof b.session === 'string' ? b.session.trim() : ''
  if (!session || session.length > 80) return { ok: false, reason: 'session 需為 1–80 字' }
  const description = typeof b.description === 'string' ? b.description.trim() : ''
  if (!description || description.length > 500) return { ok: false, reason: 'description 需為 1–500 字' }
  if (typeof b.path !== 'string') return { ok: false, reason: 'path 需為字串' }
  if (b.mode !== 'file' && b.mode !== 'env') return { ok: false, reason: 'mode 需為 file 或 env' }
  const value: CreateInput = { session, path: b.path, mode: b.mode, description }
  if (b.mode === 'env') {
    if (typeof b.key !== 'string' || !isValidEnvKey(b.key)) return { ok: false, reason: 'env 模式的 key 需符合 ^[A-Za-z_][A-Za-z0-9_]*$' }
    value.key = b.key
  }
  return { ok: true, value }
}
