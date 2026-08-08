// Per-conversation state: message history + live cart + the UI transcript
// (used to rehydrate the visible chat when a judge refreshes or reopens a
// recent wish). Primary store is in-memory (one long-running Railway
// container); MongoDB, when configured, persists across redeploys.

import type Anthropic from "@anthropic-ai/sdk";
import type { Cart, Currency, Language, Occasion, Recipient, UiTurn } from "@/lib/types";
import { persistSession, loadSession } from "@/lib/db/mongo";

export interface Session {
  id: string;
  messages: Anthropic.MessageParam[];
  cart: Cart;
  language: Language;
  currency: Currency;
  updatedAt: number;
  /** visible transcript (text + blocks) for reload/recent-wish rehydration */
  ui: UiTurn[];
  /** short human title — the first user message, trimmed */
  title?: string;
  /** guest memory: saved recipients + occasions (account memory when signed in) */
  recipients: Recipient[];
  occasions: Occasion[];
  /** Claude Agent SDK transcript id (agent-sdk engine only) */
  sdkSessionId?: string;
  /** transient: current turn arrived via the voice loop */
  voice?: boolean;
  /** transient: signed-in Google sub for this turn (account memory) */
  userSub?: string;
  /** transient: last quick-reply chips shown in Telegram (callback lookup) */
  tgChips?: string[];
  /** transient: the user's ♥ favorites for this turn's context */
  favorites?: string[];
  /** transient: "My Kapu" standing rules (custom instructions) */
  userRules?: string;
  /** transient: active specialist Kapu for this turn (name + instructions) */
  agentSpec?: { name: string; instructions: string };
  /** transient: a turn is currently executing server-side */
  busy?: boolean;
  /** transient: automated scheduled run (no human present) */
  scheduled?: boolean;
  /** transient: standing order consent for this scheduled run */
  allowOrder?: boolean;
  /** transient: "Deliver to X" chip — the user's default city */
  deliverTo?: string;
  /** transient: preferred delivery date picked on a product card */
  preferredDate?: string;
}

const sessions = new Map<string, Session>();
const MAX_SESSIONS = 5000;
const MAX_MESSAGES = 60; // trim long conversations (keep tool_use/result pairs intact)
const MAX_UI_TURNS = 120;

export async function getSession(id: string): Promise<Session> {
  let s = sessions.get(id);
  if (!s) {
    const restored = (await loadSession(id)) as Session | null;
    s = restored ?? {
      id,
      messages: [],
      cart: { items: [], currency: "LKR" },
      language: "en",
      currency: "LKR",
      updatedAt: Date.now(),
      ui: [],
      recipients: [],
      occasions: [],
    };
    if (!Array.isArray(s.ui)) s.ui = [];
    if (!Array.isArray(s.recipients)) s.recipients = [];
    if (!Array.isArray(s.occasions)) s.occasions = [];
    sessions.set(id, s);
    evictIfNeeded();
  }
  return s;
}

/** Peek without creating an empty session (GET /api/session). */
export async function peekSession(id: string): Promise<Session | null> {
  const live = sessions.get(id);
  if (live) return live;
  const restored = (await loadSession(id)) as Session | null;
  if (restored) {
    if (!Array.isArray(restored.ui)) restored.ui = [];
    if (!Array.isArray(restored.recipients)) restored.recipients = [];
    if (!Array.isArray(restored.occasions)) restored.occasions = [];
    sessions.set(id, restored);
    evictIfNeeded();
  }
  return restored;
}

export function appendUiTurn(s: Session, turn: UiTurn) {
  s.ui.push(turn);
  if (s.ui.length > MAX_UI_TURNS) s.ui = s.ui.slice(s.ui.length - MAX_UI_TURNS);
}

export function trimHistory(s: Session) {
  if (s.messages.length <= MAX_MESSAGES) return;
  // Drop oldest turns, but never start history on an orphaned tool_result.
  let start = s.messages.length - MAX_MESSAGES;
  while (start < s.messages.length) {
    const m = s.messages[start];
    const isOrphanToolResult =
      m.role === "user" &&
      Array.isArray(m.content) &&
      m.content.some((b) => (b as { type?: string }).type === "tool_result");
    if (!isOrphanToolResult && m.role === "user") break;
    start++;
  }
  s.messages = s.messages.slice(start);
}

/** Fork the conversation for an edited/resent user message: keep only the
 *  first `keep` real user turns in BOTH the Anthropic history and the UI
 *  transcript, dropping everything from the (keep+1)-th user turn onward. Cuts
 *  strictly at a user-turn boundary, so a tool_use is never orphaned from its
 *  result. (Messages engine reads session.messages directly; the Agent SDK
 *  keeps its own transcript via resume, so edit-fork is exact only on the
 *  Messages engine — the hosted/judged path.) */
export function truncateToUserTurns(s: Session, keep: number) {
  if (keep < 0) return;
  let uiSeen = 0;
  let uiCut = s.ui.length;
  for (let i = 0; i < s.ui.length; i++) {
    if (s.ui[i].role === "user") {
      if (uiSeen === keep) { uiCut = i; break; }
      uiSeen++;
    }
  }
  s.ui = s.ui.slice(0, uiCut);

  let msgSeen = 0;
  let msgCut = s.messages.length;
  for (let i = 0; i < s.messages.length; i++) {
    const m = s.messages[i];
    const isToolResult =
      m.role === "user" &&
      Array.isArray(m.content) &&
      m.content.some((b) => (b as { type?: string }).type === "tool_result");
    if (m.role === "user" && !isToolResult) {
      if (msgSeen === keep) { msgCut = i; break; }
      msgSeen++;
    }
  }
  s.messages = s.messages.slice(0, msgCut);
}

export function saveSession(s: Session) {
  s.updatedAt = Date.now();
  sessions.set(s.id, s);
  void persistSession(s); // fire-and-forget; no-op without MONGODB_URI
}

function evictIfNeeded() {
  if (sessions.size <= MAX_SESSIONS) return;
  const oldest = [...sessions.values()].sort((a, b) => a.updatedAt - b.updatedAt);
  for (const s of oldest.slice(0, sessions.size - MAX_SESSIONS)) sessions.delete(s.id);
}
