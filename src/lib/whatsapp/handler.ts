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
import { issueWaLinkCode } from "@/lib/schedules/store";
import { getSession, saveSession } from "@/lib/session/store";
import type { Cart, StreamEvent, UiBlock } from "@/lib/types";
import { scanImage, scanToMessage } from "@/lib/vision/scan";
import { beat, endTurn, mdToWhatsapp, sendAudio, sendImage, sendText } from "@/lib/whatsapp/api";
import { rememberLine, threadContext } from "@/lib/whatsapp/thread";
import { estimateSeconds, synthesizeVoiceNote } from "@/lib/voice/synth";

const fmt = (n: number | null | undefined, currency = "LKR") => {
  if (n == null) return "—";
  if (currency === "LKR") return `Rs ${Math.round(n).toLocaleString("en-LK")}`;
  return new Intl.NumberFormat("en-LK", { style: "currency", currency, maximumFractionDigits: 2 }).format(n);
};

/** Strip markdown / emoji / URLs so a fallback spoken reply (a voice turn where
 *  the model didn't emit a say() block) isn't read aloud with asterisks and
 *  link noise. Mirrors the client's sanitizeForSpeech. */
function forSpeech(md: string): string {
  return md
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/https?:\/\/\S+/g, " ")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/[*_#>`~|]/g, "")
    .replace(/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}\u{200D}\u{2190}-\u{21FF}]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

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
  /** a real WhatsApp @mention of the bot's number */
  mentioned?: boolean;
  /** the message quotes something Kapu said */
  reply_to_me?: boolean;
}

/**
 * Sessions key on the CHAT, not the sender — so a group shares ONE basket and
 * one memory, exactly like the Telegram channel ([[telegram]]). Keying on the
 * sender would give every participant their own private basket inside the
 * same conversation, which is not what "add it to the basket" means in a
 * family group.
 */
const sessionId = (chat: string) => `wa_${chat.replace(/[^a-zA-Z0-9]/g, "_")}`;

/**
 * Kapu speaks in a group ONLY when spoken to: a real @mention, a reply to one
 * of its messages, or its name in the text. WhatsApp's true @mention carries
 * the bot's JID in contextInfo and renders as a number, so keyword matching
 * alone missed every properly-mentioned message — the reason groups looked
 * completely dead.
 */
const NAME_HAIL = /\b(kapu|kapuwa|kapruka)\b|කපු|கபு/i;

function isAddressed(msg: WaInbound): boolean {
  if (!msg.is_group) return true; // 1:1 is always addressed
  if (msg.mentioned || msg.reply_to_me) return true;
  return NAME_HAIL.test(msg.text ?? "");
}

/** Strip the hail so the agent sees the request, not "@94712148820 ...". */
function stripHail(text: string, botNumber?: string): string {
  let out = text;
  if (botNumber) out = out.replace(new RegExp(`@${botNumber}\\b`, "g"), " ");
  out = out.replace(/@\d{8,15}\b/g, " ").replace(NAME_HAIL, " ");
  return out.replace(/\s+/g, " ").trim();
}

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
  const m = /^\s*([1-9]\d?)\s*$/.exec(text);
  if (!m) return null;
  return picks[Number(m[1]) - 1] ?? null;
}

export async function processInbound(msg: WaInbound): Promise<void> {
  const phone = msg.from.replace(/\D/g, "");
  if (!phone) return;
  const chat = msg.chat || phone;
  const who = (msg.push_name || "").trim() || `+${phone}`;
  const addressed = isAddressed(msg);

  // EVERY group message is remembered, answered or not — that's what makes a
  // later "@kapu the second one" resolvable. Overheard lines never enter the
  // model history, only the per-turn context block.
  if (msg.is_group && msg.text?.trim()) rememberLine(chat, who, msg.text);
  if (!addressed) return;

  const session = await getSession(sessionId(chat));

  let text = stripHail((msg.text ?? "").trim(), process.env.WA_PUBLIC_NUMBER?.replace(/\D/g, ""));

  if (msg.media_kind === "audio" && msg.media_b64) {
    const said = await transcribe(msg.media_b64, msg.mime_type ?? "audio/ogg");
    if (!said) {
      await sendText(chat, "Aiyo, I couldn't hear that clearly 💔 — try typing it?", true);
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
      await sendText(chat, "I couldn't read that image, sorry — what are you looking for?", true);
      return;
    }
  }

  // "@kapu" with nothing else is still a greeting, not a no-op.
  if (!text && addressed && msg.is_group) text = "hi";
  if (!text) {
    await endTurn(chat); // drop the typing indicator — nothing to answer
    return;
  }

  // "link" — bind this WhatsApp number to a signed-in web account so
  // standing-wish alerts arrive here (mirrors Telegram's /link).
  if (!msg.is_group && /^\/?link$/i.test(text)) {
    const code = issueWaLinkCode(phone);
    await sendText(
      chat,
      `🔗 Your link code: *${code}*\n\nIn the Kapu web app (kapuwa.shop), open *Standing wishes* and enter this code — your schedule alerts will arrive here too. It expires in 10 minutes.`,
      true
    );
    return;
  }

  // "2" → the second product we offered last turn.
  const picked = resolveNumberedReply(text, session.waPicks);
  if (picked) {
    // ids case-vary between search results and the cart — match like cart.ts does
    const existing = session.cart?.items?.find((i) => i.product_id.toLowerCase() === picked.toLowerCase());
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
      await endTurn(chat); // drop the typing indicator — no agent turn follows
      return;
    }
  }

  // A voice note in → a voice note back: flag the turn so the agent narrates a
  // spoken say() and we synthesize it below. Text/image turns stay silent.
  // Kill switch: WA_VOICE_REPLIES=0 disables spoken replies (falls back to text)
  // with no redeploy — a live-demo safety valve if the sidecar/audio misbehaves.
  const voiceOff = process.env.WA_VOICE_REPLIES === "0" || process.env.WA_VOICE_REPLIES === "false";
  const viaVoice = !voiceOff && msg.media_kind === "audio" && Boolean(msg.media_b64);
  await handleTurn(chat, text, { isGroup: Boolean(msg.is_group), who, voice: viaVoice });
}

async function handleTurn(
  chat: string,
  message: string,
  ctx: { isGroup: boolean; who: string; voice?: boolean }
): Promise<void> {
  const session = await getSession(sessionId(chat));
  session.voice = Boolean(ctx.voice);
  if (!session.title) session.title = message.slice(0, 60);

  // In a group the agent needs to know WHO is talking and what was said
  // around it; in a 1:1 the turn is the whole story.
  let turn = message;
  if (ctx.isGroup) {
    const thread = threadContext(chat, message);
    turn = `${thread ? `${thread}\n\n` : ""}${ctx.who} is asking you: ${message}`;
  }

  // No placeholder message here on purpose. The sidecar puts a real "typing…"
  // indicator up the moment the message arrives, which is both what a human
  // does and what WhatsApp expects — a byte-identical "On it…" on every single
  // turn was the most bot-shaped thing in the whole channel.
  let text = "";
  let speech = ""; // the say() spoken line — synthesized into a voice note below
  const blocks: UiBlock[] = [];
  const send = (event: StreamEvent) => {
    if (event.type === "text") text += event.delta;
    if (event.type === "block") {
      if (event.block.type === "speech") speech = event.block.text;
      else blocks.push(event.block);
    }
    if (event.type === "error") text += (text ? "\n\n" : "") + event.message;
  };

  try {
    await runTurn(session, turn, send);
  } catch (err) {
    console.error("[whatsapp] turn failed:", err);
    text = text || "Aiyo, something went wrong on my side 💔 — try that again?";
  }

  // Voice-note turns speak the reply: synthesize the say() line (or the written
  // reply, stripped) into a WhatsApp voice note, sent BEFORE the product cards.
  // The written text stays as the fallback so a voice turn is never left silent
  // if TTS is unavailable (no key / provider down).
  let spoke = false;
  if (session.voice) {
    const spoken = (speech || forSpeech(text)).trim();
    if (spoken) {
      try {
        const ogg = await synthesizeVoiceNote(spoken);
        if (ogg) {
          await sendAudio(chat, ogg, estimateSeconds(spoken));
          spoke = true;
        }
      } catch (err) {
        console.error("[whatsapp] voice synth failed:", err instanceof Error ? err.message : err);
      }
    }
  }
  if (!spoke && text.trim()) await sendText(chat, mdToWhatsapp(text));
  // A turn that mutates the basket repeatedly emits a cart block per change —
  // on WhatsApp only the final state is worth a message.
  const lastCart = [...blocks].reverse().find((b) => b.type === "cart");
  const toRender = blocks.filter((b) => b.type !== "cart" || b === lastCart);
  // Numbered replies span the whole turn (grid 2 continues where grid 1 ended),
  // so picks reset only when this turn offers new ones.
  if (toRender.some((b) => b.type === "product_grid" || b.type === "product_hero" || b.type === "compare_grid")) {
    session.waPicks = [];
  }
  const render: RenderCtx = { images: IMAGE_BUDGET };
  for (const block of toRender) {
    await beat();
    await renderBlock(chat, session, block, render);
  }
  // Drops the typing indicator even when a turn produced no blocks at all.
  await endTurn(chat);
  saveSession(session);
}

/** Deliver blocks outside a chat turn (scheduled runs) — chips skipped. */
export async function deliverBlocksWa(chat: string, blocks: UiBlock[]): Promise<void> {
  const session = await getSession(sessionId(chat));
  if (blocks.some((b) => b.type === "product_grid" || b.type === "product_hero" || b.type === "compare_grid")) {
    session.waPicks = [];
  }
  const render: RenderCtx = { images: IMAGE_BUDGET };
  for (const b of blocks) {
    if (b.type === "chips" || b.type === "speech") continue;
    await beat();
    await renderBlock(chat, session, b, render);
  }
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

/** Per-delivery render state: a photo budget so one multi-list turn (e.g. a
 *  scanned six-item grocery list) doesn't flood the chat with 20+ images —
 *  grids past the budget arrive as compact numbered text instead. */
type RenderCtx = { images: number };
const IMAGE_BUDGET = 12;

const numberHint = (start: number, count: number) =>
  count === 1
    ? `Reply *${start + 1}* to add it to your basket.`
    : `Reply with a number (${start + 1}–${start + count}) to add it to your basket.`;

async function renderBlock(
  chat: string,
  session: Awaited<ReturnType<typeof getSession>>,
  block: UiBlock,
  ctx: RenderCtx = { images: IMAGE_BUDGET }
): Promise<void> {
  switch (block.type) {
    case "product_grid": {
      const shown = block.products.slice(0, 4);
      // Numbers continue across the turn's grids — "5" is item 5 overall.
      const start = (session.waPicks ??= []).length;
      session.waPicks.push(...shown.map((p) => p.id));
      if (ctx.images < shown.length) {
        const lines = shown
          .map((p, i) => `${p.pick ? "⭐" : "▫️"} *${start + i + 1}. ${p.name}* — ${fmt(p.price, p.currency)}`)
          .join("\n");
        await sendText(
          chat,
          `${block.title ? `*${mdToWhatsapp(block.title)}*\n` : ""}${lines}\n\n_${numberHint(start, shown.length)}_`
        );
        break;
      }
      ctx.images -= shown.length;
      let n = start;
      for (const p of shown) {
        if (n > start) await beat(600, 1400); // photos arrive at human speed
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
      await sendText(chat, `_${numberHint(start, shown.length)}_`);
      break;
    }
    case "product_hero": {
      const p = block.product;
      const start = (session.waPicks ??= []).length;
      session.waPicks.push(p.id);
      const caption = `*${p.name}*\n${fmt(p.price, p.currency)}${p.summary ? `\n_${p.summary.slice(0, 140)}_` : ""}`;
      const img = resizeImage(p.image, 1200);
      if (img) await sendImage(chat, img, caption);
      else await sendText(chat, caption);
      ctx.images -= 1;
      await sendText(chat, `_${numberHint(start, 1)}_`);
      break;
    }
    case "compare_grid": {
      const start = (session.waPicks ??= []).length;
      session.waPicks.push(...block.products.map((p) => p.id));
      const lines = block.products
        .map((p, i) => `${i === 0 ? "⭐" : "▫️"} *${start + i + 1}. ${p.name}* — ${fmt(p.price, p.currency)}`)
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
    case "cake_design": {
      // Designer canvas is web-only — send the design summary, then the
      // matches through the numbered product-grid path (waPicks and all).
      await sendText(
        chat,
        `${block.glyph} *Cake Studio* — ${block.flavour} · ${block.style}` +
          (block.icing_text ? `\n✍️ _"${block.icing_text}"_` : "") +
          `\n🌳 _Design it live at kapuwa.shop — real cakes that match:_`
      );
      if (block.products.length) {
        await renderBlock(chat, session, { type: "product_grid", products: block.products.slice(0, 4) });
      }
      break;
    }
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
