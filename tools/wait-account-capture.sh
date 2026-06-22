#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

USERNAME="${1:-${FARM_CAPTURE_USERNAME:-}}"
PROXY_URL="${2:-${FARM_CAPTURE_PROXY_URL:-}}"
TIMEOUT_SEC="${FARM_CAPTURE_WAIT_TIMEOUT:-300}"
CAPTURE_WS="${FARM_CAPTURE_WS:-ws://127.0.0.1:9988/${USERNAME:-admin}}"
LOG_FILE="$ROOT/logs/code-capture.log"
OPEN_INTERVAL_SEC="${FARM_OPEN_INTERVAL_SEC:-45}"

if [ -z "$USERNAME" ]; then
  echo "Usage:"
  echo "  bash tools/wait-account-capture.sh <username> [proxyUrl]"
  echo
  echo "Example:"
  echo "  bash tools/wait-account-capture.sh user001 http://user:pass@1.2.3.4:8080"
  exit 1
fi

if ! command -v qq >/dev/null 2>&1; then
  cat <<EOF
Linux QQ is not installed on this server, so QR login cannot create a QQ Farm account here yet.

Install the Ubuntu desktop + Linux QQ + bot services first:
  sudo bash tools/setup-ubuntu-qq-desktop.sh
  sudo -u root vncpasswd
  bash tools/start-ubuntu-qq-desktop.sh

Then connect to VNC, scan the QQ login QR, and rerun:
  sudo bash tools/wait-account-capture.sh $USERNAME
  sudo bash tools/wait-account-capture.sh $USERNAME '<proxyUrl>'

If you already have a real wss code, use:
  node tools/add-account-code.js --username '$USERNAME' --code '<REAL_CODE>'
EOF
  exit 3
fi

mkdir -p "$ROOT/logs"
touch "$LOG_FILE"

mask_proxy() {
  printf '%s' "$1" | sed -E 's#://([^:/@]+):([^@/]+)@#://\1:***@#'
}

has_success() {
  grep -F "forwarded username=$USERNAME" "$LOG_FILE" 2>/dev/null | grep -F '"ok":true' >/dev/null 2>&1
}

print_state() {
  echo
  echo "== capture state for $USERNAME =="
  if command -v ss >/dev/null 2>&1; then
    ss -lntp 2>/dev/null | grep -E ':3000|:9988|:5901' || true
  fi
  if command -v systemctl >/dev/null 2>&1; then
    systemctl is-active qq-farm-bot.service qq-farm-code-capture.service qq-farm-code-patcher.service 2>/dev/null || true
  fi
  echo "-- QQ / VNC processes --"
  pgrep -af 'QQ|qq|vnc|Xvnc|xfce' 2>/dev/null || true
  echo "-- QQ Farm game.js --"
  find /root /home -path '*miniapp_src*1112386029*game.js' -type f 2>/dev/null | tail -n 5 || true
  echo "-- recent capture log --"
  tail -n 20 "$LOG_FILE" 2>/dev/null || true
  echo "-- patch watcher log --"
  tail -n 20 "$ROOT/logs/wait-capture-$USERNAME.out.log" 2>/dev/null || true
  tail -n 20 "$ROOT/logs/wait-capture-$USERNAME.err.log" 2>/dev/null || true
}

echo "[1/4] Start bot/capture services if systemd is available"
if command -v systemctl >/dev/null 2>&1 && [ "$(id -u)" -eq 0 ]; then
  systemctl start qq-farm-bot.service qq-farm-code-capture.service 2>/dev/null || true
fi

echo "[2/4] Prepare patch target"
echo "username=$USERNAME"
echo "capture=$CAPTURE_WS"
if [ -n "$PROXY_URL" ]; then
  echo "proxy=$(mask_proxy "$PROXY_URL")"
fi

node tools/patch-qq-farm-code-capture.js \
  --capture-ws "$CAPTURE_WS" \
  --username "$USERNAME" \
  --proxy-url "$PROXY_URL" || true

echo "[3/4] Start a foreground patch watcher for this account"
FARM_CAPTURE_WS="$CAPTURE_WS" \
FARM_CAPTURE_USERNAME="$USERNAME" \
FARM_CAPTURE_PROXY_URL="$PROXY_URL" \
  node tools/watch-qq-farm-code-capture.js --interval-ms 3000 >"$ROOT/logs/wait-capture-$USERNAME.out.log" 2>"$ROOT/logs/wait-capture-$USERNAME.err.log" &
WATCH_PID="$!"
trap 'kill "$WATCH_PID" >/dev/null 2>&1 || true' EXIT

open_farm() {
  FARM_CAPTURE_USERNAME="$USERNAME" bash tools/open-qq-farm.sh >/tmp/qq-farm-open-trigger.out 2>/tmp/qq-farm-open-trigger.err || true
}

cat <<EOF

Now use the server VNC desktop:
  1. Make sure QQ is open and logged in by this user scanning the QQ QR.
  2. This script will try to open QQ Classic Farm automatically with mqqapi and web links.
  3. If Farm does not appear in QQ, open QQ Classic Farm manually once.

Waiting up to ${TIMEOUT_SEC}s for:
  forwarded username=$USERNAME ... response={"ok":true,...}
EOF

echo "[4/4] Waiting for capture success"
STARTED_AT="$(date +%s)"
LAST_STATE_AT=0
LAST_OPEN_AT=0
while true; do
  if has_success; then
    echo
    echo "SUCCESS: captured and forwarded code for $USERNAME"
    grep -F "forwarded username=$USERNAME" "$LOG_FILE" | tail -n 3
    exit 0
  fi

  now="$(date +%s)"
  elapsed=$((now - STARTED_AT))
  if [ "$elapsed" -ge "$TIMEOUT_SEC" ]; then
    echo
    echo "TIMEOUT: no successful capture for $USERNAME after ${TIMEOUT_SEC}s"
    print_state
    echo
    echo "Most common cause: QQ Classic Farm has not opened inside the server VNC desktop, so game.js/code was never produced."
    echo "Fallback if you already have the real wss code:"
    echo "  node tools/add-account-code.js --username '$USERNAME' --code '<REAL_CODE>'"
    exit 2
  fi

  if [ $((now - LAST_STATE_AT)) -ge 30 ]; then
    print_state
    LAST_STATE_AT="$now"
  fi
  if [ $((now - LAST_OPEN_AT)) -ge "$OPEN_INTERVAL_SEC" ]; then
    open_farm
    LAST_OPEN_AT="$now"
  fi
  sleep 3
done
