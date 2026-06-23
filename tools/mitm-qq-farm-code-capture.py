import json
import os
import threading
import time
import urllib.parse
import urllib.request

from mitmproxy import ctx


TARGET_HOST = os.environ.get("FARM_MITM_TARGET_HOST", "gate-obt.nqf.qq.com")
TARGET_PATH = os.environ.get("FARM_MITM_TARGET_PATH", "/prod/ws")
USERNAME = os.environ.get("FARM_CAPTURE_USERNAME", "admin")
ACCOUNT_NAME = os.environ.get("FARM_CAPTURE_ACCOUNT_NAME", "")
SESSION_ID = os.environ.get("FARM_CAPTURE_SESSION_ID", "")
PANEL_API = os.environ.get("FARM_PANEL_API", "http://127.0.0.1:3000/api/code-capture")
LOG_PATH = os.environ.get("FARM_CAPTURE_LOG", "")
ONESHOT = os.environ.get("FARM_CAPTURE_ONESHOT", "1").lower() in ("1", "true", "yes", "on")

_seen = set()
_client_seen = set()
_target_connect_seen = set()
_host_seen = set()


def write_log(message):
    line = f"[{time.strftime('%Y-%m-%d %H:%M:%S')}] {message}"
    ctx.log.info(line)
    print(line, flush=True)
    if LOG_PATH:
        try:
            with open(LOG_PATH, "a", encoding="utf-8") as fh:
                fh.write(line + "\n")
        except OSError:
            pass


def first(params, *names):
    for name in names:
        values = params.get(name)
        if values:
            return values[0]
    return ""


def response_ok(body):
    try:
        data = json.loads(body)
        return data.get("ok") is True
    except Exception:
        return False


def forward_code(code, params):
    api = (
        f"{PANEL_API}?code={urllib.parse.quote(code)}"
        f"&username={urllib.parse.quote(USERNAME)}"
        "&platform=qq"
    )
    if ACCOUNT_NAME:
        api += f"&name={urllib.parse.quote(ACCOUNT_NAME)}"
    if SESSION_ID:
        api += f"&captureSession={urllib.parse.quote(SESSION_ID)}"

    uin = first(params, "uin", "qq")
    openid = first(params, "openID", "openid")
    os_name = first(params, "os")
    ver = first(params, "ver", "client_version")
    proxy_url = first(params, "proxyUrl", "proxy")

    if uin:
        api += f"&uin={urllib.parse.quote(uin)}"
    if openid:
        api += f"&openID={urllib.parse.quote(openid)}"
    if os_name:
        api += f"&os={urllib.parse.quote(os_name)}"
    if ver:
        api += f"&ver={urllib.parse.quote(ver)}"
    if proxy_url:
        api += f"&proxyUrl={urllib.parse.quote(proxy_url)}"

    body = urllib.request.urlopen(api, timeout=10).read().decode("utf-8", "replace")
    write_log(
        f"forwarded username={USERNAME} uin={uin or '-'} os={os_name or '-'} "
        f"ver={ver or '-'} openid={openid or '-'} response={body[:300]}"
    )
    return response_ok(body)


class QQFarmCodeCapture:
    def load(self, _loader):
        write_log(
            f"phone proxy capture loaded target={TARGET_HOST}{TARGET_PATH} "
            f"username={USERNAME} session={SESSION_ID or '-'} panel={PANEL_API} oneshot={ONESHOT}"
        )

    def client_connected(self, layer):
        address = getattr(getattr(layer, "client", None), "peername", None) or getattr(layer, "peername", None)
        key = str(address)
        if key not in _client_seen:
            _client_seen.add(key)
            write_log(f"phone proxy client connected peer={key}")

    def http_connect(self, flow):
        host = (flow.request.host or "").lower()
        port = flow.request.port
        if host == TARGET_HOST.lower():
            key = f"{host}:{port}"
            if key not in _target_connect_seen:
                _target_connect_seen.add(key)
                write_log(f"phone proxy CONNECT target host={host} port={port}")

    def request(self, flow):
        request = flow.request
        host = (request.host or "").lower()
        if host and host not in _host_seen and (
            host == TARGET_HOST.lower()
            or host.endswith(".qq.com")
            or "qq" in host
        ):
            _host_seen.add(host)
            write_log(f"phone proxy decrypted host={host} path={urllib.parse.urlparse(request.pretty_url).path}")
        if host != TARGET_HOST.lower():
            return

        parsed = urllib.parse.urlparse(request.pretty_url)
        if parsed.path != TARGET_PATH:
            write_log(f"matched target host but path differs path={parsed.path}")
            return

        params = urllib.parse.parse_qs(parsed.query)
        code = first(params, "code")
        if not code:
            write_log(f"matched target but missing code path={parsed.path}")
            return
        if code.startswith("-"):
            write_log(f"skip invalid farm code={code}")
            return

        dedupe_key = f"{USERNAME}|{code}"
        if dedupe_key in _seen:
            return
        _seen.add(dedupe_key)

        try:
            ok = forward_code(code, params)
        except Exception as exc:
            write_log(f"forward failed username={USERNAME} error={exc}")
            return

        if ONESHOT and ok:
            write_log(f"oneshot complete username={USERNAME}, shutting down phone proxy listener")
            threading.Thread(target=ctx.master.shutdown, daemon=True).start()


addons = [QQFarmCodeCapture()]
