// Kapu's tool surface. Each executor calls the Kapruka MCP through the
// shield, returns a COMPACT JSON string for the model, and emits rich
// UiBlocks for the frontend as a side channel.

import type Anthropic from "@anthropic-ai/sdk";
import { cakeFlavour, cakeStyle, occasionGlyph } from "@/lib/cake";
import { writeGiftMessages } from "@/lib/gift/writer";
import { kapruka, parseJson, accountToolsReady } from "@/lib/kapruka/shield";
import { getHotDeals } from "@/lib/kapruka/promos";
import { importQuote, isAmazonUrl } from "@/lib/kapruka/globalshop";
import { resolveAccountEmail, sniffError, normalizeCustomer, normalizeOrders, normalizeAddresses } from "@/lib/kapruka/account";
import { applyCartUpdate, cartSubtotal } from "@/lib/kapruka/cart";
import { categoryName, money, toDetail, toSummary } from "@/lib/kapruka/normalize";
import { listOrders, markBridgeGranted, recordOrder } from "@/lib/db/mongo";
import { forgetRecipient, listPeople, rememberOccasion, rememberRecipient, upcomingOccasions } from "@/lib/agent/memory";
import { queryKb } from "@/lib/kb/store";
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
        min_price: { type: "number", description: "In LKR (convert a foreign-currency budget first — rate in context)" },
        max_price: { type: "number", description: "In LKR (convert a foreign-currency budget first — rate in context)" },
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
    name: "import_product",
    description:
      "Quote importing a product from Amazon to Sri Lanka via Kapruka's Global Shop freight service (SL has no direct Amazon delivery). Call when the user pastes an amazon.com / amazon.in / a.co link, OR asks to get/import/ship something from Amazon or abroad. Renders a card with the REAL landed cost in LKR (item + shipping + duties + Kapruka fee) plus local Kapruka alternatives to compare. Pass a category word (e.g. 'laptop', 'bluetooth speaker', 'watch') when you can tell — it sets the customs code. Only Amazon quotes inline; eBay/other sites return a handoff link (say so honestly).",
    input_schema: {
      type: "object",
      properties: {
        url: { type: "string", description: "The product URL — amazon.com / amazon.in / a.co short link" },
        category: { type: "string", description: "Product category for the customs/HS code, e.g. 'laptop', 'bluetooth speaker', 'watch', 'shoes'" },
        shipping: { type: "string", enum: ["Air", "Sea"], description: "Default Air (7-10 days). Sea is slower and cheaper mainly for heavy items." },
      },
      required: ["url"],
    },
  },
  {
    name: "kapruka_help",
    description:
      "Search Kapruka's OWN knowledge base (crawled live from kapruka.com: delivery & shipping policies, returns/refunds, payments & instalments, warranties, privacy/terms, company story, contact/office info, corporate services, category FAQs). Use for ANY question about Kapruka itself rather than about products. Answer from the returned excerpts and cite the source url as a markdown link. Never guess policies.",
    input_schema: {
      type: "object",
      properties: {
        question: { type: "string", description: "The user's question about Kapruka, in English, e.g. 'how long do refunds take?'" },
      },
      required: ["question"],
    },
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
      "Create a standing wish that runs AUTONOMOUSLY on a schedule (signed-in users only — check signed_in in context). Restate the plan and get a yes first. Results go to the user's linked Telegram/WhatsApp (or the web bell). kind 'watch_order' polls an order until delivered — and keeps watching for the delivery-proof photo.",
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
    name: "design_cake",
    description:
      "Open Kapu's CAKE STUDIO — a live, interactive cake-designer canvas. Call when the user wants to design/personalise/customise a cake or asks for cake ideas for an occasion ('cake for Amma's birthday', 'design me an avurudu cake') — NOT for plain browsing (that's search_products). Renders a designable cake preview (flavour palette, style, icing text piped live on the cake, AI icing suggestions) PLUS real matching Kapruka cakes the user can add with that icing in one tap. Pass whatever they specified; smart defaults fill the rest.",
    input_schema: {
      type: "object",
      properties: {
        occasion: { type: "string", description: "e.g. 'birthday', 'anniversary', 'valentine', 'avurudu', 'graduation'" },
        flavour: { type: "string", description: "chocolate | vanilla | ribbon | red velvet | butterscotch | coffee (free text ok — fuzzy-matched)" },
        style: { type: "string", enum: ["classic", "playful", "elegant", "festive"] },
        icing_text: { type: "string", description: "Text to pipe on the cake, ≤40 chars, any script" },
        to: { type: "string", description: "Who it's for, e.g. 'Amma' — personalises the icing suggestions" },
        max_price: { type: "number", description: "Budget cap in LKR for the real-cake matches" },
        title: { type: "string", description: "Short heading above the studio, in the user's language" },
      },
    },
  },
  {
    name: "account_profile",
    description:
      "Look up the customer's Kapruka ACCOUNT profile (name, email, language) to greet a returning customer BY NAME and prefill checkout. ONLY call with an email the CUSTOMER TYPED in this chat — never guess or loop. Once linked, later account_orders / account_addresses need no email. Renders a recognition card.",
    input_schema: {
      type: "object",
      properties: {
        email: { type: "string", description: "The email on their Kapruka account — ONLY if they typed it this conversation (omit to use the already-linked account)" },
      },
    },
  },
  {
    name: "account_orders",
    description:
      "The customer's real KAPRUKA order history (references, status, dates, recipients, items with product IDs) — for 'where's my order?', 'what did I buy last time?', and one-tap reorder. Renders an order-history card; a row's reference tracks via track_order; item product IDs rebuild the basket via cart_update. Different from get_my_orders (which is Kapu-placed orders only). Needs the linked account or a customer-typed email.",
    input_schema: {
      type: "object",
      properties: { email: { type: "string" }, limit: { type: "number", description: "1-20, default 5" } },
    },
  },
  {
    name: "account_addresses",
    description:
      "The customer's saved KAPRUKA delivery addresses (address book + recent recipients). Use at checkout so they can say 'send it to my home / office' instead of typing — then prefill propose_order from the chosen one. Renders a tappable address picker. Needs the linked account or a customer-typed email.",
    input_schema: { type: "object", properties: { email: { type: "string" } } },
  },
  {
    name: "render_picks",
    description:
      "Render 1-4 products as ONE shareable image 'menu' card (each photo with a numbered badge + name + price) — perfect for WhatsApp/sharing or presenting a shortlist visually. Assign a unique ref number (1-99) per product.",
    input_schema: {
      type: "object",
      properties: {
        items: {
          type: "array",
          minItems: 1,
          maxItems: 4,
          items: { type: "object", properties: { product_id: { type: "string" }, ref: { type: "number", description: "1-99, unique per card" } }, required: ["product_id", "ref"] },
        },
      },
      required: ["items"],
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
  // Canonical LKR: the MCP will convert when asked, but its rates drift from
  // the display rates (/api/fx) — so prices are fetched, stored and totalled
  // in LKR only. The client converts for display; the agent gets a rate hint
  // in turn context to speak the user's currency.
  const currency = "LKR";

  switch (name) {
    case "search_products": {
      const query = String(input.q ?? "").slice(0, 200);
      const searchArgs = (withCategory: boolean) => ({
        q: query,
        ...(withCategory && input.category ? { category: input.category } : {}),
        ...(input.min_price != null ? { min_price: input.min_price } : {}),
        ...(input.max_price != null ? { max_price: input.max_price } : {}),
        ...(input.sort ? { sort: input.sort } : {}),
        ...(input.in_stock_only != null ? { in_stock_only: input.in_stock_only } : {}),
        limit: Math.min(Number(input.limit) || 8, 20),
        currency,
      });
      const listOf = (r: Record<string, unknown>) =>
        (r.products ?? r.results ?? r.items ?? []) as Record<string, unknown>[];

      let res = parseJson(await kapruka("kapruka_search_products", searchArgs(true)));
      let rawList = listOf(res);
      // The category facet returns 0 even when the catalog plainly has matches
      // (verified 9 Aug 2026: category="cakes" → 0 while the same q without it
      // → cakes). Drop the facet and retry in place rather than let the model
      // burn a whole round-trip re-searching — same recovery idiom as the
      // get_product fallback chain.
      if (!rawList.length && input.category) {
        res = parseJson(await kapruka("kapruka_search_products", searchArgs(false)));
        rawList = listOf(res);
      }
      const products = rawList.map((p) => toSummary(p, currency));
      // KAPU'S PICK = the result that semantically MATCHES the query, not
      // blind rank 0 — Kapruka ranks accessories above the thing itself
      // ("phone" → car chargers first). Cosine via the taste-engine
      // embeddings, ≤900ms, falling back to rank order.
      const sort = String(input.sort ?? "relevance");
      // Weak-match guard: Kapruka's keyword search returns same-category
      // siblings, not the thing itself ("webcam" → ink/laptops/stands). If
      // nothing clears a real semantic-match bar, treat it as a no-result so the
      // reply stays honest instead of mislabelling junk as what was asked for.
      let weakMatch = false;
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
        // cosine of the BEST result — if even the top hit is weakly related, the
        // catalog doesn't carry the thing (tuned low to avoid hiding real hits).
        if (scores) weakMatch = Math.max(...eligible.map((i) => scores[i])) < 0.33;
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
      if (products.length > 0 && !weakMatch) {
        emit({ type: "product_grid", title: typeof input.title === "string" ? input.title : undefined, products });
      } else {
        emit({ type: "no_results", query });
      }
      // taste engine: index what was shown; the query itself is intent; the top
      // hits count as a light (0.5) per-user signal. On a weak match nothing was
      // shown, so skip the per-user "seen" signal (don't pollute recs with
      // off-type junk) — still embed for future scoring + record the intent.
      void recoSeen(products).catch(() => {});
      if (!weakMatch)
        void (async () => {
          for (const p of products.slice(0, 6)) await recoProductEvent([session.userSub, session.id], p, 0.5);
        })().catch(() => {});
      void recoQueryEvent([session.userSub, session.id], query).catch(() => {});
      if (weakMatch)
        return JSON.stringify({
          count: 0,
          weak_match: true,
          note: `Kapruka returned items but NONE actually match "${query}" — its search surfaces same-category siblings (search "webcam" → ink/laptops/stands). Treat this as NOT FOUND: tell the user honestly you couldn't find "${query}" right now, do NOT present these as "${query}", and offer to try different words or a real alternative you can name.`,
        });
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

    case "import_product": {
      const url = String(input.url ?? "").trim();
      const shipping = input.shipping === "Sea" ? "Sea" : "Air";
      if (!url) return JSON.stringify({ error: "A product URL is required." });
      if (!isAmazonUrl(url)) {
        // eBay & other sites can't be quoted inline (verified: Kapruka only
        // server-fetches Amazon) — hand off honestly instead of faking a price.
        return JSON.stringify({
          cannot_quote_inline: true,
          shop: /ebay\./i.test(url) ? "ebay" : "other",
          handoff_url: "https://www.kapruka.com/globalshop/price_check_auto.jsp",
          note: "Only Amazon links get a live in-chat quote. Tell the user honestly you can't fetch an eBay/other-site landed cost here, share the Global Shop link to check it there, and offer to find a local Kapruka alternative meanwhile (search the catalog).",
        });
      }
      const quote = await importQuote(url, typeof input.category === "string" ? input.category : undefined, shipping);
      if ("error" in quote) {
        return JSON.stringify({
          error: quote.error,
          handoff_url: quote.handoff_url,
          note: "Couldn't get a live quote. Share the Global Shop link so they can check it on Kapruka, and offer a local alternative — NEVER invent an import price.",
        });
      }
      // local-vs-import — the honest differentiator. Show a grid of local
      // matches (relevance-ranked so a real counterpart leads, not the cheapest
      // accessory) and hand the model the top options with names+prices so IT
      // judges the true comparable. Best-effort: never fail the quote for it.
      let localOptions: { name: string; price: number | null }[] = [];
      try {
        // A clean catalog query beats the raw Amazon title (drops the "Amazon"
        // brand, "(newest model)" parentheticals and punctuation).
        const q =
          (typeof input.category === "string" && input.category.trim()) ||
          quote.product_name
            .replace(/\bamazon\b/gi, " ")
            .replace(/\([^)]*\)/g, " ")
            .replace(/[^a-z0-9\s]/gi, " ")
            .split(/\s+/)
            .filter((w) => w.length > 1)
            .slice(0, 3)
            .join(" ");
        const res = parseJson(await kapruka("kapruka_search_products", { q, limit: 8, in_stock_only: true, currency }));
        let locals = ((res.products ?? res.results ?? res.items ?? []) as Record<string, unknown>[])
          .map((p) => toSummary(p, currency))
          .filter((p) => p.price != null);
        if (locals.length) {
          const scores = locals.length > 1 ? await queryMatchScores(q, locals).catch(() => null) : null;
          if (scores) {
            const order = locals.map((_, i) => i).sort((a, b) => scores[b] - scores[a]);
            const top = scores[order[0]];
            locals = order.filter((i) => scores[i] >= top - 0.18).map((i, rank) => ({ ...locals[i], pick: rank === 0 }));
          }
          emit({ type: "product_grid", title: "Or buy it local on Kapruka 🇱🇰", products: locals.slice(0, 4) });
          void recoSeen(locals).catch(() => {});
          localOptions = locals.slice(0, 3).map((p) => ({ name: p.name, price: p.price }));
        }
      } catch {
        /* local compare is a bonus */
      }
      emit({ type: "import_quote", ...quote });
      return JSON.stringify({
        imported: {
          product: quote.product_name,
          amazon_usd: quote.usd_price,
          landed_lkr: quote.total_lkr,
          breakdown_lkr: { item: quote.item_lkr, shipping_duties_handling: quote.ship_duty_lkr },
          shipping: quote.shipping,
          weight_lb: quote.weight_lb,
          weight_estimated: quote.weight_estimated,
        },
        ...(localOptions.length ? { local_options: localOptions } : {}),
        note: "Landed cost is Kapruka's own estimate, finalised at their Global Shop checkout. Give the honest local-vs-import verdict in ONE line: look at local_options and pick the TRUE comparable (ignore accessories like cooling pads/cases — a cooling pad is not a laptop); if a real equivalent exists, contrast it ('importing ≈ landed_lkr in 7-10 days vs Kapruka SL's <item> at Rs <price>, sooner') and recommend local when it's clearly better value; if none is a genuine match, say Kapruka SL doesn't stock this exact item so importing is the way. Say the import order is placed on Kapruka's Global Shop page (the card links there). If weight_estimated, note the final cost can shift with real weight.",
      });
    }

    case "kapruka_help": {
      const question = String(input.question ?? "").trim();
      if (!question) return JSON.stringify({ error: "question required" });
      const { hits, backend } = await queryKb(question, 5);
      if (!hits.length) {
        return JSON.stringify({
          unavailable: true,
          note: "Knowledge base is unreachable right now — say so honestly, share what you know from your persona facts only if certain, and point them to https://www.kapruka.com/shop/faq or the 24/7 hotline +94 117 551 111.",
        });
      }
      return JSON.stringify({
        backend,
        excerpts: hits,
        note: "Answer ONLY from these excerpts. Cite the most relevant source as a markdown link, e.g. [Kapruka's delivery policy](url). If the excerpts don't cover it, say so and point to the Help Center.",
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
        if (session.bridge) {
          // the wish is granted — mark the bridge so its page shows it,
          // and stop carrying the recipient details on this session
          void markBridgeGranted(session.bridge.id, orderRef).catch(() => {});
          session.bridge = undefined;
        }
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
        const kind = input.kind === "watch_order" ? "watch_order" : input.kind === "watch_price" ? "watch_price" : "task";
        const orderNumber = input.order_number ? String(input.order_number).trim().toUpperCase().slice(0, 40) : undefined;
        // Same idempotency as the Track-modal path: one active watch per order.
        if (kind === "watch_order" && orderNumber) {
          const existing = (await listSchedules(session.userSub)).find(
            (s) => s.kind === "watch_order" && (s.orderNumber ?? "").toUpperCase() === orderNumber && s.active,
          );
          if (existing) {
            return JSON.stringify({
              already_watching: { id: existing.id, title: existing.title },
              note: "This order already has an active watch — no duplicate created. Tell the user alerts are already on.",
            });
          }
        }
        const sched = await createSchedule({
          sub: session.userSub,
          title: String(input.title ?? "").slice(0, 60) || "Standing wish",
          instruction: String(input.instruction ?? "").slice(0, 500),
          kind,
          ...(orderNumber ? { orderNumber } : {}),
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
        const user = await getUser(session.userSub);
        const channels = [user?.tgChatId ? "Telegram" : null, user?.waPhone ? "WhatsApp" : null].filter((c): c is string => Boolean(c));
        return JSON.stringify({
          created: { id: sched.id, title: sched.title, next_run_sl: new Date(sched.nextRun).toLocaleString("en-GB", { timeZone: "Asia/Colombo" }) },
          standing_order_consent: sched.allowOrder,
          alert_channels: channels,
          note: channels.length
            ? `Results will arrive on their ${channels.join(" + ")}.`
            : 'No alert channel linked — suggest linking Telegram or WhatsApp under Standing wishes (send /link to the Telegram bot, or the word "link" to the WhatsApp number, then enter the code shown); until then results land in the web bell.',
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

    case "design_cake": {
      const flavour = cakeFlavour(typeof input.flavour === "string" ? input.flavour : undefined);
      const style = cakeStyle(typeof input.style === "string" ? input.style : undefined);
      const glyph = occasionGlyph(typeof input.occasion === "string" ? input.occasion : undefined);
      const icing = typeof input.icing_text === "string" ? input.icing_text.slice(0, 40).trim() : "";
      const to = typeof input.to === "string" ? input.to.slice(0, 40) : undefined;

      // Real cakes make the design orderable — same search + summary path as
      // search_products, and a studio with no matches still renders.
      let products: ProductSummary[] = [];
      try {
        const res = parseJson(
          await kapruka("kapruka_search_products", {
            q: flavour.q,
            ...(typeof input.max_price === "number" ? { max_price: input.max_price } : {}),
            limit: 8,
            in_stock_only: true,
            currency,
          })
        );
        const rawList = (res.products ?? res.results ?? res.items ?? []) as Record<string, unknown>[];
        products = rawList
          .map((p) => toSummary(p, currency))
          .filter((p) => p.price != null)
          .slice(0, 6);
        void recoSeen(products).catch(() => {});
      } catch {
        /* studio renders without matches */
      }

      // Personalised icing lines (haiku) — a bonus, never a dependency.
      let suggestions: string[] | undefined;
      try {
        const people = await listPeople(session);
        const occs = await upcomingOccasions(session, 45);
        suggestions =
          (await writeGiftMessages({
            name: `${flavour.label} cake${to ? ` for ${to}` : ""}`,
            category: "cakes",
            lang: session.language === "si" || session.language === "ta" ? session.language : "en",
            kind: "icing",
            recipients: people.recipients.slice(0, 6).map((r) => ({ name: r.name, relationship: r.relationship })),
            occasions: occs.map((o) => ({ recipient: o.recipient, type: o.type, in_days: o.in_days })),
            sessionId: session.id,
          })) ?? undefined;
      } catch {
        suggestions = undefined;
      }

      // Remember the design so checkout can pass it to the bakery as a
      // decoration request via the order's real `instructions` field.
      session.cakeDesign = {
        flavour: flavour.label,
        style: style.key,
        ...(typeof input.occasion === "string" ? { occasion: input.occasion.slice(0, 40) } : {}),
        ...(icing ? { icing } : {}),
      };

      emit({
        type: "cake_design",
        title: typeof input.title === "string" ? input.title.slice(0, 60) : undefined,
        occasion: typeof input.occasion === "string" ? input.occasion.slice(0, 40) : undefined,
        glyph,
        flavour: flavour.key,
        style: style.key,
        tiers: style.tiers,
        palette: flavour.palette,
        ...(icing ? { icing_text: icing } : {}),
        ...(to ? { to } : {}),
        ...(suggestions?.length ? { suggestions } : {}),
        products,
      });
      return JSON.stringify({
        studio: { flavour: flavour.key, style: style.key, occasion: input.occasion ?? null, icing_text: icing || null },
        ...(suggestions?.length ? { icing_suggestions: suggestions } : {}),
        matches: products.map(modelView),
        note: "Cake Studio rendered — the user can retheme flavours, edit the piped icing live, and add a real cake WITH that icing in one tap. Keep the reply short; the canvas does the talking.",
      });
    }

    case "account_profile": {
      if (!accountToolsReady()) return JSON.stringify({ error: "Account features aren't configured on this server." });
      const email = resolveAccountEmail(session, typeof input.email === "string" ? input.email : undefined);
      if (!email) return JSON.stringify({ error: "no_email", note: "Ask the customer for the email on their Kapruka account — they must TYPE it. Never guess or loop through emails." });
      const raw = await kapruka("kapruka_customer_details", { email });
      const err = sniffError(raw);
      if (err) return JSON.stringify({ error: err.code ?? "error", message: err.message, note: err.code === "email_not_allowed" ? "No Kapruka account data for that email in this preview — say so gently." : "Say so honestly." });
      const profile = normalizeCustomer(parseJson(raw));
      if (!profile) return JSON.stringify({ error: "no_data" });
      session.account = { email: profile.email || email, name: profile.name };
      emit({ type: "account_card", name: profile.name, email: profile.email || email });
      return JSON.stringify({ linked: true, name: profile.name, email: profile.email || email, language: profile.language, note: "Greet them warmly by FIRST name, once. Their saved orders/addresses are now available via account_orders / account_addresses (no email needed)." });
    }

    case "account_orders": {
      if (!accountToolsReady()) return JSON.stringify({ error: "Account features aren't configured on this server." });
      const email = resolveAccountEmail(session, typeof input.email === "string" ? input.email : undefined);
      if (!email) return JSON.stringify({ error: "no_email", note: "Ask for the email on their Kapruka account (they must type it)." });
      const raw = await kapruka("kapruka_order_history", { email, limit: Math.min(Number(input.limit) || 5, 20) });
      const err = sniffError(raw);
      if (err) return JSON.stringify({ error: err.code ?? "error", message: err.message, note: "Say so honestly." });
      const orders = normalizeOrders(parseJson(raw));
      if (!session.account) session.account = { email };
      // A5: seed the taste engine with what they've actually bought → instant picks
      void (async () => {
        for (const o of orders)
          for (const it of o.items)
            if (it.product_id) await recoProductEvent([session.userSub, session.id], { id: it.product_id, name: it.name, price: it.price_lkr, currency, in_stock: true } as ProductSummary, 2).catch(() => {});
      })().catch(() => {});
      emit({
        type: "account_orders",
        orders: orders.map((o) => ({ ref: o.ref, status: o.status, when: o.when, delivery_date: o.delivery_date, total_lkr: o.total_lkr, recipient: o.recipient, city: o.city, greeting: o.greeting, items: o.items.map((i) => ({ name: i.name, qty: i.qty })) })),
      });
      return JSON.stringify({
        count: orders.length,
        orders: orders.map((o) => ({ ref: o.ref, status: o.status, when: o.when, delivery_date: o.delivery_date, total_lkr: o.total_lkr, recipient: o.recipient, city: o.city, items: o.items.map((i) => `${i.name} ×${i.qty}${i.product_id ? ` (${i.product_id})` : ""}`) })),
        note: "Track any order by passing its ref to track_order. 'Buy again' → cart_update each item by its product_id. Avoid re-suggesting the exact same gift to the same recipient.",
      });
    }

    case "account_addresses": {
      if (!accountToolsReady()) return JSON.stringify({ error: "Account features aren't configured on this server." });
      const email = resolveAccountEmail(session, typeof input.email === "string" ? input.email : undefined);
      if (!email) return JSON.stringify({ error: "no_email", note: "Ask for the email on their Kapruka account (they must type it)." });
      const raw = await kapruka("kapruka_customer_addresses", { email });
      const err = sniffError(raw);
      if (err) return JSON.stringify({ error: err.code ?? "error", message: err.message, note: "Say so honestly." });
      const addresses = normalizeAddresses(parseJson(raw));
      if (!session.account) session.account = { email };
      emit({ type: "address_picker", addresses });
      return JSON.stringify({
        count: addresses.length,
        addresses,
        note: "When they pick one ('send to my home'), prefill propose_order with that recipient name/address/city/phone and confirm briefly — don't re-ask details you now have.",
      });
    }

    case "render_picks": {
      const rawItems = Array.isArray(input.items) ? input.items : [];
      const items = rawItems
        .slice(0, 4)
        .map((it, i) => ({ product_id: String((it as { product_id?: unknown }).product_id ?? ""), ref: Number((it as { ref?: unknown }).ref) || i + 1 }))
        .filter((it) => it.product_id);
      if (items.length === 0) return JSON.stringify({ error: "Pass 1-4 {product_id, ref} items." });
      const raw = await kapruka("kapruka_render_options_card", { items, currency });
      const url = (/(https?:\/\/[^\s"')]+\.(?:jpe?g|png|webp))/i.exec(raw) ?? /(https?:\/\/[^\s"')]+)/.exec(raw))?.[1];
      if (!url) return JSON.stringify({ error: "Couldn't render the card just now.", raw: raw.slice(0, 160) });
      emit({ type: "options_card", image_url: url });
      return JSON.stringify({ rendered: true, image_url: url, note: "A shareable image card of these picks — tell them they can save or share it (great for WhatsApp)." });
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
