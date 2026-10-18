#!/bin/zsh
# supervisor 迴圈：node 掉了 1 秒後重啟。路徑由腳本位置推導。
cd "$(dirname "$0")"
export NUXT_TELECIPHER_TOKEN=$(cat .token)
export NUXT_TELECIPHER_HOME="${HOME}"
export HOST=127.0.0.1 NITRO_HOST=127.0.0.1 PORT=9877 NITRO_PORT=9877
NODE="${TELECIPHER_NODE:-$(command -v node)}"
while true; do
  "$NODE" .output/server/index.mjs
  echo "[run.sh] node exited (code=$?) — restarting in 1s…"
  sleep 1
done
