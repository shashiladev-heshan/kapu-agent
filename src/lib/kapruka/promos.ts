// Live promotions from kapruka.com/online/promotions — shared by /api/deals
// (hero Hot-deals section) and the get_hot_deals agent tool. Server-rendered
// catalogueV2 tiles with true strikethrough prices; 15-min in-process cache.
// Geo note: foreign egress (Railway US) gets the page with USD prices and
// no strikethroughs — for that variant we recover real LKR prices (and
// often compare_at) per tile via MCP get_product (shield-cached).

import { loadRailCache, saveRailCache } from "@/lib/db/mongo";
import { kapruka, parseJson } from "@/lib/kapruka/shield";
import { toSummary } from "@/lib/kapruka/normalize";
import { recoSeen } from "@/lib/reco/store";
import type { ProductSummary } from "@/lib/types";

const g = globalThis as unknown as { __kapuDeals?: { at: number; products: ProductSummary[] } };
const TTL = 15 * 60_000;

/** Friendly category from Kapruka's product-id prefix — the only signal
 *  present on BOTH page variants (search categories are "General" stubs). */
function categoryFromId(id: string): string {
  const p = id.toLowerCase();
  if (/^(kidstoy|softtoy|toy)/.test(p)) return "Toys";
  if (/^(elec|ef_pc_elec|abans)/.test(p)) return "Electronics";
  if (/^(ornament|household|homedecor|home)/.test(p)) return "Home & living";
  if (/^(kitchen|cookware)/.test(p)) return "Kitchen";
  if (/^grocery/.test(p)) return "Grocery";
  if (/^cake/.test(p)) return "Cakes";
  if (/^flower/.test(p)) return "Flowers";
  if (/^(choc|ef_pc_choc)/.test(p)) return "Chocolates";
  if (/^(perfume|cosmetic|beauty)/.test(p)) return "Beauty";
  if (/^(watch|jewel)/.test(p)) return "Accessories";
  if (/^(cloth|fashion|saree)/.test(p)) return "Fashion";
  if (/^giftv/.test(p)) return "Vouchers";
  if (/^pharmacy/.test(p)) return "Pharmacy";
  return "More";
}

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
    if (!link || !name || seen.has(link[2])) continue;
    seen.add(link[2]);
    out.push({
      id: link[2],
      name: name[1].replace(/\s+/g, " ").trim(),
      // null price = intl variant (US$…) — recovered via MCP afterwards
      price: price ? Number(price[1].replace(/,/g, "")) : null,
      compare_at_price: compare ? Number(compare[1].replace(/,/g, "")) : null,
      currency: "LKR",
      image: img ? img[1] : null,
      in_stock: true,
      category: categoryFromId(link[2]),
      url: link[1],
    });
    if (out.length >= 40) break;
  }
  return out;
}

/** Intl-variant tiles carry USD prices our UI can't use — recover the real
 *  LKR price (and often compare_at) per product via MCP get_product. Shield
 *  caches 15 min, so this costs ≤12 calls per cache window. EF_PC_* items
 *  500 upstream and get dropped. */
async function recoverPrices(tiles: ProductSummary[]): Promise<ProductSummary[]> {
  const settled = await Promise.allSettled(
    tiles.slice(0, 36).map(async (t): Promise<ProductSummary> => {
      const res = parseJson(await kapruka("kapruka_get_product", { product_id: t.id }));
      const p = toSummary((res.product ?? res) as Record<string, unknown>, "LKR");
      if (!p.id || p.price == null) throw new Error("no price");
      return {
        ...p,
        image: p.image ?? t.image ?? null,
        url: t.url ?? p.url,
        in_stock: p.in_stock !== false,
        category: p.category ?? t.category ?? categoryFromId(p.id),
      };
    })
  );
  return settled
    .filter((s): s is PromiseFulfilledResult<ProductSummary> => s.status === "fulfilled")
    .map((s) => s.value)
    .filter((p) => p.in_stock !== false);
}

export async function getHotDeals(): Promise<ProductSummary[]> {
  if (g.__kapuDeals && Date.now() - g.__kapuDeals.at < TTL) return g.__kapuDeals.products;
  try {
    const res = await fetch("https://www.kapruka.com/online/promotions", {
      headers: { "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) KapuAgent/1.0" },
      signal: AbortSignal.timeout(6000),
    });
    if (!res.ok) return dealsFallback();
    let products = parseTiles(await res.text());
    if (products.length > 0 && products.every((p) => p.price == null)) {
      // intl variant (USD prices) — rebuild real LKR prices from the MCP
      products = await recoverPrices(products);
    } else {
      products = products.filter((p) => p.price != null);
    }
    if (products.length === 0) return dealsFallback();
    g.__kapuDeals = { at: Date.now(), products };
    void saveRailCache("deals", products);
    void recoSeen(products).catch(() => {});
    return products;
  } catch {
    return dealsFallback();
  }
}

/** Scrape/recovery failed — serve the last good batch from Mongo (72 h cap)
 *  and back-date the in-process cache so a live retry happens in ~7 min. */
async function dealsFallback(): Promise<ProductSummary[]> {
  if (g.__kapuDeals && g.__kapuDeals.products.length > 0) return g.__kapuDeals.products;
  const fb = (await loadRailCache<ProductSummary[]>("deals").catch(() => null)) ?? [];
  if (fb.length > 0) g.__kapuDeals = { at: Date.now() - 8 * 60_000, products: fb };
  return fb;
}
