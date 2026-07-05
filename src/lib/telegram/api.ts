// Thin Telegram Bot API client. Dormant without TELEGRAM_BOT_TOKEN.

const TOKEN = () => process.env.TELEGRAM_BOT_TOKEN?.trim();

export function telegramEnabled(): boolean {
  return Boolean(TOKEN());
}

export async function tg<T = unknown>(method: string, payload: Record<string, unknown>): Promise<T | null> {
  const token = TOKEN();
  if (!token) return null;
  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(20000),
    });
    const data = (await res.json()) as { ok: boolean; result?: T; description?: string };
    if (!data.ok) {
      console.error(`[telegram] ${method} failed:`, data.description);
      return null;
    }
    return data.result ?? null;
  } catch (err) {
    console.error(`[telegram] ${method} error:`, err);
    return null;
  }
}

export const sendMessage = (chatId: number, text: string, extra: Record<string, unknown> = {}) =>
  tg("sendMessage", { chat_id: chatId, text, parse_mode: "HTML", disable_web_page_preview: true, ...extra });

export const sendPhoto = (chatId: number, photo: string, caption: string, extra: Record<string, unknown> = {}) =>
  tg("sendPhoto", { chat_id: chatId, photo, caption, parse_mode: "HTML", ...extra });

export const sendChatAction = (chatId: number, action = "typing") => tg("sendChatAction", { chat_id: chatId, action });

/** Bot's own identity (cached) — needed to detect @mentions in groups. */
let botUser: { id: number; username: string } | null = null;
export async function getBotUser(): Promise<{ id: number; username: string } | null> {
  if (botUser) return botUser;
  const me = await tg<{ id: number; username: string }>("getMe", {});
  if (me?.username) botUser = { id: me.id, username: me.username };
  return botUser;
}

export const answerCallback = (id: string, text?: string) =>
  tg("answerCallbackQuery", { callback_query_id: id, ...(text ? { text } : {}) });

export const editMessage = (chatId: number, messageId: number, text: string) =>
  tg("editMessageText", { chat_id: chatId, message_id: messageId, text, parse_mode: "HTML" });

export const deleteMessage = (chatId: number, messageId: number) =>
  tg("deleteMessage", { chat_id: chatId, message_id: messageId });

/** Upload a photo as bytes (Telegram can't always fetch Kapruka's CDN —
 *  Cloudflare blocks its fetcher — so we fetch and re-upload ourselves). */
export async function sendPhotoBuffer(
  chatId: number,
  buf: Buffer,
  caption: string,
  extra: Record<string, unknown> = {}
): Promise<unknown | null> {
  const token = TOKEN();
  if (!token) return null;
  try {
    const form = new FormData();
    form.append("chat_id", String(chatId));
    form.append("caption", caption);
    form.append("parse_mode", "HTML");
    if (extra.reply_markup) form.append("reply_markup", JSON.stringify(extra.reply_markup));
    form.append("photo", new Blob([new Uint8Array(buf)], { type: "image/jpeg" }), "photo.jpg");
    const res = await fetch(`https://api.telegram.org/bot${token}/sendPhoto`, {
      method: "POST",
      body: form,
      signal: AbortSignal.timeout(30000),
    });
    const data = (await res.json()) as { ok: boolean; result?: unknown; description?: string };
    if (!data.ok) {
      console.error("[telegram] sendPhoto(upload) failed:", data.description);
      return null;
    }
    return data.result ?? null;
  } catch (err) {
    console.error("[telegram] sendPhoto(upload) error:", err);
    return null;
  }
}

/** Download a Telegram file (voice note / photo) as a Buffer + mime. */
export async function downloadFile(fileId: string): Promise<{ buf: Buffer; path: string } | null> {
  const token = TOKEN();
  if (!token) return null;
  const info = await tg<{ file_path?: string }>("getFile", { file_id: fileId });
  if (!info?.file_path) return null;
  try {
    const res = await fetch(`https://api.telegram.org/file/bot${token}/${info.file_path}`, {
      signal: AbortSignal.timeout(30000),
    });
    if (!res.ok) return null;
    return { buf: Buffer.from(await res.arrayBuffer()), path: info.file_path };
  } catch {
    return null;
  }
}

/** Escape user/model text for Telegram HTML mode. */
export function esc(s: string): string {
  return s.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

/** Model markdown → light Telegram HTML (bold/italic only, everything else stripped). */
export function mdToTelegram(s: string): string {
  let out = esc(s);
  out = out.replace(/\*\*([^*]+)\*\*/g, "<b>$1</b>");
  out = out.replace(/(?<![\w*])\*([^*\n]+)\*(?![\w*])/g, "<i>$1</i>");
  out = out.replace(/^#{1,4}\s*(.+)$/gm, "<b>$1</b>");
  out = out.replace(/^[-•]\s+/gm, "• ");
  return out.trim();
}
