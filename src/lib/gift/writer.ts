// Kapu's tiny copywriter — generates icing / gift-card message suggestions
// for the "Write it for me" button (/api/icing). One cheap fast Claude call,
// personalized with whatever the session already knows (saved people,
// upcoming occasions, next festival). Same dual-credential construction as
// the agent loop so an empty ANTHROPIC_API_KEY= line can't shadow a token.

import Anthropic from "@anthropic-ai/sdk";

// Latency-sensitive (user taps a button and waits) → fastest tier by default.
const MODEL = process.env.KAPU_GIFT_MODEL || "claude-haiku-4-5";

const apiKey = process.env.ANTHROPIC_API_KEY?.trim() || undefined;
const authToken = process.env.ANTHROPIC_AUTH_TOKEN?.trim() || undefined;
const client = apiKey
  ? new Anthropic({ apiKey, authToken: null })
  : authToken
    ? new Anthropic({ authToken, apiKey: null })
    : new Anthropic();

export type GiftMessageKind = "icing" | "card";

export interface GiftMessageInput {
  /** product being gifted, e.g. "Chocolate Fudge Cake 1kg" */
  name: string;
  category?: string;
  lang: "en" | "si" | "ta";
  kind: GiftMessageKind;
  /** people the shopper has saved (memory) — names/relationships only */
  recipients?: { name: string; relationship?: string }[];
  /** saved occasions coming up, e.g. { recipient: "Amma", type: "birthday", in_days: 3 } */
  occasions?: { recipient: string; type: string; in_days: number }[];
  /** next SL festival when it's close — { name, days } */
  festival?: { name: string; days: number } | null;
}

const LIMITS: Record<GiftMessageKind, number> = { icing: 40, card: 120 };

// Byte-stable system prompt (no interpolation) — per-request data rides in the
// user turn, same discipline as the main agent prompt.
const SYSTEM = `You are Kapu, Kapruka.lk's warm Sri Lankan gift concierge. Your only job here: write short gift messages for a gift the shopper is buying.

You receive a JSON context: the gift (name, category), the reply language, the message kind, and optional hints — people the shopper has saved (names/relationships), their upcoming saved occasions, and the next Sri Lankan festival.

Reply with ONLY a JSON array of exactly 3 strings. No prose, no markdown fences.

Rules:
- kind "icing": text piped onto a cake. HARD LIMIT 40 characters per suggestion. No emoji, no line breaks.
- kind "card": a short gift-card note. Max 120 characters. At most one tasteful emoji.
- Language: write in the requested language ("en" English, "si" Sinhala script, "ta" Tamil script). When the language is si or ta, make the LAST suggestion English instead — icing in Sri Lanka is often piped in English.
- Use the hints when they plausibly match the gift: an upcoming saved occasion → write for it ("Happy Birthday Amma!"); the gift name itself names an occasion (birthday cake, anniversary, Avurudu hamper) → write for that; otherwise warm all-purpose lines that suit the product.
- Only use a personal name or relationship word (Amma, Akki, Seeya…) that appears in the hints. No hints → no names; keep the lines nameless and universal.
- Never mix scripts inside one suggestion — each line is fully Sinhala script, fully Tamil script, or fully English.
- Sinhala: stick to natural celebratory phrases Sri Lankans actually pipe on cakes — "සුබ උපන්දිනයක්!", "සුබ පැතුම්!", "ජයවේවා!", "ආදරෙන්…", "සුබ නව වසරක්!". Do not compose novel poetic Sinhala.
- Tamil: likewise — "பிறந்தநாள் வாழ்த்துக்கள்!", "வாழ்த்துக்கள்!", "அன்புடன்…".
- Make the 3 suggestions distinct in feeling: one classic, one playful, one heartfelt.`;

function clean(list: string[], limit: number): string[] {
  return [
    ...new Set(list.map((s) => s.replace(/\s+/g, " ").trim().slice(0, limit)).filter((s) => s.length >= 2)),
  ].slice(0, 3);
}

function parseSuggestions(raw: string, kind: GiftMessageKind): string[] {
  const limit = LIMITS[kind];
  try {
    const stripped = raw.replace(/^```(?:json)?\s*|\s*```$/g, "").trim();
    const start = stripped.indexOf("[");
    const end = stripped.lastIndexOf("]");
    if (start !== -1 && end > start) {
      const arr = JSON.parse(stripped.slice(start, end + 1)) as unknown;
      if (Array.isArray(arr)) {
        const out = clean(arr.filter((s): s is string => typeof s === "string"), limit);
        if (out.length) return out;
      }
    }
  } catch {
    // fall through to salvage
  }
  // Format flake (prose around the array, trailing comma…) — salvage the
  // quoted strings so one bad reply doesn't waste the user's tap.
  const quoted = [...raw.matchAll(/"([^"\n]{2,120})"/g)].map((m) => m[1]);
  return clean(quoted, limit);
}

// Small models occasionally emit a whole line in the wrong language (observed:
// Chinese in a ta request). Deterministic gate: a suggestion must be pure Latin
// (the allowed English fallback) or purely in the requested script.
const LATIN_ONLY = /^[\x20-\x7E\u2018\u2019\u201C\u201D\u2013\u2014\u2026]+$/;
const NATIVE: Record<"si" | "ta", RegExp> = {
  // Sinhala block + ZWJ (ශ්‍රී conjuncts) + neutral punctuation
  si: /^[\u0D80-\u0DFF\u200D\s\d!.,'&\-\u2013\u2014\u2026]+$/,
  ta: /^[\u0B80-\u0BFF\u200D\s\d!.,'&\-\u2013\u2014\u2026]+$/,
};
const PICTO = /[\p{Extended_Pictographic}\uFE0F]/gu;
function scriptOk(s: string, lang: GiftMessageInput["lang"]): boolean {
  // judge the words only — card suggestions may carry one tasteful emoji
  const t = s.replace(PICTO, "").trim();
  if (!t) return false;
  if (LATIN_ONLY.test(t)) return true;
  return lang !== "en" && NATIVE[lang].test(t);
}

/** Returns 1–3 suggestions, or null when no Anthropic credential is configured. */
export async function writeGiftMessages(input: GiftMessageInput): Promise<string[] | null> {
  if (!apiKey && !authToken) return null;
  const context = {
    gift: { name: input.name.slice(0, 120), category: input.category?.slice(0, 60) },
    lang: input.lang,
    kind: input.kind,
    hints: {
      people: (input.recipients ?? []).slice(0, 6),
      upcoming_occasions: (input.occasions ?? []).slice(0, 4),
      next_festival: input.festival ?? undefined,
    },
  };
  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 350,
    system: SYSTEM,
    messages: [{ role: "user", content: JSON.stringify(context) }],
  });
  const text = response.content
    .map((b) => (b.type === "text" ? b.text : ""))
    .join("");
  let suggestions = parseSuggestions(text, input.kind);
  if (input.kind === "icing") {
    // cake piping can't render emoji — strip rather than reject the line
    suggestions = suggestions.map((s) => s.replace(PICTO, "").replace(/\s+/g, " ").trim()).filter((s) => s.length >= 2);
  }
  return suggestions.filter((s) => scriptOk(s, input.lang));
}
