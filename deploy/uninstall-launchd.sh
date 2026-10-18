#!/bin/zsh
set -e
LABEL=com.telecipher.server
sudo launchctl bootout system/$LABEL 2>/dev/null || true
sudo rm -f /Library/LaunchDaemons/$LABEL.plist
echo "已移除 $LABEL"
