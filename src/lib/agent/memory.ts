// Kapu's people-and-occasions memory (spec D2/H1/H2). One access layer with
// two backings: the signed-in user's account (cross-device, Mongo) or the
// guest session (device-scoped). Consent-first — the persona only calls
// remember_* after the user says yes.

import crypto from "crypto";
import { getUser, saveUser } from "@/lib/auth/users";
import type { Session } from "@/lib/session/store";
import type { Occasion, Recipient } from "@/lib/types";

const MAX_RECIPIENTS = 20;
const MAX_OCCASIONS = 30;

interface Memory {
  recipients: Recipient[];
  occasions: Occasion[];
  /** where this memory lives — surfaced to the model for honest copy */
  scope: "account" | "device";
  save: () => void;
}

async function getMemory(session: Session): Promise<Memory> {
  if (session.userSub) {
    const user = await getUser(session.userSub);
    if (user) {
      return {
        recipients: user.recipients,
        occasions: user.occasions,
        scope: "account",
        save: () => saveUser(user),
      };
    }
  }
  return {
    recipients: session.recipients,
    occasions: session.occasions,
    scope: "device",
    // the chat loop persists the session at end of turn
    save: () => {},
  };
}

export async function listPeople(session: Session): Promise<{ recipients: Recipient[]; occasions: Occasion[]; scope: string }> {
  const m = await getMemory(session);
  return { recipients: m.recipients, occasions: m.occasions, scope: m.scope };
}

export async function rememberRecipient(session: Session, input: Partial<Recipient> & { name: string }): Promise<{ recipient: Recipient; scope: string }> {
  const m = await getMemory(session);
  const name = input.name.trim().slice(0, 60);
  const existing = m.recipients.find((r) => r.name.toLowerCase() === name.toLowerCase());
  const clean = (v: unknown, max = 120) => (typeof v === "string" && v.trim() ? v.trim().slice(0, max) : undefined);
  const merged: Recipient = {
    id: existing?.id ?? crypto.randomUUID().slice(0, 8),
    name,
    relationship: clean(input.relationship, 40) ?? existing?.relationship,
    phone: clean(input.phone, 20) ?? existing?.phone,
    address: clean(input.address, 250) ?? existing?.address,
    city: clean(input.city, 60) ?? existing?.city,
    notes: clean(input.notes, 160) ?? existing?.notes,
  };
  if (existing) {
    m.recipients[m.recipients.indexOf(existing)] = merged;
  } else {
    m.recipients.unshift(merged);
    if (m.recipients.length > MAX_RECIPIENTS) m.recipients.pop();
  }
  m.save();
  return { recipient: merged, scope: m.scope };
}

export async function forgetRecipient(session: Session, name: string): Promise<boolean> {
  const m = await getMemory(session);
  const idx = m.recipients.findIndex((r) => r.name.toLowerCase() === name.trim().toLowerCase());
  if (idx === -1) return false;
  const removed = m.recipients.splice(idx, 1)[0];
  // drop their occasions too
  for (let i = m.occasions.length - 1; i >= 0; i--) {
    if (m.occasions[i].recipient.toLowerCase() === removed.name.toLowerCase()) m.occasions.splice(i, 1);
  }
  m.save();
  return true;
}

export async function rememberOccasion(
  session: Session,
  input: { recipient: string; type: string; date: string; recurring?: boolean }
): Promise<{ occasion: Occasion; scope: string } | { error: string }> {
  const date = input.date.trim();
  if (!/^(\d{4}-)?\d{2}-\d{2}$/.test(date)) {
    return { error: "date must be YYYY-MM-DD or MM-DD (for yearly occasions)" };
  }
  const m = await getMemory(session);
  const recipient = input.recipient.trim().slice(0, 60);
  const type = input.type.trim().slice(0, 40);
  const recurring = input.recurring !== false && (date.length === 5 || /birthday|anniversary|avurudu|christmas/i.test(type));
  const existing = m.occasions.find(
    (o) => o.recipient.toLowerCase() === recipient.toLowerCase() && o.type.toLowerCase() === type.toLowerCase()
  );
  const merged: Occasion = {
    id: existing?.id ?? crypto.randomUUID().slice(0, 8),
    recipient,
    type,
    date,
    recurring,
  };
  if (existing) m.occasions[m.occasions.indexOf(existing)] = merged;
  else {
    m.occasions.unshift(merged);
    if (m.occasions.length > MAX_OCCASIONS) m.occasions.pop();
  }
  m.save();
  return { occasion: merged, scope: m.scope };
}

/** Days until an occasion's next occurrence (SL time). */
export function daysUntil(o: Occasion, now = new Date()): number | null {
  const todaySL = new Date(now.toLocaleString("en-US", { timeZone: "Asia/Colombo" }));
  todaySL.setHours(0, 0, 0, 0);
  const mmdd = o.date.length === 5 ? o.date : o.date.slice(5);
  const [mm, dd] = mmdd.split("-").map(Number);
  if (!mm || !dd) return null;
  if (o.date.length === 10 && !o.recurring) {
    const d = new Date(`${o.date}T00:00:00+05:30`);
    return Math.round((d.getTime() - todaySL.getTime()) / 86400000);
  }
  const year = todaySL.getFullYear();
  let next = new Date(year, mm - 1, dd);
  if (next.getTime() < todaySL.getTime()) next = new Date(year + 1, mm - 1, dd);
  return Math.round((next.getTime() - todaySL.getTime()) / 86400000);
}

export async function upcomingOccasions(session: Session, horizonDays = 60): Promise<(Occasion & { in_days: number })[]> {
  const m = await getMemory(session);
  return m.occasions
    .map((o) => ({ ...o, in_days: daysUntil(o) ?? 9999 }))
    .filter((o) => o.in_days >= 0 && o.in_days <= horizonDays)
    .sort((a, b) => a.in_days - b.in_days)
    .slice(0, 8);
}
