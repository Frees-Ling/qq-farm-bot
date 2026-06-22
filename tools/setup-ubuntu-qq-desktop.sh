#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

if [ "$(id -u)" -ne 0 ]; then
  echo "Run as root: sudo bash tools/setup-ubuntu-qq-desktop.sh"
  exit 1
fi

QQ_LINUX_CONFIG_URL="${QQ_LINUX_CONFIG_URL:-https://cdn-go.cn/qq-web/im.qq.com_new/latest/rainbow/linuxConfig.js}"
VNC_USER="${SUDO_USER:-root}"
if [ "$VNC_USER" = "root" ] && [ -n "${FARM_VNC_USER:-}" ]; then
  VNC_USER="$FARM_VNC_USER"
fi

echo "[1/6] Install lightweight desktop and VNC packages"
apt-get update
DEBIAN_FRONTEND=noninteractive apt-get install -y \
  ca-certificates \
  curl \
  dbus-x11 \
  fonts-noto-cjk \
  jq \
  libgtk-3-0 \
  libnss3 \
  libxss1 \
  tigervnc-standalone-server \
  tigervnc-common \
  xfce4 \
  xfce4-terminal \
  xdg-utils

echo "[2/6] Resolve latest official Linux QQ .deb URL"
ARCH="$(dpkg --print-architecture)"
CONFIG="$(curl -fsSL "$QQ_LINUX_CONFIG_URL")"
case "$ARCH" in
  amd64)
    QQ_DEB_URL="$(printf '%s' "$CONFIG" | grep -oE 'https://[^"]+_amd64_[^"]+\.deb' | head -n 1)"
    ;;
  arm64)
    QQ_DEB_URL="$(printf '%s' "$CONFIG" | grep -oE 'https://[^"]+_arm64_[^"]+\.deb' | head -n 1)"
    ;;
  *)
    echo "Unsupported Ubuntu architecture for this helper: $ARCH"
    echo "Open https://im.qq.com/index/#/linux and install QQ manually."
    exit 1
    ;;
esac

if [ -z "$QQ_DEB_URL" ]; then
  echo "Could not parse Linux QQ .deb URL from $QQ_LINUX_CONFIG_URL"
  exit 1
fi

echo "QQ package: $QQ_DEB_URL"
TMP_DEB="/tmp/linux-qq-${ARCH}.deb"

echo "[3/6] Download and install Linux QQ"
curl -fL "$QQ_DEB_URL" -o "$TMP_DEB"
apt-get install -y "$TMP_DEB"

echo "[4/6] Prepare VNC startup for user: $VNC_USER"
VNC_HOME="$(getent passwd "$VNC_USER" | cut -d: -f6)"
if [ -z "$VNC_HOME" ] || [ ! -d "$VNC_HOME" ]; then
  echo "Could not find home directory for user $VNC_USER"
  exit 1
fi

install -d -m 700 -o "$VNC_USER" -g "$VNC_USER" "$VNC_HOME/.vnc"
cat > "$VNC_HOME/.vnc/xstartup" <<'EOF'
#!/bin/sh
unset SESSION_MANAGER
unset DBUS_SESSION_BUS_ADDRESS
exec startxfce4
EOF
chown "$VNC_USER:$VNC_USER" "$VNC_HOME/.vnc/xstartup"
chmod 700 "$VNC_HOME/.vnc/xstartup"

echo "[5/6] Install project services"
bash "$ROOT/tools/install-linux-service.sh"

echo "[6/6] Done"
cat <<EOF

Next steps:
  1. Set a VNC password for the desktop user:
       sudo -u $VNC_USER vncpasswd

  2. Start a desktop session:
       sudo -u $VNC_USER vncserver :1 -geometry 1280x800 -localhost no

  3. Connect your VNC client to:
       SERVER_IP:5901

  4. In the VNC desktop, open QQ, scan the QQ login QR, then open QQ Classic Farm.

  5. Watch capture progress:
       cd $ROOT
       bash tools/diagnose-server-capture.sh
       tail -f logs/code-capture.log

Important:
  The bot can only create the real account after QQ Classic Farm opens inside
  this desktop and sends a wss://gate-obt.nqf.qq.com request containing code=...
EOF
