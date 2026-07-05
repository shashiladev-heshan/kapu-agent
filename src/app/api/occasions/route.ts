// GET /api/occasions?sessionId= — upcoming saved occasions for the
// notification center (account memory when signed in, device otherwise).

import { readUser } from "@/lib/auth/session";
import { upcomingOccasions } from "@/lib/agent/memory";
import { peekSession } from "@/lib/session/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request): Promise<Response> {
  const sessionId = (new URL(req.url).searchParams.get("sessionId") ?? "").slice(0, 64);
  if (!sessionId) return Response.json({ upcoming: [] });
  const session = await peekSession(sessionId);
  if (!session) return Response.json({ upcoming: [] });
  session.userSub = readUser(req)?.sub;
  const upcoming = await upcomingOccasions(session, 60).catch(() => []);
  return Response.json({ upcoming });
}
