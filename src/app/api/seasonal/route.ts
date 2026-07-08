// GET /api/seasonal — real Kapruka products for the coming festival, for the
// empty-state seasonal rail. One shield-cached search per festival; a module
// cache keeps repeat visits free.

import { kapruka, parseJson } from "@/lib/kapruka/shield";
import { toSummary } from "@/lib/kapruka/normalize";
import { nextFestival } from "@/lib/festivals";
import type { ProductSummary } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

let cache: { key: string; at: number; products: ProductSummary[] } | null = null;

export async function GET(): Promise<Response> {
  const fest = nextFestival();
  if (!fest || fest.days > 60) return Response.json({ festival: null, products: [] });
  try {
    if (!cache || cache.key !== fest.name || Date.now() - cache.at > 10 * 60_000) {
      const res = parseJson(await kapruka("kapruka_search_products", { q: fest.q, limit: 8, in_stock_only: true }));
      const products = (Array.isArray(res.results) ? res.results : [])
        .map((r) => toSummary(r as Record<string, unknown>, "LKR"))
        .filter((p) => p.id && p.in_stock !== false)
        .slice(0, 6)
        .map((p, i) => ({ ...p, pick: i === 0 }));
      // a transient MCP hiccup must NOT blank the rail — keep the stale
      // batch until a refresh actually succeeds
      if (products.length > 0 || !cache || cache.key !== fest.name) {
        cache = { key: fest.name, at: Date.now(), products };
      } else {
        cache = { ...cache, at: Date.now() - 8 * 60_000 }; // retry soon
      }
    }
    return Response.json({
      festival: { name: fest.name, label: fest.label, days: fest.days, approx: fest.approx === true, glyphs: fest.glyphs, greet: fest.greet, msg: fest.msg },
      products: cache.products,
    });
  } catch (err) {
    console.error("[seasonal] failed:", err);
    return Response.json({
      festival: { name: fest.name, label: fest.label, days: fest.days, approx: fest.approx === true, glyphs: fest.glyphs, greet: fest.greet, msg: fest.msg },
      // stale beats empty
      products: cache?.key === fest.name ? cache.products : [],
    });
  }
}
