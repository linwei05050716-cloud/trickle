// server.js — Trickle: pay-per-second streaming nanopayments on Arc.
// Zero dependencies — Node built-ins only (http, fs). Live updates via SSE.
import { createServer } from "http";
import { readFile } from "fs/promises";
import { fileURLToPath } from "url";
import { dirname, join, extname, normalize } from "path";

import { makeGateway, MICRO } from "./settlement.js";
import { BillingEngine } from "./billing.js";
import { ViewerAgent } from "./agent.js";
import { Audience } from "./audience.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PUBLIC = __dirname;
const PORT = process.env.PORT || 4021;

const gateway = makeGateway();
const engine = new BillingEngine(gateway, { tickMs: 1000, batchEverySec: 5 });

const STREAM_ID = "live-jazz";
engine.createStream({
  id: STREAM_ID,
  title: "Late Night Jazz — live set",
  ratePerSecMicro: 1000, // $0.001 / second  ($3.60/hr, billed by the second)
  splits: [
    { to: "wallet_artist", label: "Artist (lead)", weight: 70 },
    { to: "wallet_band", label: "Backing band", weight: 20 },
    { to: "wallet_host", label: "Venue / host", weight: 10 },
  ],
});
engine.start();

// ambient simulated audience (real sessions; on by default for lively demos)
const audience = new Audience(engine, STREAM_ID, { target: 6 });
if ((process.env.TRICKLE_AUDIENCE || "on").toLowerCase() !== "off") audience.start();

const agents = new Map();

// ---- tiny helpers ----
const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
};
function send(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, { "content-type": "application/json; charset=utf-8" });
  res.end(body);
}
function readBody(req) {
  return new Promise((resolve) => {
    let data = "";
    req.on("data", (c) => (data += c));
    req.on("end", () => {
      try {
        resolve(data ? JSON.parse(data) : {});
      } catch {
        resolve({});
      }
    });
  });
}

// SSE clients
const sseClients = new Set();
engine.onUpdate((snap) => {
  const agentViews = [...agents.values()].map((a) => a.view());
  const payload = JSON.stringify({
    type: "tick",
    snap,
    agents: agentViews,
    receipts: (gateway.receipts || []).slice(-8).reverse(),
  });
  for (const res of sseClients) res.write(`data: ${payload}\n\n`);
});

async function serveStatic(req, res, urlPath) {
  let rel = urlPath === "/" ? "/index.html" : urlPath;
  const filePath = normalize(join(PUBLIC, rel));
  if (!filePath.startsWith(PUBLIC)) return send(res, 403, { error: "forbidden" });
  try {
    const buf = await readFile(filePath);
    res.writeHead(200, { "content-type": MIME[extname(filePath)] || "application/octet-stream" });
    res.end(buf);
  } catch {
    send(res, 404, { error: "not found" });
  }
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const p = url.pathname;
  const m = req.method;

  // ---- API ----
  if (p === "/api/config" && m === "GET")
    return send(res, 200, { settlementMode: gateway.mode, micro: MICRO, streamId: STREAM_ID });

  if (p === "/api/state" && m === "GET") return send(res, 200, engine.snapshot());

  if (p === "/api/receipts" && m === "GET")
    return send(res, 200, (gateway.receipts || []).slice(-40).reverse());

  if (p === "/api/events" && m === "GET") {
    res.writeHead(200, {
      "content-type": "text/event-stream",
      "cache-control": "no-cache",
      connection: "keep-alive",
    });
    res.write(`data: ${JSON.stringify({ type: "tick", snap: engine.snapshot(), agents: [], receipts: [] })}\n\n`);
    sseClients.add(res);
    req.on("close", () => sseClients.delete(res));
    return;
  }

  // x402-style watch: open a continuous-authorization session
  let mm;
  if ((mm = p.match(/^\/api\/streams\/([^/]+)\/watch$/)) && m === "POST") {
    const stream = engine.getStream(mm[1]);
    if (!stream) return send(res, 404, { error: "no such stream" });
    const b = await readBody(req);
    const rateUSDC = Number(b.rateUSDC ?? 0.001);
    const budgetUSDC = Number(b.budgetUSDC ?? 0.25);
    const viewer = String(b.viewer || "viewer_" + Math.random().toString(36).slice(2, 8));
    if (!(rateUSDC > 0) || !(budgetUSDC > 0))
      return send(res, 400, { error: "rate and budget must be positive" });
    const session = engine.openSession({
      streamId: mm[1],
      viewer,
      rateMicro: Math.round(rateUSDC * MICRO),
      budgetMicro: Math.round(budgetUSDC * MICRO),
    });
    return send(res, 200, {
      ok: true,
      sessionId: session.id,
      viewer,
      paymentRequired: { code: 402, ratePerSecUSDC: stream.ratePerSecMicro / MICRO },
    });
  }

  if ((mm = p.match(/^\/api\/streams\/([^/]+)\/flow$/)) && m === "POST") {
    const b = await readBody(req);
    const st = engine.setFlowHealthy(mm[1], Boolean(b.healthy));
    if (!st) return send(res, 404, { error: "no such stream" });
    return send(res, 200, { id: st.id, flowHealthy: st.flowHealthy });
  }

  if ((mm = p.match(/^\/api\/sessions\/([^/]+)$/)) && m === "GET") {
    const v = engine.sessionView(mm[1]);
    if (!v) return send(res, 404, { error: "no such session" });
    return send(res, 200, v);
  }
  if ((mm = p.match(/^\/api\/sessions\/([^/]+)\/pause$/)) && m === "POST") {
    const b = await readBody(req);
    const s = engine.pauseSession(mm[1], Boolean(b.paused));
    if (!s) return send(res, 404, { error: "no such session" });
    return send(res, 200, engine.sessionView(mm[1]));
  }
  if ((mm = p.match(/^\/api\/sessions\/([^/]+)\/leave$/)) && m === "POST") {
    const s = engine.closeSession(mm[1]);
    if (!s) return send(res, 404, { error: "no such session" });
    return send(res, 200, engine.sessionView(mm[1]));
  }

  if (p === "/api/agents" && m === "POST") {
    const b = await readBody(req);
    const id = "agent_" + Math.random().toString(36).slice(2, 7);
    const agent = new ViewerAgent({
      id,
      engine,
      streamId: b.streamId || STREAM_ID,
      budgetMicro: Math.round(Number(b.budgetUSDC ?? 0.1) * MICRO),
      maxRateMicro: Math.round(Number(b.maxRateUSDC ?? 0.0015) * MICRO),
    });
    agent.start();
    agents.set(id, agent);
    return send(res, 200, { ok: true, id, view: agent.view() });
  }
  if (p === "/api/agents" && m === "GET")
    return send(res, 200, [...agents.values()].map((a) => a.view()));
  if ((mm = p.match(/^\/api\/agents\/([^/]+)\/stop$/)) && m === "POST") {
    const a = agents.get(mm[1]);
    if (!a) return send(res, 404, { error: "no such agent" });
    a.stop("manual");
    agents.delete(mm[1]);
    return send(res, 200, { ok: true });
  }

  if (p === "/api/audience" && m === "POST") {
    const b = await readBody(req);
    if (b.on === false) audience.stop();
    else audience.start();
    return send(res, 200, { ok: true, on: b.on !== false });
  }

  // ---- static ----
  if (m === "GET") return serveStatic(req, res, p);
  send(res, 405, { error: "method not allowed" });
});

server.listen(PORT, () => {
  console.log(`Trickle running on http://localhost:${PORT}  (settlement: ${gateway.mode})`);
  console.log(`  viewer page:  http://localhost:${PORT}/`);
  console.log(`  creator page: http://localhost:${PORT}/creator.html`);
});

export { server, engine, gateway };
