#!/bin/zsh
# supervisor 迴圈：node 掉了 1 秒後重啟。路徑由腳本位置推導。
setopt null_glob
cd "$(dirname "$0")"
export NUXT_TELECIPHER_TOKEN=$(cat .token)
export NUXT_TELECIPHER_HOME="${HOME}"
export HOST=127.0.0.1 NITRO_HOST=127.0.0.1 PORT=9877 NITRO_PORT=9877
# launchd 的 PATH 很短；brew unlink 或換版本後 `command -v node` 會是空的。依序後備：
# TELECIPHER_NODE → PATH 上的 node → brew opt/node → nvm 最新版
NODE="${TELECIPHER_NODE:-$(command -v node 2>/dev/null)}"
if [[ ! -x "$NODE" ]]; then
  for c in /opt/homebrew/opt/node/bin/node /usr/local/opt/node/bin/node "$HOME"/.nvm/versions/node/*/bin/node; do
    [[ -x "$c" ]] && { NODE="$c"; break; }
  done
fi
if [[ ! -x "$NODE" ]]; then
  echo "[run.sh] 找不到 node（PATH=$PATH）；10 秒後讓 launchd 重試"
  sleep 10; exit 1
fi
echo "[run.sh] node: $NODE ($("$NODE" -v))"
while true; do
  "$NODE" .output/server/index.mjs
  echo "[run.sh] node exited (code=$?) — restarting in 1s…"
  sleep 1
done
