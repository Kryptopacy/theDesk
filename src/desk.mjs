// The Desk: an AI-run execution & risk desk. Customers pipe trade intents to the HTTP
// API; each customer trades under their own risk envelope (whitelist, per-order cap,
// daily loss cap); the desk executes through the broker surface (MockBroker now, the
// Agent OS MCP adapter once connected), charges a per-fill fee, and accrues its own
// running costs. Revenue vs. costs is the "company of one" line: the agent pays its
// bills from the fees it earns.
//
// DEMO MODE: customers here use simulated floats (MockBroker each). In production every
// customer brings their own Binance account via Agent OS (keyless, scoped, revocable)
// and the same envelope code gates their live fills.
// Run: node src/desk.mjs  (then curl, see docs/PLAN.md)
import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { AuditLog } from "./audit.mjs";
import { MockBroker } from "./broker.mjs";
import { PaperBroker } from "./paperbroker.mjs";
import { checkIntent } from "./envelope.mjs";
import { guardPosition } from "./riskguard.mjs";

const FOUNDER_KEY = process.env.DESK_FOUNDER_KEY ?? "founder-demo-key";
const HOSTING_USDT_PER_HR = 0.005;   // DEMO rates — real bills once infra is chosen
const LLM_USDT_PER_DECISION = 0.001;
const PORT = process.env.PORT ?? 8787;

const audit = new AuditLog(process.env.DESK_AUDIT ?? "audit/desk.jsonl");
const startedAt = Date.now();
let decisions = 0;
const feed = [];

// Live plumbing: SSE clients get a fresh snapshot the instant anything happens;
// series keeps a revenue/costs sample every 15s for the dashboard sparkline.
const sse = new Set();
const series = [];
let lastSample = 0;

function snapshot() {
  const now = Date.now();
  if (now - lastSample >= 15000) {
    lastSample = now;
    series.push({ t: now, revenue: +totalRevenue().toFixed(4), costs: +settleCosts().toFixed(4) });
    if (series.length > 240) series.shift();
  }
  const costs = settleCosts();
  const list = [...customers.values()];
  return {
    mode: "DEMO",
    execution_note: "live customers use simulated floats until the Agent OS MCP adapter is wired; paper customers fill at real prices with adverse slippage",
    uptime_hours: +((now - startedAt) / 3_600_000).toFixed(2),
    funnel: { paper: list.filter((c) => c.mode === "paper").length, live: list.filter((c) => c.mode === "live").length },
    customers: list.map((c) => ({
      name: c.name, mode: c.mode, fee_model: c.mode === "live" ? "per_fill_bps" : "free_paper",
      active: c.active, paper_expires_at: c.paperExpiresAt, envelope: c.envelope,
      fills: c.fills, clamps: c.clamps, refusals: c.refusals, revenue: +c.revenue.toFixed(4),
      float: c.float, cash: +Number(c.broker.balances?.USDT ?? 0).toFixed(4),
      positions: c.broker.baseBalances ?? {}, day_pnl: +c.dayPnl.toFixed(4),
    })),
    revenue_usdt: +totalRevenue().toFixed(4),
    costs_usdt: +costs.toFixed(4),
    self_funded_pct: +Math.min(100, (totalRevenue() / Math.max(costs, 1e-9)) * 100).toFixed(1),
    series,
    audit: audit.summary(),
    recent: feed.slice(0, 14),
  };
}

function broadcast() {
  if (!sse.size) return;
  const payload = `data: ${JSON.stringify(snapshot())}\n\n`;
  for (const res of sse) { try { res.write(payload); } catch { sse.delete(res); } }
}
setInterval(broadcast, 20000).unref();

const customers = new Map();

export function addCustomer({ name, api_key, symbols, max_order_notional, daily_loss_cap, fee_bps = 25, float = 10, mode = "paper", expires_in_days = 7, stop_loss_pct = null, take_profit_pct = null, max_drawdown_pct = null, broker_opts = {} }) {
  const c = {
    name, api_key, active: true, mode,
    paperExpiresAt: mode === "paper" ? Date.now() + expires_in_days * 86_400_000 : null,
    envelope: { symbols, max_order_notional, daily_loss_cap, fee_bps, stop_loss_pct, take_profit_pct, max_drawdown_pct },
    // paper: live prices, simulated fills. live: MockBroker placeholder until the Agent OS
    // MCP adapter is wired — swap happens once the real tool list is enumerated.
    broker: mode === "paper" ? new PaperBroker({ float, ...broker_opts }) : new MockBroker({ volatility: 0.004, ...broker_opts }),
    float, revenue: 0, dayPnl: 0, fills: 0, clamps: 0, refusals: 0, entries: {},
  };
  customers.set(name, c);
  audit.append("CUSTOMER_ONBOARDED", { name, mode, envelope: c.envelope, float, paper_expires_at: c.paperExpiresAt });
  return c;
}

function settleCosts() {
  const hours = (Date.now() - startedAt) / 3_600_000;
  return hours * HOSTING_USDT_PER_HR + decisions * LLM_USDT_PER_DECISION;
}

const totalRevenue = () => [...customers.values()].reduce((s, c) => s + c.revenue, 0);

// Per-symbol position bookkeeping: entries feed the guard sweep (layer 2) and realized day P&L.
function recordFill(c, symbol, side, filledNotional, price) {
  const baseQty = filledNotional / price;
  if (side === "buy") {
    const prev = c.entries[symbol] ?? { qty: 0, avgEntry: 0 };
    c.entries[symbol] = { qty: prev.qty + baseQty, avgEntry: (prev.avgEntry * prev.qty + price * baseQty) / (prev.qty + baseQty) };
  } else {
    const prev = c.entries[symbol];
    if (!prev) return;
    c.dayPnl += filledNotional - baseQty * prev.avgEntry;
    prev.qty -= baseQty;
    if (prev.qty * price < 0.01) delete c.entries[symbol];
  }
}

async function execute(c, intent, notional, clamped) {
  decisions += 1;
  const fill = await c.broker.marketOrder(intent.symbol, intent.side.toUpperCase(), notional);
  if (!fill.ok) {
    c.refusals += 1;
    audit.append("FILL_FAILED", { customer: c.name, intent, error: fill.error });
    return { status: 409, body: { ok: false, error: fill.error } };
  }
  const fee = c.mode === "live" ? (notional * c.envelope.fee_bps) / 10_000 : 0; // paper is free; live pays per fill
  c.revenue += fee;
  c.fills += 1;
  const filledNotional = fill.quoteQty ?? notional;
  recordFill(c, intent.symbol, intent.side, filledNotional, fill.price);
  const event = audit.append("FILL", {
    customer: c.name, mode: c.mode, symbol: intent.symbol, side: intent.side, notional: filledNotional, price: fill.price,
    clamped, fee, fee_bps: c.envelope.fee_bps, simulated: !!fill.simulated, revenue: c.revenue,
  });
  feed.unshift({ seq: event.seq, ts: event.ts, customer: c.name, mode: c.mode, ...intent, notional: filledNotional, clamped, fee, outcome: "FILLED" });
  broadcast();
  return { status: 200, body: { ok: true, mode: c.mode, executed_notional: notional, clamped, fee_charged: fee, price: fill.price, simulated: !!fill.simulated } };
}

function refuse(c, intent, v) {
  decisions += 1;
  c.refusals += 1;
  const event = audit.append("REFUSED", { customer: c.name, intent, detail: v.detail });
  feed.unshift({ seq: event.seq, ts: event.ts, customer: c.name, mode: c.mode, ...intent, outcome: "REFUSED", detail: v.detail });
  broadcast();
  return { status: v.status, body: { ok: false, refused_by: "risk_engine", detail: v.detail } };
}

// Layer 2 on a clock: open positions are re-priced and guarded every sweep, not just when
// an intent happens to arrive. Exits are de-risking, so no cap can block them — the desk
// sells the full position and logs it as a desk-initiated RISK_EXIT on the books.
const GUARD_SWEEP_MS = 10_000;
setInterval(async () => {
  for (const c of customers.values()) {
    if (!c.active) continue;
    for (const [symbol, pos] of Object.entries(c.entries)) {
      const held = c.broker.baseBalances?.[symbol] ?? 0;
      if (!(held > 0)) { delete c.entries[symbol]; continue; }
      let price;
      try { price = (await c.broker.observe(symbol)).price; } catch { continue; }
      const g = guardPosition({ avgEntry: pos.avgEntry, price }, c.envelope);
      if (!g.exit) continue;
      decisions += 1;
      const notional = held * price;
      const fill = await c.broker.marketOrder(symbol, "SELL", notional);
      if (!fill.ok) { audit.append("RISK_EXIT_FAILED", { customer: c.name, symbol, kind: g.kind, error: fill.error }); continue; }
      const filledNotional = fill.quoteQty ?? notional;
      const fee = c.mode === "live" ? (filledNotional * c.envelope.fee_bps) / 10_000 : 0;
      c.revenue += fee;
      c.fills += 1;
      const realized = filledNotional - held * pos.avgEntry;
      c.dayPnl += realized;
      delete c.entries[symbol];
      const event = audit.append("RISK_EXIT", {
        customer: c.name, mode: c.mode, symbol, kind: g.kind, detail: g.detail, drawdown_pct: +g.drawdown_pct.toFixed(2),
        notional: +filledNotional.toFixed(4), price: fill.price, fee, realized_pnl: +realized.toFixed(4), desk_initiated: true,
      });
      feed.unshift({ seq: event.seq, ts: event.ts, customer: c.name, mode: c.mode, symbol, side: "sell", notional: +filledNotional.toFixed(4), fee, outcome: "RISK_EXIT", detail: `${g.kind} — ${g.detail}` });
      broadcast();
    }
  }
}, GUARD_SWEEP_MS).unref();

const ROUTES = {
  "POST /v1/intent": async (body) => {
    const c = [...customers.values()].find((x) => x.api_key === body.api_key);
    if (!c) return { status: 401, body: { ok: false, error: "unknown api key" } };
    if (c.paperExpiresAt && Date.now() > c.paperExpiresAt)
      return { status: 402, body: { ok: false, error: "paper envelope expired — graduate to a live envelope to resume (activation fee applies)" } };
    const intent = { symbol: body.symbol, side: body.side, notional: Number(body.notional), note: body.note ?? null };
    const v = checkIntent(c, intent);
    if (v.ok && v.clamped) c.clamps += 1;
    return v.ok ? execute(c, intent, v.notional, v.clamped) : refuse(c, intent, v);
  },
  "GET /": () => ({ status: 200, raw: true, headers: { "content-type": "text/html" }, body: readFileSync(new URL("../dashboard/index.html", import.meta.url)) }),
  "GET /v1/books": () => ({ status: 200, body: snapshot() }),
  "POST /v1/customers": (body, key) => {
    if (key !== FOUNDER_KEY) return { status: 403, body: { ok: false, error: "founder key required" } };
    const c = addCustomer(body);
    broadcast();
    return { status: 201, body: { ok: true, customer: c.name, envelope: c.envelope } };
  },
  "POST /v1/revoke": (body, key) => {
    if (key !== FOUNDER_KEY) return { status: 403, body: { ok: false, error: "founder key required" } };
    const c = customers.get(body.name);
    if (!c) return { status: 404, body: { ok: false, error: "no such customer" } };
    c.active = false;
    audit.append("CUSTOMER_REVOKED", { name: body.name });
    broadcast();
    return { status: 200, body: { ok: true, revoked: body.name } };
  },
};

// Public books mode: DESK_PUBLIC=1 exposes the dashboard and GET endpoints only — no
// intents, no onboarding, no revocations. This is the mode that gets tunneled or deployed.
const routes = process.env.DESK_PUBLIC === "1"
  ? Object.fromEntries(Object.entries(ROUTES).filter(([k]) => k.startsWith("GET")))
  : ROUTES;

addCustomer({ name: "house-fund", api_key: "house-demo-key", symbols: ["BTCUSDT"], max_order_notional: 5, daily_loss_cap: 2, fee_bps: 0, float: 10, mode: "live", take_profit_pct: 15, max_drawdown_pct: 10 });
addCustomer({ name: "tv-alerts", api_key: "tv-demo-key", symbols: ["BTCUSDT", "ETHUSDT", "PEPEUSDT"], max_order_notional: 5, daily_loss_cap: 3, fee_bps: 30, float: 10, mode: "live", stop_loss_pct: 5, max_drawdown_pct: 10 });
addCustomer({ name: "first-paper", api_key: "paper-demo-key", symbols: ["BTCUSDT", "ETHUSDT"], max_order_notional: 5, daily_loss_cap: 3, float: 10, mode: "paper", take_profit_pct: 15, max_drawdown_pct: 10 });

createServer((req, res) => {
  const chunks = [];
  req.on("data", (ch) => chunks.push(ch));
  req.on("end", async () => {
    const path = (req.url || "/").split("?")[0];
    if (req.method === "GET" && path === "/v1/stream") {
      res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache", connection: "keep-alive", "x-accel-buffering": "no" });
      res.write(`data: ${JSON.stringify(snapshot())}\n\n`);
      sse.add(res);
      const ping = setInterval(() => { try { res.write(": ping\n\n"); } catch {} }, 20000);
      req.on("close", () => { clearInterval(ping); sse.delete(res); });
      return;
    }
    const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString() || "{}") : {};
    const handler = routes[`${req.method} ${path}`];
    let out;
    try {
      out = handler ? await handler(body, req.headers["x-api-key"]) : { status: 404, body: { ok: false, error: "no such route" } };
      res.writeHead(out.status, out.raw ? out.headers : { "content-type": "application/json" });
      res.end(out.raw ? out.body : JSON.stringify(out.body, null, 2));
    } catch (e) {
      console.error("request failed:", e);
      try { res.writeHead(500, { "content-type": "application/json" }); res.end(JSON.stringify({ ok: false, error: String(e.message ?? e) })); } catch {}
    }
  });
}).listen(PORT, () => console.log(`desk listening on http://localhost:${PORT} — books at GET /v1/books`));
