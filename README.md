# Kapu (කපූ) 🌴 — Sri Lanka's AI Shopping Concierge

> Built for the **Kapruka Agent Challenge 2026**. Chat in **Sinhala, Tamil, English or Tanglish** and shop all of Kapruka.com — groceries, phones, medicine, cakes and gifts home.

Named after the mythical **kapruka** wish-granting tree: tell Kapu what you wish for, and it appears at your door.

## Stack

- **Next.js monolith** (frontend + backend in one Node process) — deployed on **Railway**
- **Claude** (`claude-sonnet-4-6`, env-configurable) — **dual engine**, auto-selected by credential:
  - `ANTHROPIC_API_KEY` → manual Messages API loop (`@anthropic-ai/sdk`) with streaming + prompt caching — use for the hosted demo
  - `ANTHROPIC_AUTH_TOKEN` (Claude subscription OAuth, `sk-ant-oat...`) → Claude Agent SDK engine (`@anthropic-ai/claude-agent-sdk`) — great for local dev on a Claude plan
  - Force with `KAPU_ENGINE=api|agent-sdk`
- **Kapruka MCP** (`mcp.kapruka.com`) behind an in-process **MCP Shield** (LRU cache + request coalescing + token-bucket queue under the 60 req/min/IP limit)
- **MongoDB** via Mongoose (optional — app runs fully in-memory without it)
- **PWA**: installable on Android/iOS, mobile-first, offline shell

## Run locally

```bash
cp .env.example .env       # add ANTHROPIC_API_KEY or ANTHROPIC_AUTH_TOKEN
npm install
npm run dev                # http://localhost:3000
```

Credentials: the Anthropic SDK picks up **either** `ANTHROPIC_API_KEY` **or** `ANTHROPIC_AUTH_TOKEN` from the environment — set whichever you have.

## Deploy on Railway

1. New project → Deploy from repo (Railway auto-detects Next.js; `npm run build` / `npm start`).
2. Add the MongoDB template to the same project (optional) and set `MONGODB_URI`.
3. Set `ANTHROPIC_API_KEY` (or `ANTHROPIC_AUTH_TOKEN`).
4. Health check path: `/api/health`.

## Architecture

```
Browser (PWA, SSE) ──► /api/chat ──► Agent loop (Claude + tools)
                                        │
                                        ▼
                              MCP Shield (cache·coalesce·queue)
                                        │
                                        ▼
                              https://mcp.kapruka.com/mcp
```

Every Kapruka tool call is wrapped under `{"arguments": {"params": {...}}}` (the #1 integration footgun), goes through the shield, and renders as rich UI blocks (product rails, comparison grids, delivery cards, cart drawer, pay-link, order timeline) streamed over SSE.

`create_order` is the only side-effecting tool and is double-gated: the model must present a full order summary and receive explicit user confirmation, and the tool refuses without `confirmed=true`.
