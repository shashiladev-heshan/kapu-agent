// GET /api/extras?id=&url= — the product-page extras the MCP doesn't carry:
// per-product rating, instalment offers, partner name, Q&A. Parsed from the
// server-rendered kapruka.com product page (verified: JSON-LD Product +
// FAQPage blocks, instalment tiles in plain HTML). Notably works for the
// EF_PC_* marketplace family whose get_product detail 500s upstream.
//
// Fast by construction: one ~1s fetch per product EVER (24h in-process
// cache); the modal renders instantly and hydrates these when ready.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface Extras {
  rating: { value: number; count: number } | null;
  installments: { provider: string | null; monthly: number; months: number }[];
  partner: string | null;
  qa: { q: string; a: string }[];
}

const g = globalThis as unknown as { __kapuExtras?: Map<string, { at: number; data: Extras }> };
const cache = (g.__kapuExtras ??= new Map());
const TTL = 24 * 60 * 60_000;

const stripTags = (s: string) =>
  s.replace(/<[^>]*>/g, " ").replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/\s+/g, " ").trim();

function parseExtras(html: string): Extras {
  const out: Extras = { rating: null, installments: [], partner: null, qa: [] };

  // JSON-LD blocks (both quote styles appear on the page)
  for (const m of html.matchAll(/<script type=["']application\/ld\+json["']>([\s\S]*?)<\/script>/gi)) {
    let d: unknown;
    try {
      d = JSON.parse(m[1]);
    } catch {
      continue;
    }
    const obj = d as Record<string, unknown>;
    const types = ([] as unknown[]).concat(obj["@type"] ?? []);
    // per-product rating lives on the Product block (the Organization block
    // carries the sitewide 4.8/14k — skip it)
    if (types.includes("Product")) {
      const r = obj.aggregateRating as { ratingValue?: unknown; reviewCount?: unknown } | undefined;
      const value = Number(r?.ratingValue);
      const count = Number(r?.reviewCount);
      if (r && isFinite(value) && value > 0) out.rating = { value, count: isFinite(count) ? count : 0 };
    }
    const mainEntity = obj.mainEntity as Record<string, unknown>[] | undefined;
    if (Array.isArray(mainEntity)) {
      for (const q of mainEntity.slice(0, 4)) {
        if (q["@type"] !== "Question") continue;
        const answer = (q.acceptedAnswer as { text?: unknown } | undefined)?.text;
        const question = stripTags(String(q.name ?? ""));
        if (question && typeof answer === "string") out.qa.push({ q: question.slice(0, 200), a: stripTags(answer).slice(0, 400) });
      }
    }
  }

  // instalment tiles: <span>RS. 1,967</span></span><span…> per month …<p>3 months</p>
  for (const m of html.matchAll(/RS\.?\s*([\d,]+)<\/span><\/span><span[^>]*>\s*per month[\s\S]{0,300}?<p>\s*(\d+)\s*months?\s*<\/p>/gi)) {
    const monthly = Number(m[1].replace(/,/g, ""));
    const months = Number(m[2]);
    if (!isFinite(monthly) || !isFinite(months) || monthly <= 0) continue;
    // sniff the provider from the preceding chunk (logo filenames / alt text)
    const before = html.slice(Math.max(0, m.index! - 400), m.index!).toLowerCase();
    const provider = before.includes("mint") ? "MintPay" : before.includes("koko") ? "KOKO" : before.includes("sampath") ? "Sampath" : null;
    if (out.installments.length < 4) out.installments.push({ provider, monthly, months });
  }

  const partner = html.match(/Kapruka Partner[\s\S]{0,160}?>([^<]{2,40})</i);
  if (partner) out.partner = stripTags(partner[1]) || null;
  return out;
}

export async function GET(req: Request): Promise<Response> {
  const u = new URL(req.url);
  const id = (u.searchParams.get("id") ?? "").trim().slice(0, 80).toLowerCase();
  const raw = (u.searchParams.get("url") ?? "").trim().slice(0, 300);
  if (!id) return Response.json({ error: "id required" }, { status: 400 });

  const hit = cache.get(id);
  if (hit && Date.now() - hit.at < TTL) return Response.json(hit.data);

  // SSRF guard: only ever fetch kapruka.com product pages
  let target: URL;
  try {
    target = new URL(raw);
  } catch {
    return Response.json({ error: "url required" }, { status: 400 });
  }
  if (target.protocol !== "https:" || target.hostname !== "www.kapruka.com" || !target.pathname.startsWith("/buyonline/")) {
    return Response.json({ error: "not a kapruka product url" }, { status: 400 });
  }

  try {
    const res = await fetch(target.toString(), {
      headers: { "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) KapuAgent/1.0" },
      signal: AbortSignal.timeout(4500),
    });
    if (!res.ok) return Response.json({ error: `page ${res.status}` }, { status: 502 });
    const data = parseExtras(await res.text());
    cache.set(id, { at: Date.now(), data });
    if (cache.size > 500) {
      const first = cache.keys().next().value;
      if (first) cache.delete(first);
    }
    return Response.json(data);
  } catch (err) {
    console.error("[extras] failed:", err instanceof Error ? err.message : err);
    return Response.json({ error: "unavailable" }, { status: 502 });
  }
}
