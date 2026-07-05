# Kapruka Agent Challenge 2026 — Winning Design & Feature Spec

> **"Kapu / කපූ"** — a trilingual (Sinhala / Tamil / English + Tanglish) shopping concierge for everyday Sri Lanka: groceries, gadgets, fashion and daily essentials for *yourself* — and, when it matters, gifts sent home that let you *be present from 10,000 km away.*

| | |
|---|---|
| **Competition** | Kapruka Agent Challenge — "Build Sri Lanka's best AI shopping agent. Win a Mac Mini." |
| **Grand prize** | Apple M4 Mac mini (10-core CPU / 10-core GPU, 16 GB, 512 GB per challenge page; retail ≈ USD 799) |
| **Entries close** | 30 June 2026 (live demo link in by end of day) |
| **Eligibility** | Solo builders only — one person, one entry, one prize. Open to Sri Lankans **based in Sri Lanka** (local-only round). |
| **Primary interface** | A **hosted, public, full-screen, very visual** chat shopping experience |
| **Scoring (of 100)** | Experience & polish **30** · Visual richness **20** · Personality **15** · Usefulness **15** · End-to-end completeness **15** · Creativity **5** |
| **Doc date** | 8 June 2026 |
| **Status** | Verified against live MCP (`kapruka_mcp v1.27.0`) + challenge page on 8 Jun 2026 — **thesis rebalanced to everyday-shopper-first**; see §0. |

---

## 0. ⚠️ Verified brief, official scoring & gap analysis (8 Jun 2026 research)

> This section was added after researching every link in the organisers' email — the [Challenge page](https://www.kapruka.com/contactUs/agentChallenge.html), the [MCP docs](https://mcp.kapruka.com), and the **live MCP endpoint** (`https://mcp.kapruka.com/mcp`, verified `kapruka_mcp v1.27.0`, no auth, Streamable HTTP). It records what the brief *actually* says, what we got wrong, and what we're adding. **Read this first — it overrides anything below it on conflict.**

### 0.1 How this was verified

- ✅ Connected to the live MCP, ran `initialize` → `tools/list` → real `tools/call`s.
- ✅ Pulled the **real category tree** (64 categories) and live products (a Samsung Galaxy A07 at LKR 46,490, 5 kg rice at LKR 1,150, Panadol 240s at LKR 840).
- ✅ Ran real `check_delivery` / `list_delivery_cities` calls.
- ✅ Read the challenge page twice (rubric, rules, FAQ) + the MCP docs page.

### 0.2 The OFFICIAL scoring rubric (this is what wins — memorise it)

| Criterion | Points | What it really rewards |
|---|---:|---|
| **Experience & polish** | **30** | Smooth, fast, app-like, reliable (judges test daily). The single biggest lever. |
| **Visual richness** | **20** | Images, product cards, carousels, galleries, comparison views — *full-screen, very visual.* |
| **Personality** | **15** | Warm, witty, human, local flavour ("Aiyo! 💔" energy) woven into copy. |
| **Usefulness** | **15** | Does it genuinely help a real shopper get what they need? |
| **End-to-end completeness** | **15** | Discovery → cart → delivery check → checkout → tracking, all working. |
| **Creativity** | **5** | The surprising, original touches. |

**Bonus points** (organisers' own list): multi-item carts · delivery-date handling · gift messaging · **Tanglish** · **Sinhala** *("Sinhala especially — it fits Kapruka's market perfectly and almost no one will attempt it").*

> **Calibration shock:** *Experience & polish (30) + Visual richness (20) = 50% of the score is UX/visual craft.* **Creativity is only 5.** Our previous draft was innovation-and-feature-maximalist — that maps to ~5 points. **We must re-weight effort toward polish, visual richness, personality, and a flawless end-to-end happy path.** A gorgeous, fast, witty agent that nails grocery→cart→checkout→track beats a sprawling feature list that feels rough.

### 0.3 Rules & eligibility (verified)

- **Solo builders only** — one person, one entry, one prize.
- **Open to Sri Lankans based in Sri Lanka** — explicitly a local-only round (the diaspora is *the agent's user*, not necessarily *the builder*; don't confuse the two).
- **Must be a live, public URL** that works at judging time — *demos are tested daily*, so **uptime and reliability are graded** (this is "Experience & polish").
- **Must build on the Kapruka MCP.**
- **Respect customers and the catalog** — no spam, no abuse of the live order tools.
- **Any model / framework / hosting** is allowed (Claude, GPT, open models — our Claude choice stands).

### 0.4 ⚠️ Strategic correction — build EVERYDAY-SHOPPER-FIRST

The organisers' email is explicit, and the live catalog confirms it:

> *"Kapruka isn't just gifts… electronics, groceries, fashion, home and daily essentials, plus thousands of third-party sellers. **The majority of orders are people shopping for themselves, not sending gifts.** Build for that reality: the everyday shopper buying for their own needs is your main user, with gifting as one important mode among many."*

The real top-level catalog (64 categories) is dominated by **everyday retail**: `Electronic, Grocery, Pharmacy, Fashion, Clothing, Vegetables, Fruits, Curd, Household, Books, Sports, Pet, Cosmetics, Perfumes, Jewellery, BabyItems, Ayurvedic, Automobile, Bicycle, Liquor, samedaydelivery, bestsellers, newadditions, promotions, Services` — with gifting/festival categories (`cakes, flowers, pirikara, sympathies, birthday, wedding, christmas, diwali, thaipongle, valentine, mother, anniversary, combopack, Giftset…`) as *one slice*.

**Our prior thesis ("we don't build a shopping agent; we build a diaspora gifting concierge") is misaligned with the brief and the rubric.** Corrected positioning:

> **Primary:** a delightful everyday Sri Lankan shopping agent (buy groceries, a phone, medicine, clothes for *yourself*), that is fast, visual, witty and complete.
> **Flagship differentiator mode:** the trilingual, culturally-fluent **gifting & diaspora** experience (delivery-photo proof, Sinhala gift-card poetry, festival hampers, dāna/pirikara) — our moat for *Creativity*, *Personality* and the *Sinhala/Tanglish* bonuses, layered *on top of* a rock-solid shopping core.

Everything in §1–§18 below should be read through this rebalanced lens. The gifting/cultural depth is still our edge — it's just **not the whole product**.

### 0.5 Submission, timeline & FAQ (verified)

- **Register:** entry form at `https://www.kapruka.com/contactUs/agentChallengeApply.html`, **and** reply to the organisers' email with your public link when ready.
- **Deadline:** 30 June 2026, demo link in by end of day.
- **No API key** — the MCP is free and public.
- A **video FAQ** was promised by the organisers (not yet published as of 8 Jun) — watch the inbox.

### 0.6 Gap analysis — what our spec got wrong or missed

| # | Issue in prior draft | Verified reality | Fix |
|---|---|---|---|
| G1 | §13 invented scoring criteria (Innovation / Cultural relevance / Tech / UX / Completeness) | Official rubric is Experience&polish 30 · Visual 20 · Personality 15 · Usefulness 15 · Completeness 15 · Creativity 5 | §0.2 + §13 rewritten |
| G2 | Whole thesis = diaspora gifting | Brief: everyday self-shoppers are the **main** user | §0.4 + §1 rebalanced |
| G3 | Under-weighted UI; "poster-style cards" mentioned in passing | **50% of score is polish + visual richness**; "full-screen, very visual" | New §0.2 emphasis + visual feature group |
| G4 | "Singlish" used throughout | Brief's bonus term is **"Tanglish"** (+ Sinhala) | Terminology aligned; both covered |
| G5 | MCP calls shown without arg wrapping | **Every tool nests args under a `params` object**: `{"name":"…","arguments":{"params":{…}}}` | §6 corrected |
| G6 | Only the 30 orders/hr limit noted | Also **60 requests/min/IP across all tools** (verified in `RateLimit-*` headers) | §6 corrected |
| G7 | Demo used "delivery's still LKR 300" | Real Kandy rate = **LKR 1,075**, flat per city/date and **identical across product types** (cake = rice = phone = Panadol) | §6 + §14 fixed |
| G8 | `check_delivery` "returns contradictory availability" asserted as fact | **Could not reproduce on 8 Jun** — it returned clean `available:true`. Keep defensive handling but don't assert it. | §6 softened |
| G9 | ID quirk framed as just `CAKE00KA` vs `cake00KA` | IDs are wildly heterogeneous: `cake00ka002034`, `GROCERY002512`, `PHARMACY00294`, `EF_PC_ELEC0V4463POD00060FDP`, `PIRIKARA0191` | §6 generalised |
| G10 | `create_order` fields approximate | Exact nested schema verified (CartItem/Recipient/Delivery/Sender; `location_type`∈house/apartment/office/other; `icing_text`≤120 silently ignored for non-cake; `gift_message`≤300) | §6 corrected |
| G11 | No everyday-shopping features | Catalog is electronics/grocery/pharmacy/fashion-heavy + a `samedaydelivery` category | New §8 group "🛒 S. Everyday self-shopping" + §P visual/polish group |
| G12 | `check_delivery` `now` field unused | Returns server time in **SL timezone (+05:30)** — a free primitive for the timezone feature | Noted in §6 |

### 0.7 Net effect on strategy

1. **Spend the most build time on the happy path + polish + visuals** (55 of 100 points: Experience 30 + Visual 20 + Completeness… overlaps). A flawless, beautiful everyday-shopping flow is the floor.
2. **Lead the demo with self-shopping** (phone / grocery run / medicine), then *reveal* the gifting & Sinhala magic as the wow.
3. **Keep the cultural/diaspora depth** — it's our Creativity/Personality/Sinhala-bonus moat — but as a mode, not the identity.

---

## 1. Executive summary — the thesis that wins

Most entrants will build a chatbot that wraps the 7 Kapruka MCP tools in a chat loop. That is table stakes, not a winner. But the *opposite* over-correction — a niche diaspora-gifting concierge — misreads the brief too (see §0.4).

**What wins is a beautiful, fast, witty everyday Sri Lankan shopping agent that anyone would actually use to buy their own groceries, gadgets and essentials — with a culturally-fluent gifting mode that nobody else will dare to build.**

The brief is explicit that **the everyday shopper buying for themselves is the main user**, and the live catalog proves it — 64 categories led by `Electronic, Grocery, Pharmacy, Fashion, Vegetables, Household, Books, Sports`. So the **core product** is a delightful self-shopping experience, judged mostly on *Experience & polish (30)*, *Visual richness (20)* and *Personality (15)*.

On top of that core, the Kapruka MCP quietly reveals a second, emotional layer competitors will miss:

- It prices in **LKR, USD, GBP, AUD, CAD, EUR** — six currencies for a Sri Lankan store.
- Its order tracking exposes **delivery photo & video proof**.
- Its categories include **pirikara, sympathies, Avurudu/`newyear_january`, `thaipongle`, `diwali`, `christmas`, cakes, flowers**.

That second layer is **the Sri Lankan diaspora sending gifts home** — a daughter in Melbourne sending her mother a birthday cake in Kandy, and never getting to see her face when it arrives. We make *that* feel like magic.

So our positioning is **two-tier**:

1. **Core (where the points are):** a polished, very visual, trilingual (Sinhala / Tamil / English + **Tanglish**, i.e. romanized) everyday-shopping concierge with a flawless discovery → cart → delivery → checkout → tracking loop.
2. **Differentiator mode (our moat for Creativity / Personality / the Sinhala bonus):** a gifting & diaspora concierge with deep cultural intelligence — festivals, almsgiving, gifting etiquette — and an emotional payoff layer (delivery proof, gift-message poetry, occasion memory).

---

## 2. Decision log (locked)

| Decision | Choice | Why |
|---|---|---|
| **AI provider / SDK** | **Dual engine, auto-selected by credential (built & verified 10 Jun):** (1) **Messages API manual loop** (`@anthropic-ai/sdk`) when `ANTHROPIC_API_KEY` is set — recommended for the hosted demo; (2) **Claude Agent SDK engine** (`@anthropic-ai/claude-agent-sdk`, in-process MCP server bridging the same 11 tools) when only a subscription `ANTHROPIC_AUTH_TOKEN`/`CLAUDE_CODE_OAUTH_TOKEN` is available — verified working end-to-end on a Claude-plan token. Force with `KAPU_ENGINE=api\|agent-sdk`. | Chosen over OpenAI Agents SDK for Sinhala/Tamil quality + MCP-first ecosystem. Subscription OAuth tokens are rejected by the raw Messages API but accepted via the Claude Code harness — the dual engine supports both credential styles with one tool surface and one persona. Model env-configurable via `KAPU_MODEL` (currently `claude-sonnet-4-6`). |
| **Stack / language** | **TypeScript + Next.js (App Router).** | Poster-style chat UI + server-side agent loop (API keys stay server-side) + easy deploy. Both SDKs and MCP are first-class in TS. |
| **Channels** | **Web chat + WhatsApp in parallel**, over a shared agent core. | Web mirrors the poster and demos cleanly; WhatsApp is THE Sri Lankan channel and the strongest "real product" signal. |
| **Agent name** | **Kapu (කපූ)** — "Kapu by Kapruka". | Diminutive of Kapruka (the mythical wish-granting *kapruka* tree — the agent that grants what you wish for); 2 syllables, pronounceable identically in Sinhala/Tamil/English; register-neutral (works for elders *and* "machan" chat); mascot-able (a little wish-tree sprite). Runners-up: **Yaalu** (යාළු, "friend" — warm but generic), **Sithu** (සිතූ, "wished" — poetic but obscure), **Machan** (max personality but wrong register for condolence/elder modes). |
| **Voice** | **IN SCOPE (locked 10 Jun): Kapu must talk and interact.** Voice layer = **ElevenLabs** — Agents platform (or Flash v2.5 over WebSocket) for spoken replies with barge-in/turn-taking; **Scribe/Whisper STT** for voice input (Whisper supports Sinhala); **Azure `si-LK-ThiliniNeural`** routed in for Sinhala-script speech (ElevenLabs has **no Sinhala** TTS in any model — verified 10 Jun; Tamil ✅). | ElevenLabs is the best-sounding, lowest-latency (~75ms Flash) voice on the market and its Agents platform gives interruption handling + turn-taking out of the box. Build order still applies: core text loop first, voice layered on top (§2.1) — voice rides the same agent core, it's a channel, not a fork. |

### 2.1 Voice — rubric reality + the build plan (decided 10 Jun: Kapu talks)

**Rubric reality first:** Experience 30 + Visual 20 + Personality 15 + Usefulness 15 + Completeness 15 + Creativity 5 — voice is not a named criterion. It scores *indirectly*: a natural spoken Kapu is a big **Personality** and **Creativity** lever and a memorable demo moment; a janky one *costs* Experience points. So the rule is: **the text core must be flawless first; voice is a channel on top of the same agent core, never a fork.**

**Decision: voice IS in scope — Kapu must talk and interact.** The build:

1. **Voice input (week 1 of voice work):** mic / push-to-talk → **Whisper or ElevenLabs Scribe STT** (Whisper handles Sinhala + code-switched Tanglish) → the normal agent loop. Robust, degrades gracefully.
2. **Spoken replies:** **ElevenLabs Flash v2.5** streamed over WebSocket (~75ms) — one warm, consistent "Kapu voice" for English / Tanglish / Tamil. Pick one voice and keep it; the voice IS the personality.
3. **Full interaction:** **ElevenLabs Agents** platform for real conversation — barge-in (interrupt Kapu mid-sentence), turn-taking, language auto-detect. Wire its tool/webhook layer to our same agent core so voice-Kapu and text-Kapu are one brain.
4. **The Sinhala gap, handled honestly:** ElevenLabs has **no Sinhala TTS** (verified 10 Jun; Tamil ✅ in v3 + Multilingual v2). When the reply is Sinhala *script*, route TTS to **Azure `si-LK-ThiliniNeural`** (serviceable neural Sinhala). Tanglish (romanized) replies stay on the ElevenLabs voice — it reads Latin script with natural prosody, which is exactly how young SL users chat anyway. This dual-engine routing is itself a credibility story for the demo.
5. **UI:** voice mode is a visible, polished toggle (waveform animation, live captions of what Kapu says — captions keep the *Visual* score even in voice mode).

**Verdict: ElevenLabs is the right primary voice — best naturalness + lowest latency + an Agents platform with interaction built in. Alternatives considered: OpenAI Realtime API (true speech-to-speech, simpler stack, but a generic voice and weaker voice-brand control) and Azure Speech alone (has Sinhala but flat personality). We take ElevenLabs for the voice itself + Azure only for the Sinhala niche.**

---

## 3. The opportunity — why the gifting/diaspora MODE is our differentiator

> Context per §0.4: the **core** product is everyday self-shopping (that's where most points and most users are). The gifting/diaspora story below is the **differentiator layer** we add on top — it earns Creativity, Personality and the Sinhala bonus, and it's emotionally unforgettable in a demo. Build the core first; this is the cherry.

- **The market is real and underserved.** Hundreds of thousands of Sri Lankans abroad (AU, UK, CA, US, EU) regularly send gifts home — birthdays, Avurudu, funerals, new babies. Kapruka is a dominant player here, and the multi-currency + delivery-proof primitives in the MCP exist precisely for this.
- **The pain is emotional, not transactional.** They can't be there. They worry the cake will be stale. They don't know if it arrived. They want it to feel personal, in *their* language, in the right cultural register.
- **The MCP gives us exactly the primitives to solve it:** multi-currency, delivery-feasibility, perishability awareness, and delivery photo/video proof.

An agent that *understands this human story* — and speaks Sinhala the way Sri Lankans actually text — beats a faster product-search bot every time.

---

## 4. Architecture (4 layers)

```
CHANNELS     Web chat (poster-style cards)  │  WhatsApp (THE SL channel)  │  Voice (ElevenLabs, Phase 3)
                                  │
i18n +       language detect (script + model) → code-switch handling →
PERSONA      response-language control → tone register (formal-elder / warm-mom / casual-friend)
                                  │
AGENT        Claude Agent SDK loop ──┬── Kapruka MCP (7 tools, via MCP Shield cache/queue)
CORE                                 └── Custom tools (memory, calendar, FX-explain,
                                          gift-poet, image→search, festival, etiquette,
                                          delivery-watch, reminder, split-gift)
                                  │
STATE        recipients · occasions · gift history · budgets · taste graph · currency prefs
             (MongoDB on Railway)
```

### 4.1 Concrete frontend/backend architecture (locked 10 Jun — deploying on Railway)

**Shape: a single containerized Next.js monolith on Railway** — frontend, agent backend and workers in one long-running Node process. Railway (not serverless) is what makes the Claude Agent SDK viable: persistent process, WebSockets, no execution time limits, in-memory state that survives between requests. One service + one MongoDB = fewest moving parts a solo builder can keep up 24/7 while judges test daily.

```
┌────────────────────────────── BROWSER (the judges) ──────────────────────────────┐
│  Next.js React app (App Router, Tailwind + shadcn/ui, PWA)                       │
│  • Full-screen chat canvas — streams over SSE                                    │
│  • Generative UI renderer: stream events → {token | tool_status | ui_block}      │
│    ui_block types: product_card · carousel · compare_grid · cart_drawer ·        │
│                    order_timeline · delivery_calendar · hamper_card · chips      │
│  • Cart drawer (client state, synced to server session)                          │
│  • Voice widget: browser ⇄ ElevenLabs Agents WebSocket (signed URL from backend) │
│    + live captions & waveform; lang/currency switcher                            │
└───────────────┬──────────────────────────────────────────────┬──────────────────┘
                │ POST /api/chat (SSE stream)                  │ wss:// (audio)
                ▼                                              ▼
┌────────────── RAILWAY: one Node container ─────────┐   ┌─ ElevenLabs Agents ────┐
│  Next.js route handlers (API layer)                │   │  STT · turn-taking ·   │
│   /api/chat ── per-session AGENT CORE              │◀──│  barge-in · TTS        │
│   /api/voice/signed-url   /api/track   /api/cart   │   │  (custom-LLM webhook → │
│                                                    │   │   our /api/chat core)  │
│  AGENT CORE — Claude Agent SDK session             │   └────────────────────────┘
│   • cached cultural system prompt (persona §11)    │   ┌─ Azure Speech ─────────┐
│   • MCP client → Kapruka MCP (params-wrapped)      │   │  si-LK-ThiliniNeural   │
│   • custom in-process tools (§7)                   │   │  (Sinhala-script TTS)  │
│                                                    │   └────────────────────────┘
│  MCP SHIELD (in-process, no Redis needed)          │
│   • LRU cache: categories 30m · search 10m ·       │──▶ https://mcp.kapruka.com/mcp
│     product 15m · cities 24h                       │    (60 req/min/IP — shared!)
│   • request coalescing (dedupe identical in-flight)│
│   • token-bucket queue ≤ ~50 rpm (headroom)        │
│                                                    │
│  WORKERS (node-cron in same process)               │──▶ Twilio WhatsApp webhook
│   • occasion reminders · delivery-proof watch ·    │◀── /api/whatsapp (same core)
│     price snapshots (N4/N5)                        │
└───────────────┬────────────────────────────────────┘
                ▼
        MongoDB (Railway template, same project; or Atlas free tier)
        users (embedded: recipients, occasions, prefs) · sessions/carts ·
        gift_history · price_snapshots · reminders · taste_signals
```

**Key flows:**

1. **Chat turn:** browser `POST /api/chat` → agent core streams SSE events back: text tokens interleaved with typed `ui_block` JSON. The frontend never parses prose for data — every card/carousel/cart update is a structured block the model's tool layer emits. This is what makes "generative UI" (P12) reliable.
2. **Checkout:** cart lives server-side per session → `create_order` only after an explicit in-UI confirm card → pay-link rendered as a button → `track_order` timeline component.
3. **Voice turn:** browser gets a signed URL → talks directly to ElevenLabs Agents (audio never transits our server) → ElevenLabs calls our agent core as its "custom LLM" webhook → same brain, same tools, same cart. Sinhala-script replies side-route to Azure TTS.
4. **WhatsApp turn:** Twilio webhook → `/api/whatsapp` → same agent core, responses rendered as text + image messages instead of ui_blocks.

**Why monolith, not microservices:** one deploy, one log stream, one thing to keep alive while judges test daily; the in-process LRU + coalescing in the MCP Shield works *because* there's exactly one process owning the egress IP's 60 rpm budget. Split services only if WhatsApp traffic ever needs isolation.

---

## 5. Tech stack (concrete)

| Concern | Choice |
|---|---|
| Language | TypeScript |
| App framework | Next.js (App Router) — UI + server route handlers for the agent loop |
| Agent brain | `@anthropic-ai/claude-agent-sdk` (Claude Agent SDK) — native MCP client, sessions, hooks, prompt caching; raw `@anthropic-ai/sdk` Messages loop as escape hatch |
| Tool surface | Kapruka MCP server (MCP client) + custom in-process tools |
| Frontend | React + Tailwind + shadcn/ui; streaming chat with rich product cards |
| State / DB | **MongoDB** (Railway one-click template in the same project — or MongoDB Atlas free tier if managed backups/UI wanted) via **Mongoose** |
| WhatsApp channel | Twilio or WasenderAPI adapter over the shared agent core |
| Voice (Phase 4, good-to-have — see §2.1) | STT: OpenAI Whisper (Sinhala ✅). TTS: ElevenLabs Flash v2.5 / Agents (EN + Tamil, ~75ms; **no Sinhala**) + Azure `si-LK-ThiliniNeural` for Sinhala |
| Deploy | **Railway — single containerized Next.js monolith** (long-running Node: required for Claude Agent SDK + WebSockets) + Railway Postgres; workers via node-cron in-process |
| Observability | Structured logs, per-turn tool traces, cost/latency metrics |

---

## 6. Kapruka MCP tool reference (the foundation)

All 7 tools verified live on 8 Jun 2026 (`kapruka_mcp v1.27.0`, Streamable HTTP, **no auth**). Each supports `response_format: 'markdown' | 'json'` and currency `LKR/USD/GBP/AUD/CAD/EUR`.

> **🔑 Critical calling convention (verified):** every tool nests its arguments under a single `params` object. The MCP call shape is:
> ```json
> {"name": "kapruka_search_products", "arguments": {"params": {"q": "birthday cake", "limit": 10, "response_format": "json"}}}
> ```
> Forgetting the `params` wrapper is the #1 integration footgun.
>
> **Rate limits (verified in `RateLimit-*` response headers):** **60 requests/min/IP across all tools**, and **30 `kapruka_create_order`/hr/IP**. Reads are server-cached up to 30 min; writes are never cached.

| Tool | Purpose | Key inputs (inside `params`) | Notes / gotchas (verified) |
|---|---|---|---|
| `kapruka_list_categories` | Top-level category tree + browse URLs | `depth` (1–2, default 1), `response_format` | **64 categories** live, mostly everyday retail (`Electronic, Grocery, Pharmacy, Fashion, Vegetables…`) + gifting/festival (`cakes, flowers, pirikara, sympathies, christmas, thaipongle…`). Names double as the `category` filter. No IDs/counts exposed. Cached 30 min. |
| `kapruka_search_products` | Keyword search + filters + pagination | `q` (3–200 chars, no stopword-only), `category`, `limit` (1–50, default 10), `cursor`, `currency`, `min_price`, `max_price`, `in_stock_only`, `sort` (`relevance\|price_asc\|price_desc\|newest\|bestseller`), `include_stubs` | **Pagination capped at 3 pages** — `next_cursor` goes `null` after page 3 even if more exist; refine query / use `category` instead of enumerating. `CATSYM*` price-0 landing-page stubs hidden unless `include_stubs=true`. |
| `kapruka_get_product` | Full product detail | `product_id` (3–80), `currency`, `type` (optional hint), `response_format` | Returns `name, description, summary, price, compare_at_price, in_stock, stock_level (low\|medium\|high), category, variants[], images[], attributes{type,subtype,weight,vendor}, shipping{ships_from, ships_internationally, restricted_countries}, rating(null), url`. Flags `CATSYM*` as non-purchasable. `images[]` is full-res — **feed it straight into visual cards (20-pt criterion).** |
| `kapruka_list_delivery_cities` | Find/validate deliverable cities | `query` (partial match), `limit` (1–50, default 25), `response_format` | Returns `{cities:[{name, aliases[]}], total_matched, showing}`. **Always pass a `query`** (no query = first 25 alphabetically). Aliases cover vernacular spellings (e.g. Colombo 03 ← `kolpity colpity colombo3`; Colombo 04 ← `bambala`). Use `name` as the canonical `city` downstream. |
| `kapruka_check_delivery` | Feasibility + flat rate for city/date | `city` (canonical), `delivery_date` (YYYY-MM-DD, optional — defaults to today LK time), `product_id` (optional, enables perishable warning), `response_format` | Returns `{city, now (ISO, **Sri Lanka time +05:30**), checked_date, available, rate, currency:"LKR", reason, next_available_date, perishable_warning}`. **Docs confirm: "single shipment per order at one flat rate regardless of item count"** → the bundle optimizer is legitimate. Real rate Kandy = **LKR 1,075** (not a fixed 300; it varies by city). Perishable warning fires for `CAKE*/FLOWER*/COMBO*` when >1 day out. |
| `kapruka_create_order` | Guest checkout → pay link | `cart[]` 1–30 of `{product_id, quantity (1–99, default 1), icing_text (≤120, silently ignored for non-cake)}`; `recipient{name, phone}`; `delivery{address (3–250), city, location_type (house\|apartment\|office\|other, default house), date, instructions}`; `sender{name, anonymous}`; `gift_message` (≤300); `currency`; `response_format`. **Required: cart, recipient, delivery, sender.** | **Only side-effecting tool — always human-confirm first.** Returns a pre-payment **`order_ref`** + click-to-pay URL; **prices locked 60 min**. 30 orders/hr/IP. |
| `kapruka_track_order` | Status + timeline + **proof flags** | `order_number` (e.g. `VIMP34456CB2`), `response_format` | Returns `{order_number, pnref, status (received\|confirmed\|shipped\|delivered\|cancelled), status_display, order_date, delivery_date, shipped_date, amount, payment_method, recipient{…}, greeting_message, special_instructions, progress[{step,timestamp}], live_tracking_available, has_delivery_video, has_delivery_photo, items[]}`. **`has_delivery_photo/video` confirmed in schema** — our proof loop is real. |

### Observed quirks & honest caveats (we handle these defensively — credibility points)

1. **Always pass the `params` wrapper** (see above) and the canonical `city` from `list_delivery_cities`, not the user's raw spelling.
2. **`check_delivery` "contradiction" — could NOT reproduce on 8 Jun.** Our earlier note claimed it returned *"not available"* with `next_available_date` = the same requested date; live testing returned a clean `available:true`. The `reason`/`next_available_date` fields exist for the unavailable case. **Treat availability honestly and re-confirm at order time, but don't assert the bug as fact.**
3. **Product IDs are wildly heterogeneous, not just case-variant.** Verified examples: `cake00ka002034`, `GROCERY002512`, `PHARMACY00294`, `EF_PC_ELEC0V4463POD00060FDP`, `PIRIKARA0191`. Lookups are case-insensitive; treat IDs as **opaque strings** and normalize before storing/deduping.
4. **`order_ref` ≠ `order_number` ≠ `pnref`.** `create_order` returns a pre-payment `order_ref`; after the customer pays in-browser, Kapruka **emails a separate `order_number`** — that's what `track_order` needs (`pnref` is an internal payment ref). There is **no in-band payment confirmation** in the MCP; explain the email handoff to the user.
5. **No `get_order`/cart/account tools** — cart and any memory are **app-side**; the MCP is stateless per call.

---

## 7. Custom tool surface (so it's clearly more than an MCP wrapper)

| Tool | Job |
|---|---|
| `remember_recipient` / `get_recipients` | Recipient address book (name, address, city, relationship, dietary, prefs) |
| `save_occasion` / `get_upcoming_occasions` | Per-user occasion calendar + reminder source |
| `record_gift_history` / `get_gift_history` | No-repeat intelligence (don't gift the same thing twice) |
| `schedule_reminder` | Proactive nudges ("Amma's birthday in 5 days") |
| `convert_currency_explain` | Transparent FX with timestamp + source on top of MCP currency |
| `compose_gift_message` | The Sinhala/Tamil/English gift-card "poet" (register-aware) |
| `image_to_search_terms` | Multimodal: decompose an uploaded image into search queries |
| `festival_calendar` | SL festival + auspicious-time (nekath) knowledge |
| `gifting_etiquette` | Relationship + religion-appropriate rules |
| `delivery_proof_watch` | Polls `track_order` for photo/video, notifies the sender |
| `split_gift_coordinate` | Shared-gift coordination over single-payer checkout (app-level) |

---

## 8. THE FULL FEATURE CATALOG

### 🛒 S. Everyday self-shopping (PRIMARY — the main user, per §0.4; build first)
| # | Feature | Built on |
|---|---|---|
| S1 | **"Shopping for myself" default** — recipient = sender; saved home address; no gifting friction unless asked | local + `create_order` |
| S2 | **Grocery / pantry run** — turn a list ("rice, dhal, tea, Panadol, soap") into one multi-item cart | `search_products` ×N → cart |
| S3 | **"My usual" reorder** — remembered baskets, one-tap restock, recurring weekly shop | app memory + `create_order` |
| S4 | **Electronics advisor** — needs/budget-based ("best phone under 60k"), spec Q&A | `search_products`, `get_product` |
| S5 | **Side-by-side comparison cards** — 2–4 products on price/spec/stock (big *Visual richness* + *Usefulness* win) | `get_product` ×N |
| S6 | **Pharmacy & Ayurvedic wellness** — OTC + remedies, with a clear "not medical advice" disclaimer | `search_products` (`Pharmacy`, `Ayurvedic`) |
| S7 | **Fashion & beauty** — clothing/cosmetics/perfume/jewellery browse with image-rich cards + variant (size/colour) pick | `search_products`, `get_product.variants` |
| S8 | **Same-day / fast mode** — "what can reach me today?" using LK-time default + the `samedaydelivery` category | `check_delivery`, `samedaydelivery` |
| S9 | **Budget basket builder** — "fill a LKR 10,000 grocery cart," optimise within budget | `search_products` + `min/max_price` |
| S10 | **Discovery rails** — bestsellers / new arrivals / promotions as visual carousels | `bestsellers`, `newadditions`, `promotions` |
| S11 | **Baby & pet essentials** replenishment (recurring needs) | `search_products` (`BabyItems`, `Pet`) |
| S12 | **Long-tail self-shop** — Books, Sports, Household, Toys, Automobile, Bicycle | `list_categories` + `search_products` |
| S13 | **Age-gating** for `Liquor` / `Adult Products` — explicit age confirm before showing/ordering (maturity signal) | app guard |
| S14 | **Stock + price-lock urgency for self-buys** — honest "low stock, price held 60 min" | `get_product.stock_level` |

### A. Core commerce (table stakes — must be flawless)
| # | Feature | Built on |
|---|---|---|
| A1 | Natural-language product search (multilingual) | `search_products` |
| A2 | Category browse + deep-link to kapruka.com | `list_categories` |
| A3 | Product detail Q&A (price, stock, variants, shipping) | `get_product` |
| A4 | Multi-item cart building (up to 30 items) | local + `create_order` |
| A5 | Delivery feasibility (city + date + rate) | `check_delivery` |
| A6 | City resolver w/ alias + Tanglish/romanized spelling tolerance | `list_delivery_cities` |
| A7 | Guest-checkout pay-link generation w/ price breakdown | `create_order` |
| A8 | Order tracking + timeline | `track_order` |
| A9 | Live multi-currency (LKR/USD/GBP/AUD/CAD/EUR) | all tools |

### B. Language & localization (the authenticity layer)
| # | Feature |
|---|---|
| B1 | **Auto language detection** — Sinhala script, Tamil script, English, romanized **"Tanglish"** (Sinhala/Tamil in Latin) |
| B2 | **Code-switching** — understands `"machan ammata mother's day ekata gift ekak ona"` natively |
| B3 | **Tanglish/romanized transliteration** — `"upandineta cake ekak"` → "a birthday cake" |
| B4 | Respond in the user's language *and register* (formal Sinhala for elders, casual for friends) |
| B5 | Translate product names/descriptions into Sinhala/Tamil on request |
| B6 | Sinhala date/number understanding (`"Avurudu welawata"`, `"dahas pahak"` = 5000) |
| B7 | Sinhala/Tamil **voice in & out** (accessibility for parents/grandparents) |

### C. Cultural intelligence (no competitor will go here)
| # | Feature |
|---|---|
| C1 | **Festival calendar engine** — Sinhala/Tamil New Year, Vesak, Poson, Esala, Deepavali, Thai Pongal, Christmas, Eid, Valentine's, Mother's/Father's Day |
| C2 | **Festival hamper auto-composer** — "Avurudu table" (kavum, kokis, kiribath fixings, sweetmeats) within budget, one delivery |
| C3 | **Almsgiving / Dāna & Pirikara concierge** — arrange pirikara to a temple or *mataka dāna* for a deceased relative (the MCP has a `pirikara` category) |
| C4 | **Gifting etiquette engine** — relationship + religion aware (no liquor to elders/monks, veg-appropriate, condolence vs celebration tone) |
| C5 | **Auspicious-time (nekath)** awareness for New Year gifting |
| C6 | **Sympathy / condolence mode** — tone-shifted flow + appropriate gifts (`sympathies` category) |

### D. Diaspora bridge (the emotional core)
| # | Feature |
|---|---|
| D1 | **Timezone-aware** ("it's 2am in Colombo — I'll schedule the message for morning") |
| D2 | **"Send to Amma"** recipient address book — names, addresses, relationships |
| D3 | **Delivery photo/video proof loop** — surfaces `has_delivery_photo/video` so you *see* it arrive |
| D4 | **Anonymous surprise mode** + heartfelt gift card (`sender.anonymous`) |
| D5 | **Recurring gifts** — "every Avurudu / every birthday, automatically" |
| D6 | **"Handle it all" delegated mode** — one sentence → agent picks, checks delivery, builds, pays-link |
| D7 | **Split-the-gift** — siblings abroad pool for one gift to parents (app-level coordination over single-payer checkout) |

### E. Proactive & agentic intelligence
| # | Feature |
|---|---|
| E1 | **Occasion reminders** — "Amma's birthday in 5 days — repeat last year's cake, or something new?" |
| E2 | **No-repeat memory** — won't suggest the same gift two years running |
| E3 | **Flat-rate bundle optimizer** — exploits *one-flat-rate-per-order, regardless of item count* (verified in `check_delivery` docs): "add flowers — delivery stays the same flat fee" |
| E4 | **Budget optimizer** — best combo under "6000 incl. delivery" |
| E5 | **Perishable safety guard** — blocks scheduling a cake 5 days out without a freshness warning |
| E6 | **Delivery pre-check** — validates city/date *before* building the cart |
| E7 | **Stock + price-lock urgency** — honest urgency from `stock_level` + the 60-min lock |

### F. Trust & safety (signals engineering maturity to judges)
| # | Feature |
|---|---|
| F1 | **Confirm-before-order** — `create_order` is the only side-effecting tool; always human-gated |
| F2 | **Full price transparency** — items + flat delivery + add-ons, every time |
| F3 | **Defensive delivery handling** — surface the `check_delivery` contradiction honestly, re-confirm at order time |
| F4 | **ID normalization** — handle `CAKE00KA…` vs `cake00KA…` casing across tools |
| F5 | **Idempotency + rate-limit awareness** (30 orders/hr, 30-min cache, no duplicate orders) |
| F6 | **"Why this?"** — every recommendation explains itself |

### G. Multimodal
| # | Feature |
|---|---|
| G1 | **Image → search** — "find me something like this" from a photo |
| G2 | **"Set the table from a photo"** — decompose a celebration image into purchasable Kapruka items |
| G3 | Gift-card / preview image generation |
| G4 | Voice-first mode for elders (Sinhala) |

### H. Memory & personalization
| # | Feature |
|---|---|
| H1 | Recipient profiles (relationship, dietary, preferences, past gifts) |
| H2 | Per-user occasion calendar |
| H3 | Budget defaults & currency preference |
| H4 | Taste graph that learns from accepted/rejected picks |

### 🆕 N. New customer-value features (added 10 Jun — gaps the spec missed)

| # | Feature | Why customers care / built on |
|---|---|---|
| N1 | **Recipe-to-cart** — "kottu for 4" / "Avurudu kiribath breakfast" → full ingredient cart in one tap | The single most magical everyday-grocery moment; pure `search_products` ×N + model knowledge of SL cooking. Huge *Usefulness* + *Creativity* |
| N2 | **Snap-a-list** — photo of a handwritten grocery list (Sinhala or English) → cart | How SL households actually shop; multimodal vision → `search_products`. Extends G1, very demo-able |
| N3 | **Wish Bridge (reverse gifting)** — Amma browses & builds a basket in Sinhala on a shared link; daughter abroad gets pinged and **pays in AUD** | Flips the diaspora flow: recipient chooses, sender pays. Nobody else will have this; app-side cart share + `create_order` |
| N4 | **Price-drop watch & deal alerts** — "watch this phone" → notify when `compare_at_price`/promos move | App-side price snapshots over time (MCP has no history); drives daily return visits |
| N5 | **Honest-discount meter** — track prices over days; "this 'sale' is real (was 52,990 last week)" | Trust signal no other entrant will have; same price-snapshot store as N4 |
| N6 | **Spending insights** — "you spent LKR 24,500 on groceries this month" + monthly essentials nudge | App-side order history roll-up; pairs with S3 "my usual" |
| N7 | **Diet-aware grocery mode** — "diabetic-friendly basket", veg/halal filters, allergy memory | Model knowledge + attributes; extends H1 dietary prefs to *self*-shopping |
| N8 | **Cheapest-day delivery optimizer** — probe `check_delivery` across the next 7 dates, show a mini rate/availability calendar | Rates vary by city/date; turns a dull form into a visual picker (*Visual* + *Usefulness*) |
| N9 | **Festival countdown storefronts** — "🪔 12 days to Deepavali" banner → curated rail | Festival calendar + category rails; seasonal urgency |
| N10 | **PWA install + mobile-first** — add-to-home-screen, offline cart, instant loads | Judges will test on phones; cheap *Experience* points |
| N11 | **First-run "try me" demo chips** — landing state with one-tap scripted scenarios ("📱 Phone under 60k", "🛒 Weekly grocery run", "🎂 Cake to Amma in Kandy") | **Judges test daily, cold** — never let them face a blank input box. Possibly the highest-ROI feature in this list |
| N12 | **Identity without friction** — anonymous session by default; optional WhatsApp-number magic link to sync memory across devices/channels | The whole §H memory layer silently assumed a login story; this is it |
| N13 | **Server-side MCP shield** — shared cache (categories/searches/product detail) + request coalescing + queue | ⚠️ Engineering must-have, not a feature: the 60 req/min limit is **per IP**, and *all* our users share the server's egress IP. Without this, two concurrent judges = rate-limit errors = dead *Experience* score |

### P. Experience, polish & visual richness (⭐ 50% of the score — Experience 30 + Visual 20)
| # | Feature |
|---|---|
| P1 | **Full-screen, app-like UI** — not a chat bubble in a corner; immersive, mobile-first, fast |
| P2 | **Rich product cards** — image, name, price (in chosen currency), stock badge, rating, "view"/"add" actions |
| P3 | **Carousels & galleries** — horizontal product rails; multi-image product galleries from `images[]` |
| P4 | **Comparison view** — side-by-side spec/price table for electronics & alternatives |
| P5 | **Live cart drawer** — running total, per-item qty steppers, flat-delivery line, edit/remove |
| P6 | **Visual order timeline** — `progress[]` rendered as a stepper; delivery-photo/video thumb when available |
| P7 | **Streaming + micro-interactions** — token streaming, skeleton loaders, optimistic UI, subtle motion |
| P8 | **Polished empty / error / offline states** — never a raw error; graceful retries (judges test daily → uptime is graded) |
| P9 | **Personality in the copy** — warm, witty, local ("Aiyo! 💔", "machan", emoji) tuned to register; the 15-pt *Personality* lever |
| P10 | **Quick-reply chips & smart suggestions** — tappable next steps reduce typing, speed the happy path |
| P11 | **Currency & language switcher** — visible, instant, persistent |
| P12 | **Generative/contextual UI** — render the *right* component per intent (compare grid vs single hero vs hamper) |

---

## 9. The 6 headline innovations (the demo reel)

> These are the **differentiators** layered on top of the polished everyday-shopping core (§S) and UI craft (§P) that actually carry most of the rubric. They win Creativity, Personality and the Sinhala bonus — show them *after* the core lands.

1. **Trilingual code-switching incl. Tanglish** — sounds like a real Sri Lankan, not Google Translate.
2. **Diaspora "be there from afar"** — timezone + currency + delivery-photo proof + scheduled message.
3. **Dāna / Pirikara almsgiving concierge** — nobody else will build this; profoundly Sri Lankan and emotionally huge for diaspora who miss funerals.
4. **Cultural gift concierge** — festival + relationship + religion aware, with an Avurudu-hamper auto-composer.
5. **Proactive occasion memory + no-repeat** — turns one purchase into a lifelong relationship.
6. **Flat-rate bundle economics + honest data handling** — shows you understood the API better than the API understands itself.

---

## 10. Sinhala / Tamil / multilingual deep-dive

Sri Lanka is trilingual, and people **code-switch constantly** — including romanized Sinhala/Tamil ("Tanglish", the brief's term; also called "Singlish" for Sinhala) over chat.

**Inputs the agent must handle natively:**

| Form | Example | Meaning |
|---|---|---|
| Sinhala script | `අම්මාට උපන්දිනේට කේක් එකක් එවන්න ඕන` | "Need to send a birthday cake for Amma" |
| Tanglish (romanized) | `ammata bday ekata cake ekak Kandy yawanna puluwanda?` | "Can you send a birthday cake to Amma in Kandy?" |
| Code-switch | `machan ammata mother's day ekata gift ekak ona, 6000ට යටින්` | "Bro, need a Mother's Day gift for mum, under 6000" |
| Tamil | `அம்மாவுக்கு பிறந்தநாளுக்கு கேக் அனுப்ப வேண்டும்` | "Need to send a birthday cake for mum" |

**Design rules:**

- **Detect** by script range first, fall back to the model for romanized/code-switched text.
- **Mirror** the user's language *and register* — formal Sinhala for elders, warm for a parent, casual for a friend.
- **Translate on demand** — product names/descriptions into Sinhala/Tamil when asked.
- **Numbers & dates** — understand `dahas pahak` (5,000), `Avurudu welawata` (around New Year), relative dates.
- **Voice (Phase 4)** — Sinhala STT is strong; TTS quality is the known weak link (we say so honestly).

---

## 11. System prompt / persona design

The cultural brain lives in a cached system prompt. Core elements:

- **Identity:** warm, trustworthy Sri Lankan gifting concierge; speaks the user's language and register.
- **Mission:** help someone (often abroad) send the *right* gift home, and make them feel present.
- **Tooling discipline:** prefer `check_delivery` before building a cart; always show a full price breakdown; confirm before `create_order`.
- **Safety rules:** perishable guard; religion/relationship etiquette; never fabricate delivery dates; flag data quirks.
- **Cultural knowledge:** festival calendar, gifting customs, almsgiving conventions, auspicious timing.
- **Tone registers:** elder-formal / parent-warm / friend-casual / condolence-gentle.

---

## 12. Trust, safety & honest constraints

| Constraint | Mitigation |
|---|---|
| No in-band payment confirmation | Explain `order_ref` (pre-pay) vs `order_number` (post-pay, emailed); guide the handoff |
| `check_delivery` data flaky | Defensive presentation; re-confirm at order time |
| Pagination capped at 3 pages | Refine queries / filter by category instead of enumerating |
| Rate limits (30 orders/hr, 30-min cache) | Idempotency keys; cache-aware UX; never double-submit |
| Sinhala TTS limited | Text/STT strong; set expectations on voice output quality |
| Single-payer checkout | Split-gift is an app-level coordination layer, clearly labelled |

---

## 13. Judge scoring map — against the OFFICIAL rubric (§0.2)

| Criterion (points) | Features that score it |
|---|---|
| **Experience & polish (30)** | §P (full-screen UI, streaming, polished empty/error states, speed, **reliable uptime** — tested daily), quick-reply chips (P10), cart drawer (P5) |
| **Visual richness (20)** | §P2–P6 (rich cards, carousels, `images[]` galleries, comparison view, visual order timeline + delivery photo/video), discovery rails (S10) |
| **Personality (15)** | P9 warm/witty/local copy, tone registers (B4), Sinhala/Tanglish voice (B7), "Aiyo!" energy |
| **Usefulness (15)** | §S everyday self-shopping (grocery S2, electronics advisor S4, pharmacy S6, budget basket S9), comparison (S5), "why this" (F6), reorder (S3) |
| **End-to-end completeness (15)** | A1→A8 full loop: discovery → **multi-item cart** → `check_delivery` → `create_order` pay-link → `track_order`; honest `order_ref`→`order_number` handoff (F-series) |
| **Creativity (5)** | Dāna/pirikara concierge (C3), diaspora bridge (§D), gift-poet (compose_gift_message), festival hampers (C2), emotional twin (§16.3) |
| **Bonuses** | Multi-item carts (A4), delivery-date handling (A5/E6), gift messaging (compose_gift_message), **Tanglish** (B1–B3), **Sinhala** (B-series) — "almost no one will attempt it" |

> **Effort allocation follows the points:** the bulk of build time goes to §S (everyday core) + §P (polish & visual) + a flawless end-to-end loop. The cultural/gifting depth (§C/§D/§16) is concentrated, high-impact spice — it wins Creativity (5) and the Sinhala bonus and makes the demo unforgettable, but it is *not* where most of the 100 points are.

---

## 14. The demo that wins — lead everyday, reveal the magic

Per §0.7, **open with self-shopping** (proves the core the rubric rewards), then *reveal* the gifting/Sinhala wow as the emotional finale.

### Demo A — Everyday self-shop (lead; ~45s, hits Experience/Visual/Usefulness/Completeness)

> **User (Tanglish):** `machan mata aluth phone ekak ona, 60000ට යටින්, ada Nugegoda delivery ගන්න පුළුවන්ද?`
> *(bro I need a new phone, under 60,000, can I get it delivered to Nugegoda today?)*
>
> **Agent (Sinhala + English, full-screen, very visual):**
> 1. Searches phones ≤ LKR 60k (`search_products` + `max_price`, `sort=price_asc`) → renders **3 comparison cards** (e.g. Samsung Galaxy A07 @ 46,490) — *Visual richness*.
> 2. Answers a spec question from `get_product` (RAM/storage/battery) — *Usefulness*.
> 3. Resolves **Nugegoda** + checks **same-day** feasibility (`list_delivery_cities` → `check_delivery`, LK-time today) → shows the flat delivery line.
> 4. Builds the **cart drawer** with running total in LKR — *Experience & polish*.
> 5. Confirms → returns the **pay link** (`create_order`), then a **visual order timeline** (`track_order`).

### Demo B — The gifting wow (reveal; ~45s, hits Personality/Creativity + Sinhala bonus)

> **User (Tanglish):** `machan amma ge bday ekata Kandy walata cake ekak yawanna ona, 6000ට යටින්, surprise ekak`
>
> **Agent (warm Sinhala + English):**
> 1. Detects **Kandy** is deliverable (`check_delivery`).
> 2. Picks a top birthday cake (`search_products` → `get_product`).
> 3. **Flags perishable timing** (freshness guard).
> 4. **Suggests adding flowers** — because delivery is *one flat rate per order regardless of item count* (verified), the cake+flowers ship for the **same** flat fee (e.g. ~LKR 1,075 to Kandy), not double.
> 5. Shows the total in **AUD** (diaspora currency).
> 6. **Writes a warm Sinhala gift-card message** (`compose_gift_message`).
> 7. Confirms anonymously (`sender.anonymous`), returns the **pay link** (`create_order`).
> 8. Offers **delivery-photo proof** (`has_delivery_photo`) + **"shall I remind you next Avurudu too?"**

Two flows: a rock-solid everyday core *and* a culturally-magical gifting finale — covering every line of the rubric.

---

## 15. Build roadmap (phased)

> Locked decisions baked in: **TypeScript + Next.js**, **Claude brain + Kapruka MCP**, **Web + WhatsApp in parallel** over a shared agent core.

### Phase 1 — Demo-winning core (everyday-first; this is where the points are)
- Next.js app + shared agent core (Claude Messages loop + Kapruka MCP client, **`params`-wrapped calls**).
- **Full-screen, very visual** web chat: rich product cards, carousels, `images[]` galleries, comparison view, cart drawer, visual order timeline (§P).
- **Everyday self-shopping flows** (§S): grocery run, electronics advisor + comparison, pharmacy, budget basket, same-day mode, discovery rails.
- Sinhala / Tanglish detection + response, with personality in the copy.
- Full loop: discovery → multi-item cart → `check_delivery` pre-check → `create_order` pay-link → `track_order`.
- Perishable guard, flat-rate bundle optimizer, "why this", full price breakdown.
- **Reliability/uptime hardening + polished empty/error states** (judges test daily).

### Phase 2 — Relationship layer
- Recipient/occasion memory + reminders + no-repeat.
- Festival calendar engine + Avurudu hamper composer.
- Dāna / pirikara flow.

### Phase 3 — Voice, channels & proof (voice is committed — see §2.1)
- **Voice input**: mic / push-to-talk → Whisper or Scribe STT (Sinhala + Tanglish) → normal agent loop.
- **Spoken Kapu**: ElevenLabs Flash v2.5 streaming TTS (one consistent Kapu voice for EN/Tanglish/Tamil) + Azure `si-LK-ThiliniNeural` routing for Sinhala-script replies; live captions + waveform UI.
- **Interactive voice mode**: ElevenLabs Agents (barge-in, turn-taking) wired to the same agent core.
- WhatsApp channel adapter (Twilio / WasenderAPI).
- Delivery photo/video proof loop.
- Image → search (multimodal) + Snap-a-list (N2).

### Phase 4 — Advanced
- Split-gift coordination.
- Taste graph personalization.
- Recipe-to-cart depth (N1), price-drop watch (N4), Wish Bridge (N3).

### Horizon 2+ — frontier vision
- See **§16 Frontier features** for the futuristic roadmap: agentic commerce, the recipient "emotional twin", Sinhala voice-note commerce, generative gifting, and group split-pay.

---

## 16. Frontier features — the futuristic horizon

Beyond the four build phases, these push the agent to the genuine 2026 frontier. Several are demo-ready; others are deliberately kept as **vision** so we signal ambition without over-promising to judges.

**Feasibility legend:** 🟢 demo-ready · 🟡 ambitious but doable · 🔴 research-grade / ethics-gated

### 16.1 Agentic commerce (the real 2026 frontier)

Aligned with the emerging agent-commerce standards (OpenAI's Agentic Commerce Protocol, Google's AP2 — Agent Payments Protocol). This is where the field is heading; judges who follow AI will recognise it instantly.

| Feature | What it is | Feasibility |
|---|---|---|
| **Delegated autonomous gifting** | Grant the agent a budget + policy ("≤ LKR 8k per occasion, never liquor to Amma"); it executes whole occasions on its own, pinging only for final approval | 🟡 |
| **Standing gifting policies** | "Flowers to Amma every month-end; a cake every birthday; pirikara every poya while I'm away" — the agent runs the calendar autonomously | 🟡 |
| **Agent-to-agent (A2A) checkout** | Your agent transacts with Kapruka's agent under AP2-style payment mandates | 🔴 |
| **Computer-use checkout fallback** | The MCP only returns a *pay link*; a browser-use sub-agent finishes payment under strict spend limits — closing the one gap in the MCP | 🟡 |

### 16.2 Predictive & anticipatory

| Feature | What it is | Feasibility |
|---|---|---|
| **Life-event & occasion radar** | Predicts *who* you'll need to gift and *when*, before you ask (calendar, contacts, chat history) | 🟡 |
| **Relationship-health nudges** | "You haven't sent your mother anything in 8 months" — gentle, opt-in | 🟢 |
| **Pre-festival lock-ahead** | "This cake sells out before every Avurudu — lock today's price now" (uses stock level + 60-min price lock) | 🟢 |
| **Buy-now / deliver-later + FX hedge** | "AUD is strong this week — pay now, deliver on her birthday, price locked" | 🟡 |

### 16.3 The emotional layer (the deepest moat)

| Feature | What it is | Feasibility |
|---|---|---|
| **"Emotional twin" of each recipient** | A learned taste model so you can ask *"what would Amma actually like?"* and get a real answer | 🟡 |
| **Generative Sinhala card art + poetry** | AI-made greeting-card image *with* a register-perfect Sinhala/Tamil verse, attached to the order | 🟢 |
| **Personalized voice/video gift message** | A short AI-assisted video or voice note delivered with the gift | 🔴 (voice-cloning = consent/ethics gate; keep assisted, not cloned) |
| **Grief companion mode** | For *mataka dāna* — a gentle, patient flow for diaspora who can't attend a parent's funeral almsgiving | 🟢 |
| **Reciprocity intelligence** | "Aunty Kumari sent your kids gifts at Avurudu — reciprocate before Christmas?" | 🟡 |

### 16.4 Collaborative & social

| Feature | What it is | Feasibility |
|---|---|---|
| **Live group-gifting split-pay** | Siblings worldwide pool into one gift via a shared link; agent coordinates contributions | 🟡 |
| **Family anti-duplicate coordination** | The family sees what others are already sending Amma — no three cakes on one birthday | 🟡 |
| **SL wedding/event registries** | Agent-managed gift registry for diaspora weddings | 🟡 |
| **Charity / dāna in someone's name** | Donate to a Sri Lankan cause *as* the gift — culturally profound | 🟢 |
| **Community taste wisdom** | Privacy-preserving "what others sent their mothers this Mother's Day" | 🔴 |

### 16.5 Spatial & generative experience

| Feature | What it is | Feasibility |
|---|---|---|
| **AI custom cake / arrangement designer** | Describe it → generate the design image → custom Kapruka order. The visual showstopper of the demo | 🟡 |
| **AR preview in the recipient's room** | See the flowers on Amma's table before buying | 🔴 |
| **Generative UI** | The agent renders bespoke cards / comparisons per context instead of fixed templates | 🟢 |
| **Virtual unwrapping** | A delightful unwrap experience link for the recipient | 🟡 |

### 16.6 Voice-first & ambient (most Sri-Lanka-authentic)

| Feature | Why it matters | Feasibility |
|---|---|---|
| **Sinhala WhatsApp voice-note commerce** | Sri Lankans live on WhatsApp voice notes — "send Amma a cake," spoken not typed | 🟢 |
| **Ambient agent** | Lives in WhatsApp, learns passively, surfaces help proactively | 🟡 |
| **Siri / Assistant shortcut** | "Hey Siri, send Amma flowers" | 🟡 |
| **Recipient-side interaction** | Amma replies in Sinhala to confirm or choose a delivery time | 🟡 |

### 16.7 Reliability & logistics intelligence

| Feature | What it is | Feasibility |
|---|---|---|
| **Auto-substitution on stockout** | Constraint-bounded ("swap to nearest cake ≤ budget; never change flavour family without asking") | 🟢 |
| **Multi-recipient orchestration** | "Send to all 5 cousins for Avurudu" in one pass | 🟢 |
| **Weather / monsoon-aware timing** | Adjust delivery date around forecast disruption | 🟡 |
| **Live tracking + proactive ETA pings** | Real-time status to the sender abroad | 🟡 |

### 16.8 Trust, safety & provenance

| Feature | What it is | Feasibility |
|---|---|---|
| **Verified delivery** | Recipient OTP / photo confirm before "delivered" | 🟢 |
| **Diaspora scam / fraud detection** | Flags suspicious requests and unusual patterns | 🟡 |
| **Explainability "receipt"** | Every autonomous action logged with *why* | 🟢 |
| **Privacy-preserving recipient vault** | Encrypted address book; PII never leaves where it must | 🟢 |

### 16.9 The on-device meta-angle 🎁

| Feature | Why it's clever |
|---|---|
| **On-device privacy layer** | Run the sensitive memory / PII reasoning locally via a small model; cloud only for heavy lifting. Pitch: *"the privacy-critical brain runs entirely on-device — on the very M4 Mac mini you're giving away."* A narrative the judges will remember. |

### 16.10 The five that win — and the combined demo

If we build only five frontier features, build these:

1. **Delegated autonomous gifting + standing policies** (§16.1) — proves real agency, not chat.
2. **"Emotional twin" — "what would Amma like?"** (§16.3) — nobody else will have it.
3. **Sinhala WhatsApp voice-note commerce** (§16.6) — most authentically Sri Lankan, most accessible.
4. **AI custom cake designer → order** (§16.5) — the visual showstopper.
5. **Live group-gifting split-pay** (§16.4) — solves a real, unsolved diaspora pain.

**They stack into one killer demo:** *speak* a request in Sinhala on WhatsApp → agent consults the emotional twin → designs a custom cake → coordinates a sibling split-pay → executes autonomously under your budget policy → delivers photo proof.

### 16.11 Ethics & scope guardrails

- **Voice / video cloning, social-media enrichment, AR, and community taste wisdom** are kept as **vision slides**, not shipped features — they carry consent, privacy, or maturity risks. Showing them as roadmap signals ambition without over-promising.
- Anything autonomous (§16.1) ships **only** with explicit spend limits, an approval gate, and a full explainability receipt (§16.8).

---

## 17. Data model (initial — MongoDB collections, via Mongoose)

```js
users {                                   // one doc per user — prefs + people embedded
  _id, channel_ids: { web_session, whatsapp_number },
  prefs: { default_currency, language, timezone },
  recipients: [{ _id, name, relationship, phone, address, city,
                 dietary, preferences[], religion, notes }],
  occasions:  [{ _id, recipient_id, type, date, recurrence, currency }]
}

sessions {                                // conversation + live cart state
  _id, user_id, channel, started_at,
  cart: [{ product_id, name, price, qty, icing_text }],
  context: { language, currency, register }
}

gift_history {                            // top-level: queried across users/time
  _id, user_id, recipient_id, occasion_id, product_id,
  product_name, ordered_at, order_ref, order_number, status
}

price_snapshots {                         // feeds N4 price-drop watch + N5 honest-discount
  _id, product_id, price, compare_at_price, currency, captured_at
}                                         // TTL/compound index on (product_id, captured_at)

reminders   { _id, user_id, occasion_id, fire_at, status }
taste_signals { _id, user_id, recipient_id, product_id, signal }  // accepted/rejected
```

> Embedding recipients/occasions in `users` keeps every personalization read to one document fetch per turn; `gift_history` and `price_snapshots` stay top-level because they're queried by product/time across users. Index `price_snapshots` on `(product_id, captured_at)` and `reminders` on `(fire_at, status)` for the cron worker.

---

## 18. Appendix — cultural data seeds

**Festival calendar (seed):** Sinhala & Tamil New Year (Apr), Vesak (May), Poson (Jun), Esala Perahera (Jul/Aug), Deepavali (Oct/Nov), Thai Pongal (Jan), Christmas (Dec), Eid (lunar), Valentine's (Feb), Mother's/Father's Day.

**Gifting etiquette (seed rules):**
- No alcohol to monks, elders by default, or religious occasions.
- Condolence/sympathy: muted tone, no celebratory items, white flowers appropriate.
- New baby: practical + sweet; avoid sharp objects (superstition).
- Boss/corporate: neutral, premium, non-personal.

**Almsgiving (dāna) conventions:** pirikara packs for temple offerings; *mataka dāna* (almsgiving in memory of the deceased) — sensitive register, often arranged by diaspora unable to attend.

---

*Prepared for the Kapruka Agent Challenge 2026. Verified against the live Kapruka MCP server (`kapruka_mcp v1.27.0`, all 7 tools called) and the official challenge page/rubric on 8 Jun 2026. Thesis rebalanced to **everyday-shopper-first** with gifting/diaspora as the flagship differentiator mode (see §0). Ready to scaffold Phase 1 on approval.*
