// GET /api/similar?id=&name=&category= — "More like this" for the product
// modal. Hybrid: vector neighbors from the taste-engine catalog (when the
// product has been embedded) topped up with a shield-cached keyword search
// distilled from the product name — so it works on cold starts and for the
// EF_PC_* family whose detail API 500s.

import { kapruka, parseJson } from "@/lib/kapruka/shield";
import { toSummary } from "@/lib/kapruka/normalize";
import { recoSeen, similarTo } from "@/lib/reco/store";
import type { ProductSummary } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** "Ata Pirikara Cotton Buddhist Monk Offering Set Sri Lanka" → "Ata Pirikara Cotton Buddhist" */
function distillQuery(name: string, category: string | null): string {
  const words = name
    .replace(/[^a-zA-Z ]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 2 && !/^(the|and|for|with|from|set|pack|kit|small|large|new)$/i.test(w))
    .slice(0, 4);
  if (words.length >= 2) return words.join(" ");
  return category ?? name.slice(0, 40);
}

export async function GET(req: Request): Promise<Response> {
  const u = new URL(req.url);
  const id = (u.searchParams.get("id") ?? "").trim().slice(0, 80);
  const name = (u.searchParams.get("name") ?? "").trim().slice(0, 120);
  const category = (u.searchParams.get("category") ?? "").trim().slice(0, 60) || null;
  if (!id || name.length < 3) return Response.json({ products: [] });

  // make sure the source itself is in the vector catalog
  await recoSeen([{ id, name, category, price: null, currency: "LKR" }]).catch(() => {});

  let searched: ProductSummary[] = [];
  try {
    const res = parseJson(
      await kapruka("kapruka_search_products", { q: distillQuery(name, category), limit: 10, in_stock_only: true })
    );
    searched = (Array.isArray(res.results) ? (res.results as Record<string, unknown>[]) : []).map((r) => toSummary(r, "LKR"));
    await recoSeen(searched).catch(() => {});
  } catch {
    /* vector-only fallback below */
  }

  const self = id.toLowerCase();
  const seen = new Set<string>([self]);
  const products: ProductSummary[] = [];
  for (const p of [...similarTo(id, 8), ...searched]) {
    const key = p.id.toLowerCase();
    if (!p.id || !p.name || seen.has(key) || p.in_stock === false) continue;
    seen.add(key);
    products.push(p);
    if (products.length >= 6) break;
  }
  return Response.json({ products });
}
