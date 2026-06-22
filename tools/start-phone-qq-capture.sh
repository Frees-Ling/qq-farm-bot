#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

USERNAME="${1:-${FARM_CAPTURE_USERNAME:-admin}}"
PORT="${2:-${FARM_PHONE_PROXY_PORT:-8899}}"
PANEL_API="${FARM_PANEL_API:-http://127.0.0.1:3000/api/code-capture}"
LOG_PATH="${FARM_CAPTURE_LOG:-$ROOT/logs/phone-code-capture.log}"
MITMDUMP_BIN="${MITMDUMP_BIN:-$(command -v mitmdump || true)}"

if [ -z "$MITMDUMP_BIN" ]; then
  cat <<'EOF'
mitmdump not found.

Install it on Ubuntu:
  sudo apt update
  sudo apt install -y python3-pip
  python3 -m pip install --user mitmproxy
  export PATH="$HOME/.local/bin:$PATH"

Then rerun this script.
EOF
  exit 1
fi

mkdir -p "$ROOT/logs"

SERVER_IP="$(hostname -I 2>/dev/null | awk '{print $1}')"
if [ -z "$SERVER_IP" ]; then
  SERVER_IP="SERVER_IP"
fi

cat <<EOF
Starting QQ Farm phone traffic capture.

Account username: $USERNAME
Proxy listener:  $SERVER_IP:$PORT
Panel API:       $PANEL_API
Log file:        $LOG_PATH

Phone steps:
  1. Connect the phone to a network that can reach this server.
  2. Set the phone Wi-Fi HTTP proxy to:
       Host: $SERVER_IP
       Port: $PORT
  3. Open http://mitm.it on the phone and install/trust the mitmproxy CA certificate.
  4. Use mobile QQ to scan/login as needed, then immediately open QQ Classic Farm.
  5. When gate-obt code is captured, this process exits automatically.

If QQ Farm cannot connect after installing the certificate, Tencent may be rejecting user CA
certificates in this runtime. In that case use the Android-on-server or real-device ADB route.

EOF

export FARM_CAPTURE_USERNAME="$USERNAME"
export FARM_PANEL_API="$PANEL_API"
export FARM_CAPTURE_LOG="$LOG_PATH"
export FARM_CAPTURE_ONESHOT="${FARM_CAPTURE_ONESHOT:-1}"

exec "$MITMDUMP_BIN" \
  --listen-host 0.0.0.0 \
  --listen-port "$PORT" \
  --mode regular \
  --set block_global=false \
  -s "$ROOT/tools/mitm-qq-farm-code-capture.py"
