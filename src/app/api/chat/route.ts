// POST /api/chat — runs one agent turn and streams SSE events back.
// Also maintains the session's visible UI transcript (text + blocks) so a
// refresh or a "recent wish" reopen restores the full conversation.

import Anthropic from "@anthropic-ai/sdk";
import { runTurn } from "@/lib/agent/loop";
import { readUser } from "@/lib/auth/session";
import { appendUiTurn, getSession, saveSession } from "@/lib/session/store";
import type { ChatRequest, StreamEvent, UiBlock } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function POST(req: Request): Promise<Response> {
  let body: ChatRequest;
  try {
    body = (await req.json()) as ChatRequest;
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const message = (body.message ?? "").trim().slice(0, 4000);
  const sessionId = (body.sessionId ?? "").slice(0, 64);
  if (!message || !sessionId) {
    return Response.json({ error: "sessionId and message are required" }, { status: 400 });
  }

  const session = await getSession(sessionId);
  if (body.currency) session.currency = body.currency;
  if (body.language) session.language = body.language;
  session.voice = body.voice === true;
  session.userSub = readUser(req)?.sub; // signed-in → account memory (people, occasions, orders)
  session.deliverTo = typeof body.deliverTo === "string" ? body.deliverTo.slice(0, 60) : undefined;
  session.preferredDate = typeof body.preferredDate === "string" ? body.preferredDate.slice(0, 10) : undefined;
  session.favorites = Array.isArray(body.favorites) ? body.favorites.slice(0, 8).map((f) => String(f).slice(0, 90)) : undefined;
  session.userRules = typeof body.rules === "string" && body.rules.trim() ? body.rules.trim().slice(0, 300) : undefined;
  session.cart.currency = session.currency;
  if (!session.title) session.title = message.slice(0, 60);
  appendUiTurn(session, { role: "user", text: message, at: Date.now() });

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      // Accumulate the assistant's visible turn for the persisted transcript.
      let assistantText = "";
      const assistantBlocks: UiBlock[] = [];

      const send = (event: StreamEvent) => {
        if (event.type === "text") assistantText += event.delta;
        if (event.type === "block" && event.block.type !== "speech") assistantBlocks.push(event.block);
        if (event.type === "error") assistantText += (assistantText ? "\n\n" : "") + event.message;
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
        } catch {
          /* client disconnected — keep running so the transcript persists */
        }
      };

      try {
        await runTurn(session, message, send);
      } catch (err) {
        console.error("[chat] turn failed:", err);
        if (err instanceof Anthropic.RateLimitError) {
          send({
            type: "error",
            kind: "rate_limit",
            retry_after: 12,
            message: "The Kapruka gates are busy — lots of wishes right now. Hold on, I'll retry yours.",
          });
        } else if (err instanceof Anthropic.AuthenticationError) {
          send({
            type: "error",
            kind: "auth",
            message: "My Claude credentials aren't valid right now — the site owner needs to check the API key.",
          });
        } else {
          send({
            type: "error",
            kind: "generic",
            message: "Aiyo, something went wrong on my side 💔 — please try that again in a moment.",
          });
        }
        send({ type: "done" });
      } finally {
        if (assistantText || assistantBlocks.length) {
          appendUiTurn(session, { role: "assistant", text: assistantText, blocks: assistantBlocks, at: Date.now() });
          saveSession(session);
        }
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
