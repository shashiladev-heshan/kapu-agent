// Kapu's eyes — shared by /api/scan (web camera) and the Telegram channel
// (photo messages). Takes an image data URL and returns structured shopping
// intent. Provider-agnostic: prefers a real ANTHROPIC_API_KEY (Claude
// vision), falls back to OPENAI_API_KEY (gpt-4o-mini vision).

export interface ScanItem {
  query: string;
  quantity: number;
  original: string;
}
export interface ScanResult {
  kind: "shopping_list" | "product" | "scene" | "unclear";
  items: ScanItem[];
  caption: string;
}

const SCAN_PROMPT = `You are the vision system of Kapu, a Sri Lankan shopping agent for Kapruka.com.
Look at the image and extract shopping intent. The image is usually one of:
- a handwritten or typed SHOPPING LIST (Sinhala script, Tamil script, English, or romanized "Tanglish"), possibly a WhatsApp/notes screenshot
- a photo of a SINGLE PRODUCT the user wants to find ("find me something like this")
- a SCENE to recreate — a celebration table, party setup, gift arrangement ("set this up for me")

Reply with ONLY a JSON object, no prose:
{"kind":"shopping_list"|"product"|"scene"|"unclear","items":[{"query":"<english Kapruka search term>","quantity":<int>,"original":"<as written/seen>"}],"caption":"<one short line describing what you saw>"}

Rules:
- Translate item names to ENGLISH search terms: "හාල්"/"hal" → "rice", "පරිප්පු"/"parippu" → "dhal", "සීනි" → "sugar", "தேயிலை" → "tea leaves", "thel" → "coconut oil".
- Keep sizes in the query when written ("rice 5kg", "milk powder 400g"). Quantities like "2x"/"දෙකක්" become "quantity".
- Max 15 items; skip crossed-out lines.
- Single product photo → kind "product" with exactly ONE item whose query best finds it (brand + type if visible).
- Scene photo → kind "scene" with up to 8 purchasable items that would recreate it (e.g. "birthday cake", "balloons", "fairy lights", "flower bouquet").
- Unreadable / not shopping-related → kind "unclear" with empty items and an honest caption.`;

export function parseDataUrl(dataUrl: string): { mediaType: string; base64: string } | null {
  const m = /^data:(image\/(?:jpeg|png|webp|gif));base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl);
  if (!m) return null;
  return { mediaType: m[1], base64: m[2] };
}

function coerce(raw: string): ScanResult {
  try {
    const jsonText = raw.replace(/^```(?:json)?\s*|\s*```$/g, "").trim();
    const data = JSON.parse(jsonText) as Partial<ScanResult>;
    const kind =
      data.kind === "shopping_list" || data.kind === "product" || data.kind === "scene" ? data.kind : "unclear";
    const items = Array.isArray(data.items)
      ? data.items
          .slice(0, 15)
          .map((i) => ({
            query: String((i as ScanItem).query ?? "").slice(0, 80),
            quantity: Math.max(1, Math.min(99, Math.round(Number((i as ScanItem).quantity) || 1))),
            original: String((i as ScanItem).original ?? "").slice(0, 80),
          }))
          .filter((i) => i.query.length >= 2)
      : [];
    return { kind: items.length ? kind : "unclear", items, caption: String(data.caption ?? "").slice(0, 160) };
  } catch {
    return { kind: "unclear", items: [], caption: "Couldn't read the photo clearly." };
  }
}

async function scanWithAnthropic(apiKey: string, mediaType: string, base64: string): Promise<string> {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: process.env.KAPU_VISION_MODEL_ANTHROPIC || "claude-sonnet-4-6",
      max_tokens: 700,
      messages: [
        {
          role: "user",
          content: [
            { type: "image", source: { type: "base64", media_type: mediaType, data: base64 } },
            { type: "text", text: SCAN_PROMPT },
          ],
        },
      ],
    }),
    signal: AbortSignal.timeout(45000),
  });
  if (!res.ok) throw new Error(`anthropic ${res.status}`);
  const data = (await res.json()) as { content?: { type: string; text?: string }[] };
  return data.content?.find((b) => b.type === "text")?.text ?? "";
}

async function scanWithOpenAI(apiKey: string, dataUrl: string): Promise<string> {
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: process.env.KAPU_VISION_MODEL || "gpt-4o-mini",
      max_tokens: 700,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: SCAN_PROMPT },
            { type: "image_url", image_url: { url: dataUrl, detail: "high" } },
          ],
        },
      ],
    }),
    signal: AbortSignal.timeout(45000),
  });
  if (!res.ok) throw new Error(`openai ${res.status}`);
  const data = (await res.json()) as { choices?: { message?: { content?: string } }[] };
  return data.choices?.[0]?.message?.content ?? "";
}

/** Run vision OCR over an image data URL. Throws on provider failure;
 *  returns null when no provider is configured. */
export async function scanImage(dataUrl: string): Promise<ScanResult | null> {
  const parsed = parseDataUrl(dataUrl);
  if (!parsed) throw new Error("expected a base64 image data URL");
  const anthropicKey = process.env.ANTHROPIC_API_KEY?.trim();
  const openaiKey = process.env.OPENAI_API_KEY?.trim();
  if (!anthropicKey && !openaiKey) return null;

  let raw: string;
  if (anthropicKey) {
    try {
      raw = await scanWithAnthropic(anthropicKey, parsed.mediaType, parsed.base64);
    } catch {
      if (!openaiKey) throw new Error("vision failed");
      raw = await scanWithOpenAI(openaiKey, dataUrl);
    }
  } else {
    raw = await scanWithOpenAI(openaiKey!, dataUrl);
  }
  return coerce(raw);
}

/** Compose the chat message the agent acts on (shared with the web client). */
export function scanToMessage(result: ScanResult): string | null {
  const list = result.items.map((i) => `${i.quantity > 1 ? `${i.quantity}× ` : ""}${i.query}`).join(", ");
  if (result.kind === "product" && result.items[0]) {
    return `I snapped a product photo 📸 — it looks like "${result.items[0].query}". Find it (or the closest thing) on Kapruka for me.`;
  }
  if (result.kind === "scene" && result.items.length) {
    return `I snapped a photo of a setup 📸 (${result.caption || "a celebration"}) — help me recreate it from Kapruka: ${list}.`;
  }
  if (result.kind === "shopping_list" && result.items.length) {
    return `I scanned my shopping list 📸 — ${list}. Find these on Kapruka and build my basket.`;
  }
  return null;
}
