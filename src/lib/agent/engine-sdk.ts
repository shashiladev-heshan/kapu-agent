// Claude Agent SDK engine — drives the same Kapu tools through the Claude
// Code harness. This engine accepts Claude SUBSCRIPTION auth tokens
// (CLAUDE_CODE_OAUTH_TOKEN / ANTHROPIC_AUTH_TOKEN), which the raw Messages
// API rejects — ideal for local dev on a Claude plan. The Messages API
// engine (loop.ts) remains the recommended path for the hosted demo.

import { createSdkMcpServer, query, tool } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import { buildTurnContext, KAPU_SYSTEM_PROMPT } from "@/lib/agent/system-prompt";
import { executeTool } from "@/lib/agent/tools";
import { saveSession, trimHistory, type Session } from "@/lib/session/store";
import type { StreamEvent } from "@/lib/types";

const MODEL = process.env.KAPU_MODEL || "claude-sonnet-4-6";

const TOOL_LABELS: Record<string, string> = {
  search_products: "Searching Kapruka…",
  get_product: "Checking the details…",
  compare_products: "Comparing options…",
  list_categories: "Browsing categories…",
  resolve_city: "Finding your city…",
  check_delivery: "Checking delivery…",
  cart_update: "Updating your basket…",
  view_cart: "Opening your basket…",
  propose_order: "Preparing your order summary…",
  create_order: "Placing your order…",
  track_order: "Tracking your order…",
  remember_recipient: "Remembering them…",
  get_recipients: "Checking your people…",
  forget_recipient: "Forgetting…",
  save_occasion: "Saving the date…",
  get_upcoming_occasions: "Checking your calendar…",
  get_my_orders: "Looking at your orders…",
  create_schedule: "Setting up your standing wish…",
  list_schedules: "Checking your schedules…",
  cancel_schedule: "Cancelling…",
  create_card: "Designing your card…",
  suggest_replies: "…",
};

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
    send({ type: "tool", name, status: "start", label: TOOL_LABELS[name] });
    try {
      const result = await executeTool(name, args, session, (block) => send({ type: "block", block }));
      return { content: [{ type: "text" as const, text: result }] };
    } catch (err) {
      return {
        content: [
          { type: "text" as const, text: `Tool failed: ${err instanceof Error ? err.message : String(err)}` },
        ],
        isError: true,
      };
    } finally {
      send({ type: "tool", name, status: "end" });
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
          min_price: z.number().optional(),
          max_price: z.number().optional(),
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
      tool("list_categories", "List Kapruka top-level categories (cached).", {}, run("list_categories")),
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
          kind: z.enum(["task", "watch_order"]).optional(),
          order_number: z.string().optional(),
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
      if (msg.subtype !== "success") {
        send({
          type: "error",
          message: "Aiyo, I hit a snag mid-thought 💔 — please try that again.",
        });
      }
    }
  }

  if (finalText) session.messages.push({ role: "assistant", content: finalText });
  saveSession(session);
  send({ type: "done" });
}
