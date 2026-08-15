// GET /api/seasonal — real Kapruka products for the coming festival, for the
// empty-state seasonal rail. One shield-cached search per festival; a module
// cache keeps repeat visits free.

import { loadRailCache, saveRailCache } from "@/lib/db/mongo";
import { kapruka, parseJson } from "@/lib/kapruka/shield";
import { toSummary } from "@/lib/kapruka/normalize";
import { festivalByKey, nextFestival } from "@/lib/festivals";
import type { ProductSummary } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

let cache: { key: string; at: number; products: ProductSummary[] } | null = null;

export async function GET(): Promise<Response> {
  // Off-season, the hero backdrop falls back to Christmas (SL's biggest
  // gifting season, stocked year-round — hampers book out months early).
  // The rail must agree with the decor: a tree with zero products under it
  // reads as a bug, not a mood.
  const fest = (() => {
    const near = nextFestival();
    if (near && near.days <= 60) return near;
    const xmas = festivalByKey("christmas");
    if (!xmas) return null;
    const todaySL = new Date(new Date().toLocaleString("en-US", { timeZone: "Asia/Colombo" }));
    todaySL.setHours(0, 0, 0, 0);
    const days = Math.round((new Date(`${xmas.date}T00:00:00+05:30`).getTime() - todaySL.getTime()) / 86400000);
    return days >= 0 ? { ...xmas, days } : null;
  })();
  if (!fest) return Response.json({ festival: null, products: [] });
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
      if (products.length > 0) {
        cache = { key: fest.name, at: Date.now(), products };
        void saveRailCache(`seasonal:${fest.name}`, products);
      } else if (cache?.key === fest.name && cache.products.length > 0) {
        cache = { ...cache, at: Date.now() - 8 * 60_000 }; // keep stale, retry soon
      } else {
        // fresh process + failed fetch — durable fallback from Mongo
        const fb = await loadRailCache<ProductSummary[]>(`seasonal:${fest.name}`);
        cache = { key: fest.name, at: Date.now() - 8 * 60_000, products: fb ?? [] };
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
      // stale beats empty; Mongo beats a cold process
      products: cache?.key === fest.name && cache.products.length > 0 ? cache.products : ((await loadRailCache<ProductSummary[]>(`seasonal:${fest.name}`).catch(() => null)) ?? []),
    });
  }
}
