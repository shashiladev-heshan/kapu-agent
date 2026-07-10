// Signed-in user profiles + their synced wish list ("recent wishes" across
// devices). In-memory first, MongoDB-backed when configured — same pattern
// as the session store.

import type { AuthUser } from "@/lib/auth/session";
import type { Occasion, Recipient } from "@/lib/types";
import { loadUserDoc, persistUserDoc } from "@/lib/db/mongo";

export interface WishMeta {
  id: string;
  title: string;
  at: number;
}

/** a user-built specialist Kapu (the presets live client-side in code) */
export interface CustomAgent {
  id: string;
  name: string;
  emoji: string;
  tagline?: string;
  instructions: string;
}

export interface UserRecord extends AuthUser {
  wishes: WishMeta[];
  recipients: Recipient[];
  occasions: Occasion[];
  agents: CustomAgent[];
  tgChatId?: number;
  updatedAt: number;
}

const users = new Map<string, UserRecord>();
const MAX_USERS = 5000;
const MAX_WISHES = 20;

export async function getUser(sub: string): Promise<UserRecord | null> {
  let u = users.get(sub) ?? null;
  if (!u) {
    u = (await loadUserDoc(sub)) as UserRecord | null;
    if (u) {
      if (!Array.isArray(u.wishes)) u.wishes = [];
      if (!Array.isArray(u.recipients)) u.recipients = [];
      if (!Array.isArray(u.occasions)) u.occasions = [];
      if (!Array.isArray(u.agents)) u.agents = [];
      users.set(sub, u);
      evict();
    }
  }
  return u;
}

export async function upsertUser(profile: AuthUser): Promise<UserRecord> {
  const existing = await getUser(profile.sub);
  const record: UserRecord = {
    ...existing,
    ...profile,
    wishes: existing?.wishes ?? [],
    recipients: existing?.recipients ?? [],
    occasions: existing?.occasions ?? [],
    agents: existing?.agents ?? [],
    updatedAt: Date.now(),
  };
  users.set(profile.sub, record);
  evict();
  void persistUserDoc(record);
  return record;
}

/** Persist any in-place mutation of a user record (recipients/occasions). */
export function saveUser(record: UserRecord): void {
  record.updatedAt = Date.now();
  users.set(record.sub, record);
  void persistUserDoc(record);
}

/** Merge a device's wish list into the account (newest-first, dedup by id). */
export async function mergeWishes(sub: string, incoming: WishMeta[]): Promise<WishMeta[]> {
  const user = await getUser(sub);
  if (!user) return [];
  const byId = new Map<string, WishMeta>();
  for (const w of [...incoming, ...user.wishes]) {
    if (!w?.id || typeof w.title !== "string") continue;
    const prev = byId.get(w.id);
    if (!prev || (w.at ?? 0) > (prev.at ?? 0)) {
      byId.set(w.id, { id: String(w.id).slice(0, 64), title: w.title.slice(0, 80), at: Number(w.at) || Date.now() });
    }
  }
  user.wishes = [...byId.values()].sort((a, b) => b.at - a.at).slice(0, MAX_WISHES);
  user.updatedAt = Date.now();
  users.set(sub, user);
  void persistUserDoc(user);
  return user.wishes;
}

function evict() {
  if (users.size <= MAX_USERS) return;
  const oldest = [...users.values()].sort((a, b) => a.updatedAt - b.updatedAt);
  for (const u of oldest.slice(0, users.size - MAX_USERS)) users.delete(u.sub);
}
