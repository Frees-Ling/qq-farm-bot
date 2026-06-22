#!/usr/bin/env node
"use strict";

const { spawnSync } = require("node:child_process");
const path = require("node:path");

function argValue(name, fallback = "") {
  const idx = process.argv.indexOf(name);
  if (idx >= 0 && idx + 1 < process.argv.length) return process.argv[idx + 1];
  return fallback;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function passthroughArgs(args) {
  const next = [];
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === "--interval-ms" || arg === "--timeout-sec") {
      i += 1;
      continue;
    }
    next.push(arg);
  }
  return next;
}

async function main() {
  const script = path.join(__dirname, "patch-qq-farm-code-capture.js");
  const intervalMs = Math.max(1000, Number(argValue("--interval-ms", "3000")) || 3000);
  const timeoutSec = Math.max(0, Number(argValue("--timeout-sec", "0")) || 0);
  const startedAt = Date.now();
  const passthrough = passthroughArgs(process.argv.slice(2));

  console.log("Waiting for QQ Classic Farm mini-app cache...");
  while (true) {
    const ret = spawnSync(process.execPath, [script, ...passthrough], {
      cwd: path.dirname(__dirname),
      encoding: "utf8",
    });

    if (ret.status === 0) {
      process.stdout.write(ret.stdout || "");
      process.stderr.write(ret.stderr || "");
      console.log("QQ Farm code capture patch is ready. Reopen QQ Classic Farm to capture code.");
      return;
    }

    const output = `${ret.stdout || ""}${ret.stderr || ""}`.trim();
    if (output) console.log(output);

    if (timeoutSec > 0 && Date.now() - startedAt >= timeoutSec * 1000) {
      console.error(`Timed out after ${timeoutSec}s waiting for QQ Farm game.js.`);
      process.exit(1);
    }

    await sleep(intervalMs);
  }
}

main().catch((err) => {
  console.error(err && err.stack ? err.stack : String(err));
  process.exit(1);
});
