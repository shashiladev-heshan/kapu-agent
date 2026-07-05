// Kapu's agent loop: a manual Messages API tool-use loop with streaming.
// Each user turn runs the loop until Claude stops calling tools; text deltas
// and UiBlocks stream to the browser as SSE events via `send`.

import Anthropic from "@anthropic-ai/sdk";
import { buildTurnContext, KAPU_SYSTEM_PROMPT } from "@/lib/agent/system-prompt";
import { TOOL_DEFINITIONS, executeTool } from "@/lib/agent/tools";
import { trimHistory, saveSession, type Session } from "@/lib/session/store";
import type { StreamEvent } from "@/lib/types";

// Keep in sync with engine-sdk.ts — both engines default to the same model.
const MODEL = process.env.KAPU_MODEL || "claude-sonnet-4-6";
const MAX_LOOP_ITERATIONS = 12;

// Supports BOTH credential styles — ANTHROPIC_API_KEY or ANTHROPIC_AUTH_TOKEN.
// Explicit construction so an empty `ANTHROPIC_API_KEY=` line in .env can't
// shadow a real auth token (the API rejects requests carrying both headers).
const apiKey = process.env.ANTHROPIC_API_KEY?.trim() || undefined;
const authToken = process.env.ANTHROPIC_AUTH_TOKEN?.trim() || undefined;
const client = apiKey
  ? new Anthropic({ apiKey, authToken: null })
  : authToken
    ? new Anthropic({ authToken, apiKey: null })
    : new Anthropic(); // falls back to `ant auth login` profile resolution

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
  suggest_replies: "…",
};

// ── engine selection ──────────────────────────────────────────────────
// "api"       → manual Messages API loop (needs ANTHROPIC_API_KEY)
// "agent-sdk" → Claude Agent SDK / Claude Code harness (works with a
//               subscription CLAUDE_CODE_OAUTH_TOKEN / ANTHROPIC_AUTH_TOKEN)
// Default: explicit KAPU_ENGINE, else auto-pick by available credential.
function pickEngine(): "api" | "agent-sdk" {
  const forced = process.env.KAPU_ENGINE;
  if (forced === "api" || forced === "agent-sdk") return forced;
  if (process.env.ANTHROPIC_API_KEY?.trim()) return "api";
  if (process.env.CLAUDE_CODE_OAUTH_TOKEN?.trim() || process.env.ANTHROPIC_AUTH_TOKEN?.trim()) {
    return "agent-sdk";
  }
  return "api";
}

export async function runTurn(
  session: Session,
  userMessage: string,
  send: (event: StreamEvent) => void
): Promise<void> {
  if (pickEngine() === "agent-sdk") {
    const { runTurnSdk } = await import("@/lib/agent/engine-sdk");
    return runTurnSdk(session, userMessage, send);
  }
  return runTurnApi(session, userMessage, send);
}

async function runTurnApi(
  session: Session,
  userMessage: string,
  send: (event: StreamEvent) => void
): Promise<void> {
  // Per-turn context rides in the user turn so the system prompt stays
  // byte-stable and cacheable.
  const turn = `${await buildTurnContext(session)}\n${userMessage}`;

  session.messages.push({ role: "user", content: turn });
  trimHistory(session);

  for (let i = 0; i < MAX_LOOP_ITERATIONS; i++) {
    const stream = client.messages.stream({
      model: MODEL,
      max_tokens: 4096,
      system: [
        {
          type: "text",
          text: KAPU_SYSTEM_PROMPT,
          cache_control: { type: "ephemeral" },
        },
      ],
      tools: TOOL_DEFINITIONS,
      messages: session.messages,
    });

    stream.on("text", (delta) => send({ type: "text", delta }));

    const message = await stream.finalMessage();
    session.messages.push({ role: "assistant", content: message.content });

    if (message.stop_reason === "pause_turn") continue;

    const toolUses = message.content.filter(
      (b): b is Anthropic.ToolUseBlock => b.type === "tool_use"
    );
    if (message.stop_reason !== "tool_use" || toolUses.length === 0) break;

    const toolResults: Anthropic.ToolResultBlockParam[] = [];
    for (const tool of toolUses) {
      send({ type: "tool", name: tool.name, status: "start", label: TOOL_LABELS[tool.name] });
      let result: string;
      let isError = false;
      try {
        result = await executeTool(
          tool.name,
          (tool.input ?? {}) as Record<string, unknown>,
          session,
          (block) => send({ type: "block", block })
        );
      } catch (err) {
        isError = true;
        result = `Tool failed: ${err instanceof Error ? err.message : String(err)}`;
      }
      send({ type: "tool", name: tool.name, status: "end" });
      toolResults.push({
        type: "tool_result",
        tool_use_id: tool.id,
        content: result,
        ...(isError ? { is_error: true } : {}),
      });
    }
    session.messages.push({ role: "user", content: toolResults });
  }

  saveSession(session);
  send({ type: "done" });
}
