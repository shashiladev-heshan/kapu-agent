// Kapu's agent loop: a manual Messages API tool-use loop with streaming.
// Each user turn runs the loop until Claude stops calling tools; text deltas
// and UiBlocks stream to the browser as SSE events via `send`.

import Anthropic from "@anthropic-ai/sdk";
import { TOOL_LABELS, stepFor } from "@/lib/agent/steps";
import { buildTurnContext, KAPU_SYSTEM_PROMPT } from "@/lib/agent/system-prompt";
import { TOOL_DEFINITIONS, executeTool } from "@/lib/agent/tools";
import { startGeneration, startToolSpan, truncate, usageDetails, withTurnTrace } from "@/lib/obs/langfuse";
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

// When the API key hits a billing/credit wall we fall back to the
// subscription engine (if a token exists) and stay there briefly before
// probing the key again — a dead key must never take the demo down.
let billingFallbackUntil = 0;
const hasAuthToken = () =>
  Boolean(process.env.CLAUDE_CODE_OAUTH_TOKEN?.trim() || process.env.ANTHROPIC_AUTH_TOKEN?.trim());
function isBillingError(err: unknown): boolean {
  if (err instanceof Anthropic.AuthenticationError || err instanceof Anthropic.PermissionDeniedError) return true;
  if (err instanceof Anthropic.APIError) {
    return /credit|billing|balance|purchase|payment/i.test(String(err.message));
  }
  return false;
}

export async function runTurn(
  session: Session,
  userMessage: string,
  send: (event: StreamEvent) => void
): Promise<void> {
  const sdkAvailable = hasAuthToken();
  const useSdk = pickEngine() === "agent-sdk" || (sdkAvailable && Date.now() < billingFallbackUntil);

  // One Langfuse trace per turn. This is the choke point every channel goes
  // through — web, Telegram and the schedules runner all call runTurn.
  return withTurnTrace(session, userMessage, useSdk ? "agent-sdk" : "api", send, async (tracedSend) => {
    if (useSdk) {
      const { runTurnSdk } = await import("@/lib/agent/engine-sdk");
      return runTurnSdk(session, userMessage, tracedSend);
    }
    try {
      return await runTurnApi(session, userMessage, tracedSend);
    } catch (err) {
      if (sdkAvailable && isBillingError(err)) {
        billingFallbackUntil = Date.now() + 10 * 60_000;
        console.error("[engine] API key billing/auth failure — falling back to subscription engine for 10 min:", err instanceof Error ? err.message.slice(0, 120) : err);
        const { runTurnSdk } = await import("@/lib/agent/engine-sdk");
        return runTurnSdk(session, userMessage, tracedSend);
      }
      throw err;
    }
  });
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
    const generation = startGeneration(`claude:${MODEL}`, {
      model: MODEL,
      input: [...session.messages], // snapshot — the array is appended to below
      modelParameters: { max_tokens: 4096 },
    });

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

    // Time-to-first-token is the number that decides whether the demo feels alive.
    let firstToken: Date | undefined;
    stream.on("text", (delta) => {
      firstToken ??= new Date();
      send({ type: "text", delta });
    });

    let message: Anthropic.Message;
    try {
      message = await stream.finalMessage();
    } catch (err) {
      generation
        ?.update({
          level: "ERROR",
          statusMessage: err instanceof Error ? err.message.slice(0, 500) : String(err),
        })
        .end();
      throw err;
    }

    generation
      ?.update({
        output: message.content,
        completionStartTime: firstToken,
        usageDetails: usageDetails(message.usage),
        metadata: { iteration: i, stop_reason: message.stop_reason },
      })
      .end();

    session.messages.push({ role: "assistant", content: message.content });

    if (message.stop_reason === "pause_turn") continue;

    const toolUses = message.content.filter(
      (b): b is Anthropic.ToolUseBlock => b.type === "tool_use"
    );
    if (message.stop_reason !== "tool_use" || toolUses.length === 0) break;

    const toolResults: Anthropic.ToolResultBlockParam[] = [];
    for (const tool of toolUses) {
      const input = (tool.input ?? {}) as Record<string, unknown>;
      send({
        type: "tool",
        name: tool.name,
        status: "start",
        label: TOOL_LABELS[tool.name],
        detail: stepFor(tool.name, input) ?? undefined,
      });
      const toolSpan = startToolSpan(tool.name, input);
      let result: string;
      let isError = false;
      let blocksRendered = 0;
      try {
        result = await executeTool(tool.name, input, session, (block) => {
          blocksRendered++;
          send({ type: "block", block });
        });
      } catch (err) {
        isError = true;
        result = `Tool failed: ${err instanceof Error ? err.message : String(err)}`;
      }
      toolSpan
        ?.update({
          output: truncate(result),
          metadata: { blocks_rendered: blocksRendered },
          ...(isError ? { level: "ERROR", statusMessage: result.slice(0, 500) } : {}),
        })
        .end();
      send({ type: "tool", name: tool.name, status: "end", ...(isError ? { error: true } : {}) });
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
