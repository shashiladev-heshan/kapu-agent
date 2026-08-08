#!/usr/bin/env node
// What is actually provisioned in Langfuse right now: evaluators, rules,
// and whether each rule is live. Ground truth, independent of setup logs.
//
//   node scripts/langfuse/status.mjs

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
const get = async (p) => {
  try {
    const r = await fetch(`${BASE}${p}`, { headers: { Authorization: auth } });
    return r.ok ? await r.json() : null;
  } catch {
    return null;
  }
};

const health = await get("/api/public/health");
console.log(`Langfuse ${BASE}`);
console.log(`Health:   ${health ? `OK v${health.version}` : "UNREACHABLE"}\n`);

const evs = ((await get("/api/public/unstable/evaluators?limit=100"))?.data ?? []).filter((e) =>
  e.name.startsWith("kapu-")
);
console.log(`EVALUATORS (${evs.length})`);
for (const e of evs.sort((a, b) => a.name.localeCompare(b.name))) console.log(`  ${e.name.padEnd(28)} v${e.version}`);

const rules = ((await get("/api/public/unstable/evaluation-rules?limit=100"))?.data ?? []).filter((r) =>
  r.name.startsWith("kapu-")
);
const live = rules.filter((r) => r.enabled);
console.log(`\nRULES (${live.length}/${rules.length} enabled)`);
for (const r of rules.sort((a, b) => a.name.localeCompare(b.name))) {
  console.log(`  ${r.enabled ? "●" : "○"} ${r.name.padEnd(40)} sampling=${r.sampling}`);
}
if (rules.length && live.length < rules.length) {
  console.log(`\n  ○ = disabled. Run: node scripts/langfuse/enable-rules.mjs`);
}
