// GET /api/track?order= — direct order tracking for the Track Order UI.
// Same mapping as the agent's track_order tool; no LLM round-trip.

import { kapruka, parseJson } from "@/lib/kapruka/shield";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request): Promise<Response> {
  const order = (new URL(req.url).searchParams.get("order") ?? "").trim().slice(0, 40);
  if (order.length < 4) return Response.json({ error: "order number required" }, { status: 400 });
  try {
    const res = parseJson(await kapruka("kapruka_track_order", { order_number: order }));
    if (!res.order_number && !res.status) {
      return Response.json({ error: typeof res.error === "string" ? res.error : "Order not found — use the number Kapruka emailed after payment." }, { status: 404 });
    }
    const progress = Array.isArray(res.progress)
      ? (res.progress as { step?: unknown; timestamp?: unknown }[]).map((p) => ({
          step: String(p.step ?? ""),
          timestamp: typeof p.timestamp === "string" ? p.timestamp : null,
        }))
      : [];
    return Response.json({
      order_number: String(res.order_number ?? order),
      status: String(res.status ?? "unknown"),
      status_display: typeof res.status_display === "string" ? res.status_display : undefined,
      progress,
      has_delivery_photo: res.has_delivery_photo === true,
      has_delivery_video: res.has_delivery_video === true,
      items: Array.isArray(res.items) ? res.items : [],
    });
  } catch (err) {
    console.error("[track] failed:", err);
    return Response.json({ error: "Tracking is unavailable right now — try again shortly." }, { status: 502 });
  }
}
