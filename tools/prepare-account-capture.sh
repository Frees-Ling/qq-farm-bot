#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
USERNAME="${1:-${FARM_CAPTURE_USERNAME:-}}"
PROXY_URL="${2:-${FARM_CAPTURE_PROXY_URL:-}}"
CAPTURE_WS="${FARM_CAPTURE_WS:-ws://127.0.0.1:9988/${USERNAME:-admin}}"

if [ -z "$USERNAME" ]; then
  echo "Usage:"
  echo "  bash tools/prepare-account-capture.sh <username> [proxyUrl]"
  echo
  echo "Example:"
  echo "  bash tools/prepare-account-capture.sh user001 http://user:pass@1.2.3.4:8080"
  exit 1
fi

NODE_BIN="$(command -v node)"
USER_NAME="${FARM_SERVICE_USER:-${SUDO_USER:-$(id -un)}}"

echo "[1/3] Patch QQ Farm cache for username=$USERNAME"
"$NODE_BIN" "$ROOT/tools/patch-qq-farm-code-capture.js" \
  --capture-ws "$CAPTURE_WS" \
  --username "$USERNAME" \
  --proxy-url "$PROXY_URL" || true

if command -v systemctl >/dev/null 2>&1 && [ "$(id -u)" -eq 0 ]; then
  echo "[2/3] Update patcher service for this capture target"
  tee /etc/systemd/system/qq-farm-code-patcher.service >/dev/null <<EOF
[Unit]
Description=QQ Farm Miniapp Code Capture Patcher
After=network-online.target qq-farm-code-capture.service
Wants=network-online.target

[Service]
Type=simple
User=$USER_NAME
WorkingDirectory=$ROOT
Environment=FARM_CAPTURE_USERNAME=$USERNAME
Environment=FARM_CAPTURE_WS=$CAPTURE_WS
Environment=FARM_CAPTURE_PROXY_URL=$PROXY_URL
ExecStart=$NODE_BIN tools/watch-qq-farm-code-capture.js
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
EOF
  systemctl daemon-reload
  systemctl enable --now qq-farm-code-patcher.service
  systemctl restart qq-farm-code-patcher.service
else
  echo "[2/3] systemd not available or not root; run watcher manually if needed:"
  echo "  FARM_CAPTURE_WS='$CAPTURE_WS' FARM_CAPTURE_USERNAME='$USERNAME' FARM_CAPTURE_PROXY_URL='$PROXY_URL' node tools/watch-qq-farm-code-capture.js"
fi

echo "[3/3] Ready"
cat <<EOF

Now in the server VNC desktop:
  1. Open QQ and let the user scan the QQ login QR.
  2. Open QQ Classic Farm.
  3. Close and reopen QQ Classic Farm once if no code is captured.

Watch:
  tail -f $ROOT/logs/code-capture.log

Success:
  forwarded username=$USERNAME ... response={"ok":true,...}
EOF
