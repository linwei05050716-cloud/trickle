// billing.js
// The per-second metering engine.
//
// Model:
//   - A Stream has a per-second rate (in micro-USDC) and a revenue split.
//   - A Viewer opens a Session against a Stream with an approved spending RATE
//     and a BUDGET cap (continuous authorization, not a fixed price).
//   - Every tick (1s) each active session accrues `rate` micro-USDC, but only
//     while proof-of-flow is healthy (the stream is actually delivering).
//   - Accrued micro-payments are flushed to the settlement Gateway in batches
//     (default every 5s) and split live across the stream's recipients.
//   - A viewer can pause/leave at any second; they pay for exactly the seconds
//     they were present and receiving.

import { MICRO, splitToAmounts } from "./settlement.js";

export class BillingEngine {
  constructor(gateway, { tickMs = 1000, batchEverySec = 5 } = {}) {
    this.gateway = gateway;
    this.tickMs = tickMs;
    this.batchEverySec = batchEverySec;
    this.streams = new Map();   // streamId -> stream
    this.sessions = new Map();  // sessionId -> session
    this.tickCount = 0;
    this.listeners = new Set(); // for server-sent updates
    this._timer = null;
  }

  // ---- streams ----
  createStream({ id, title, ratePerSecMicro, splits, live = true }) {
    const stream = {
      id,
      title,
      ratePerSecMicro,
      splits, // [{ to, label, weight }]
      live,
      flowHealthy: true,     // proof-of-flow; if false, meters pause
      createdAt: Date.now(),
      accruedMicro: 0,       // pending (un-settled) this stream has earned
      earnedMicro: 0,        // lifetime settled
      seconds: 0,            // total viewer-seconds delivered
    };
    this.streams.set(id, stream);
    return stream;
  }

  getStream(id) {
    return this.streams.get(id);
  }

  viewersOf(streamId) {
    return [...this.sessions.values()].filter(
      (s) => s.streamId === streamId && s.active
    );
  }

  // ---- sessions ----
  openSession({ streamId, viewer, rateMicro, budgetMicro }) {
    const stream = this.streams.get(streamId);
    if (!stream) throw new Error("no such stream");
    const id = "sess_" + Math.random().toString(36).slice(2, 10);
    const session = {
      id,
      streamId,
      viewer,                       // payer id / wallet
      approvedRateMicro: rateMicro, // max the viewer will pay per second
      budgetMicro,                  // hard cap; session auto-stops at 0
      spentMicro: 0,
      remainingMicro: budgetMicro,
      seconds: 0,
      active: true,
      paused: false,
      openedAt: Date.now(),
      pendingMicro: 0,              // accrued but not yet settled for this session
    };
    this.sessions.set(id, session);
    return session;
  }

  pauseSession(id, paused) {
    const s = this.sessions.get(id);
    if (s) s.paused = paused;
    return s;
  }

  closeSession(id) {
    const s = this.sessions.get(id);
    if (s) {
      s.active = false;
      s.closedAt = Date.now();
    }
    return s;
  }

  setFlowHealthy(streamId, healthy) {
    const st = this.streams.get(streamId);
    if (st) st.flowHealthy = healthy;
    return st;
  }

  // The effective per-second charge for a session = min(viewer rate, stream rate).
  effectiveRate(session, stream) {
    return Math.min(session.approvedRateMicro, stream.ratePerSecMicro);
  }

  // ---- the heartbeat ----
  start() {
    if (this._timer) return;
    this._timer = setInterval(() => this._tick(), this.tickMs);
  }

  stop() {
    clearInterval(this._timer);
    this._timer = null;
  }

  _tick() {
    this.tickCount++;
    for (const session of this.sessions.values()) {
      if (!session.active || session.paused) continue;
      const stream = this.streams.get(session.streamId);
      if (!stream || !stream.live) continue;
      // proof-of-flow: if the stream isn't delivering, the meter pauses and the
      // viewer is not charged. This is the "pause the meter the instant delivery
      // drops" guarantee.
      if (!stream.flowHealthy) continue;

      const rate = this.effectiveRate(session, stream);
      const charge = Math.min(rate, session.remainingMicro);
      if (charge <= 0) {
        // budget exhausted -> auto-close
        session.active = false;
        session.closedAt = Date.now();
        continue;
      }
      session.spentMicro += charge;
      session.remainingMicro -= charge;
      session.pendingMicro += charge;
      session.seconds += 1;
      stream.accruedMicro += charge;
      stream.seconds += 1;
    }

    // flush settled batches on the batch cadence
    if (this.tickCount % this.batchEverySec === 0) {
      this._flush();
    }
    this._emit();
  }

  async _flush() {
    for (const session of this.sessions.values()) {
      if (session.pendingMicro <= 0) continue;
      const stream = this.streams.get(session.streamId);
      if (!stream) continue;
      const amount = session.pendingMicro;
      session.pendingMicro = 0;
      stream.accruedMicro -= amount;
      stream.earnedMicro += amount;
      try {
        await this.gateway.settleBatch({
          from: session.viewer,
          amountMicro: amount,
          splits: stream.splits,
        });
      } catch (e) {
        // on failure, roll the amount back into pending to retry next batch
        session.pendingMicro += amount;
        stream.earnedMicro -= amount;
        stream.accruedMicro += amount;
        // eslint-disable-next-line no-console
        console.error("settle failed, will retry:", e.message);
      }
    }
  }

  // ---- snapshots for the UI ----
  onUpdate(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  _emit() {
    const snap = this.snapshot();
    for (const fn of this.listeners) fn(snap);
  }

  snapshot() {
    const streams = [...this.streams.values()].map((st) => {
      const viewers = this.viewersOf(st.id);
      return {
        id: st.id,
        title: st.title,
        live: st.live,
        flowHealthy: st.flowHealthy,
        ratePerSecMicro: st.ratePerSecMicro,
        ratePerSecUSDC: st.ratePerSecMicro / MICRO,
        viewers: viewers.length,
        earnedMicro: st.earnedMicro,
        accruedMicro: st.accruedMicro,
        seconds: st.seconds,
        splits: st.splits,
        // live split breakdown of what's been earned so far
        splitEarned: splitToAmounts(st.splits, st.earnedMicro),
      };
    });
    return {
      ts: Date.now(),
      tick: this.tickCount,
      gateway: this.gateway.stats(),
      streams,
    };
  }

  sessionView(id) {
    const s = this.sessions.get(id);
    if (!s) return null;
    return {
      id: s.id,
      streamId: s.streamId,
      viewer: s.viewer,
      active: s.active,
      paused: s.paused,
      seconds: s.seconds,
      spentMicro: s.spentMicro,
      remainingMicro: s.remainingMicro,
      budgetMicro: s.budgetMicro,
      approvedRateMicro: s.approvedRateMicro,
    };
  }
}

