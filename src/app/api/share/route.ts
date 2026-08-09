// Read-only thread sharing.
//   POST /api/share  { sessionId }          → create a share, returns { id, url }
//   POST /api/share  { id, action:"delete" } → revoke a share (owner only)
//   GET  /api/share?id=<id>                  → the public, sanitized snapshot
//
// The snapshot is sanitized (src/lib/share.ts): no order/PII/payment blocks,
// no cart, no agent. Just the conversation and its shopping content.

import crypto from "crypto";
import { peekSession } from "@/lib/session/store";
import { createShare, getShare, deleteShare } from "@/lib/db/mongo";
import { sanitizeUiForShare } from "@/lib/share";
import { readUser } from "@/lib/auth/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request): Promise<Response> {
  let body: { sessionId?: string; id?: string; action?: string };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const sub = readUser(req)?.sub;

  // revoke
  if (body.action === "delete") {
    const id = String(body.id ?? "").slice(0, 64);
    if (!id) return Response.json({ error: "id required" }, { status: 400 });
    const ok = await deleteShare(id, sub);
    return Response.json(ok ? { ok: true } : { error: "not found or not the owner" }, { status: ok ? 200 : 404 });
  }

  // create
  const sessionId = String(body.sessionId ?? "").slice(0, 64);
  if (!sessionId) return Response.json({ error: "sessionId required" }, { status: 400 });
  const session = await peekSession(sessionId);
  if (!session || !(session.ui?.length)) {
    return Response.json({ error: "Nothing to share yet — start a conversation first." }, { status: 404 });
  }
  const id = crypto.randomBytes(9).toString("base64url"); // ~12 url-safe chars
  await createShare({
    id,
    title: (session.title || "A Kapu conversation").slice(0, 80),
    ui: sanitizeUiForShare(session.ui),
    currency: session.currency || "LKR",
    language: session.language || "en",
    session_id: sessionId,
    ...(sub ? { owner_sub: sub } : {}),
  });
  return Response.json({ id, url: `/share/${id}` });
}

export async function GET(req: Request): Promise<Response> {
  const id = new URL(req.url).searchParams.get("id")?.slice(0, 64);
  if (!id) return Response.json({ error: "id required" }, { status: 400 });
  const s = await getShare(id);
  if (!s) return Response.json({ exists: false }, { status: 404 });
  return Response.json({ exists: true, title: s.title, ui: s.ui, currency: s.currency, language: s.language });
}
