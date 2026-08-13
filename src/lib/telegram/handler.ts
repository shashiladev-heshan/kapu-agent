// Telegram channel over the SAME agent core as web: tg_<chatId> sessions get
// the full tool surface, basket, memory and persistence. UiBlocks render as
// photos + inline keyboards; voice notes go through Whisper; photos go
// through Kapu's vision. Web stays the flagship — this is distribution.

import { runTurn } from "@/lib/agent/loop";
import { applyCartUpdate } from "@/lib/kapruka/cart";
import { resizeImage } from "@/lib/kapruka/normalize";
import { getSession, saveSession } from "@/lib/session/store";
import type { Cart, StreamEvent, UiBlock } from "@/lib/types";
import { scanImage, scanToMessage } from "@/lib/vision/scan";
import { answerCallback, deleteMessage, downloadFile, editMessage, esc, getBotUser, mdToTelegram, sendChatAction, sendMessage, sendPhoto, sendPhotoBuffer } from "@/lib/telegram/api";

const fmt = (n: number | null | undefined, currency = "LKR") => {
  if (n == null) return "—";
  if (currency === "LKR") return `Rs ${Math.round(n).toLocaleString("en-LK")}`;
  return new Intl.NumberFormat("en-LK", { style: "currency", currency, maximumFractionDigits: 2 }).format(n);
};

interface TgUpdate {
  update_id: number;
  message?: {
    message_id: number;
    chat: { id: number; type: string; title?: string };
    from?: { id: number; first_name?: string };
    text?: string;
    voice?: { file_id: string };
    audio?: { file_id: string };
    photo?: { file_id: string; width: number }[];
    caption?: string;
    reply_to_message?: { from?: { id: number } };
  };
  callback_query?: {
    id: string;
    data?: string;
    message?: { chat: { id: number } };
  };
}

const isGroup = (type: string) => type === "group" || type === "supergroup";

/** In groups Kapu only wakes when @mentioned or replied-to (privacy by design).
 *  Returns the message text with the mention stripped, or null to ignore. */
async function groupAddressedText(msg: NonNullable<TgUpdate["message"]>, raw: string | undefined): Promise<string | null> {
  const bot = await getBotUser();
  if (!bot) return null;
  const mention = new RegExp(`@${bot.username}\\b`, "i");
  if (raw && mention.test(raw)) {
    const cleaned = raw.replace(new RegExp(`@${bot.username}`, "gi"), "").replace(/\s+/g, " ").trim();
    return cleaned || "hi";
  }
  if (msg.reply_to_message?.from?.id === bot.id) return (raw ?? "").trim() || null;
  return null;
}

const sessionId = (chatId: number) => `tg_${chatId}`;

export async function processUpdate(update: TgUpdate): Promise<void> {
  try {
    if (update.callback_query) {
      await handleCallback(update.callback_query);
      return;
    }
    const msg = update.message;
    if (!msg) return;
    if (msg.chat.type !== "private" && !isGroup(msg.chat.type)) return;
    const chatId = msg.chat.id;
    const group = isGroup(msg.chat.type);
    const replyTo = group ? msg.message_id : undefined;
    // sender name gives the agent group context ("Akki wants…")
    const who = group && msg.from?.first_name ? msg.from.first_name.slice(0, 30) : null;

    if (msg.text) {
      if (msg.text.startsWith("/link")) {
        const { issueLinkCode } = await import("@/lib/schedules/store");
        const code = issueLinkCode(chatId);
        await sendMessage(
          chatId,
          `🔗 Your link code: <code>${code}</code>\n\nEnter it in the Kapu web app → <b>Schedules → Link Telegram</b> (valid 10 min). Then your scheduled wishes report here automatically.`
        );
        return;
      }
      if (msg.text.startsWith("/start") || msg.text.startsWith("/kapu")) {
        await sendMessage(
          chatId,
          "ආයුබෝවන්! I'm <b>Kapu</b> 🌳 — Sri Lanka's wish-granting shopping agent for Kapruka.\n\n" +
            "Talk to me in <b>සිංහල, தமிழ், English or Tanglish</b>.\n" +
            "🎙 Send a <b>voice note</b> — I understand Sinhala speech.\n" +
            "📸 Send a <b>photo of your shopping list</b> — I'll build the basket.\n\n" +
            "Try: <i>machan mata phone ekak ona 60000ට යටින්</i>\n\n" +
            "✨ Full visual experience: the Kapu web app has voice mode, live basket and more." +
            (group ? "\n\n👨‍👩‍👧 In this group: mention me — <b>@" + ((await getBotUser())?.username ?? "kapu") + " cake for amma</b> — or reply to my messages. The whole group shares one basket 🧺" : "")
        );
        return;
      }
      if (group) {
        const addressed = await groupAddressedText(msg, msg.text);
        if (addressed == null) return; // not talking to Kapu — stay quiet
        await handleTurn(chatId, who ? `${who}: ${addressed}` : addressed, replyTo);
        return;
      }
      await handleTurn(chatId, msg.text);
      return;
    }

    if (msg.voice || msg.audio) {
      // in groups, privacy mode only delivers these as replies-to-Kapu — already addressed
      const fileId = (msg.voice ?? msg.audio)!.file_id;
      await sendChatAction(chatId, "typing");
      const file = await downloadFile(fileId);
      if (!file) {
        await sendMessage(chatId, "Aiyo, I couldn't fetch that voice note — try again?");
        return;
      }
      const port = process.env.PORT || "3100";
      const res = await fetch(`http://127.0.0.1:${port}/api/stt`, {
        method: "POST",
        headers: { "Content-Type": "audio/ogg" },
        body: new Uint8Array(file.buf),
      });
      const data = (await res.json()) as { text?: string };
      const heard = (data.text ?? "").trim();
      if (!heard) {
        await sendMessage(chatId, "අනේ, I couldn't hear that clearly — one more time?");
        return;
      }
      await sendMessage(chatId, `🎙 <i>${esc(heard)}</i>`, replyParams(replyTo));
      await handleTurn(chatId, who ? `${who} (voice): ${heard}` : heard, replyTo);
      return;
    }

    if (msg.photo?.length) {
      if (group) {
        const addressed = await groupAddressedText(msg, msg.caption ?? "");
        if (addressed == null && !msg.reply_to_message) return;
      }
      await sendChatAction(chatId, "typing");
      const largest = msg.photo[msg.photo.length - 1];
      const file = await downloadFile(largest.file_id);
      if (!file) {
        await sendMessage(chatId, "Aiyo, the photo didn't reach me — try again?");
        return;
      }
      const dataUrl = `data:image/jpeg;base64,${file.buf.toString("base64")}`;
      const result = await scanImage(dataUrl).catch(() => null);
      const composed = result ? scanToMessage(result) : null;
      if (!composed) {
        await sendMessage(chatId, "අනේ, I couldn't make out a list or product there — clearer photo?");
        return;
      }
      await handleTurn(chatId, msg.caption ? `${composed} (${msg.caption.replace(/@\S+/g, "").trim()})` : composed, replyTo);
      return;
    }
  } catch (err) {
    console.error("[telegram] update failed:", err);
  }
}

async function handleCallback(cb: NonNullable<TgUpdate["callback_query"]>): Promise<void> {
  const chatId = cb.message?.chat.id;
  const data = cb.data ?? "";
  if (!chatId) {
    await answerCallback(cb.id);
    return;
  }
  const session = await getSession(sessionId(chatId));

  if (data.startsWith("add:")) {
    const productId = data.slice(4);
    const existing = session.cart.items.find((i) => i.product_id.toLowerCase() === productId.toLowerCase());
    const result = await applyCartUpdate(session, { product_id: productId, quantity: (existing?.quantity ?? 0) + 1 });
    saveSession(session);
    await answerCallback(cb.id, result.error ? "Aiyo — couldn't add that" : "Added to your basket ✓");
    if (!result.error) await sendCart(chatId, session.cart);
    return;
  }
  if (data === "checkout") {
    await answerCallback(cb.id);
    await handleTurn(chatId, "Let's checkout — show me the order summary");
    return;
  }
  if (data === "confirm") {
    await answerCallback(cb.id, "Placing your order…");
    await handleTurn(chatId, "Yes — place the order.");
    return;
  }
  if (data === "change") {
    await answerCallback(cb.id);
    await sendMessage(chatId, "Sure — tell me what to change (items, date, address…).");
    return;
  }
  if (data.startsWith("say:")) {
    await answerCallback(cb.id);
    await handleTurn(chatId, data.slice(4));
    return;
  }
  if (data.startsWith("chip:")) {
    const idx = Number(data.slice(5));
    const text = session.tgChips?.[idx];
    if (!text) {
      await answerCallback(cb.id, "ඒ menu එක පරණයි — just type it 🙏");
      return;
    }
    await answerCallback(cb.id);
    await handleTurn(chatId, text);
    return;
  }
  await answerCallback(cb.id);
}

function replyParams(replyTo?: number): Record<string, unknown> {
  return replyTo ? { reply_parameters: { message_id: replyTo, allow_sending_without_reply: true } } : {};
}

async function handleTurn(chatId: number, message: string, replyTo?: number): Promise<void> {
  const session = await getSession(sessionId(chatId));
  session.voice = false;
  if (!session.title) session.title = message.slice(0, 60);

  await sendChatAction(chatId, "typing");
  const keepTyping = setInterval(() => void sendChatAction(chatId, "typing"), 4500);

  // Live status ticker — one message, edited in place while Kapu works, so a
  // 30s agent turn never feels dead. Deleted before the real reply lands.
  const status = (await sendMessage(chatId, "🌳 හරි! On it… <i>checking Kapruka</i>", replyParams(replyTo))) as
    | { message_id?: number }
    | null;
  const statusId = status?.message_id;
  const doneSteps: string[] = [];
  let currentLabel: string | null = null;
  let quipIdx = 0;
  let lastEdit = Date.now();
  let lastStatus = "";
  const renderStatus = () =>
    [...doneSteps.slice(-3).map((d) => `✓ <s>${esc(d)}</s>`), currentLabel ? `⏳ <b>${esc(currentLabel)}</b>` : `<i>${TG_QUIPS[quipIdx % TG_QUIPS.length]}</i>`].join("\n");
  const editStatus = () => {
    if (!statusId) return;
    const txt = renderStatus();
    if (txt === lastStatus || Date.now() - lastEdit < 3000) return;
    lastStatus = txt;
    lastEdit = Date.now();
    void editMessage(chatId, statusId, txt);
  };
  const quipTimer = setInterval(() => {
    quipIdx++;
    editStatus();
  }, 7000);

  let text = "";
  const blocks: UiBlock[] = [];
  const send = (event: StreamEvent) => {
    if (event.type === "text") text += event.delta;
    if (event.type === "tool") {
      if (event.status === "start") {
        // separate the model's between-tools narration into paragraphs
        if (text && !/\n\s*$/.test(text)) text += "\n\n";
        if (event.label && event.label !== "…") currentLabel = event.label;
      } else if (event.status === "end" && currentLabel) {
        doneSteps.push(currentLabel);
        currentLabel = null;
      }
      editStatus();
    }
    if (event.type === "block" && event.block.type !== "speech") blocks.push(event.block);
    if (event.type === "error") text += (text ? "\n\n" : "") + event.message;
  };

  try {
    await runTurn(session, message, send);
  } catch (err) {
    console.error("[telegram] turn failed:", err);
    text = text || "Aiyo, something went wrong on my side 💔 — try that again?";
  } finally {
    clearInterval(keepTyping);
    clearInterval(quipTimer);
    if (statusId) void deleteMessage(chatId, statusId);
  }

  if (text.trim()) {
    let first = true;
    for (const chunk of chunkText(mdToTelegram(text), 3900)) {
      await sendMessage(chatId, chunk, first ? replyParams(replyTo) : {});
      first = false;
    }
  }
  for (const block of blocks) {
    await renderBlock(chatId, session, block);
  }
}

function chunkText(s: string, max: number): string[] {
  const out: string[] = [];
  let rest = s;
  while (rest.length > max) {
    const cut = rest.lastIndexOf("\n", max);
    const at = cut > max / 2 ? cut : max;
    out.push(rest.slice(0, at));
    rest = rest.slice(at);
  }
  if (rest.trim()) out.push(rest);
  return out;
}

// Guaranteed product card: fetch the image ourselves and upload the bytes
// (Cloudflare blocks Telegram's own fetcher), then URL, then text-only.
async function sendCard(
  chatId: number,
  imgUrl: string | null,
  caption: string,
  keyboard: Record<string, unknown>
): Promise<void> {
  if (imgUrl) {
    try {
      const res = await fetch(imgUrl, {
        headers: { "user-agent": "Mozilla/5.0 (compatible; KapuBot/1.0)" },
        signal: AbortSignal.timeout(12000),
      });
      if (res.ok) {
        const buf = Buffer.from(await res.arrayBuffer());
        if (buf.length > 500 && buf.length < 9_500_000) {
          const ok = await sendPhotoBuffer(chatId, buf, caption, { reply_markup: keyboard });
          if (ok) return;
        }
      }
    } catch {
      /* fall through */
    }
    const ok = await sendPhoto(chatId, imgUrl, caption, { reply_markup: keyboard });
    if (ok) return;
  }
  await sendMessage(chatId, caption, { reply_markup: keyboard });
}

const TG_QUIPS = [
  "🔍 Searching Kapruka…",
  "🧠 හිතනවා… thinking…",
  "🧺 Picking the good ones…",
  "පොඩ්ඩක් ඉන්න — ළඟයි!",
  "⚖️ Weighing the options…",
];

async function sendCart(chatId: number, cart: Cart): Promise<void> {
  if (!cart.items.length) {
    await sendMessage(chatId, "🧺 Your basket is empty — whisper a wish!");
    return;
  }
  const lines = cart.items
    .map((i) => `• ${esc(i.name)} ×${i.quantity} — <b>${fmt((i.price ?? 0) * i.quantity, i.currency)}</b>${i.icing_text ? `\n   ✍️ <i>"${esc(i.icing_text)}"</i>` : ""}`)
    .join("\n");
  const subtotal = cart.items.reduce((s, i) => s + (i.price ?? 0) * i.quantity, 0);
  await sendMessage(chatId, `🧺 <b>Your basket</b>\n${lines}\n\nSubtotal: <b>${fmt(subtotal, cart.currency)}</b>\n🛵 One flat delivery fee for the whole basket.`, {
    reply_markup: { inline_keyboard: [[{ text: "🧺 Checkout with Kapu", callback_data: "checkout" }]] },
  });
}

/** Deliver blocks outside a chat turn (scheduled runs) — chips skipped. */
export async function deliverBlocks(chatId: number, blocks: UiBlock[]): Promise<void> {
  const session = await getSession(`tg_${chatId}`);
  for (const b of blocks) {
    if (b.type === "chips" || b.type === "speech") continue;
    await renderBlock(chatId, session, b);
  }
}

async function renderBlock(chatId: number, session: Awaited<ReturnType<typeof getSession>>, block: UiBlock): Promise<void> {
  switch (block.type) {
    case "product_grid": {
      for (const p of block.products.slice(0, 4)) {
        const caption = `${p.pick ? "⭐ <b>KAPU'S PICK</b>\n" : ""}<b>${esc(p.name)}</b>\n${fmt(p.price, p.currency)}${
          p.compare_at_price && p.price && p.compare_at_price > p.price ? ` <s>${fmt(p.compare_at_price, p.currency)}</s>` : ""
        } · ${p.in_stock === false ? "out of stock" : "in stock ✅"}`;
        const keyboard = {
          inline_keyboard: [
            [
              { text: "➕ Add to basket", callback_data: `add:${p.id}`.slice(0, 64) },
              ...(p.url ? [{ text: "🔎 View", url: p.url }] : []),
            ],
          ],
        };
        await sendCard(chatId, resizeImage(p.image, 800), caption, keyboard);
      }
      break;
    }
    case "product_hero": {
      const p = block.product;
      const caption = `<b>${esc(p.name)}</b>\n${fmt(p.price, p.currency)}${
        p.compare_at_price && p.price && p.compare_at_price > p.price ? ` <s>${fmt(p.compare_at_price, p.currency)}</s>` : ""
      }${p.summary ? `\n<i>${esc(p.summary.slice(0, 140))}</i>` : ""}`;
      const keyboard = {
        inline_keyboard: [
          [
            { text: "➕ Add to basket", callback_data: `add:${p.id}`.slice(0, 64) },
            ...(p.url ? [{ text: "🔎 View on Kapruka", url: p.url }] : []),
          ],
        ],
      };
      await sendCard(chatId, resizeImage(p.image, 1200), caption, keyboard);
      break;
    }
    case "compare_grid": {
      const lines = block.products
        .map((p, i) => `${i === 0 ? "⭐" : "▫️"} <b>${esc(p.name)}</b> — ${fmt(p.price, p.currency)}`)
        .join("\n");
      const verdict = block.verdict ? `\n\n🌳 <b>Kapu's verdict:</b> ${esc(block.verdict)}` : "";
      await sendMessage(chatId, `⚖️ <b>Side by side</b>\n${lines}${verdict}`, {
        reply_markup: {
          inline_keyboard: block.products.slice(0, 4).map((p) => [
            { text: `➕ ${p.name.split(" ").slice(0, 3).join(" ").slice(0, 28)}`, callback_data: `add:${p.id}`.slice(0, 64) },
          ]),
        },
      });
      break;
    }
    case "delivery_card": {
      const line = block.available
        ? `🛵 <b>Delivers to ${esc(block.city)}</b>${block.date ? ` · ${block.date}` : ""}\nFlat ${fmt(block.rate ?? null, block.currency || "LKR")} — one fee for the whole basket.`
        : `😕 <b>Not available for ${esc(block.city)}</b>${block.next_available_date ? `\nNext available: ${block.next_available_date}` : ""}`;
      await sendMessage(chatId, `${line}${block.perishable_warning ? `\n⚠️ ${esc(block.perishable_warning)}` : ""}`);
      break;
    }
    case "cart":
      await sendCart(chatId, block.cart);
      break;
    case "order_summary": {
      const s = block.summary;
      const items = s.items
        .map((i) => `• ${esc(i.name)}${i.quantity > 1 ? ` ×${i.quantity}` : ""} — ${fmt((i.price ?? 0) * i.quantity, i.currency)}${i.icing_text ? `\n   ✍️ <i>"${esc(i.icing_text)}"</i>` : ""}`)
        .join("\n");
      await sendMessage(
        chatId,
        `🧾 <b>Order summary</b>\n${items}\n\n📍 <b>${esc(s.recipient.name)}</b> · ${esc(s.delivery.address)}, ${esc(s.delivery.city)}\n📅 ${s.delivery.date}${
          s.delivery_rate != null ? ` · flat ${fmt(s.delivery_rate, s.currency)}` : ""
        }${s.gift_message ? `\n💌 <i>"${esc(s.gift_message)}"</i>` : ""}${s.perishable_warning ? `\n⚠️ ${esc(s.perishable_warning)}` : ""}\n\nTotal: <b>${fmt(s.total, s.currency)}</b>\n\nI never place an order without your yes.`,
        {
          reply_markup: {
            inline_keyboard: [
              [
                { text: "✅ Yes — place the order", callback_data: "confirm" },
                { text: "✏️ Change something", callback_data: "change" },
              ],
            ],
          },
        }
      );
      break;
    }
    case "pay_link": {
      await sendMessage(
        chatId,
        `🎉 <b>Order created — wish granted!</b>\nRef <code>${esc(block.order_ref)}</code> · prices locked ~60 min.\nAfter paying, Kapruka emails your tracking number.`,
        {
          reply_markup: {
            inline_keyboard: [
              [{ text: `🔒 Pay securely${block.total != null ? ` · ${fmt(block.total, block.currency || "LKR")}` : ""}`, url: block.pay_url }],
            ],
          },
        }
      );
      break;
    }
    case "order_timeline": {
      const status = block.status?.toLowerCase() ?? "";
      const delivered = status === "delivered";
      const cancelled = status === "cancelled";
      const real = block.progress.filter((p) => p.step?.trim());
      let lines: string;
      if (real.length > 0) {
        // the MCP's progress[] is the full journey — show EVERY step
        lines = real
          .map((p, i) => {
            const mark = i === real.length - 1 && !delivered && !cancelled ? "🚚" : "✅";
            return `${mark} ${esc(p.step)}${p.timestamp ? ` — <i>${esc(p.timestamp)}</i>` : ""}`;
          })
          .join("\n");
        if (!delivered && !cancelled) lines += "\n◻️ Delivered";
      } else {
        // sparse response — canonical skeleton (out-for-delivery ≈ shipped)
        const steps = ["received", "confirmed", "shipped", "delivered"];
        const doneIdx = steps.indexOf(/out.?for.?delivery/.test(status) ? "shipped" : status);
        lines = steps.map((st, i) => `${i <= doneIdx && !cancelled ? "✅" : "◻️"} ${st}`).join("\n");
      }
      const proof = block.has_delivery_photo || block.has_delivery_video ? "\n📸 Delivery proof available on your Kapruka order page!" : "";
      await sendMessage(chatId, `📦 <b>Order #${esc(block.order_number)}</b> — ${esc(block.status_display || block.status)}\n${lines}${proof}`);
      break;
    }
    case "no_results":
      await sendMessage(chatId, `🔍 No exact match for "<i>${esc(block.query)}</i>" — let me suggest something close.`);
      break;
    case "greeting_card": {
      await sendMessage(
        chatId,
        `${block.glyph} <b>Card for ${esc(block.to)}</b>\n<i>“${esc(block.message)}”</i>${block.from ? `\n— ${esc(block.from)}` : ""}\n🌳 <i>full designed card in the Kapu web app</i>`
      );
      break;
    }
    case "cake_design": {
      // The live designer canvas is web-only — describe the design, then
      // reuse the product-grid rendering for the orderable matches.
      await sendMessage(
        chatId,
        `${block.glyph} <b>Cake Studio</b> — ${esc(block.flavour)} · ${esc(block.style)}` +
          (block.icing_text ? `\n✍️ <i>“${esc(block.icing_text)}”</i>` : "") +
          `\n🌳 <i>design it live in the Kapu web app — here are real cakes that match:</i>`
      );
      if (block.products.length) {
        await renderBlock(chatId, session, { type: "product_grid", products: block.products.slice(0, 4) });
      }
      break;
    }

    case "chips": {
      session.tgChips = block.chips.slice(0, 6);
      saveSession(session);
      await sendMessage(chatId, "👇 Quick replies:", {
        reply_markup: {
          inline_keyboard: session.tgChips.map((c, i) => [
            {
              text: c.slice(0, 40),
              // stateless when it fits (survives restarts); session index otherwise
              callback_data: Buffer.byteLength(c, "utf8") <= 60 ? `say:${c}` : `chip:${i}`,
            },
          ]),
        },
      });
      break;
    }
    case "category_tree": {
      const names = block.categories.slice(0, 24).map((c) => c.name);
      await sendMessage(chatId, `🗂 <b>Kapruka categories</b>\n${names.map((n) => esc(n)).join(" · ")}${block.categories.length > 24 ? " …" : ""}\nJust name one and I'll show you the best of it!`);
      break;
    }
    default:
      break;
  }
}
