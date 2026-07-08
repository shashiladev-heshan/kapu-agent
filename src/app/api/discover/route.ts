// GET /api/discover — the hero's "Discover Kapruka" tabs: Trending (Kapruka's
// bestseller ranking), Under Rs 2,500 (price_asc — the ONLY sort the upstream
// truly honors; bestseller/newest ≡ relevance, verified 7 Jul), and Deals
// (compare_at_price discounts filtered from the pools). Site-parity with
// kapruka.com's Best Sellers / On Sale rails. 4 shield-cached searches per
// 15 min (seed queries rotate daily so the rails breathe).

import { loadRailCache, saveRailCache } from "@/lib/db/mongo";
import { kapruka, parseJson } from "@/lib/kapruka/shield";
import { toSummary } from "@/lib/kapruka/normalize";
import { recoSeen } from "@/lib/reco/store";
import type { ProductSummary } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SEEDS = ["gift", "cake", "chocolate", "hamper", "flowers", "toys"];

let cache: { at: number; body: { trending: ProductSummary[]; budget: ProductSummary[] } } | null = null;

async function pool(q: string, sort: string, priceBand?: { min: number; max: number }): Promise<ProductSummary[]> {
  try {
    const res = parseJson(
      await kapruka("kapruka_search_products", {
        q,
        sort,
        limit: 10,
        in_stock_only: true,
        ...(priceBand ? { min_price: priceBand.min, max_price: priceBand.max } : {}),
      })
    );
    return (Array.isArray(res.results) ? (res.results as Record<string, unknown>[]) : []).map((r) => toSummary(r, "LKR"));
  } catch {
    return [];
  }
}

function dedupe(lists: ProductSummary[][], cap: number): ProductSummary[] {
  const seen = new Set<string>();
  const out: ProductSummary[] = [];
  // interleave so one seed query doesn't dominate the rail
  for (let i = 0; out.length < cap; i++) {
    let any = false;
    for (const list of lists) {
      const p = list[i];
      if (!p) continue;
      any = true;
      const key = p.id.toLowerCase();
      if (p.id && p.name && !seen.has(key)) {
        seen.add(key);
        out.push(p);
        if (out.length >= cap) break;
      }
    }
    if (!any) break;
  }
  return out.map((p, i) => ({ ...p, pick: i === 0 }));
}

export async function GET(): Promise<Response> {
  if (cache && Date.now() - cache.at < 15 * 60_000) return Response.json(cache.body);
  // rotate seeds by day-of-year so the rails change without config
  const day = Math.floor(Date.now() / 86400000);
  const [s1, s2] = [SEEDS[day % SEEDS.length], SEEDS[(day + 3) % SEEDS.length]];
  const [b1, b2, u1, u2] = await Promise.all([
    pool(s1, "bestseller"),
    pool(s2, "bestseller"),
    pool(s1, "price_asc", { min: 400, max: 2500 }),
    pool(s2, "price_asc", { min: 400, max: 2500 }),
  ]);
  const trending = dedupe([b1, b2], 8);
  const budget = dedupe([u1, u2], 8);
  const body = { trending, budget };
  if (trending.length + budget.length > 0) {
    cache = { at: Date.now(), body };
    void saveRailCache("discover", body);
  } else if (cache) {
    // transient MCP failure — stale rails beat empty rails
    return Response.json(cache.body);
  } else {
    // cold process + MCP down — durable fallback from Mongo
    const fb = await loadRailCache<{ trending: ProductSummary[]; budget: ProductSummary[] }>("discover");
    if (fb) {
      cache = { at: Date.now() - 12 * 60_000, body: fb }; // serve now, retry live soon
      return Response.json(fb);
    }
  }
  void recoSeen([...trending, ...budget]).catch(() => {});
  return Response.json(body);
}
