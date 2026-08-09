# kapu-wa — WhatsApp transport for Kapu

A small Go service that owns the WhatsApp socket (via [whatsmeow](https://github.com/tulir/whatsmeow)) and nothing else.
No AI, no catalog, no session state — it forwards inbound messages to Kapu and
sends whatever Kapu tells it to. Same shape as the Telegram adapter: **webhook
in, REST out**, so the Next.js monolith stays a thin adapter.

```
WhatsApp ⇄ kapu-wa (Go) ──POST /api/whatsapp──▶ Kapu (Next.js)
              │          ◀──── POST /send ─────
              └── Postgres (whatsmeow session + device keys)
```

## Why a separate service

whatsmeow holds a **persistent authenticated socket**. That can't live inside a
Next.js request handler, and it needs durable storage for the pairing. Keeping
it out here means a Kapu redeploy never drops the WhatsApp session.

## Env

| var | required | notes |
|---|---|---|
| `DATABASE_URL` | yes | Postgres. **Not SQLite** — an ephemeral container disk loses the pairing and forces a re-scan. |
| `KAPU_WEBHOOK_URL` | yes | e.g. `https://kapuwa.shop/api/whatsapp` |
| `WA_SHARED_SECRET` | yes | guards `/send` and `/qr`; sent to Kapu as `X-Kapu-Secret` |
| `PORT` | no | Railway sets it |

Kapu's side needs `WA_SERVICE_URL` (this service's URL) and the same
`WA_SHARED_SECRET`.

## Endpoints

- `GET /health` — `{ok, paired, connected, jid}`
- `GET /qr?secret=…` — pairing QR as PNG. **Scanning it links this server as a
  companion device to whoever scans**, so an unprotected `/qr` is a takeover of
  the bot. Always gated by the secret.
- `POST /send` — `{to, text}` and/or `{to, image_url, caption}`

## Pairing

1. Deploy with `DATABASE_URL` set.
2. Open `https://<service>/qr?secret=<WA_SHARED_SECRET>` on a screen.
3. WhatsApp → Settings → Linked devices → Link a device → scan.
4. `GET /health` should flip to `"paired": true`.

The pairing survives restarts because it lives in Postgres. Codes expire every
~20s; just refresh `/qr`.

## Ban risk — read this

whatsmeow is an **unofficial** client. It is far more stable than Baileys, but
it is the same category to Meta and the number can be banned permanently.
Tools in this class typically run weeks-to-months before detection, and the
fastest trigger is recipients hitting **Report & Block**.

**Use a dedicated SIM you are willing to lose. Never the company's real
WhatsApp Business number** — a ban takes the number with it, and migrating a
number off the WhatsApp Business app to any API is a one-way door.

## Local dev

```bash
createdb kapuwa_test
DATABASE_URL="postgres://$(whoami)@localhost:5432/kapuwa_test?sslmode=disable" \
WA_SHARED_SECRET=testsecret \
KAPU_WEBHOOK_URL=http://localhost:3100/api/whatsapp \
PORT=8099 go run .
open "http://localhost:8099/qr?secret=testsecret"
```

To exercise the Kapu side without pairing, run any stub on `:8099` that accepts
`POST /send`, point Kapu at it with `WA_SERVICE_URL`, and POST a fake inbound
payload to `/api/whatsapp` with the secret header.

## Deploy

Its own Railway service with **Root Directory = `wa/`** (the repo's
`.railwayignore` excludes `wa/` from the Kapu service's uploads, so deploy this
one from inside the folder: `cd wa && railway up --service kapu-wa`).
