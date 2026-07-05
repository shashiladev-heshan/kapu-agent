// Telegram webhook — ACK immediately, process in the background (the Railway
// monolith is a long-running Node process, so background work survives the
// response). Same agent core as web; see src/lib/telegram/handler.ts.
//
// Setup: create a bot via @BotFather → TELEGRAM_BOT_TOKEN in env. After
// deploy: curl "https://api.telegram.org/bot<TOKEN>/setWebhook?url=<PUBLIC_URL>/api/telegram&secret_token=<TELEGRAM_WEBHOOK_SECRET>"
// Local dev: `node scripts/tg-poll.mjs` long-polls and forwards updates here.

import { getBotUser, telegramEnabled } from "@/lib/telegram/api";
import { processUpdate } from "@/lib/telegram/handler";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET(): Promise<Response> {
  const enabled = telegramEnabled();
  const bot = enabled ? await getBotUser() : null;
  return Response.json({
    ok: true,
    channel: "telegram",
    enabled,
    ...(bot ? { username: bot.username, link: `https://t.me/${bot.username}` } : {}),
  });
}

export async function POST(req: Request): Promise<Response> {
  if (!telegramEnabled()) return Response.json({ error: "TELEGRAM_BOT_TOKEN not set" }, { status: 501 });

  const secret = process.env.TELEGRAM_WEBHOOK_SECRET?.trim();
  if (secret && req.headers.get("x-telegram-bot-api-secret-token") !== secret) {
    return Response.json({ error: "bad secret" }, { status: 401 });
  }

  let update: Parameters<typeof processUpdate>[0];
  try {
    update = await req.json();
  } catch {
    return Response.json({ error: "bad json" }, { status: 400 });
  }

  // Fire-and-forget: Telegram retries if we block until the agent finishes.
  void processUpdate(update);
  return Response.json({ ok: true });
}
