// Global Shop import quote — "get anything from Amazon to Sri Lanka" via
// Kapruka's real freight-forward service (SL has no Amazon delivery).
//
// AMAZON works fully server-to-server: Kapruka's OWN server fetches the Amazon
// page (send_file_request.jsp), we read the parsed product
// (product_image_lookup.jsp), classify the customs/HS code (open doofinder),
// and get the landed cost (product_lookup_ajax.jsp). No browser, no proxy, and
// no Amazon traffic on our egress IP — Kapruka does the fetch. eBay is NOT
// server-fetchable (probed 8 Aug: send_file_request returns {} for it, and we
// can't fetch eBay ourselves) → callers hand off to the web page instead.
//
// Every number here is Kapruka's OWN (their duty/freight/fee math is
// server-side) — we only render it, always as "estimate, final at checkout".
// Cached like promos.ts: same shared egress IP, so cache hard + never hammer.

import { loadRailCache, saveRailCache } from "@/lib/db/mongo";

const BASE = "https://www.kapruka.com/globalshop/includes";
const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) KapuAgent/1.0";
// doofinder tokens are PUBLIC — shipped in Kapruka's own price-check JS.
const DF_HASH = "cd47a4c31ed57316f02a624e6a27ff62";
const DF_TOKEN = "6b9641798bbadb6b3f98d2622f84ae031b3b0f62";
const HANDOFF = "https://www.kapruka.com/globalshop/price_check_auto.jsp";

export interface ImportQuote {
  url: string;
  handoff_url: string; // blank Global Shop page (last-resort fallback)
  checkout_url: string; // pre-loaded, SHAREABLE quote page (Place Order ready)
  product_name: string;
  product_image: string | null;
  usd_price: number | null; // the real Amazon price
  shipping: "Air" | "Sea";
  weight_lb: number | null;
  weight_estimated: boolean; // Amazon often omits weight → Kapruka defaults 1.8lb
  hs_code: string | null;
  hs_text: string | null; // customs category label (e.g. "Laptop Computers")
  item_lkr: number | null; // productPriceSL
  ship_duty_lkr: number | null; // shipDutySL — shipping + duties + handling
  total_lkr: number | null; // totPriceSL — the headline landed cost
  usd_ship_duty: number | null; // shipDuty (USD) — shipping + duties + handling
  usd_total: number | null; // totalPrice (USD)
}

const g = globalThis as unknown as {
  __gsCookie?: { at: number; v: string };
  __gsQuotes?: Map<string, { at: number; q: ImportQuote }>;
};
const QUOTE_TTL = 6 * 60 * 60_000; // 6h in-process; Mongo mirror persists longer
if (!g.__gsQuotes) g.__gsQuotes = new Map();

const lkr = (s: unknown): number | null => {
  const n = Number(String(s ?? "").replace(/,/g, "").trim());
  return isFinite(n) && n > 0 ? n : null;
};
const usd = (s: unknown): number | null => {
  // Amazon prices ≥ $1,000 arrive comma-grouped ("1,393.65") — strip commas
  // or Number() returns NaN and the whole quote silently fails.
  const n = Number(String(s ?? "").replace(/,/g, "").trim());
  return isFinite(n) && n > 0 ? n : null;
};

/** Amazon product id (ASIN) → stable cache key. Falls back to the raw URL. */
function asin(url: string): string {
  const m = /\/(?:dp|gp\/product|d)\/([A-Z0-9]{10})/i.exec(url) || /\/([A-Z0-9]{10})(?:[/?]|$)/i.exec(url);
  return (m?.[1] ?? url).toUpperCase();
}

/** Strip Amazon's tracking query string down to the canonical /dp/<ASIN> —
 *  the giant ref/dib/pd_rd_* params confuse Kapruka's parser (verified: a raw
 *  URL returned weight 0.01 lb vs the correct 2.65 on the clean form). a.co
 *  short links can't be cleaned (no ASIN yet) → pass through for expansion. */
function cleanAmazonUrl(url: string): string {
  if (/a\.co\//i.test(url)) return url;
  const m = /\/(?:dp|gp\/product|d)\/([A-Z0-9]{10})/i.exec(url) || /\/([A-Z0-9]{10})(?:[/?]|$)/i.exec(url);
  if (!m) return url;
  const domain = /amazon\.in/i.test(url) ? "amazon.in" : "amazon.com";
  return `https://www.${domain}/dp/${m[1].toUpperCase()}`;
}

export function isAmazonUrl(url: string): boolean {
  return /(^|\/\/)([a-z0-9.-]*\.)?amazon\.(com|in)\//i.test(url) || /(^|\/\/)a\.co\//i.test(url);
}

/** Warm a Global Shop session cookie (cached ~30 min) — matches the verified
 *  browser flow; the ASIN cache is global so this is belt-and-braces. */
async function cookie(): Promise<string> {
  if (g.__gsCookie && Date.now() - g.__gsCookie.at < 30 * 60_000) return g.__gsCookie.v;
  try {
    const res = await fetch(HANDOFF, { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(6000) });
    const sc = res.headers.getSetCookie?.() ?? [];
    const v = sc.map((c) => c.split(";")[0]).join("; ");
    g.__gsCookie = { at: Date.now(), v };
    return v;
  } catch {
    return "";
  }
}

async function post(path: string, body: Record<string, string>, ck: string): Promise<Record<string, unknown> | null> {
  try {
    const res = await fetch(`${BASE}/${path}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
        "User-Agent": UA,
        "X-Requested-With": "XMLHttpRequest",
        Origin: "https://www.kapruka.com",
        Referer: HANDOFF,
        ...(ck ? { Cookie: ck } : {}),
      },
      body: new URLSearchParams(body),
      signal: AbortSignal.timeout(12_000),
    });
    const text = (await res.text()).trim();
    try {
      return JSON.parse(text) as Record<string, unknown>;
    } catch {
      return null;
    }
  } catch {
    return null;
  }
}

/** Classify a category/product term to a customs (HS) code via the open
 *  doofinder index Kapruka's own checker uses. Best-effort — the quote still
 *  runs (with rougher duty) if this misses. */
async function resolveHs(term: string): Promise<{ code: string; text: string } | null> {
  try {
    const res = await fetch(
      `https://eu1-search.doofinder.com/5/search?hashid=${DF_HASH}&rpp=5&query=${encodeURIComponent(term.slice(0, 60))}`,
      { headers: { Authorization: DF_TOKEN }, signal: AbortSignal.timeout(6000) }
    );
    const j = (await res.json()) as { results?: { title?: string; description?: string }[] };
    const top = j.results?.[0];
    if (!top) return null;
    return { code: String(top.description ?? "").split("_")[0].trim(), text: String(top.title ?? term) };
  } catch {
    return null;
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Save the quote server-side → a SHAREABLE, non-session-bound URL that
 *  pre-loads this exact product's quote with a working "Place Order" button
 *  (verified: price_check_view.jsp?cID= → orderPlacementForm). Far better than
 *  dumping the user on a blank checker to re-paste. Best-effort → null. */
async function saveQuoteLink(data: Record<string, unknown>, url: string, ck: string): Promise<string | null> {
  const cartObj = JSON.stringify({ ...data, url, isAdvancedPayment: false, advancePay: "0.0" });
  const res = await post("cart_actions_ajax.jsp", { resultType: "JSON", cartObj, action: "savePriceCheck" }, ck);
  const cID = typeof res?.data === "string" ? res.data : "";
  return cID ? `https://www.kapruka.com/globalshop/price_check_view.jsp?cID=${encodeURIComponent(cID)}` : null;
}

/** Read Kapruka's parsed view of the fetched product (name, USD price, image,
 *  weight). Returns null until the server-side fetch has landed. */
async function imageLookup(url: string, ck: string): Promise<{ name: string; price: number | null; image: string | null; weight: number | null } | null> {
  const res = await post("product_image_lookup.jsp", { siteUrl: url }, ck);
  if (!res || res.status !== "SUCCESS" || typeof res.data !== "string") return null;
  try {
    const d = JSON.parse(res.data) as Record<string, unknown>;
    return {
      name: String(d.productName ?? "").trim(),
      price: usd(d.productPrice),
      image: typeof d.productImageLink === "string" ? d.productImageLink : null,
      weight: usd(d.weight),
    };
  } catch {
    return null;
  }
}

/**
 * Quote importing an Amazon product to Sri Lanka via Kapruka Global Shop.
 * Returns the landed cost (LKR) or an { error } the caller turns into a
 * graceful handoff. Cache-first: a previously-checked product re-quotes in
 * ~1s; a cold product takes ~6-12s (Kapruka fetches Amazon).
 */
export async function importQuote(
  rawUrl: string,
  category: string | undefined,
  shipping: "Air" | "Sea"
): Promise<ImportQuote | { error: string; handoff_url: string }> {
  if (!isAmazonUrl(rawUrl.trim())) {
    return { error: "Only Amazon links can be quoted inline right now.", handoff_url: HANDOFF };
  }
  const url = cleanAmazonUrl(rawUrl.trim());
  const key = `${asin(url)}:${shipping}`;

  // cache: in-process → Mongo
  const hit = g.__gsQuotes!.get(key);
  if (hit && Date.now() - hit.at < QUOTE_TTL) return hit.q;
  // v2 = schema with checkout_url + usd_ship_duty; bump on ImportQuote changes
  // so a redeploy never serves a stale-shape cached quote.
  const mongo = await loadRailCache<ImportQuote>(`gs:v2:${key}`).catch(() => null);
  if (mongo && mongo.total_lkr != null) {
    g.__gsQuotes!.set(key, { at: Date.now(), q: mongo });
    return mongo;
  }

  const ck = await cookie();

  // Resolve the product. Cache-first: try the parse directly (warm ASINs
  // answer instantly); only ask Kapruka to fetch Amazon if it's cold or a
  // short (a.co) link that must be expanded first.
  let siteUrl = url;
  let product = /a\.co\//i.test(url) ? null : await imageLookup(url, ck);
  if (!product) {
    const sfr = await post("send_file_request.jsp", { url, shop: "amazon" }, ck);
    if (typeof sfr?.originalurl === "string" && sfr.originalurl) siteUrl = sfr.originalurl;
    // poll instead of a flat 6s sleep — return the instant the fetch lands
    for (let i = 0; i < 8 && !product; i++) {
      await sleep(i === 0 ? 3500 : 1200);
      product = await imageLookup(siteUrl, ck);
    }
  }
  if (!product || product.price == null) {
    return { error: "Couldn't read that product from Amazon just now.", handoff_url: HANDOFF };
  }

  const hs = await resolveHs(category?.trim() || product.name.split(/\s+/).slice(0, 5).join(" "));

  const quoteRes = await post(
    "product_lookup_ajax.jsp",
    {
      resultType: "JSON",
      urlObj: JSON.stringify({
        amozonLink: siteUrl, // (sic) Kapruka's own field name
        shipping,
        hsCode: hs?.code ?? "",
        hsCodeText: hs?.text ?? category ?? "",
        weight: product.weight != null ? String(product.weight) : "1",
        qty: "1",
        contentID: "",
      }),
    },
    ck
  );
  const data = quoteRes?.status === "SUCCESS" ? (quoteRes.data as Record<string, unknown>) : null;
  if (!data || lkr(data.totPriceSL) == null) {
    return { error: "Couldn't get a live landed-cost quote just now.", handoff_url: HANDOFF };
  }

  // Pre-load a shareable checkout link (Place Order ready). Non-fatal.
  const checkoutUrl = await saveQuoteLink(data, siteUrl, ck).catch(() => null);

  const quote: ImportQuote = {
    url,
    handoff_url: HANDOFF,
    checkout_url: checkoutUrl ?? HANDOFF,
    product_name: String(data.productName || product.name).slice(0, 160),
    product_image: (typeof data.productImage === "string" && data.productImage) || product.image,
    usd_price: usd(data.productPrice) ?? product.price,
    shipping,
    weight_lb: usd(data.productWeight) ?? product.weight,
    weight_estimated: product.weight == null,
    hs_code: hs?.code ?? (typeof data.hsCode === "string" ? data.hsCode : null),
    hs_text: hs?.text ?? null,
    item_lkr: lkr(data.productPriceSL),
    ship_duty_lkr: lkr(data.shipDutySL),
    total_lkr: lkr(data.totPriceSL),
    usd_ship_duty: usd(data.shipDuty),
    usd_total: usd(data.totalPrice),
  };

  g.__gsQuotes!.set(key, { at: Date.now(), q: quote });
  void saveRailCache(`gs:v2:${key}`, quote);
  return quote;
}
