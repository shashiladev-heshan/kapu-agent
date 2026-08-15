/* eslint-disable @typescript-eslint/no-explicit-any */
// Phase-2 account tools — normalizers for Kapruka's hostile customer payloads
// and the email ground-rule resolver. Shapes (verified live): keys with spaces
// ("first name", "order date", "product id"), money as {value:"1530"} (string
// value, not amount), phones with "<BR" glued on, dates as Java-toString EDT
// ("Mon Aug 03 07:18:12 EDT 2026") or "1 / MARCH / 2027", and "NA" / "*" /
// "NO PERSONAL MESSAGE" / "0000" null-sentinels.

import type Anthropic from "@anthropic-ai/sdk";
import type { Session } from "@/lib/session/store";

const SENTINELS = new Set(["", "na", "n/a", "*", "no personal message", "0000"]);

/** Clean a string field: strip the "<BR" tail, collapse space, null the sentinels. */
export function clean(v: unknown, max = 200): string | null {
  if (typeof v !== "string") return null;
  const s = v.replace(/<BR.*$/i, "").replace(/\s+/g, " ").trim();
  if (!s || SENTINELS.has(s.toLowerCase())) return null;
  return s.slice(0, max);
}

/** LKR number from {value|amount}, a comma-string, or a number. */
export function moneyLkr(v: unknown): number | null {
  if (typeof v === "number") return v > 0 ? v : null;
  if (v && typeof v === "object") return moneyLkr((v as any).value ?? (v as any).amount);
  if (typeof v === "string") {
    const n = Number(v.replace(/,/g, "").trim());
    return isFinite(n) && n > 0 ? n : null;
  }
  return null;
}

/** Format a Kapruka date for display. NEVER Date.parse — the EDT strings carry
 *  US wall-clock with no real TZ intent; regex-format instead. */
export function fmtDate(v: unknown): string | null {
  const s = clean(v);
  if (!s) return null;
  let m = /(\d{1,2})\s*\/\s*([A-Za-z]+)\s*\/\s*(\d{4})/.exec(s); // "1 / MARCH / 2027"
  if (m) return `${Number(m[1])} ${m[2][0]}${m[2].slice(1).toLowerCase()} ${m[3]}`;
  m = /^[A-Za-z]{3}\s+([A-Za-z]{3})\s+(\d{1,2})\s+[\d:]+\s+\w+\s+(\d{4})/.exec(s); // Java toString
  if (m) return `${m[1]} ${Number(m[2])}, ${m[3]}`;
  return s;
}

/** The MCP returns account errors as plain text with isError:false, e.g.
 *  "Error (email_not_allowed): …" or "Error: This tool requires…". Sniff the
 *  generic prefix BEFORE parseJson — don't match the preview wording. */
export function sniffError(text: string): { code: string | null; message: string } | null {
  const m = /^Error\s*(?:\(([a-z_]+)\))?:\s*(.+)/is.exec(text.trim());
  return m ? { code: m[1] ?? null, message: m[2].trim().replace(/\s+/g, " ").slice(0, 300) } : null;
}

function userText(m: Anthropic.MessageParam): string {
  if (m.role !== "user") return "";
  if (typeof m.content === "string") return m.content;
  return (m.content as any[]).filter((b) => b?.type === "text").map((b) => b.text).join(" ");
}

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const EMAIL_SCAN = /[^@\s]+@[^@\s]+\.[^@\s]+/g;

/** The most recent email the CUSTOMER typed in this conversation. Ground-rule
 *  compliant (they entered it themselves), and it recovers the account when
 *  session.account didn't carry between turns — so a follow-up like "show my
 *  addresses" after a successful link doesn't wrongly ask them to re-type it. */
function lastTypedEmail(session: Session): string | null {
  for (let i = session.messages.length - 1; i >= 0; i--) {
    const m = session.messages[i];
    if (m.role !== "user") continue;
    const found = userText(m).match(EMAIL_SCAN);
    if (found?.length) return found[found.length - 1].toLowerCase();
  }
  return null;
}

/** Ground rule (enforced in code, not just prompt): only use an email the
 *  CUSTOMER typed in this conversation, or the one already linked. Never a
 *  guessed/looped address. Returns the usable email or null. */
export function resolveAccountEmail(session: Session, explicit?: string): string | null {
  const linked = session.account?.email ?? null;
  const e = explicit?.trim().toLowerCase();
  // An explicit email is honoured ONLY if the customer actually typed it — never
  // a guessed/looped address the model invented. If it wasn't typed, fall through
  // rather than dead-ending, so we still use what we legitimately have.
  if (e && EMAIL_RE.test(e)) {
    if (linked && linked.toLowerCase() === e) return linked;
    const typed = session.messages.some((m) => m.role === "user" && userText(m).toLowerCase().includes(e));
    if (typed) return e;
  }
  // The linked account, else the most recent email the customer typed themselves
  // (recovers a link that didn't survive between turns).
  return linked ?? lastTypedEmail(session);
}

// ── normalized shapes ──────────────────────────────────────────────────
export interface AcctProfile {
  name: string;
  email: string;
  phone: string | null;
  language: string | null;
}
export function normalizeCustomer(raw: any): AcctProfile | null {
  const c = raw?.customer ?? raw;
  if (!c || typeof c !== "object") return null;
  const parts = [clean(c["first name"]), clean(c["last name"])].filter(Boolean).join(" ");
  const name = clean(c["full name"]) ?? (parts || "there");
  return {
    name,
    email: clean(c.email) ?? "",
    phone: clean(c.phone) ?? clean(c.billing?.phone),
    language: clean(c.language),
  };
}

export interface AcctOrderItem {
  name: string;
  qty: number;
  product_id: string;
  price_lkr: number | null;
}
export interface AcctOrder {
  ref: string;
  status: string;
  when: string | null;
  delivery_date: string | null;
  total_lkr: number | null;
  recipient: string | null;
  city: string | null;
  greeting: string | null;
  items: AcctOrderItem[];
}
export function normalizeOrders(raw: any): AcctOrder[] {
  const arr = Array.isArray(raw?.orders) ? raw.orders : [];
  return arr
    .map((o: any) => ({
      ref: clean(o.reference, 40) ?? "",
      status: clean(o.status) ?? "unknown",
      when: fmtDate(o["order date"]),
      delivery_date: fmtDate(o["delivery date"]),
      total_lkr: moneyLkr(o.amount),
      recipient: clean(o.recipient?.name, 60),
      city: clean(o.recipient?.city, 60),
      greeting: clean(o["greeting message"], 160),
      items: (Array.isArray(o.items) ? o.items : []).map((i: any) => ({
        name: clean(i.name, 120) ?? "Item",
        qty: Number(i.quantity) || 1,
        product_id: clean(i["product id"], 80) ?? "",
        price_lkr: moneyLkr(i["line total"] ?? i["unit price"] ?? i["selling price"]),
      })),
    }))
    .filter((o: AcctOrder) => o.ref);
}

export interface AcctAddress {
  name: string;
  address: string;
  city: string | null;
  phone: string | null;
}
export function normalizeAddresses(raw: any): AcctAddress[] {
  const book = Array.isArray(raw?.["address book"]) ? raw["address book"] : [];
  const recents = Array.isArray(raw?.["recent delivery addresses"]) ? raw["recent delivery addresses"] : [];
  const out: AcctAddress[] = [];
  const seen = new Set<string>();
  const push = (name: unknown, address: unknown, city: unknown, phone: unknown) => {
    const a: AcctAddress = { name: clean(name, 60) ?? "", address: clean(address, 200) ?? "", city: clean(city, 60), phone: clean(phone, 20) };
    if (!a.address) return;
    const k = `${a.name}|${a.address}|${a.phone}`.toLowerCase().replace(/\s+/g, "");
    if (seen.has(k)) return;
    seen.add(k);
    out.push(a);
  };
  for (const b of book) push(b.name, b.address, b.city, b.mobile); // book first — nicely cased, wins the dedupe
  for (const r of recents) push(r.name, r.address, r.city, r.phone);
  return out.slice(0, 8);
}
