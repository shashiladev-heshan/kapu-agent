// Transport to the kapu-wa Go sidecar (whatsmeow). Kapu never speaks the
// WhatsApp protocol itself — it POSTs here and the sidecar owns the socket.
//
// Dormant without WA_SERVICE_URL, exactly like the Telegram adapter is
// dormant without a bot token.

const BASE = process.env.WA_SERVICE_URL?.replace(/\/$/, "") ?? "";
const SECRET = process.env.WA_SHARED_SECRET ?? "";

export function whatsappEnabled(): boolean {
  return Boolean(BASE);
}

async function send(body: Record<string, unknown>): Promise<boolean> {
  if (!BASE) return false;
  try {
    const res = await fetch(`${BASE}/send`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Kapu-Secret": SECRET },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(90_000),
    });
    if (!res.ok) console.error("[whatsapp] send failed:", res.status, (await res.text()).slice(0, 160));
    return res.ok;
  } catch (err) {
    console.error("[whatsapp] send error:", err instanceof Error ? err.message : err);
    return false;
  }
}

/** WhatsApp caps a message body around 4096 chars. */
const MAX = 3800;

export function chunk(text: string, max = MAX): string[] {
  const out: string[] = [];
  let rest = text;
  while (rest.length > max) {
    const cut = rest.lastIndexOf("\n", max);
    const at = cut > max / 2 ? cut : max;
    out.push(rest.slice(0, at));
    rest = rest.slice(at);
  }
  if (rest.trim()) out.push(rest);
  return out;
}

export async function sendText(to: string, text: string): Promise<void> {
  for (const part of chunk(text)) await send({ to, text: part });
}

export async function sendImage(to: string, imageUrl: string, caption: string): Promise<void> {
  const ok = await send({ to, image_url: imageUrl, caption: caption.slice(0, 900) });
  // Never let a dead CDN image swallow the product — fall back to words.
  if (!ok && caption) await sendText(to, caption);
}

/**
 * Markdown → WhatsApp's much smaller formatting vocabulary:
 * `*bold*`, `_italic_`, `~strike~`. No links, no headings, no tables.
 */
export function mdToWhatsapp(md: string): string {
  return md
    .replace(/```[\s\S]*?```/g, (m) => m.replace(/```/g, ""))
    .replace(/^#{1,6}\s*(.+)$/gm, "*$1*")
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, "$1 ($2)")
    .replace(/\*\*(.+?)\*\*/g, "*$1*")
    .replace(/(^|[\s(])_(?!_)(.+?)_(?=[\s.,!?)]|$)/g, "$1_$2_")
    .replace(/^\s*[-*]\s+/gm, "• ")
    .trim();
}
