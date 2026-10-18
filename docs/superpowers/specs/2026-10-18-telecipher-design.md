# telecipher 設計

> **一句話目標：** 其他 Claude Code session 需要 token／API key 等敏感資料時，向 telecipher 登錄一筆需求；telecipher 推播通知 Zac，Zac 在頁面輸入值，telecipher 直接把值寫進目標檔。值從頭到尾不經過 Claude 的對話紀錄。

日期：2026-10-18。狀態：設計定案，待寫實作計畫。

## 背景

- 現況：session 需要 secret 時，使用者只能把值貼進終端機。值會進 Claude 的 context、transcript、可能進 log。
- telecipher 是單人 web app，只透過 tailnet 給 Zac 用。架構照 `~/services/teledeck`（Nuxt 4 flat layout、SPA＋Nitro node-server、Vitest、launchd）。
- teledeck 已有 Web Push（VAPID＋service worker）、cookie token 認證、pathjail、Tailscale Serve HTTPS。telecipher 直接沿用這些做法。
- repo 公開在 GitHub（`im-zac/telecipher`）。repo 內不放任何主機專屬資料。

## 決策摘要

| 項目 | 決策 |
|--|--|
| Stack | Nuxt 4（flat layout、`ssr: false`、Nitro `node-server`）、Vitest、bun 當 package manager、Node runtime |
| 寫檔模式 | `file`（整檔）與 `env`（在 env 檔 upsert 單一 key）兩種 |
| Skill 位置 | `im-zac/zac-skills` 新 plugin `plugins/telecipher` |
| 通知 | Web Push（PWA＋service worker＋VAPID），照 teledeck |
| 對外 | server 綁 `127.0.0.1:9877`；Tailscale Serve `https://m1-pro.tail521001.ts.net:8444` → `127.0.0.1:9877` |
| 認證 | 瀏覽器：`.token`＋cookie `telecipher_token`。skill：header `x-telecipher-token`，只從 loopback 打 |
| 持久化 | `.requests.json`（只有 metadata，0600，原子寫） |

## 安全模型

**邊界是 Claude 的對話紀錄，不是檔案系統。** 所有 session 都以 zac 執行，檔案寫到哪 session 都讀得到。telecipher 保證的是：值不經過 Claude 的 context、不進任何 log、不存在 telecipher 的資料檔。

規則：

1. API 永不回傳值。建立、查狀態、列表、wait 都只有 metadata。
2. `.requests.json` 只存 metadata。`fulfill` 處理完就丟掉值，不留在記憶體變數之外。
3. 任何 log 不印 body。`fulfill` 的錯誤訊息只含路徑與錯誤類型。
4. server 只 listen `127.0.0.1`。tailnet 存取一律經 Tailscale Serve。
5. telecipher 自己的檔案（`.token`、`.vapid.json`、`.push-subscriptions.json`、`.requests.json`、`~/.telecipher/token`）全部 0600。寫檔用 `.tmp`＋`rename`。
6. 寫進目標檔：mode 0600。父目錄不存在就建，mode 0700。
7. 路徑檢查（`server/lib/pathjail.ts`，照 teledeck）：`path.resolve` 收 `..`、realpath、必須在 `$HOME` 底下。另加：
   - 目標檔或任一父層是 symlink → 拒絕。
   - 拒絕清單（resolve 後比對前綴）：`~/.ssh`、`~/.gnupg`、`~/.claude/settings*`、`~/.zshrc`、`~/.zprofile`、`~/.bashrc`、`~/.bash_profile`、`~/.profile`、`~/Library`、telecipher 自己的 repo 目錄。
   - `file` 模式目標已存在 → 拒絕（不覆蓋）。
8. 頁面與 API 回傳的路徑都是 **resolve 後的絕對路徑**。Zac 看到的就是會寫的位置。
9. skill 明文禁止 session 在完成後 `cat`、`Read`、`echo` 目標檔。要用值就讓程式在 runtime 讀檔或讀 env。

非目標：Tailscale 身分驗證、加密儲存、讀回或輪替 secret、多使用者。

## 資料模型

```ts
type RequestStatus = 'pending' | 'fulfilled' | 'cancelled'
type WriteMode = 'file' | 'env'

interface SecretRequest {
  id: string            // 12 碼 base32，由 server 產生
  session: string       // 登錄方的 session 名稱（1–80 字）
  path: string          // resolve 後的絕對路徑
  mode: WriteMode
  key?: string          // mode=env 必填；^[A-Za-z_][A-Za-z0-9_]*$
  description: string   // 簡短說明（1–500 字）
  status: RequestStatus
  createdAt: string     // UTC ISO
  fulfilledAt?: string  // fulfilled 或 cancelled 的時間
}
```

- 檔案：`<repo>/.requests.json`，`{ requests: SecretRequest[] }`。
- 毀損檔讀取失敗 → 視為空清單＋log 警告，不覆寫（照 teledeck pushStore）。
- 已處理項目保留 metadata。列表預設顯示最近 50 筆已處理，提供「清除已處理」刪掉所有非 pending 項目。

## 寫檔模式

| mode | 行為 |
|--|--|
| `file` | 整檔寫入值（原樣，不加換行）。登錄時目標已存在 → 400。fulfill 時目標已存在（登錄後才出現）→ 500，需求維持 pending，頁面顯示錯誤。 |
| `env` | 在目標檔內 upsert 一行 `KEY="value"`。檔不存在就建。其他行、註解、空行、順序原樣保留。既有同名 key（含 `export KEY=` 形式）→ 替換該行，保留 `export ` 前綴。值一律雙引號包，跳脫 `\` 與 `"`，換行寫成 `\n`。檔尾沒有換行先補一個再 append。 |

`env` upsert 抽成純函式 `upsertEnvLine(content, key, value): string`，可單測。

## 元件與檔案

```
server/
  middleware/auth.ts          gate /api/*（cookie 或 header token）；/login、/api/login、/sw.js、/_nuxt、icons 放行
  utils/authz.ts              isAuthorized（timingSafeEqual）
  api/login.post.ts           token → cookie（照 teledeck）
  api/requests/index.get.ts   列表（metadata）
  api/requests/index.post.ts  登錄需求：validate → pathjail → store.add → pushNotify
  api/requests/[id].get.ts    單筆 metadata
  api/requests/[id].delete.ts session 放棄 → cancelled
  api/requests/[id]/wait.get.ts     long-poll
  api/requests/[id]/fulfill.post.ts 寫檔 → fulfilled → 喚醒 waiter
  api/requests/clear-done.post.ts   清除已處理
  api/push/{vapid-public-key.get,subscribe.post,unsubscribe.post}.ts  照 teledeck
  lib/pathjail.ts             resolveTarget(rawPath, mode) → { ok, path } | { ok:false, reason }
  lib/envfile.ts              upsertEnvLine
  lib/secretWriter.ts         writeFile / writeEnvKey（0600、原子、建父目錄 0700）
  lib/requestStore.ts         load / add / get / list / fulfill / cancel / clearDone / waitFor(id, timeoutMs)
  lib/{pushStore,pushNotify,vapid}.ts  照 teledeck 搬，pushNotify 只剩「新需求」一種觸發
  plugins/push.ts             boot：store.load、pushStore.load
composables/
  useRequests.ts              列表、單筆、fulfill、clearDone
  usePush.ts                  照 teledeck（鈴鐺四態）
pages/
  index.vue                   待處理／已處理兩區＋鈴鐺＋清除已處理
  requests/[id].vue           需求頁：顯示四項、textarea、儲存
  login.vue                   貼 token
public/
  sw.js、manifest.webmanifest、icons   照 teledeck，去掉前景抑制
plugins/push.client.ts        註冊 SW、處理 notificationclick 的 openRequest 訊息
deploy/
  com.telecipher.server.plist 路徑由 install 腳本代入，不寫死
  install-launchd.sh / uninstall-launchd.sh
scripts/
  setup.mjs                   產 .token、.vapid.json、寫 ~/.telecipher/token（全 0600）；已存在就跳過
run.sh                        進版控；讀 .token，HOST=127.0.0.1 PORT=9877，supervisor 迴圈
test/                         Vitest
```

### long-poll 與喚醒

- `requestStore.waitFor(id, timeoutMs)`：若狀態已非 pending 立即回。否則掛在 `Map<id, Set<resolver>>`，`fulfill`／`cancel` 時全部 resolve。超時 resolve 回當下狀態。
- `wait.get.ts`：`timeout` 參數 1–55 秒，預設 55，超過 clamp。回 `{ id, status, fulfilledAt? }`。
- 之所以上限 55 秒：skill 的 poll script 每輪一個 curl，避免中間 proxy 或 Node 預設 timeout 干擾。

## API

所有 `/api/*` 需認證。skill 用 header `x-telecipher-token`，瀏覽器用 cookie。

| 方法與路徑 | body／query | 回應 | 錯誤 |
|--|--|--|--|
| `POST /api/requests` | `{session, path, mode, key?, description}` | 201 `{id, path, mode, key?, status:"pending"}` | 400 `{error, reason}`：欄位缺、路徑不合法、拒絕清單、symlink、file 已存在、env 缺 key |
| `GET /api/requests` | `?status=pending\|done` 可選 | `{requests: SecretRequest[]}` | |
| `GET /api/requests/:id` | | `SecretRequest` | 404 |
| `GET /api/requests/:id/wait` | `?timeout=55` | `{id, status, fulfilledAt?}` | 404 |
| `DELETE /api/requests/:id` | | 204；pending → cancelled；非 pending 不變 | 404 |
| `POST /api/requests/:id/fulfill` | `{value}` | 200 `{id, status:"fulfilled", fulfilledAt}` | 404；409 非 pending；400 value 空；500 寫檔失敗（維持 pending） |
| `POST /api/requests/clear-done` | | `{removed: n}` | |
| `POST /api/login` | `{token}` | `{ok:true}`＋cookie | 401 |
| push 三支 | 照 teledeck | | |

`fulfill` 的 `value` 不進 log、不進 store。寫檔完成才改狀態，再喚醒 waiter。

## 頁面

- **首頁 `/`**：上方「待處理」，下方「已處理」（fulfilled 與 cancelled 都在這，標記不同）。每筆：session、路徑、mode＋key、說明、相對時間。點一筆進需求頁。右上鈴鐺（照 teledeck 四態）。已處理區有「清除已處理」。
- **需求頁 `/requests/:id`**：顯示 session、resolve 後路徑、mode 與 key、說明、建立時間。pending 時顯示 textarea（`autocomplete=off`、`spellcheck=false`）＋「儲存」。儲存成功 → 清空 textarea、顯示「已寫入 {path}」。非 pending → 唯讀顯示狀態與時間。寫檔失敗 → 顯示錯誤原因，值保留讓 Zac 重試。
- **登入頁 `/login`**：照 teledeck。
- 行動版：單欄。視覺沿用 teledeck 的 ember 配色，無獨立設計系統。

## 通知

- 觸發點只有一個：`POST /api/requests` 成功。
- payload：`title: "🔑 {session} · 需要 {key ?? basename(path)}"`、`body: description`、`tag: "telecipher-{id}"`、`data: { id }`。
- `sw.js`：`push` → `showNotification`（無前景抑制，需求頁一定是新頁）。`notificationclick` → 聚焦既有視窗並 `postMessage({type:'openRequest', id})`，無視窗則 `openWindow('/requests/{id}')`。
- `.vapid.json` 獨立產生，不與 teledeck 共用（VAPID 綁 origin）。
- `410`／`404` → 移除訂閱；其他錯誤 log 後保留。`.vapid.json` 缺失 → 推播停用，log 一行，不 throw。

## Skill：`zac-skills/plugins/telecipher`

- plugin 名 `telecipher`，skill 名 `request-secret`。觸發：session 需要使用者提供 token、API key、密碼、憑證檔等敏感資料。
- 檔案：`SKILL.md`、`scripts/request.sh`。
- `request.sh` 參數：`--path <path> --mode file|env [--key KEY] --description "<text>" [--session <name>] [--wait-minutes 120]`。
  1. session 名稱：`--session` → `tmux display-message -p '#S'` → cwd basename。
  2. token：讀 `~/.telecipher/token`；缺檔印安裝提示並 exit 2。
  3. `POST http://127.0.0.1:9877/api/requests`。400 → 印 reason 並 exit 3。無法連線 → 提示「telecipher 未啟動」exit 4。
  4. 印 `REGISTERED <id> <path>` 到 stdout。
  5. 進入 poll：迴圈 `GET /wait?timeout=55`，直到 status 非 pending 或超過 `--wait-minutes`。印 `FULFILLED <id>`／`CANCELLED <id>`／`TIMEOUT <id>`，exit 0／5／6。
- `SKILL.md` 流程：
  1. 告訴使用者需要什麼、會寫到哪、用什麼 mode。
  2. 用 `Bash` 的 `run_in_background: true` 執行 `request.sh`。前景 Bash 有 10 分鐘上限，Zac 可能一小時後才填。
  3. 回報使用者「已登錄需求 #id，請到 telecipher 填值」，繼續做不依賴這個值的工作。
  4. 收到背景完成通知後讀 exit code 與最後一行。`FULFILLED` → 繼續；`CANCELLED`／`TIMEOUT` → 告訴使用者。
  5. **禁止**用任何方式讀目標檔的內容。要驗證就讓程式在 runtime 讀。
- plugin 加進 `.claude-plugin/marketplace.json`。

## 部署

- `deploy/install-launchd.sh`：`REPO="$(cd "$(dirname "$0")/.." && pwd)"`，用 `sed` 把 plist 模板的 `__REPO__`、`__USER__`、`__HOME__` 代入後 `sudo` 裝到 `/Library/LaunchDaemons/com.telecipher.server.plist`，`bootstrap`、`enable`，最後 `curl` 驗證。
- `run.sh`：`cd` 到 repo、讀 `.token` 進 `NUXT_TELECIPHER_TOKEN`、`HOST=127.0.0.1 PORT=9877`、`while true; do node .output/server/index.mjs; sleep 1; done`。
- `bun run setup`（`scripts/setup.mjs`）：產 `.token`（32 bytes hex）、`.vapid.json`、建 `~/.telecipher/`（0700）並寫 `token`（0600）。已存在就跳過，不重產。
- Tailscale Serve：`/Applications/Tailscale.app/Contents/MacOS/Tailscale serve --bg --https=8444 http://127.0.0.1:9877`。不動既有的 `:443` 與 `:8443`。
- 重部署：`bun run build && sudo launchctl kickstart -k system/com.telecipher.server`。
- 驗證：`curl -sH "x-telecipher-token: $(cat .token)" http://127.0.0.1:9877/api/requests` 回 200；`https://m1-pro.tail521001.ts.net:8444` 開得起來。

## 測試

Vitest（server lib 與 API）：

- `pathjail`：`..`、絕對路徑、`$HOME` 外、symlink 目標、symlink 父層、拒絕清單各項、`file` 已存在、合法路徑回 resolve 後絕對路徑。
- `envfile.upsertEnvLine`：新增、覆蓋、保留其他行與註解、`export` 前綴、跳脫 `"` `\` 換行、檔尾無換行。
- `secretWriter`：mode 0600、父目錄 0700、原子寫（`.tmp` 不殘留）、`file` 已存在拒絕。
- `requestStore`：add／get／list／fulfill／cancel／clearDone、持久化與 load、毀損檔回空、`waitFor` 立即回／喚醒／超時。
- API 整合（`@nuxt/test-utils`）：無 token 401；POST 建立回 201 且回應無 value；fulfill 後 store 檔內搜不到 value；fulfill 非 pending 409；wait 在 fulfill 後立刻回。
- `pushNotify.buildNotification`：title／body／tag。

實機：Claude in Chrome 走登入、首頁、需求頁、鈴鐺。真 iPhone PWA 收通知、點通知開需求頁。

端到端：另開一個 session 載入 skill，走完「登錄 → 通知 → 填值 → 寫檔 → session 收到 FULFILLED」，並確認目標檔 0600、`.requests.json` 無值。

## 非目標（YAGNI）

- 多使用者、Tailscale 身分 header 驗證。
- 讀回、輪替、刪除既有 secret。
- 加密儲存、Keychain 整合。
- 從通知直接填值。
- 需求到期自動取消。
- 多個值一次填。
