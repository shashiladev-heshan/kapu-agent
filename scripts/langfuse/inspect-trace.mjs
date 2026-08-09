#!/usr/bin/env node
// Pretty-prints the newest trace for a session — the fastest way to confirm a
// turn was traced, costed and scored.
//
//   node scripts/langfuse/inspect-trace.mjs <sessionId>

import { readFileSync } from "node:fs";

try {
  for (const line of readFileSync(new URL("../../.env", import.meta.url), "utf8").split("\n")) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)$/.exec(line);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "").trim();
  }
} catch {
  /* env may come from the real environment */
}

const sessionId = process.argv[2];
if (!sessionId) {
  console.error("usage: node scripts/langfuse/inspect-trace.mjs <sessionId>");
  process.exit(1);
}

const BASE = (process.env.LANGFUSE_BASE_URL || "").replace(/\/$/, "");
const auth =
  "Basic " + Buffer.from(`${process.env.LANGFUSE_PUBLIC_KEY}:${process.env.LANGFUSE_SECRET_KEY}`).toString("base64");
const get = async (p) => {
  const r = await fetch(`${BASE}${p}`, { headers: { Authorization: auth } });
  return r.ok ? r.json() : null;
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let head = null;
process.stdout.write("waiting for ingestion ");
for (let i = 0; i < 24; i++) {
  const j = await get(`/api/public/traces?sessionId=${encodeURIComponent(sessionId)}&limit=1`);
  if (j?.data?.[0]) {
    head = j.data[0];
    break;
  }
  process.stdout.write(".");
  await sleep(5000);
}
if (!head) {
  console.log(`\nno trace for session ${sessionId}`);
  process.exit(1);
}

const t = (await get(`/api/public/traces/${head.id}`)) ?? head;
console.log("\n");
console.log(`trace       ${t.id}`);
console.log(`name        ${t.name || "(unnamed)"}`);
console.log(`environment ${t.environment}`);
console.log(`session     ${t.sessionId}`);
console.log(`tags        ${JSON.stringify(t.tags)}`);
console.log(`latency     ${t.latency}s`);
console.log(`cost        $${t.totalCost}`);
console.log(`input       ${String(t.input ?? "").slice(0, 90)}`);
console.log(`output      ${String(t.output ?? "").slice(0, 120)}`);

console.log(`\nobservations (${(t.observations ?? []).length})`);
for (const o of t.observations ?? []) {
  const u = o.usageDetails && Object.keys(o.usageDetails).length ? JSON.stringify(o.usageDetails) : "";
  console.log(`  ${String(o.type).padEnd(10)} ${String(o.name).padEnd(28)} ${u}`);
}

const scores = t.scores ?? [];
console.log(`\nscores (${scores.length})`);
for (const s of scores) {
  console.log(`  ${String(s.name).padEnd(34)} ${String(s.value).padEnd(8)} ${s.comment ? `— ${String(s.comment).slice(0, 90)}` : ""}`);
}
console.log(`\n${BASE}/project/kapu-agent/traces/${t.id}`);
