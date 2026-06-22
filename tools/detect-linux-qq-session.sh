#!/usr/bin/env bash
set -euo pipefail

echo "== current shell =="
echo "user=$(id -un)"
echo "DISPLAY=${DISPLAY:-}"
echo "XAUTHORITY=${XAUTHORITY:-}"
echo "PATH=$PATH"

echo
echo "== qq command =="
if command -v qq >/dev/null 2>&1; then
  command -v qq
else
  echo "qq not found in PATH"
fi

echo
echo "== possible QQ binaries =="
for dir in /usr/bin /usr/local/bin /opt /opt/QQ /opt/qq /snap/bin "$HOME/.local/bin"; do
  [ -e "$dir" ] || continue
  find "$dir" -maxdepth 3 \( -iname 'qq' -o -iname 'linuxqq' -o -iname '*QQ*' \) -type f -o -type l 2>/dev/null | head -n 30 || true
done

echo
echo "== QQ / desktop processes =="
ps -eo pid,user,comm,args | grep -Ei '(^|/)(qq|QQ|linuxqq)( |$)|Xorg|Xwayland|wayland|gnome-session|startplasma|xfce4-session|dde-session|vnc|Xvnc' | grep -v grep || true

echo
echo "== login sessions =="
if command -v loginctl >/dev/null 2>&1; then
  loginctl list-sessions --no-legend 2>/dev/null || true
  while read -r sid _rest; do
    [ -n "${sid:-}" ] || continue
    echo "-- session $sid --"
    loginctl show-session "$sid" -p Name -p User -p Type -p State -p Display -p Remote -p Service 2>/dev/null || true
  done < <(loginctl list-sessions --no-legend 2>/dev/null || true)
else
  echo "loginctl not available"
fi

echo
echo "== likely commands =="
echo "If QQ is running under a desktop user, rerun capture like:"
echo "  sudo FARM_DISPLAY=:0 FARM_DESKTOP_USER='<desktop-user>' bash tools/wait-account-capture.sh user001"
echo
echo "If qq is installed but not in PATH, rerun with:"
echo "  sudo PATH='/path/to/qq/bin':\"\$PATH\" FARM_DISPLAY=:0 FARM_DESKTOP_USER='<desktop-user>' bash tools/wait-account-capture.sh user001"
