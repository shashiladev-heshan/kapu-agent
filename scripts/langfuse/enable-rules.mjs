#!/usr/bin/env node
// Turns on any Kapu evaluation rule that landed disabled.
//
//   node scripts/langfuse/enable-rules.mjs
//
// Enabling a rule makes Langfuse preflight the judge model, and that call is
// slow on a small self-hosted box — so this retries patiently and reports
// exactly which rules still need a click in the UI.

import { readFileSync } from "node:fs";

try {
  for (const line of readFileSync(new URL("../../.env", import.meta.url), "utf8").split("\n")) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)$/.exec(line);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "").trim();
  }
} catch {
  /* env may come from the real environment */
}

const BASE = (process.env.LANGFUSE_BASE_URL || "").replace(/\/$/, "");
const auth =
  "Basic " + Buffer.from(`${process.env.LANGFUSE_PUBLIC_KEY}:${process.env.LANGFUSE_SECRET_KEY}`).toString("base64");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function api(method, path, body) {
  let res;
  try {
    res = await fetch(`${BASE}${path}`, {
      method,
      headers: { Authorization: auth, "Content-Type": "application/json" },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
  } catch (err) {
    // A slow preflight can have the connection reset under it — retryable,
    // not fatal.
    return { ok: false, status: 599, json: { message: `network: ${err?.cause?.code || err.message}` } };
  }
  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    json = text;
  }
  return { ok: res.ok, status: res.status, json };
}

const list = await api("GET", "/api/public/unstable/evaluation-rules?limit=100");
if (!list.ok) {
  console.error("✗ could not list rules:", list.status, JSON.stringify(list.json).slice(0, 200));
  process.exit(1);
}
const disabled = (list.json?.data ?? []).filter((r) => r.name.startsWith("kapu-") && !r.enabled);
if (!disabled.length) {
  const on = (list.json?.data ?? []).filter((r) => r.name.startsWith("kapu-") && r.enabled);
  console.log(`All ${on.length} Kapu rule(s) already enabled.`);
  process.exit(0);
}

console.log(`${disabled.length} disabled rule(s) to enable\n`);
const stubborn = [];
for (const rule of disabled) {
  process.stdout.write(`▶ ${rule.name} `);
  let done = false;
  for (let i = 1; i <= 8; i++) {
    const r = await api("PUT", `/api/public/unstable/evaluation-rules/${rule.id}`, { enabled: true });
    if (r.ok) {
      console.log("✓ enabled");
      done = true;
      break;
    }
    process.stdout.write(".");
    await sleep(4000);
  }
  if (!done) {
    console.log(" ✗ still timing out");
    stubborn.push(rule.name);
  }
}

if (stubborn.length) {
  console.log(`\n⚠ Could not enable: ${stubborn.join(", ")}`);
  console.log(`  Restart langfuse-web and re-run, or flip the toggle at`);
  console.log(`  ${BASE} → Evaluations → Running evaluators`);
  process.exit(1);
}
console.log("\nAll rules enabled — new turns will be judged.");
