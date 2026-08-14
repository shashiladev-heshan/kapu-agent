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

/**
 * Human pacing. A burst of messages landing in the same second is the most
 * machine-shaped thing this channel can do — real people take a beat between
 * sends, and WhatsApp's own heuristics notice. Jitter is randomised so the
 * gaps are never a constant either.
 */
export function beat(min = 450, max = 1100): Promise<void> {
  return new Promise((r) => setTimeout(r, min + Math.floor(Math.random() * (max - min))));
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

export async function sendText(to: string, text: string, final = false): Promise<void> {
  const parts = chunk(text);
  for (let i = 0; i < parts.length; i++) {
    if (i > 0) await beat();
    await send({ to, text: parts[i], final: final && i === parts.length - 1 });
  }
}

export async function sendImage(to: string, imageUrl: string, caption: string, final = false): Promise<void> {
  const ok = await send({ to, image_url: imageUrl, caption: caption.slice(0, 900), final });
  // Never let a dead CDN image swallow the product — fall back to words.
  if (!ok && caption) await sendText(to, caption, final);
}

/**
 * Send a spoken reply as a WhatsApp VOICE NOTE (PTT). `ogg` must already be
 * OGG/Opus (what WhatsApp records natively) — the sidecar uploads it as audio
 * and flags it PTT so it renders as the round waveform bubble, not a file.
 * Returns false if the sidecar is dormant or the send failed (caller keeps the
 * written reply as the fallback so a voice turn is never left silent).
 */
export async function sendAudio(to: string, ogg: Buffer, seconds = 0, final = false): Promise<boolean> {
  return send({ to, audio_b64: ogg.toString("base64"), audio_seconds: seconds, final });
}

/** Tells the sidecar this answer is done so it can drop the typing indicator. */
export async function endTurn(to: string): Promise<void> {
  await send({ to, final: true });
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
