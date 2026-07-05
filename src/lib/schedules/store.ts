// Kapu Schedules — standing wishes that run without a human present
// (spec §16.1). Owned by a signed-in Google user; results delivered via
// their linked Telegram chat (or the web notification center). Money never
// moves autonomously: create_order only mints a pay link, and even that
// requires the standing consent granted at schedule creation.

import crypto from "crypto";
import { loadSchedules, persistSchedule, removeSchedule } from "@/lib/db/mongo";

export interface Cadence {
  kind: "once" | "daily" | "weekly" | "monthly" | "yearly";
  /** HH:mm, Sri Lanka time */
  at: string;
  /** once: YYYY-MM-DD · yearly: MM-DD */
  date?: string;
  /** weekly: 0 (Sun) – 6 (Sat) */
  weekday?: number;
  /** monthly: 1–31 (clamped) */
  day?: number;
}

export interface Schedule {
  id: string;
  sub: string; // owner (Google sub) — auth required
  title: string;
  instruction: string;
  kind: "task" | "watch_order";
  orderNumber?: string; // watch_order
  cadence: Cadence;
  allowOrder: boolean;
  active: boolean;
  nextRun: number; // epoch ms
  lastRun?: number;
  lastResult?: string;
  lastStatus?: string; // watch_order change detection
  createdAt: number;
}

const schedules = new Map<string, Schedule>();
let hydrated = false;

async function hydrate() {
  if (hydrated) return;
  hydrated = true;
  const docs = await loadSchedules().catch(() => []);
  for (const d of docs) schedules.set(d.id, d as Schedule);
}

/** Sri-Lanka wall-clock parts for an epoch. */
function slParts(epoch: number) {
  const d = new Date(new Date(epoch).toLocaleString("en-US", { timeZone: "Asia/Colombo" }));
  return { y: d.getFullYear(), m: d.getMonth(), d: d.getDate(), wd: d.getDay(), h: d.getHours(), min: d.getMinutes() };
}

/** epoch for SL wall-clock y/m/d hh:mm (+05:30, no DST). */
function slEpoch(y: number, m: number, d: number, hh: number, mm: number): number {
  return Date.UTC(y, m, d, hh, mm) - 5.5 * 3600_000;
}

export function computeNextRun(c: Cadence, fromEpoch = Date.now()): number {
  const [hh, mm] = (c.at || "09:00").split(":").map(Number);
  const now = slParts(fromEpoch);
  const today = (plusDays = 0) => {
    const base = new Date(Date.UTC(now.y, now.m, now.d + plusDays));
    return slEpoch(base.getUTCFullYear(), base.getUTCMonth(), base.getUTCDate(), hh, mm);
  };
  if (c.kind === "once") {
    const [y, mo, da] = (c.date ?? "").split("-").map(Number);
    return y ? slEpoch(y, mo - 1, da, hh, mm) : today(1);
  }
  if (c.kind === "daily") {
    const t = today(0);
    return t > fromEpoch ? t : today(1);
  }
  if (c.kind === "weekly") {
    const target = c.weekday ?? 1;
    for (let i = 0; i < 8; i++) {
      const cand = today(i);
      const wd = (now.wd + i) % 7;
      if (wd === target && cand > fromEpoch) return cand;
    }
    return today(7);
  }
  if (c.kind === "monthly") {
    const want = Math.min(Math.max(c.day ?? 1, 1), 31);
    for (let add = 0; add < 3; add++) {
      const m = now.m + add;
      const y = now.y + Math.floor(m / 12);
      const mm2 = m % 12;
      const lastDay = new Date(Date.UTC(y, mm2 + 1, 0)).getUTCDate();
      const cand = slEpoch(y, mm2, Math.min(want, lastDay), hh, mm);
      if (cand > fromEpoch) return cand;
    }
  }
  if (c.kind === "yearly") {
    const [mo, da] = (c.date ?? "01-01").split("-").map(Number);
    for (let add = 0; add < 2; add++) {
      const cand = slEpoch(now.y + add, (mo || 1) - 1, da || 1, hh, mm);
      if (cand > fromEpoch) return cand;
    }
  }
  return fromEpoch + 24 * 3600_000;
}

export async function listSchedules(sub: string): Promise<Schedule[]> {
  await hydrate();
  return [...schedules.values()].filter((s) => s.sub === sub).sort((a, b) => a.nextRun - b.nextRun);
}

export async function dueSchedules(now = Date.now()): Promise<Schedule[]> {
  await hydrate();
  return [...schedules.values()].filter((s) => s.active && s.nextRun <= now);
}

export async function createSchedule(
  input: Omit<Schedule, "id" | "nextRun" | "active" | "createdAt">
): Promise<Schedule> {
  await hydrate();
  const mine = [...schedules.values()].filter((s) => s.sub === input.sub);
  if (mine.length >= 10) throw new Error("Schedule limit reached (10) — cancel one first.");
  const s: Schedule = {
    ...input,
    id: crypto.randomUUID().slice(0, 8),
    active: true,
    // watchers start almost immediately; tasks follow their cadence
    nextRun: input.kind === "watch_order" ? Date.now() + 2 * 60_000 : computeNextRun(input.cadence),
    createdAt: Date.now(),
  };
  schedules.set(s.id, s);
  void persistSchedule(s);
  return s;
}

export async function updateSchedule(s: Schedule): Promise<void> {
  schedules.set(s.id, s);
  void persistSchedule(s);
}

export async function cancelSchedule(sub: string, id: string): Promise<boolean> {
  await hydrate();
  const s = schedules.get(id);
  if (!s || s.sub !== sub) return false;
  schedules.delete(id);
  void removeSchedule(id);
  return true;
}

export async function toggleSchedule(sub: string, id: string): Promise<Schedule | null> {
  await hydrate();
  const s = schedules.get(id);
  if (!s || s.sub !== sub) return null;
  s.active = !s.active;
  if (s.active) s.nextRun = computeNextRun(s.cadence);
  void persistSchedule(s);
  return s;
}

// ── Telegram linking (web account ↔ TG chat) ───────────────────────────
const linkCodes = new Map<string, { chatId: number; expires: number }>();

export function issueLinkCode(chatId: number): string {
  const code = crypto.randomInt(100000, 999999).toString();
  linkCodes.set(code, { chatId, expires: Date.now() + 10 * 60_000 });
  return code;
}

export function redeemLinkCode(code: string): number | null {
  const hit = linkCodes.get(code.trim());
  if (!hit || hit.expires < Date.now()) return null;
  linkCodes.delete(code.trim());
  return hit.chatId;
}
