// GET /api/kb?q=… — QA/debug surface for the Kapruka knowledge base
// (the kapruka_help tool uses queryKb directly; this route exists so the
// index and retrieval can be inspected without an LLM turn).
// GET /api/kb?ingest=1 forces a re-crawl (cooldown-guarded, cheap).

import { ensureKbFresh, kbStatus, queryKb, chromaHealthy } from "@/lib/kb/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const q = url.searchParams.get("q")?.slice(0, 300);
  if (url.searchParams.get("ingest")) {
    const chunks = await ensureKbFresh(true);
    return Response.json({ ingested: chunks, ...kbStatus() });
  }
  if (!q) {
    return Response.json({ ...kbStatus(), chromaUp: await chromaHealthy() });
  }
  const t0 = Date.now();
  const { hits, backend } = await queryKb(q, 5);
  return Response.json({ q, backend, ms: Date.now() - t0, hits });
}
