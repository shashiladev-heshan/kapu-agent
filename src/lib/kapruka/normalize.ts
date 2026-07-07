// Defensive normalizers for Kapruka MCP payloads (verified live 4 Jul 2026):
// prices arrive as {amount,currency} | number | numeric string; search hits
// use image_url while detail uses images[]; category may be an object; search
// categories are a constant "General" stub; product IDs are case-unstable.

import type { ProductDetail, ProductSummary } from "@/lib/types";

export function pickImage(p: Record<string, unknown>): string | null {
  if (typeof p.image_url === "string" && p.image_url) return p.image_url;
  const images = p.images;
  if (Array.isArray(images) && images.length > 0 && typeof images[0] === "string") return images[0];
  if (typeof p.image === "string" && p.image) return p.image;
  if (typeof p.thumbnail === "string" && p.thumbnail) return p.thumbnail;
  return null;
}

/** Kapruka's static2 image proxy is width-tunable — resize server-side for
 *  crisp rails/heroes instead of scaling a 330px jpeg in CSS. */
export function resizeImage(url: string | null | undefined, width: number): string | null {
  if (!url) return null;
  if (url.includes("static2.kapruka.com/product-image/")) {
    return url.replace(/width=\d+/, `width=${Math.round(width)}`);
  }
  return url;
}

export function money(v: unknown): { amount: number | null; currency: string | null } {
  if (typeof v === "number") return { amount: v, currency: null };
  if (typeof v === "string" && v.trim() && !isNaN(Number(v))) return { amount: Number(v), currency: null };
  if (v && typeof v === "object") {
    const o = v as { amount?: unknown; currency?: unknown };
    return {
      amount: typeof o.amount === "number" ? o.amount : null,
      currency: typeof o.currency === "string" ? o.currency : null,
    };
  }
  return { amount: null, currency: null };
}

export function categoryName(v: unknown): string | null {
  if (typeof v === "string") return v;
  if (v && typeof v === "object" && typeof (v as { name?: unknown }).name === "string") {
    const name = (v as { name: string }).name;
    // Search results always carry a stub {id:"cat_general",name:"General"} —
    // treat it as unknown rather than rendering a meaningless facet.
    return name.toLowerCase() === "general" ? null : name;
  }
  return null;
}

export function toSummary(p: Record<string, unknown>, currency: string): ProductSummary {
  const price = money(p.price);
  const compareAt = money(p.compare_at_price);
  return {
    id: String(p.id ?? p.product_id ?? ""),
    name: String(p.name ?? ""),
    price: price.amount,
    compare_at_price: compareAt.amount,
    currency: price.currency ?? compareAt.currency ?? currency,
    image: pickImage(p),
    in_stock: p.in_stock !== false,
    // Live probe 4 Jul: stock_level is a constant "low" on every product —
    // untrustworthy, so we no longer surface urgency from it.
    stock_level: typeof p.stock_level === "string" ? p.stock_level : null,
    category: categoryName(p.category),
    url: typeof p.url === "string" ? p.url : null,
    summary: typeof p.summary === "string" ? p.summary.slice(0, 160) : null,
    // search carries ships_internationally at top level; detail nests it
    // under shipping{} — Kapruka's diaspora buyers care about this
    ships_intl:
      p.ships_internationally === true ||
      (p.shipping as { ships_internationally?: unknown } | undefined)?.ships_internationally === true,
  };
}

export function toDetail(p: Record<string, unknown>, currency: string): ProductDetail {
  const images = Array.isArray(p.images) ? (p.images.filter((i) => typeof i === "string") as string[]) : [];
  return {
    ...toSummary(p, currency),
    description: typeof p.description === "string" ? p.description.slice(0, 1200) : null,
    images,
    variants: Array.isArray(p.variants) ? p.variants : [],
    attributes: (p.attributes as Record<string, unknown>) ?? {},
  };
}

/** "Kapruka Signature Bakery · 1.3 kg" style meta line from detail attributes. */
export function detailMeta(product: ProductDetail): string | null {
  const attrs = product.attributes ?? {};
  const parts: string[] = [];
  const vendor = typeof attrs.vendor === "string" ? attrs.vendor.trim() : "";
  if (vendor) parts.push(vendor.replace(/\s+Cake$/i, ""));
  const weight = Number(attrs.weight);
  if (weight > 0.5) parts.push(`${(weight * 0.4536).toFixed(1)} kg`);
  return parts.length ? parts.join(" · ") : null;
}
