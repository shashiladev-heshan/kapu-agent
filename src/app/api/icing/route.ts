// POST /api/icing — "Write it for me": AI icing / gift-card message
// suggestions for the gift the user is looking at. Personalized from session
// memory (saved people + occasions) and the festival calendar when available.

import { readUser } from "@/lib/auth/session";
import { listPeople, upcomingOccasions } from "@/lib/agent/memory";
import { nextFestival } from "@/lib/festivals";
import { writeGiftMessages, type GiftMessageKind } from "@/lib/gift/writer";
import { peekSession } from "@/lib/session/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

interface IcingRequest {
  sessionId?: string;
  name?: string;
  category?: string;
  kind?: string;
  lang?: string;
}

export async function POST(req: Request): Promise<Response> {
  let body: IcingRequest;
  try {
    body = (await req.json()) as IcingRequest;
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const name = typeof body.name === "string" ? body.name.trim().slice(0, 120) : "";
  if (name.length < 2) {
    return Response.json({ error: "name is required" }, { status: 400 });
  }
  const kind: GiftMessageKind = body.kind === "card" ? "card" : "icing";
  const lang = body.lang === "si" || body.lang === "ta" ? body.lang : "en";

  // Best-effort personalization — never block the suggestion on memory.
  let recipients: { name: string; relationship?: string }[] = [];
  let occasions: { recipient: string; type: string; in_days: number }[] = [];
  try {
    const sessionId = (body.sessionId ?? "").slice(0, 64);
    const session = sessionId ? await peekSession(sessionId) : null;
    if (session) {
      session.userSub = readUser(req)?.sub;
      const people = await listPeople(session);
      recipients = people.recipients.slice(0, 6).map((r) => ({ name: r.name, relationship: r.relationship }));
      occasions = (await upcomingOccasions(session, 45)).map((o) => ({
        recipient: o.recipient,
        type: o.type,
        in_days: o.in_days,
      }));
    }
  } catch {
    // memory is a bonus, not a dependency
  }
  const fest = nextFestival();
  const festival = fest && fest.days <= 30 ? { name: fest.name, days: fest.days } : null;

  try {
    const suggestions = await writeGiftMessages({
      name,
      category: typeof body.category === "string" ? body.category : undefined,
      lang,
      kind,
      recipients,
      occasions,
      festival,
    });
    if (suggestions === null) {
      return Response.json({ error: "No AI provider configured" }, { status: 501 });
    }
    if (!suggestions.length) {
      return Response.json({ error: "Aiyo — my pen slipped. Try once more?" }, { status: 502 });
    }
    return Response.json({ suggestions });
  } catch (err) {
    console.error("[icing] generation failed:", err instanceof Error ? err.message.slice(0, 200) : err);
    return Response.json({ error: "Aiyo — my pen slipped. Try once more?" }, { status: 502 });
  }
}
