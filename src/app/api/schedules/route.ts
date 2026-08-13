// GET  /api/schedules                          — the signed-in user's standing wishes + linked channels
// POST /api/schedules {id,action}              — toggle | delete
// POST /api/schedules {action:"watch_order",order_number}
//                                              — deterministic order-watch creation (no agent turn):
//                                                the Track modal's "alert me on Telegram/WhatsApp"
// POST /api/schedules {action:"run_now",id,force?}
//                                              — pull a schedule to the next tick; force re-alerts the
//                                                current status (the test trigger)
// Auth-gated: schedules belong to a Google account, never a guest session.

import { readUser } from "@/lib/auth/session";
import { getUser } from "@/lib/auth/users";
import { cancelSchedule, createSchedule, listSchedules, runScheduleNow, toggleSchedule } from "@/lib/schedules/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request): Promise<Response> {
  const auth = readUser(req);
  if (!auth) return Response.json({ error: "sign-in required" }, { status: 401 });
  const user = await getUser(auth.sub);
  const schedules = await listSchedules(auth.sub);
  return Response.json({
    telegram_linked: Boolean(user?.tgChatId),
    whatsapp_linked: Boolean(user?.waPhone),
    schedules: schedules.map((s) => ({
      id: s.id,
      title: s.title,
      kind: s.kind,
      order_number: s.orderNumber ?? null,
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
  const body = (await req.json().catch(() => ({}))) as {
    id?: string;
    action?: string;
    order_number?: string;
    force?: boolean;
  };

  // Track modal → watch this order. Idempotent: an active watch on the same
  // order is returned rather than duplicated (the 10-schedule cap is precious).
  if (body.action === "watch_order") {
    const order = String(body.order_number ?? "").trim().toUpperCase();
    if (!/^[A-Z0-9-]{4,32}$/.test(order)) return Response.json({ error: "invalid order number" }, { status: 400 });
    const mine = await listSchedules(auth.sub);
    const existing = mine.find((s) => s.kind === "watch_order" && (s.orderNumber ?? "").toUpperCase() === order && s.active);
    if (existing) return Response.json({ ok: true, id: existing.id, existing: true });
    try {
      const s = await createSchedule({
        sub: auth.sub,
        title: `Order watch — ${order}`,
        instruction: `Watch order ${order} until delivered and notify me on status changes.`,
        kind: "watch_order",
        orderNumber: order,
        cadence: { kind: "daily", at: "09:00" }, // watchers ignore cadence; polled every 3h
        allowOrder: false,
      });
      return Response.json({ ok: true, id: s.id, first_check_ms: s.nextRun - Date.now() });
    } catch (err) {
      return Response.json({ error: err instanceof Error ? err.message : "could not create watch" }, { status: 400 });
    }
  }

  if (!body.id || !body.action) return Response.json({ error: "id and action required" }, { status: 400 });

  if (body.action === "run_now") {
    const s = await runScheduleNow(auth.sub, body.id, body.force === true);
    return Response.json(s ? { ok: true, next_run: s.nextRun } : { error: "not found" }, { status: s ? 200 : 404 });
  }
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
