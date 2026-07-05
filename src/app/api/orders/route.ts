// GET /api/orders?sessionId= — this device/account's recent Kapu orders
// (pre-payment refs) for the Track Order UI and the notification center.

import { readUser } from "@/lib/auth/session";
import { listOrders } from "@/lib/db/mongo";
import type { CartItem } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request): Promise<Response> {
  const sessionId = (new URL(req.url).searchParams.get("sessionId") ?? "").slice(0, 64);
  if (!sessionId) return Response.json({ orders: [] });
  const sub = readUser(req)?.sub;
  const orders = await listOrders(sessionId, sub, 5);
  return Response.json({
    orders: orders.map((o) => ({
      order_ref: o.order_ref,
      pay_url: o.pay_url,
      when: o.created_at ?? null,
      recipient: (o.recipient as { name?: string })?.name ?? null,
      city: (o.delivery as { city?: string })?.city ?? null,
      date: (o.delivery as { date?: string })?.date ?? null,
      items: Array.isArray((o.cart as { items?: CartItem[] })?.items)
        ? (o.cart as { items: CartItem[] }).items.map((i) => i.name).slice(0, 4)
        : [],
    })),
  });
}
