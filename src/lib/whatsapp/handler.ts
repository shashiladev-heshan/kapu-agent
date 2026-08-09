// WhatsApp channel over the SAME agent core as web and Telegram: wa_<phone>
// sessions get the full tool surface, basket, memory and persistence.
//
// WhatsApp is a poorer canvas than Telegram — no message editing (so no live
// status ticker), no inline keyboards, and only *bold* _italic_ ~strike~. So
// choices are offered as NUMBERED replies: we stash what was offered on the
// session and map a bare "2" back to a product id on the next turn, the same
// trick tgChips uses for Telegram quick replies.

import { runTurn } from "@/lib/agent/loop";
import { applyCartUpdate } from "@/lib/kapruka/cart";
import { resizeImage } from "@/lib/kapruka/normalize";
import { getSession, saveSession } from "@/lib/session/store";
import type { Cart, StreamEvent, UiBlock } from "@/lib/types";
import { scanImage, scanToMessage } from "@/lib/vision/scan";
import { beat, endTurn, mdToWhatsapp, sendImage, sendText } from "@/lib/whatsapp/api";

const fmt = (n: number | null | undefined, currency = "LKR") => {
  if (n == null) return "—";
  if (currency === "LKR") return `Rs ${Math.round(n).toLocaleString("en-LK")}`;
  return new Intl.NumberFormat("en-LK", { style: "currency", currency, maximumFractionDigits: 2 }).format(n);
};

export interface WaInbound {
  from: string;
  chat: string;
  is_group?: boolean;
  push_name?: string;
  text?: string;
  media_kind?: "image" | "audio";
  media_b64?: string;
  mime_type?: string;
  message_id?: string;
}

const sessionId = (phone: string) => `wa_${phone}`;

/** Voice notes → Whisper, reusing the same OpenAI path the web voice loop uses. */
async function transcribe(b64: string, mime: string): Promise<string | null> {
  const key = process.env.OPENAI_API_KEY?.trim();
  if (!key) return null;
  try {
    const bytes = Buffer.from(b64, "base64");
    const ext = mime.includes("mp4") ? "mp4" : mime.includes("mpeg") ? "mp3" : "ogg";
    const form = new FormData();
    form.append("file", new File([new Uint8Array(bytes)], `audio.${ext}`, { type: mime }));
    form.append("model", "whisper-1");
    const res = await fetch("https://api.openai.com/v1/audio/transcriptions", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}` },
      body: form,
      signal: AbortSignal.timeout(60_000),
    });
    if (!res.ok) return null;
    const j = (await res.json()) as { text?: string };
    return j.text?.trim() || null;
  } catch {
    return null;
  }
}

/** A bare "2" means the second thing we last offered. */
function resolveNumberedReply(text: string, picks: string[] | undefined): string | null {
  if (!picks?.length) return null;
  const m = /^\s*([1-9])\s*$/.exec(text);
  if (!m) return null;
  return picks[Number(m[1]) - 1] ?? null;
}

export async function processInbound(msg: WaInbound): Promise<void> {
  // Groups: stay quiet unless spoken to. A bot that replies to every group
  // message gets reported, and reports are what get numbers banned.
  if (msg.is_group && !/\bkapu\b/i.test(msg.text ?? "")) return;

  const phone = msg.from.replace(/\D/g, "");
  if (!phone) return;
  const chat = msg.chat || phone;
  const session = await getSession(sessionId(phone));

  let text = (msg.text ?? "").trim();

  if (msg.media_kind === "audio" && msg.media_b64) {
    const said = await transcribe(msg.media_b64, msg.mime_type ?? "audio/ogg");
    if (!said) {
      await sendText(chat, "Aiyo, I couldn't hear that clearly 💔 — try typing it?");
      return;
    }
    text = said;
    await sendText(chat, `_🎙️ "${said}"_`);
  }

  if (msg.media_kind === "image" && msg.media_b64) {
    await sendText(chat, "📸 Reading your photo…");
    try {
      const result = await scanImage(msg.media_b64);
      if (result) text = scanToMessage(result) || text;
    } catch (err) {
      console.error("[whatsapp] scan failed:", err instanceof Error ? err.message : err);
      await sendText(chat, "I couldn't read that image, sorry — what are you looking for?");
      return;
    }
  }

  if (!text) return;

  // "2" → the second product we offered last turn.
  const picked = resolveNumberedReply(text, session.waPicks);
  if (picked) {
    const existing = session.cart?.items?.find((i) => i.product_id === picked);
    const result = await applyCartUpdate(session, {
      product_id: picked,
      quantity: (existing?.quantity ?? 0) + 1,
    });
    saveSession(session);
    if (result.error) {
      // Let the agent handle it in words rather than dead-ending on a number.
      text = `add ${picked} to my basket`;
    } else {
      await sendText(chat, "Added to your basket ✓");
      await sendCart(chat, session.cart);
      return;
    }
  }

  await handleTurn(chat, phone, text);
}

async function handleTurn(chat: string, phone: string, message: string): Promise<void> {
  const session = await getSession(sessionId(phone));
  session.voice = false;
  if (!session.title) session.title = message.slice(0, 60);

  // No placeholder message here on purpose. The sidecar puts a real "typing…"
  // indicator up the moment the message arrives, which is both what a human
  // does and what WhatsApp expects — a byte-identical "On it…" on every single
  // turn was the most bot-shaped thing in the whole channel.
  let text = "";
  const blocks: UiBlock[] = [];
  const send = (event: StreamEvent) => {
    if (event.type === "text") text += event.delta;
    if (event.type === "block" && event.block.type !== "speech") blocks.push(event.block);
    if (event.type === "error") text += (text ? "\n\n" : "") + event.message;
  };

  try {
    await runTurn(session, message, send);
  } catch (err) {
    console.error("[whatsapp] turn failed:", err);
    text = text || "Aiyo, something went wrong on my side 💔 — try that again?";
  }

  if (text.trim()) await sendText(chat, mdToWhatsapp(text));
  for (const block of blocks) {
    await beat();
    await renderBlock(chat, session, block);
  }
  // Drops the typing indicator even when a turn produced no blocks at all.
  await endTurn(chat);
  saveSession(session);
}

async function sendCart(chat: string, cart: Cart): Promise<void> {
  if (!cart.items.length) {
    await sendText(chat, "🧺 Your basket is empty.");
    return;
  }
  const lines = cart.items
    .map((i) => `• ${i.name}${i.quantity > 1 ? ` ×${i.quantity}` : ""} — ${fmt((i.price ?? 0) * i.quantity, i.currency)}`)
    .join("\n");
  const total = cart.items.reduce((s, i) => s + (i.price ?? 0) * i.quantity, 0);
  await sendText(chat, `🧺 *Your basket*\n${lines}\n\nTotal: *${fmt(total, cart.items[0]?.currency ?? "LKR")}*`);
}

async function renderBlock(chat: string, session: Awaited<ReturnType<typeof getSession>>, block: UiBlock): Promise<void> {
  switch (block.type) {
    case "product_grid": {
      const shown = block.products.slice(0, 4);
      // Remember what "1/2/3" will mean on the next turn.
      session.waPicks = shown.map((p) => p.id);
      let n = 0;
      for (const p of shown) {
        if (n > 0) await beat(600, 1400); // photos arrive at human speed
        n++;
        const was =
          p.compare_at_price && p.price && p.compare_at_price > p.price ? ` ~${fmt(p.compare_at_price, p.currency)}~` : "";
        const caption =
          `${p.pick ? "⭐ *KAPU'S PICK*\n" : ""}*${n}. ${p.name}*\n` +
          `${fmt(p.price, p.currency)}${was} · ${p.in_stock === false ? "out of stock" : "in stock ✅"}`;
        const img = resizeImage(p.image, 800);
        if (img) await sendImage(chat, img, caption);
        else await sendText(chat, caption);
      }
      await sendText(chat, `_Reply with a number (1–${shown.length}) to add it to your basket._`);
      break;
    }
    case "product_hero": {
      const p = block.product;
      session.waPicks = [p.id];
      const caption = `*${p.name}*\n${fmt(p.price, p.currency)}${p.summary ? `\n_${p.summary.slice(0, 140)}_` : ""}`;
      const img = resizeImage(p.image, 1200);
      if (img) await sendImage(chat, img, caption);
      else await sendText(chat, caption);
      await sendText(chat, "_Reply *1* to add it to your basket._");
      break;
    }
    case "compare_grid": {
      session.waPicks = block.products.map((p) => p.id);
      const lines = block.products
        .map((p, i) => `${i === 0 ? "⭐" : "▫️"} *${i + 1}. ${p.name}* — ${fmt(p.price, p.currency)}`)
        .join("\n");
      await sendText(
        chat,
        `⚖️ *Side by side*\n${lines}${block.verdict ? `\n\n🌳 *Kapu's verdict:* ${block.verdict}` : ""}\n\n_Reply with a number to add._`
      );
      break;
    }
    case "delivery_card": {
      const line = block.available
        ? `🛵 *Delivers to ${block.city}*${block.date ? ` · ${block.date}` : ""}\nFlat ${fmt(block.rate ?? null, block.currency || "LKR")} — one fee for the whole basket.`
        : `😕 *Not available for ${block.city}*${block.next_available_date ? `\nNext available: ${block.next_available_date}` : ""}`;
      await sendText(chat, `${line}${block.perishable_warning ? `\n⚠️ ${block.perishable_warning}` : ""}`);
      break;
    }
    case "cart":
      await sendCart(chat, block.cart);
      break;
    case "order_summary": {
      const s = block.summary;
      const items = s.items
        .map((i) => `• ${i.name}${i.quantity > 1 ? ` ×${i.quantity}` : ""} — ${fmt((i.price ?? 0) * i.quantity, i.currency)}`)
        .join("\n");
      await sendText(
        chat,
        `🧾 *Order summary*\n${items}\n\n📍 *${s.recipient.name}* · ${s.delivery.address}, ${s.delivery.city}\n📅 ${s.delivery.date}` +
          `${s.delivery_rate != null ? ` · flat ${fmt(s.delivery_rate, s.currency)}` : ""}` +
          `${s.gift_message ? `\n💌 _"${s.gift_message}"_` : ""}\n\nTotal: *${fmt(s.total, s.currency)}*\n\n` +
          `I never place an order without your yes — reply *YES* to confirm.`
      );
      break;
    }
    case "pay_link": {
      // THE money step. Telegram gets a button; WhatsApp has none, so the URL
      // goes out as bare text on its own line — WhatsApp auto-links it and it
      // must never be wrapped in markdown, which it does not render.
      const amount = block.total != null ? ` · ${fmt(block.total, block.currency || "LKR")}` : "";
      await sendText(
        chat,
        `🎉 *Order created — wish granted!*\nRef: ${block.order_ref}\n\n🔒 *Pay securely${amount}*\n${block.pay_url}\n\n` +
          `Prices are locked for about 60 minutes. After you pay, Kapruka emails your order number for tracking.`
      );
      break;
    }
    case "order_timeline": {
      const steps = block.progress.filter((p) => p.step?.trim());
      const lines = steps.length
        ? steps.map((p) => `✓ ${p.step}${p.timestamp ? ` — ${p.timestamp}` : ""}`).join("\n")
        : "_No steps recorded yet._";
      const media = block.has_delivery_photo || block.has_delivery_video ? "\n📷 Delivery proof is available." : "";
      await sendText(chat, `📦 *Order ${block.order_number}*\n${block.status_display || block.status}\n\n${lines}${media}`);
      break;
    }
    case "import_quote": {
      const line = (label: string, v: number | null | undefined) => (v != null ? `\n${label}: ${fmt(v, "LKR")}` : "");
      await sendText(
        chat,
        `🌍 *Import from Amazon*\n*${block.product_name}*` +
          line("Item", block.item_lkr) +
          line("Shipping + duties", block.ship_duty_lkr) +
          `\n\n*Landed in Sri Lanka: ${fmt(block.total_lkr ?? null, "LKR")}*  (${block.shipping})` +
          (block.local_from_lkr != null ? `\n🇱🇰 Similar on Kapruka from ${fmt(block.local_from_lkr, "LKR")}` : "") +
          `\n\n${block.checkout_url || block.handoff_url}`
      );
      break;
    }
    case "greeting_card":
      await sendText(chat, `💌 *To ${block.to}*\n${block.message}${block.from ? `\n— ${block.from}` : ""}`);
      break;
    case "options_card":
      await sendImage(chat, block.image_url, block.caption ?? "");
      break;
    case "account_card":
      await sendText(chat, `👤 *${block.name}*\n${block.email}${block.new_customer ? "\n_Welcome to Kapruka!_" : ""}`);
      break;
    case "category_tree":
      await sendText(
        chat,
        `🗂 *What you can shop*\n${block.categories.slice(0, 12).map((c) => `• ${c.name}`).join("\n")}\n\n_Just tell me what you're after._`
      );
      break;
    case "no_results":
      await sendText(chat, `😕 Nothing came up for "${block.query}". Want me to try different words?`);
      break;
    case "chips":
      // Deliberately NOT numbered: numbers mean "add product N" on this
      // channel, and a second numbered list right under the grid makes "2"
      // ambiguous. Leave waPicks alone — these are just prompts to echo back.
      await sendText(chat, block.chips.map((c) => `• ${c}`).join("\n"));
      break;
    default:
      // Never silently again: an unhandled block cost this channel its PAY
      // LINK — Kapu told people to "tap the pay button above" and nothing was
      // there. Anything new shows up in the logs instead of vanishing.
      console.warn(`[whatsapp] unrendered block type: ${(block as { type: string }).type}`);
      break;
  }
}
