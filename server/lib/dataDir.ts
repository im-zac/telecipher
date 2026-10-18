import { join } from 'node:path'

/** 資料檔目錄：runtimeConfig.telecipherDataDir，空 = server cwd（repo 根）。 */
export function dataDir(): string { return useRuntimeConfig().telecipherDataDir || process.cwd() }
export function dataFile(name: string): string { return join(dataDir(), name) }
