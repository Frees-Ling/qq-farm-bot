#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const MARKER_START = "// >>> QQ_FARM_CODE_CAPTURE_PATCH START >>>";
const MARKER_END = "// <<< QQ_FARM_CODE_CAPTURE_PATCH END <<<";

function argValue(name, fallback = "") {
  const idx = process.argv.indexOf(name);
  if (idx >= 0 && idx + 1 < process.argv.length) return process.argv[idx + 1];
  return fallback;
}

function walk(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  let entries = [];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    try {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full, out);
      } else if (entry.isFile() && entry.name === "game.js") {
        out.push(full);
      }
    } catch {
      // Ignore unreadable cache entries.
    }
  }
  return out;
}

function homeDirs() {
  const dirs = new Set([os.homedir()]);
  for (const dir of ["/root", "/home"]) {
    if (!fs.existsSync(dir)) continue;
    try {
      const stat = fs.statSync(dir);
      if (stat.isDirectory() && dir === "/root") dirs.add(dir);
      if (stat.isDirectory() && dir === "/home") {
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
          if (entry.isDirectory()) dirs.add(path.join(dir, entry.name));
        }
      }
    } catch {
      // Ignore unreadable home roots.
    }
  }
  return Array.from(dirs);
}

function candidateMiniappRoots() {
  const explicit = argValue("--src-root", "");
  if (explicit) return [explicit];

  const roots = [];
  const extraRoots = String(process.env.FARM_MINIAPP_SRC_ROOTS || "")
    .split(path.delimiter)
    .map((item) => item.trim())
    .filter(Boolean);
  roots.push(...extraRoots);

  if (process.env.APPDATA) {
    roots.push(path.join(process.env.APPDATA, "QQEX", "miniapp", "temps", "miniapp_src"));
  }

  for (const home of homeDirs()) {
    roots.push(
      path.join(home, ".config", "QQEX", "miniapp", "temps", "miniapp_src"),
      path.join(home, ".config", "QQ", "QQEX", "miniapp", "temps", "miniapp_src"),
      path.join(home, ".local", "share", "QQEX", "miniapp", "temps", "miniapp_src"),
      path.join(home, "snap", "qq", "current", ".config", "QQEX", "miniapp", "temps", "miniapp_src"),
      path.join(home, ".wine", "drive_c", "users", path.basename(home), "AppData", "Roaming", "QQEX", "miniapp", "temps", "miniapp_src"),
    );
  }
  return Array.from(new Set(roots));
}

function findGameJsFiles(appid) {
  const files = [];
  for (const root of candidateMiniappRoots()) {
    walk(root, files);
  }
  const matched = files.filter((file) => path.basename(path.dirname(file)).startsWith(`${appid}_`));
  matched.sort((a, b) => {
    try {
      return fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs;
    } catch {
      return 0;
    }
  });
  return matched;
}

function renderPatch(wsBase, username, proxyUrl) {
  const safeWsBase = JSON.stringify(String(wsBase || "ws://127.0.0.1:9988/admin"));
  const safeUsername = JSON.stringify(String(username || "admin"));
  const safeProxyUrl = JSON.stringify(String(proxyUrl || ""));
  return `${MARKER_START}
;(function () {
  var reportBase = ${safeWsBase};
  var defaultUsername = ${safeUsername};
  var defaultProxyUrl = ${safeProxyUrl};
  var patchConfigKey = reportBase + "|" + defaultUsername + "|" + defaultProxyUrl;
  if (globalThis.__qqFarmCodeCapturePatchConfigKey === patchConfigKey) return;
  globalThis.__qqFarmCodeCapturePatchConfigKey = patchConfigKey;

  var seen = Object.create(null);

  function appendParam(url, key, value) {
    if (!value) return url;
    return url + (url.indexOf("?") >= 0 ? "&" : "?") + encodeURIComponent(key) + "=" + encodeURIComponent(value);
  }

  function getParam(rawUrl, key) {
    var text = String(rawUrl || "");
    var match = text.match(new RegExp("[?&]" + key + "=([^&]+)", "i"));
    return match && match[1] ? decodeURIComponent(match[1]) : "";
  }

  function isFarmGateUrl(rawUrl) {
    var text = String(rawUrl || "");
    return text.indexOf("gate-obt.nqf.qq.com") >= 0 && text.indexOf("/prod/ws") >= 0;
  }

  function buildReportUrl(rawUrl) {
    if (!isFarmGateUrl(rawUrl)) return;
    var code = getParam(rawUrl, "code");
    var seenKey = code + "|" + defaultUsername;
    if (!code || /^-\\d+$/.test(code) || seen[seenKey]) return;
    seen[seenKey] = Date.now();

    var reportUrl = reportBase;
    reportUrl = appendParam(reportUrl, "code", code);
    reportUrl = appendParam(reportUrl, "username", defaultUsername);
    reportUrl = appendParam(reportUrl, "proxyUrl", defaultProxyUrl);
    reportUrl = appendParam(reportUrl, "uin", getParam(rawUrl, "uin") || getParam(rawUrl, "qq"));
    reportUrl = appendParam(reportUrl, "platform", getParam(rawUrl, "platform"));
    reportUrl = appendParam(reportUrl, "os", getParam(rawUrl, "os"));
    reportUrl = appendParam(reportUrl, "ver", getParam(rawUrl, "ver") || getParam(rawUrl, "client_version"));
    reportUrl = appendParam(reportUrl, "openID", getParam(rawUrl, "openID") || getParam(rawUrl, "openid"));
    return reportUrl;
  }

  function toHttpReportUrl(reportUrl) {
    var text = String(reportUrl || "");
    if (text.indexOf("ws://") === 0) return "http://" + text.slice(5);
    if (text.indexOf("wss://") === 0) return "https://" + text.slice(6);
    return text;
  }

  function sendReport(reportUrl, mini, originalConnectSocket) {
    if (!reportUrl) return;
    try {
      if (mini && typeof originalConnectSocket === "function") {
        originalConnectSocket.call(mini, { url: reportUrl });
      }
    } catch (_) {}

    try {
      if (typeof WebSocket === "function") {
        var ws = new WebSocket(reportUrl);
        setTimeout(function () { try { ws.close(); } catch (_) {} }, 1000);
      }
    } catch (_) {}

    var httpUrl = toHttpReportUrl(reportUrl);
    try {
      if (typeof fetch === "function") {
        fetch(httpUrl, { method: "GET", mode: "no-cors", cache: "no-store" }).catch(function () {});
      }
    } catch (_) {}

    try {
      if (typeof XMLHttpRequest === "function") {
        var xhr = new XMLHttpRequest();
        xhr.open("GET", httpUrl, true);
        xhr.send();
      }
    } catch (_) {}

    try {
      if (typeof Image === "function") {
        var img = new Image();
        img.src = httpUrl + (httpUrl.indexOf("?") >= 0 ? "&" : "?") + "_t=" + Date.now();
      }
    } catch (_) {}
  }

  function report(rawUrl, mini, originalConnectSocket) {
    sendReport(buildReportUrl(rawUrl), mini, originalConnectSocket);
  }

  function installConnectSocket() {
    var mini = globalThis.qq || globalThis.wx;
    if (!mini || typeof mini.connectSocket !== "function") return false;
    var originalConnectSocket = mini.__qqFarmCodeCaptureOriginalConnectSocket || mini.connectSocket;
    mini.connectSocket = function (opts) {
      try {
        var url = opts && opts.url ? String(opts.url) : "";
        report(url, mini, originalConnectSocket);
      } catch (_) {}
      return originalConnectSocket.apply(this, arguments);
    };
    mini.__qqFarmCodeCaptureOriginalConnectSocket = originalConnectSocket;
    mini.__qqFarmCodeCaptureWrapped = true;
    mini.__qqFarmCodeCaptureConfigKey = patchConfigKey;
    try { console.log("[qq-farm-code-capture] connectSocket patched for " + defaultUsername); } catch (_) {}
    return true;
  }

  function installWebSocket() {
    if (typeof globalThis.WebSocket !== "function") return false;
    var OriginalWebSocket = globalThis.__qqFarmCodeCaptureOriginalWebSocket || globalThis.WebSocket;
    globalThis.WebSocket = function (url, protocols) {
      try {
        sendReport(buildReportUrl(String(url || "")), null, null);
      } catch (_) {}
      if (arguments.length > 1) return new OriginalWebSocket(url, protocols);
      return new OriginalWebSocket(url);
    };
    try {
      globalThis.WebSocket.prototype = OriginalWebSocket.prototype;
      Object.setPrototypeOf(globalThis.WebSocket, OriginalWebSocket);
      globalThis.WebSocket.CONNECTING = OriginalWebSocket.CONNECTING;
      globalThis.WebSocket.OPEN = OriginalWebSocket.OPEN;
      globalThis.WebSocket.CLOSING = OriginalWebSocket.CLOSING;
      globalThis.WebSocket.CLOSED = OriginalWebSocket.CLOSED;
    } catch (_) {}
    globalThis.__qqFarmCodeCaptureOriginalWebSocket = OriginalWebSocket;
    try { console.log("[qq-farm-code-capture] WebSocket patched for " + defaultUsername); } catch (_) {}
    return true;
  }

  function installOnce() {
    var a = installConnectSocket();
    var b = installWebSocket();
    return a || b;
  }

  var tries = 0;
  var timer = setInterval(function () {
    tries += 1;
    if (installOnce() && tries > 20) clearInterval(timer);
    if (tries > 2400) clearInterval(timer);
  }, 50);
  installOnce();
})();
${MARKER_END}
`;
}

function patchFile(file, patch) {
  const original = fs.readFileSync(file, "utf8");
  let next = original;
  if (original.includes(MARKER_START) && original.includes(MARKER_END)) {
    const start = original.indexOf(MARKER_START);
    const end = original.indexOf(MARKER_END) + MARKER_END.length;
    next = original.slice(0, start) + patch.trimEnd() + original.slice(end);
  } else {
    next = patch + "\n" + original;
    const backup = `${file}.code-capture.bak`;
    if (!fs.existsSync(backup)) fs.writeFileSync(backup, original, "utf8");
  }
  fs.writeFileSync(file, next, "utf8");
}

function main() {
  const appid = argValue("--appid", "1112386029");
  const explicitTarget = argValue("--target", "");
  const targets = explicitTarget ? [explicitTarget] : findGameJsFiles(appid);
  const wsBase = argValue("--capture-ws", process.env.FARM_CAPTURE_WS || "ws://127.0.0.1:9988/admin");
  const username = argValue("--username", process.env.FARM_CAPTURE_USERNAME || "admin");
  const proxyUrl = argValue("--proxy-url", process.env.FARM_CAPTURE_PROXY_URL || "");

  if (targets.length === 0) {
    console.error(`No QQ Farm game.js found for appid ${appid}. Open QQ Classic Farm once, then run this again.`);
    process.exit(1);
  }

  const patch = renderPatch(wsBase, username, proxyUrl);
  let patched = 0;
  for (const target of targets) {
    if (!fs.existsSync(target)) {
      console.error(`Target not found: ${target}`);
      continue;
    }
    try {
      patchFile(target, patch);
      patched += 1;
      console.log(`Patched: ${target}`);
    } catch (err) {
      console.error(`Patch failed: ${target}: ${err && err.message ? err.message : err}`);
    }
  }

  if (patched === 0) {
    console.error(`No QQ Farm game.js was patched for appid ${appid}.`);
    process.exit(1);
  }
  console.log(`Patched ${patched}/${targets.length} QQ Farm game.js file(s).`);
  console.log(`Capture: ${wsBase}`);
}

main();
