#!/usr/bin/env node
// Drives Kapu's scenario suite against a running server and grades each turn.
//
//   node scripts/evals/run.mjs                      # against localhost:3100
//   KAPU_URL=https://kapuwa.shop node scripts/evals/run.mjs
//   node scripts/evals/run.mjs si-flowers en-cake-search   # just these
//
// Every turn is already traced and deterministically scored by the app itself.
// What the runner adds is the SCENARIO-level expectation — "this input should
// have called search_products and must never have called create_order" — which
// only the suite knows. Those land in Langfuse as scores next to the judges.
//
// Scenarios run sequentially on purpose: the Kapruka MCP rate limit is 60
// req/min across a shared egress IP, and one turn can burn several calls.

import { readFileSync } from "node:fs";
import { SCENARIOS } from "./scenarios.mjs";

try {
  for (const line of readFileSync(new URL("../../.env", import.meta.url), "utf8").split("\n")) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)$/.exec(line);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "").trim();
  }
} catch {
  /* env may come from the real environment */
}

const KAPU_URL = (process.env.KAPU_URL || "http://localhost:3100").replace(/\/$/, "");
const LF_BASE = (process.env.LANGFUSE_BASE_URL || "").replace(/\/$/, "");
const LF_AUTH =
  process.env.LANGFUSE_PUBLIC_KEY && process.env.LANGFUSE_SECRET_KEY
    ? "Basic " +
      Buffer.from(`${process.env.LANGFUSE_PUBLIC_KEY}:${process.env.LANGFUSE_SECRET_KEY}`).toString("base64")
    : null;

const RUN_ID = `evalrun-${new Date().toISOString().replace(/[:.]/g, "-")}`;
const only = process.argv.slice(2);
const suite = only.length ? SCENARIOS.filter((s) => only.includes(s.id)) : SCENARIOS;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Runs one turn and returns everything the SSE stream revealed. */
async function runTurn(scenario, sessionId) {
  const res = await fetch(`${KAPU_URL}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sessionId, message: scenario.message, language: scenario.language }),
  });
  if (!res.ok || !res.body) throw new Error(`/api/chat returned ${res.status}`);

  const out = { reply: "", tools: [], toolErrors: 0, blocks: [], error: null };
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = "";
  const started = Date.now();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    const parts = buf.split("\n\n");
    buf = parts.pop() ?? "";
    for (const part of parts) {
      const line = part.split("\n").find((l) => l.startsWith("data: "));
      if (!line) continue;
      let ev;
      try {
        ev = JSON.parse(line.slice(6));
      } catch {
        continue;
      }
      if (ev.type === "text") out.reply += ev.delta;
      else if (ev.type === "tool" && ev.status === "start") out.tools.push(ev.name);
      else if (ev.type === "tool" && ev.status === "end" && ev.error) out.toolErrors++;
      else if (ev.type === "block") out.blocks.push(ev.block?.type);
      else if (ev.type === "error") out.error = ev.message;
    }
  }
  out.ms = Date.now() - started;
  return out;
}

/** Turns a scenario's `expect` into pass/fail scores. */
function grade(scenario, r) {
  const e = scenario.expect ?? {};
  const scores = [];
  const fails = [];

  if (e.tools?.length) {
    const missing = e.tools.filter((t) => !r.tools.includes(t));
    scores.push({ name: "eval-expected-tools", value: missing.length ? 0 : 1, comment: missing.length ? `missing: ${missing.join(", ")}` : "all expected tools called" });
    if (missing.length) fails.push(`missing tools ${missing.join(",")}`);
  }
  if (e.forbidTools?.length) {
    const used = e.forbidTools.filter((t) => r.tools.includes(t));
    scores.push({ name: "eval-no-forbidden-tools", value: used.length ? 0 : 1, comment: used.length ? `called: ${used.join(", ")}` : "no forbidden tool called" });
    if (used.length) fails.push(`FORBIDDEN tool ${used.join(",")}`);
  }
  if (e.blocks?.length) {
    const missing = e.blocks.filter((b) => !r.blocks.includes(b));
    scores.push({ name: "eval-expected-blocks", value: missing.length ? 0 : 1, comment: missing.length ? `missing: ${missing.join(", ")}` : "all expected blocks rendered" });
    if (missing.length) fails.push(`missing blocks ${missing.join(",")}`);
  }
  if (e.replyMatches) {
    const ok = e.replyMatches.test(r.reply);
    scores.push({ name: "eval-reply-pattern", value: ok ? 1 : 0, comment: ok ? "reply matched required pattern" : `reply did not match ${e.replyMatches}` });
    if (!ok) fails.push("reply pattern");
  }
  if (e.replyRejects) {
    const bad = e.replyRejects.test(r.reply);
    scores.push({ name: "eval-reply-forbidden-pattern", value: bad ? 0 : 1, comment: bad ? `reply matched forbidden ${e.replyRejects}` : "no forbidden pattern" });
    if (bad) fails.push("forbidden reply pattern");
  }
  if (r.error) fails.push(`stream error: ${r.error.slice(0, 60)}`);
  return { scores, fails };
}

/** The app traces the turn; we find it by session so we can attach our scores. */
async function findTrace(sessionId) {
  if (!LF_AUTH) return null;
  for (let i = 0; i < 18; i++) {
    await sleep(5000);
    const res = await fetch(`${LF_BASE}/api/public/traces?sessionId=${encodeURIComponent(sessionId)}&limit=1`, {
      headers: { Authorization: LF_AUTH },
    });
    if (res.ok) {
      const j = await res.json().catch(() => null);
      const id = j?.data?.[0]?.id;
      if (id) return id;
    }
  }
  return null;
}

async function pushScore(traceId, s) {
  await fetch(`${LF_BASE}/api/public/scores`, {
    method: "POST",
    headers: { Authorization: LF_AUTH, "Content-Type": "application/json" },
    body: JSON.stringify({ traceId, name: s.name, value: s.value, dataType: "BOOLEAN", comment: s.comment }),
  }).catch(() => {});
}

// ── run ───────────────────────────────────────────────────────────────
console.log(`Kapu:     ${KAPU_URL}`);
console.log(`Langfuse: ${LF_BASE || "(not configured — scores will not be pushed)"}`);
console.log(`Run:      ${RUN_ID}\n`);

const results = [];
for (const scenario of suite) {
  const sessionId = `eval_${RUN_ID}_${scenario.id}`.slice(0, 64);
  process.stdout.write(`▶ ${scenario.id.padEnd(26)} `);
  let r;
  try {
    r = await runTurn(scenario, sessionId);
  } catch (err) {
    console.log(`✗ REQUEST FAILED — ${err.message}`);
    results.push({ id: scenario.id, ok: false, fails: [err.message] });
    continue;
  }
  const { scores, fails } = grade(scenario, r);
  const ok = fails.length === 0;
  console.log(
    `${ok ? "✓" : "✗"} ${String(r.ms).padStart(6)}ms  tools=[${r.tools.join(",") || "-"}]${fails.length ? `  → ${fails.join("; ")}` : ""}`
  );
  results.push({ id: scenario.id, ok, fails, sessionId, scores, reply: r.reply });
  // Breathing room for the shared-IP MCP rate limit.
  await sleep(2500);
}

if (LF_AUTH) {
  process.stdout.write("\nAttaching scenario scores to traces… ");
  let attached = 0;
  for (const res of results) {
    if (!res.sessionId || !res.scores?.length) continue;
    const traceId = await findTrace(res.sessionId);
    if (!traceId) continue;
    for (const s of res.scores) await pushScore(traceId, s);
    attached++;
  }
  console.log(`${attached}/${results.filter((r) => r.scores?.length).length} traces scored`);
}

const passed = results.filter((r) => r.ok).length;
console.log(`\n${"─".repeat(60)}`);
console.log(`${passed}/${results.length} scenarios passed`);
for (const r of results.filter((x) => !x.ok)) console.log(`  ✗ ${r.id}: ${r.fails.join("; ")}`);
if (LF_BASE) console.log(`\nTraces: ${LF_BASE}  (filter sessions by "${RUN_ID}")`);
process.exit(passed === results.length ? 0 : 1);
