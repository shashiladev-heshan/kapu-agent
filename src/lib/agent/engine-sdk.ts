// Claude Agent SDK engine — drives the same Kapu tools through the Claude
// Code harness. This engine accepts Claude SUBSCRIPTION auth tokens
// (CLAUDE_CODE_OAUTH_TOKEN / ANTHROPIC_AUTH_TOKEN), which the raw Messages
// API rejects — ideal for local dev on a Claude plan. The Messages API
// engine (loop.ts) remains the recommended path for the hosted demo.

import { createSdkMcpServer, query, tool } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import { TOOL_LABELS, stepFor } from "@/lib/agent/steps";
import { buildTurnContext, KAPU_SYSTEM_PROMPT } from "@/lib/agent/system-prompt";
import { executeTool } from "@/lib/agent/tools";
import { startGeneration, startToolSpan, truncate, usageDetails } from "@/lib/obs/langfuse";
import { saveSession, trimHistory, type Session } from "@/lib/session/store";
import type { StreamEvent } from "@/lib/types";

const MODEL = process.env.KAPU_MODEL || "claude-sonnet-4-6";

function ensureSdkCredentials() {
  // The Claude Code harness reads CLAUDE_CODE_OAUTH_TOKEN; map our generic
  // ANTHROPIC_AUTH_TOKEN to it, and clear empty env lines that would shadow
  // real credentials.
  if (process.env.ANTHROPIC_API_KEY !== undefined && !process.env.ANTHROPIC_API_KEY.trim()) {
    delete process.env.ANTHROPIC_API_KEY;
  }
  if (!process.env.CLAUDE_CODE_OAUTH_TOKEN?.trim() && process.env.ANTHROPIC_AUTH_TOKEN?.trim()) {
    process.env.CLAUDE_CODE_OAUTH_TOKEN = process.env.ANTHROPIC_AUTH_TOKEN.trim();
  }
  if (process.env.ANTHROPIC_AUTH_TOKEN !== undefined) {
    // Avoid the CLI seeing both styles at once.
    delete process.env.ANTHROPIC_AUTH_TOKEN;
  }
}

function buildKapuServer(session: Session, send: (e: StreamEvent) => void) {
  const run = (name: string) => async (args: Record<string, unknown>) => {
    send({ type: "tool", name, status: "start", label: TOOL_LABELS[name], detail: stepFor(name, args) ?? undefined });
    const toolSpan = startToolSpan(name, args);
    let failed = false;
    try {
      const result = await executeTool(name, args, session, (block) => send({ type: "block", block }));
      toolSpan?.update({ output: truncate(result) }).end();
      return { content: [{ type: "text" as const, text: result }] };
    } catch (err) {
      failed = true;
      const text = `Tool failed: ${err instanceof Error ? err.message : String(err)}`;
      toolSpan?.update({ output: text, level: "ERROR", statusMessage: text.slice(0, 500) }).end();
      return {
        content: [{ type: "text" as const, text }],
        isError: true,
      };
    } finally {
      send({ type: "tool", name, status: "end", ...(failed ? { error: true } : {}) });
    }
  };

  return createSdkMcpServer({
    name: "kapu",
    version: "1.0.0",
    tools: [
      tool(
        "search_products",
        "Search the Kapruka catalog by keywords with filters. Renders a visual product grid automatically. Use whenever the user wants to find/browse/buy anything; refine queries instead of paginating. Translate Sinhala/Tamil intents to English product terms.",
        {
          q: z.string().min(3).max(200).describe("Search keywords in English"),
          category: z.string().optional().describe("e.g. Electronic, Grocery, Pharmacy, Fashion, cakes, flowers"),
          min_price: z.number().optional().describe("In LKR (convert a foreign-currency budget first — rate in context)"),
          max_price: z.number().optional().describe("In LKR (convert a foreign-currency budget first — rate in context)"),
          sort: z.enum(["relevance", "price_asc", "price_desc", "newest", "bestseller"]).optional(),
          in_stock_only: z.boolean().optional(),
          limit: z.number().optional().describe("1-20, default 8"),
          title: z.string().optional().describe("Short heading for the product grid, in the user's language"),
        },
        run("search_products")
      ),
      tool(
        "get_product",
        "Full details for one product (price, stock, variants, shipping). Renders a hero card with image gallery.",
        { product_id: z.string() },
        run("get_product")
      ),
      tool(
        "compare_products",
        "Side-by-side comparison of 2-4 products — renders a visual comparison grid. ALWAYS use when the user is choosing between options.",
        { product_ids: z.array(z.string()).min(2).max(4) },
        run("compare_products")
      ),
      tool(
        "crown_pick",
        "Move the on-screen KAPU'S PICK badge to the product YOUR verdict recommends. Call whenever your final recommendation differs from the pick:true item in the last search results.",
        { product_id: z.string() },
        run("crown_pick")
      ),
      tool(
        "get_hot_deals",
        "Today's REAL discounts from kapruka.com's live promotions page. Renders a product grid with SAVE % badges. Call whenever the user asks for offers/deals/discounts/promotions/sale.",
        {},
        run("get_hot_deals")
      ),
      tool(
        "import_product",
        "Quote importing a product from Amazon to Sri Lanka via Kapruka's Global Shop freight service (SL has no direct Amazon delivery). Call when the user pastes an amazon.com/amazon.in/a.co link or asks to get/import/ship something from Amazon or abroad. Renders a landed-cost card (item + shipping + duties + Kapruka fee, in LKR) plus local Kapruka alternatives to compare. Pass a category word (e.g. 'laptop','bluetooth speaker','watch') to set the customs code. Only Amazon quotes inline; eBay/other return a handoff link.",
        {
          url: z.string().describe("Product URL — amazon.com / amazon.in / a.co short link"),
          category: z.string().optional().describe("Category for the customs/HS code, e.g. 'laptop','bluetooth speaker','watch'"),
          shipping: z.enum(["Air", "Sea"]).optional().describe("Default Air (7-10 days); Sea is slower/cheaper for heavy items"),
        },
        run("import_product")
      ),
      tool(
        "kapruka_help",
        "Search Kapruka's OWN knowledge base (crawled live from kapruka.com: delivery & shipping policies, returns/refunds, payments & instalments, warranties, privacy/terms, company story, contact/office info, corporate services, category FAQs). Use for ANY question about Kapruka itself rather than about products. Answer from the returned excerpts and cite the source url as a markdown link. Never guess policies.",
        { question: z.string().min(3).max(300).describe("The user's question about Kapruka, in English") },
        run("kapruka_help")
      ),
      tool(
        "get_recommendations",
        "Personalized 'picked for you' products from THIS user's taste profile (vector similarity over what they searched/opened/carted). Pass product_id for 'more like this'. Renders a product grid automatically. If it returns too_little_signal, search normally instead.",
        {
          product_id: z.string().optional().describe("Optional — recommend items similar to this product"),
          title: z.string().optional().describe("Grid heading in the user's language"),
        },
        run("get_recommendations")
      ),
      tool(
        "list_categories",
        "List Kapruka's full category tree AND render a visual tappable category explorer for the user. Call when they ask 'what can I buy here?' / want to browse. Use children as plain search KEYWORDS — category facets often return 0.",
        {},
        run("list_categories")
      ),
      tool(
        "resolve_city",
        "Resolve a possibly misspelled/vernacular city name to canonical deliverable Kapruka cities. Use BEFORE check_delivery or create_order.",
        { query: z.string() },
        run("resolve_city")
      ),
      tool(
        "check_delivery",
        "Delivery feasibility + flat rate for a canonical city/date (one flat rate per order regardless of item count). Renders a delivery card.",
        {
          city: z.string().describe("Canonical city from resolve_city"),
          delivery_date: z.string().optional().describe("YYYY-MM-DD; omit for today (SL time)"),
          product_id: z.string().optional().describe("Pass a cake/flower id to surface perishable warnings"),
        },
        run("check_delivery")
      ),
      tool(
        "cart_update",
        "Add/change/remove a cart item (quantity=0 removes; icing_text for cakes only, ≤120 chars). Cart UI updates automatically.",
        {
          product_id: z.string(),
          quantity: z.number().describe("Desired total quantity; 0 removes"),
          icing_text: z.string().optional(),
        },
        run("cart_update")
      ),
      tool("view_cart", "Show the current cart with totals.", {}, run("view_cart")),
      tool(
        "propose_order",
        "Render the pre-checkout ORDER SUMMARY card (basket items + recipient + delivery + verified flat rate) with a 'Yes — place the order' button. Call INSTEAD of writing a text summary once recipient name/phone/address/city/date are known. The user must still explicitly confirm before create_order.",
        {
          recipient_name: z.string(),
          recipient_phone: z.string(),
          address: z.string().min(3).max(250),
          city: z.string(),
          delivery_date: z.string().describe("YYYY-MM-DD"),
          location_type: z.enum(["house", "apartment", "office", "other"]).optional(),
          instructions: z.string().optional(),
          sender_name: z.string().optional(),
          anonymous: z.boolean().optional(),
          gift_message: z.string().max(300).optional(),
        },
        run("propose_order")
      ),
      tool(
        "create_order",
        "Create the Kapruka guest-checkout order from the CURRENT CART and return a pay link (prices locked ~60 min). ONLY after the user explicitly confirmed a full order summary. Never invent recipient details.",
        {
          recipient_name: z.string(),
          recipient_phone: z.string(),
          address: z.string().min(3).max(250),
          city: z.string(),
          location_type: z.enum(["house", "apartment", "office", "other"]).optional(),
          delivery_date: z.string().describe("YYYY-MM-DD"),
          instructions: z.string().optional(),
          sender_name: z.string(),
          anonymous: z.boolean().optional().describe("Surprise mode — hide sender from recipient"),
          gift_message: z.string().max(300).optional(),
          confirmed: z.boolean().describe("MUST be true, only after explicit user confirmation"),
        },
        run("create_order")
      ),
      tool(
        "track_order",
        "Track an order by the order number Kapruka EMAILED after payment (not the pre-payment order_ref). Renders a visual timeline.",
        { order_number: z.string() },
        run("track_order")
      ),
      tool(
        "remember_recipient",
        "Save/update a person the user sends things to. ONLY after explicit user consent ('shall I remember?' → yes). Signed-in = synced; guest = this device.",
        {
          name: z.string().describe("How the user calls them, e.g. 'Amma'"),
          relationship: z.string().optional(),
          phone: z.string().optional(),
          address: z.string().optional(),
          city: z.string().optional().describe("Canonical deliverable city"),
          notes: z.string().optional().describe("Preferences/dietary"),
        },
        run("remember_recipient")
      ),
      tool(
        "get_recipients",
        "List saved people with full details — prefill delivery when the user says 'send it to Amma'; confirm briefly instead of re-asking.",
        {},
        run("get_recipients")
      ),
      tool("forget_recipient", "Delete a saved person (and their occasions) on request.", { name: z.string() }, run("forget_recipient")),
      tool(
        "save_occasion",
        "Remember an occasion for a saved person — ONLY after the user agrees. date: YYYY-MM-DD or MM-DD (yearly).",
        {
          recipient: z.string(),
          type: z.string().describe("e.g. birthday, anniversary"),
          date: z.string().describe("YYYY-MM-DD or MM-DD"),
          recurring: z.boolean().optional(),
        },
        run("save_occasion")
      ),
      tool("get_upcoming_occasions", "Saved occasions in the next ~60 days with days-until.", {}, run("get_upcoming_occasions")),
      tool(
        "get_my_orders",
        "Recent Kapu orders (items, recipient, city, date) — for 'order again' and avoiding repeat gifts.",
        {},
        run("get_my_orders")
      ),
      tool(
        "create_schedule",
        "Create a standing wish that runs autonomously (signed-in users only; restate plan + get a yes; ask about allow_order).",
        {
          title: z.string(),
          instruction: z.string(),
          kind: z.enum(["task", "watch_order", "watch_price"]).optional(),
          order_number: z.string().optional(),
          product_id: z.string().optional().describe("watch_price only — alerts on a ≥2% drop, then stops"),
          cadence_kind: z.enum(["once", "daily", "weekly", "monthly", "yearly"]),
          at: z.string().optional().describe("HH:mm SL time"),
          date: z.string().optional().describe("once: YYYY-MM-DD · yearly: MM-DD"),
          weekday: z.number().optional(),
          day: z.number().optional(),
          allow_order: z.boolean().optional(),
        },
        run("create_schedule")
      ),
      tool("list_schedules", "List the user's standing schedules.", {}, run("list_schedules")),
      tool("cancel_schedule", "Cancel a schedule by id.", { id: z.string() }, run("cancel_schedule")),
      tool(
        "create_card",
        "Render a downloadable/shareable festival or occasion greeting card (perfect Sinhala/Tamil script). Use when a gift message is set or a card is requested.",
        {
          to: z.string(),
          message: z.string().max(140),
          from: z.string().optional(),
          occasion: z.string().optional(),
        },
        run("create_card")
      ),
      tool(
        "design_cake",
        "Open Kapu's CAKE STUDIO — live cake-designer canvas (flavour palette, style, icing piped live, AI icing suggestions) plus real matching Kapruka cakes to add with that icing. Use for design/personalise/occasion-cake intents, not plain browsing.",
        {
          occasion: z.string().optional(),
          flavour: z.string().optional().describe("chocolate | vanilla | ribbon | red velvet | butterscotch | coffee — free text ok"),
          style: z.enum(["classic", "playful", "elegant", "festive"]).optional(),
          icing_text: z.string().optional().describe("≤40 chars, any script"),
          to: z.string().optional(),
          max_price: z.number().optional().describe("LKR budget cap for real-cake matches"),
          title: z.string().optional(),
        },
        run("design_cake")
      ),
      tool(
        "account_profile",
        "Look up the customer's Kapruka account profile (name/email/language) to greet a returning customer by name + prefill checkout. ONLY with an email they TYPED this chat — never guess. Once linked, account_orders/account_addresses need no email.",
        { email: z.string().optional() },
        run("account_profile")
      ),
      tool(
        "account_orders",
        "The customer's real Kapruka order history (refs, status, dates, recipients, items + product IDs) — 'where's my order?', 'what did I buy?', one-tap reorder. A row's ref → track_order; item IDs → cart_update. Needs the linked account or a customer-typed email.",
        { email: z.string().optional(), limit: z.number().optional() },
        run("account_orders")
      ),
      tool(
        "account_addresses",
        "The customer's saved Kapruka delivery addresses (book + recents) — 'send to my home/office' at checkout; prefill propose_order from the pick. Needs the linked account or a customer-typed email.",
        { email: z.string().optional() },
        run("account_addresses")
      ),
      tool(
        "render_picks",
        "Render 1-4 products as ONE shareable image card (photo + numbered badge + name + price) for WhatsApp/sharing. Assign a unique ref per product.",
        { items: z.array(z.object({ product_id: z.string(), ref: z.number() })).min(1).max(4) },
        run("render_picks")
      ),
      tool(
        "say",
        "VOICE MODE ONLY (mode: voice in context). The exact text the voice engine should SPEAK for this reply — short natural sentences, no formatting, prices in words; for Sinhala conversations use ROMANIZED colloquial Sinhala. Call exactly once, after your reply text.",
        { text: z.string().describe("The speakable version, 1-3 short sentences") },
        run("say")
      ),
      tool(
        "suggest_replies",
        "Show 2-4 tappable quick-reply chips for likely next steps, in the user's language. Use at decision points.",
        { chips: z.array(z.string()).min(2).max(4) },
        run("suggest_replies")
      ),
    ],
  });
}

const KAPU_TOOL_NAMES = [
  "search_products",
  "get_product",
  "compare_products",
  "get_recommendations",
  "get_hot_deals",
  "import_product",
  "crown_pick",
  "list_categories",
  "resolve_city",
  "check_delivery",
  "cart_update",
  "view_cart",
  "propose_order",
  "create_order",
  "track_order",
  "remember_recipient",
  "get_recipients",
  "forget_recipient",
  "save_occasion",
  "get_upcoming_occasions",
  "get_my_orders",
  "create_schedule",
  "list_schedules",
  "cancel_schedule",
  "create_card",
  "design_cake",
  "account_profile",
  "account_orders",
  "account_addresses",
  "render_picks",
  "say",
  "suggest_replies",
].map((t) => `mcp__kapu__${t}`);

const BUILTIN_TOOLS_OFF = [
  "Bash", "Read", "Write", "Edit", "Glob", "Grep", "WebFetch", "WebSearch",
  "Task", "TodoWrite", "NotebookEdit", "KillShell", "BashOutput",
];

export async function runTurnSdk(
  session: Session,
  userMessage: string,
  send: (event: StreamEvent) => void
): Promise<void> {
  ensureSdkCredentials();

  const prompt = `${await buildTurnContext(session)}\n${userMessage}`;

  // History lives in the SDK's session transcript; we keep our own copy only
  // for engine fallback continuity.
  session.messages.push({ role: "user", content: prompt });
  trimHistory(session);

  const q = query({
    prompt,
    options: {
      model: MODEL,
      systemPrompt: KAPU_SYSTEM_PROMPT,
      mcpServers: { kapu: buildKapuServer(session, send) },
      allowedTools: KAPU_TOOL_NAMES,
      disallowedTools: BUILTIN_TOOLS_OFF,
      permissionMode: "bypassPermissions",
      includePartialMessages: true,
      maxTurns: 16,
      stderr: (data: string) => {
        if (data.trim()) console.error("[sdk-cli]", data.trim().slice(0, 500));
      },
      ...(session.sdkSessionId ? { resume: session.sdkSessionId } : {}),
    },
  });

  // The real model calls happen inside the Claude Code subprocess, so we can't
  // observe them individually — this one generation carries the harness's
  // aggregate usage/cost from the final `result` message. (The API engine in
  // loop.ts traces every call; that's the hosted-demo path.)
  const generation = startGeneration(`claude-code-harness:${MODEL}`, {
    model: MODEL,
    input: prompt,
    modelParameters: { max_turns: 16 },
  });

  let finalText = "";
  for await (const msg of q) {
    if (msg.type === "system" && msg.subtype === "init") {
      session.sdkSessionId = msg.session_id;
    } else if (msg.type === "stream_event") {
      const ev = msg.event as { type: string; delta?: { type: string; text?: string } };
      if (ev.type === "content_block_delta" && ev.delta?.type === "text_delta" && ev.delta.text) {
        finalText += ev.delta.text;
        send({ type: "text", delta: ev.delta.text });
      }
    } else if (msg.type === "result") {
      generation?.update({
        output: finalText,
        usageDetails: usageDetails(msg.usage),
        costDetails: { total: msg.total_cost_usd },
        metadata: { subtype: msg.subtype, num_turns: msg.num_turns, duration_ms: msg.duration_ms },
        ...(msg.subtype !== "success" ? { level: "ERROR", statusMessage: msg.subtype } : {}),
      });
      if (msg.subtype !== "success") {
        send({
          type: "error",
          message: "Aiyo, I hit a snag mid-thought 💔 — please try that again.",
        });
      }
    }
  }
  generation?.end();

  if (finalText) session.messages.push({ role: "assistant", content: finalText });
  saveSession(session);
  send({ type: "done" });
}
