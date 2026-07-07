// GET /api/deals — the full kapruka.com promotions list for the hero's
// standalone Hot-deals section (client chunk-reveals on scroll). Thin wrapper
// over the shared promos lib (also powering the get_hot_deals agent tool).

import { getHotDeals } from "@/lib/kapruka/promos";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request): Promise<Response> {
  if (new URL(req.url).searchParams.get("debug") === "1") {
    // temporary diagnostic: what does kapruka.com serve THIS egress?
    try {
      const res = await fetch("https://www.kapruka.com/online/promotions", {
        headers: { "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) KapuAgent/1.0" },
        redirect: "manual",
        signal: AbortSignal.timeout(8000),
      });
      const html = res.status >= 200 && res.status < 300 ? await res.text() : "";
      return Response.json({
        status: res.status,
        location: res.headers.get("location"),
        server: res.headers.get("server"),
        cfRay: res.headers.get("cf-ray"),
        htmlLength: html.length,
        repeaters: html.split("catalogueV2Repeater").length - 1,
        hasHeading: html.includes("catalogueV2heading"),
        title: html.match(/<title>([^<]*)</)?.[1] ?? null,
        priceSample: html.match(/CatalogueV2price[\s\S]{0,200}/)?.[0]?.replace(/\s+/g, " ").slice(0, 200) ?? null,
        mktSample: html.match(/mktprice[\s\S]{0,120}/)?.[0]?.replace(/\s+/g, " ").slice(0, 140) ?? null,
      });
    } catch (err) {
      return Response.json({ error: err instanceof Error ? err.message : String(err) });
    }
  }
  return Response.json({ products: await getHotDeals() });
}
