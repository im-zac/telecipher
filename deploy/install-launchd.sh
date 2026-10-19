#!/bin/zsh
# 安裝 telecipher LaunchDaemon（開機即起、免登入）。路徑由腳本位置推導。
set -e
# 不要用 sudo 跑整支腳本：$USER／$HOME 會變成 root 的，daemon 會以 root 跑、jail 根變 /var/root。腳本內部需要時自行 sudo。
[[ $EUID -eq 0 ]] && { echo "請以一般使用者執行（腳本內部會自行 sudo）"; exit 1 }
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
# token 不放進命令列參數（ps 看得到）：寫成 0600 的 header 檔，用 curl -H @file，用完刪掉
HDR="$(mktemp)"; chmod 600 "$HDR"; trap 'rm -f "$HDR"' EXIT
printf 'x-telecipher-token: %s\n' "$(tr -d '\n' < "$REPO/.token")" > "$HDR"
echo -n "  REST:   "; curl -s -o /dev/null -w "HTTP %{http_code}\n" -H @"$HDR" http://127.0.0.1:9877/api/health
rm -f "$HDR"
echo "  log:"; tail -3 "$REPO/logs/telecipher-server.log" 2>/dev/null | sed 's/^/    /'
echo
echo "重部署： bun run build && sudo launchctl kickstart -k system/$LABEL"
