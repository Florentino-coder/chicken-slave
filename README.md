# Chicken Slave

เว็บเกมไพ่สลาฟแบบเรียลไทม์ เล่นได้ทันทีโดยไม่ต้องสมัครหรือล็อกอิน รองรับภาษาไทย (ค่าเริ่มต้น) และภาษาอังกฤษ

By Florentino

## เริ่มใช้งาน

```bash
npm install
npm run build        # build web app into apps/web/dist
npm start            # server + web on http://localhost:3001
```

Development with hot reload (two terminals):

```bash
npm run dev:server   # http://localhost:3001 (API + socket)
npm run dev:web      # http://localhost:5173 (proxies /api and /socket.io)
```

## Tests

```bash
npm test             # engine unit + property tests, server smoke + integration
npm run test:coverage
npm run test:e2e     # Playwright, 4 browser contexts (needs `npx playwright install chromium`)
npx tsx apps/server/test/load.ts   # 100 rooms x 4 sockets load test
```

## Structure

```
packages/engine   Pure TypeScript rules: cards, combos, game state machine, bots
packages/shared   Socket event names, zod payload schemas, view types
apps/server       Express + socket.io: guest tokens, rooms, matchmaking, timers, bots
apps/web          Vite + React + Tailwind client (i18n in src/i18n.ts, icons in src/icons/paths.ts)
design            Lacquer Court icon set, logo, specimen sheet (node design/build-icons.mjs)
e2e               Playwright tests
```

## Guest identity (no login)

1. On first visit the client calls `POST /api/guest`.
2. The server creates a `guestId` (UUID) and a random Thai nickname, signs a JWT (HS256, 30 days), and sets it as the httpOnly cookie `slave_token`.
3. The socket handshake sends the cookie; the server binds the socket to the `guestId`.
4. Reconnecting with the same cookie returns the player to the same seat. A disconnected player keeps the seat for `GRACE_MS` (60 s); their turn timer still runs. After that a bot plays the seat until they come back.
5. Clearing cookies loses the identity. Account linking is a phase 2 item.

## Rules implemented

- 52 cards, 3 to 6 players, all cards dealt. Order 3 < … < A < 2, suits ♣ < ♦ < ♥ < ♠.
- Singles, pairs, triples, quads. Followers match type and size and must be higher.
- Round 1: the 3♣ holder leads with a play containing 3♣.
- Pass lock (configurable). When everyone else passes, the last player leads; if they already went out, the next active seat leads.
- Titles: King, Queen, Commoner, Peasant, Slave. Scores: n-1-place per round.
- Exchange from round 2: Slave gives 2 best cards to King, Peasant gives 1 to Queen (automatic); King and Queen choose cards to return. Slave leads.
- Optional rules: straights, revolution (a quad reverses the order), no finishing with a 2.

## Server configuration

| Env | Default | Meaning |
| --- | --- | --- |
| `PORT` | 3001 | HTTP port |
| `JWT_SECRET` | random per boot in dev | **Required in production** |
| `BOT_DELAY_MS` | 900 | Bot thinking delay |
| `GRACE_MS` | 60000 | Seat hold after disconnect |
| `NEXT_ROUND_MS` | 8000 | Pause between rounds |
| `QUICK_WAIT_MS` | 15000 | Quick Play wait before filling with bots |
| `ROOM_IDLE_MS` | 600000 | Delete rooms with nobody connected |
| `TURN_MS` | from room settings | Override turn time (tests) |
| `GUEST_PER_MINUTE` | 10 | Guest creation rate limit per IP |
| `ALLOWED_ORIGINS` | empty | Comma-separated extra origins allowed to open sockets (production) |
| `TRUST_PROXY` | 1 in production, else 0 | Proxy hops to trust for client IPs |
| `STATIC_DIR` | `apps/web/dist` | Built client to serve |

`GET /api/health` returns room counts and counters (guests, rooms, games, rounds, quick matches).

## Deploy

### Option A: Render only (simplest)

Render runs the Docker image, which serves the web app, the API and the sockets from one URL.

1. Render dashboard: **New > Blueprint**, pick this repository. Render reads `render.yaml`.
2. Leave `ALLOWED_ORIGINS` empty. Apply. The first build takes a few minutes.
3. Open `https://chicken-slave.onrender.com` (or the URL Render shows).

The free plan sleeps after 15 minutes without traffic; the first visit after that takes about a minute.

### Option B: Vercel (web) + Render (game server)

1. Deploy Render as in option A and note its URL.
2. In `vercel.json`, set the `/api` rewrite destination to that Render URL.
3. Vercel: **Add New > Project**, import this repository and pick the **web** (Vite) project, root `apps/web`. Settings come from `apps/web/vercel.json`. (Importing the repository root uses the root `vercel.json` instead; both point `/api` at Render.)
4. Vercel environment variable: `VITE_SOCKET_URL=https://<your-render-url>`. Deploy.
5. Render environment: `ALLOWED_ORIGINS=https://<your-vercel-domain>,https://<project>-*.vercel.app` (the second entry covers preview deployments) and `TRUST_PROXY=2`. Redeploy.

`/api` goes through Vercel so the guest cookie stays first-party; the socket connects straight to Render with the guest token, because Vercel cannot proxy WebSockets.

### Scaling

Room state lives in memory, so run **one instance**. To scale out later: snapshot rooms to Redis, add the socket.io Redis adapter, and route each room code to one instance (sticky sessions).

## Security

- The server validates every move with the engine. Clients never receive other hands, only card counts.
- Shuffles use `crypto.randomInt` (Fisher–Yates).
- Every socket payload is validated with zod. Socket events, chat, and guest creation are rate limited.
- Names and chat are sanitized and filtered for profanity.
- Each action carries the state `version` it was based on; stale or duplicate actions are rejected.
