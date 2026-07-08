// Kapu's tool surface. Each executor calls the Kapruka MCP through the
// shield, returns a COMPACT JSON string for the model, and emits rich
// UiBlocks for the frontend as a side channel.

import type Anthropic from "@anthropic-ai/sdk";
import { kapruka, parseJson } from "@/lib/kapruka/shield";
import { getHotDeals } from "@/lib/kapruka/promos";
import { applyCartUpdate, cartSubtotal } from "@/lib/kapruka/cart";
import { categoryName, money, toDetail, toSummary } from "@/lib/kapruka/normalize";
import { listOrders, recordOrder } from "@/lib/db/mongo";
import { forgetRecipient, listPeople, rememberOccasion, rememberRecipient, upcomingOccasions } from "@/lib/agent/memory";
import { cancelSchedule, createSchedule, listSchedules } from "@/lib/schedules/store";
import { catalogSummary, hydrateReco, queryMatchScores, recommendFor, recoProductEvent, recoQueryEvent, recoSeen, recoStats, similarTo } from "@/lib/reco/store";
import type { Session } from "@/lib/session/store";
import type { CartItem, OrderSummaryData, ProductDetail, ProductSummary, UiBlock } from "@/lib/types";

export type Emit = (block: UiBlock) => void;

export const TOOL_DEFINITIONS: Anthropic.Tool[] = [
  {
    name: "search_products",
    description:
      "Search the Kapruka catalog by keywords with filters. Renders a visual product grid for the user automatically (or a friendly no-results card). Call this whenever the user wants to find/browse/buy anything. Refine the query instead of paginating.",
    input_schema: {
      type: "object",
      properties: {
        q: { type: "string", description: "Search keywords in English, 3-200 chars (translate Sinhala/Tamil intents to English product terms, e.g. 'kiri' -> 'milk')" },
        category: { type: "string", description: "Optional category filter, e.g. Electronic, Grocery, Pharmacy, Fashion, cakes, flowers, samedaydelivery, bestsellers, promotions — or a bakery brand under cakes (e.g. 'Java', 'Divine')" },
        min_price: { type: "number" },
        max_price: { type: "number" },
        sort: { type: "string", enum: ["relevance", "price_asc", "price_desc", "newest", "bestseller"] },
        in_stock_only: { type: "boolean" },
        limit: { type: "number", description: "1-20, default 8" },
        title: { type: "string", description: "Short heading shown above the product grid, in the user's language" },
      },
      required: ["q"],
    },
  },
  {
    name: "get_product",
    description:
      "Get full details for one product (price, stock, variants, description, vendor, shipping). Renders a hero product card with an image gallery — and for cakes, an inline icing-message field and delivery-date picker. Use before answering spec questions or adding to cart when details matter.",
    input_schema: {
      type: "object",
      properties: { product_id: { type: "string" } },
      required: ["product_id"],
    },
  },
  {
    name: "compare_products",
    description:
      "Side-by-side comparison of 2-4 products. Renders a visual comparison card with per-row winners and your verdict strip. ALWAYS use when the user is choosing between options (e.g. phones under a budget).",
    input_schema: {
      type: "object",
      properties: {
        product_ids: { type: "array", items: { type: "string" }, minItems: 2, maxItems: 4 },
        verdict: {
          type: "string",
          description: "One punchy sentence: which to pick and why (e.g. 'take the Redmi for battery life; the Samsung if Amma keeps phones 4+ years'). Shown in the card's verdict strip.",
        },
      },
      required: ["product_ids"],
    },
  },
  {
    name: "list_categories",
    description:
      "List Kapruka's full category tree (65 top-level incl. festival/occasion pages, utility rails, bakery brands) AND render a visual tappable category explorer for the user. Call when they ask 'what can I buy here?' / want to browse. Note: use children as plain search KEYWORDS — category facets often return 0.",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "crown_pick",
    description:
      "Move the on-screen KAPU'S PICK badge to the product YOUR verdict recommends. Call this whenever your final recommendation differs from the pick:true item in the last search results — the badge and your words must agree.",
    input_schema: {
      type: "object",
      properties: { product_id: { type: "string", description: "The product your verdict recommends" } },
      required: ["product_id"],
    },
  },
  {
    name: "get_hot_deals",
    description:
      "Today's REAL discounts from kapruka.com's live promotions page (true strikethrough prices). Renders a product grid with SAVE % badges. Call whenever the user asks for offers/deals/discounts/promotions/sale ('mokakda offers thiyenne?'). If it returns none, say so honestly and offer trending picks instead.",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "get_recommendations",
    description:
      "Personalized 'picked for you' products from THIS user's taste profile (vector similarity over everything they searched/opened/carted). Pass product_id for 'more like this' instead. Renders a product grid automatically. Use when they ask for suggestions/'surprise me'/'what else', or to enrich a thin answer. If it returns too_little_signal, search normally instead.",
    input_schema: {
      type: "object",
      properties: {
        product_id: { type: "string", description: "Optional — recommend items similar to this product instead of the user's overall taste" },
        title: { type: "string", description: "Grid heading in the user's language (default 'Picked for you')" },
      },
    },
  },
  {
    name: "resolve_city",
    description:
      "Resolve a (possibly misspelled / vernacular / Tanglish) city name to canonical deliverable Kapruka cities with aliases. Use BEFORE check_delivery or create_order.",
    input_schema: {
      type: "object",
      properties: { query: { type: "string", description: "Partial or approximate city name, e.g. 'nugegoda', 'kolpity', 'bambala'" } },
      required: ["query"],
    },
  },
  {
    name: "check_delivery",
    description:
      "Check delivery feasibility + the flat rate for a canonical city and date. One order = one flat rate regardless of item count. Renders a delivery card. Pass product_id of a cake/flower item to surface perishable warnings.",
    input_schema: {
      type: "object",
      properties: {
        city: { type: "string", description: "Canonical city name from resolve_city" },
        delivery_date: { type: "string", description: "YYYY-MM-DD (omit for today, Sri Lanka time)" },
        product_id: { type: "string" },
      },
      required: ["city"],
    },
  },
  {
    name: "cart_update",
    description:
      "Add, change quantity of, or remove an item in the user's basket (server-side, max 30 items). quantity=0 removes. The basket UI updates automatically. icing_text only applies to cakes (max 120 chars).",
    input_schema: {
      type: "object",
      properties: {
        product_id: { type: "string" },
        quantity: { type: "number", description: "Desired total quantity; 0 removes the item" },
        icing_text: { type: "string" },
      },
      required: ["product_id", "quantity"],
    },
  },
  {
    name: "view_cart",
    description: "Show the current basket with totals (renders the basket view).",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "propose_order",
    description:
      "Render the pre-checkout ORDER SUMMARY card (items from the CURRENT basket + recipient + delivery + verified flat rate) with a 'Yes — place the order' button. Call this INSTEAD of writing a text summary, once you have recipient name, phone, full address, canonical city and delivery date. It re-verifies delivery availability and rate. The user must still explicitly confirm before create_order.",
    input_schema: {
      type: "object",
      properties: {
        recipient_name: { type: "string" },
        recipient_phone: { type: "string" },
        address: { type: "string", description: "Full street address, 3-250 chars" },
        city: { type: "string", description: "Canonical deliverable city" },
        delivery_date: { type: "string", description: "YYYY-MM-DD" },
        location_type: { type: "string", enum: ["house", "apartment", "office", "other"] },
        instructions: { type: "string" },
        sender_name: { type: "string" },
        anonymous: { type: "boolean" },
        gift_message: { type: "string", description: "Optional gift card message, max 300 chars" },
      },
      required: ["recipient_name", "recipient_phone", "address", "city", "delivery_date"],
    },
  },
  {
    name: "create_order",
    description:
      "Create the Kapruka guest-checkout order from the CURRENT BASKET and return a secure pay link (prices locked ~60 min). ONLY call after propose_order was shown AND the user explicitly confirmed (e.g. tapped 'Yes — place the order'). Requires real recipient details from the user — never invent them.",
    input_schema: {
      type: "object",
      properties: {
        recipient_name: { type: "string" },
        recipient_phone: { type: "string" },
        address: { type: "string", description: "Full street address, 3-250 chars" },
        city: { type: "string", description: "Canonical deliverable city" },
        location_type: { type: "string", enum: ["house", "apartment", "office", "other"] },
        delivery_date: { type: "string", description: "YYYY-MM-DD" },
        instructions: { type: "string" },
        sender_name: { type: "string" },
        anonymous: { type: "boolean", description: "Surprise mode: hide sender name from recipient" },
        gift_message: { type: "string", description: "Optional gift card message, max 300 chars" },
        confirmed: { type: "boolean", description: "MUST be true, and only after the user explicitly confirmed the summary" },
      },
      required: ["recipient_name", "recipient_phone", "address", "city", "delivery_date", "sender_name", "confirmed"],
    },
  },
  {
    name: "track_order",
    description:
      "Track an order by the order number Kapruka EMAILED after payment (e.g. VIMP34456CB2 — not the pre-payment order_ref). Renders a rich visual timeline with timestamps and delivery photo/video proof.",
    input_schema: {
      type: "object",
      properties: { order_number: { type: "string" } },
      required: ["order_number"],
    },
  },
  {
    name: "remember_recipient",
    description:
      "Save or update a person the user sends things to (name, relationship, phone, address, city, notes). ONLY call after the user explicitly agrees to remember them ('shall I remember Amma's address?' → yes). Signed-in users sync across devices; guests stay on this device.",
    input_schema: {
      type: "object",
      properties: {
        name: { type: "string", description: "How the user calls them, e.g. 'Amma', 'Nangi', 'Sunil aiya'" },
        relationship: { type: "string" },
        phone: { type: "string" },
        address: { type: "string" },
        city: { type: "string", description: "Canonical deliverable city" },
        notes: { type: "string", description: "Preferences/dietary, e.g. 'loves ribbon cake, no alcohol'" },
      },
      required: ["name"],
    },
  },
  {
    name: "get_recipients",
    description:
      "List the user's saved people with full details (address, phone, notes) — use when they say 'send it to Amma' to prefill delivery details, then confirm briefly instead of re-asking everything.",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "forget_recipient",
    description: "Delete a saved person (and their occasions) when the user asks you to forget them.",
    input_schema: {
      type: "object",
      properties: { name: { type: "string" } },
      required: ["name"],
    },
  },
  {
    name: "save_occasion",
    description:
      "Remember an occasion (birthday, anniversary…) for a saved person. ONLY after the user agrees. date: YYYY-MM-DD or MM-DD for yearly.",
    input_schema: {
      type: "object",
      properties: {
        recipient: { type: "string" },
        type: { type: "string", description: "e.g. birthday, wedding anniversary" },
        date: { type: "string", description: "YYYY-MM-DD or MM-DD (yearly)" },
        recurring: { type: "boolean" },
      },
      required: ["recipient", "type", "date"],
    },
  },
  {
    name: "get_upcoming_occasions",
    description: "The user's saved occasions coming up in the next ~60 days, with days-until — for proactive gift planning.",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "get_my_orders",
    description:
      "The user's recent Kapu orders (items, recipient, city, date, order_ref) — for 'order it again', 'what did I send Amma last time' and avoiding repeat gifts.",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "create_schedule",
    description:
      "Create a standing wish that runs AUTONOMOUSLY on a schedule (signed-in users only — check signed_in in context). Restate the plan and get a yes first. Results go to the user's linked Telegram (or the web bell). kind 'watch_order' polls an order until delivered.",
    input_schema: {
      type: "object",
      properties: {
        title: { type: "string", description: "Short human label, e.g. 'Flowers for Amma — month-end'" },
        instruction: { type: "string", description: "The task Kapu runs each time, incl. budget/limits, e.g. 'Pick a fresh flower bouquet under Rs 5,000 and send to Amma (saved recipient)'" },
        kind: { type: "string", enum: ["task", "watch_order", "watch_price"] },
        order_number: { type: "string", description: "watch_order only — the EMAILED tracking number" },
        product_id: { type: "string", description: "watch_price only — the product to watch; alerts on a ≥2% drop via Telegram, then stops" },
        cadence_kind: { type: "string", enum: ["once", "daily", "weekly", "monthly", "yearly"] },
        at: { type: "string", description: "HH:mm Sri Lanka time, default 09:00" },
        date: { type: "string", description: "once: YYYY-MM-DD · yearly: MM-DD" },
        weekday: { type: "number", description: "weekly: 0=Sunday … 6=Saturday" },
        day: { type: "number", description: "monthly: 1-31" },
        allow_order: { type: "boolean", description: "standing consent to place orders (user still pays via link). Ask the user explicitly." },
      },
      required: ["title", "instruction", "cadence_kind"],
    },
  },
  {
    name: "list_schedules",
    description: "List the signed-in user's standing schedules with next-run times.",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "cancel_schedule",
    description: "Cancel one of the user's schedules by id (from list_schedules).",
    input_schema: { type: "object", properties: { id: { type: "string" } }, required: ["id"] },
  },
  {
    name: "create_card",
    description:
      "Render a beautiful festival/occasion greeting card the user can download or share (WhatsApp etc.). Use when they set a gift message, or ask for a card. The card renders in-app with perfect Sinhala/Tamil script.",
    input_schema: {
      type: "object",
      properties: {
        to: { type: "string", description: "Recipient name, e.g. 'Amma'" },
        message: { type: "string", description: "The greeting, in the user's language/script, max 140 chars" },
        from: { type: "string", description: "Sender name (omit for anonymous)" },
        occasion: { type: "string", description: "e.g. 'birthday', 'Esala', 'Avurudu', 'Vesak', 'Christmas', 'Deepavali', 'love'" },
      },
      required: ["to", "message"],
    },
  },
  {
    name: "say",
    description:
      "VOICE MODE ONLY (mode: voice in context). Provide the exact text the voice engine should SPEAK for this reply. Same meaning as your visible reply but optimized for speech: short natural sentences, no formatting, prices in words. For Sinhala conversations write it in ROMANIZED colloquial Sinhala (e.g. 'mama cake hayak hoyaagaththa, Chocolate Truffle eka rupiyal pandahai vissai'). Call exactly once, after your reply text.",
    input_schema: {
      type: "object",
      properties: { text: { type: "string", description: "The speakable version, 1-3 short sentences" } },
      required: ["text"],
    },
  },
  {
    name: "suggest_replies",
    description:
      "Show 2-4 tappable quick-reply chips for the user's most likely next steps, in the user's language. Use at natural decision points (after showing products, before checkout).",
    input_schema: {
      type: "object",
      properties: { chips: { type: "array", items: { type: "string" }, minItems: 2, maxItems: 4 } },
      required: ["chips"],
    },
  },
];

// ── helpers ────────────────────────────────────────────────────────────

function modelView(p: ProductSummary | ProductDetail): Record<string, unknown> {
  // Compact view for the model — no image URLs (cards show them already).
  const { image: _i, images: _is, url: _u, ...rest } = p as ProductDetail;
  return rest;
}

const PERISHABLE_ID = /^(cake|flower|combo)/i;

// Accessory nouns that hijack search rank (Kapruka lists car chargers above
// actual phones for "phone"). A product whose NAME introduces one of these
// terms that the USER never asked for can't win the KAPU'S PICK badge.
const ACCESSORY_TERMS =
  /\b(charger|charging|holder|mount|case|cover|stand|cable|adapter|protector|tempered glass|screen guard|speaker|strap|power ?bank|ear ?buds?|head ?phones?|air ?pods?|selfie|tripod|lens|sticker|skin)\b/gi;

function isAccessoryNoise(name: string, queryLower: string): boolean {
  const terms = name.toLowerCase().match(ACCESSORY_TERMS) ?? [];
  return terms.some((t) => !queryLower.includes(t.replace(/\s+/g, " ").trim()));
}

function firstPerishableId(session: Session): string | undefined {
  const hit = session.cart.items.find(
    (i) => PERISHABLE_ID.test(i.product_id) || /cake|flower/i.test(i.category ?? "")
  );
  return hit?.product_id;
}

// ── executor ───────────────────────────────────────────────────────────

export async function executeTool(
  name: string,
  input: Record<string, unknown>,
  session: Session,
  emit: Emit
): Promise<string> {
  const currency = session.currency;

  switch (name) {
    case "search_products": {
      const query = String(input.q ?? "").slice(0, 200);
      const res = parseJson(
        await kapruka("kapruka_search_products", {
          q: query,
          ...(input.category ? { category: input.category } : {}),
          ...(input.min_price != null ? { min_price: input.min_price } : {}),
          ...(input.max_price != null ? { max_price: input.max_price } : {}),
          ...(input.sort ? { sort: input.sort } : {}),
          ...(input.in_stock_only != null ? { in_stock_only: input.in_stock_only } : {}),
          limit: Math.min(Number(input.limit) || 8, 20),
          currency,
        })
      );
      const rawList = (res.products ?? res.results ?? res.items ?? []) as Record<string, unknown>[];
      const products = rawList.map((p) => toSummary(p, currency));
      // KAPU'S PICK = the result that semantically MATCHES the query, not
      // blind rank 0 — Kapruka ranks accessories above the thing itself
      // ("phone" → car chargers first). Cosine via the taste-engine
      // embeddings, ≤900ms, falling back to rank order.
      const sort = String(input.sort ?? "relevance");
      if (products.length > 1 && (sort === "relevance" || sort === "bestseller")) {
        // candidates = results that aren't accessory noise for this query;
        // among them, the semantically closest to the query wins the badge
        const qLower = query.toLowerCase();
        const cand = products.map((_, i) => i).filter((i) => !isAccessoryNoise(products[i].name, qLower));
        const eligible = cand.length > 0 ? cand : products.map((_, i) => i);
        const scores = await queryMatchScores(query, products);
        let pi = eligible[0];
        if (scores) for (const i of eligible) if (scores[i] > scores[pi]) pi = i;
        products[pi] = { ...products[pi], pick: true };
        if (products.length >= 3) {
          // BEST VALUE = cheapest eligible item near the pick's relevance
          // that undercuts the pick — not the cheapest accessory.
          let vi = -1;
          for (const i of eligible) {
            if (i === pi || products[i].price == null) continue;
            if (scores && scores[i] < scores[pi] - 0.12) continue;
            if (vi === -1 || products[i].price! < products[vi].price!) vi = i;
          }
          if (vi !== -1 && products[vi].price! < (products[pi].price ?? Infinity)) {
            products[vi] = { ...products[vi], value: true };
          }
        }
      }
      if (products.length > 0) {
        emit({ type: "product_grid", title: typeof input.title === "string" ? input.title : undefined, products });
      } else {
        emit({ type: "no_results", query });
      }
      // taste engine: index what was shown; the query itself is intent
      void recoSeen(products).catch(() => {});
      void recoQueryEvent([session.userSub, session.id], query).catch(() => {});
      return JSON.stringify({ count: products.length, products: products.map(modelView) });
    }

    case "get_product": {
      const res = parseJson(await kapruka("kapruka_get_product", { product_id: String(input.product_id), currency }));
      const raw = (res.product ?? res) as Record<string, unknown>;
      const product = toDetail(raw, currency);
      if (product.id) emit({ type: "product_hero", product });
      void recoProductEvent([session.userSub, session.id], product, 2).catch(() => {});
      return JSON.stringify(modelView(product));
    }

    case "compare_products": {
      const ids = (input.product_ids as string[]).slice(0, 4);
      // allSettled: get_product 500s on some families (EF_PC_ELEC* verified) —
      // compare what loaded instead of dying entirely.
      const settled = await Promise.allSettled(
        ids.map(async (id) => {
          const res = parseJson(await kapruka("kapruka_get_product", { product_id: id, currency }));
          return toDetail((res.product ?? res) as Record<string, unknown>, currency);
        })
      );
      const details: ProductDetail[] = [];
      let recovered = 0;
      settled.forEach((s, i) => {
        if (s.status === "fulfilled" && s.value.id) {
          details.push(s.value);
          return;
        }
        // detail fetch died — degrade to the search summary we already showed
        // (kept in the taste-engine catalog), so the duel still renders
        const known = catalogSummary(ids[i]);
        if (known) {
          details.push({ ...known, description: null, images: known.image ? [known.image] : [], variants: [], attributes: {} });
          recovered++;
        }
      });
      const missing = ids.length - details.length;
      if (details.length >= 2) {
        emit({
          type: "compare_grid",
          products: details,
          verdict: typeof input.verdict === "string" ? input.verdict.slice(0, 220) : undefined,
        });
        return JSON.stringify({
          compared: details.map(modelView),
          ...(recovered > 0 ? { note: `${recovered} product(s) shown from search data only (full detail API 500s on some electronics) — specs beyond name/price may be unknown; say so honestly.` } : {}),
          ...(missing > 0 ? { dropped: missing } : {}),
        });
      }
      return JSON.stringify({
        error: `Only ${details.length} of ${ids.length} products loaded (Kapruka API 500s on some electronics IDs) — compare in flowing prose from the search results you already have. NEVER a markdown table.`,
      });
    }

    case "list_categories": {
      const res = parseJson(await kapruka("kapruka_list_categories", { depth: 2 }));
      // Compact for the model: names + child names only (urls omitted).
      const cats = Array.isArray(res.categories)
        ? (res.categories as Record<string, unknown>[]).map((c) => ({
            name: categoryName(c.name) ?? String(c.name ?? ""),
            ...(Array.isArray(c.children) && c.children.length
              ? { children: (c.children as Record<string, unknown>[]).map((ch) => String(ch.name ?? "")).slice(0, 30) }
              : {}),
          }))
        : res;
      // Visual category explorer — tappable tiles + kapruka.com browse links.
      // Chips trigger plain-q searches (category FACETS return 0, verified).
      if (Array.isArray(res.categories)) {
        emit({
          type: "category_tree",
          categories: (res.categories as Record<string, unknown>[])
            .map((c) => ({
              name: String(c.name ?? ""),
              url: typeof c.url === "string" ? c.url : null,
              children: Array.isArray(c.children)
                ? (c.children as Record<string, unknown>[]).map((ch) => String(ch.name ?? "")).slice(0, 6)
                : [],
            }))
            .filter((c) => c.name),
        });
      }
      return JSON.stringify({ categories: cats });
    }

    case "crown_pick": {
      const pid = String(input.product_id ?? "").trim();
      if (!pid) return JSON.stringify({ error: "product_id required" });
      emit({ type: "pick_update", product_id: pid });
      return JSON.stringify({ crowned: pid });
    }

    case "get_hot_deals": {
      const deals = await getHotDeals();
      if (deals.length === 0) {
        return JSON.stringify({
          none: true,
          note: "No live promotions reachable right now (the promos page is geo-limited) — offer trending picks or a discounted search instead.",
        });
      }
      const shown = deals.slice(0, 10).map((p, i) => ({ ...p, pick: i === 0 }));
      emit({ type: "product_grid", title: "🏷️ Hot deals — live promotions", products: shown });
      return JSON.stringify({
        count: shown.length,
        deals: shown.map((p) => ({
          ...modelView(p),
          save_pct: p.price && p.compare_at_price ? Math.round((1 - p.price / p.compare_at_price) * 100) : null,
        })),
      });
    }

    case "get_recommendations": {
      await hydrateReco([session.userSub, session.id]);
      const pid = typeof input.product_id === "string" ? input.product_id : null;
      const recs = pid ? similarTo(pid, 6) : recommendFor([session.userSub, session.id], 8);
      if (recs.length < 3) {
        const stats = recoStats([session.userSub, session.id]);
        return JSON.stringify({
          too_little_signal: true,
          note: `Only ${stats.events} interactions this session — search normally and the taste profile will build up.`,
        });
      }
      emit({
        type: "product_grid",
        title: typeof input.title === "string" ? input.title : "Picked for you 💜",
        products: recs,
      });
      return JSON.stringify({ count: recs.length, based_on: pid ? `similar to ${pid}` : "taste profile", products: recs.map(modelView) });
    }

    case "resolve_city": {
      const res = parseJson(
        await kapruka("kapruka_list_delivery_cities", { query: String(input.query ?? ""), limit: 8 })
      );
      return JSON.stringify(res);
    }

    case "check_delivery": {
      const params: Record<string, unknown> = { city: String(input.city) };
      if (input.delivery_date) params.delivery_date = input.delivery_date;
      if (input.product_id) params.product_id = input.product_id;
      const res = parseJson(await kapruka("kapruka_check_delivery", params));
      emit({
        type: "delivery_card",
        city: String(res.city ?? input.city),
        date: typeof res.checked_date === "string" ? res.checked_date : undefined,
        available: res.available === true,
        rate: typeof res.rate === "number" ? res.rate : undefined,
        currency: typeof res.currency === "string" ? res.currency : "LKR",
        reason: typeof res.reason === "string" ? res.reason : undefined,
        next_available_date: typeof res.next_available_date === "string" ? res.next_available_date : undefined,
        perishable_warning: typeof res.perishable_warning === "string" ? res.perishable_warning : undefined,
      });
      return JSON.stringify(res);
    }

    case "cart_update": {
      const result = await applyCartUpdate(session, {
        product_id: String(input.product_id),
        quantity: Number(input.quantity) || 0,
        ...(typeof input.icing_text === "string" ? { icing_text: input.icing_text } : {}),
      });
      if (result.error) return JSON.stringify({ error: result.error });
      emit({ type: "cart", cart: session.cart });
      return JSON.stringify({
        cart: session.cart.items.map(({ image: _x, ...i }) => i),
        subtotal: cartSubtotal(session),
        currency,
      });
    }

    case "view_cart": {
      emit({ type: "cart", cart: session.cart });
      return JSON.stringify({
        cart: session.cart.items.map(({ image: _x, ...i }) => i),
        subtotal: cartSubtotal(session),
        currency: session.cart.currency,
      });
    }

    case "propose_order": {
      if (session.cart.items.length === 0) {
        return JSON.stringify({ error: "Basket is empty — add items before proposing an order." });
      }
      const city = String(input.city);
      const date = String(input.delivery_date);
      // Re-verify delivery at confirm time (defensive-honesty rule F3).
      let rate: number | null = null;
      let available: boolean | undefined;
      let perishable: string | undefined;
      try {
        const check = parseJson(
          await kapruka("kapruka_check_delivery", {
            city,
            delivery_date: date,
            ...(firstPerishableId(session) ? { product_id: firstPerishableId(session) } : {}),
          })
        );
        available = check.available === true;
        rate = typeof check.rate === "number" ? check.rate : null;
        perishable = typeof check.perishable_warning === "string" ? check.perishable_warning : undefined;
      } catch {
        /* delivery check unavailable — the card shows rate as pending */
      }
      const subtotal = cartSubtotal(session);
      const giftMode = Boolean(
        input.gift_message ||
          input.anonymous === true ||
          (typeof input.sender_name === "string" && input.sender_name.trim() && input.sender_name !== input.recipient_name)
      );
      const summary: OrderSummaryData = {
        items: session.cart.items,
        recipient: { name: String(input.recipient_name), phone: String(input.recipient_phone) },
        delivery: {
          address: String(input.address),
          city,
          location_type: (input.location_type as string) || "house",
          date,
          ...(input.instructions ? { instructions: String(input.instructions) } : {}),
        },
        ...(input.sender_name
          ? { sender: { name: String(input.sender_name), anonymous: input.anonymous === true } }
          : {}),
        ...(input.gift_message ? { gift_message: String(input.gift_message).slice(0, 300) } : {}),
        subtotal,
        delivery_rate: rate,
        delivery_available: available,
        ...(perishable ? { perishable_warning: perishable } : {}),
        total: subtotal + (rate ?? 0),
        currency,
        tagline: `${session.cart.items.reduce((n, i) => n + i.quantity, 0)} item${session.cart.items.length > 1 ? "s" : ""}${giftMode ? " · gift delivery" : ""}`,
      };
      emit({ type: "order_summary", summary });
      return JSON.stringify({
        shown: true,
        delivery_available: available,
        flat_rate: rate,
        subtotal,
        total: summary.total,
        currency,
        next: "Ask the user to confirm explicitly (they can tap 'Yes — place the order'). Only then call create_order with confirmed=true.",
      });
    }

    case "create_order": {
      if (input.confirmed !== true) {
        return JSON.stringify({ error: "Refused: show propose_order and get explicit confirmation first." });
      }
      if (session.cart.items.length === 0) {
        return JSON.stringify({ error: "Basket is empty — add items before creating an order." });
      }
      const payload = {
        cart: session.cart.items.map((i) => ({
          product_id: i.product_id,
          quantity: i.quantity,
          ...(i.icing_text ? { icing_text: i.icing_text } : {}),
        })),
        recipient: { name: String(input.recipient_name), phone: String(input.recipient_phone) },
        delivery: {
          address: String(input.address),
          city: String(input.city),
          location_type: (input.location_type as string) || "house",
          date: String(input.delivery_date),
          ...(input.instructions ? { instructions: String(input.instructions) } : {}),
        },
        sender: { name: String(input.sender_name), anonymous: input.anonymous === true },
        ...(input.gift_message ? { gift_message: String(input.gift_message).slice(0, 300) } : {}),
        currency,
      };
      // The MCP issues an idempotency key per call and documents that retries
      // return the same checkout URL — one safe retry on transient failures.
      let res: Record<string, unknown>;
      try {
        res = parseJson(await kapruka("kapruka_create_order", payload));
      } catch {
        res = parseJson(await kapruka("kapruka_create_order", payload));
      }
      const orderRef = String(res.order_ref ?? res.orderRef ?? res.ref ?? "");
      const payUrl = String(res.checkout_url ?? res.pay_url ?? res.payment_url ?? res.url ?? "");
      const summary = (res.summary ?? {}) as Record<string, unknown>;
      const grandTotal = money(summary.grand_total).amount ?? (typeof res.total === "number" ? res.total : null);
      if (payUrl) {
        emit({
          type: "pay_link",
          order_ref: orderRef,
          pay_url: payUrl,
          total: grandTotal ?? undefined,
          currency: typeof summary.currency === "string" ? (summary.currency as string) : currency,
          created_at: Date.now(),
          ...(typeof res.expires_at === "string" ? { expires_at: res.expires_at } : {}),
          ...(money(summary.items_total).amount != null
            ? {
                breakdown: {
                  items_total: money(summary.items_total).amount,
                  delivery_fee: money(summary.delivery_fee).amount,
                  addons_total: money(summary.addons_total).amount,
                },
              }
            : {}),
        });
        void recordOrder({
          session_id: session.id,
          ...(session.userSub ? { user_sub: session.userSub } : {}),
          order_ref: orderRef,
          pay_url: payUrl,
          cart: session.cart,
          recipient: payload.recipient,
          delivery: payload.delivery,
        });
        session.cart = { items: [], currency };
        emit({ type: "cart", cart: session.cart });
      }
      return JSON.stringify(res);
    }

    case "track_order": {
      const res = parseJson(await kapruka("kapruka_track_order", { order_number: String(input.order_number) }));
      const progress = Array.isArray(res.progress)
        ? (res.progress as { step?: unknown; timestamp?: unknown }[]).map((p) => ({
            step: String(p.step ?? ""),
            timestamp: typeof p.timestamp === "string" ? p.timestamp : null,
          }))
        : [];
      if (res.order_number || res.status) {
        emit({
          type: "order_timeline",
          order_number: String(res.order_number ?? input.order_number),
          status: String(res.status ?? "unknown"),
          status_display: typeof res.status_display === "string" ? res.status_display : undefined,
          progress,
          has_delivery_photo: res.has_delivery_photo === true,
          has_delivery_video: res.has_delivery_video === true,
          items: Array.isArray(res.items) ? (res.items as { name?: string; quantity?: number }[]) : undefined,
        });
      }
      return JSON.stringify(res);
    }

    case "remember_recipient": {
      const name = String(input.name ?? "").trim();
      if (!name) return JSON.stringify({ error: "name is required" });
      const saved = await rememberRecipient(session, {
        name,
        relationship: input.relationship as string | undefined,
        phone: input.phone as string | undefined,
        address: input.address as string | undefined,
        city: input.city as string | undefined,
        notes: input.notes as string | undefined,
      });
      return JSON.stringify({
        saved: saved.recipient,
        memory: saved.scope,
        note: saved.scope === "device" ? "Guest memory — stays on this device; signing in syncs it." : "Synced to their account.",
      });
    }

    case "get_recipients": {
      const people = await listPeople(session);
      return JSON.stringify({ recipients: people.recipients, memory: people.scope });
    }

    case "forget_recipient": {
      const ok = await forgetRecipient(session, String(input.name ?? ""));
      return JSON.stringify(ok ? { forgotten: true } : { error: "No saved person by that name." });
    }

    case "save_occasion": {
      const res = await rememberOccasion(session, {
        recipient: String(input.recipient ?? ""),
        type: String(input.type ?? ""),
        date: String(input.date ?? ""),
        recurring: input.recurring as boolean | undefined,
      });
      return JSON.stringify(res);
    }

    case "get_upcoming_occasions": {
      const upcoming = await upcomingOccasions(session);
      return JSON.stringify({ upcoming });
    }

    case "get_my_orders": {
      const orders = await listOrders(session.id, session.userSub);
      return JSON.stringify({
        orders: orders.map((o) => ({
          order_ref: o.order_ref,
          when: o.created_at,
          recipient: (o.recipient as { name?: string })?.name,
          city: (o.delivery as { city?: string })?.city,
          date: (o.delivery as { date?: string })?.date,
          items: Array.isArray((o.cart as { items?: CartItem[] })?.items)
            ? (o.cart as { items: CartItem[] }).items.map((i) => `${i.name} ×${i.quantity}`)
            : [],
        })),
        note: "order_ref is pre-payment; the emailed order_number tracks delivery.",
      });
    }

    case "create_schedule": {
      if (!session.userSub) {
        return JSON.stringify({ error: "Not signed in — schedules need a Google-signed-in account. Ask the user to sign in (top-right), then retry." });
      }
      try {
        const sched = await createSchedule({
          sub: session.userSub,
          title: String(input.title ?? "").slice(0, 60) || "Standing wish",
          instruction: String(input.instruction ?? "").slice(0, 500),
          kind: input.kind === "watch_order" ? "watch_order" : input.kind === "watch_price" ? "watch_price" : "task",
          ...(input.order_number ? { orderNumber: String(input.order_number).slice(0, 40) } : {}),
          ...(input.product_id ? { productId: String(input.product_id).slice(0, 80) } : {}),
          cadence: {
            kind: (input.cadence_kind as "once" | "daily" | "weekly" | "monthly" | "yearly") ?? "once",
            at: typeof input.at === "string" && /^\d{1,2}:\d{2}$/.test(input.at) ? input.at : "09:00",
            ...(input.date ? { date: String(input.date) } : {}),
            ...(input.weekday != null ? { weekday: Number(input.weekday) } : {}),
            ...(input.day != null ? { day: Number(input.day) } : {}),
          },
          allowOrder: input.allow_order === true,
        });
        const { getUser } = await import("@/lib/auth/users");
        const linked = Boolean((await getUser(session.userSub))?.tgChatId);
        return JSON.stringify({
          created: { id: sched.id, title: sched.title, next_run_sl: new Date(sched.nextRun).toLocaleString("en-GB", { timeZone: "Asia/Colombo" }) },
          standing_order_consent: sched.allowOrder,
          telegram_linked: linked,
          note: linked ? "Results will arrive on their Telegram." : "Telegram not linked — suggest sending /link to the bot and entering the code under Schedules; until then results land in the web bell.",
        });
      } catch (err) {
        return JSON.stringify({ error: err instanceof Error ? err.message : "Could not create schedule." });
      }
    }

    case "list_schedules": {
      if (!session.userSub) return JSON.stringify({ error: "Not signed in." });
      const mine = await listSchedules(session.userSub);
      return JSON.stringify({
        schedules: mine.map((x) => ({
          id: x.id,
          title: x.title,
          kind: x.kind,
          cadence: x.cadence,
          active: x.active,
          allow_order: x.allowOrder,
          next_run_sl: new Date(x.nextRun).toLocaleString("en-GB", { timeZone: "Asia/Colombo" }),
          last_result: x.lastResult?.slice(0, 120),
        })),
      });
    }

    case "cancel_schedule": {
      if (!session.userSub) return JSON.stringify({ error: "Not signed in." });
      const ok = await cancelSchedule(session.userSub, String(input.id ?? ""));
      return JSON.stringify(ok ? { cancelled: true } : { error: "No schedule with that id." });
    }

    case "create_card": {
      const occ = String(input.occasion ?? "").toLowerCase();
      const theme =
        occ.includes("vesak") || occ.includes("poson") ? { glyph: "🏮", from: "#1e2a4a", to: "#0f1830" }
        : occ.includes("avurudu") || occ.includes("new year") ? { glyph: "🌅", from: "#7a3d1f", to: "#3a1c0e" }
        : occ.includes("deepavali") || occ.includes("diwali") ? { glyph: "🪔", from: "#6b3a10", to: "#2e1806" }
        : occ.includes("christmas") ? { glyph: "🎄", from: "#14382a", to: "#081c14" }
        : occ.includes("esala") || occ.includes("perahera") ? { glyph: "🐘", from: "#3A2868", to: "#1c1236" }
        : occ.includes("love") || occ.includes("valentine") ? { glyph: "❤️", from: "#5c1f35", to: "#2a0d18" }
        : { glyph: "🎂", from: "#3A2868", to: "#241740" };
      emit({
        type: "greeting_card",
        to: String(input.to ?? "").slice(0, 40),
        message: String(input.message ?? "").slice(0, 140),
        from: input.from ? String(input.from).slice(0, 40) : undefined,
        glyph: theme.glyph,
        color_from: theme.from,
        color_to: theme.to,
      });
      return JSON.stringify({ rendered: true, note: "Card shown with download & share buttons. Tell them they can attach the message to the order too." });
    }

    case "say": {
      const text = String(input.text ?? "").slice(0, 800);
      if (text) emit({ type: "speech", text });
      return JSON.stringify({ ok: true });
    }

    case "suggest_replies": {
      const chips = (input.chips as string[]).slice(0, 4);
      emit({ type: "chips", chips });
      return JSON.stringify({ shown: chips });
    }

    default:
      return JSON.stringify({ error: `Unknown tool: ${name}` });
  }
}
