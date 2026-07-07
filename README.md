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
- **Hands-free voice loop**: speak Sinhala → Web Speech API (or Whisper fallback with a Sinhala-exemplar prompt + wrong-script retry guard) → Kapu answers **aloud in a native Sri Lankan voice** — Azure `si-LK-ThiliniNeural` (Sinhala) and `ta-LK-SaranyaNeural` (Tamil), prosody-tuned. **Instant spoken acknowledgments** kill dead air, barge-in interrupts mid-sentence, and a tap on the voice-canvas chip switches the listening language. If Azure is unavailable the chain gracefully falls back to OpenAI TTS reading romanized Sinhala — the agent auto-switches its speech script to match whichever engine is live.
- Slash commands: `/si /ta /en` flip the whole experience instantly.

### 📸 Snap-a-list (vision)
Photograph a handwritten shopping list — Sinhala, Tamil, or Tanglish scrawl — and Kapu reads it (Claude vision, GPT-4o-mini fallback), translates "හාල්" → rice, and fills the basket. Also understands **product photos** ("find me this") and **scene photos** ("recreate this birthday table"). Any shop-shelf or competitor screenshot becomes an honest **price-check**.

### 🛍 Agentic commerce, visually rich (24 tools)
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
- 🎂 A **Sri Lankan festival calendar** (Avurudu, Vesak, Esala Perahera, Deepavali, Christmas…) powers a live **seasonal picks rail** (real products for the coming festival, auto-refreshed), the hero countdown + festive dressing, and built-in **festival etiquette** — no alcohol for Vesak, vegetarian Deepavali, nekath timing for Avurudu (with Kapruka's real astrology services for picking the hour).
- 💌 **Greeting cards**: after a gift message, Kapu offers a designed festival card — occasion-themed palettes, perfect Sinhala/Tamil script (canvas-rendered, not AI-mangled), downloadable and WhatsApp-shareable.
- 📉 **Price-drop watch**: "tell me on Telegram if this hamper gets cheaper" → an autonomous watcher polls, alerts on a real ≥2% drop, then retires itself.
- 🟢 **WhatsApp handoff**: share the basket or send the price-locked pay link to the family group in one tap — she orders in Melbourne, aiya in Colombo pays.

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
- **First-run guided tour** — spotlight coach-marks over the composer, camera, mic, wish cards, Telegram and language toggle (replay anytime with `/tour`).
- **Live activity trail** — while Kapu works, completed steps stack up as green ✓ chips ("✓ Searching Kapruka ✓ Comparing options") ahead of the animated current step; agentic work is visible, not hidden.
- **Turns survive anything** — refresh or navigate away mid-search and the agent finishes server-side; returning to the conversation picks the reply up automatically.
- **Ranked merchandising** — the top hit wears **KAPU'S PICK**, the cheapest-in-grid wears **BEST VALUE**; tap a product for the instant detail modal.
- **QR handoff** — scan from the account sheet (or the landing) and continue on your phone; sign in with the same Google and wishes follow.
- **The landing page is a product demo**: embedded 75-sec film, auto-playing wish demo, floating PWA phone mockups, an animated Kapu's-Pick comparison duel, the seasonal collage, a voice-agent orb, a Telegram family-group mock, the full tech stack and a clickable architecture diagram.

### 🔐 Guest-first auth
Works fully as a guest. Optional **Sign in with Google** (GIS ID-token → HMAC cookie; no client secret, no extra deps) unlocks cross-device wish sync, account memory, and Schedules.

---

## 🏗 Architecture

**📐 Visual diagram:** [kapuwa.shop/architecture.html](https://kapuwa.shop/architecture.html) · [`docs/architecture.html`](docs/architecture.html)

```
Browser (PWA, SSE) ──► /api/chat ─┐
Telegram (private + groups) ──────┤──► ONE agent core (24 tools) ──► MCP Shield ──► mcp.kapruka.com
     /api/telegram (webhook)      │        │ system prompt · session store · memory
Voice /api/stt · /api/tts ────────┘        │
Vision /api/scan ──────────────────────────┘
⏰ Schedule runner (60s tick, src/instrumentation.ts) — autonomous runs → Telegram
```

- **Next.js 15 monolith** (frontend + API in one Node process) → **Railway**.
- **Self-healing engine**: if the API key hits a billing/credit wall mid-judging, the failed turn is automatically retried on the subscription-token engine and sticks there for 10 minutes before re-probing — a dead key can never take the demo down.
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

## 📜 Build log — the challenge weekend

Everything shipped, in order, across ~48 hours:

- **UI**: implemented the 11-section "Kapu redesigned" spec — app shell (sidebar → icon rail + live basket panel), Instrument Serif design system, 1.6px stroke icons, dark mode, PWA
- **Agent core**: 24 tools over the Kapruka MCP behind a caching/coalescing/rate-limited shield; dual Claude engines (Messages API + Agent SDK) with automatic billing fallback
- **Blocks**: product rails with pick/value badges, cake-moment hero (icing + date pills + variants + live delivery quote), compare duels with verdicts, confirm-gate order summary, price-locked pay card, order timeline with delivery photo-proof
- **Voice**: full hands-free loop (Web Speech si-LK + Whisper fallback), instant spoken acks, barge-in, iOS stall-finalizer, language cycling — and native **Thilini/Saranya** neural voices via Azure with automatic script switching
- **Vision**: snap-a-list camera OCR (Sinhala handwriting → basket), scene recreation, price-check-anything
- **Telegram**: @KapuLKBot — private + group chats (@mention wake, one shared family basket), voice notes, photo lists, inline add/confirm/pay keyboards, live self-editing status ticker, byte-uploaded product photos, `/link` account binding, command menu
- **Memory**: consent-first recipients & occasions, "My Kapu" standing rules, favorites that ride into agent context, cross-conversation awareness — account-backed via Google sign-in, guest-first otherwise
- **Autonomy**: Kapu Schedules — a 60s in-process runner executing standing wishes with recorded consent (AP2-style mandates), order watchers, price-drop alerts, all delivered to Telegram
- **Seasonal**: live festival calendar → seasonal picks rail, hero dressing, etiquette rules, delivery-cutoff nudges, canvas greeting cards, autonomous festival-gift offers
- **Experience**: first-run spotlight tour, `/` command palette, background-surviving turns, live ✓-step activity trail, notification center, Track-Order UI, product detail modals, instant cart, WhatsApp share, QR phone handoff
- **Landing**: two-column hero with auto-playing demo + voice teaser, embedded film, floating phone mockups, animated Pick duel, seasonal collage, voice-agent section, Telegram mock, tech stack + SVG architecture diagram, honest "real capabilities" toasts
- **Ops**: deployed to Railway (`kapuwa.shop` custom domain), MongoDB persistence, webhook + secret hardening, OG link previews, PWA service worker, production smoke suites after every deploy

## 🔍 Field notes from the live Kapruka MCP

Hard-won verified facts baked into the code: args must nest under `params`; prices arrive as `{amount, currency}` objects *or* bare numbers; search's `category` facet is a stub (route by product-ID prefix instead); `stock_level` reads "low" on everything (never render urgency); the image CDN is width-tunable (`width=330` → `1200` for heroes); ~325 deliverable cities with vernacular aliases; Jaffna next-day at a flat Rs 2,500; and yes — Kapruka sells **bookable astrology readings**, so Kapu can plan a nekath-timed delivery. 🔮

---

Built with 🧡 for the wish-granting tree — **Kapu speaks සිංහල · தமிழ் · English · Tanglish**, powered by the Kapruka MCP + Claude.
