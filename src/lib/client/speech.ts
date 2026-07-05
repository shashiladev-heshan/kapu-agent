"use client";

// Browser speech helpers for Kapu's voice loop:
//  - createRecognizer(): wraps the Web Speech API (free, no key; Chrome
//    supports si-LK Sinhala recognition natively)
//  - VoicePlayer: plays /api/tts audio, falling back to the browser's
//    speechSynthesis when the server has no TTS provider configured (204)
//  - sanitizeForSpeech(): strips markdown/emoji/URLs so cards & formatting
//    aren't read aloud

import type { Language } from "@/lib/types";

const STT_LANG: Record<Language, string> = { en: "en-IN", si: "si-LK", ta: "ta-LK" };
const SYNTH_LANG: Record<Language, string> = { en: "en-US", si: "si-LK", ta: "ta-IN" };

export function sanitizeForSpeech(text: string): string {
  return text
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/^\|.*\|$/gm, " ") // table rows
    .replace(/https?:\/\/\S+/g, " ")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/[*_#>`~|]/g, "")
    .replace(/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}\u{200D}\u{2190}-\u{21FF}]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// ── speech recognition (voice in) ─────────────────────────────────────

interface RecognizerHandlers {
  onInterim: (text: string) => void;
  onFinal: (text: string) => void;
  onError: (error: string) => void;
  onEnd: () => void;
}

// Minimal typings for the vendor-prefixed Web Speech API
type SpeechRecognitionLike = {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  maxAlternatives: number;
  start: () => void;
  stop: () => void;
  abort: () => void;
  onresult: ((event: { resultIndex: number; results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }> }) => void) | null;
  onerror: ((event: { error: string }) => void) | null;
  onend: (() => void) | null;
};

export function speechRecognitionSupported(): boolean {
  if (typeof window === "undefined") return false;
  const w = window as unknown as Record<string, unknown>;
  return Boolean(w.SpeechRecognition || w.webkitSpeechRecognition);
}

/** Some Chromium forks (Brave notably) expose the Web Speech API but block
 *  the recognition backend — it "listens" forever and never returns a word.
 *  Detect them up front so the voice loop starts on the Whisper recorder
 *  path instead of silently failing. */
export async function webSpeechLikelyBroken(): Promise<boolean> {
  if (typeof navigator === "undefined") return false;
  try {
    const brave = (navigator as unknown as { brave?: { isBrave?: () => Promise<boolean> } }).brave;
    if (brave?.isBrave && (await brave.isBrave())) return true;
  } catch {
    /* not Brave */
  }
  return false;
}

export function createRecognizer(language: Language, handlers: RecognizerHandlers): SpeechRecognitionLike | null {
  const w = window as unknown as Record<string, unknown>;
  const Ctor = (w.SpeechRecognition || w.webkitSpeechRecognition) as (new () => SpeechRecognitionLike) | undefined;
  if (!Ctor) return null;

  const r = new Ctor();
  r.lang = STT_LANG[language];
  r.interimResults = true;
  r.continuous = false;
  r.maxAlternatives = 1;

  let finalText = "";
  let lastHeard = "";
  let aborted = false;
  // iOS WebKit never auto-ends on silence and rarely flags isFinal — the
  // transcript just sits there while "Listening" spins forever. Finalize
  // ourselves: when the transcript stops changing for 1.6s, stop() the
  // recognizer and treat what we heard as final. Harmless on Chrome, whose
  // native endpointing fires sooner.
  let stallTimer: ReturnType<typeof setTimeout> | null = null;
  const clearStall = () => {
    if (stallTimer) clearTimeout(stallTimer);
    stallTimer = null;
  };
  const armStall = () => {
    clearStall();
    stallTimer = setTimeout(() => {
      try {
        r.stop();
      } catch {
        /* already stopped */
      }
    }, 1200);
  };
  r.onresult = (event) => {
    let interim = "";
    for (let i = event.resultIndex; i < event.results.length; i++) {
      const res = event.results[i];
      if (res.isFinal) finalText += res[0].transcript;
      else interim += res[0].transcript;
    }
    lastHeard = (finalText + interim).trim();
    handlers.onInterim(finalText + interim);
    if (lastHeard) armStall();
  };
  r.onerror = (event) => {
    clearStall();
    handlers.onError(event.error);
  };
  r.onend = () => {
    clearStall();
    // isFinal results when the engine provides them; the last interim
    // transcript when it doesn't (iOS). Never send after an abort.
    const text = (finalText.trim() || lastHeard).trim();
    finalText = "";
    lastHeard = "";
    if (text && !aborted) handlers.onFinal(text);
    handlers.onEnd();
  };
  const origAbort = r.abort.bind(r);
  r.abort = () => {
    aborted = true;
    clearStall();
    origAbort();
  };
  return r;
}

// ── recorder + Whisper fallback (voice in, non-Chrome browsers) ───────

export class VoiceRecorder {
  private recorder: MediaRecorder | null = null;
  private chunks: Blob[] = [];
  private stream: MediaStream | null = null;

  async start(): Promise<void> {
    this.stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    this.chunks = [];
    this.recorder = new MediaRecorder(this.stream);
    this.recorder.ondataavailable = (e) => {
      if (e.data.size) this.chunks.push(e.data);
    };
    this.recorder.start();
  }

  /** Stop recording and transcribe via /api/stt (OpenAI Whisper). */
  stopAndTranscribe(language: Language): Promise<string> {
    return new Promise((resolve) => {
      const rec = this.recorder;
      if (!rec || rec.state === "inactive") return resolve("");
      rec.onstop = async () => {
        this.stream?.getTracks().forEach((t) => t.stop());
        const blob = new Blob(this.chunks, { type: rec.mimeType || "audio/webm" });
        this.recorder = null;
        this.stream = null;
        this.chunks = [];
        if (blob.size < 1000) return resolve("");
        try {
          const res = await fetch(`/api/stt?language=${language}`, {
            method: "POST",
            headers: { "Content-Type": blob.type },
            body: blob,
          });
          if (!res.ok) return resolve("");
          const data = (await res.json()) as { text?: string };
          resolve((data.text ?? "").trim());
        } catch {
          resolve("");
        }
      };
      rec.stop();
    });
  }

  cancel(): void {
    try {
      if (this.recorder && this.recorder.state !== "inactive") {
        this.recorder.onstop = null;
        this.recorder.stop();
      }
    } catch {
      /* already stopped */
    }
    this.stream?.getTracks().forEach((t) => t.stop());
    this.recorder = null;
    this.stream = null;
    this.chunks = [];
  }
}

// ── voice player (voice out) ──────────────────────────────────────────

export class VoicePlayer {
  private audio: HTMLAudioElement | null = null;
  private el: HTMLAudioElement | null = null;
  private stopped = false;

  /** Call from a user-gesture handler (the mic tap). iOS only allows
   *  audio.play() on elements that have played during a gesture — one
   *  silent play here unlocks the shared element for every reply after. */
  unlock(): void {
    if (this.el || typeof window === "undefined") return;
    this.el = new Audio();
    this.el.src =
      "data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAIA+AAACABAAZGF0YQAAAAA=";
    void this.el.play().catch(() => {
      /* pre-unlock is best-effort */
    });
  }

  /** Speak text; resolves when playback finishes (or immediately on stop()). */
  async speak(rawText: string, language: Language): Promise<void> {
    const text = sanitizeForSpeech(rawText);
    if (!text) return;
    this.stopped = false;

    try {
      const res = await fetch("/api/tts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text, language }),
      });
      if (this.stopped) return;
      if (res.ok && res.status !== 204) {
        const blob = await res.blob();
        if (this.stopped) return;
        await this.playBlob(blob);
        return;
      }
    } catch {
      /* fall through to browser synthesis */
    }
    if (!this.stopped) await this.speakWithBrowser(text, language);
  }

  /** Fire-and-forget short acknowledgment ("හරි, බලන්නම්!") — played from a
   *  prefetched blob the instant the user stops talking. The real reply's
   *  speak() simply takes over the shared element when it arrives. */
  playAck(blob: Blob): Promise<void> {
    this.stopped = false;
    return this.playBlob(blob);
  }

  stop(): void {
    this.stopped = true;
    if (this.audio) {
      this.audio.pause();
      if (this.audio !== this.el) this.audio.src = "";
      this.audio = null;
    }
    if (typeof window !== "undefined" && "speechSynthesis" in window) {
      window.speechSynthesis.cancel();
    }
  }

  private playBlob(blob: Blob): Promise<void> {
    return new Promise((resolve) => {
      const url = URL.createObjectURL(blob);
      // reuse the gesture-unlocked element on iOS; fresh element elsewhere
      const audio = this.el ?? new Audio();
      audio.src = url;
      this.audio = audio;
      const done = () => {
        URL.revokeObjectURL(url);
        if (this.audio === audio) this.audio = null;
        resolve();
      };
      audio.onended = done;
      audio.onerror = done;
      audio.play().catch(done);
    });
  }

  private speakWithBrowser(text: string, language: Language): Promise<void> {
    return new Promise((resolve) => {
      if (!("speechSynthesis" in window)) return resolve();
      const utter = new SpeechSynthesisUtterance(text);
      const lang = SYNTH_LANG[language];
      utter.lang = lang;
      const voices = window.speechSynthesis.getVoices();
      const match =
        voices.find((v) => v.lang.toLowerCase() === lang.toLowerCase()) ||
        voices.find((v) => v.lang.toLowerCase().startsWith(lang.split("-")[0]));
      if (match) utter.voice = match;
      utter.rate = 1.05;
      utter.onend = () => resolve();
      utter.onerror = () => resolve();
      window.speechSynthesis.speak(utter);
    });
  }
}
