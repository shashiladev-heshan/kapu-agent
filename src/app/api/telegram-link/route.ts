// POST /api/telegram-link {code} — bind the signed-in user's account to the
// chat that issued the code: Telegram (/link to the bot) or WhatsApp ("link"
// to the Kapu number). Scheduled-run results are then delivered there. One
// endpoint for both — the codes live in separate maps, so a code can only
// ever bind the channel that issued it.

import { readUser } from "@/lib/auth/session";
import { getUser, saveUser } from "@/lib/auth/users";
import { redeemLinkCode, redeemWaLinkCode } from "@/lib/schedules/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request): Promise<Response> {
  const auth = readUser(req);
  if (!auth) return Response.json({ error: "sign-in required" }, { status: 401 });
  const body = (await req.json().catch(() => ({}))) as { code?: string };
  const code = String(body.code ?? "");
  const chatId = code ? redeemLinkCode(code) : null;
  const waPhone = !chatId && code ? redeemWaLinkCode(code) : null;
  if (!chatId && !waPhone) {
    return Response.json(
      { error: "Invalid or expired code — send /link to the bot (or “link” on WhatsApp) again." },
      { status: 400 }
    );
  }
  const user = (await getUser(auth.sub)) ?? {
    sub: auth.sub,
    email: auth.email,
    name: auth.name,
    picture: auth.picture,
    wishes: [],
    recipients: [],
    occasions: [],
    agents: [],
    updatedAt: Date.now(),
  };
  if (chatId) user.tgChatId = chatId;
  if (waPhone) user.waPhone = waPhone;
  await saveUser(user);
  return Response.json({ ok: true, channel: chatId ? "telegram" : "whatsapp" });
}
