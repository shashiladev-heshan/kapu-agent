# Kapu (කපූ) — Kapruka Agent Challenge 2026

Trilingual (Sinhala / Tamil / English / Tanglish) AI shopping concierge on the Kapruka MCP.
**Submitted 5 Jul 2026 → live at kapuwa.shop; judges test daily via live browser.** Rubric: Experience 30 / Visual 20 / Personality 15 / Usefulness 15 / Completeness 15 / Creativity 5.

## 🧠 The brain — `brain/` (read this protocol first)

Deep project knowledge lives in `brain/`: an Obsidian-style wiki of small notes connected by `[[wikilinks]]`. Resolve `[[name]]` → glob `brain/**/<name>.md`. (Open the `brain/` folder in Obsidian to see the graph — optional, for humans.)

- **Read:** start at `brain/hot.md` (current state), then `brain/INDEX.md` (one line per note) → open only the 2–4 notes the task touches, follow their `[[links]]`. Don't re-derive what a note already records; don't read the whole vault.
- **Write:** after verifying something live (probe, bug root-cause, decision, upstream behavior change), file it — update the matching note (bump `verified:`) or create one (frontmatter `type/summary/verified` + `Related:` links), AND keep its one-line `INDEX.md` entry + `hot.md` current. Notes hold **non-derivable knowledge only** (probe results, decisions, upstream gotchas, history) — never restate what's readable in `src/`.
- **Lint (occasional):** flag contradictions between notes, stale `verified:` dates, and orphan notes; fix or ask.
- The old monolithic docs (`kapruka-agent-challenge-2026.md` spec) are raw sources — superseded by `brain/spec/*` for lookup; only open the original when a note cites a section you need verbatim.

## Commands

```bash
npm run dev          # dev server (use -p 3100 locally; another project squats [::1]:3000)
npm run build        # production build — must stay clean
npm start            # serves on $PORT (Railway)
```

No test suite. Verify with `npm run build` + a curl smoke test against `/api/chat` (SSE).
⚠️ NEVER run `npm run build` while a dev server is running — they share `.next` and corrupt each other (500s, "Cannot find module './NNN.js'"). Check `lsof -ti :3100` first; use `npx tsc --noEmit` while dev is up.

## Hard rails (always apply — details in the linked notes)

1. **Kapruka MCP calls go through `src/lib/kapruka/shield.ts` ONLY**, args nested under `params` → [[mcp-shield]], [[params-wrapper]]. The 60 req/min limit is per shared egress IP → [[rate-limits]].
2. **Canonical LKR:** server-side prices are always LKR; display conversion is client-only; convert per-line BEFORE summing — never blind-sum `item.price` → [[currency-lkr]], [[why-canonical-lkr]].
3. **`create_order` is the only side-effecting tool** — triple confirm gate; never bypass; one idempotent retry max → [[create-order]].
4. **System prompt stays byte-stable** (prompt caching) — never interpolate dynamic data; per-turn data goes in async `buildTurnContext` → [[system-prompt]].
5. **Tools are defined twice** (JSON-schema `tools.ts` + zod `engine-sdk.ts`) with labels/steps once in `steps.ts` — adding a tool touches all three, on BOTH engines → [[tool-registry]], [[dual-engine]].
6. **`stock_level` is untrustworthy** — never render urgency from it → [[stock-level]].
7. **Never `Date.parse` `track_order.progress[]` timestamps** (SL wall-clock, no TZ) → [[track-order]].
8. **`get_product` 500s on all `EF_PC_*` ids** — every new surface needs the search-summary fallback → [[get-product-500s]].
9. **Payloads are hostile:** money objects, plain-text errors despite `response_format:json`, opaque case-varying ids → normalize via `normalize.ts` → [[payload-normalizing]].
10. The **සිං/த/EN toggle is authoritative** for reply language → [[i18n]]. Persona forbids product tables — use compare blocks → [[blocks]].
11. Bump the `CACHE` version in `public/sw.js` on asset changes → [[pwa-mobile]].

## Architecture (30-second map)

Next.js 15 monolith — frontend + backend in one Node process, Railway ([[why-monolith-railway]]).

```
Browser (PWA, SSE) → /api/chat ─┐
Telegram /api/telegram ─────────┤→ SAME agent core → MCP Shield → mcp.kapruka.com
WhatsApp /api/whatsapp (kapu-wa)┤   /api/tts · /api/stt · /api/scan
Schedules runner (60s tick) ────┘
```

| Area | Where | Brain note |
|---|---|---|
| Engine picked by credential (API key ↔ OAuth) | `src/lib/agent/loop.ts`, `engine-sdk.ts` | [[dual-engine]] |
| 33 tools + executors → UiBlocks | `src/lib/agent/tools.ts`, `steps.ts` | [[tool-registry]] |
| Persona + turn context | `src/lib/agent/system-prompt.ts` | [[system-prompt]] |
| MCP choke point (cache/coalesce/bucket) | `src/lib/kapruka/shield.ts` | [[mcp-shield]] |
| Payload normalizers | `src/lib/kapruka/normalize.ts` | [[payload-normalizing]] |
| Shared cart (tool + instant `/api/cart`) | `src/lib/kapruka/cart.ts` | [[cart-system]] |
| Sessions (web / `tg_` / `sched_`), optional Mongo | `src/lib/session/store.ts` | [[session-store]] |
| Schedules (standing wishes, order watch) | `src/lib/schedules/` | [[schedules]] |
| Telegram channel | `src/lib/telegram/*` | [[telegram]] |
| WhatsApp channel (Go sidecar `kapu-wa`) | `wa/`, `src/lib/whatsapp/*` | [[whatsapp]] |
| KB → Chroma + `kapruka_help` | `src/lib/kb/` | [[kb-chroma]] |
| Taste engine + rails | `src/lib/reco/store.ts`, `/api/discover`, `/api/extras` | [[taste-engine]], [[discover-rails]], [[extras-promos]] |
| People/occasions + festivals | `src/lib/agent/memory.ts`, `src/lib/festivals.ts` | [[memory-festivals]] |
| Specialist Kapus | `src/lib/client/agents.ts`, `/api/agents` | [[specialist-agents]] |
| Auth (guest-first Google) | `src/lib/auth/` | [[auth]] |
| Voice loop (STT/TTS/canvas) | `/api/stt`, `/api/tts`, KapuApp | [[voice-loop]] |
| Snap-a-list vision | `/api/scan`, `src/lib/client/scan.ts` | [[scan-vision]] |
| App shell / blocks / streaming / i18n / PWA | `src/components/*`, `src/lib/client/i18n.tsx` | [[app-shell]], [[blocks]], [[streaming]], [[i18n]], [[pwa-mobile]] |
| Design tokens & icons | `globals.css`, `src/components/icons.tsx` | [[design-system]] |

## Env

`ANTHROPIC_API_KEY` (or OAuth token → SDK engine), `OPENAI_API_KEY`, optional `MONGODB_URI` / `CHROMA_URL` / Google auth / Telegram — full inventory + dormancy map: [[env-credentials]]. **Before-judging checklist:** [[deployment]].
