# telecipher

個人敏感資料交付站：其他 Claude Code session 登錄「我需要某個 token」，Zac 收 Web Push、在頁面填值，server 直接寫進目標檔。值不經 Claude context。

- 設計：`docs/superpowers/specs/2026-10-18-telecipher-design.md`
- 計畫：`docs/superpowers/plans/`
- 踩雷與根因：`docs/superpowers/notes/`

## 技術棧

Nuxt 4 flat layout（`~` = repo root，無 `app/`）、SPA（`ssr:false`）＋Nitro `node-server`、Vitest。**Node runtime；bun 只當 package manager**（`bun run <script>`，不加 `--bun`）。daemon 的 node 由 `run.sh` 挑：`TELECIPHER_NODE` → nvm 最新版 → PATH → brew；目前跑 nvm 的 Node 24。

## 指令

```bash
bun run dev      # 127.0.0.1:9877，需 NUXT_TELECIPHER_TOKEN
bun run build    # → .output/
bun run test     # vitest（含 e2e，會 build 一次 nuxt）
bun run setup    # 產 .token、.vapid.json、~/.telecipher/token（皆 0600）
```

## 安全邊界（改之前先讀）

- 邊界是 Claude 的對話紀錄，不是檔案系統。API 永不回傳值、log 不印 body、`.requests.json` 只存 metadata。
- server 只綁 127.0.0.1:9877；對外走 Tailscale Serve :8444。
- 所有自家檔案 0600、原子寫（`server/lib/secretWriter.ts` 的 `atomicWrite`）。寫目標檔 0600、父目錄 0700。
- 路徑走 `server/lib/pathjail.ts`：$HOME 內、拒 symlink、拒絕清單。file 模式不覆蓋。
- 資料檔目錄由 `NUXT_TELECIPHER_DATA_DIR` 決定（空 = repo 根）。e2e 測試一定要導去 tmp，否則會動到 production 的 store 與訂閱、真的推播。

## 部署

見 README「部署」。重部署：`bun run build && sudo launchctl kickstart -k system/com.telecipher.server`。

## 慣例

commit message 繁體中文。新功能先 TDD。前端靠 Claude in Chrome 實機驗證。
