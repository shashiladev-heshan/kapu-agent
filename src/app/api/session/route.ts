// GET /api/session?id= — rehydrate a conversation (visible transcript +
// basket) after a refresh or when reopening a recent wish. Reads memory
// first, then MongoDB when configured; never creates an empty session.

import { peekSession } from "@/lib/session/store";
import type { SessionSnapshot } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request): Promise<Response> {
  const id = new URL(req.url).searchParams.get("id")?.slice(0, 64);
  if (!id) return Response.json({ error: "id required" }, { status: 400 });

  const session = await peekSession(id);
  if (!session) {
    const empty: SessionSnapshot = {
      exists: false,
      ui: [],
      cart: { items: [], currency: "LKR" },
      language: "en",
      currency: "LKR",
    };
    return Response.json(empty);
  }
  const snapshot: SessionSnapshot = {
    exists: true,
    title: session.title,
    ui: session.ui ?? [],
    cart: session.cart,
    language: session.language,
    currency: session.currency,
  };
  return Response.json(snapshot);
}
