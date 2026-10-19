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
 * 其他行（含註解、空行）原樣；既有同名 key 替換第一個、刪掉其餘；保留 `export `。
 * 檔案含 CRLF 時，替換與新增的行也用 CRLF，不混成 LF。
 */
export function upsertEnvLine(content: string, key: string, value: string): string {
  const lineRe = new RegExp('^\\s*(export\\s+)?' + key + '\\s*=')
  const cr = content.includes('\r\n') ? '\r' : ''   // 依 '\n' 切行，CRLF 檔的每行尾巴帶 '\r'
  const lines = content.split('\n')
  if (lines[lines.length - 1] === '') lines.pop()   // 檔尾有換行 → 去掉空尾元素；最後統一補行尾
  else if (cr && lines.length && !lines[lines.length - 1]!.endsWith('\r')) lines[lines.length - 1] += '\r'   // CRLF 檔尾無換行
  let replaced = false
  const out: string[] = []
  for (const line of lines) {
    if (lineRe.test(line.replace(/\r$/, ''))) {
      if (replaced) continue
      const exp = /^\s*export\s+/.test(line) ? 'export ' : ''
      out.push(`${exp}${key}=${quote(value)}${cr}`)
      replaced = true
    } else out.push(line)
  }
  if (!replaced) out.push(`${key}=${quote(value)}${cr}`)
  return out.join('\n') + '\n'
}
