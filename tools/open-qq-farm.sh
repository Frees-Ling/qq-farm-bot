#!/usr/bin/env bash
set -euo pipefail

VNC_USER="${FARM_VNC_USER:-${SUDO_USER:-$(id -un)}}"
DISPLAY_NUM="${FARM_VNC_DISPLAY:-1}"
DISPLAY_VALUE=":${DISPLAY_NUM}"
FARM_OPEN_URL="${FARM_OPEN_URL:-https://m.q.qq.com/a/s/07f019703b54ceb96f9ead1379984a25}"
OUT_LOG="${FARM_OPEN_OUT_LOG:-/tmp/qq-farm-open.out}"
ERR_LOG="${FARM_OPEN_ERR_LOG:-/tmp/qq-farm-open.err}"

if [ "$(id -u)" -eq 0 ]; then
  RUN_AS=(sudo -u "$VNC_USER")
else
  RUN_AS=()
fi

echo "Opening QQ Farm URL on DISPLAY=$DISPLAY_VALUE as user=$VNC_USER"
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

# xdg-open usually hands the URL to the desktop default handler. If Linux QQ
# registers the miniapp link, this is the closest server-side equivalent to a
# user clicking the Farm link.
if launch xdg-open "$FARM_OPEN_URL"; then
  echo "Launched with xdg-open"
  exit 0
fi

if launch gio open "$FARM_OPEN_URL"; then
  echo "Launched with gio open"
  exit 0
fi

for browser in google-chrome chromium chromium-browser firefox; do
  if launch "$browser" "$FARM_OPEN_URL"; then
    echo "Launched with $browser"
    exit 0
  fi
done

echo "Could not find xdg-open/gio/browser. Open QQ Classic Farm manually inside VNC."
echo "Logs: $OUT_LOG $ERR_LOG"
exit 1
