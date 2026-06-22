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
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(full, out);
    } else if (entry.isFile() && entry.name === "game.js") {
      out.push(full);
    }
  }
  return out;
}

function candidateMiniappRoots() {
  const explicit = argValue("--src-root", "");
  if (explicit) return [explicit];

  const home = os.homedir();
  const roots = [];
  if (process.env.APPDATA) {
    roots.push(path.join(process.env.APPDATA, "QQEX", "miniapp", "temps", "miniapp_src"));
  }

  roots.push(
    path.join(home, ".config", "QQEX", "miniapp", "temps", "miniapp_src"),
    path.join(home, ".config", "QQ", "QQEX", "miniapp", "temps", "miniapp_src"),
    path.join(home, ".local", "share", "QQEX", "miniapp", "temps", "miniapp_src"),
    path.join(home, "snap", "qq", "current", ".config", "QQEX", "miniapp", "temps", "miniapp_src"),
    path.join(home, ".wine", "drive_c", "users", os.userInfo().username, "AppData", "Roaming", "QQEX", "miniapp", "temps", "miniapp_src"),
  );
  return roots;
}

function findLatestGameJs(appid) {
  const files = [];
  for (const root of candidateMiniappRoots()) {
    walk(root, files);
  }
  const matched = files.filter((file) => path.basename(path.dirname(file)).startsWith(`${appid}_`));
  matched.sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);
  return matched[0] || "";
}

function renderPatch(wsBase, username, proxyUrl) {
  const safeWsBase = JSON.stringify(String(wsBase || "ws://127.0.0.1:9988/admin"));
  const safeUsername = JSON.stringify(String(username || "admin"));
  const safeProxyUrl = JSON.stringify(String(proxyUrl || ""));
  return `${MARKER_START}
;(function () {
  if (globalThis.__qqFarmCodeCapturePatchInstalled) return;
  globalThis.__qqFarmCodeCapturePatchInstalled = true;

  var reportBase = ${safeWsBase};
  var defaultUsername = ${safeUsername};
  var defaultProxyUrl = ${safeProxyUrl};
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

  function report(rawUrl, mini, originalConnectSocket) {
    if (!isFarmGateUrl(rawUrl)) return;
    var code = getParam(rawUrl, "code");
    if (!code || /^-\\d+$/.test(code) || seen[code]) return;
    seen[code] = Date.now();

    var reportUrl = reportBase;
    reportUrl = appendParam(reportUrl, "code", code);
    reportUrl = appendParam(reportUrl, "username", defaultUsername);
    reportUrl = appendParam(reportUrl, "proxyUrl", defaultProxyUrl);
    reportUrl = appendParam(reportUrl, "uin", getParam(rawUrl, "uin") || getParam(rawUrl, "qq"));
    reportUrl = appendParam(reportUrl, "platform", getParam(rawUrl, "platform"));
    reportUrl = appendParam(reportUrl, "os", getParam(rawUrl, "os"));
    reportUrl = appendParam(reportUrl, "ver", getParam(rawUrl, "ver") || getParam(rawUrl, "client_version"));
    reportUrl = appendParam(reportUrl, "openID", getParam(rawUrl, "openID") || getParam(rawUrl, "openid"));

    try {
      if (mini && typeof originalConnectSocket === "function") {
        originalConnectSocket.call(mini, { url: reportUrl });
        return;
      }
    } catch (_) {}

    try {
      if (typeof WebSocket === "function") {
        var ws = new WebSocket(reportUrl);
        setTimeout(function () { try { ws.close(); } catch (_) {} }, 1000);
      }
    } catch (_) {}
  }

  function installOnce() {
    var mini = globalThis.qq || globalThis.wx;
    if (!mini || typeof mini.connectSocket !== "function") return false;
    if (mini.__qqFarmCodeCaptureWrapped) return true;
    var originalConnectSocket = mini.connectSocket;
    mini.connectSocket = function (opts) {
      try {
        var url = opts && opts.url ? String(opts.url) : "";
        report(url, mini, originalConnectSocket);
      } catch (_) {}
      return originalConnectSocket.apply(this, arguments);
    };
    mini.__qqFarmCodeCaptureWrapped = true;
    try { console.log("[qq-farm-code-capture] connectSocket patched"); } catch (_) {}
    return true;
  }

  var tries = 0;
  var timer = setInterval(function () {
    tries += 1;
    if (installOnce() || tries > 400) clearInterval(timer);
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
  const target = argValue("--target", "") || findLatestGameJs(appid);
  const wsBase = argValue("--capture-ws", process.env.FARM_CAPTURE_WS || "ws://127.0.0.1:9988/admin");
  const username = argValue("--username", process.env.FARM_CAPTURE_USERNAME || "admin");
  const proxyUrl = argValue("--proxy-url", process.env.FARM_CAPTURE_PROXY_URL || "");

  if (!target) {
    console.error(`No QQ Farm game.js found for appid ${appid}. Open QQ Classic Farm once, then run this again.`);
    process.exit(1);
  }
  if (!fs.existsSync(target)) {
    console.error(`Target not found: ${target}`);
    process.exit(1);
  }

  patchFile(target, renderPatch(wsBase, username, proxyUrl));
  console.log(`Patched: ${target}`);
  console.log(`Capture: ${wsBase}`);
}

main();
