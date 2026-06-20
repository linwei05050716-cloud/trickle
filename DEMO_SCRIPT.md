# Trickle — 3-minute demo video script

Keep it under 3 minutes (hard cap for the hackathon). Record your screen (QuickTime
on Mac: File → New Screen Recording) with `standalone.html` open in a browser —
no install needed. Talk over it. Times are a guide.

---

### 0:00–0:25 — The problem (hook)
> "For as long as a payment couldn't be smaller than a few cents after fees, live
> content had to be sold as a monthly subscription. You pay $9.99 whether you watch
> one minute or the whole month. The real unit — a second of a live set — was too
> small to sell. Nanopayments remove that floor. This is Trickle: pay-per-second
> streaming, settled on Arc in USDC."

*(On screen: the Trickle page, the LIVE jazz stage, ambient viewers ticking.)*

### 0:25–1:05 — Watch and pay by the second
- Click **Start watching**.
- Point at the big meter ticking up every second.
> "I approve a spending rate — a tenth of a cent per second — and a budget cap, not a
> fixed price. USDC streams to the artist one second at a time. Look at the
> Subscription vs. pay-per-second card: I've paid a tiny fraction of a monthly sub,
> for exactly the seconds I watched."
- Click **Pause**, then **Resume**, then **Leave**.
> "Leave at any second and I've paid for exactly the time I was present. Not a minute more."

### 1:05–1:45 — The creator side + live splits
- Move to the Creator dashboard (right side).
> "The creator sees revenue accrue in real time across a live audience. Every second
> is split automatically — 70% to the lead artist, 20% to the band, 10% to the venue —
> and settled through Circle Gateway nanopayments, which batch thousands of sub-cent
> payments into one gas-free settlement on Arc. Here's the live receipts feed, each
> with its settlement hash."

### 1:45–2:15 — Proof-of-flow
- Click **Simulate stream drop**.
> "If the stream drops, every viewer's meter pauses instantly — nobody pays for dead
> air. A proof-of-flow check gates the meter on actual delivery."
- Click **Restore stream**.

### 2:15–2:50 — The agent (agency)
- Click **Spawn agent**.
> "Viewers don't have to be people. This is an autonomous agent with its own wallet and
> budget. Every second it decides whether the stream is still worth its rate — it pauses
> when its valuation drops below the price and resumes when value returns. 'What should
> this cost?' becomes a continuous machine decision, thousands of times an hour."
- Point at the agent log lines showing pause/resume decisions.

### 2:50–3:00 — Close
> "Trickle: the unit of a live performance is the second, so the unit of paying for it
> should be too. Built on Arc, with Circle Gateway, x402, and USDC. Thanks for watching."

---

## Recording checklist
- [ ] Browser zoom ~100–110%, window clean (no bookmarks bar clutter).
- [ ] Let the page run ~15s before recording so the audience + receipts are populated.
- [ ] Do one practice run; the live meter makes the pacing obvious.
- [ ] Upload to Loom / YouTube (unlisted) / Vimeo. Keep it **under 3:00**.
- [ ] Put the link in the submission form's "video demo" field.
