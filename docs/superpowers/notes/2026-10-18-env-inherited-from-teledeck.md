# 在 teledeck 的 tmux 內跑測試會撞 port 9876

**現象**：`bun run test test/api.e2e.test.ts` 失敗：`listen EADDRINUSE 0.0.0.0:9876`（teledeck 的 port）。

**根因**：teledeck 的 `run.sh` 匯出 `PORT=9876 NITRO_PORT=9876 HOST=0.0.0.0`，它 spawn 的 tmux session／Claude Code shell 全部繼承。`@nuxt/test-utils` 用 `PORT` 傳隨機 port 給測試 server，但 Nitro 以 `NITRO_PORT` 優先，所以測試 server 綁到 9876。

**修法**：`test/api.e2e.test.ts` 在 `setup()` 前 `delete process.env` 的 `PORT`、`NITRO_PORT`、`HOST`、`NITRO_HOST`。`bun run dev` 不受影響，因為 CLI 旗標 `--host --port` 優先。production 的 `run.sh` 自己明確設定，也不受影響。
