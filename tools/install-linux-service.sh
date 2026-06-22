#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
USER_NAME="${FARM_SERVICE_USER:-${SUDO_USER:-$(id -un)}}"
NODE_BIN="$(command -v node)"
PYTHON_BIN="$(command -v python3 || command -v python)"
PNPM_BIN="$(command -v pnpm || true)"

if [ -z "$PNPM_BIN" ]; then
  echo "pnpm not found. Run: corepack enable && corepack prepare pnpm@10.30.2 --activate"
  exit 1
fi

echo "[1/4] Install dependencies"
"$PNPM_BIN" -C "$ROOT" install -r

echo "[2/4] Build web"
"$PNPM_BIN" -C "$ROOT/web" build

echo "[3/4] Write systemd units"
sudo tee /etc/systemd/system/qq-farm-bot.service >/dev/null <<EOF
[Unit]
Description=QQ Farm Bot Panel
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=$USER_NAME
WorkingDirectory=$ROOT/core
Environment=ADMIN_PORT=3000
ExecStart=$NODE_BIN client.js
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
EOF

sudo tee /etc/systemd/system/qq-farm-code-capture.service >/dev/null <<EOF
[Unit]
Description=QQ Farm Code Capture
After=network-online.target qq-farm-bot.service
Wants=network-online.target

[Service]
Type=simple
User=$USER_NAME
WorkingDirectory=$ROOT
Environment=FARM_PANEL_API=http://127.0.0.1:3000/api/code-capture
Environment=FARM_CAPTURE_USERNAME=admin
Environment=FARM_CAPTURE_HOST=0.0.0.0
Environment=FARM_CAPTURE_PORT=9988
Environment=FARM_CAPTURE_LOG=$ROOT/logs/code-capture.log
ExecStart=$PYTHON_BIN tools/sniff9988.py
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
EOF

sudo tee /etc/systemd/system/qq-farm-code-patcher.service >/dev/null <<EOF
[Unit]
Description=QQ Farm Miniapp Code Capture Patcher
After=network-online.target qq-farm-code-capture.service
Wants=network-online.target

[Service]
Type=simple
User=$USER_NAME
WorkingDirectory=$ROOT
Environment=FARM_CAPTURE_USERNAME=admin
Environment=FARM_CAPTURE_WS=ws://127.0.0.1:9988/admin
ExecStart=$NODE_BIN tools/watch-qq-farm-code-capture.js --capture-ws ws://127.0.0.1:9988/admin --username admin
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
EOF

mkdir -p "$ROOT/logs"

echo "[4/4] Enable and start services"
sudo systemctl daemon-reload
sudo systemctl enable --now qq-farm-bot.service qq-farm-code-capture.service qq-farm-code-patcher.service
sudo systemctl --no-pager --full status qq-farm-bot.service qq-farm-code-capture.service qq-farm-code-patcher.service

echo
echo "Panel: http://SERVER_IP:3000"
echo "Capture endpoint: ws://127.0.0.1:9988/admin"
echo
echo "The patch watcher is running. On the server desktop/VNC:"
echo "  1. For each account, run: bash tools/prepare-account-capture.sh <username> [proxyUrl]"
echo "  2. Open QQ and let that user scan the QQ login QR once."
echo "  3. Open QQ Classic Farm once, wait for the miniapp cache, close it, then open it again."
echo "  4. Watch: journalctl -u qq-farm-code-capture -f"
