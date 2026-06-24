# Go live on Arc — real testnet USDC settlement

Trickle runs on a **mock** settlement layer by default. This guide switches it to
**real Circle Gateway nanopayments on the Arc testnet**. Everything below runs on YOUR
machine (it needs internet + the Circle CLI). Copy-paste the commands in order.

> Your API key stays in a local `.env` file. Never commit it or share it.

## 0. Prerequisites
- Node.js v20.18.2+  (`node -v`)
- A Circle developer account + a **Testnet** API key (Console → Keys → API Key).
  You already created this.

## 1. Get the code
```bash
git clone https://github.com/linwei05050716-cloud/trickle
cd trickle
```

## 2. Install the CLIs
```bash
# Circle CLI: agent wallets, x402 payments, USDC transfers
npm install -g @circle-fin/cli
# Offchain payment-authorization signing for batched nanopayments
npm install @circle-fin/x402-batching
# (optional) Arc CLI: Canteen-hosted Arc testnet RPC + Arc docs as agent context
uv tool install git+https://github.com/the-canteen-dev/ARC-cli
```

## 3. Create an agent wallet + fund it with test USDC
```bash
export CIRCLE_API_KEY=YOUR_TESTNET_KEY     # paste your key here (this shell only)
circle wallet create --blockchain ARC-SEPOLIA
# note the wallet address it prints, then fund it:
#   Circle Console -> Faucet (龙头) -> paste the address -> get test USDC
```

## 4. Configure Trickle
```bash
cp .env.example .env
```
Edit `.env`:
```
TRICKLE_SETTLEMENT=arc
CIRCLE_API_KEY=YOUR_TESTNET_KEY
CIRCLE_GATEWAY_URL=https://api.circle.com/v1/w3s/gateway
```

## 5. Run it
```bash
node server.js
# console should print:  Trickle running ... (settlement: arc)
```
Open http://localhost:4021/ , click **Start watching**, and the per-second charges now
settle as **real test USDC** through Circle Gateway on Arc. Watch them land in the
creator dashboard's "Settled batches" feed and in your Circle Console wallet balance.

## How the swap works (no app code changes)
`settlement.js` exposes one interface. `makeGateway()` returns `MockGateway` when
`TRICKLE_SETTLEMENT` is unset, and `CircleGateway` when it's `arc`. The billing engine
calls the same `settleBatch({ from, amountMicro, splits })` either way — so going live is
purely configuration. `CircleGateway` signs each per-second charge as an offchain payment
authorization (`@circle-fin/x402-batching`) and submits them as a batched, gas-free
Gateway nanopayment settlement on Arc.

## Troubleshooting
- `401 Unauthorized` → wrong/expired key, or you used a Mainnet key (use the **Testnet** one).
- `insufficient funds` → fund the agent wallet from the Console Faucet.
- Need help? Ping `@kdrohan` in the Canteen Discord.
