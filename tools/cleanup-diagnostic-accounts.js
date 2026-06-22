#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const candidates = [
  path.join(root, "core", "data", "accounts.json"),
  path.join(root, "data", "accounts.json"),
];

const diagnosticCodePattern = /^(DIAG_CAPTURE_|TEST_SERVER_CAPTURE_)/;

let changedAny = false;
for (const file of candidates) {
  if (!fs.existsSync(file)) continue;
  const data = JSON.parse(fs.readFileSync(file, "utf8"));
  const accounts = Array.isArray(data.accounts) ? data.accounts : [];
  const kept = accounts.filter((account) => {
    const code = String(account && account.code || "");
    return !diagnosticCodePattern.test(code);
  });
  const removed = accounts.length - kept.length;
  if (removed <= 0) {
    console.log(`${file}: no diagnostic accounts`);
    continue;
  }

  const backup = `${file}.bak.${Date.now()}`;
  fs.copyFileSync(file, backup);
  data.accounts = kept;
  if (kept.length === 0) {
    data.nextId = 1;
  } else {
    const maxId = kept.reduce((max, account) => Math.max(max, Number.parseInt(account.id, 10) || 0), 0);
    data.nextId = Math.max(Number.parseInt(data.nextId, 10) || 1, maxId + 1);
  }
  fs.writeFileSync(file, `${JSON.stringify(data, null, 2)}\n`, "utf8");
  changedAny = true;
  console.log(`${file}: removed ${removed} diagnostic account(s), backup=${backup}`);
}

if (!changedAny) {
  console.log("No diagnostic accounts were removed.");
}
