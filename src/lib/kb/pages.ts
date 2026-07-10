// Kapruka knowledge base — crawl + extract + chunk the NON-product pages of
// kapruka.com (policies, FAQs, company/contact info). robots.txt explicitly
// grants `ai-input=yes` ("use as real-time input to AI answers (RAG,
// grounding, citations) is permitted") — this module is exactly that: RAG
// with citations, no training.

export interface KbPage {
  url: string;
  title: string;
  section: "policies" | "help" | "company";
  /** only harvest JSON-LD (FAQPage/Article) — for pages drowning in product markup */
  ldOnly?: boolean;
}

export interface KbChunk {
  id: string;
  url: string;
  title: string;
  section: string;
  text: string;
}

export const KB_PAGES: KbPage[] = [
  // ── policies ─────────────────────────────────────────────────────────
  { url: "https://www.kapruka.com/shop/returns-refunds-and-other-policies-of-kapruka", title: "Returns, Refunds & Other Policies", section: "policies" },
  { url: "https://www.kapruka.com/shop/privacy-policy", title: "Privacy Policy", section: "policies" },
  { url: "https://www.kapruka.com/shop/terms-and-conditions", title: "Terms & Conditions", section: "policies" },
  { url: "https://www.kapruka.com/shop/delivery-policy", title: "Delivery Policy", section: "policies" },
  // ── company ──────────────────────────────────────────────────────────
  { url: "https://www.kapruka.com/contactUs/about.html", title: "About Kapruka", section: "company" },
  { url: "https://www.kapruka.com/contactUs/officeLocations.jsp", title: "Contact & Office Locations", section: "company" },
  { url: "https://www.kapruka.com/contactUs/b2bcard.jsp", title: "Corporate B2B Card", section: "company" },
  // ── help center ──────────────────────────────────────────────────────
  { url: "https://www.kapruka.com/shop/faq", title: "Help Center", section: "help" },
  { url: "https://blog.kapruka.com/faq/", title: "General FAQ", section: "help" },
  { url: "https://www.kapruka.com/online/samedaydelivery", title: "Same Day Delivery", section: "help", ldOnly: true },
  { url: "https://www.kapruka.com/shop/cake-faqs/", title: "Cake FAQs", section: "help" },
  { url: "https://www.kapruka.com/shop/flowers-faq/", title: "Flowers FAQs", section: "help" },
  { url: "https://www.kapruka.com/shop/chocolates-faq/", title: "Chocolates FAQs", section: "help" },
  { url: "https://www.kapruka.com/shop/kapruka-grocery-faqs/", title: "Grocery FAQs", section: "help" },
  { url: "https://www.kapruka.com/shop/electronicsfaq/", title: "Electronics FAQs", section: "help" },
  { url: "https://www.kapruka.com/shop/fashion-faq/", title: "Fashion FAQs", section: "help" },
  { url: "https://www.kapruka.com/shop/clothing-faq/", title: "Clothing FAQs", section: "help" },
  { url: "https://www.kapruka.com/shop/cosmetics-faq/", title: "Cosmetics FAQs", section: "help" },
  { url: "https://www.kapruka.com/shop/foods-faq/", title: "Foods FAQs", section: "help" },
  { url: "https://www.kapruka.com/shop/fruits-faq/", title: "Fruits FAQs", section: "help" },
  { url: "https://www.kapruka.com/shop/home-faq/", title: "Home FAQs", section: "help" },
  { url: "https://www.kapruka.com/shop/homelifestyle_faq/", title: "Home & Lifestyle FAQs", section: "help" },
  { url: "https://www.kapruka.com/shop/personalized_gifts-faq/", title: "Personalized Gifts FAQs", section: "help" },
  { url: "https://www.kapruka.com/shop/watches_jewelry-faq/", title: "Watches & Jewelry FAQs", section: "help" },
  // NOTE: kapruka.com/faq/{cards,gift-boxes,kids-toys,mother-baby,pharmacy}
  // are linked from the Help Center but 404 (verified 10 Jul) — excluded.
];

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36";

const CHUNK_CHARS = 1000;
const CHUNK_OVERLAP = 120;

// footer/nav noise that repeats on every page — keep KB chunks about content
const BOILERPLATE = [
  /get new arrivals and exclusive offers/i,
  /copyright|all rights reserved/i,
  /^\s*gifts?\s*>+/i,
  /download.*app|app store|google play/i,
  /subscribe|newsletter/i,
];

export async function fetchKbPage(url: string): Promise<string | null> {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      if (attempt) await new Promise((r) => setTimeout(r, attempt * 2000)); // burst crawls get throttled
      const res = await fetch(url, {
        headers: { "User-Agent": UA, Accept: "text/html" },
        signal: AbortSignal.timeout(20000),
        redirect: "follow",
      });
      if (!res.ok) continue;
      const html = await res.text();
      if (html.length > 500) return html;
    } catch {
      /* retry with backoff */
    }
  }
  return null;
}

function stripTags(s: string): string {
  return decodeEntities(s.replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
}

function decodeEntities(s: string): string {
  return s
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&apos;|&#8217;/g, "'")
    .replace(/&#8220;|&#8221;|&ldquo;|&rdquo;/g, '"')
    .replace(/&rsquo;|&lsquo;/g, "'")
    .replace(/&mdash;|&ndash;/g, "—")
    .replace(/&hellip;/g, "…")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)));
}

/* eslint-disable @typescript-eslint/no-explicit-any */
function jsonLdBlocks(html: string): any[] {
  const out: any[] = [];
  for (const m of html.matchAll(/<script[^>]*application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi)) {
    try {
      const parsed = JSON.parse(m[1]);
      const items = Array.isArray(parsed) ? parsed : parsed["@graph"] ? parsed["@graph"] : [parsed];
      out.push(...items);
    } catch {
      /* malformed LD block — skip */
    }
  }
  return out;
}

/** Q&A pairs from FAQPage JSON-LD — the cleanest KB material on the site. */
function faqPairs(ld: any[]): { q: string; a: string }[] {
  const pairs: { q: string; a: string }[] = [];
  for (const block of ld) {
    if (block?.["@type"] !== "FAQPage" || !Array.isArray(block.mainEntity)) continue;
    for (const item of block.mainEntity) {
      const q = stripTags(String(item?.name ?? ""));
      const a = stripTags(String(item?.acceptedAnswer?.text ?? ""));
      if (q.length > 8 && a.length > 12) pairs.push({ q, a });
    }
  }
  return pairs;
}
/* eslint-enable @typescript-eslint/no-explicit-any */

/** Main-content text: slice known content containers, else body minus footer. */
function mainText(html: string): string {
  let region = html;
  const start =
    region.search(/<div[^>]+class="[^"]*(colibri-post-content|entry-content|post-content)[^"]*"/i) >= 0
      ? region.search(/<div[^>]+class="[^"]*(colibri-post-content|entry-content|post-content)[^"]*"/i)
      : region.search(/<(article|main)[\s>]/i);
  if (start >= 0) region = region.slice(start);
  const end = region.search(/<footer[\s>]|class="[^"]*(page-footer|site-footer)[^"]*"/i);
  if (end > 0) region = region.slice(0, end);

  region = region
    .replace(/<(script|style|noscript|svg|form|iframe)[^>]*>[\s\S]*?<\/\1>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<(br|\/p|\/div|\/li|\/h[1-6]|\/tr)[^>]*>/gi, "\n")
    .replace(/<[^>]+>/g, " ");
  const lines = decodeEntities(region)
    .split("\n")
    .map((l) => l.replace(/\s+/g, " ").trim())
    .filter((l) => l.length >= 30 && !BOILERPLATE.some((re) => re.test(l)));
  // dedupe repeated lines (menus render multiple times)
  const seen = new Set<string>();
  return lines.filter((l) => !seen.has(l) && (seen.add(l), true)).join("\n");
}

/** Pack paragraphs into ~1k-char chunks with a small overlap tail. */
function packChunks(paragraphs: string[]): string[] {
  const chunks: string[] = [];
  let buf = "";
  for (const p of paragraphs) {
    if (buf && buf.length + p.length + 1 > CHUNK_CHARS) {
      chunks.push(buf);
      buf = buf.slice(-CHUNK_OVERLAP) + "\n" + p;
    } else {
      buf = buf ? `${buf}\n${p}` : p;
    }
  }
  if (buf.trim().length > 60) chunks.push(buf);
  return chunks;
}

const slug = (url: string) =>
  url.replace(/^https?:\/\//, "").replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "").slice(0, 80);

/** Extract a page into KB chunks (FAQ pairs first, prose fallback). */
export function extractChunks(page: KbPage, html: string): KbChunk[] {
  const ld = jsonLdBlocks(html);
  const pairs = faqPairs(ld);
  const texts: string[] = [];

  if (pairs.length) {
    texts.push(...packChunks(pairs.map(({ q, a }) => `Q: ${q}\nA: ${a}`)));
  }
  if (!page.ldOnly && (!pairs.length || page.section !== "help")) {
    // policies/company pages: prose matters even alongside FAQ markup
    const prose = mainText(html);
    if (prose.length > 200) texts.push(...packChunks(prose.split("\n")));
  }

  const dedup = new Set<string>();
  return texts
    .filter((t) => {
      const key = t.slice(0, 200);
      return !dedup.has(key) && (dedup.add(key), true);
    })
    .slice(0, 40) // per-page cap
    .map((text, i) => ({
      id: `${slug(page.url)}#${i}`,
      url: page.url,
      title: page.title,
      section: page.section,
      text: `${page.title}\n${text}`.slice(0, 4000),
    }));
}
