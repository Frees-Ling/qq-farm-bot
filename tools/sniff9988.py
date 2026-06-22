import http.server
import os
import socketserver
import threading
import time
import urllib.parse
import urllib.request

DEFAULT_USERNAME = os.environ.get("FARM_CAPTURE_USERNAME", "admin")
PANEL_API = os.environ.get("FARM_PANEL_API", "http://127.0.0.1:3000/api/code-capture")
LISTEN_HOST = os.environ.get("FARM_CAPTURE_HOST", "0.0.0.0")
LISTEN_PORT = int(os.environ.get("FARM_CAPTURE_PORT", "9988"))
LOG_PATH = os.environ.get("FARM_CAPTURE_LOG", "")
FARM_OPEN_URL = os.environ.get(
    "FARM_OPEN_URL",
    "https://m.q.qq.com/a/s/07f019703b54ceb96f9ead1379984a25",
)

_seen = {}
_seen_lock = threading.Lock()


def write_log(message):
    line = f"[{time.strftime('%Y-%m-%d %H:%M:%S')}] {message}"
    print(line, flush=True)
    if LOG_PATH:
        try:
            with open(LOG_PATH, "a", encoding="utf-8") as fh:
                fh.write(line + "\n")
        except OSError:
            pass


class CaptureHandler(http.server.BaseHTTPRequestHandler):
    def log_message(self, *_args):
        return

    def do_GET(self):
        raw = self.path
        if raw.startswith("http"):
            parsed = urllib.parse.urlparse(raw)
            query = parsed.query
            path_part = parsed.path
        else:
            path_part, _, query = raw.partition("?")

        params = urllib.parse.parse_qs(query)
        code = (params.get("code") or [""])[0]
        uin = (params.get("uin") or params.get("qq") or [""])[0]
        openid = (params.get("openID") or params.get("openid") or [""])[0]
        platform = (params.get("platform") or [""])[0]
        os_name = (params.get("os") or [""])[0]
        ver = (params.get("ver") or params.get("client_version") or [""])[0]
        path_bits = [bit for bit in path_part.split("/") if bit]
        path_username = ""
        if path_bits:
            if len(path_bits) >= 2 and path_bits[0] == "prod" and path_bits[1] == "ws":
                path_username = ""
            else:
                path_username = path_bits[-1]
        username = urllib.parse.unquote(path_username) if path_username else DEFAULT_USERNAME

        if path_part == "/health":
            self.send_response(200)
            self.send_header("Content-Type", "text/plain; charset=utf-8")
            self.end_headers()
            self.wfile.write(b"ok")
            return

        if not code:
            self._open_farm_page(username)
            write_log(f"missing code path={path_part}")
            return

        dedupe_key = f"{code}|{username}"
        now = time.time()
        with _seen_lock:
            if dedupe_key in _seen and now - _seen[dedupe_key] < 60:
                write_log(f"skip duplicate username={username} uin={uin or '-'}")
                self._websocket_ok()
                return
            _seen[dedupe_key] = now

        api = (
            f"{PANEL_API}?code={urllib.parse.quote(code)}"
            f"&username={urllib.parse.quote(username)}"
        )
        if uin:
            api += f"&uin={urllib.parse.quote(uin)}"
        if openid:
            api += f"&openID={urllib.parse.quote(openid)}"
        if platform:
            api += f"&platform={urllib.parse.quote(platform)}"
        if os_name:
            api += f"&os={urllib.parse.quote(os_name)}"
        if ver:
            api += f"&ver={urllib.parse.quote(ver)}"

        try:
            body = urllib.request.urlopen(api, timeout=10).read().decode("utf-8", "replace")
            write_log(f"forwarded username={username} uin={uin or '-'} os={os_name or '-'} ver={ver or '-'} openid={openid or '-'} response={body[:300]}")
        except Exception as exc:
            write_log(f"forward failed username={username} error={exc}")

        self._websocket_ok()

    def _websocket_ok(self):
        self.send_response(101)
        self.send_header("Upgrade", "websocket")
        self.send_header("Connection", "Upgrade")
        self.end_headers()

    def _open_farm_page(self, username):
        escaped_url = FARM_OPEN_URL.replace("&", "&amp;").replace('"', "&quot;")
        body = f"""<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta http-equiv="refresh" content="1;url={escaped_url}">
  <title>Open QQ Farm</title>
  <style>
    body {{ font-family: system-ui, sans-serif; padding: 24px; line-height: 1.6; }}
    a {{ display: inline-block; padding: 12px 16px; background: #1677ff; color: white; border-radius: 8px; text-decoration: none; }}
    code {{ background: #f4f4f4; padding: 2px 4px; border-radius: 4px; }}
  </style>
</head>
<body>
  <h2>QQ Farm code capture</h2>
  <p>Account: <code>{username}</code></p>
  <p>Keep QQ logged in on this machine. If QQ Farm does not open automatically, tap the button below.</p>
  <p>After the patch is ready, close and reopen QQ Classic Farm once. The code will be captured automatically.</p>
  <p><a href="{escaped_url}">Open QQ Farm</a></p>
</body>
</html>"""
        data = body.encode("utf-8")
        self.send_response(200)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)


class ThreadedHTTPServer(socketserver.ThreadingMixIn, http.server.HTTPServer):
    daemon_threads = True


if __name__ == "__main__":
    print(f"Listening on {LISTEN_HOST}:{LISTEN_PORT}, forwarding to {PANEL_API}")
    ThreadedHTTPServer((LISTEN_HOST, LISTEN_PORT), CaptureHandler).serve_forever()
