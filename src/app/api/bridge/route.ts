// Wish Bridge — reverse gifting over the existing cart machinery.
//
//   POST { sessionId, title?, message?, recipient? }   → freeze MY basket into
//                                                        a grantable link
//   GET  ?id=…                                         → public payload (the
//                                                        recipient's full
//                                                        address is NEVER here)
//   POST { id, action: "claim", sessionId }            → copy the items into
//                                                        the GIFTER's basket +
//                                                        stash the consented
//                                                        recipient on their
//                                                        session, server-side
//
// Security model mirrors /api/share: unguessable 72-bit ids, owner details
// only ever flow server-side (session → turn context → checkout), and the
// public GET exposes name + city at most.

import crypto from "crypto";
import { readUser } from "@/lib/auth/session";
import { createBridge, getBridge, type BridgeRecipient } from "@/lib/db/mongo";
import { ensureCartLkr } from "@/lib/kapruka/cart";
import { getSession, peekSession, saveSession } from "@/lib/session/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface CreateBody {
  sessionId?: string;
  title?: string;
  message?: string;
  recipient?: { name?: string; phone?: string; address?: string; city?: string };
  id?: string;
  action?: string;
}

function cleanRecipient(r: CreateBody["recipient"]): BridgeRecipient | undefined {
  const name = String(r?.name ?? "").trim().slice(0, 60);
  const phone = String(r?.phone ?? "").trim().slice(0, 24);
  const address = String(r?.address ?? "").trim().slice(0, 250);
  const city = String(r?.city ?? "").trim().slice(0, 60);
  // all-or-nothing: partial delivery details help nobody at checkout
  if (!name || !phone || !address || !city) return undefined;
  return { name, phone, address, city };
}

export async function POST(req: Request): Promise<Response> {
  let body: CreateBody;
  try {
    body = (await req.json()) as CreateBody;
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  // ── claim: the gifter takes the wish into their own basket ──────────
  if (body.action === "claim") {
    const id = String(body.id ?? "").slice(0, 24);
    const sessionId = String(body.sessionId ?? "").slice(0, 64);
    if (!id || !sessionId) return Response.json({ error: "id and sessionId required" }, { status: 400 });
    const bridge = await getBridge(id);
    if (!bridge) return Response.json({ error: "This wish link isn't available." }, { status: 404 });
    if (bridge.granted_at) return Response.json({ error: "already_granted" }, { status: 409 });

    const session = await getSession(sessionId);
    session.cart.items = bridge.items.map((i) => ({ ...i }));
    session.cart.currency = "LKR";
    await ensureCartLkr(session);
    session.bridge = {
      id,
      title: bridge.title,
      ...(bridge.recipient ? { recipient: { ...bridge.recipient } } : {}),
    };
    if (!session.title) session.title = `🎁 ${bridge.title}`.slice(0, 60);
    saveSession(session);
    // deliberately NO recipient in the response — it lives server-side only
    return Response.json({ ok: true, items: session.cart.items.length, title: bridge.title });
  }

  // ── create: freeze my basket into a grantable link ──────────────────
  const sessionId = String(body.sessionId ?? "").slice(0, 64);
  if (!sessionId) return Response.json({ error: "sessionId required" }, { status: 400 });
  const session = await peekSession(sessionId);
  if (!session || session.cart.items.length === 0) {
    return Response.json({ error: "Your basket is empty — add the things you wish for first." }, { status: 400 });
  }
  const id = crypto.randomBytes(9).toString("base64url");
  await createBridge({
    id,
    title: String(body.title ?? "").trim().slice(0, 80) || session.title?.slice(0, 80) || "A Kapu wish",
    ...(body.message ? { message: String(body.message).trim().slice(0, 280) } : {}),
    items: session.cart.items.map((i) => ({
      product_id: i.product_id,
      name: i.name,
      price: i.price,
      currency: i.currency,
      image: i.image ?? null,
      quantity: i.quantity,
      ...(i.icing_text ? { icing_text: i.icing_text } : {}),
    })),
    currency: "LKR",
    language: session.language || "en",
    session_id: sessionId,
    ...(readUser(req)?.sub ? { owner_sub: readUser(req)!.sub } : {}),
    ...(cleanRecipient(body.recipient) ? { recipient: cleanRecipient(body.recipient) } : {}),
  });
  return Response.json({ id, url: `/bridge/${id}` });
}

export async function GET(req: Request): Promise<Response> {
  const id = new URL(req.url).searchParams.get("id") ?? "";
  const bridge = await getBridge(id.slice(0, 24));
  if (!bridge) return Response.json({ exists: false }, { status: 404 });
  const total = bridge.items.reduce((s, i) => s + (i.price ?? 0) * i.quantity, 0);
  return Response.json({
    exists: true,
    title: bridge.title,
    message: bridge.message ?? null,
    items: bridge.items.map((i) => ({
      name: i.name,
      price: i.price,
      currency: i.currency,
      image: i.image ?? null,
      quantity: i.quantity,
      icing_text: i.icing_text ?? null,
    })),
    total,
    currency: bridge.currency,
    language: bridge.language,
    // name + city at most — the full address never leaves the server
    recipient_public: bridge.recipient ? { name: bridge.recipient.name, city: bridge.recipient.city } : null,
    granted: Boolean(bridge.granted_at),
  });
}
