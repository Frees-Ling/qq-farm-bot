#!/usr/bin/env bash
set -euo pipefail

VNC_USER="${FARM_VNC_USER:-${SUDO_USER:-$(id -un)}}"
DISPLAY_NUM="${FARM_VNC_DISPLAY:-1}"
DISPLAY_VALUE=":${DISPLAY_NUM}"
FARM_MINIAPP_APPID="${FARM_MINIAPP_APPID:-1112386029}"
FARM_OPEN_SCENE="${FARM_OPEN_SCENE:-1001}"
FARM_OPEN_URL="${FARM_OPEN_URL:-https://m.q.qq.com/a/s/07f019703b54ceb96f9ead1379984a25}"
FARM_OPEN_SCHEME="${FARM_OPEN_SCHEME:-mqqapi://microapp/open?mini_appid=${FARM_MINIAPP_APPID}&scene=${FARM_OPEN_SCENE}}"
OUT_LOG="${FARM_OPEN_OUT_LOG:-/tmp/qq-farm-open.out}"
ERR_LOG="${FARM_OPEN_ERR_LOG:-/tmp/qq-farm-open.err}"

if [ "$(id -u)" -eq 0 ]; then
  RUN_AS=(sudo -u "$VNC_USER")
else
  RUN_AS=()
fi

echo "Opening QQ Farm URL on DISPLAY=$DISPLAY_VALUE as user=$VNC_USER"
echo "Scheme: $FARM_OPEN_SCHEME"
echo "URL: $FARM_OPEN_URL"

launch() {
  local command_name="$1"
  shift
  if ! command -v "$command_name" >/dev/null 2>&1; then
    return 1
  fi
  "${RUN_AS[@]}" env DISPLAY="$DISPLAY_VALUE" "$command_name" "$@" >>"$OUT_LOG" 2>>"$ERR_LOG" &
  return 0
}

launched=0

# Try the QQ miniapp scheme first. If Linux QQ registered mqqapi://, this can
# open the miniapp directly. Then also try the public web link as a fallback.
for target in "$FARM_OPEN_SCHEME" "$FARM_OPEN_URL"; do
  if launch xdg-open "$target"; then
    echo "Launched with xdg-open: $target"
    launched=1
    sleep 2
  fi

  if launch gio open "$target"; then
    echo "Launched with gio open: $target"
    launched=1
    sleep 2
  fi
done

for browser in google-chrome chromium chromium-browser firefox; do
  if launch "$browser" "$FARM_OPEN_URL"; then
    echo "Launched with $browser"
    launched=1
    break
  fi
done

if [ "$launched" -eq 1 ]; then
  echo "Open attempts launched. Watch QQ/VNC and capture logs for the result."
  exit 0
fi

echo "Could not find xdg-open/gio/browser. Open QQ Classic Farm manually inside VNC."
echo "Logs: $OUT_LOG $ERR_LOG"
exit 1
