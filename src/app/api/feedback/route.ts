// POST /api/feedback — records a 👍/👎 on an assistant reply. Persists to
// Mongo (KapuFeedback) with an in-memory mirror, so which replies land well is
// real, queryable data — not a decorative button.

import { recordFeedback } from "@/lib/db/mongo";
import { readUser } from "@/lib/auth/session";

export const runtime = "nodejs";

export async function POST(req: Request): Promise<Response> {
  let body: { sessionId?: string; rating?: string; message?: string; userMessage?: string; language?: string };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const rating = body.rating === "up" ? "up" : body.rating === "down" ? "down" : null;
  const sessionId = (body.sessionId ?? "").slice(0, 64);
  if (!rating || !sessionId) {
    return Response.json({ error: "sessionId and a valid rating are required" }, { status: 400 });
  }

  const sub = readUser(req)?.sub;
  await recordFeedback({
    session_id: sessionId,
    ...(sub ? { user_sub: sub } : {}),
    rating,
    message: (body.message ?? "").slice(0, 4000),
    ...(body.userMessage ? { user_message: body.userMessage.slice(0, 2000) } : {}),
    ...(body.language ? { language: body.language.slice(0, 4) } : {}),
  });

  return Response.json({ ok: true });
}
