// Rolling thread context for WhatsApp group chats.
//
// In a group, Kapu only SPEAKS when addressed — but it should still have
// heard the conversation, or "@kapu order that one" is meaningless. Every
// group message goes into a small per-chat ring buffer; when Kapu is finally
// addressed, the recent thread rides along in the turn.
//
// Deliberately NOT the model history: this is per-turn context, so it goes in
// the user turn and the system prompt stays byte-stable ([[system-prompt]]).

interface ThreadLine {
  who: string;
  text: string;
  at: number;
}

const MAX_LINES = 14;
const TTL_MS = 45 * 60_000; // a group's context goes stale fast
const MAX_CHATS = 500;

const threads = new Map<string, ThreadLine[]>();

/** Record anything said in a chat, addressed to Kapu or not. */
export function rememberLine(chat: string, who: string, text: string): void {
  const clean = text.trim().slice(0, 400);
  if (!clean) return;
  const now = Date.now();
  const lines = (threads.get(chat) ?? []).filter((l) => now - l.at < TTL_MS);
  lines.push({ who: who.slice(0, 40) || "someone", text: clean, at: now });
  threads.set(chat, lines.slice(-MAX_LINES));

  // Crude LRU: drop the least-recently-active chat rather than grow forever.
  if (threads.size > MAX_CHATS) {
    const lastSeen = (l: ThreadLine[]) => l[l.length - 1]?.at ?? 0;
    const oldest = [...threads.entries()].sort((a, b) => lastSeen(a[1]) - lastSeen(b[1]))[0];
    if (oldest) threads.delete(oldest[0]);
  }
}

/**
 * The recent conversation, excluding the message being answered (the caller
 * passes that in as the turn itself). Empty string when there's nothing
 * worth including.
 */
export function threadContext(chat: string, excludeText: string): string {
  const now = Date.now();
  const lines = (threads.get(chat) ?? []).filter((l) => now - l.at < TTL_MS);
  // Drop the trailing line if it IS the message we're about to answer.
  const body = lines.filter((l, i) => !(i === lines.length - 1 && l.text === excludeText.trim().slice(0, 400)));
  if (body.length < 2) return "";
  return [
    "[Recent group chat — for context only. Reply to the last message; do NOT answer these:]",
    ...body.slice(-MAX_LINES).map((l) => `${l.who}: ${l.text}`),
    "[end of context]",
  ].join("\n");
}

/** Called when a chat is reset so stale context can't leak into a new topic. */
export function forgetThread(chat: string): void {
  threads.delete(chat);
}
