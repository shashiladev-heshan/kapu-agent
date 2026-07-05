// POST /api/stt — speech-to-text for the voice loop's recorder path.
// Tries KAPU_STT_MODEL (default gpt-4o-mini-transcribe), falls back to
// whisper-1 and REMEMBERS which one works so later calls don't pay a doomed
// request.
//
// Language handling (verified live):
// - whisper-1 REJECTS `language=si` as a param, yet transcribes Sinhala
//   audio perfectly via auto-detect — so Sinhala is steered with a
//   Sinhala-exemplar PROMPT instead of the language param.
// - `ta` is a supported param and is forwarded.
// - EN mode sends no hint (Sri Lankans code-switch); a script-sanity guard
//   retries with the Sinhala prompt if the transcript arrives in an
//   implausible script (e.g. Sinhala audio written as Gujarati).
// Body: raw audio blob (webm/ogg/mp4/mp3). Query: ?language=si|ta|en.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DOMAIN_HINT =
  "Sri Lankan shopping request for Kapruka.com — Sinhala (සිංහල අකුරින් ලියන්න), Tamil (தமிழ்), English or code-switched Tanglish. Examples: mata cake ekak one, හාල් 5kg, Colombo 07, Kandy, Panadol, machan.";

const SINHALA_HINT =
  "කථිකයා සිංහලෙන් කතා කරයි — සිංහල අකුරින් ලියන්න. උදාහරණ: මට කේක් එකක් ඕන, හාල් කිලෝ පහක් ගන්න, කොළඹ හතට ගෙන්නන්න පුළුවන්ද, අම්මට මල් ටිකක්. English brand names stay in English (Panadol, Kapruka).";

/** Sticky choice of the transcription model that actually works here. */
let workingModel: string | null = null;

// Expected scripts: Latin, Sinhala (0D80–0DFF), Tamil (0B80–0BFF). Anything
// substantial outside those (Devanagari…Malayalam, Thai, CJK, Hangul,
// Arabic) means auto-detect picked the wrong script for the audio.
function wrongScript(text: string): boolean {
  const stripped = text.replace(/\s/g, "");
  if (!stripped) return false;
  const other = stripped.match(/[ऀ-୿ఀ-ൿ฀-࿿؀-ۿ一-鿿가-힯]/g)?.length ?? 0;
  return other > Math.max(2, stripped.length * 0.2);
}

interface Opts {
  tamil?: boolean;
  sinhalaBias?: boolean;
}

async function transcribe(key: string, model: string, blob: Blob, type: string, opts: Opts) {
  const ext = type.includes("mp4") ? "mp4" : type.includes("ogg") ? "ogg" : type.includes("mpeg") || type.includes("mp3") ? "mp3" : "webm";
  const form = new FormData();
  form.append("file", new File([blob], `audio.${ext}`, { type }));
  form.append("model", model);
  form.append("prompt", opts.sinhalaBias ? SINHALA_HINT : DOMAIN_HINT);
  if (opts.tamil) form.append("language", "ta");
  return fetch("https://api.openai.com/v1/audio/transcriptions", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}` },
    body: form,
    signal: AbortSignal.timeout(30000),
  });
}

async function transcribeSmart(key: string, blob: Blob, type: string, opts: Opts): Promise<string | null> {
  const primary = workingModel ?? process.env.KAPU_STT_MODEL ?? "gpt-4o-mini-transcribe";
  let res = await transcribe(key, primary, blob, type, opts);
  if (res.ok) {
    workingModel = primary;
  } else if (primary !== "whisper-1") {
    console.error(`[stt] ${primary} failed (${res.status}): ${(await res.text()).slice(0, 150)} — using whisper-1`);
    res = await transcribe(key, "whisper-1", blob, type, opts);
    if (res.ok) workingModel = "whisper-1";
  }
  if (!res.ok) {
    console.error("[stt] transcription failed:", res.status, (await res.text()).slice(0, 200));
    return null;
  }
  const data = (await res.json()) as { text?: string };
  return (data.text ?? "").trim();
}

export async function POST(req: Request): Promise<Response> {
  const key = process.env.OPENAI_API_KEY?.trim();
  if (!key) {
    return Response.json({ error: "STT not configured (set OPENAI_API_KEY)" }, { status: 501 });
  }

  const language = new URL(req.url).searchParams.get("language");
  const blob = await req.blob();
  if (!blob.size) return Response.json({ error: "empty audio" }, { status: 400 });
  if (blob.size > 20 * 1024 * 1024) return Response.json({ error: "audio too large" }, { status: 413 });
  const type = blob.type || "audio/webm";

  try {
    const opts: Opts = language === "ta" ? { tamil: true } : language === "si" ? { sinhalaBias: true } : {};
    let text = await transcribeSmart(key, blob, type, opts);
    if (text == null) return Response.json({ error: "transcription failed" }, { status: 502 });
    // Auto-detect picked an implausible script — one Sinhala-biased retry
    // (Sinhala is the dominant spoken case on Kapruka).
    if (!opts.tamil && !opts.sinhalaBias && wrongScript(text)) {
      const retry = await transcribeSmart(key, blob, type, { sinhalaBias: true });
      if (retry && !wrongScript(retry)) text = retry;
    }
    return Response.json({ text });
  } catch (err) {
    console.error("[stt] error:", err);
    return Response.json({ error: "transcription failed" }, { status: 502 });
  }
}
