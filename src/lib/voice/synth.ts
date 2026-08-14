// Server-side TTS → WhatsApp-ready OGG/Opus voice-note bytes.
//
// WhatsApp voice notes (PTT) must be OGG/Opus. Azure's si-LK/ta-LK/en-US neural
// voices can return ogg-opus DIRECTLY (no transcode) — that's the reliable
// floor for all three languages. English additionally PREFERS ElevenLabs (the
// premium web voice), whose MP3 we transcode to ogg/opus with system ffmpeg;
// if ffmpeg is unavailable we fall straight back to Azure's en voice, so the
// feature never depends on a transcoder being present.

import { spawn } from "node:child_process";
import ffmpegStatic from "ffmpeg-static";
import type { Language } from "@/lib/types";

// The bundled ffmpeg binary (with libopus); falls back to a system ffmpeg on
// PATH if the package ever resolves null. Used to transcode ElevenLabs/OpenAI
// MP3 → OGG/Opus, the format WhatsApp voice notes require.
const FFMPEG_BIN: string = ffmpegStatic || "ffmpeg";

const AZURE_KEY = () => process.env.AZURE_SPEECH_KEY?.trim();
const AZURE_REGION = () => process.env.AZURE_SPEECH_REGION?.trim() || "southeastasia";
const ELEVEN_KEY = () => process.env.ELEVENLABS_API_KEY?.trim();
// Sarah — warm, works on ElevenLabs FREE + paid (Rachel/21m00… is paid-only). [[voice-loop]]
const ELEVEN_VOICE = () => process.env.ELEVENLABS_VOICE_ID?.trim() || "EXAVITQu4vr4xnSDxMaL";
const OPENAI_KEY = () => process.env.OPENAI_API_KEY?.trim();
const OPENAI_TTS_MODEL = () => process.env.OPENAI_TTS_MODEL?.trim() || "gpt-4o-mini-tts";
const OPENAI_TTS_VOICE = () => process.env.OPENAI_TTS_VOICE?.trim() || "coral";

const AZURE_VOICES: Record<string, string> = {
  si: "si-LK-ThiliniNeural",
  ta: "ta-LK-SaranyaNeural",
  en: "en-US-JennyNeural",
};
// Kept in sync with /api/tts — same steering makes romanized Sinhala/Tamil read
// naturally instead of anglicised.
const OPENAI_INSTRUCTIONS: Record<string, string> = {
  si: "Speak as a warm, friendly Sri Lankan woman in natural colloquial Sinhala. The text may be Sinhala script or ROMANIZED Sinhala mixed with English product names — pronounce romanized Sinhala exactly as a native speaks it, English with a soft Sri Lankan accent. Never anglicise the Sinhala words.",
  ta: "Speak as a warm Sri Lankan Tamil woman in natural colloquial Tamil, English product names with a soft Sri Lankan accent.",
  en: "Speak as a warm, cheerful Sri Lankan shopping concierge. Soft Sri Lankan English accent; pronounce any 'machan'/'aiyo'/'ela' naturally.",
};

/** Azure neural TTS returned as OGG/Opus (WhatsApp-native — no transcode). */
async function azureOgg(text: string, language: string): Promise<Buffer | null> {
  const key = AZURE_KEY();
  if (!key) return null;
  const voice = AZURE_VOICES[language] ?? AZURE_VOICES.en;
  const lang = voice.split("-").slice(0, 2).join("-");
  const escaped = text.replace(/&/g, "&amp;").replace(/</g, "&lt;");
  const ssml = `<speak version='1.0' xml:lang='${lang}'><voice name='${voice}'><prosody rate='+6%' pitch='+2%'>${escaped}</prosody></voice></speak>`;
  const res = await fetch(`https://${AZURE_REGION()}.tts.speech.microsoft.com/cognitiveservices/v1`, {
    method: "POST",
    headers: {
      "Ocp-Apim-Subscription-Key": key,
      "Content-Type": "application/ssml+xml",
      "X-Microsoft-OutputFormat": "ogg-24khz-16bit-mono-opus",
    },
    body: ssml,
    signal: AbortSignal.timeout(25_000),
  });
  if (!res.ok) return null;
  const b = Buffer.from(await res.arrayBuffer());
  return b.length ? b : null;
}

async function elevenLabsMp3(text: string): Promise<Buffer | null> {
  const key = ELEVEN_KEY();
  if (!key) return null;
  const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${ELEVEN_VOICE()}?output_format=mp3_44100_128`, {
    method: "POST",
    headers: { "xi-api-key": key, "Content-Type": "application/json" },
    body: JSON.stringify({ text, model_id: "eleven_flash_v2_5" }),
    signal: AbortSignal.timeout(25_000),
  });
  if (!res.ok) return null;
  const b = Buffer.from(await res.arrayBuffer());
  return b.length ? b : null;
}

async function openaiMp3(text: string, language: string): Promise<Buffer | null> {
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
      ...(model.startsWith("gpt-") ? { instructions: OPENAI_INSTRUCTIONS[language] ?? OPENAI_INSTRUCTIONS.en } : {}),
    }),
    signal: AbortSignal.timeout(25_000),
  });
  if (!res.ok) return null;
  const b = Buffer.from(await res.arrayBuffer());
  return b.length ? b : null;
}

/** MP3 → OGG/Opus via ffmpeg. null if ffmpeg is unavailable (callers fall back
 *  to a provider that already emits ogg, e.g. Azure). */
function transcodeToOgg(mp3: Buffer): Promise<Buffer | null> {
  return new Promise((resolve) => {
    let ff;
    try {
      ff = spawn(FFMPEG_BIN, ["-hide_banner", "-loglevel", "error", "-i", "pipe:0", "-c:a", "libopus", "-b:a", "32k", "-ar", "24000", "-ac", "1", "-f", "ogg", "pipe:1"], {
        stdio: ["pipe", "pipe", "ignore"],
      });
    } catch {
      return resolve(null);
    }
    const out: Buffer[] = [];
    ff.stdout.on("data", (c: Buffer) => out.push(c));
    ff.on("error", () => resolve(null)); // ffmpeg not on PATH
    ff.on("close", (code) => resolve(code === 0 && out.length ? Buffer.concat(out) : null));
    ff.stdin.on("error", () => {});
    ff.stdin.write(mp3);
    ff.stdin.end();
  });
}

async function elevenLabsOgg(text: string): Promise<Buffer | null> {
  const mp3 = await elevenLabsMp3(text);
  return mp3 ? transcodeToOgg(mp3) : null;
}
async function openaiOgg(text: string, language: string): Promise<Buffer | null> {
  const mp3 = await openaiMp3(text, language);
  return mp3 ? transcodeToOgg(mp3) : null;
}

// Content words of romanized Sinhala (the persona's closed "Singlish" list).
// Pure interjections (aiyo/machan/ela/ane) are deliberately EXCLUDED — they ride
// along in English too and would misroute an English reply. ≥2 hits ⇒ the reply
// is Sinhala written in Latin, which must still avoid the English voice.
const SI_ROMAN =
  /\b(mata|mama|oyata|oya|eyata|eya|apita|api|mage|oyage|eyage|ekak|ekka|meka|karanna|karannam|karamu|karanawa|karanne|wenna|wenawa|wela|thiyenawa|thiyenne|innawa|inne|ganna|denna|yawanna|hoyanna|hoyala|balanna|kiyanna|kiyala|dannawa|hithanne|puluwan|puluwanda|ona|epa|thamai|issella|gedara|hodai|hodama|lassana|amarui|tikak|godak|mokakda|monawada|koheda)\b/gi;

/** Route spoken text to a voice. Sinhala/Tamil — native script OR romanized —
 *  NEVER use ElevenLabs (that voice is English-only): native script → Azure
 *  neural (Thilini/Saranya), romanized Sinhala → OpenAI (reads Latin-Sinhala
 *  with a Sri Lankan accent). Only genuine English reaches ElevenLabs. */
function routeVoiceLang(text: string): { lang: Language; native: boolean } {
  if (/[඀-෿]/.test(text)) return { lang: "si", native: true };
  if (/[஀-௿]/.test(text)) return { lang: "ta", native: true };
  if ((text.match(SI_ROMAN) || []).length >= 2) return { lang: "si", native: false };
  return { lang: "en", native: true };
}

/** say() text → OGG/Opus voice-note bytes for WhatsApp, or null if no provider
 *  produced usable audio. Language is detected from the text itself, because
 *  session.language is not tracked on WhatsApp. si/ta NEVER touch ElevenLabs. */
export async function synthesizeVoiceNote(text: string): Promise<Buffer | null> {
  const t = text.trim().slice(0, 1000);
  if (!t) return null;
  const { lang, native } = routeVoiceLang(t);
  const chain =
    lang === "en"
      ? [() => elevenLabsOgg(t), () => azureOgg(t, "en"), () => openaiOgg(t, "en")] // English → ElevenLabs first
      : native
        ? [() => azureOgg(t, lang), () => openaiOgg(t, lang)] // native si/ta script → Azure neural
        : [() => openaiOgg(t, lang)]; // romanized Sinhala → OpenAI only (never ElevenLabs)
  for (const p of chain) {
    try {
      const b = await p();
      if (b && b.length) return b;
    } catch {
      /* try next provider */
    }
  }
  return null;
}

/** Rough spoken duration (seconds) for the WhatsApp voice-note bubble. */
export function estimateSeconds(text: string): number {
  const words = text.trim().split(/\s+/).filter(Boolean).length;
  return Math.max(1, Math.min(300, Math.round(words / 2.6)));
}
