// Kapruka knowledge base — vector store + retrieval for the kapruka_help
// tool. ChromaDB (CHROMA_URL, e.g. a Railway service on the private network
// or a local docker container) is the PRIMARY store, spoken to via its v2
// REST API directly (no client dep, no version-matching pain). Fallback
// chain mirrors the rails philosophy — Chroma → in-process vectors → Mongo
// (KapuKbChunk cold-start) → empty. Embeddings: OpenAI text-embedding-3-small
// @512d, same as the taste engine. Dormant without OPENAI_API_KEY.

import { loadKbChunks, saveKbChunks } from "@/lib/db/mongo";
import { KB_PAGES, extractChunks, fetchKbPage, type KbChunk } from "@/lib/kb/pages";

const EMBED_URL = "https://api.openai.com/v1/embeddings";
const EMBED_MODEL = "text-embedding-3-small";
const DIMS = 512;
const COLLECTION = "kapu_kb";
const REFRESH_MS = 7 * 24 * 3600_000; // weekly re-crawl
const INGEST_COOLDOWN_MS = 10 * 60_000;

export interface KbHit {
  title: string;
  url: string;
  section: string;
  text: string;
  score: number;
}

interface VecChunk extends KbChunk {
  vec: Float32Array;
}

// globalThis stash — same HMR-survival pattern as the taste engine
interface KbState {
  chunks: VecChunk[];
  hydrated: boolean;
  chromaCollectionId: string | null;
  lastIngestAt: number;
  ingesting: Promise<number> | null;
}
const g = globalThis as unknown as { __kapuKb?: KbState };
const state: KbState = (g.__kapuKb ??= {
  chunks: [],
  hydrated: false,
  chromaCollectionId: null,
  lastIngestAt: 0,
  ingesting: null,
});

const kbEnabled = () => Boolean(process.env.OPENAI_API_KEY?.trim());
const chromaBase = () => process.env.CHROMA_URL?.trim().replace(/\/+$/, "") || null;

// ── embeddings (shared shape with reco/store.ts) ───────────────────────
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
  if (!key || !texts.length) return null;
  try {
    const res = await fetch(EMBED_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
      body: JSON.stringify({ model: EMBED_MODEL, input: texts.slice(0, 96), dimensions: DIMS }),
      signal: AbortSignal.timeout(20000),
    });
    if (!res.ok) {
      console.error("[kb] embed failed:", res.status, (await res.text()).slice(0, 120));
      return null;
    }
    const data = (await res.json()) as { data: { index: number; embedding: number[] }[] };
    return [...data.data].sort((a, b) => a.index - b.index).map((d) => normalize(d.embedding));
  } catch (err) {
    console.error("[kb] embed error:", err instanceof Error ? err.message : err);
    return null;
  }
}

// ── Chroma v2 REST (tenant/database defaults) ──────────────────────────
const chromaPath = (rest: string) =>
  `${chromaBase()}/api/v2/tenants/default_tenant/databases/default_database/${rest}`;

async function chroma<T>(path: string, init?: RequestInit): Promise<T | null> {
  if (!chromaBase()) return null;
  try {
    const res = await fetch(chromaPath(path), {
      ...init,
      headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
      signal: AbortSignal.timeout(12000),
    });
    if (!res.ok) {
      console.error("[kb] chroma", path.split("/").pop(), "failed:", res.status, (await res.text()).slice(0, 140));
      return null;
    }
    const text = await res.text();
    return (text ? JSON.parse(text) : {}) as T;
  } catch (err) {
    console.error("[kb] chroma unreachable:", err instanceof Error ? err.message.slice(0, 100) : err);
    return null;
  }
}

async function chromaCollection(): Promise<string | null> {
  if (state.chromaCollectionId) return state.chromaCollectionId;
  const col = await chroma<{ id: string }>("collections", {
    method: "POST",
    // cosine space to match the normalized embeddings (server default is l2)
    body: JSON.stringify({ name: COLLECTION, get_or_create: true, configuration: { hnsw: { space: "cosine" } } }),
  });
  state.chromaCollectionId = col?.id ?? null;
  return state.chromaCollectionId;
}

async function chromaUpsert(chunks: VecChunk[]): Promise<boolean> {
  const col = await chromaCollection();
  if (!col) return false;
  for (let i = 0; i < chunks.length; i += 100) {
    const batch = chunks.slice(i, i + 100);
    const ok = await chroma(`collections/${col}/upsert`, {
      method: "POST",
      body: JSON.stringify({
        ids: batch.map((c) => c.id),
        embeddings: batch.map((c) => [...c.vec]),
        documents: batch.map((c) => c.text),
        metadatas: batch.map((c) => ({ url: c.url, title: c.title, section: c.section })),
      }),
    });
    if (ok === null) return false;
  }
  return true;
}

async function chromaQuery(vec: Float32Array, k: number): Promise<KbHit[] | null> {
  const col = await chromaCollection();
  if (!col) return null;
  const res = await chroma<{
    documents?: string[][];
    metadatas?: { url?: string; title?: string; section?: string }[][];
    distances?: number[][];
  }>(`collections/${col}/query`, {
    method: "POST",
    body: JSON.stringify({
      query_embeddings: [[...vec]],
      n_results: k,
      include: ["documents", "metadatas", "distances"],
    }),
  });
  if (!res?.documents?.[0]?.length) return res ? [] : null;
  return res.documents[0].map((text, i) => ({
    text,
    title: res.metadatas?.[0]?.[i]?.title ?? "kapruka.com",
    url: res.metadatas?.[0]?.[i]?.url ?? "https://www.kapruka.com",
    section: res.metadatas?.[0]?.[i]?.section ?? "help",
    // cosine space: distance = 1 - similarity
    score: Math.round((1 - (res.distances?.[0]?.[i] ?? 1)) * 1000) / 1000,
  }));
}

export async function chromaHealthy(): Promise<boolean> {
  if (!chromaBase()) return false;
  try {
    const res = await fetch(`${chromaBase()}/api/v2/healthcheck`, { signal: AbortSignal.timeout(5000) });
    return res.ok;
  } catch {
    return false;
  }
}

// ── in-process fallback ────────────────────────────────────────────────
async function hydrateFallback(): Promise<void> {
  if (state.hydrated || state.chunks.length) return;
  state.hydrated = true;
  const stored = await loadKbChunks();
  if (stored.length) {
    state.chunks = stored
      .filter((c) => c.vec?.length === DIMS)
      .map((c) => ({ id: c.id, url: c.url, title: c.title, section: c.section, text: c.text, vec: normalize(c.vec) }));
    state.lastIngestAt = Math.max(...stored.map((c) => new Date(c.at).getTime()), 0);
    console.log(`[kb] hydrated ${state.chunks.length} chunks from Mongo`);
  }
}

function memoryQuery(vec: Float32Array, k: number): KbHit[] {
  return state.chunks
    .map((c) => ({ c, score: dot(vec, c.vec) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, k)
    .map(({ c, score }) => ({
      title: c.title,
      url: c.url,
      section: c.section,
      text: c.text,
      score: Math.round(score * 1000) / 1000,
    }));
}

// ── ingestion (crawl → extract → embed → chroma + mongo + memory) ─────
export function ensureKbFresh(force = false): Promise<number> {
  if (state.ingesting) return state.ingesting;
  const stale = Date.now() - state.lastIngestAt > (force ? INGEST_COOLDOWN_MS : REFRESH_MS);
  if (!stale && state.chunks.length) return Promise.resolve(state.chunks.length);
  state.ingesting = ingest()
    .catch((err) => {
      console.error("[kb] ingest failed:", err instanceof Error ? err.message : err);
      return 0;
    })
    .finally(() => {
      state.ingesting = null;
    });
  return state.ingesting;
}

async function ingest(): Promise<number> {
  if (!kbEnabled()) return 0;
  await hydrateFallback();
  if (state.chunks.length && Date.now() - state.lastIngestAt < REFRESH_MS) return state.chunks.length;

  console.log("[kb] crawling kapruka.com info pages…");
  const all: KbChunk[] = [];
  for (const page of KB_PAGES) {
    const html = await fetchKbPage(page.url);
    if (!html) {
      console.error("[kb] fetch failed:", page.url);
      continue;
    }
    const chunks = extractChunks(page, html);
    all.push(...chunks);
    await new Promise((r) => setTimeout(r, 250)); // be polite to kapruka.com
  }
  if (all.length < 10) {
    console.error(`[kb] crawl too thin (${all.length} chunks) — keeping previous index`);
    return state.chunks.length;
  }

  const vecs: VecChunk[] = [];
  for (let i = 0; i < all.length; i += 96) {
    const batch = all.slice(i, i + 96);
    const embedded = await embed(batch.map((c) => c.text));
    if (!embedded) return state.chunks.length; // keep previous index on embed failure
    batch.forEach((c, j) => vecs.push({ ...c, vec: embedded[j] }));
  }

  state.chunks = vecs;
  state.lastIngestAt = Date.now();
  const chromaOk = await chromaUpsert(vecs);
  void saveKbChunks(vecs.map((c) => ({ ...c, vec: [...c.vec] })));
  console.log(`[kb] ingested ${vecs.length} chunks from ${KB_PAGES.length} pages (chroma: ${chromaOk ? "ok" : "unavailable"})`);
  return vecs.length;
}

// ── retrieval ──────────────────────────────────────────────────────────
export async function queryKb(question: string, k = 5): Promise<{ hits: KbHit[]; backend: "chroma" | "memory" | "none" }> {
  if (!kbEnabled()) return { hits: [], backend: "none" };
  const q = question.trim().slice(0, 400);
  if (!q) return { hits: [], backend: "none" };

  // keep the index warm without blocking the answer
  void ensureKbFresh();

  const vecs = await embed([q]);
  if (!vecs) return { hits: [], backend: "none" };
  const vec = vecs[0];

  const fromChroma = await chromaQuery(vec, k);
  if (fromChroma?.length) return { hits: dedupe(fromChroma, k), backend: "chroma" };

  await hydrateFallback();
  if (!state.chunks.length) await ensureKbFresh(); // first boot: wait for the crawl
  const hits = memoryQuery(vec, k);
  return { hits: dedupe(hits, k), backend: hits.length ? "memory" : "none" };
}

/** at most 2 chunks per source url, clipped for the model */
function dedupe(hits: KbHit[], k: number): KbHit[] {
  const perUrl = new Map<string, number>();
  const out: KbHit[] = [];
  for (const h of hits) {
    const n = perUrl.get(h.url) ?? 0;
    if (n >= 2) continue;
    perUrl.set(h.url, n + 1);
    out.push({ ...h, text: h.text.slice(0, 900) });
    if (out.length >= k) break;
  }
  return out;
}

export function kbStatus(): { chunks: number; lastIngestAt: number; chroma: boolean; ingesting: boolean } {
  return {
    chunks: state.chunks.length,
    lastIngestAt: state.lastIngestAt,
    chroma: Boolean(chromaBase()),
    ingesting: Boolean(state.ingesting),
  };
}
