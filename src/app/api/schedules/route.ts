// GET  /api/schedules            — the signed-in user's standing wishes
// POST /api/schedules {id,action}— toggle | delete
// Auth-gated: schedules belong to a Google account, never a guest session.

import { readUser } from "@/lib/auth/session";
import { getUser } from "@/lib/auth/users";
import { cancelSchedule, listSchedules, toggleSchedule } from "@/lib/schedules/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request): Promise<Response> {
  const auth = readUser(req);
  if (!auth) return Response.json({ error: "sign-in required" }, { status: 401 });
  const user = await getUser(auth.sub);
  const schedules = await listSchedules(auth.sub);
  return Response.json({
    telegram_linked: Boolean(user?.tgChatId),
    schedules: schedules.map((s) => ({
      id: s.id,
      title: s.title,
      kind: s.kind,
      cadence: s.cadence,
      allow_order: s.allowOrder,
      active: s.active,
      next_run: s.nextRun,
      last_result: s.lastResult ?? null,
    })),
  });
}

export async function POST(req: Request): Promise<Response> {
  const auth = readUser(req);
  if (!auth) return Response.json({ error: "sign-in required" }, { status: 401 });
  const body = (await req.json().catch(() => ({}))) as { id?: string; action?: string };
  if (!body.id || !body.action) return Response.json({ error: "id and action required" }, { status: 400 });
  if (body.action === "delete") {
    const ok = await cancelSchedule(auth.sub, body.id);
    return Response.json(ok ? { ok: true } : { error: "not found" }, { status: ok ? 200 : 404 });
  }
  if (body.action === "toggle") {
    const s = await toggleSchedule(auth.sub, body.id);
    return Response.json(s ? { ok: true, active: s.active } : { error: "not found" }, { status: s ? 200 : 404 });
  }
  return Response.json({ error: "unknown action" }, { status: 400 });
}
