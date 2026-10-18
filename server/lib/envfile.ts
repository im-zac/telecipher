const KEY_RE = /^[A-Za-z_][A-Za-z0-9_]*$/

export function isValidEnvKey(key: string): boolean { return KEY_RE.test(key) }

/**
 * 含 $ 或反引號的值：多數 .env 解析器（dotenv、c12、docker compose、shell source）在雙引號內會展開它們，
 * 所以改用單引號（內容原樣、不跳脫）；值同時含 ' 或換行時退回雙引號並把 $ 與反引號也跳脫。
 */
function quote(value: string): string {
  const risky = /[$`]/.test(value)
  if (risky && !/['\r\n]/.test(value)) return "'" + value + "'"
  let v = value.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\r?\n/g, '\\n')
  if (risky) v = v.replace(/\$/g, '\\$').replace(/`/g, '\\`')
  return '"' + v + '"'
}

/**
 * 在 env 檔內 upsert 一行 `KEY="value"`。
 * 其他行（含註解、空行、CRLF）原樣；既有同名 key 替換第一個、刪掉其餘；保留 `export `。
 */
export function upsertEnvLine(content: string, key: string, value: string): string {
  const lineRe = new RegExp('^\\s*(export\\s+)?' + key + '\\s*=')
  const lines = content.split('\n')
  if (lines[lines.length - 1] === '') lines.pop()   // 檔尾有換行 → 去掉空尾元素；最後統一補 LF
  let replaced = false
  const out: string[] = []
  for (const line of lines) {
    if (lineRe.test(line.replace(/\r$/, ''))) {
      if (replaced) continue
      const exp = /^\s*export\s+/.test(line) ? 'export ' : ''
      out.push(`${exp}${key}=${quote(value)}`)
      replaced = true
    } else out.push(line)
  }
  if (!replaced) out.push(`${key}=${quote(value)}`)
  return out.join('\n') + '\n'
}
