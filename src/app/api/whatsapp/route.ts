// POST /api/whatsapp — inbound webhook from the kapu-wa Go sidecar.
//
// The sidecar owns the WhatsApp socket and forwards each message here with a
// shared secret. We ack immediately and run the turn in the background: a Kapu
// turn can take 30s+ with tools, and a webhook that holds the connection open
// that long just invites retries and duplicate replies.

import { processInbound, type WaInbound } from "@/lib/whatsapp/handler";
import { whatsappEnabled } from "@/lib/whatsapp/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function POST(req: Request): Promise<Response> {
  const secret = process.env.WA_SHARED_SECRET ?? "";
  if (secret && req.headers.get("x-kapu-secret") !== secret) {
    return new Response("forbidden", { status: 403 });
  }
  if (!whatsappEnabled()) {
    return Response.json({ ok: false, error: "WhatsApp channel not configured" }, { status: 503 });
  }

  let body: WaInbound;
  try {
    body = (await req.json()) as WaInbound;
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  if (!body?.from) return Response.json({ error: "from is required" }, { status: 400 });

  // Ack now, work after — the sidecar is not waiting for the reply, it will
  // arrive over its own /send endpoint.
  void processInbound(body).catch((err) =>
    console.error("[whatsapp] inbound failed:", err instanceof Error ? err.message : err)
  );
  return Response.json({ ok: true });
}

export function GET(): Response {
  return Response.json({ ok: true, channel: "whatsapp", configured: whatsappEnabled() });
}
