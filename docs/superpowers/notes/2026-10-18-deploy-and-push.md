# 部署與推播實測（2026-10-18）

## 結果

- `deploy/install-launchd.sh` 由 Zac 以 sudo 執行。`launchctl print system/com.telecipher.server` → `state = running`。
- `http://127.0.0.1:9877/api/health` 帶 token → 200；`https://m1-pro.tail521001.ts.net:8444/login` → 200。
- Zac 先在筆電 m3-air 用 Chrome 安裝 PWA（非 iPhone），點鈴鐺訂閱後 `.push-subscriptions.json` 有 2 筆（FCM endpoint）。
- 用 curl 建一筆 env 模式需求（`PUSH_TEST_KEY` → `~/tmp/telecipher-push-test/.env`）。Chrome 桌面通知跳出，點入需求頁填值後顯示「已寫入」。
- 驗證：目錄 `0700`、檔 `0600`、`.requests.json` 無 `value` 欄位、`logs/telecipher-server.log` 不含值或 key 名、API 回 `status: fulfilled`。

## 注意

- launchd 的 stdout/stderr 導到 `logs/telecipher-server.log`（repo 內，已 gitignore）。正常只有一行 `Listening on http://127.0.0.1:9877`；推播成功不留 log，失敗才會印。
- iPhone PWA 尚未實測；Web Push 在 iOS 需「加入主畫面」後從主畫面開啟才能訂閱。流程與桌面相同。

## Skill 端對端（Task 13）

- 用已安裝 plugin `telecipher@zac-skills` 的 `scripts/request.sh` 對 production daemon 登錄 `DEMO_E2E_KEY` → `~/tmp/telecipher-e2e/.env`，`run_in_background` 等待。
- Chrome PWA 收到推播，Zac 填值送出。腳本 stdout：`REGISTERED kvhe3kgcvu2i …` 然後 `FULFILLED kvhe3kgcvu2i`，exit 0。
- 驗證同上：目錄 `0700`、檔 `0600`、store 與 log 無值。
- 本次由 telecipher 自己的 session 執行腳本，而非另開 Claude Code session；plugin 載入到 skill 觸發這段靠 `SKILL.md` 描述，未在本次實測。

## iPhone PWA：Apple 回 403 BadJwtToken（2026-10-19）

- 現象：iPhone 裝 PWA、訂閱成功（endpoint `web.push.apple.com`），但送推播 log 印 `[push] 送出失敗 403`。FCM（Chrome）正常。
- 根因：VAPID subject 寫死 `mailto:telecipher@localhost`。Apple 驗 JWT 的 `sub`，不接受 localhost 這種無效 mailto；回 body `{"reason":"BadJwtToken"}`。FCM 不檢查 subject。
- 驗證：用 web-push 直接對同一 Apple endpoint 送，subject 換成 `https://github.com/im-zac/telecipher` → 201。
- 修法：`vapidSubject()` 預設 https 專案網址，可用 `NUXT_TELECIPHER_PUSH_SUBJECT` 覆寫。重部署後 iPhone 收到。
