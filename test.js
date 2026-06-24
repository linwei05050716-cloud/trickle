// test.js — unit tests for Trickle's core engine. Run: node --test
import test from "node:test";
import assert from "node:assert/strict";
import { MockGateway, splitToAmounts, MICRO } from "./settlement.js";
import { BillingEngine } from "./billing.js";

function newEngine() {
  const gw = new MockGateway();
  const engine = new BillingEngine(gw, { tickMs: 1000, batchEverySec: 2 });
  engine.createStream({
    id: "s1",
    title: "test",
    ratePerSecMicro: 1000,
    splits: [
      { to: "a", label: "Artist", weight: 70 },
      { to: "b", label: "Band", weight: 20 },
      { to: "h", label: "Host", weight: 10 },
    ],
  });
  return { gw, engine };
}

test("splitToAmounts reconciles exactly to the total (no micros lost)", () => {
  for (const total of [0, 1, 7, 1000, 999, 123457]) {
    const parts = splitToAmounts(
      [
        { to: "a", label: "A", weight: 70 },
        { to: "b", label: "B", weight: 20 },
        { to: "h", label: "H", weight: 10 },
      ],
      total
    );
    const sum = parts.reduce((x, p) => x + p.amountMicro, 0);
    assert.equal(sum, total, `split of ${total} must sum back to ${total}`);
  }
});

test("70/20/10 split is correct on a clean amount", () => {
  const parts = splitToAmounts(
    [
      { to: "a", label: "A", weight: 70 },
      { to: "b", label: "B", weight: 20 },
      { to: "h", label: "H", weight: 10 },
    ],
    1000
  );
  assert.deepEqual(parts.map((p) => p.amountMicro), [700, 200, 100]);
});

test("per-second metering charges the rate each tick", () => {
  const { engine } = newEngine();
  const s = engine.openSession({ streamId: "s1", viewer: "v", rateMicro: 1000, budgetMicro: 10000 });
  engine._tick();
  engine._tick();
  engine._tick();
  const v = engine.sessionView(s.id);
  assert.equal(v.seconds, 3);
  assert.equal(v.spentMicro, 3000);
  assert.equal(v.remainingMicro, 7000);
});

test("budget cap stops the session and never overspends", () => {
  const { engine } = newEngine();
  const s = engine.openSession({ streamId: "s1", viewer: "v", rateMicro: 1000, budgetMicro: 2500 });
  for (let i = 0; i < 10; i++) engine._tick();
  const v = engine.sessionView(s.id);
  assert.ok(v.spentMicro <= 2500, "must never exceed budget");
  assert.equal(v.spentMicro, 2500);
  assert.equal(v.active, false, "session auto-closes at budget");
});

test("effective rate is min(viewer rate, stream rate)", () => {
  const { engine } = newEngine();
  // viewer approves only 600 micro/s though stream asks 1000
  const s = engine.openSession({ streamId: "s1", viewer: "v", rateMicro: 600, budgetMicro: 100000 });
  engine._tick();
  assert.equal(engine.sessionView(s.id).spentMicro, 600);
});

test("proof-of-flow: meter pauses when the stream is not delivering", () => {
  const { engine } = newEngine();
  const s = engine.openSession({ streamId: "s1", viewer: "v", rateMicro: 1000, budgetMicro: 100000 });
  engine._tick(); // healthy -> +1000
  engine.setFlowHealthy("s1", false);
  engine._tick(); // dropped -> no charge
  engine._tick(); // dropped -> no charge
  engine.setFlowHealthy("s1", true);
  engine._tick(); // healthy -> +1000
  assert.equal(engine.sessionView(s.id).spentMicro, 2000);
  assert.equal(engine.sessionView(s.id).seconds, 2);
});

test("paused session does not accrue", () => {
  const { engine } = newEngine();
  const s = engine.openSession({ streamId: "s1", viewer: "v", rateMicro: 1000, budgetMicro: 100000 });
  engine._tick();
  engine.pauseSession(s.id, true);
  engine._tick();
  engine._tick();
  engine.pauseSession(s.id, false);
  engine._tick();
  assert.equal(engine.sessionView(s.id).spentMicro, 2000);
});

test("batched settlement splits earnings across recipients", async () => {
  const { gw, engine } = newEngine();
  engine.openSession({ streamId: "s1", viewer: "v", rateMicro: 1000, budgetMicro: 100000 });
  for (let i = 0; i < 2; i++) engine._tick(); // accrue 2000, batchEverySec=2 -> flush
  await engine._flush();
  const stats = gw.stats();
  assert.ok(stats.totalSettledMicro >= 2000, "settled at least the accrued amount");
  assert.equal(stats.balances.a + stats.balances.b + stats.balances.h, stats.totalSettledMicro);
});

test("MICRO floor equals Gateway's $0.000001 nanopayment unit", () => {
  assert.equal(MICRO, 1_000_000);
  assert.equal(1 / MICRO, 0.000001);
});

test("traction metrics count unique payers and viewer-seconds", () => {
  const { engine } = newEngine();
  engine.openSession({ streamId: "s1", viewer: "alice", rateMicro: 1000, budgetMicro: 100000 });
  engine.openSession({ streamId: "s1", viewer: "bob", rateMicro: 1000, budgetMicro: 100000 });
  engine._tick();
  engine._tick();
  const m = engine.metrics();
  assert.equal(m.uniquePayers, 2);
  assert.equal(m.viewerSeconds, 4); // 2 viewers * 2 seconds
  assert.equal(m.peakConcurrent, 2);
});

test("paused/dropped seconds are not counted as delivered viewer-seconds", () => {
  const { engine } = newEngine();
  engine.openSession({ streamId: "s1", viewer: "x", rateMicro: 1000, budgetMicro: 100000 });
  engine._tick();                       // +1 delivered
  engine.setFlowHealthy("s1", false);
  engine._tick();                       // dropped -> not delivered
  const m = engine.metrics();
  assert.equal(m.viewerSeconds, 1);
});
