// Kapu taste engine — a Chroma-style vector store, right-sized for the
// single-process Railway monolith (no extra service to keep alive).
//
// Every product the agent SHOWS (search), OPENS (get_product) or CARTS gets
// embedded once (OpenAI text-embedding-3-small, 512 dims, normalized) into an
// in-memory catalog index. Each user interaction becomes a weighted event;
// a user's "taste vector" is the time-decayed weighted mean of their event
// embeddings. Recommendations = cosine nearest neighbors in the catalog —
// carted items INCLUDED (a basket add is the strongest taste signal; hiding
// the item from "Picked for you" reads as the rail losing products).
// similarTo() powers "more like this".
//
// Dormant without OPENAI_API_KEY (mirrors the Mongo-optional pattern):
// every entry point no-ops and /api/recs serves empty.

import { loadRecoEvents, persistRecoEvent } from "@/lib/db/mongo";
import type { ProductSummary } from "@/lib/types";

const EMBED_URL = "https://api.openai.com/v1/embeddings";
const MODEL = "text-embedding-3-small";
const DIMS = 512;

const CATALOG_CAP = 4000; // embedded products (insertion-order eviction)
const KEYS_CAP = 2000; // distinct users/sessions with event history
const EVENTS_CAP = 80; // events kept per user
const HALF_LIFE_DAYS = 7; // interaction decay

interface CatalogEntry {
  summary: ProductSummary;
  vec: Float32Array;
}

interface RecoEvent {
  /** product id, or null for a free-text query event */
  pid: string | null;
  vec: Float32Array;
  weight: number;
  at: number;
}

// globalThis stash — Next compiles each API route as its own bundle and HMR
// re-instantiates modules in dev; plain module-level Maps would silo the
// index per route. Same pattern as the canonical Prisma singleton.
interface RecoState {
  catalog: Map<string, CatalogEntry>;
  pendingEmbed: Map<string, ProductSummary>;
  queryVecs: Map<string, Float32Array>;
  events: Map<string, RecoEvent[]>;
  hydrated: Set<string>;
}
const g = globalThis as unknown as { __kapuReco?: RecoState };
const state: RecoState =
  (g.__kapuReco ??= {
    catalog: new Map(),
    pendingEmbed: new Map(),
    queryVecs: new Map(),
    events: new Map(),
    hydrated: new Set(),
  });
const { catalog, pendingEmbed, queryVecs, events, hydrated } = state;

function enabled(): boolean {
  return Boolean(process.env.OPENAI_API_KEY?.trim());
}

function normalize(vec: number[]): Float32Array {
  let n = 0;
  for (const v of vec) n += v * v;
  n = Math.sqrt(n) || 1;
  const out = new Float32Array(vec.length);
  for (let i = 0; i < vec.length; i++) out[i] = vec[i] / n;
  return out;
}

function dot(a: Float32Array, b: Float32Array): number {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i] * b[i];
  return s;
}

async function embed(texts: string[]): Promise<Float32Array[] | null> {
  const key = process.env.OPENAI_API_KEY?.trim();
  if (!key || texts.length === 0) return null;
  try {
    const res = await fetch(EMBED_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
      body: JSON.stringify({ model: MODEL, input: texts.slice(0, 64), dimensions: DIMS }),
      signal: AbortSignal.timeout(12000),
    });
    if (!res.ok) {
      console.error("[reco] embed failed:", res.status, (await res.text()).slice(0, 120));
      return null;
    }
    const data = (await res.json()) as { data: { index: number; embedding: number[] }[] };
    const sorted = [...data.data].sort((a, b) => a.index - b.index);
    return sorted.map((d) => normalize(d.embedding));
  } catch (err) {
    console.error("[reco] embed error:", err instanceof Error ? err.message : err);
    return null;
  }
}

function productText(p: ProductSummary): string {
  return [p.name, p.category ?? "", (p.summary ?? "").slice(0, 120)].filter(Boolean).join(" · ");
}

function evictOldest<K, V>(map: Map<K, V>, cap: number): void {
  while (map.size > cap) {
    const first = map.keys().next().value;
    if (first === undefined) break;
    map.delete(first);
  }
}

/** Register products in the catalog index (embeds lazily, batched, non-blocking). */
export async function recoSeen(products: ProductSummary[]): Promise<void> {
  if (!enabled()) return;
  for (const p of products) {
    if (p.id && p.name && !catalog.has(p.id) && !pendingEmbed.has(p.id)) pendingEmbed.set(p.id, p);
  }
  if (pendingEmbed.size === 0) return;
  const batch = [...pendingEmbed.entries()].slice(0, 64);
  const vecs = await embed(batch.map(([, p]) => productText(p)));
  if (!vecs) return;
  batch.forEach(([id, p], i) => {
    catalog.set(id, { summary: p, vec: vecs[i] });
    pendingEmbed.delete(id);
  });
  evictOldest(catalog, CATALOG_CAP);
}

function pushEvent(key: string, ev: RecoEvent): void {
  const list = events.get(key) ?? [];
  list.push(ev);
  if (list.length > EVENTS_CAP) list.splice(0, list.length - EVENTS_CAP);
  events.delete(key); // re-insert → freshest keys last (eviction order)
  events.set(key, list);
  evictOldest(events, KEYS_CAP);
}

/** Record a product interaction. Weights: shown 0.5 · opened 2 · carted 3. */
export async function recoProductEvent(keys: (string | undefined)[], p: ProductSummary, weight: number): Promise<void> {
  if (!enabled() || !p.id || !p.name) return;
  await recoSeen([p]);
  const entry = catalog.get(p.id);
  if (!entry) return;
  for (const key of keys) {
    if (!key) continue;
    pushEvent(key, { pid: p.id, vec: entry.vec, weight, at: Date.now() });
    void persistRecoEvent({ key, pid: p.id, name: p.name, category: p.category ?? null, price: p.price, image: p.image ?? null, url: p.url ?? null, weight }).catch(() => {});
  }
}

/** Record a free-text search intent (weight 1). */
export async function recoQueryEvent(keys: (string | undefined)[], query: string): Promise<void> {
  if (!enabled()) return;
  const q = query.trim().toLowerCase().slice(0, 120);
  if (q.length < 3) return;
  let vec = queryVecs.get(q);
  if (!vec) {
    const got = await embed([q]);
    if (!got) return;
    vec = got[0];
    queryVecs.set(q, vec);
    evictOldest(queryVecs, 500);
  }
  for (const key of keys) {
    if (!key) continue;
    pushEvent(key, { pid: null, vec, weight: 1, at: Date.now() });
    void persistRecoEvent({ key, pid: null, name: q, weight: 1 }).catch(() => {});
  }
}

function tasteVector(keys: string[], seeds?: Float32Array[]): { vec: Float32Array; signal: number } | null {
  const all: RecoEvent[] = [];
  for (const key of keys) all.push(...(events.get(key) ?? []));
  // seed vectors (♥ favorites) count as steady weight-2 interest
  for (const vec of seeds ?? []) all.push({ pid: null, vec, weight: 2, at: Date.now() });
  if (all.length < 2) return null;
  const acc = new Float32Array(DIMS);
  let total = 0;
  const now = Date.now();
  for (const ev of all) {
    const decay = Math.pow(0.5, (now - ev.at) / (HALF_LIFE_DAYS * 86400000));
    const w = ev.weight * decay;
    for (let i = 0; i < DIMS; i++) acc[i] += ev.vec[i] * w;
    total += w;
  }
  if (total <= 0) return null;
  return { vec: normalize(Array.from(acc, (v) => v / total)), signal: all.length };
}

function neighbors(vec: Float32Array, k: number, exclude: Set<string>, floor: number): ProductSummary[] {
  const scored: { s: number; p: ProductSummary }[] = [];
  for (const [pid, entry] of catalog) {
    if (exclude.has(pid) || entry.summary.in_stock === false) continue;
    const s = dot(vec, entry.vec);
    if (s >= floor) scored.push({ s, p: entry.summary });
  }
  scored.sort((a, b) => b.s - a.s);
  // the catalog can hold one product under several id forms (MCP tools vs
  // scraped rails) — collapse by normalized id AND name before slicing
  const seen = new Set<string>();
  const out: ProductSummary[] = [];
  for (const { p } of scored) {
    const idKey = p.id.toLowerCase();
    const nameKey = `n:${p.name.trim().toLowerCase()}`;
    if (seen.has(idKey) || seen.has(nameKey)) continue;
    seen.add(idKey);
    seen.add(nameKey);
    out.push(p);
    if (out.length === k) break;
  }
  return out.map((p, i) => ({ ...p, pick: i === 0 }));
}

/** "Picked for you" — taste-vector nearest neighbors across the catalog.
 *  Carted items stay eligible: the rail must not "lose" a product the
 *  moment it lands in the basket. */
export function recommendFor(keys: (string | undefined)[], k = 8, seeds?: Float32Array[]): ProductSummary[] {
  if (!enabled()) return [];
  const taste = tasteVector(keys.filter(Boolean) as string[], seeds);
  if (!taste) return [];
  return neighbors(taste.vec, k, new Set(), 0.2);
}

/** "More like this" — neighbors of one product's own embedding. */
export function similarTo(productId: string, k = 6): ProductSummary[] {
  if (!enabled()) return [];
  const entry = catalog.get(productId) ?? catalog.get(productId.toLowerCase());
  if (!entry) return [];
  const exclude = new Set([productId, productId.toLowerCase()]);
  return neighbors(entry.vec, k, exclude, 0.3);
}

/** Semantic query→result scores — guards the KAPU'S PICK badge against
 *  accessory noise (Kapruka ranks car chargers above actual phones for
 *  "phone"). Returns cosine scores aligned with `products`, or null when
 *  embeddings are off/slow — callers fall back to rank order. */
export async function queryMatchScores(query: string, products: ProductSummary[], timeoutMs = 900): Promise<number[] | null> {
  if (!enabled() || products.length < 2) return null;
  const q = query.trim().toLowerCase().slice(0, 120);
  if (q.length < 3) return null;
  try {
    const work = (async (): Promise<number[] | null> => {
      await recoSeen(products);
      let qv = queryVecs.get(q);
      if (!qv) {
        const got = await embed([q]);
        if (!got) return null;
        qv = got[0];
        queryVecs.set(q, qv);
        evictOldest(queryVecs, 500);
      }
      return products.map((p) => {
        const entry = catalog.get(p.id);
        return entry ? dot(qv, entry.vec) : -1;
      });
    })();
    return await Promise.race([work, new Promise<null>((resolve) => setTimeout(() => resolve(null), timeoutMs))]);
  } catch {
    return null;
  }
}

/** Last-known search summary for a product — lets compare_products degrade
 *  gracefully when get_product 500s (EF_PC_ELEC* family does, verified). */
export function catalogSummary(productId: string): ProductSummary | null {
  return (catalog.get(productId) ?? catalog.get(productId.toLowerCase()))?.summary ?? null;
}

/** Rebuild a user's taste events from Mongo after a redeploy (the vector
 *  index is in-memory). Names re-embed lazily in batches; each key loads
 *  at most once per process. No-op without MONGODB_URI. */
export async function hydrateReco(keysIn: (string | undefined)[]): Promise<void> {
  if (!enabled()) return;
  const keys = (keysIn.filter(Boolean) as string[]).filter((k) => !hydrated.has(k));
  if (keys.length === 0) return;
  keys.forEach((k) => hydrated.add(k));
  const docs = await loadRecoEvents(keys).catch(() => []);
  if (docs.length === 0) return;
  // embed all products referenced by the log (recoSeen batches 64 per call)
  const prods = new Map<string, ProductSummary>();
  for (const d of docs) {
    if (d.pid && d.name && !catalog.has(d.pid)) {
      prods.set(d.pid, { id: d.pid, name: d.name, category: d.category ?? null, price: d.price ?? null, image: d.image ?? null, url: d.url ?? null, currency: "LKR" });
    }
  }
  const list = [...prods.values()];
  for (let i = 0; i < list.length; i += 64) await recoSeen(list.slice(i, i + 64));
  // batch-embed the query events' texts
  const queries = [...new Set(docs.filter((d) => !d.pid && d.name).map((d) => d.name.toLowerCase()))].filter((q) => !queryVecs.has(q));
  if (queries.length) {
    const vecs = await embed(queries.slice(0, 64));
    if (vecs) queries.slice(0, 64).forEach((q, i) => queryVecs.set(q, vecs[i]));
  }
  // replay oldest-first with original weights/timestamps
  for (const d of [...docs].reverse()) {
    const vec = d.pid ? catalog.get(d.pid)?.vec : queryVecs.get(d.name.toLowerCase());
    if (vec) pushEvent(d.key, { pid: d.pid ?? null, vec, weight: d.weight, at: new Date(d.at).getTime() });
  }
}

/** Embed short texts (♥ favorite names) as taste seeds — query-cache backed. */
export async function textVectors(texts: string[]): Promise<Float32Array[]> {
  if (!enabled()) return [];
  const want = texts.map((t) => t.trim().toLowerCase().slice(0, 80)).filter((t) => t.length >= 3).slice(0, 6);
  const missing = want.filter((q) => !queryVecs.has(q));
  if (missing.length) {
    const got = await embed(missing);
    if (got) missing.forEach((q, i) => queryVecs.set(q, got[i]));
    evictOldest(queryVecs, 500);
  }
  return want.map((q) => queryVecs.get(q)).filter((v): v is Float32Array => Boolean(v));
}

/** Diagnostics for /api/recs (& honest "not enough signal" tool replies). */
export function recoStats(keys: (string | undefined)[]): { catalog: number; events: number } {
  let n = 0;
  for (const key of keys) if (key) n += events.get(key)?.length ?? 0;
  return { catalog: catalog.size, events: n };
}
