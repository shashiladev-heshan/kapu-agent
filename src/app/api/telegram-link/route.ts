// POST /api/telegram-link {code} — bind the signed-in user's account to the
// Telegram chat that issued the code via /link. Scheduled-run results are
// then delivered to that chat.

import { readUser } from "@/lib/auth/session";
import { getUser, saveUser } from "@/lib/auth/users";
import { redeemLinkCode } from "@/lib/schedules/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request): Promise<Response> {
  const auth = readUser(req);
  if (!auth) return Response.json({ error: "sign-in required" }, { status: 401 });
  const body = (await req.json().catch(() => ({}))) as { code?: string };
  const chatId = body.code ? redeemLinkCode(String(body.code)) : null;
  if (!chatId) return Response.json({ error: "Invalid or expired code — send /link to the bot again." }, { status: 400 });
  const user = (await getUser(auth.sub)) ?? {
    sub: auth.sub,
    email: auth.email,
    name: auth.name,
    picture: auth.picture,
    wishes: [],
    recipients: [],
    occasions: [],
    updatedAt: Date.now(),
  };
  user.tgChatId = chatId;
  await saveUser(user);
  return Response.json({ ok: true });
}
