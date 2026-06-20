// audience.js
// A simulated ambient audience for demos: real paying sessions that join and
// leave the stream over time, so the creator dashboard shows live viewer churn
// and continuous settlement on camera. These are genuine sessions through the
// billing engine (not faked numbers) — they just have a synthetic arrival/
// departure pattern. Toggle with TRICKLE_AUDIENCE=off.

const NAMES = [
  "ava", "kenji", "noor", "diego", "mei", "sam", "lina", "omar",
  "yuki", "tariq", "rosa", "finn", "ines", "kwame", "vera", "luca",
];

export class Audience {
  constructor(engine, streamId, { target = 6 } = {}) {
    this.engine = engine;
    this.streamId = streamId;
    this.target = target;     // roughly how many concurrent ambient viewers
    this.sessions = new Map(); // sessionId -> {leaveAt}
    this._timer = null;
  }

  start() {
    if (this._timer) return;
    this._timer = setInterval(() => this._step(), 1500);
  }

  stop() {
    clearInterval(this._timer);
    this._timer = null;
    for (const sid of this.sessions.keys()) this.engine.closeSession(sid);
    this.sessions.clear();
  }

  _step() {
    const now = Date.now();
    // departures
    for (const [sid, meta] of this.sessions) {
      if (now >= meta.leaveAt) {
        this.engine.closeSession(sid);
        this.sessions.delete(sid);
      }
    }
    // arrivals — drift toward target with a little randomness
    const deficit = this.target - this.sessions.size;
    const arrivals = deficit > 0 && Math.random() < 0.7 ? 1 + (Math.random() < 0.3 ? 1 : 0) : 0;
    for (let i = 0; i < arrivals; i++) {
      const viewer =
        NAMES[(Math.random() * NAMES.length) | 0] +
        "_" + Math.random().toString(36).slice(2, 5);
      const rateUSDC = [0.0008, 0.001, 0.0012, 0.0015][(Math.random() * 4) | 0];
      const budgetUSDC = 0.05 + Math.random() * 0.25;
      const s = this.engine.openSession({
        streamId: this.streamId,
        viewer,
        rateMicro: Math.round(rateUSDC * 1e6),
        budgetMicro: Math.round(budgetUSDC * 1e6),
      });
      // stay 8–40 seconds
      this.sessions.set(s.id, { leaveAt: now + (8 + Math.random() * 32) * 1000 });
    }
  }
}
