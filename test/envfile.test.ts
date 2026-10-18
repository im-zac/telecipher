import { describe, it, expect } from 'vitest'
import { upsertEnvLine, isValidEnvKey } from '../server/lib/envfile'

describe('upsertEnvLine', () => {
  it('空檔 → 一行', () => {
    expect(upsertEnvLine('', 'A', 'x')).toBe('A="x"\n')
  })
  it('append 到檔尾，保留其他行', () => {
    expect(upsertEnvLine('# c\nB=1\n', 'A', 'x')).toBe('# c\nB=1\nA="x"\n')
  })
  it('檔尾無換行先補', () => {
    expect(upsertEnvLine('B=1', 'A', 'x')).toBe('B=1\nA="x"\n')
  })
  it('覆蓋既有 key，位置不變', () => {
    expect(upsertEnvLine('A=old\nB=1\n', 'A', 'new')).toBe('A="new"\nB=1\n')
  })
  it('保留 export 前綴', () => {
    expect(upsertEnvLine('export A=old\n', 'A', 'new')).toBe('export A="new"\n')
  })
  it('key 前後空白的既有行也算同一 key', () => {
    expect(upsertEnvLine('  A = old\n', 'A', 'new')).toBe('A="new"\n')
  })
  it('不誤中前綴相同的 key', () => {
    expect(upsertEnvLine('AB=1\n', 'A', 'x')).toBe('AB=1\nA="x"\n')
  })
  it('跳脫 " 與 \\，換行寫成 \\n', () => {
    expect(upsertEnvLine('', 'A', 'a"b\\c\nd')).toBe('A="a\\"b\\\\c\\nd"\n')
  })
  it('CRLF 檔：其他行原樣，新行用 LF', () => {
    expect(upsertEnvLine('B=1\r\n', 'A', 'x')).toBe('B=1\r\nA="x"\n')
  })
  it('只有註解的檔', () => {
    expect(upsertEnvLine('# only\n', 'A', 'x')).toBe('# only\nA="x"\n')
  })
  it('同 key 出現多次只改第一個，其餘刪除', () => {
    expect(upsertEnvLine('A=1\nB=2\nA=3\n', 'A', 'x')).toBe('A="x"\nB=2\n')
  })
})

describe('isValidEnvKey', () => {
  it.each(['A', 'a_b', '_X1', 'OPENAI_API_KEY'])('接受 %s', (k) => expect(isValidEnvKey(k)).toBe(true))
  it.each(['', '1A', 'A-B', 'A B', 'A=', 'é'])('拒絕 %j', (k) => expect(isValidEnvKey(k)).toBe(false))
})

describe('含 $ 或反引號的值', () => {
  it('值含 $ → 用單引號包，不跳脫', () => {
    expect(upsertEnvLine('', 'A', 'pa$$word')).toBe("A='pa$$word'\n")
  })
  it('值含反引號 → 用單引號包', () => {
    expect(upsertEnvLine('', 'A', 'a`b')).toBe("A='a`b'\n")
  })
  it("值含 $ 又含 ' → 退回雙引號並跳脫 $", () => {
    expect(upsertEnvLine('', 'A', "it's $1")).toBe('A="it\'s \\$1"\n')
  })
  it('值含 $ 又含換行 → 雙引號、\\n、跳脫 $', () => {
    expect(upsertEnvLine('', 'A', 'a$\nb')).toBe('A="a\\$\\nb"\n')
  })
})
