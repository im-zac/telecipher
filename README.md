# telecipher

個人敏感資料交付站。其他 Claude Code session 需要 token／API key 時，用 `telecipher` skill 登錄需求；你收到 Web Push，在頁面填值，server 直接寫進目標檔。**值不經 Claude 的對話紀錄。**

## 流程

1. session 載入 skill → `request.sh` → `POST /api/requests`（session、路徑、mode、說明）。
2. telecipher 推播「🔑 {session} · 需要 {key}」。
3. 點通知 → 需求頁 → 填值 → 儲存。server 以 0600 寫入（`file` 整檔／`env` upsert 一個 key）。
4. session 的 `request.sh` long-poll 到 `fulfilled`，繼續工作。session 不讀檔內容。

## 安裝（m1-pro）

    bun install
    bun run build
    bun run setup                 # .token、.vapid.json、~/.telecipher/token（皆 0600）
    deploy/install-launchd.sh     # LaunchDaemon com.telecipher.server，127.0.0.1:9877
    /Applications/Tailscale.app/Contents/MacOS/Tailscale serve --bg --https=8444 http://127.0.0.1:9877

瀏覽器開 `https://<host>.ts.net:8444`，貼 `.token` 內容登入。iPhone／macOS 要收通知：加到主畫面／程式塢後，點右上鈴鐺。

## 重部署

    bun run build && sudo launchctl kickstart -k system/com.telecipher.server

## 開發

    NUXT_TELECIPHER_TOKEN=devtoken bun run dev     # 127.0.0.1:9877
    bun run test

## 安全邊界

見 `docs/superpowers/specs/2026-10-18-telecipher-design.md`〈安全模型〉。
