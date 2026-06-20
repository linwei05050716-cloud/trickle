# Trickle

**Pay-per-second streaming payments for live content — settled on Arc in USDC.**
Built for the [Lepton Agents Hackathon](https://lepton.thecanteenapp.com/) · RFB 4 (Streaming & Continuous Payments).

A viewer approves a **spending rate**, not a fixed price. While they watch, USDC
streams to the creator **one second at a time**, batched and settled through Circle
Gateway nanopayments on Arc (floor: $0.000001). Leave at any second and you've paid
for exactly the seconds you were present — not a minute more.

> The unit of a live performance is the second, so the unit of paying for it should be too.

---

## Why this is interesting

For as long as a payment couldn't be smaller than a few cents after fees, "live"
content had to be sold as a monthly subscription or a fixed ticket. Nanopayments
remove the floor: a second of a jazz set or a minute of a VOD becomes individually
sellable. Trickle turns that primitive into a product:

- **Continuous authorization** — approve a rate + budget cap, not a price.
- **Per-second metering** — the meter ticks every second and stops the instant you leave.
- **Live revenue splits** — every second is split across everyone on the stream
  (e.g. lead artist 70% / band 20% / venue 10%), settled as it accrues.
- **Proof-of-flow** — if the stream drops, every viewer's meter pauses immediately.
  Nobody pays for dead air.
- **Autonomous viewer agents** — an AI agent holds a wallet + budget and decides,
  every second, whether the stream is still worth its rate. It pauses when value
  drops and resumes when it returns. (This is the "agent as an economic actor"
  angle: "what should this cost?" becomes a continuous machine decision.)

## How it maps to the judging criteria

| Criterion | Where |
|---|---|
| **Agentic sophistication** | `agent.js` — autonomous viewer agents that make a per-second pay/pause decision against a budget and a live valuation. |
| **Circle tool usage** | `settlement.js` — Gateway nanopayments (batched, gas-free, $0.000001 floor); `x402`-style `402 Payment Required` watch flow in `server.js`. |
| **Traction** | Real sessions accrue and settle continuously; the creator dashboard shows live viewer-seconds, settled USDC, and a receipts feed. |
| **Innovation** | Streaming payments are a noted code gap in the x402 world — per-second continuous authorization with proof-of-flow is new ground. |

---

## Two ways to run it

**A. No install at all — just open a file.**
Open `standalone.html` in any browser (double-click it). The whole thing —
viewer meter, creator dashboard, live splits, ambient audience, autonomous agent —
runs client-side with an in-memory engine. Perfect for a quick look or the demo video,
and it's the page you can host as a live link (e.g. GitHub Pages).

**B. The full app with a backend (settles real USDC on Arc when configured).**
```bash
node server.js
# Viewer page:  http://localhost:4021/
# Creator page: http://localhost:4021/creator.html
```
No `npm install` needed — the server uses only Node built-ins (Node 18+).

Open the **viewer page**, click **Start watching**, and watch the meter tick up by
the second. Open the **creator dashboard** in a second tab to see revenue accrue,
the live split, and settled-batch receipts. Hit **Simulate stream drop** on the
dashboard to see every meter pause. Click **Spawn agent** to add an autonomous
paying viewer.

## Architecture

```
server.js          HTTP + SSE, REST API, x402-style watch flow
billing.js     per-second metering engine (sessions, accrual, batching, splits, proof-of-flow)
settlement.js  MockGateway (local) + CircleGateway (real Arc settlement) behind one interface
agent.js       autonomous viewer agent (per-second economic decision)
index.html  viewer page (the live meter)
creator.html creator dashboard (revenue, split, receipts)
```

Everything is denominated in **micro-USDC** (1 USDC = 1,000,000 micro). One tick =
one second = as little as 1 micro, which is exactly Gateway's floor.

## Going live on Arc

The settlement layer is swappable behind one interface. To settle real test USDC
on Arc instead of locally:

```bash
# 1. install the CLIs
uv tool install git+https://github.com/the-canteen-dev/ARC-cli
npm install -g @circle-fin/cli

# 2. create a Circle developer account + API key:  https://developers.circle.com
#    create an agent wallet:  circle wallet create

# 3. point Trickle at Circle Gateway
cp .env.example .env       # set CIRCLE_API_KEY and TRICKLE_SETTLEMENT=arc
node server.js
```

`server.js` is unchanged — `makeGateway()` returns `CircleGateway` instead of
`MockGateway`, and the same `settleBatch()` calls now batch real USDC transfers on
Arc. See `settlement.js` (`CircleGateway`) for the Gateway request shape.

## API (for agents and integrations)

| Method | Path | Purpose |
|---|---|---|
| `POST` | `/api/streams/:id/watch` | Open a paid session (`{rateUSDC, budgetUSDC}`) — x402-style |
| `GET` | `/api/sessions/:sid` | Session meter (spent, remaining, seconds) |
| `POST` | `/api/sessions/:sid/pause` | Pause/resume the meter |
| `POST` | `/api/sessions/:sid/leave` | Stop and finalize |
| `POST` | `/api/streams/:id/flow` | Proof-of-flow toggle (`{healthy}`) |
| `POST` | `/api/agents` | Spawn an autonomous viewer agent |
| `GET` | `/api/state` | Full snapshot (streams, viewers, splits, gateway stats) |
| `GET` | `/api/events` | Server-sent events: a fresh snapshot every second |

## License

MIT
