// GET /api/discover — the hero's "Discover Kapruka" tabs: Trending (Kapruka's
// bestseller ranking), Under Rs 2,500 (price_asc — the ONLY sort the upstream
// truly honors; bestseller/newest ≡ relevance, verified 7 Jul), and Deals
// (compare_at_price discounts filtered from the pools). Site-parity with
// kapruka.com's Best Sellers / On Sale rails. 4 shield-cached searches per
// 15 min (seed queries rotate daily so the rails breathe).

import { kapruka, parseJson } from "@/lib/kapruka/shield";
import { toSummary } from "@/lib/kapruka/normalize";
import { recoSeen } from "@/lib/reco/store";
import type { ProductSummary } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SEEDS = ["gift", "cake", "chocolate", "hamper", "flowers", "toys"];

let cache: { at: number; body: { trending: ProductSummary[]; budget: ProductSummary[]; deals: ProductSummary[] } } | null = null;

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

/** Real promotions from kapruka.com/online/promotions — server-rendered
 *  catalogueV2 tiles with strikethrough market prices (actual discounts the
 *  MCP search never surfaces). Best-effort: empty array on any failure. */
async function promoDeals(): Promise<ProductSummary[]> {
  try {
    const res = await fetch("https://www.kapruka.com/online/promotions", {
      headers: { "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) KapuAgent/1.0" },
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return [];
    const html = await res.text();
    const out: ProductSummary[] = [];
    for (const raw of html.split("catalogueV2Repeater").slice(1, 40)) {
      // every tile carries an "<!-- Out of Stock or Other Status -->" comment —
      // strip comments before testing for the real sold-out marker
      const chunk = raw.replace(/<!--[\s\S]*?-->/g, "");
      if (/out of stock/i.test(chunk)) continue;
      const link = chunk.match(/href="(https:\/\/www\.kapruka\.com\/buyonline\/[^"]+\/kid\/([^"]+))"/i);
      const name = chunk.match(/catalogueV2heading">\s*([^<]+)/i);
      const price = chunk.match(/catalogueV2converted">\s*RS\.?\s*([\d,]+)/i);
      const compare = chunk.match(/mktprice'>\s*<del>\s*Rs&nbsp;([\d,]+)/i);
      const img = chunk.match(/src="(https:\/\/static2\.kapruka\.com[^"]+)"/i);
      if (!link || !name || !price) continue;
      out.push({
        id: link[2],
        name: name[1].replace(/\s+/g, " ").trim(),
        price: Number(price[1].replace(/,/g, "")),
        compare_at_price: compare ? Number(compare[1].replace(/,/g, "")) : null,
        currency: "LKR",
        image: img ? img[1] : null,
        in_stock: true,
        url: link[1],
      });
      if (out.length >= 12) break;
    }
    return out;
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
  const [b1, b2, u1, u2, promos] = await Promise.all([
    pool(s1, "bestseller"),
    pool(s2, "bestseller"),
    pool(s1, "price_asc", { min: 400, max: 2500 }),
    pool(s2, "price_asc", { min: 400, max: 2500 }),
    promoDeals(),
  ]);
  const trending = dedupe([b1, b2], 8);
  const budget = dedupe([u1, u2], 8);
  // deals = the live promotions page first, topped up with any discounted
  // items from the search pools
  const discounted = [...b1, ...b2, ...u1, ...u2].filter(
    (p) => p.price != null && p.compare_at_price != null && p.compare_at_price > p.price
  );
  const deals = dedupe([promos, discounted.sort((a, b) => (b.compare_at_price! - b.price!) / b.compare_at_price! - (a.compare_at_price! - a.price!) / a.compare_at_price!)], 8);
  const body = { trending, budget, deals };
  if (trending.length + budget.length > 0) cache = { at: Date.now(), body };
  void recoSeen([...trending, ...budget, ...deals]).catch(() => {});
  return Response.json(body);
}
