# Kapruka Agent Challenge 2026 — Winning Design & Feature Spec

> **"Maatha / මතක"** — the trilingual diaspora gifting concierge that lets you *be present from 10,000 km away.*

| | |
|---|---|
| **Competition** | Kapruka Agent Challenge 2026 — "Build Sri Lanka's most innovative AI shopping agent" |
| **Grand prize** | Apple M4 Mac mini |
| **Entries close** | 30 June 2026 |
| **Audience** | Sri Lankan developers |
| **Doc date** | 8 June 2026 |
| **Status** | Design locked — ready to scaffold Phase 1 |

---

## 1. Executive summary — the thesis that wins

Most entrants will build a chatbot that wraps the 7 Kapruka MCP tools in a chat loop. That is table stakes, not a winner.

The Kapruka MCP server quietly reveals what Kapruka actually *is*:

- It prices in **LKR, USD, GBP, AUD, CAD, EUR** — six currencies for a Sri Lankan store.
- Its order tracking exposes **delivery photo & video proof**.
- Its categories are full of **pirikara, dāna, Avurudu, Thai Pongal, Diwali, sympathies**.

That is not a generic store. **Kapruka's soul is the Sri Lankan diaspora sending gifts home** — a daughter in Melbourne sending her mother a birthday cake in Kandy, and never getting to see her face when it arrives.

So we don't build "a shopping agent." We build a **trilingual (Sinhala / Tamil / English + Singlish) diaspora gifting concierge with deep cultural intelligence** — festivals, almsgiving, gifting etiquette — and an **emotional payoff layer**: delivery proof, gift-message poetry, and occasion memory. That positioning is the differentiator.

---

## 2. Decision log (locked)

| Decision | Choice | Why |
|---|---|---|
| **AI provider / SDK** | **Claude (Anthropic Messages API) + manual agentic tool-use loop, Kapruka MCP connected.** OpenAI Realtime added later for voice. | Best-in-class Sinhala/Tamil + cultural register; native MCP; prompt caching keeps the big cultural system prompt cheap; raw loop gives full control over streaming + custom product cards. |
| **Stack / language** | **TypeScript + Next.js (App Router).** | Poster-style chat UI + server-side agent loop (API keys stay server-side) + easy deploy. Both SDKs and MCP are first-class in TS. |
| **Channels** | **Web chat + WhatsApp in parallel**, over a shared agent core. | Web mirrors the poster and demos cleanly; WhatsApp is THE Sri Lankan channel and the strongest "real product" signal. |

---

## 3. The opportunity — why diaspora-first wins

- **The market is real and underserved.** Hundreds of thousands of Sri Lankans abroad (AU, UK, CA, US, EU) regularly send gifts home — birthdays, Avurudu, funerals, new babies. Kapruka is the dominant player precisely because of this.
- **The pain is emotional, not transactional.** They can't be there. They worry the cake will be stale. They don't know if it arrived. They want it to feel personal, in *their* language, in the right cultural register.
- **The MCP gives us exactly the primitives to solve it:** multi-currency, delivery-feasibility, perishability awareness, and delivery photo/video proof.

An agent that *understands this human story* — and speaks Sinhala the way Sri Lankans actually text — beats a faster product-search bot every time.

---

## 4. Architecture (4 layers)

```
CHANNELS     Web chat (poster-style cards)  │  WhatsApp (THE SL channel)  │  Voice (Sinhala, Phase 4)
                                  │
i18n +       language detect (script + model) → code-switch handling →
PERSONA      response-language control → tone register (formal-elder / warm-mom / casual-friend)
                                  │
AGENT        Claude + agentic tool-use loop ──┬── Kapruka MCP (7 tools)
CORE                                          └── Custom tools (memory, calendar, FX-explain,
                                                   gift-poet, image→search, festival, etiquette,
                                                   delivery-watch, reminder, split-gift)
                                  │
STATE        recipients · occasions · gift history · budgets · taste graph · currency prefs
             (SQLite / Turso for demo; Supabase/Postgres for production)
```

---

## 5. Tech stack (concrete)

| Concern | Choice |
|---|---|
| Language | TypeScript |
| App framework | Next.js (App Router) — UI + server route handlers for the agent loop |
| Agent brain | `@anthropic-ai/sdk` (Messages API), manual tool-use loop |
| Tool surface | Kapruka MCP server (MCP client) + custom in-process tools |
| Frontend | React + Tailwind + shadcn/ui; streaming chat with rich product cards |
| State / DB | SQLite via Turso (demo) → Supabase/Postgres (prod) |
| WhatsApp channel | Twilio or WasenderAPI adapter over the shared agent core |
| Voice (Phase 4) | OpenAI Realtime API or Google Cloud STT/TTS (`si-LK`) |
| Deploy | Vercel (web) + a small worker for reminders/delivery-watch |
| Observability | Structured logs, per-turn tool traces, cost/latency metrics |

---

## 6. Kapruka MCP tool reference (the foundation)

All 7 tools verified live. Each supports `response_format: 'markdown' | 'json'` and currency `LKR/USD/GBP/AUD/CAD/EUR`.

| Tool | Purpose | Key inputs | Notes / gotchas |
|---|---|---|---|
| `kapruka_list_categories` | Top-level category tree + browse URLs | `depth` (1–2) | ~65 categories incl. `pirikara`, `dāna`-adjacent, festival pages. Cached ~30 min. |
| `kapruka_search_products` | Keyword search + filters + pagination | `q` (min 3 chars), `category`, `min/max_price`, `in_stock_only`, `sort`, `cursor` | **Pagination capped at 3 pages** (anti-enumeration). Stubs filtered unless `include_stubs=true`. |
| `kapruka_get_product` | Full product detail | `product_id`, `currency`, `type` | Returns price, stock level, variants, images, shipping. Flags `CATSYM*` as non-purchasable. |
| `kapruka_list_delivery_cities` | Find/validate deliverable cities | `query`, `limit` | Returns canonical name + aliases (e.g. Kandy ← galagedara). Always pass a `query`. |
| `kapruka_check_delivery` | Feasibility + flat rate for city/date | `city`, `delivery_date`, `product_id` | **Flat LKR rate per order**. Perishable warning fires for `CAKE*/FLOWER*/COMBO*` when >1 day out. |
| `kapruka_create_order` | Guest checkout → pay link | `cart[]` (1–30, qty 1–99, optional `icing_text`), `recipient`, `delivery`, `sender`, `gift_message`, `currency` | **Only side-effecting tool.** Price locked 60 min; idempotency key per call. Rate limit 30 orders/hr/IP. |
| `kapruka_track_order` | Status + timeline + proof flags | `order_number` | Returns timeline, recipient, items, `has_delivery_photo/video`. |

### Observed quirks (we handle these defensively — credibility points)

1. **`check_delivery` returns contradictory data.** In testing it reported *"Not available on this date"* while giving `next_available_date` = the *same* requested date. We never trust the availability boolean blind — we surface it honestly and re-confirm at order time.
2. **Product-ID casing is inconsistent** across tools (`CAKE00KA001685` from search vs `cake00KA001685` from detail). Lookups are case-insensitive, but we **normalize IDs** before storing/deduping.
3. **`order_ref` ≠ `order_number`.** `create_order` returns a pre-payment `order_ref`; tracking needs the *post-payment* `order_number` emailed to the customer. We explain this gap to the user explicitly.

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

### A. Core commerce (table stakes — must be flawless)
| # | Feature | Built on |
|---|---|---|
| A1 | Natural-language product search (multilingual) | `search_products` |
| A2 | Category browse + deep-link to kapruka.com | `list_categories` |
| A3 | Product detail Q&A (price, stock, variants, shipping) | `get_product` |
| A4 | Multi-item cart building (up to 30 items) | local + `create_order` |
| A5 | Delivery feasibility (city + date + rate) | `check_delivery` |
| A6 | City resolver w/ alias + Singlish spelling tolerance | `list_delivery_cities` |
| A7 | Guest-checkout pay-link generation w/ price breakdown | `create_order` |
| A8 | Order tracking + timeline | `track_order` |
| A9 | Live multi-currency (LKR/USD/GBP/AUD/CAD/EUR) | all tools |

### B. Language & localization (the authenticity layer)
| # | Feature |
|---|---|
| B1 | **Auto language detection** — Sinhala script, Tamil script, English, romanized "Singlish" |
| B2 | **Code-switching** — understands `"machan ammata mother's day ekata gift ekak ona"` natively |
| B3 | **Singlish transliteration** — `"upandineta cake ekak"` → "a birthday cake" |
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
| E3 | **Flat-rate bundle optimizer** — exploits *one-flat-delivery-per-order*: "add flowers, delivery's still LKR 300" |
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

---

## 9. The 6 headline innovations (the demo reel)

1. **Trilingual code-switching incl. Singlish** — sounds like a real Sri Lankan, not Google Translate.
2. **Diaspora "be there from afar"** — timezone + currency + delivery-photo proof + scheduled message.
3. **Dāna / Pirikara almsgiving concierge** — nobody else will build this; profoundly Sri Lankan and emotionally huge for diaspora who miss funerals.
4. **Cultural gift concierge** — festival + relationship + religion aware, with an Avurudu-hamper auto-composer.
5. **Proactive occasion memory + no-repeat** — turns one purchase into a lifelong relationship.
6. **Flat-rate bundle economics + honest data handling** — shows you understood the API better than the API understands itself.

---

## 10. Sinhala / Tamil / multilingual deep-dive

Sri Lanka is trilingual, and people **code-switch constantly** — including romanized Sinhala ("Singlish") over chat.

**Inputs the agent must handle natively:**

| Form | Example | Meaning |
|---|---|---|
| Sinhala script | `අම්මාට උපන්දිනේට කේක් එකක් එවන්න ඕන` | "Need to send a birthday cake for Amma" |
| Singlish (romanized) | `ammata bday ekata cake ekak Kandy yawanna puluwanda?` | "Can you send a birthday cake to Amma in Kandy?" |
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

## 13. Judge scoring map

| Likely criterion | Features that score it |
|---|---|
| **Innovation** | Dāna concierge, Singlish code-switch, diaspora bridge, bundle economics |
| **Cultural relevance** | All of §C + §D, Sinhala/Tamil |
| **Technical execution** | Agentic loop, custom tools, defensive data handling, MCP mastery |
| **UX** | Poster-style cards, WhatsApp, voice, "why this" |
| **Completeness** | Full purchase → track → proof → reminder loop |

---

## 14. The 90-second demo that wins

> **User (Singlish):** `machan amma ge bday ekata Kandy walata cake ekak yawanna ona, 6000ට යටින්, surprise ekak`
>
> **Agent (Sinhala + English):**
> 1. Detects **Kandy** is deliverable (`check_delivery`).
> 2. Picks a top birthday cake (`search_products` → `get_product`).
> 3. **Flags the perishable timing** (freshness guard).
> 4. **Bundles flowers** because the flat delivery is the same LKR 300 (bundle optimizer).
> 5. Shows the total in **AUD** (diaspora currency).
> 6. **Writes a warm Sinhala gift-card message** (`compose_gift_message`).
> 7. Confirms, then returns the **pay link** (`create_order`).
> 8. Offers **delivery-photo confirmation** + **"shall I remind you next Avurudu too?"**

One flow, 8 differentiators, zero generic-chatbot energy.

---

## 15. Build roadmap (phased)

> Locked decisions baked in: **TypeScript + Next.js**, **Claude brain + Kapruka MCP**, **Web + WhatsApp in parallel** over a shared agent core.

### Phase 1 — Demo-winning core
- Next.js app + shared agent core (Claude Messages loop + Kapruka MCP client).
- Poster-style web chat with streaming + product cards.
- Sinhala / Singlish detection + response.
- Cart → `check_delivery` pre-check → pay-link → track.
- Perishable guard, flat-rate bundle optimizer, "why this", full price breakdown.

### Phase 2 — Relationship layer
- Recipient/occasion memory + reminders + no-repeat.
- Festival calendar engine + Avurudu hamper composer.
- Dāna / pirikara flow.

### Phase 3 — Channels & proof
- WhatsApp channel adapter (Twilio / WasenderAPI).
- Delivery photo/video proof loop.
- Image → search (multimodal).

### Phase 4 — Voice & advanced
- Sinhala voice (OpenAI Realtime or Google `si-LK`).
- Split-gift coordination.
- Taste graph personalization.

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

## 17. Data model (initial)

```
recipients      id, user_id, name, relationship, phone, address, city,
                dietary, preferences[], religion, notes
occasions       id, user_id, recipient_id, type, date, recurrence, currency
gift_history    id, user_id, recipient_id, occasion_id, product_id,
                product_name, ordered_at, order_ref, order_number
reminders       id, user_id, occasion_id, fire_at, status
user_prefs      user_id, default_currency, language, timezone
taste_signals   id, user_id, recipient_id, product_id, signal (accepted/rejected)
```

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

*Prepared for the Kapruka Agent Challenge 2026. Built on the live Kapruka MCP server (7 tools verified). Ready to scaffold Phase 1 on approval.*
