// 一次性：產 .token、.vapid.json、~/.telecipher/token。已存在的一律跳過，不重產。
import { existsSync, mkdirSync, writeFileSync, chmodSync, readFileSync } from 'node:fs'
import { randomBytes } from 'node:crypto'
import { join } from 'node:path'
import { homedir } from 'node:os'
import webpush from 'web-push'

function writeSecret(path, data) {
  writeFileSync(path, data, { mode: 0o600 }); chmodSync(path, 0o600)
}

if (!existsSync('.token')) { writeSecret('.token', randomBytes(32).toString('hex') + '\n'); console.log('.token 已產生') }
else console.log('.token 已存在，跳過')

if (!existsSync('.vapid.json')) { writeSecret('.vapid.json', JSON.stringify(webpush.generateVAPIDKeys(), null, 2) + '\n'); console.log('.vapid.json 已產生（請勿重產，會讓訂閱失效）') }
else console.log('.vapid.json 已存在，跳過')

const dir = join(homedir(), '.telecipher')
mkdirSync(dir, { recursive: true, mode: 0o700 }); chmodSync(dir, 0o700)
const tokenPath = join(dir, 'token')
const token = readFileSync('.token', 'utf8')
if (!existsSync(tokenPath) || readFileSync(tokenPath, 'utf8') !== token) { writeSecret(tokenPath, token); console.log(`${tokenPath} 已寫入`) }
else console.log(`${tokenPath} 已同步，跳過`)
