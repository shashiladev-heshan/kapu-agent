// Optional MongoDB persistence. The app is fully functional without it
// (in-memory sessions); when MONGODB_URI is set, sessions and orders are
// persisted so carts survive redeploys and order refs are auditable.

import mongoose, { Schema, type Model } from "mongoose";

const URI = process.env.MONGODB_URI;

let connected: Promise<typeof mongoose> | null = null;

function db(): Promise<typeof mongoose> | null {
  if (!URI) return null;
  if (!connected) {
    connected = mongoose.connect(URI, { serverSelectionTimeoutMS: 4000 }).catch((err) => {
      console.error("[mongo] connection failed — continuing in-memory:", err.message);
      connected = null;
      throw err;
    });
  }
  return connected;
}

interface SessionDoc {
  _id: string;
  messages: unknown[];
  cart: unknown;
  language: string;
  currency: string;
  ui: unknown[];
  title?: string;
  recipients: unknown[];
  occasions: unknown[];
  updatedAt: Date;
}

interface OrderDoc {
  session_id: string;
  user_sub?: string;
  order_ref: string;
  pay_url: string;
  cart: unknown;
  recipient: unknown;
  delivery: unknown;
  created_at: Date;
}

interface UserDoc {
  _id: string; // Google sub
  email?: string;
  name?: string;
  picture?: string;
  wishes: unknown[];
  recipients: unknown[];
  occasions: unknown[];
  agents: unknown[];
  tgChatId?: number;
  updatedAt: Date;
}

interface ScheduleDoc {
  _id: string;
  data: unknown;
  updatedAt: Date;
}

function models(): { Session: Model<SessionDoc>; Order: Model<OrderDoc>; User: Model<UserDoc>; Sched: Model<ScheduleDoc> } {
  const Session =
    (mongoose.models.KapuSession as Model<SessionDoc>) ??
    mongoose.model<SessionDoc>(
      "KapuSession",
      new Schema<SessionDoc>(
        {
          _id: String,
          messages: Array,
          cart: Object,
          language: String,
          currency: String,
          ui: Array,
          title: String,
          recipients: Array,
          occasions: Array,
          updatedAt: Date,
        },
        { versionKey: false }
      )
    );
  const Order =
    (mongoose.models.KapuOrder as Model<OrderDoc>) ??
    mongoose.model<OrderDoc>(
      "KapuOrder",
      new Schema<OrderDoc>(
        {
          session_id: { type: String, index: true },
          user_sub: { type: String, index: true },
          order_ref: String,
          pay_url: String,
          cart: Object,
          recipient: Object,
          delivery: Object,
          created_at: { type: Date, default: Date.now },
        },
        { versionKey: false }
      )
    );
  const User =
    (mongoose.models.KapuUser as Model<UserDoc>) ??
    mongoose.model<UserDoc>(
      "KapuUser",
      new Schema<UserDoc>(
        {
          _id: String,
          email: String,
          name: String,
          picture: String,
          wishes: Array,
          recipients: Array,
          occasions: Array,
          agents: Array,
          tgChatId: Number,
          updatedAt: Date,
        },
        { versionKey: false }
      )
    );
  const Sched =
    (mongoose.models.KapuSchedule as Model<ScheduleDoc>) ??
    mongoose.model<ScheduleDoc>(
      "KapuSchedule",
      new Schema<ScheduleDoc>({ _id: String, data: Object, updatedAt: Date }, { versionKey: false })
    );
  return { Session, Order, User, Sched };
}

// Per-session write chain: saveSession fires twice within the same tick at
// turn end (agent loop + route finally), and two fire-and-forget updateOnes
// race on parallel pool sockets — the stale one can land LAST and silently
// drop the just-appended assistant turn. Serializing per id makes the final
// write always carry the freshest session state.
const persistChains = new Map<string, Promise<void>>();

export function persistSession(s: {
  id: string;
  messages: unknown[];
  cart: unknown;
  language: string;
  currency: string;
  ui?: unknown[];
  title?: string;
  recipients?: unknown[];
  occasions?: unknown[];
}): Promise<void> {
  const prev = persistChains.get(s.id) ?? Promise.resolve();
  const next = prev.then(() => persistSessionNow(s));
  persistChains.set(s.id, next);
  void next.finally(() => {
    if (persistChains.get(s.id) === next) persistChains.delete(s.id);
  });
  return next;
}

async function persistSessionNow(s: Parameters<typeof persistSession>[0]): Promise<void> {
  const conn = db();
  if (!conn) return;
  try {
    await conn;
    const { Session } = models();
    await Session.updateOne(
      { _id: s.id },
      {
        $set: {
          messages: s.messages,
          cart: s.cart,
          language: s.language,
          currency: s.currency,
          ui: s.ui ?? [],
          ...(s.title ? { title: s.title } : {}),
          recipients: s.recipients ?? [],
          occasions: s.occasions ?? [],
          updatedAt: new Date(),
        },
      },
      { upsert: true }
    );
  } catch (err) {
    // best-effort, but say so — silent loss cost us a debugging session
    console.error("[mongo] persistSession failed:", err instanceof Error ? err.message.slice(0, 200) : err);
  }
}

export interface PersistedSession {
  id: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  messages: any[];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  cart: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  language: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  currency: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ui: any[];
  title?: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  recipients: any[];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  occasions: any[];
  updatedAt: number;
}

export async function loadSession(id: string): Promise<PersistedSession | null> {
  const conn = db();
  if (!conn) return null;
  try {
    await conn;
    const { Session } = models();
    const doc = await Session.findById(id).lean();
    if (!doc) return null;
    return {
      id,
      messages: doc.messages ?? [],
      cart: doc.cart ?? { items: [], currency: "LKR" },
      language: doc.language ?? "en",
      currency: doc.currency ?? "LKR",
      ui: doc.ui ?? [],
      title: doc.title,
      recipients: doc.recipients ?? [],
      occasions: doc.occasions ?? [],
      updatedAt: Date.now(),
    };
  } catch {
    return null;
  }
}

export async function persistUserDoc(u: {
  sub: string;
  email?: string;
  name?: string;
  picture?: string;
  wishes: unknown[];
  recipients?: unknown[];
  occasions?: unknown[];
  agents?: unknown[];
  tgChatId?: number;
}): Promise<void> {
  const conn = db();
  if (!conn) return;
  try {
    await conn;
    const { User } = models();
    await User.updateOne(
      { _id: u.sub },
      {
        $set: {
          email: u.email,
          name: u.name,
          picture: u.picture,
          wishes: u.wishes,
          recipients: u.recipients ?? [],
          occasions: u.occasions ?? [],
          agents: u.agents ?? [],
          ...(u.tgChatId ? { tgChatId: u.tgChatId } : {}),
          updatedAt: new Date(),
        },
      },
      { upsert: true }
    );
  } catch {
    /* best-effort */
  }
}

export async function loadUserDoc(sub: string): Promise<{
  sub: string;
  email?: string;
  name?: string;
  picture?: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  wishes: any[];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  recipients: any[];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  occasions: any[];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  agents: any[];
  tgChatId?: number;
  updatedAt: number;
} | null> {
  const conn = db();
  if (!conn) return null;
  try {
    await conn;
    const { User } = models();
    const doc = await User.findById(sub).lean();
    if (!doc) return null;
    return {
      sub,
      email: doc.email,
      name: doc.name,
      picture: doc.picture,
      wishes: doc.wishes ?? [],
      recipients: doc.recipients ?? [],
      occasions: doc.occasions ?? [],
      agents: doc.agents ?? [],
      tgChatId: doc.tgChatId,
      updatedAt: Date.now(),
    };
  } catch {
    return null;
  }
}

export async function persistSchedule(sched: { id: string }): Promise<void> {
  const conn = db();
  if (!conn) return;
  try {
    await conn;
    const { Sched } = models();
    await Sched.updateOne({ _id: sched.id }, { $set: { data: sched, updatedAt: new Date() } }, { upsert: true });
  } catch {
    /* best-effort */
  }
}

export async function removeSchedule(id: string): Promise<void> {
  const conn = db();
  if (!conn) return;
  try {
    await conn;
    const { Sched } = models();
    await Sched.deleteOne({ _id: id });
  } catch {
    /* best-effort */
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function loadSchedules(): Promise<any[]> {
  const conn = db();
  if (!conn) return [];
  try {
    await conn;
    const { Sched } = models();
    const docs = await Sched.find().lean();
    return docs.map((d) => d.data).filter(Boolean);
  } catch {
    return [];
  }
}

export interface OrderRecord {
  session_id: string;
  user_sub?: string;
  order_ref: string;
  pay_url: string;
  cart: unknown;
  recipient: unknown;
  delivery: unknown;
  created_at?: Date;
}

// In-memory mirror so "what did I order?" works even without MongoDB.
const recentOrders: OrderRecord[] = [];

export async function recordOrder(order: OrderRecord): Promise<void> {
  recentOrders.unshift({ ...order, created_at: new Date() });
  if (recentOrders.length > 200) recentOrders.pop();
  const conn = db();
  if (!conn) return;
  try {
    await conn;
    const { Order } = models();
    await Order.create(order);
  } catch {
    /* best-effort */
  }
}

/** Last few orders for this session (guest) or account (signed in). */
export async function listOrders(sessionId: string, userSub?: string, limit = 5): Promise<OrderRecord[]> {
  const conn = db();
  if (conn) {
    try {
      await conn;
      const { Order } = models();
      const docs = await Order.find(
        userSub ? { $or: [{ session_id: sessionId }, { user_sub: userSub }] } : { session_id: sessionId }
      )
        .sort({ created_at: -1 })
        .limit(limit)
        .lean();
      if (docs.length) return docs as unknown as OrderRecord[];
    } catch {
      /* fall through to memory */
    }
  }
  return recentOrders
    .filter((o) => o.session_id === sessionId || (userSub && o.user_sub === userSub))
    .slice(0, limit);
}

// ── taste-engine event log (so recommendations survive redeploys) ───────
interface RecoEventDoc {
  key: string;
  pid?: string | null;
  name: string;
  category?: string | null;
  price?: number | null;
  image?: string | null;
  url?: string | null;
  weight: number;
  at: Date;
}

function recoModel(): Model<RecoEventDoc> {
  return (
    (mongoose.models.KapuRecoEvent as Model<RecoEventDoc>) ??
    mongoose.model<RecoEventDoc>(
      "KapuRecoEvent",
      new Schema<RecoEventDoc>(
        {
          key: { type: String, index: true },
          pid: String,
          name: String,
          category: String,
          price: Number,
          image: String,
          url: String,
          weight: Number,
          at: { type: Date, index: true },
        },
        { versionKey: false }
      )
    )
  );
}

export async function persistRecoEvent(doc: { key: string; pid: string | null; name: string; category?: string | null; price?: number | null; image?: string | null; url?: string | null; weight: number }): Promise<void> {
  const conn = db();
  if (!conn) return;
  try {
    await conn;
    await recoModel().create({ ...doc, at: new Date() });
  } catch {
    /* best-effort */
  }
}

export async function loadRecoEvents(keys: string[], limit = 240): Promise<{ key: string; pid?: string | null; name: string; category?: string | null; price?: number | null; image?: string | null; url?: string | null; weight: number; at: Date }[]> {
  const conn = db();
  if (!conn) return [];
  try {
    await conn;
    return (await recoModel().find({ key: { $in: keys } }).sort({ at: -1 }).limit(limit).lean()) as unknown as {
      key: string; pid?: string | null; name: string; category?: string | null; price?: number | null; image?: string | null; url?: string | null; weight: number; at: Date;
    }[];
  } catch {
    return [];
  }
}

// ── homepage rail fallback cache — live MCP always first; this fills the
// hero rails (seasonal/discover/deals) when MCP is down AND the process is
// fresh (in-process stale cache empty). Never used for agent search.
interface RailCacheDoc {
  _id: string;
  payload: unknown;
  at: Date;
}

function railModel(): Model<RailCacheDoc> {
  return (
    (mongoose.models.KapuRailCache as Model<RailCacheDoc>) ??
    mongoose.model<RailCacheDoc>(
      "KapuRailCache",
      new Schema<RailCacheDoc>({ _id: String, payload: Schema.Types.Mixed, at: Date }, { versionKey: false })
    )
  );
}

export async function saveRailCache(key: string, payload: unknown): Promise<void> {
  const conn = db();
  if (!conn) return;
  try {
    await conn;
    await railModel().updateOne({ _id: key }, { $set: { payload, at: new Date() } }, { upsert: true });
  } catch {
    /* best-effort */
  }
}

/** Last good batch for a rail, if fresh enough (default 72 h). */
export async function loadRailCache<T>(key: string, maxAgeMs = 72 * 3600_000): Promise<T | null> {
  const conn = db();
  if (!conn) return null;
  try {
    await conn;
    const doc = await railModel().findById(key).lean();
    if (!doc || Date.now() - new Date(doc.at).getTime() > maxAgeMs) return null;
    return doc.payload as T;
  } catch {
    return null;
  }
}

// ── knowledge-base chunks (kapruka.com policies/FAQs/company pages) ────
// Chroma is the primary store; this mirror survives Chroma downtime and
// cold-starts the in-process fallback without re-crawling or re-embedding.
interface KbChunkDoc {
  _id: string;
  url: string;
  title: string;
  section: string;
  text: string;
  vec: number[];
  at: Date;
}

function kbModel(): Model<KbChunkDoc> {
  return (
    (mongoose.models.KapuKbChunk as Model<KbChunkDoc>) ??
    mongoose.model<KbChunkDoc>(
      "KapuKbChunk",
      new Schema<KbChunkDoc>(
        { _id: String, url: String, title: String, section: String, text: String, vec: Array, at: Date },
        { versionKey: false }
      )
    )
  );
}

export async function saveKbChunks(
  chunks: { id: string; url: string; title: string; section: string; text: string; vec: number[] }[]
): Promise<void> {
  const conn = db();
  if (!conn || !chunks.length) return;
  try {
    await conn;
    const at = new Date();
    await kbModel().bulkWrite(
      chunks.map((c) => ({
        replaceOne: {
          filter: { _id: c.id },
          replacement: { _id: c.id, url: c.url, title: c.title, section: c.section, text: c.text, vec: c.vec, at },
          upsert: true,
        },
      }))
    );
    await kbModel().deleteMany({ at: { $lt: at } }); // drop chunks gone from the site
  } catch (err) {
    console.error("[mongo] saveKbChunks failed:", err instanceof Error ? err.message.slice(0, 160) : err);
  }
}

export async function loadKbChunks(): Promise<
  { id: string; url: string; title: string; section: string; text: string; vec: number[]; at: Date }[]
> {
  const conn = db();
  if (!conn) return [];
  try {
    await conn;
    const docs = await kbModel().find({}).lean();
    return docs.map((d) => ({ id: d._id, url: d.url, title: d.title, section: d.section, text: d.text, vec: d.vec ?? [], at: d.at }));
  } catch {
    return [];
  }
}
