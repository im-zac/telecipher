import { readFileSync } from 'node:fs'

export interface VapidKeys { publicKey: string; privateKey: string }

let cache: VapidKeys | null | undefined   // undefined = 尚未載入

/** 直接讀檔解析，不快取；檔不存在／毀損／欄位不全 → null。 */
export function readVapid(path: string): VapidKeys | null {
  try {
    const o = JSON.parse(readFileSync(path, 'utf8'))
    return typeof o?.publicKey === 'string' && typeof o?.privateKey === 'string' ? { publicKey: o.publicKey, privateKey: o.privateKey } : null
  } catch { return null }
}

/** memoized 載入。 */
export function loadVapid(path = '.vapid.json'): VapidKeys | null { if (cache === undefined) cache = readVapid(path); return cache }

/** 測試用。 */
export function __resetVapid(): void { cache = undefined }
