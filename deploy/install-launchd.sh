#!/bin/zsh
# 安裝 telecipher LaunchDaemon（開機即起、免登入）。路徑由腳本位置推導。
set -e
REPO="$(cd "$(dirname "$0")/.." && pwd)"
LABEL=com.telecipher.server
DST=/Library/LaunchDaemons/$LABEL.plist
RENDERED="$REPO/deploy/$LABEL.plist"

[[ -f "$REPO/.token" ]] || { echo "缺 .token，先跑 bun run setup"; exit 1 }
[[ -f "$REPO/.output/server/index.mjs" ]] || { echo "缺 .output，先跑 bun run build"; exit 1 }
mkdir -p "$REPO/logs"

echo "== 1) 渲染 plist =="
sed -e "s|__REPO__|$REPO|g" -e "s|__USER__|$USER|g" -e "s|__HOME__|$HOME|g" "$REPO/deploy/$LABEL.plist.template" > "$RENDERED"

echo "== 2) 停舊實例 =="
pkill -f "$REPO/run.sh" 2>/dev/null || true
pkill -f "$REPO/.output/server/index.mjs" 2>/dev/null || true
sleep 1

echo "== 3) 安裝 plist（需 sudo）=="
sudo cp "$RENDERED" "$DST"; sudo chown root:wheel "$DST"; sudo chmod 644 "$DST"
sudo launchctl bootout system/$LABEL 2>/dev/null || true
sudo launchctl bootstrap system "$DST"
sudo launchctl enable system/$LABEL

echo "== 4) 驗證 =="
sleep 3
echo -n "  daemon: "; sudo launchctl print system/$LABEL 2>/dev/null | grep -E "state = " | head -1 | tr -s ' '
echo -n "  REST:   "; curl -s -o /dev/null -w "HTTP %{http_code}\n" -H "x-telecipher-token: $(cat "$REPO/.token")" http://127.0.0.1:9877/api/health
echo "  log:"; tail -3 "$REPO/logs/telecipher-server.log" 2>/dev/null | sed 's/^/    /'
echo
echo "重部署： bun run build && sudo launchctl kickstart -k system/$LABEL"
