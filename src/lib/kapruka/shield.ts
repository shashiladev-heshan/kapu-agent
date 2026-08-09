// MCP Shield — single gateway to the Kapruka MCP server.
//
// The Kapruka MCP allows 60 requests/min/IP. On Railway every user shares the
// container's egress IP, so this module is the one place allowed to talk to
// the MCP: it caches reads, coalesces identical in-flight calls, and queues
// everything through a token bucket kept under the limit.

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { LRUCache } from "lru-cache";

const MCP_URL = process.env.KAPRUKA_MCP_URL || "https://mcp.kapruka.com/mcp";

// ── token bucket: 50/min leaves headroom under the 60/min limit ───────
const BUCKET_CAPACITY = 50;
let tokens = BUCKET_CAPACITY;
let lastRefill = Date.now();
const waiters: (() => void)[] = [];

function refill() {
  const now = Date.now();
  const add = ((now - lastRefill) / 60_000) * BUCKET_CAPACITY;
  if (add >= 1) {
    tokens = Math.min(BUCKET_CAPACITY, tokens + Math.floor(add));
    lastRefill = now;
  }
  while (tokens >= 1 && waiters.length > 0) {
    tokens -= 1;
    waiters.shift()!();
  }
}
setInterval(refill, 1_000).unref?.();

function takeToken(): Promise<void> {
  refill();
  if (tokens >= 1) {
    tokens -= 1;
    return Promise.resolve();
  }
  return new Promise((resolve) => waiters.push(resolve));
}

// ── MCP client (lazy singleton, reconnects on failure) ────────────────
let clientPromise: Promise<Client> | null = null;

async function connect(): Promise<Client> {
  const client = new Client({ name: "kapu-agent", version: "0.1.0" });
  const transport = new StreamableHTTPClientTransport(new URL(MCP_URL));
  await client.connect(transport);
  return client;
}

function getClient(): Promise<Client> {
  if (!clientPromise) {
    clientPromise = connect().catch((err) => {
      clientPromise = null;
      throw err;
    });
  }
  return clientPromise;
}

// ── cache + in-flight coalescing ───────────────────────────────────────
const TTL: Record<string, number> = {
  kapruka_list_categories: 30 * 60_000,
  kapruka_search_products: 10 * 60_000,
  kapruka_get_product: 15 * 60_000,
  kapruka_list_delivery_cities: 24 * 60 * 60_000,
  kapruka_check_delivery: 5 * 60_000,
};

const cache = new LRUCache<string, string>({ max: 2000, ttl: 30 * 60_000 });
const inflight = new Map<string, Promise<string>>();

function stableStringify(obj: unknown): string {
  if (obj === null || typeof obj !== "object") return JSON.stringify(obj);
  if (Array.isArray(obj)) return `[${obj.map(stableStringify).join(",")}]`;
  const keys = Object.keys(obj as Record<string, unknown>).sort();
  return `{${keys
    .map((k) => `${JSON.stringify(k)}:${stableStringify((obj as Record<string, unknown>)[k])}`)
    .join(",")}}`;
}

// The MCP reports BOTH "no results" and "rate limited" as plain text with
// `isError: false` — i.e. as successes — despite response_format:json
// ([[payload-normalizing]]). Verified live 9 Aug 2026: of 70 burst calls, 24
// came back rate-limited and every one had isError:false. Left untranslated
// that text reaches parseJson and surfaces to the model as a dead tool, and
// callWithRetry below never fires because nothing ever throws.
const RATE_LIMITED = /rate limit exceeded|too many requests/i;
const NO_PRODUCTS = /^\s*no products found/i;

function interpretPlainText(tool: string, text: string): string {
  const head = text.trimStart()[0];
  if (head === "{" || head === "[") return text; // the overwhelming majority
  if (RATE_LIMITED.test(text)) {
    // Throw so the retry below engages — this is transient, not a real answer.
    throw new Error(`Kapruka MCP rate limit from ${tool}: ${text.trim().slice(0, 200)}`);
  }
  if (NO_PRODUCTS.test(text)) {
    // An empty search is a RESULT, not a failure. Callers read
    // products/results/items, and the executor already renders `no_results`.
    return JSON.stringify({ count: 0, products: [] });
  }
  return text;
}

async function rawCall(tool: string, params: Record<string, unknown>): Promise<string> {
  await takeToken();
  const client = await getClient();
  let result;
  try {
    // Every Kapruka tool nests its arguments under a single `params` object.
    result = await client.callTool({ name: tool, arguments: { params } });
  } catch (err) {
    // Connection may have gone stale (server restarts, idle timeouts) — reconnect once.
    clientPromise = null;
    const fresh = await getClient();
    result = await fresh.callTool({ name: tool, arguments: { params } });
  }
  const content = (result.content ?? []) as { type: string; text?: string }[];
  const text = content
    .filter((c) => c.type === "text" && typeof c.text === "string")
    .map((c) => c.text)
    .join("\n");
  if (result.isError) {
    throw new Error(`Kapruka MCP error from ${tool}: ${text.slice(0, 500)}`);
  }
  return interpretPlainText(tool, text);
}

/** Rate-limit blips (shared per-IP bucket — busier on challenge day) are
 *  retried once in place after a short wait, so the model never narrates
 *  "system busy" for a 2-second hiccup. Long waits still surface honestly. */
async function callWithRetry(tool: string, params: Record<string, unknown>): Promise<string> {
  try {
    return await rawCall(tool, params);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (!/rate.?limit|429|too many/i.test(msg)) throw err;
    const after = Number(/retry[_-\s]?after[^0-9]*(\d+)/i.exec(msg)?.[1] ?? 3);
    if (after > 12) throw err;
    await new Promise((r) => setTimeout(r, (after + 0.5) * 1000));
    return rawCall(tool, params);
  }
}

/**
 * Call a Kapruka MCP tool through the shield. Always requests JSON and
 * returns the raw JSON string. Reads are cached; identical concurrent
 * calls share one request.
 */
export async function kapruka(tool: string, params: Record<string, unknown>): Promise<string> {
  const fullParams = { ...params, response_format: "json" };
  const cacheable = tool in TTL;
  const key = `${tool}:${stableStringify(fullParams)}`;

  if (cacheable) {
    const hit = cache.get(key);
    if (hit !== undefined) return hit;
    const pending = inflight.get(key);
    if (pending) return pending;
  }

  const promise = callWithRetry(tool, fullParams)
    .then((text) => {
      if (cacheable) cache.set(key, text, { ttl: TTL[tool] });
      return text;
    })
    .finally(() => inflight.delete(key));

  if (cacheable) inflight.set(key, promise);
  return promise;
}

/** Parse a kapruka() JSON response, tolerating non-JSON error strings. */
export function parseJson<T = Record<string, unknown>>(text: string): T {
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new Error(`Unexpected non-JSON response from Kapruka MCP: ${text.slice(0, 300)}`);
  }
}
