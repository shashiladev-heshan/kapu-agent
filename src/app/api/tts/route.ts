// POST /api/tts — text-to-speech with provider routing per language.
//
//   si → Azure (si-LK neural) → OpenAI (multilingual, attempts Sinhala) → 204
//   ta → Azure (ta-LK) → ElevenLabs → OpenAI → 204
//   en → ElevenLabs (Flash v2.5) → OpenAI → Azure → 204
//
// Any single provider key is enough (e.g. just OPENAI_API_KEY covers all
// languages). A 204 tells the client to fall back to browser speechSynthesis.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const OPENAI_KEY = () => process.env.OPENAI_API_KEY?.trim();
const OPENAI_TTS_MODEL = () => process.env.OPENAI_TTS_MODEL?.trim() || "gpt-4o-mini-tts";
const OPENAI_TTS_VOICE = () => process.env.OPENAI_TTS_VOICE?.trim() || "coral";

const ELEVEN_KEY = () => process.env.ELEVENLABS_API_KEY?.trim();
const ELEVEN_VOICE = () => process.env.ELEVENLABS_VOICE_ID?.trim() || "21m00Tcm4TlvDq8ikWAM";
const AZURE_KEY = () => process.env.AZURE_SPEECH_KEY?.trim();
const AZURE_REGION = () => process.env.AZURE_SPEECH_REGION?.trim() || "southeastasia";

const AZURE_VOICES: Record<string, string> = {
  si: "si-LK-ThiliniNeural",
  ta: "ta-LK-SaranyaNeural",
  en: "en-US-JennyNeural",
};

async function elevenLabs(text: string): Promise<Response | null> {
  const key = ELEVEN_KEY();
  if (!key) return null;
  const res = await fetch(
    `https://api.elevenlabs.io/v1/text-to-speech/${ELEVEN_VOICE()}?output_format=mp3_44100_128`,
    {
      method: "POST",
      headers: { "xi-api-key": key, "Content-Type": "application/json" },
      body: JSON.stringify({ text, model_id: "eleven_flash_v2_5" }),
    }
  );
  if (!res.ok || !res.body) {
    console.error("[tts] ElevenLabs failed:", res.status, (await res.text()).slice(0, 200));
    return null;
  }
  return new Response(res.body, { headers: { "Content-Type": "audio/mpeg" } });
}

// Per-language delivery steering for gpt-4o-mini-tts — this is what makes
// the voice sound like a warm Sri Lankan concierge rather than a generic
// reader, and keeps Sinhala/Tamil pronunciation on track.
const OPENAI_INSTRUCTIONS: Record<string, string> = {
  si: "Speak as a warm, friendly Sri Lankan woman having a natural colloquial Sinhala conversation. The text may be Sinhala script (සිංහල) or ROMANIZED Sinhala (like 'mama lassana cake hayak hoyaagaththa') mixed with English product names. Pronounce romanized Sinhala words exactly as a native Sri Lankan speaks them — short vowels, soft 'th'/'dh', natural rhythm — and English words with a soft Sri Lankan accent. Conversational, like chatting with family. Never spell out or anglicize the Sinhala words.",
  ta: "Speak as a warm, friendly Sri Lankan Tamil woman in natural colloquial Tamil. The text is Tamil script possibly mixed with English product names — pronounce Tamil fluently, English with a soft Sri Lankan accent. Conversational pace.",
  en: "Speak as a warm, cheerful Sri Lankan shopping concierge. Friendly retail energy, soft Sri Lankan English accent. If romanized Sinhala words appear (like 'machan', 'ela', 'aiyo'), pronounce them naturally as a Sri Lankan would.",
};

async function openaiTts(text: string, language: string): Promise<Response | null> {
  const key = OPENAI_KEY();
  if (!key) return null;
  const model = OPENAI_TTS_MODEL();
  const res = await fetch("https://api.openai.com/v1/audio/speech", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      voice: OPENAI_TTS_VOICE(),
      input: text,
      response_format: "mp3",
      // `instructions` is supported by gpt-4o-mini-tts (ignored shapes 400 on tts-1)
      ...(model.startsWith("gpt-") ? { instructions: OPENAI_INSTRUCTIONS[language] ?? OPENAI_INSTRUCTIONS.en } : {}),
    }),
  });
  if (!res.ok || !res.body) {
    console.error("[tts] OpenAI failed:", res.status, (await res.text()).slice(0, 200));
    return null;
  }
  return new Response(res.body, { headers: { "Content-Type": "audio/mpeg" } });
}

async function azure(text: string, language: string): Promise<Response | null> {
  const key = AZURE_KEY();
  if (!key) return null;
  const voice = AZURE_VOICES[language] ?? AZURE_VOICES.en;
  const lang = voice.split("-").slice(0, 2).join("-");
  const ssml = `<speak version='1.0' xml:lang='${lang}'><voice name='${voice}'>${text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")}</voice></speak>`;
  const res = await fetch(`https://${AZURE_REGION()}.tts.speech.microsoft.com/cognitiveservices/v1`, {
    method: "POST",
    headers: {
      "Ocp-Apim-Subscription-Key": key,
      "Content-Type": "application/ssml+xml",
      "X-Microsoft-OutputFormat": "audio-24khz-48kbitrate-mono-mp3",
    },
    body: ssml,
  });
  if (!res.ok || !res.body) {
    console.error("[tts] Azure failed:", res.status, (await res.text()).slice(0, 200));
    return null;
  }
  return new Response(res.body, { headers: { "Content-Type": "audio/mpeg" } });
}

export async function POST(req: Request): Promise<Response> {
  let body: { text?: string; language?: string };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const text = (body.text ?? "").trim().slice(0, 1200);
  const language = body.language === "si" || body.language === "ta" ? body.language : "en";
  if (!text) return Response.json({ error: "text required" }, { status: 400 });

  // Azure first for Sinhala/Tamil — its si-LK/ta-LK neural voices are the
  // only truly natural ones; OpenAI is the capable fallback.
  const providers =
    language === "si"
      ? [() => azure(text, language), () => openaiTts(text, language)]
      : language === "ta"
        ? [() => azure(text, language), () => elevenLabs(text), () => openaiTts(text, language)]
        : [() => elevenLabs(text), () => openaiTts(text, language), () => azure(text, language)];

  for (const p of providers) {
    try {
      const res = await p();
      if (res) return res;
    } catch (err) {
      console.error("[tts] provider error:", err);
    }
  }
  // No server-side voice available — client uses browser speechSynthesis.
  return new Response(null, { status: 204 });
}
