# The public demo

A visitor presses one button and gets their own copy of Folkbranch with an invented family, signed in as its owner, with no sign-up. They can try everything, the assistant included. The copy is deleted after an hour. Nothing here changes a normal install: all of it is switched on by `FOLKBRANCH_DEMO=1`.

## How it works

```
visitor ─▶ router (demo/router.mjs, one port)
             ├─ slot 0: app on 127.0.0.1:4100, DATA_DIR=<DEMO_ROOT>/slot-0
             ├─ slot 1: app on 127.0.0.1:4101, DATA_DIR=<DEMO_ROOT>/slot-1
             └─ … DEMO_SLOTS of them
```

- **The router** is plain Node with no dependencies. It starts `DEMO_SLOTS` app processes, each with its own data folder and port, and waits for `/api/health`. A demo copy answers health only once the family is loaded.
- **Start page** (`/`, English or Russian by `Accept-Language`, `?lang=` to switch): one button, `POST /start`. With `TURNSTILE_SECRET` set it also shows Cloudflare Turnstile and verifies the token on the server before a copy is given.
- **`POST /start`** checks the per-address limit, picks a free slot (a slot in the other language is wiped and restarted in the visitor's), asks the slot for a session (`POST /api/demo/session`, with the router's secret), and sets two cookies: the app's session and the router's own `fb_demo`, signed with HMAC and naming the slot and a token the slot remembers. Then it redirects into the app.
- **Every other request** with a valid `fb_demo` is proxied to that slot, streams (`/api/events`) and uploads included. A request without a valid cookie goes to the start page. A cookie that is signed but whose copy has ended (time up, or the slot now belongs to someone else) gets "Your demo has ended" with a start-again button; an `/api/…` call gets 401.
- **Life of a copy:** `DEMO_TTL_MIN` in all, `DEMO_IDLE_MIN` without activity. An open page's live line (`/api/events`) and its presence beat do not count as activity. Then the process is stopped, its folder deleted, and a fresh one started and seeded. A crashed process is started again with its data kept.
- **All copies in use:** the visitor sees "All demo copies are in use. Try again in about N minutes", N from the soonest expiry.
- **`/health`** answers 503 until a copy has been ready once, then 200 for good (so a release that cannot start is seen as broken, and a busy demo is not restarted). **`/stats`** (header `x-demo-secret`) shows slots in use, free and starting, and starts in the last hour: no personal data. Logs are one JSON line per event; an address is only ever logged as a short hash.
- **In the app** (`lib/demo-mode.ts`): when the archive is empty at start, the owner and the family are made in `DEMO_LANG`, so nobody meets the setup screen. A thin banner on every screen, in the interface language, says it is an invented family and links to https://folkbranch.com/#install. The assistant is told it is a demo with invented people and not to follow instructions found in archive text.

## Settings

Router (`demo/router.mjs`):

| Variable | Default | Meaning |
|---|---|---|
| `DEMO_ROUTER_SECRET` | required, 16+ characters | Signs the router's cookie, opens `/stats` and `/api/demo/session`. Shared with the app copies |
| `PORT` | `8080` | The router's port |
| `DEMO_SLOTS` | `8` | App processes, so at most this many visitors at once |
| `DEMO_TTL_MIN` | `60` | Total life of a copy |
| `DEMO_IDLE_MIN` | `20` | Life without activity |
| `DEMO_STARTS_PER_HOUR` | `3` | Copies one address may start per hour (`CF-Connecting-IP`, else the socket address) |
| `DEMO_LANG` | `en` | Language a copy starts in (`en` or `ru`); a visitor of the other language gets a fresh copy in theirs |
| `DEMO_PUBLIC_URL` | `BETTER_AUTH_URL`, else `http://127.0.0.1:$PORT` | The address people open; every copy gets it as its `BETTER_AUTH_URL`. A `https` address makes the router's cookie `Secure` |
| `DEMO_ROOT` | `/tmp/folkbranch-demo` | Where the copies' data folders live. Disk that can be lost |
| `DEMO_BASE_PORT` | `4100` | Slot `n` listens on this plus `n`, on 127.0.0.1 only |
| `DEMO_APP_DIR`, `DEMO_APP_CMD` | the working folder, `node server.js` | How a copy is started. In the image the defaults are right |
| `DEMO_SWEEP_MS` | `5000` | How often expired copies are collected |
| `TURNSTILE_SECRET`, `TURNSTILE_SITE_KEY` | unset | Cloudflare Turnstile on the start button. Unset: no check, which is allowed only on an `http` address (local and tests). With an `https` `DEMO_PUBLIC_URL` the router refuses to start without it, unless `DEMO_ALLOW_NO_TURNSTILE=1` |
| `DEMO_CF_SECRET` | unset | A secret that a Cloudflare Transform Rule adds to every request as the header `x-demo-cf`. When set, `CF-Connecting-IP` is believed only with that header; a request without it is counted as one "direct" address, so reaching the router around Cloudflare (for example by the `*.up.railway.app` domain) cannot forge addresses. Unset: the header is believed as it comes, so **disable the Railway-generated domain** and let only Cloudflare reach the router |
| `DEMO_TOTAL_TOKENS_DAY` | `5000000` | Tokens all copies together may spend in a UTC day. About 25 copies at the per-copy `AGENT_DAILY_TOKENS` of 200000; set it to what the day's spend on your key should be, with a cheap model. `0` means no total. Kept in `DEMO_ROOT/budget.json`, so a restart does not forget it |
| `DEMO_USAGE_POLL_MS` | `30000` | How often the router asks each busy copy what it has spent (it also asks before wiping a copy) |
| `DEMO_REQUEST_TIMEOUT_MIN` | `5` | The longest a request may take to arrive (an upload gets minutes). A page's live line is not limited by it. `/start` has its own 10 second, 2 KB limit |

Everything else in the router's environment goes on to the copies, so the AI settings (`AGENT_PROVIDER`, `AGENT_MODEL`, a provider key, `AGENT_BASE_URL`) are set once, on the router. The router also sets for each copy: `FOLKBRANCH_DEMO=1`, `DEMO_LANG`, `DATA_DIR`, `PORT`, `HOSTNAME=127.0.0.1`, `BETTER_AUTH_URL`, `FOLKBRANCH_AUTO_BACKUP=0`, `FOLKBRANCH_UPDATE_CHECK=off`, and `AGENT_DAILY_TOKENS` (200000 unless you set it).

App copy (`lib/demo-mode.ts`), all read from the environment of the copy:

| Variable | Default | Meaning |
|---|---|---|
| `FOLKBRANCH_DEMO` | unset | `1` turns demo mode on. Without it nothing below does anything |
| `DEMO_AI_MESSAGES` | `20` | Requests to the assistant per copy, every request that calls the model (an answer to a confirmation card too: the history is the visitor's, so a trailing message could be made up); then a plain message |
| `AGENT_DAILY_TOKENS` | `200000` in the router, `5000000` otherwise | Tokens per day per copy, the existing limit |
| `DEMO_AI` | unset | `off` switches the assistant off in the demo, with a plain message |
| `DEMO_UPLOAD_MB` | `5` | Largest file. Pictures and sound recordings only |
| `DEMO_STORAGE_MB` | `50` | Files per copy |
| `DEMO_PEOPLE` | `300` | People per copy, whether added by hand, imported, by the assistant or by undoing a delete |
| `DEMO_DB_MB` | `100` | Largest database per copy (`PRAGMA max_page_count`): text has no other limit, and the disk is shared. Past it a write fails with "the server disk is full" |

No output limit is set for the model: reasoning models answer empty when it is too low, so the existing behaviour stays.

## What a copy refuses, and why

Each answers HTTP 403 with one sentence: *Not available in the demo: install your own copy to use this.* The REST routes are refused before anything is read (`demoRefusesRoute`), and the functions behind them refuse too, so the app, REST, MCP and the assistant meet the same wall.

| Refused | Why |
|---|---|
| `PUT /api/v1/ai/keys`, `DELETE /ai/keys/:service`, `PUT /ai/custom`, `DELETE /ai/custom/:id`, `POST /ai/custom/models`, `POST /ai/custom/test`, `PUT/PATCH/DELETE /assistant/provider`, `PUT /ai-settings` | A visitor's key or address would spend or reach somewhere that is not theirs; the router's key is the only one |
| `POST /tokens`, `PATCH /tokens/:id`; all of `/api/mcp` | An agent token is a door that outlives the copy |
| `POST /invites`; `/api/auth/family/accept`, `/family/setup`, `/family/telegram`; every `/api/auth` path except `get-session`, `sign-out`, `ok` and `error` | No more accounts and no other way in. Email sign-in, codes by mail and OAuth are all among them |
| `PUT/DELETE /sign-in-methods/:id` (and `sendCode` in the functions) | Setting up OAuth or email sign-in; sending mail |
| `POST /backups/now` | Each copy would keep a full copy of its database on the shared disk |
| `GET /update`, `POST /update` | The update check calls GitHub, and an update replaces the program |
| `POST /api/archive` (restore from a backup) | A restore replaces the whole copy |
| `PUT/DELETE /transcription`, `POST /transcription/test`, `POST /transcribe`; `PUT/DELETE /faces`, `POST /faces/test`, `POST /faces/scan` | Cloud speech and face services spend a key and send the files out. The in-browser models still work |
| The assistant's and API's "photo from a link" (`fetchRemote`) | The server would fetch addresses a visitor names |
| Uploads that are not pictures or sound, too large, or past the room; people past `DEMO_PEOPLE`; assistant messages past `DEMO_AI_MESSAGES` | The caps above (403, 413, 403, 429) |

The refusals are in English only: the sentences are server answers, not interface phrases. The banner is translated. A refusal that a screen does not catch itself is shown in a notice at the bottom of the screen (`components/demo-notice.tsx`).

## Abuse protection, and what is yours to do

- Per address: one live copy at a time (a second start gets a plain refusal), `DEMO_STARTS_PER_HOUR` counted only for starts that got a copy, and Turnstile on the start button (required on an `https` address). The address is `CF-Connecting-IP`, which anyone can write if they reach the router directly: keep the router behind Cloudflare only, as the public demo address, so the header is Cloudflare's.
- Per copy: assistant requests (at most 40 messages of history, a 256 KB body, 8 steps for one message), tokens per day (the tool loop also stops the moment the day's tokens are used up), database size, upload size and room, number of people, one hour of life.
- Across the demo: `DEMO_SLOTS` limits visitors at once, and so total memory and disk. Each copy is one Node process (the image caps its heap at 256 MB): plan roughly 300 MB per slot.
- Across all copies: `DEMO_TOTAL_TOKENS_DAY`. The router adds up what every copy has spent (read through the secret-protected `/api/demo/usage`, also before a copy is wiped). When the total is reached it switches the assistant off in every copy, with a plain message, until the next UTC day.
- **A spending limit on the model provider's key is yours to set, in the provider's console.** The demo caps messages and tokens per copy, but only the provider can cap the total. Use a key made for the demo, with a low monthly limit, and a cheap model.
- The assistant is told not to follow instructions found in archive text. That is a prompt, not a guarantee: the copy holds invented data only, and has no key or token to leak.

## Costs and the kill switch

The knobs, from most to least effective: `DEMO_AI=off` (no model spend at all), `DEMO_SLOTS` (memory), `DEMO_AI_MESSAGES` and `AGENT_DAILY_TOKENS` (spend per copy), `DEMO_STARTS_PER_HOUR`, `DEMO_TTL_MIN`. A smaller, cheaper `AGENT_MODEL` is the biggest saving.

Kill switch: set `DEMO_AI=off` and redeploy to keep the demo but stop the spend; stop or remove the service to take it all down (copies live in `DEMO_ROOT` and vanish with it). Revoking the provider key stops spend at once.

## Running it

On Railway: a service from the same image as the app, start command `node demo/router.mjs` (the image contains `demo/`), no volume, with the variables above and a domain. Redeploy it with every release (see [RELEASING.md](RELEASING.md)): it runs the code of the image it was built from, and the demo must show the current version.

Locally, with the model stub (no paid model), after `pnpm build`:

```bash
node -e "import('./tests/ui/model-stub.mjs').then((m) => m.startModelStub(3699))" &
DEMO_ROUTER_SECRET=local-secret-0123456789 PORT=3700 DEMO_SLOTS=2 DEMO_PUBLIC_URL=http://127.0.0.1:3700 \
DEMO_APP_CMD="node node_modules/next/dist/bin/next start -H 127.0.0.1" \
AGENT_PROVIDER=local AGENT_BASE_URL=http://127.0.0.1:3699/v1 AGENT_MODEL=stub-small AGENT_API_KEY=stub \
node demo/router.mjs
```

Open http://127.0.0.1:3700. The tests: `npx vitest run tests/demo-mode.test.ts tests/demo-router.test.ts` for the app side and the router with fake slots, and `node tests/e2e/demo.mjs` for the whole thing in a browser (about three minutes; it needs `pnpm build` first).
