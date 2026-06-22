#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

echo "== repo =="
pwd
git rev-parse --abbrev-ref HEAD 2>/dev/null || true
git rev-parse --short HEAD 2>/dev/null || true

echo
echo "== ports =="
ss -lntp 2>/dev/null | grep -E ':3000|:9988' || true

echo
echo "== desktop / qq =="
if command -v qq >/dev/null 2>&1; then
  echo "qq command: $(command -v qq)"
else
  echo "qq command: not found"
fi
dpkg -l 2>/dev/null | grep -Ei 'linuxqq|qq[[:space:]]' || true
pgrep -af 'QQ|qq|vnc|Xvnc|xfce' 2>/dev/null || true
ss -lntp 2>/dev/null | grep -E ':5901|:5902|:5903' || true
tail -n 40 /tmp/qq-farm-linux-qq.out 2>/dev/null || true
tail -n 40 /tmp/qq-farm-linux-qq.err 2>/dev/null || true

echo
echo "== services =="
systemctl --no-pager --full status qq-farm-bot.service 2>/dev/null | sed -n '1,18p' || true
systemctl --no-pager --full status qq-farm-code-capture.service 2>/dev/null | sed -n '1,18p' || true
systemctl --no-pager --full status qq-farm-code-patcher.service 2>/dev/null | sed -n '1,18p' || true

echo
echo "== local capture page =="
curl -sS -i --max-time 5 http://127.0.0.1:9988/admin 2>&1 | sed -n '1,12p' || true

echo
echo "== panel code-capture dry run =="
DRY_CODE="DIAG_CAPTURE_$(date +%s)"
curl -sS --max-time 10 "http://127.0.0.1:3000/api/code-capture?dryRun=1&username=admin&code=${DRY_CODE}&platform=qq&os=Windows&ver=1.12.1.6_20260609" 2>&1 || true
echo

echo
echo "== account files =="
for file in core/data/accounts.json data/accounts.json; do
  if [ -f "$file" ]; then
    echo "-- $file"
    tail -n 80 "$file"
  fi
done

echo
echo "== account proxy summary =="
node - <<'NODE' 2>/dev/null || true
const fs = require('fs');
const path = fs.existsSync('core/data/accounts.json') ? 'core/data/accounts.json' : 'data/accounts.json';
if (!fs.existsSync(path)) process.exit(0);
const data = JSON.parse(fs.readFileSync(path, 'utf8'));
for (const a of data.accounts || []) {
  const proxy = String(a.proxyUrl || a.proxy || '');
  const masked = proxy.replace(/:\/\/([^:@/]+):([^@/]+)@/, '://$1:***@');
  console.log(`${a.id || '-'} ${a.username || '-'} ${a.name || '-'} proxy=${masked || '-'}`);
}
NODE

echo
echo "== capture logs =="
tail -n 80 logs/code-capture.log 2>/dev/null || true
tail -n 80 logs/capture.out.log 2>/dev/null || true
tail -n 80 logs/capture.err.log 2>/dev/null || true

echo
echo "== patch logs =="
tail -n 80 logs/patch.out.log 2>/dev/null || true
tail -n 80 logs/patch.err.log 2>/dev/null || true
journalctl -u qq-farm-code-patcher -n 80 --no-pager 2>/dev/null || true

echo
echo "== QQ Farm game.js =="
mapfile -t GAME_FILES < <(find /root /home -path '*miniapp_src*1112386029*game.js' -type f 2>/dev/null | sort)
if [ "${#GAME_FILES[@]}" -eq 0 ]; then
  echo "No QQ Farm game.js found."
  echo "If this is Ubuntu server, install/start a desktop + Linux QQ first:"
  echo "  sudo bash tools/setup-ubuntu-qq-desktop.sh"
  echo "Then connect by VNC, scan QQ login, and open QQ Classic Farm once."
else
  printf '%s\n' "${GAME_FILES[@]}"
fi

echo
echo "== patch markers =="
if [ "${#GAME_FILES[@]}" -gt 0 ]; then
  grep -H "QQ_FARM_CODE_CAPTURE_PATCH" "${GAME_FILES[@]}" 2>/dev/null || true
fi

echo
echo "== expected success log =="
echo 'logs/code-capture.log should contain: forwarded username=<username> ... response={"ok":true,...}'
