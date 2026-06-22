#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
VNC_USER="${FARM_VNC_USER:-${SUDO_USER:-$(id -un)}}"
DISPLAY_NUM="${FARM_VNC_DISPLAY:-1}"
GEOMETRY="${FARM_VNC_GEOMETRY:-1280x800}"
DISPLAY_VALUE=":${DISPLAY_NUM}"
VNC_PORT=$((5900 + DISPLAY_NUM))

if ! command -v vncserver >/dev/null 2>&1; then
  echo "vncserver not found. Install the desktop first:"
  echo "  sudo bash tools/setup-ubuntu-qq-desktop.sh"
  exit 1
fi

if ! command -v qq >/dev/null 2>&1; then
  echo "qq command not found. Install Linux QQ first:"
  echo "  sudo bash tools/setup-ubuntu-qq-desktop.sh"
  exit 1
fi

VNC_HOME="$(getent passwd "$VNC_USER" | cut -d: -f6)"
if [ -z "$VNC_HOME" ] || [ ! -d "$VNC_HOME" ]; then
  echo "Could not find home directory for VNC user: $VNC_USER"
  exit 1
fi

if [ ! -f "$VNC_HOME/.vnc/passwd" ]; then
  echo "VNC password is not set for user $VNC_USER."
  echo "Run this once, then rerun this script:"
  echo "  sudo -u $VNC_USER vncpasswd"
  exit 1
fi

echo "[1/3] Ensure bot services are running"
if command -v systemctl >/dev/null 2>&1; then
  systemctl restart qq-farm-code-capture.service qq-farm-code-patcher.service 2>/dev/null || true
  systemctl start qq-farm-bot.service 2>/dev/null || true
fi

echo "[2/3] Start VNC desktop $DISPLAY_VALUE for $VNC_USER"
if pgrep -af "Xvnc ${DISPLAY_VALUE}\\b|Xtigervnc ${DISPLAY_VALUE}\\b" >/dev/null 2>&1; then
  echo "VNC display $DISPLAY_VALUE is already running."
else
  sudo -u "$VNC_USER" vncserver "$DISPLAY_VALUE" -geometry "$GEOMETRY" -localhost no
fi

echo "[3/3] Try to launch QQ in the VNC desktop"
sudo -u "$VNC_USER" env DISPLAY="$DISPLAY_VALUE" nohup qq >/tmp/qq-farm-linux-qq.out 2>/tmp/qq-farm-linux-qq.err &
sleep 2

cat <<EOF

Connect your VNC client to:
  SERVER_IP:$VNC_PORT

Inside the VNC desktop:
  1. QQ should already be open. If not, open a terminal and run: qq
  2. For each account from SSH, run:
       bash tools/wait-account-capture.sh <username> [proxyUrl]
  3. Let that user scan the QQ login QR.
  4. The script will try to open QQ Classic Farm automatically.
  5. If Farm does not appear in QQ, open QQ Classic Farm manually once.

Watch from SSH:
  cd $ROOT
  tail -f logs/code-capture.log

Success line:
  forwarded username=<username> ... response={"ok":true,...}
EOF
