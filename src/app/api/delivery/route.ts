// GET /api/delivery?city=&product_id= — instant shipping quote for the
// product hero, based on the user's "Deliver to" city. Backed by
// kapruka_check_delivery through the shield (5-min LRU), so browsing many
// products stays rate-limit-safe: one call per city+product+day.

import { kapruka, parseJson } from "@/lib/kapruka/shield";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const city = (url.searchParams.get("city") ?? "").trim().slice(0, 40);
  const productId = (url.searchParams.get("product_id") ?? "").trim().slice(0, 80);
  const date = (url.searchParams.get("date") ?? "").trim().slice(0, 10);
  if (city.length < 2) return Response.json({ error: "city required" }, { status: 400 });

  try {
    const res = parseJson(
      await kapruka("kapruka_check_delivery", {
        city,
        ...(date ? { delivery_date: date } : {}),
        ...(productId ? { product_id: productId } : {}),
      })
    );
    return Response.json({
      city: String(res.city ?? city),
      available: res.available === true,
      rate: typeof res.rate === "number" ? res.rate : null,
      currency: typeof res.currency === "string" ? res.currency : "LKR",
      date: typeof res.checked_date === "string" ? res.checked_date : null,
      next: typeof res.next_available_date === "string" ? res.next_available_date : null,
      warning: typeof res.perishable_warning === "string" ? res.perishable_warning : null,
    });
  } catch (err) {
    console.error("[delivery] quote failed:", err);
    return Response.json({ error: "quote unavailable" }, { status: 502 });
  }
}
