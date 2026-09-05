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

const FOUNDER_KEY = process.env.DESK_FOUNDER_KEY ?? "founder-demo-key";
const HOSTING_USDT_PER_HR = 0.005;   // DEMO rates — real bills once infra is chosen
const LLM_USDT_PER_DECISION = 0.001;
const PORT = process.env.PORT ?? 8787;

const audit = new AuditLog("audit/desk.jsonl");
const startedAt = Date.now();
let decisions = 0;
const feed = [];

const customers = new Map();

export function addCustomer({ name, api_key, symbols, max_order_notional, daily_loss_cap, fee_bps = 25, float = 10, mode = "paper", expires_in_days = 7 }) {
  const c = {
    name, api_key, active: true, mode,
    paperExpiresAt: mode === "paper" ? Date.now() + expires_in_days * 86_400_000 : null,
    envelope: { symbols, max_order_notional, daily_loss_cap, fee_bps },
    // paper: live prices, simulated fills. live: MockBroker placeholder until the Agent OS
    // MCP adapter is wired — swap happens once the real tool list is enumerated.
    broker: mode === "paper" ? new PaperBroker({ float }) : new MockBroker({ volatility: 0.004 }),
    float, revenue: 0, dayPnl: 0, fills: 0, clamps: 0, refusals: 0,
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
  const baseQty = filledNotional / fill.price;
  c.dayPnl += intent.side === "sell" ? filledNotional - baseQty * (c.lastEntry ?? fill.price) : 0;
  if (intent.side === "buy") c.lastEntry = fill.price;
  const event = audit.append("FILL", {
    customer: c.name, mode: c.mode, symbol: intent.symbol, side: intent.side, notional: filledNotional, price: fill.price,
    clamped, fee, fee_bps: c.envelope.fee_bps, simulated: !!fill.simulated, revenue: c.revenue,
  });
  feed.unshift({ seq: event.seq, ts: event.ts, customer: c.name, mode: c.mode, ...intent, notional: filledNotional, clamped, fee, outcome: "FILLED" });
  return { status: 200, body: { ok: true, mode: c.mode, executed_notional: notional, clamped, fee_charged: fee, price: fill.price, simulated: !!fill.simulated } };
}

function refuse(c, intent, v) {
  decisions += 1;
  c.refusals += 1;
  const event = audit.append("REFUSED", { customer: c.name, intent, detail: v.detail });
  feed.unshift({ seq: event.seq, ts: event.ts, customer: c.name, ...intent, outcome: "REFUSED", detail: v.detail });
  return { status: v.status, body: { ok: false, refused_by: "risk_engine", detail: v.detail } };
}

const routes = {
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
  "GET /v1/books": () => {
    const costs = settleCosts();
    const list = [...customers.values()];
    return { status: 200, body: {
      mode: "DEMO",
      execution_note: "live customers use simulated floats until the Agent OS MCP adapter is wired; paper customers fill at real prices with adverse slippage",
      uptime_hours: +((Date.now() - startedAt) / 3_600_000).toFixed(2),
      funnel: { paper: list.filter((c) => c.mode === "paper").length, live: list.filter((c) => c.mode === "live").length },
      customers: list.map((c) => ({ name: c.name, mode: c.mode, fee_model: c.mode === "live" ? "per_fill_bps" : "free_paper", active: c.active, paper_expires_at: c.paperExpiresAt, envelope: c.envelope, fills: c.fills, clamps: c.clamps, refusals: c.refusals, revenue: +c.revenue.toFixed(4) })),
      revenue_usdt: +totalRevenue().toFixed(4),
      costs_usdt: +costs.toFixed(4),
      self_funded_pct: +Math.min(100, (totalRevenue() / Math.max(costs, 1e-9)) * 100).toFixed(1),
      recent: feed.slice(0, 12),
    } };
  },
  "POST /v1/customers": (body, key) => {
    if (key !== FOUNDER_KEY) return { status: 403, body: { ok: false, error: "founder key required" } };
    const c = addCustomer(body);
    return { status: 201, body: { ok: true, customer: c.name, envelope: c.envelope } };
  },
  "POST /v1/revoke": (body, key) => {
    if (key !== FOUNDER_KEY) return { status: 403, body: { ok: false, error: "founder key required" } };
    const c = customers.get(body.name);
    if (!c) return { status: 404, body: { ok: false, error: "no such customer" } };
    c.active = false;
    audit.append("CUSTOMER_REVOKED", { name: body.name });
    return { status: 200, body: { ok: true, revoked: body.name } };
  },
};

addCustomer({ name: "house-fund", api_key: "house-demo-key", symbols: ["BTCUSDT"], max_order_notional: 5, daily_loss_cap: 2, fee_bps: 0, float: 10, mode: "live" });
addCustomer({ name: "tv-alerts", api_key: "tv-demo-key", symbols: ["BTCUSDT", "ETHUSDT", "PEPEUSDT"], max_order_notional: 5, daily_loss_cap: 3, fee_bps: 30, float: 10, mode: "live" });
addCustomer({ name: "first-paper", api_key: "paper-demo-key", symbols: ["BTCUSDT", "ETHUSDT"], max_order_notional: 5, daily_loss_cap: 3, float: 10, mode: "paper" });

createServer((req, res) => {
  const chunks = [];
  req.on("data", (ch) => chunks.push(ch));
  req.on("end", async () => {
    const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString() || "{}") : {};
    const handler = routes[`${req.method} ${req.pathname ?? req.url.split("?")[0]}`];
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
