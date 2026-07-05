# Kapu (කපූ) 🌳 — Sri Lanka's Wish-Granting Shopping Agent

> Built for the **Kapruka Agent Challenge 2026**. Whisper a wish in **සිංහල, தமிழ், English or Tanglish** — by text, **voice**, or a **photo of a handwritten shopping list** — and Kapu shops all of Kapruka.com for you: groceries, phones, medicine, cakes to Kandy, pirikara to the temple.

Named after the mythical **kapruka** — the wish-granting tree. Tell Kapu what you wish for, and it appears at a doorstep anywhere in Sri Lanka.

**One agent brain, three doors:** Web app · installable PWA · Telegram bot (**@KapuLKBot**, groups included).

### 🔗 Live
**Web / PWA:** **[kapuwa.shop](https://kapuwa.shop)** &nbsp;·&nbsp; **Telegram:** **[t.me/KapuLKBot](https://t.me/KapuLKBot)** &nbsp;·&nbsp; **Film:** **[75-sec demo](https://youtu.be/zQyPcT_V1_A)** — try: `machan mata phone ekak one 60000 ta aduwen`

---

## ✨ What Kapu can do

### 🗣 Truly trilingual — script, speech and soul
- Full UI chrome in **Sinhala / Tamil / English** (සිං · த · EN toggle localizes *everything*, ~130 keys) — and the agent replies in your script.
- **Tanglish/Singlish native**: `machan mata phone ekak one 60000 ta aduwen` just works.
- **Hands-free voice loop**: speak Sinhala → Web Speech API (or Whisper fallback with a Sinhala-exemplar prompt + wrong-script retry guard) → Kapu answers **aloud**. Sinhala speech is romanized for TTS so it sounds natural, not robotic. Barge-in, thinking quips, full voice canvas UI.
- Slash commands: `/si /ta /en` flip the whole experience instantly.

### 📸 Snap-a-list (vision)
Photograph a handwritten shopping list — Sinhala, Tamil, or Tanglish scrawl — and Kapu reads it (Claude vision, GPT-4o-mini fallback), translates "හාල්" → rice, and fills the basket. Also understands **product photos** ("find me this") and **scene photos** ("recreate this birthday table"). Any shop-shelf or competitor screenshot becomes an honest **price-check**.

### 🛍 Agentic commerce, visually rich (22 tools)
- Streaming SSE chat with **UI blocks**, not walls of text: product rails with *KAPU'S PICK*, a **cake-moment hero** (inline icing-message field + delivery-date pills + variant picker), **compare duels** with per-row winners and Kapu's verdict, delivery cards, live basket, order timeline.
- **Instant cart** — ➕ steppers hit `/api/cart` directly, no LLM round-trip.
- **Click any product** → full-detail modal fetched straight from the MCP (gallery, variants, delivery quote) with an *"Ask Kapu about this"* handoff.
- **♥ Favorites** on every card — and they ride into the agent's context, so *"add my favorites to the basket"* just works. One tap builds a basket from all of them.
- **Live delivery quotes on the product card** for your saved city ("flat Rs 1,075 to Kandy · from tomorrow") — positive framing, shield-cached.
- **Gift boxes & hampers** are first-class ("one box, one flat delivery"), and Kapu offers to build a custom one when nothing pre-made fits.

### 🔒 Ordering with honest guardrails
- `create_order` is **triple-gated**: visual order-summary card → explicit human confirmation → executor refuses without `confirmed=true`.
- Money only ever moves through Kapruka's **secure pay link** (~60-min price lock with a live countdown + full breakdown: items / delivery / add-ons).
- **Honesty engineering**: no fake urgency (the catalog's `stock_level` is unreliable — Kapu never renders it), totals labeled *"delivery added at payment"* when unverified, and the price-check feature will happily admit "Kapruka doesn't win this one."

### 📦 Tracking with delivery proof
- Track in chat or via the dedicated **Track Order** UI: rich timeline (received → confirmed → shipped → delivered) with real timestamps and Kapruka's **delivery photo/video proof** panel — *see it arrive*.
- **"Watch this order"** → an autonomous watcher polls every 3 hours and pings your **Telegram** only when the status changes, celebrates delivery 🎉, then retires itself. Zero LLM cost.

### ⏰ Kapu Schedules — standing wishes (the autonomous part)
- *"Every month-end, fresh flowers under Rs 5,000 for Amma — schedule it."* Kapu parses natural cadence (once/daily/weekly/monthly/yearly, Sri Lanka time), restates the plan, and runs it **on its own** — a 60-second in-process runner executes due schedules through the same agent core in persistent sessions (recurring runs remember previous ones).
- **Standing consent (AP2-style mandate)**: at creation you choose — *proposals only*, or *place the order each time and send me the pay link*. Even with consent, a human always pays.
- Results delivered to your linked **Telegram** (`/link` → 6-digit code) or the web notification bell. Auth-gated: schedules belong to your Google account, not a browser.

### 🧠 Memory with consent
- *"Remember Amma — Kandy, 077…"* → saved recipients & occasions (birthdays, anniversaries), **asked first, never scraped**. Signed-in users get account-backed memory across devices; guests stay on-device.
- **My Kapu — teach it your rules**: standing instructions ("vegetarian household, never suggest alcohol, warn me over Rs 20,000, talk like a friend") honored in every conversation.
- **Cross-conversation awareness**: recent wish titles ride along so Kapu can pick up threads ("continuing your pirikara arrangement?").
- 🎂 A **Sri Lankan festival calendar** (Avurudu, Vesak, Esala Perahera, Deepavali, Christmas…) powers the hero countdown chip and gift nudges.

### 🔔 Agentic notification center
The bell is a real feed: upcoming saved occasions ("Amma's birthday in 12 days — *Plan a gift*"), festival countdowns, pay-links awaiting payment, autonomous schedule results and next runs — every item has an action button that makes Kapu *do* the thing.

### ✈️ Telegram — the same brain in your pocket (and your family group)
- Private chats **and groups**: add Kapu to the family group — it wakes only on @mention or reply (privacy-respecting) and everyone shares **one basket**.
- Sinhala **voice notes** → Whisper → full agent turn. **Photos** → vision scan. Product cards arrive as real photos (Kapu re-uploads bytes itself since Cloudflare blocks Telegram's fetcher) with ➕ Add / confirm / pay inline keyboards.
- A **live status ticker** edits itself in place while Kapu works ("✓ ~~Searching Kapruka~~ → ⏳ Comparing options…") so long agent turns never feel dead.

### 🎨 The "Kapu redesigned" system
- Kapruka purple `#402970` + gold, **Instrument Serif** editorial headlines & prices, 1.6 px stroke icon set, purple-tinted creams, full **dark mode**, PWA-installable with offline shell.
- App shell: sidebar → icon rail + live basket panel (collapsible), recent wishes with cross-device sync, deliver-to city typeahead with vernacular aliases ("nugegoda", "යාපනය"), mobile nav drawer, hero **typewriter ticker** that *demonstrates* capabilities — every phrase is tappable and actually does the thing.
- **`/` command palette** in the composer: `/track /basket /fav /schedule /deals /gift /voice /scan /dark /telegram /help` with ↑↓ + Tab completion.
- Edge states with grace: friendly no-results, rate-limit and connection-lost cards — every failure speaks Kapu ("Aiyo!").

### 🔐 Guest-first auth
Works fully as a guest. Optional **Sign in with Google** (GIS ID-token → HMAC cookie; no client secret, no extra deps) unlocks cross-device wish sync, account memory, and Schedules.

---

## 🏗 Architecture

**📐 Visual diagram:** [kapuwa.shop/architecture.html](https://kapuwa.shop/architecture.html) · [`docs/architecture.html`](docs/architecture.html)

```
Browser (PWA, SSE) ──► /api/chat ─┐
Telegram (private + groups) ──────┤──► ONE agent core (22 tools) ──► MCP Shield ──► mcp.kapruka.com
     /api/telegram (webhook)      │        │ system prompt · session store · memory
Voice /api/stt · /api/tts ────────┘        │
Vision /api/scan ──────────────────────────┘
⏰ Schedule runner (60s tick, src/instrumentation.ts) — autonomous runs → Telegram
```

- **Next.js 15 monolith** (frontend + API in one Node process) → **Railway**.
- **Dual Claude engine**, auto-selected by credential: `ANTHROPIC_API_KEY` → manual Messages-API loop (streaming + prompt caching); `ANTHROPIC_AUTH_TOKEN` (subscription OAuth) → Claude Agent SDK. Force with `KAPU_ENGINE=api|agent-sdk`. Model via `KAPU_MODEL` (default `claude-sonnet-4-6`).
- **MCP Shield** — the only module that touches the Kapruka MCP: per-tool LRU cache, in-flight coalescing, token-bucket queue under the shared 60 req/min/IP limit.
- **MongoDB (optional but recommended)**: sessions, users, orders, schedules survive redeploys; app runs fully in-memory without it.
- Sessions are channel-agnostic: `web` and `tg_<chatId>` share the same store, tools and memory.

## 🚀 Run locally

```bash
cp .env.example .env    # add ANTHROPIC_API_KEY (or ANTHROPIC_AUTH_TOKEN) + OPENAI_API_KEY
npm install
npm run dev             # http://localhost:3000  (use -p 3100 if 3000 is busy)
```

**Telegram locally** (no public URL needed):

```bash
# .env: TELEGRAM_BOT_TOKEN=...  TELEGRAM_WEBHOOK_SECRET=...
node scripts/tg-poll.mjs   # long-polls and forwards updates to your dev server
```

Visual QA without burning tokens: `/preview` renders every UI block with fixtures (`?lang=si|ta&dark=1`).

## ☁️ Deploy (Railway)

1. **Deploy from GitHub repo** — Railway auto-detects Next.js (`npm run build` / `npm start`, honors `$PORT`). Health check: `/api/health`.
2. Set env vars — see `.env.example`:

| Variable | Purpose |
|---|---|
| `ANTHROPIC_API_KEY` | the agent brain (recommended for hosting) |
| `KAPU_MODEL` | default `claude-sonnet-4-6` |
| `OPENAI_API_KEY` | Whisper STT + TTS voice (+ vision fallback) |
| `MONGODB_URI` | persistence across redeploys (strongly recommended) |
| `NEXT_PUBLIC_GOOGLE_CLIENT_ID` + `KAPU_AUTH_SECRET` | Google sign-in (add your domain to *Authorized JS origins*) |
| `TELEGRAM_BOT_TOKEN` + `TELEGRAM_WEBHOOK_SECRET` | the Telegram channel |
| `ELEVENLABS_API_KEY`, `AZURE_SPEECH_KEY` | optional nicer voices |

3. Point Telegram at production and stop any local poller:

```bash
curl "https://api.telegram.org/bot<TOKEN>/setWebhook?url=https://<your-domain>/api/telegram&secret_token=<SECRET>"
```

## 🗺 Project map

| Path | What lives there |
|---|---|
| `src/lib/agent/` | system prompt & persona, 22 tool definitions + executors, dual engines, memory |
| `src/lib/kapruka/` | MCP shield, payload normalizers, shared cart logic |
| `src/lib/telegram/` | webhook handler, TG API wrapper, block → photo/keyboard rendering |
| `src/lib/schedules/` | standing-wish store, cadence math (SL time), autonomous runner |
| `src/components/` | app shell (`KapuApp`), UI-block renderers, stroke icon set |
| `src/app/api/` | chat (SSE), cart, cities, delivery, product, track, orders, occasions, schedules, scan, stt, tts, auth, wishes, telegram, health |
| `src/lib/client/i18n.tsx` | the full trilingual dictionary |
| `scripts/tg-poll.mjs` | local Telegram long-poller |

## 🔍 Field notes from the live Kapruka MCP

Hard-won verified facts baked into the code: args must nest under `params`; prices arrive as `{amount, currency}` objects *or* bare numbers; search's `category` facet is a stub (route by product-ID prefix instead); `stock_level` reads "low" on everything (never render urgency); the image CDN is width-tunable (`width=330` → `1200` for heroes); ~325 deliverable cities with vernacular aliases; Jaffna next-day at a flat Rs 2,500; and yes — Kapruka sells **bookable astrology readings**, so Kapu can plan a nekath-timed delivery. 🔮

---

Built with 🧡 for the wish-granting tree — **Kapu speaks සිංහල · தமிழ் · English · Tanglish**, powered by the Kapruka MCP + Claude.
