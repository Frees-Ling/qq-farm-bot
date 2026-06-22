#!/usr/bin/env node
"use strict";

const http = require("node:http");
const https = require("node:https");

function argValue(name, fallback = "") {
  const idx = process.argv.indexOf(name);
  if (idx >= 0 && idx + 1 < process.argv.length) return process.argv[idx + 1];
  return fallback;
}

function usage() {
  console.log(`Usage:
  node tools/add-account-code.js --username <username> --code <realCode> [--proxy-url <proxy>] [--name <displayName>]

Examples:
  node tools/add-account-code.js --username user001 --code "REAL_QQ_FARM_CODE"
  node tools/add-account-code.js --username user001 --code "REAL_QQ_FARM_CODE" --proxy-url "http://user:pass@1.2.3.4:8080"
`);
}

function requestJson(url) {
  return new Promise((resolve, reject) => {
    const client = url.startsWith("https:") ? https : http;
    const req = client.get(url, (res) => {
      let body = "";
      res.setEncoding("utf8");
      res.on("data", (chunk) => { body += chunk; });
      res.on("end", () => {
        try {
          const data = JSON.parse(body);
          if (res.statusCode >= 400 || !data.ok) {
            reject(new Error(data.error || `HTTP ${res.statusCode}: ${body}`));
            return;
          }
          resolve(data);
        } catch (err) {
          reject(new Error(`Invalid JSON response: ${body || err.message}`));
        }
      });
    });
    req.setTimeout(15000, () => {
      req.destroy(new Error("Request timed out"));
    });
    req.on("error", reject);
  });
}

async function main() {
  const username = argValue("--username", process.env.FARM_CAPTURE_USERNAME || "");
  const code = argValue("--code", process.env.FARM_CAPTURE_CODE || "");
  const proxyUrl = argValue("--proxy-url", process.env.FARM_CAPTURE_PROXY_URL || "");
  const name = argValue("--name", "");
  const panelApi = argValue("--api", process.env.FARM_PANEL_API || "http://127.0.0.1:3000/api/code-capture");

  if (!username || !code) {
    usage();
    process.exit(1);
  }
  if (/^-\d+$/.test(String(code).trim())) {
    console.error("Invalid code: this looks like an error code, not a real QQ Farm login code.");
    process.exit(1);
  }

  const url = new URL(panelApi);
  url.searchParams.set("username", username);
  url.searchParams.set("code", code);
  url.searchParams.set("platform", "qq");
  url.searchParams.set("os", "Windows");
  url.searchParams.set("ver", "1.12.1.6_20260609");
  if (proxyUrl) url.searchParams.set("proxyUrl", proxyUrl);
  if (name) url.searchParams.set("name", name);

  const data = await requestJson(url.toString());
  console.log(JSON.stringify(data, null, 2));
}

main().catch((err) => {
  console.error(err && err.message ? err.message : String(err));
  process.exit(1);
});
