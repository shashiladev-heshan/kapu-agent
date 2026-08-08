// Kapu → Langfuse (self-hosted): OpenTelemetry tracing for the agent.
//
// Shape of a trace: one root `kapu-turn` agent observation per user turn —
// web, Telegram and scheduled runs all funnel through runTurn, so every
// channel is covered by instrumenting that one function. Children are one
// `generation` per model call and one `tool` span per Kapruka tool.
//
// Tracing is OPTIONAL. With no LANGFUSE_* keys every helper here is a
// pass-through no-op, so the app behaves identically with tracing off — a
// dead observability stack must never take the demo down.

import {
  createTraceAttributes,
  getActiveTraceId,
  propagateAttributes,
  setLangfuseTracerProvider,
  startActiveObservation,
  startObservation,
} from "@langfuse/tracing";
import { scoreTurn } from "@/lib/obs/scorers";
import type { Session } from "@/lib/session/store";
import type { StreamEvent } from "@/lib/types";

const publicKey = process.env.LANGFUSE_PUBLIC_KEY?.trim();
const secretKey = process.env.LANGFUSE_SECRET_KEY?.trim();
const baseUrl = process.env.LANGFUSE_BASE_URL?.trim() || process.env.LANGFUSE_HOST?.trim();

/** Tracing only runs when a full credential set is present. */
export const TRACING_ENABLED = Boolean(publicKey && secretKey && baseUrl);

const ENVIRONMENT =
  process.env.LANGFUSE_TRACING_ENVIRONMENT?.trim() ||
  (process.env.NODE_ENV === "production" ? "production" : "development");

// Railway exposes the deployed commit — makes "which build regressed?" answerable.
const RELEASE = process.env.RAILWAY_GIT_COMMIT_SHA?.slice(0, 7);

// ── PII masking ───────────────────────────────────────────────────────
// Order flows carry real recipient phone numbers. They add nothing to an
// eval and everything to a breach, so they never leave the process.
// Names/addresses are kept: order-grounding evals need them, and the
// Langfuse instance is our own. LANGFUSE_MASK_PII=0 disables.
const MASK_PII = process.env.LANGFUSE_MASK_PII !== "0";
const SL_PHONE = /(?<!\w)(?:\+94[\s-]?|0)\d{2}[\s-]?\d{3}[\s-]?\d{4}(?!\w)/g;
const EMAIL = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g;
const CARD = /\b\d{4}[\s-]?\d{4}[\s-]?\d{4}[\s-]?\d{4}\b/g;

function maskPii({ data }: { data: string }): string {
  if (!MASK_PII || typeof data !== "string") return data;
  return data
    .replace(CARD, "[card]")
    .replace(SL_PHONE, "[phone]")
    .replace(EMAIL, "[email]");
}

// ── provider lifecycle ────────────────────────────────────────────────
type Flushable = { forceFlush: () => Promise<void>; shutdown: () => Promise<void> };
let processor: Flushable | undefined;
let started = false;

/**
 * Registers the Langfuse span processor. Called once from
 * `src/instrumentation.ts` (Node runtime only) at server boot.
 */
export async function initTracing(): Promise<void> {
  if (!TRACING_ENABLED || started) return;
  started = true;
  try {
    const { LangfuseSpanProcessor, isDefaultExportSpan } = await import("@langfuse/otel");
    const { NodeTracerProvider } = await import("@opentelemetry/sdk-trace-node");

    const spanProcessor = new LangfuseSpanProcessor({
      publicKey,
      secretKey,
      baseUrl,
      environment: ENVIRONMENT,
      mask: maskPii,
      // Next.js emits its own HTTP/render spans once a provider is global;
      // the default filter keeps Langfuse + GenAI spans and drops that noise.
      shouldExportSpan: ({ otelSpan }) => isDefaultExportSpan(otelSpan),
    });
    processor = spanProcessor as unknown as Flushable;

    const provider = new NodeTracerProvider({ spanProcessors: [spanProcessor] });
    // register() also installs the AsyncLocalStorage context manager, which is
    // what makes generation/tool spans nest under the turn across `await`s.
    provider.register();
    setLangfuseTracerProvider(provider);

    console.log(`[langfuse] tracing → ${baseUrl} (env: ${ENVIRONMENT}${RELEASE ? `, release: ${RELEASE}` : ""})`);
  } catch (err) {
    processor = undefined;
    console.error("[langfuse] tracing init failed — continuing without it:", err);
  }
}

/** Push buffered spans now. Fire-and-forget; never blocks a user response. */
export async function flushTracing(): Promise<void> {
  try {
    await processor?.forceFlush();
  } catch (err) {
    console.error("[langfuse] flush failed:", err instanceof Error ? err.message : err);
  }
}

// ── helpers ───────────────────────────────────────────────────────────

/** Tool payloads can be enormous (a 20-product search grid). Keep spans sane. */
const MAX_PAYLOAD = 20_000;
export function truncate(value: string, max = MAX_PAYLOAD): string {
  return value.length > max ? `${value.slice(0, max)}…[+${value.length - max} chars]` : value;
}

/** Session id prefixes are the channel marker — see [[session-store]]. */
function channelOf(sessionId: string): "telegram" | "scheduled" | "web" {
  if (sessionId.startsWith("tg_")) return "telegram";
  if (sessionId.startsWith("sched_")) return "scheduled";
  return "web";
}

/** propagateAttributes only accepts short string values. */
function meta(entries: Record<string, string | undefined>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(entries)) {
    if (v) out[k] = v.slice(0, 200);
  }
  return out;
}

// ── the turn trace ────────────────────────────────────────────────────

/**
 * Wraps one agent turn in a Langfuse trace and hands `run` a wrapped `send`
 * that accumulates the visible reply for the trace output. Returns exactly
 * what `run` returns, and rethrows its errors untouched.
 */
export async function withTurnTrace(
  session: Session,
  userMessage: string,
  engine: "api" | "agent-sdk",
  send: (event: StreamEvent) => void,
  run: (send: (event: StreamEvent) => void) => Promise<void>
): Promise<void> {
  if (!TRACING_ENABLED) return run(send);

  const channel = channelOf(session.id);
  let text = "";
  const tools: string[] = [];
  let toolErrors = 0;
  let blocks = 0;
  let streamError: string | undefined;

  const tracked = (event: StreamEvent) => {
    if (event.type === "text") text += event.delta;
    else if (event.type === "tool" && event.status === "start") tools.push(event.name);
    else if (event.type === "tool" && event.status === "end" && event.error) toolErrors++;
    else if (event.type === "block") blocks++;
    else if (event.type === "error") streamError = event.message;
    send(event);
  };

  return propagateAttributes(
    {
      traceName: "kapu-turn",
      sessionId: session.id,
      ...(session.userSub ? { userId: session.userSub } : {}),
      ...(RELEASE ? { version: RELEASE } : {}),
      tags: [
        `channel:${channel}`,
        `lang:${session.language}`,
        `engine:${engine}`,
        ...(session.voice ? ["voice"] : []),
        ...(session.scheduled ? ["scheduled"] : []),
        ...(session.agentSpec ? [`kapu:${session.agentSpec.name}`] : []),
      ],
      metadata: meta({
        currency: String(session.currency),
        agent: session.agentSpec?.name,
        deliverTo: session.deliverTo,
      }),
    },
    () =>
      startActiveObservation(
        "kapu-turn",
        async (turn) => {
          turn.update({ input: userMessage });
          // Observation IO is not trace IO — the trace list and the judges
          // read the trace-level fields, so set them explicitly.
          turn.otelSpan.setAttributes(createTraceAttributes({ input: userMessage }));
          try {
            await run(tracked);
          } catch (err) {
            turn.update({
              level: "ERROR",
              statusMessage: err instanceof Error ? err.message.slice(0, 500) : String(err),
            });
            throw err;
          } finally {
            turn.update({
              output: text,
              ...(streamError ? { level: "WARNING", statusMessage: streamError } : {}),
              metadata: {
                channel,
                engine,
                language: session.language,
                tools_used: tools,
                tool_count: tools.length,
                tool_errors: toolErrors,
                blocks_rendered: blocks,
                cart_items: session.cart?.items?.length ?? 0,
                signed_in: Boolean(session.userSub),
              },
            });
            turn.otelSpan.setAttributes(createTraceAttributes({ input: userMessage, output: text }));
            // Deterministic rails grade EVERY turn — free, exact, instant.
            // The LLM judges configured in Langfuse cover the subjective half.
            const traceId = turn.traceId;
            for (const s of scoreTurn({ reply: text, language: session.language, tools, toolErrors })) {
              void scoreTrace({ traceId, ...s });
            }
            // Judges test live; a trace that shows up 30s later is useless.
            void flushTracing();
          }
        },
        { asType: "agent" }
      )
  );
}

// ── child observations ────────────────────────────────────────────────

type AnthropicUsage = {
  input_tokens?: number;
  output_tokens?: number;
  cache_read_input_tokens?: number | null;
  cache_creation_input_tokens?: number | null;
};

/** Langfuse's cost model keys these exact names for Anthropic models. */
export function usageDetails(usage: AnthropicUsage | undefined): Record<string, number> {
  if (!usage) return {};
  return {
    input: usage.input_tokens ?? 0,
    output: usage.output_tokens ?? 0,
    ...(usage.cache_read_input_tokens ? { cache_read_input_tokens: usage.cache_read_input_tokens } : {}),
    ...(usage.cache_creation_input_tokens
      ? { cache_creation_input_tokens: usage.cache_creation_input_tokens }
      : {}),
  };
}

/**
 * A trace for a one-shot LLM call outside the agent loop (the gift writer,
 * the eval runner). `fn` receives the root generation, or null when tracing
 * is off, and the observation is ended for you.
 */
export async function withStandaloneTrace<T>(
  name: string,
  opts: {
    sessionId?: string;
    userId?: string;
    tags?: string[];
    model: string;
    input: unknown;
    modelParameters?: Record<string, string | number>;
  },
  fn: (generation: ReturnType<typeof startGeneration>) => Promise<T>
): Promise<T> {
  if (!TRACING_ENABLED) return fn(null);
  const { model, input, modelParameters, sessionId, userId, tags } = opts;
  return propagateAttributes(
    {
      traceName: name,
      ...(sessionId ? { sessionId } : {}),
      ...(userId ? { userId } : {}),
      ...(RELEASE ? { version: RELEASE } : {}),
      ...(tags?.length ? { tags } : {}),
    },
    () =>
      startActiveObservation(
        name,
        async (generation) => {
          generation.update({ model, input, ...(modelParameters ? { modelParameters } : {}) });
          generation.otelSpan.setAttributes(createTraceAttributes({ input }));
          try {
            return await fn(generation);
          } catch (err) {
            generation.update({
              level: "ERROR",
              statusMessage: err instanceof Error ? err.message.slice(0, 500) : String(err),
            });
            throw err;
          } finally {
            void flushTracing();
          }
        },
        { asType: "generation" }
      )
  );
}

/** A model call. Returns null when tracing is off so callers can skip cheaply. */
export function startGeneration(
  name: string,
  attrs: { model: string; input: unknown; modelParameters?: Record<string, string | number> }
) {
  if (!TRACING_ENABLED) return null;
  return startObservation(name, attrs, { asType: "generation" });
}

/** A Kapruka tool execution, nested under the active turn. */
export function startToolSpan(name: string, input: unknown) {
  if (!TRACING_ENABLED) return null;
  return startObservation(name, { input }, { asType: "tool" });
}

/** The active trace id — needed to attach scores after the fact. */
export function activeTraceId(): string | undefined {
  return TRACING_ENABLED ? getActiveTraceId() : undefined;
}

// ── scores ────────────────────────────────────────────────────────────

let clientPromise: Promise<{ score: { create: (b: Record<string, unknown>) => Promise<unknown> } }> | null = null;
async function scoreClient() {
  if (!clientPromise) {
    clientPromise = import("@langfuse/client").then(
      ({ LangfuseClient }) =>
        new LangfuseClient({ publicKey, secretKey, baseUrl }) as unknown as {
          score: { create: (b: Record<string, unknown>) => Promise<unknown> };
        }
    );
  }
  return clientPromise;
}

export interface ScoreInput {
  traceId: string;
  name: string;
  value: number | string;
  observationId?: string;
  comment?: string;
  dataType?: "NUMERIC" | "BOOLEAN" | "CATEGORICAL";
}

/**
 * Attach a programmatic (deterministic) score to a trace. Never throws —
 * a scoring hiccup must not fail the user's request.
 */
export async function scoreTrace(input: ScoreInput): Promise<void> {
  if (!TRACING_ENABLED) return;
  try {
    const client = await scoreClient();
    await client.score.create({ ...input, environment: ENVIRONMENT });
  } catch (err) {
    console.error("[langfuse] score failed:", err instanceof Error ? err.message : err);
  }
}
