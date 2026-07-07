// Live promotions from kapruka.com/online/promotions — shared by /api/deals
// (hero Hot-deals section) and the get_hot_deals agent tool. Server-rendered
// catalogueV2 tiles with true strikethrough prices; 15-min in-process cache.
// Geo note: the tiles only render for Sri-Lankan IPs — foreign egress
// (Railway US) gets the international page and this returns [].

import { recoSeen } from "@/lib/reco/store";
import type { ProductSummary } from "@/lib/types";

const g = globalThis as unknown as { __kapuDeals?: { at: number; products: ProductSummary[] } };
const TTL = 15 * 60_000;

function parseTiles(html: string): ProductSummary[] {
  const out: ProductSummary[] = [];
  const seen = new Set<string>();
  for (const raw of html.split("catalogueV2Repeater").slice(1, 60)) {
    // every tile carries an "<!-- Out of Stock or Other Status -->" comment —
    // strip comments before testing for the real sold-out marker
    const chunk = raw.replace(/<!--[\s\S]*?-->/g, "");
    if (/out of stock/i.test(chunk)) continue;
    const link = chunk.match(/href="(https:\/\/www\.kapruka\.com\/buyonline\/[^"]+\/kid\/([^"]+))"/i);
    const name = chunk.match(/catalogueV2heading">\s*([^<]+)/i);
    const price = chunk.match(/catalogueV2converted">\s*RS\.?\s*([\d,]+)/i);
    const compare = chunk.match(/mktprice'>\s*<del>\s*Rs&nbsp;([\d,]+)/i);
    const img = chunk.match(/src="(https:\/\/static2\.kapruka\.com[^"]+)"/i);
    if (!link || !name || !price || seen.has(link[2])) continue;
    seen.add(link[2]);
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
    if (out.length >= 40) break;
  }
  return out;
}

export async function getHotDeals(): Promise<ProductSummary[]> {
  if (g.__kapuDeals && Date.now() - g.__kapuDeals.at < TTL) return g.__kapuDeals.products;
  try {
    const res = await fetch("https://www.kapruka.com/online/promotions", {
      headers: { "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) KapuAgent/1.0" },
      signal: AbortSignal.timeout(6000),
    });
    if (!res.ok) return [];
    const products = parseTiles(await res.text());
    g.__kapuDeals = { at: Date.now(), products };
    void recoSeen(products).catch(() => {});
    return products;
  } catch {
    return [];
  }
}
