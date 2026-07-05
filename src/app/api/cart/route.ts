// Instant basket operations — qty steppers, remove, icing edits — mutate the
// same server-side session cart the agent uses, with no LLM round-trip.
// The agent stays in sync because every chat turn's context carries the
// live cart summary.

import { applyCartUpdate, cartSubtotal } from "@/lib/kapruka/cart";
import { getSession, saveSession } from "@/lib/session/store";
import type { CartRequest } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request): Promise<Response> {
  const sessionId = new URL(req.url).searchParams.get("sessionId")?.slice(0, 64);
  if (!sessionId) return Response.json({ error: "sessionId required" }, { status: 400 });
  const session = await getSession(sessionId);
  return Response.json({ cart: session.cart, subtotal: cartSubtotal(session) });
}

export async function POST(req: Request): Promise<Response> {
  let body: CartRequest;
  try {
    body = (await req.json()) as CartRequest;
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const sessionId = (body.sessionId ?? "").slice(0, 64);
  if (!sessionId || !body.product_id) {
    return Response.json({ error: "sessionId and product_id are required" }, { status: 400 });
  }

  const session = await getSession(sessionId);
  const existing = session.cart.items.find(
    (i) => i.product_id.toLowerCase() === String(body.product_id).toLowerCase()
  );

  let quantity: number;
  switch (body.action) {
    case "add":
      quantity = (existing?.quantity ?? 0) + Math.max(1, Math.round(Number(body.quantity) || 1));
      break;
    case "set_qty":
      quantity = Math.max(0, Math.round(Number(body.quantity) || 0));
      break;
    case "remove":
      quantity = 0;
      break;
    case "set_icing":
      quantity = existing?.quantity ?? 0;
      if (!existing) return Response.json({ error: "Item not in basket" }, { status: 404 });
      break;
    default:
      return Response.json({ error: "Unknown action" }, { status: 400 });
  }

  try {
    const result = await applyCartUpdate(session, {
      product_id: body.product_id,
      quantity,
      ...(body.action === "set_icing" || (body.action === "add" && body.icing_text)
        ? { icing_text: body.icing_text ?? "" }
        : {}),
      ...(body.known ? { known: body.known } : {}),
    });
    if (result.error) return Response.json({ error: result.error }, { status: 422 });
    saveSession(session);
    return Response.json({ cart: session.cart, subtotal: cartSubtotal(session) });
  } catch (err) {
    console.error("[cart] update failed:", err);
    return Response.json({ error: "Basket update failed — please try again." }, { status: 502 });
  }
}
