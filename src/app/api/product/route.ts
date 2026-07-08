// GET /api/product?id= — instant full product detail for the click-to-view
// modal (shield-cached; no LLM round-trip).

import { kapruka, parseJson } from "@/lib/kapruka/shield";
import { toDetail } from "@/lib/kapruka/normalize";
import { recoProductEvent } from "@/lib/reco/store";
import { peekSession } from "@/lib/session/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const id = (url.searchParams.get("id") ?? "").trim().slice(0, 80);
  const currency = (url.searchParams.get("currency") ?? "LKR").slice(0, 3);
  if (id.length < 3) return Response.json({ error: "id required" }, { status: 400 });
  try {
    const res = parseJson(await kapruka("kapruka_get_product", { product_id: id, currency }));
    const product = toDetail((res.product ?? res) as Record<string, unknown>, currency);
    // taste signal: opening a product modal is a real interest event
    const sessionId = (url.searchParams.get("sessionId") ?? "").slice(0, 64);
    if (sessionId && product.id) {
      void peekSession(sessionId)
        .then((s) => recoProductEvent([s?.userSub, sessionId], product, 2))
        .catch(() => {});
    }
    if (!product.id) return Response.json({ error: "not found" }, { status: 404 });
    return Response.json({ product });
  } catch (err) {
    console.error("[product] fetch failed:", err);
    return Response.json({ error: "unavailable" }, { status: 502 });
  }
}
