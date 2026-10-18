const KEY_RE = /^[A-Za-z_][A-Za-z0-9_]*$/

export function isValidEnvKey(key: string): boolean { return KEY_RE.test(key) }

function quote(value: string): string {
  return '"' + value.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\r?\n/g, '\\n') + '"'
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
