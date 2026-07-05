#!/usr/bin/env node
// Local Telegram testing without a public URL: long-poll getUpdates and
// forward each update to the local /api/telegram route.
//   TELEGRAM_BOT_TOKEN=... node scripts/tg-poll.mjs
// (Reads .env automatically. Ctrl-C to stop. Delete any webhook first — this
// script does that for you.)

import { readFileSync } from "node:fs";

// tiny .env loader (no dep)
try {
  for (const line of readFileSync(new URL("../.env", import.meta.url), "utf8").split("\n")) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*"?([^"\n]*)"?\s*$/.exec(line);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
  }
} catch {}

const TOKEN = process.env.TELEGRAM_BOT_TOKEN?.trim();
const SECRET = process.env.TELEGRAM_WEBHOOK_SECRET?.trim();
const LOCAL = `http://127.0.0.1:${process.env.PORT || 3100}/api/telegram`;
if (!TOKEN) {
  console.error("Set TELEGRAM_BOT_TOKEN (BotFather) in .env first.");
  process.exit(1);
}
const api = (m, p = {}) =>
  fetch(`https://api.telegram.org/bot${TOKEN}/${m}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(p),
  }).then((r) => r.json());

const me = await api("getMe");
if (!me.ok) {
  console.error("Token rejected:", me.description);
  process.exit(1);
}
await api("deleteWebhook");
console.log(`🌳 Kapu Telegram poller — @${me.result.username} → ${LOCAL}`);

let offset = 0;
for (;;) {
  try {
    const res = await api("getUpdates", { timeout: 25, offset });
    for (const update of res.result ?? []) {
      offset = update.update_id + 1;
      console.log(
        `→ update ${update.update_id}:`,
        update.message?.text ?? (update.message?.voice ? "🎙 voice" : update.message?.photo ? "📸 photo" : update.callback_query?.data ?? "…")
      );
      fetch(LOCAL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(SECRET ? { "x-telegram-bot-api-secret-token": SECRET } : {}),
        },
        body: JSON.stringify(update),
      })
        .then((r) => {
          if (!r.ok) console.error(`forward rejected: HTTP ${r.status}`);
        })
        .catch((e) => console.error("forward failed:", e.message));
    }
  } catch (e) {
    console.error("poll error:", e.message);
    await new Promise((r) => setTimeout(r, 3000));
  }
}
