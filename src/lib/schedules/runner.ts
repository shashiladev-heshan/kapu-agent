// The autonomous heart of Kapu Schedules: a 60s in-process tick (the Railway
// monolith is a long-running Node server) that executes due schedules through
// the SAME agent core, then delivers results to the owner's linked channels —
// Telegram and/or WhatsApp. Kinds:
//  · task        — a full agent run in a persistent per-schedule session
//                  (recurring runs keep memory of previous ones)
//  · watch_order — deterministic tracking poll, messages only on change,
//                  celebrates delivery, then keeps watching briefly for the
//                  delivery-proof photo before resting (no LLM cost)
//  · watch_price — price poll, one alert on a ≥2% drop, then rests
// Safety: create_order only mints a pay link; the human always pays. Even
// that requires the standing consent recorded on the schedule (allowOrder).

import { runTurn } from "@/lib/agent/loop";
import { getUser } from "@/lib/auth/users";
import { kapruka, parseJson } from "@/lib/kapruka/shield";
import { money } from "@/lib/kapruka/normalize";
import { getSession, saveSession } from "@/lib/session/store";
import { dueSchedules, computeNextRun, updateSchedule, type Schedule } from "@/lib/schedules/store";
import { esc, mdToTelegram, sendMessage, telegramEnabled } from "@/lib/telegram/api";
import { deliverBlocks } from "@/lib/telegram/handler";
import { mdToWhatsapp, sendText, whatsappEnabled } from "@/lib/whatsapp/api";
import { deliverBlocksWa } from "@/lib/whatsapp/handler";
import type { StreamEvent, UiBlock } from "@/lib/types";

let started = false;
let running = false;

export function startScheduler(): void {
  if (started) return;
  started = true;
  console.log("[schedules] runner started (60s tick)");
  setInterval(() => {
    void tick();
  }, 60_000);
  // first pass shortly after boot (let the server settle)
  setTimeout(() => void tick(), 10_000);
}

async function tick(): Promise<void> {
  if (running) return;
  running = true;
  try {
    const due = await dueSchedules();
    for (const s of due.slice(0, 3)) {
      // advance nextRun FIRST so a crash can't cause a rapid-fire loop
      s.lastRun = Date.now();
      // watchers re-poll every 3h until delivered; tasks follow their cadence
      s.nextRun =
        s.kind === "watch_order" ? Date.now() + 3 * 3600_000
        : s.kind === "watch_price" ? Date.now() + 6 * 3600_000
        : computeNextRun(s.cadence, Date.now() + 60_000);
      if (s.kind === "task" && s.cadence.kind === "once") s.active = false;
      await updateSchedule(s);
      try {
        if (s.kind === "watch_order" && s.orderNumber) await runOrderWatch(s);
        else if (s.kind === "watch_price" && s.productId) await runPriceWatch(s);
        else await runTask(s);
      } catch (err) {
        console.error(`[schedules] ${s.id} failed:`, err);
        // lastResult is user-facing (web bell + Standing wishes sheet) —
        // upstream hiccups get friendly copy, never a raw exception string
        const raw = err instanceof Error ? err.message : "unknown error";
        const transient = /non-JSON|HTTP\s*5\d\d|rate.?limit|429|too many|timed?.?out|ECONN|fetch failed|network|socket/i.test(raw);
        s.lastResult = transient ? RETRY_NOTE : `Run failed: ${raw.slice(0, 160)}`;
        await updateSchedule(s);
      }
    }
  } finally {
    running = false;
  }
}

async function ownerChannels(s: Schedule): Promise<{ tgChatId: number | null; waPhone: string | null }> {
  const user = await getUser(s.sub);
  return { tgChatId: user?.tgChatId ?? null, waPhone: user?.waPhone ?? null };
}

/** One alert, every linked channel. Returns true if anything was delivered. */
async function notifyOwner(s: Schedule, html: string, plain: string): Promise<boolean> {
  const { tgChatId, waPhone } = await ownerChannels(s);
  let sent = false;
  if (tgChatId && telegramEnabled()) {
    await sendMessage(tgChatId, html);
    sent = true;
  }
  if (waPhone && whatsappEnabled()) {
    await sendText(waPhone, plain);
    sent = true;
  }
  return sent;
}

async function runTask(s: Schedule): Promise<void> {
  const session = await getSession(`sched_${s.id}`);
  session.userSub = s.sub; // account memory (people, occasions) available
  session.scheduled = true;
  session.allowOrder = s.allowOrder;
  session.currency = session.currency || "LKR";

  let text = "";
  const blocks: UiBlock[] = [];
  const send = (event: StreamEvent) => {
    if (event.type === "text") text += event.delta;
    if (event.type === "block" && event.block.type !== "speech" && event.block.type !== "chips") blocks.push(event.block);
    if (event.type === "error") text += `\n${event.message}`;
  };

  const directive =
    `[AUTOMATED SCHEDULED RUN — no human is present. Task: "${s.instruction}". ` +
    `Do it end-to-end now. Keep the final summary under 4 sentences. ` +
    (s.allowOrder
      ? `Standing consent IS on file: if the task is a purchase and you have the saved recipient details, you may propose_order and then create_order with confirmed=true — the owner pays via the link.`
      : `NO standing order consent: stop at propose_order / recommendations. Never call create_order.`) +
    `]`;

  await runTurn(session, directive, send);
  session.scheduled = false;
  session.allowOrder = undefined;
  saveSession(session);

  s.lastResult = text.slice(0, 400) || "Done.";
  await updateSchedule(s);

  const { tgChatId, waPhone } = await ownerChannels(s);
  if (tgChatId && telegramEnabled()) {
    await sendMessage(tgChatId, `⏰ <b>${esc(s.title)}</b>\n${mdToTelegram(text).slice(0, 3500)}`);
    await deliverBlocks(tgChatId, blocks.slice(0, 4));
  }
  if (waPhone && whatsappEnabled()) {
    await sendText(waPhone, `⏰ *${s.title}*\n${mdToWhatsapp(text).slice(0, 3500)}`);
    await deliverBlocksWa(waPhone, blocks.slice(0, 4));
  }
}

// shared by price AND order watches — keep the copy neutral
const RETRY_NOTE = "Couldn't check this time — I'll try again at the next run.";

function tryParse(text: string): Record<string, unknown> | null {
  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    return null;
  }
}

/** Watched product's live LKR price. get_product 500s permanently on the
 *  whole EF_PC_* marketplace family (and MCP errors arrive as plain text),
 *  so degrade to search-summary data — the same fallback hero/compare use.
 *  Returns null instead of throwing; a watch must survive upstream blips. */
async function watchedPrice(s: Schedule): Promise<number | null> {
  const pid = String(s.productId).toLowerCase();
  try {
    const res = tryParse(await kapruka("kapruka_get_product", { product_id: s.productId, currency: "LKR" }));
    const prod = (res?.product ?? res) as Record<string, unknown> | null;
    const amt = prod ? money(prod.price).amount : null;
    if (amt != null) return amt;
  } catch (err) {
    console.warn(`[schedules] ${s.id} get_product failed (${err instanceof Error ? err.message.slice(0, 120) : err}) — trying search fallback`);
  }
  // schedule titles look like "Price-drop watch — Glitter Hearts Chocolate Box"
  const q = (s.title.split("—").pop() ?? s.title).replace(/price[- ]?drop watch/i, "").trim();
  if (!q) return null;
  try {
    const res = tryParse(await kapruka("kapruka_search_products", { q, limit: 20, in_stock_only: false, currency: "LKR" }));
    const list = (res?.products ?? res?.results ?? res?.items ?? []) as Record<string, unknown>[];
    if (!Array.isArray(list)) return null;
    const hit = list.find((p) => String(p.id ?? p.product_id ?? "").toLowerCase() === pid);
    return hit ? money(hit.price).amount : null;
  } catch {
    return null;
  }
}

async function runPriceWatch(s: Schedule): Promise<void> {
  const price = await watchedPrice(s);
  if (price == null) {
    s.lastResult = RETRY_NOTE;
    await updateSchedule(s);
    return;
  }
  if (s.baselinePrice == null) {
    s.baselinePrice = price;
    s.lastResult = `Watching at Rs ${Math.round(price).toLocaleString()}`;
    await updateSchedule(s);
    return;
  }
  s.lastResult = `Rs ${Math.round(price).toLocaleString()} (was Rs ${Math.round(s.baselinePrice).toLocaleString()})`;
  const dropped = price < s.baselinePrice * 0.98; // ≥2% real drop
  if (dropped) {
    const was = Math.round(s.baselinePrice).toLocaleString();
    const now = Math.round(price).toLocaleString();
    const pct = Math.round((1 - price / s.baselinePrice) * 100);
    const sent = await notifyOwner(
      s,
      `📉 <b>Price drop!</b> ${esc(s.title)}\nRs ${was} → <b>Rs ${now}</b> (−${pct}%)\nGrab it in Kapu before it climbs back 🌳`,
      `📉 *Price drop!* ${s.title}\nRs ${was} → *Rs ${now}* (−${pct}%)\nGrab it in Kapu before it climbs back 🌳`
    );
    if (sent) s.active = false; // one good alert, then rest
  }
  if (price < s.baselinePrice) s.baselinePrice = price;
  await updateSchedule(s);
}

async function runOrderWatch(s: Schedule): Promise<void> {
  const res = parseJson(await kapruka("kapruka_track_order", { order_number: s.orderNumber }));
  const status = String(res.status ?? "unknown");
  const changed = status !== s.lastStatus;
  const delivered = status.toLowerCase() === "delivered";
  const proof = res.has_delivery_photo === true || res.has_delivery_video === true;
  const kind = res.has_delivery_video === true ? "video" : "photo";
  s.lastStatus = status;
  s.lastResult = `Status: ${res.status_display ?? status}`;
  const ord = String(s.orderNumber);

  if (!delivered) {
    if (changed) {
      await notifyOwner(
        s,
        `📦 Order <code>${esc(ord)}</code>: <b>${esc(String(res.status_display ?? status))}</b>`,
        `📦 Order ${ord}: *${String(res.status_display ?? status)}*`
      );
    }
    await updateSchedule(s);
    return;
  }

  // Delivered. The courier's proof photo/video lands on the order page some
  // time AFTER the status flips — the old behaviour rested immediately, so
  // the "see it arrive" moment was never actually delivered. Celebrate now,
  // then keep polling (≤8 checks ≈ 24h at the 3h interval) just for the proof.
  if (changed) {
    const tail = proof
      ? `\n📸 Delivery proof is on your Kapruka order page — see it arrive!`
      : `\n📷 I'll ping you the moment the delivery ${kind} is up.`;
    await notifyOwner(
      s,
      `🎉 <b>Delivered!</b> Order <code>${esc(ord)}</code> reached its home.${tail}`,
      `🎉 *Delivered!* Order ${ord} reached its home.${tail}`
    );
  } else if (proof && (s.proofWait ?? 0) > 0) {
    await notifyOwner(
      s,
      `📸 <b>Delivery ${kind} is up!</b> Order <code>${esc(ord)}</code> — see it arrive on your Kapruka order page.`,
      `📸 *Delivery ${kind} is up!* Order ${ord} — see it arrive on your Kapruka order page.`
    );
  }

  if (proof || (s.proofWait ?? 0) >= 8) {
    s.active = false;
    s.lastResult = proof ? "Delivered ✓ · proof captured 📸" : "Delivered ✓";
  } else {
    s.proofWait = (s.proofWait ?? 0) + 1;
    s.lastResult = "Delivered ✓ · watching for the proof photo";
  }
  await updateSchedule(s);
}
