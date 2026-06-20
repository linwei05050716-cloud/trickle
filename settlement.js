// settlement.js
// Settlement layer for Trickle.
//
// Two implementations behind one interface:
//   - MockGateway:   batches per-second charges and "settles" them locally,
//                    mimicking the shape of Circle Gateway nanopayments so the
//                    whole app runs with zero external dependencies (great for
//                    the demo video and local dev).
//   - CircleGateway: real settlement on Arc via Circle's Gateway / Agent Stack.
//                    Wired to the @circle-fin/cli + Gateway nanopayments API.
//                    Swapping MockGateway -> CircleGateway is a one-line config
//                    change in server.js once CIRCLE_API_KEY is set.
//
// The unit everywhere is "micro-USDC" (1 USDC = 1_000_000 micro). Gateway's
// floor is $0.000001 == 1 micro, which is exactly one tick of this engine.

export const MICRO = 1_000_000; // micro-USDC per 1 USDC

export function fmtUSDC(micro) {
  return `$${(micro / MICRO).toFixed(6)}`;
}

// Split a micro-USDC amount across weighted recipients, reconciling the
// rounding remainder onto the last recipient so totals match to the micro.
export function splitToAmounts(splits, amountMicro) {
  const totalWeight = splits.reduce((a, s) => a + s.weight, 0) || 1;
  let allocated = 0;
  return splits.map((s, i) => {
    const isLast = i === splits.length - 1;
    const amt = isLast
      ? amountMicro - allocated
      : Math.floor((amountMicro * s.weight) / totalWeight);
    allocated += amt;
    return { to: s.to, label: s.label, amountMicro: amt };
  });
}

// ---- A single settled batch, recorded for the dashboard + audit trail ----
function makeReceipt({ from, splits, amountMicro, mode, txHash }) {
  return {
    id: "rcpt_" + Math.random().toString(36).slice(2, 10),
    ts: Date.now(),
    mode,                       // "mock" | "arc"
    from,                       // payer (viewer) wallet/id
    amountMicro,                // total settled this batch
    splits,                     // [{ to, label, amountMicro }]
    txHash,                     // on-chain tx (real) or simulated hash (mock)
  };
}

function fakeHash() {
  const hex = "0123456789abcdef";
  let s = "0x";
  for (let i = 0; i < 64; i++) s += hex[(Math.random() * 16) | 0];
  return s;
}

// -------------------------------------------------------------------------
// MockGateway — local, dependency-free, mimics Gateway batching semantics.
// -------------------------------------------------------------------------
export class MockGateway {
  constructor() {
    this.mode = "mock";
    this.receipts = [];
    this.totalSettledMicro = 0;
    this.balances = new Map(); // wallet/id -> micro-USDC received
  }

  // Settle one batch of accrued micro-payments, split across recipients.
  // splits: [{ to, label, weight }]  weights are relative (summed & normalized).
  async settleBatch({ from, amountMicro, splits }) {
    const resolved = splitToAmounts(splits, amountMicro);
    for (const r of resolved) {
      this.balances.set(r.to, (this.balances.get(r.to) || 0) + r.amountMicro);
    }

    this.totalSettledMicro += amountMicro;
    const receipt = makeReceipt({
      from,
      splits: resolved,
      amountMicro,
      mode: this.mode,
      txHash: fakeHash(),
    });
    this.receipts.push(receipt);
    if (this.receipts.length > 500) this.receipts.shift();
    return receipt;
  }

  stats() {
    return {
      mode: this.mode,
      totalSettledMicro: this.totalSettledMicro,
      batches: this.receipts.length,
      balances: Object.fromEntries(this.balances),
    };
  }
}

// -------------------------------------------------------------------------
// CircleGateway — real settlement on Arc.
//
// Targets Circle's Gateway nanopayments model: the payer signs payment
// authorizations OFFCHAIN (no broadcast, no gas) using @circle-fin/x402-batching;
// Gateway aggregates many signed authorizations and settles net positions in
// bulk onchain. That batching is what makes sub-cent ($0.000001) x402 payments
// economically viable.
//
// In Trickle, each per-second charge is one signed authorization. We accumulate
// them and submit a batch to Gateway settlement on the batch cadence. The method
// signature matches MockGateway exactly, so server.js / billing.js are unchanged.
//
// To go live:
//   1) npm i -g @circle-fin/cli   (RPC + Arc context: uv tool install ARC-cli)
//   2) npm i @circle-fin/x402-batching   (offchain authorization signing)
//   3) create an agent wallet:   circle wallet create
//   4) export CIRCLE_API_KEY / TRICKLE_SETTLEMENT=arc
// -------------------------------------------------------------------------
export class CircleGateway {
  constructor({ apiKey, gatewayUrl, fetchImpl, signer } = {}) {
    this.mode = "arc";
    this.apiKey = apiKey || process.env.CIRCLE_API_KEY;
    this.gatewayUrl =
      gatewayUrl ||
      process.env.CIRCLE_GATEWAY_URL ||
      "https://api.circle.com/v1/w3s/gateway";
    this.fetch = fetchImpl || globalThis.fetch;
    // signer: a @circle-fin/x402-batching authorization signer for the payer
    // wallet. Injected so this stays testable; wired from the Circle CLI wallet.
    this.signer = signer;
    this.receipts = [];
    this.totalSettledMicro = 0;
    this.balances = new Map();
    if (!this.apiKey) {
      throw new Error(
        "CircleGateway requires CIRCLE_API_KEY. Set TRICKLE_SETTLEMENT=mock for local dev."
      );
    }
  }

  // Produce one offchain-signed authorization per recipient (no gas, no broadcast).
  async _authorize(from, transfers) {
    if (!this.signer) {
      // Without a configured signer we cannot sign real authorizations.
      throw new Error(
        "CircleGateway needs an @circle-fin/x402-batching signer for the payer wallet."
      );
    }
    // signer.signTransfer returns an EIP-712 style signed authorization object.
    return Promise.all(
      transfers.map((t) =>
        this.signer.signTransfer({
          from,
          to: t.to,
          amountMicro: t.amountMicro,
          currency: "USDC",
          blockchain: "ARC-SEPOLIA",
        })
      )
    );
  }

  async settleBatch({ from, amountMicro, splits }) {
    // resolve the split into concrete micro amounts (reconciling to the micro)
    const transfers = splitToAmounts(splits, amountMicro);
    const authorizations = await this._authorize(from, transfers);

    // submit the signed authorizations; Gateway batches + nets them onchain.
    const res = await this.fetch(`${this.gatewayUrl}/nanopayments/batch`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        blockchain: "ARC-SEPOLIA",
        currency: "USDC",
        authorizations, // offchain-signed, gas-free
      }),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`Gateway settle failed: ${res.status} ${text}`);
    }
    const data = await res.json();

    this.totalSettledMicro += amountMicro;
    const receipt = makeReceipt({
      from,
      splits: transfers,
      amountMicro,
      mode: this.mode,
      txHash: data.txHash || data.batchId || fakeHash(),
    });
    this.receipts.push(receipt);
    return receipt;
  }

  stats() {
    return {
      mode: this.mode,
      totalSettledMicro: this.totalSettledMicro,
      batches: this.receipts.length,
      balances: Object.fromEntries(this.balances),
    };
  }
}

export function makeGateway() {
  const which = (process.env.TRICKLE_SETTLEMENT || "mock").toLowerCase();
  if (which === "arc") return new CircleGateway();
  return new MockGateway();
}
