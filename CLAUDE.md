# Kapu (කපූ) — Kapruka Agent Challenge 2026

Trilingual (Sinhala / Tamil / English / Tanglish) AI shopping concierge on the Kapruka MCP.
Full spec & decisions: `kapruka-agent-challenge-2026.md` (read §0 first — official rubric: Experience 30 / Visual 20 / Personality 15 / Usefulness 15 / Completeness 15 / Creativity 5). Deadline: **5 July 2026** (extended from 30 Jun — verified on the challenge page 4 Jul; demos judged via live browser access).
UI implements the 11-section "Kapu redesigned" spec (`Kapu UI Redesign.html` + `assets/`): Instrument Serif/Sans, stroke icons, app shell (sidebar→rail + live basket), immersive voice canvas.

## Commands

```bash
npm run dev          # dev server (use -p 3100 locally; another project squats [::1]:3000)
npm run build        # production build — must stay clean
npm start            # serves on $PORT (Railway)
```

No test suite yet. Verify changes with `npm run build` + a curl smoke test against `/api/chat` (SSE).
⚠️ NEVER run `npm run build` while a dev server is running — they share `.next` and the build corrupts the dev server's chunks (500s, "Cannot find module './NNN.js'"). Check `lsof -ti :3100` first; use `npx tsc --noEmit` for verification while dev is up.
Voice STT note (verified live): whisper-1 REJECTS `language=si` as a param — Sinhala is steered via the Sinhala-exemplar prompt in `/api/stt`, with a wrong-script retry guard; `ta` is a legal param. gpt-4o-mini-transcribe 400s on this account; the route caches whichever model works.

## Architecture (Next.js 15 monolith — frontend + backend in one Node process, deploys to Railway)

```
Browser (PWA, SSE) → /api/chat ─┐
Telegram (private+groups) ──────┤→ SAME agent core → MCP Shield → mcp.kapruka.com
      /api/telegram (webhook)   │   /api/tts · /api/stt · /api/scan (vision)
```
Telegram channel (`src/lib/telegram/*`): tg_<chatId> sessions reuse the store/tools/memory; blocks render as photos + inline keyboards (➕ Add, confirm gate, pay button); voice notes → Whisper; photos → vision scan; groups wake only on @mention or reply-to-bot and share ONE basket per group. Dormant without `TELEGRAM_BOT_TOKEN`. Local testing: `node scripts/tg-poll.mjs` (long-polls and forwards to localhost — no public URL needed); prod: setWebhook to `<domain>/api/telegram` with `TELEGRAM_WEBHOOK_SECRET`.

### Dual agent engine — `src/lib/agent/loop.ts` picks by credential
- `ANTHROPIC_API_KEY` → **Messages API manual loop** (`runTurnApi`, streaming + prompt caching). Use for the hosted demo.
- `ANTHROPIC_AUTH_TOKEN` / `CLAUDE_CODE_OAUTH_TOKEN` (subscription OAuth, `sk-ant-oat...`) → **Claude Agent SDK engine** (`engine-sdk.ts`). Subscription tokens are REJECTED by the raw Messages API (opaque 429, no ratelimit headers) but work through the Claude Code harness. Force with `KAPU_ENGINE=api|agent-sdk`.
- Both engines share: system prompt, the **19 tools** (commerce 8 + `propose_order` confirm gate + `create_order`/`track_order` + memory 6: `remember_recipient`/`get_recipients`/`forget_recipient`/`save_occasion`/`get_upcoming_occasions`/`get_my_orders` + `say`/`suggest_replies`), session store, SSE event shape. Keep them in sync when adding tools (tool defs exist twice: JSON-schema in `tools.ts`, zod in `engine-sdk.ts`; labels twice in `loop.ts` + `engine-sdk.ts`). `buildTurnContext` is ASYNC (loads people/occasions) — both engines await it.

### Kapu Schedules (autonomous standing wishes)
- `src/lib/schedules/store.ts` (owner=Google sub, SL-time cadence math, TG link codes) + `runner.ts` (60s tick started by `src/instrumentation.ts`; kinds: `task` = full agent run in persistent `sched_<id>` session, `watch_order` = LLM-free tracking poll → TG on change, auto-stops on delivered).
- Standing consent: `allowOrder` on the schedule → `mode: scheduled | standing_consent:` in turn context; money still only moves via the human-paid link. Tools: create/list/cancel_schedule (auth-gated via `signed_in` context).
- TG delivery: user sends `/link` to the bot → 6-digit code → web Schedules sheet binds `tgChatId` on the user record (`/api/telegram-link`).

### Key modules
| Path | Role |
|---|---|
| `src/lib/kapruka/shield.ts` | THE ONLY place that calls the Kapruka MCP. LRU cache per tool, in-flight coalescing, 50 rpm token bucket (limit is 60/min **per IP** — all users share Railway's egress IP). |
| `src/lib/agent/system-prompt.ts` | Kapu persona (byte-stable for prompt caching — NEVER interpolate dynamic data) + `buildTurnContext()` (per-turn: date, currency, reply_language, cart count, mode). |
| `src/lib/agent/tools.ts` | Tool definitions + executors. Tools return compact JSON for the model AND emit `UiBlock`s for the frontend. |
| `src/lib/kapruka/normalize.ts` | Defensive payload normalizers (`money()`, `toSummary/toDetail`, `resizeImage()` — the static2 image proxy is width-tunable). |
| `src/lib/kapruka/cart.ts` | Shared cart mutation used by BOTH the `cart_update` tool and `/api/cart` (instant steppers, no LLM round-trip). |
| `src/lib/session/store.ts` | In-memory sessions (history + cart + `ui` transcript for reload/recent-wish rehydration + title), optional Mongo persistence (`src/lib/db/mongo.ts`, no-op without `MONGODB_URI`). |
| `src/components/KapuApp.tsx` | App shell: sidebar (first-run) → icon rail (chat) + live basket panel (xl), recent wishes (localStorage registry + `/api/session` rehydration), deliver-to chip, SSE consumption, voice canvas, edge-state cards, popovers/sheets. |
| `src/components/blocks.tsx` | UiBlock renderers: product rails (KAPU'S PICK), cake-moment hero (icing input + date pills), compare duel (winner ticks + Kapu's verdict), delivery card, basket, order_summary confirm gate, pay link (price-lock countdown), rich order timeline (+proof panel), no_results, chips. |
| `src/components/icons.tsx` | The 1.6px stroke icon set + official `KapuMark` (from `assets/brand/`). |
| `src/app/api/{chat,cart,cities,session,tts,stt,health}/route.ts` | API surface. `/api/chat` streams SSE; `/api/cart` = instant basket ops; `/api/cities` = deliver-to typeahead (Kapruka cities + vernacular aliases — NOT Google Places, no key needed); `/api/session` = transcript rehydration. `/preview` = unlinked block gallery for visual QA. |
| `src/lib/agent/memory.ts` + `src/lib/festivals.ts` | People/occasion memory (consent-first; account-backed when signed in, session-backed for guests; surfaced in turn context as `people:`/`upcoming:`) and the SL festival calendar (`next_festival` context + hero countdown chip; `approx:true` dates render "~"). |
| `src/lib/client/i18n.tsx` | FULL trilingual UI chrome (~110 keys si/ta/en) — `LangProvider` wraps the app; blocks use `useT()`. The සිං/த/EN toggle localizes everything, not just placeholders. QA: `/preview?lang=si\|ta&dark=1`. |
| `src/lib/auth/` + `src/app/api/auth/*, /api/wishes` | Guest-first auth. Optional "Sign in with Google" (GIS button → ID token verified via Google tokeninfo → HMAC httpOnly cookie; NO client secret, NO extra deps). Signed-in users get their recent-wish list synced across devices (in-memory + Mongo `KapuUser`). Dormant without `NEXT_PUBLIC_GOOGLE_CLIENT_ID`. First visit shows a welcome gate (Google / Continue as guest, `kapu_welcome` flag). |
| `src/app/api/scan/route.ts` + `src/lib/client/scan.ts` | Snap-a-list (spec N2/G1): composer camera button → native capture input → client JPEG compression (~1280px) → vision OCR (prefers real `ANTHROPIC_API_KEY`/Claude, falls back to `OPENAI_API_KEY`/gpt-4o-mini) → {kind, items[query/quantity/original], caption} → auto-sends "I scanned my shopping list 📸 — …" so the NORMAL agent loop searches + fills the basket. Handles Sinhala/Tamil/Tanglish→English translation ("හාල්"→rice). |

### Kapruka MCP gotchas (all verified live)
- Every tool call nests args under `params`: `{"arguments": {"params": {...}}}`.
- `price` and `compare_at_price` come as **objects** `{amount, currency}` (sometimes bare numbers/strings) — normalize via `money()` in tools.ts.
- Search results use `image_url`; product detail uses `images[]`. `category` may be an object `{name}`.
- Search returns `results[]`; default `in_stock_only: true`. Pagination caps at 3 pages — refine queries instead.
- `create_order` is the ONLY side-effecting tool: triple-gated (propose_order renders the summary card → explicit user confirm → executor refuses without `confirmed=true`). Returns `checkout_url` + pre-payment `order_ref` + `expires_at` + `summary{items_total, delivery_fee, addons_total, grand_total}`; the trackable `order_number` arrives by email after payment. Idempotency key per call — one safe retry is sanctioned.
- Product IDs are heterogeneous opaque strings; compare case-insensitively.
- **`stock_level` is untrustworthy** (probe 4 Jul: constant "low" on everything) — never render urgency from it; only boolean `in_stock` is real.
- **`track_order.progress[]` is the real journey** (probe 7 Jul): 8+ free-text steps ("Kapruka Warehouse, Order Prepared"…) whose names DON'T match the status enum, with pre-formatted SL wall-clock timestamps (no TZ marker — never `Date.parse` them for display). `status` can also be `out-for-delivery` (≈ shipped). `OrderTimeline` + the TG renderer show EVERY progress step; the canonical 4-step skeleton is only the empty-progress fallback. Docs example order `VIMP34456CB2` is live — handy for demos. Web app persists tracked numbers (`kapu_tracked`) + 5-min visibility-gated change watcher → notification panel + opt-in native Notification; Telegram watch = `watch_order` schedule (app-closed case).
- Search-result `category` is a constant `General` stub — real category only from `get_product`.
- `image_url` is a resizable Cloudflare proxy (`width=330…` → rewrite via `resizeImage()`).
- Server rate-limit headers (`ratelimit-remaining`) exist on every response — future shield improvement: header-driven backoff (bucket is shared per IP with strangers).
- **`get_product` 500s consistently on `EF_PC_ELEC*` IDs** (marketplace/electronics family; probe 7 Jul, 2/2 products) — hero/compare must degrade to search-summary data; instant cart survives via the `known` payload.
- Even with `response_format:"json"`, no-results and upstream errors arrive as PLAIN TEXT ("No products found…", "Error: Kapruka API server error (HTTP 500)") — keep `parseJson` defensive.
- `list_categories depth:2` (probe 7 Jul): 65 top-level categories with rich children + public kapruka.com `url` per category — but **they're browse-only: ALL tested slugs return 0 as search facets** (valentine/diwali/thaipongle/teachersday/Giftcert, verified) — the "category filters unreliable" rule is universal; use children as plain `q` keywords. `list_categories` now emits the tappable `category_tree` UiBlock. Gift vouchers are real via q "gift voucher"/"gift certificate" (prefix `GIFTV0*`) — in the persona for undecided gifters.
- `ships_internationally` (search top-level; detail under `shipping{}`) → normalized as `ships_intl`, rendered as the hero's 🌍 badge (diaspora angle).

## Language system
- The UI toggle (සිං/த/EN) is AUTHORITATIVE: `reply_language` in each turn's context. si → Sinhala script replies, ta → Tamil script, en → mirror user style (English/Tanglish). Explicit in-chat request overrides.
- Voice mode (`mode: voice` in context): visible reply stays in script; model ALSO calls the `say` tool with a speech-optimized version — for Sinhala that's **romanized colloquial Sinhala**, because TTS engines read Latin-script Sinhala far more naturally than Sinhala orthography.

## Voice loop (hands-free)
- Input: Web Speech API (free; Chrome supports `si-LK`), fallback MediaRecorder → `/api/stt` (Whisper). iOS/iPadOS WebKit + Brave are routed STRAIGHT to the recorder (`webSpeechLikelyBroken()`) — iOS exposes `webkitSpeechRecognition` but it hangs (no result/end/error, verified on-device). The recorder is hands-free via VAD endpointing (AnalyserNode RMS; ~1.4s pause after speech auto-sends; "✓ Done" is the manual backup). A 12s hung-engine watchdog (`"hung"` onError) rescues mid-session hangs on other browsers.
- Voice canvas renders the current turn's UiBlocks as animated cards (`voiceBlocks` in KapuApp → compact orb + scrollable card panel, `.voiceblock` entrance animation) — cards are interactive (➕ add works mid-conversation).
- Output: `/api/tts` provider chain — si/ta: Azure → OpenAI; en: ElevenLabs → OpenAI → Azure; 204 → browser speechSynthesis. OpenAI uses `gpt-4o-mini-tts` + voice `coral` + per-language Sri Lankan delivery `instructions`.
- Client state machine in KapuApp: listening → thinking → speaking → listening; barge-in stops playback; `speech` UiBlock (from `say`) overrides the spoken text and is never rendered.
- Honest limit: truly natural Sinhala TTS exists only on Azure (`si-LK-ThiliniNeural`, free F0 tier) — owner declined Azure for now; romanized-speech trick is the current best.

## UI conventions ("Kapu redesigned" system)
- **Brand**: Kapruka purple `#402970` + gold CTA `#ffb800` (dark text on gold) + purple-tinted creams. Tokens in `globals.css` `@theme`: `leaf/gold/clay` + `cream/surface/card/line/edge/ink/ink-soft/ink-faint/leaf-soft/gold-soft/good/bubble`. Dark mode = same names under `html.dark` (page `#151022`, cards `#1e1633`, borders `#2b2046`; purple glows brighter via `leaf=#a78bfa`, gold stays gold).
- **Type**: Instrument Serif (display/prices — `.font-display`, `.price-serif`) + Instrument Sans body + Noto Sans Sinhala/Tamil (all next/font, self-hosted). Editorial serif for headings and prices is the signature.
- **Icons**: 1.6px stroke set in `src/components/icons.tsx` — NO emoji in chrome. Brand source-of-truth in `assets/` (also copied to `public/assets/`).
- Markdown via react-markdown + remark-gfm; persona forbids product tables (visual compare_products instead).
- PWA: `app/manifest.ts`, `public/sw.js` (network-first, bump `CACHE` version on asset changes), icons in `public/icons/` (official wish-tree mark from `assets/brand/`).
- Mobile-first: `dvh`, safe-area insets, `.rail` carousels; basket = bottom sheet (<sm) / slide-over (sm+) / live panel (xl+).
- ⚠️ Headless-Chrome screenshots on macOS clamp windows to ~500px min width — narrow-viewport "overflow" in screenshots is an artifact; verify true mobile via an embedded iframe.

## Credentials / env (see `.env.example`)
- Claude: `ANTHROPIC_API_KEY` (Messages engine) or `ANTHROPIC_AUTH_TOKEN` (Agent SDK engine). Owner currently uses a subscription OAuth token; **an API key is required before judging** (subscription pool is shared with his own Claude Code use → 429s).
- Voice: `OPENAI_API_KEY` (TTS+Whisper, set), `OPENAI_TTS_MODEL=gpt-4o-mini-tts`, `OPENAI_TTS_VOICE=coral`; optional `ELEVENLABS_API_KEY`, `AZURE_SPEECH_KEY`.
- `KAPU_MODEL=claude-sonnet-4-6` currently; `MONGODB_URI` optional.
- Auth (optional): `NEXT_PUBLIC_GOOGLE_CLIENT_ID` (Google Cloud → OAuth Web client; authorized JS origins = `http://localhost:3100` + the Railway domain; no redirect URI / secret needed) + `KAPU_AUTH_SECRET` (cookie signing; without it sign-ins reset per deploy). Unset → guest-only, no Google script loads.

## Remaining roadmap (from spec §15)
Done 4 Jul: full UI redesign ✅, propose_order confirm gate ✅, instant cart API ✅, session rehydration + recent wishes ✅, voice canvas ✅, edge-state cards ✅, brand assets ✅.
Done 5 Jul: guest+Google auth (welcome gate, wish sync) ✅, city typeahead via Kapruka aliases (`/api/cities`) ✅, Snap-a-list camera OCR + scene recreate (`/api/scan`) ✅, recipient/occasion memory + order history (D2/H1/H2, consent-first) ✅, festival calendar + hero countdown (C1/N9) ✅, recipe-to-cart + pirikara chips (N1/C3) ✅, hero variant picker (S7) ✅, FULL trilingual UI chrome (i18n.tsx) ✅.
Phase 3 remaining: WhatsApp adapter, delivery-proof watcher. Backlog: Wish Bridge, price-drop watch, header-driven shield backoff, hamper canvas visual.
**Before judging: switch to a real `ANTHROPIC_API_KEY`, set `MONGODB_URI` (sessions survive redeploys), register + email the live URL by 5 July EOD.**
