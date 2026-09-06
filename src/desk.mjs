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
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { AuditLog } from "./audit.mjs";
import { validateProposal } from "./amendment.mjs";
import { setMcpToken, listMcpTools, MCP_URL } from "./mcp-broker.mjs";
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
  name = String(name ?? "unnamed").replace(/[<>]/g, "").trim().slice(0, 24); // community names render on the books
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

// Proposal intake throttle: per-address 6/hour, global 100/UTC-day. The books are public —
// keep them clean without ever blocking a first-time composer.
const proposeHits = new Map();
let proposeDay = { day: new Date().toISOString().slice(0, 10), n: 0 };
function proposeAllowed(ip) {
  const today = new Date().toISOString().slice(0, 10);
  if (proposeDay.day !== today) proposeDay = { day: today, n: 0 };
  if (++proposeDay.n > 100) return false;
  const hits = (proposeHits.get(ip) ?? []).filter((t) => Date.now() - t < 3_600_000);
  hits.push(Date.now());
  proposeHits.set(ip, hits);
  return hits.length <= 6;
}

// OAuth for the Agent OS MCP server: Binance advertises client_id metadata documents
// (no dynamic client registration), so the desk hosts its own client metadata and does a
// plain PKCE authorization-code flow. /oauth/start → Binance login → /oauth/callback
// exchanges the code and arms the live adapter with the bearer token.
const BASE_URL = process.env.RENDER_EXTERNAL_URL ?? `http://localhost:${PORT}`;
const CLIENT_META_URL = `${BASE_URL}/oauth/client-metadata.json`;
const REDIRECT_URI = `${new URL(BASE_URL).origin}/oauth/callback`;
const MCP_RESOURCE = "https://agent.binance.com/mcp/agentic";
const oauth = { verifier: null, state: null };

const page = (status, text) => ({ status, raw: true, headers: { "content-type": "text/html" }, body:
  `<!doctype html><body style="font-family:ui-monospace,Consolas,monospace;background:#0a0d10;color:#dce5ed;max-width:820px;margin:0 auto;padding:40px;line-height:1.6"><pre style="white-space:pre-wrap;font-size:13.5px">${String(text).replace(/[<>&]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;" }[c]))}</pre></body>` });

const ROUTES = {
  "POST /v1/intent": async (body) => {
    const c = [...customers.values()].find((x) => x.api_key === body.api_key);
    if (!c) return { status: 401, body: { ok: false, error: "unknown api key" } };
    if (c.paperExpiresAt && Date.now() > c.paperExpiresAt)
      return { status: 402, body: { ok: false, error: "paper envelope expired — graduate to a live envelope to resume (activation fee applies)" } };
    // Untrusted-input hygiene: the note is community text rendered on the public books —
    // strip control characters and angle brackets, cap length at the source.
    const note = typeof body.note === "string"
      ? body.note.replace(/[\u0000-\u001f<>]/g, "").trim().slice(0, 80) || null
      : null;
    const intent = { symbol: String(body.symbol ?? "").toUpperCase(), side: body.side, notional: Number(body.notional), note };
    // Strangers can also be too loud: frequency is risk. One intent per envelope per 2s —
    // rate-limited attempts return 429 and deliberately stay off the public feed.
    if (c.lastIntentAt && Date.now() - c.lastIntentAt < 2000)
      return { status: 429, body: { ok: false, refused_by: "risk_engine", detail: "envelope rate limit — one intent per 2s" } };
    c.lastIntentAt = Date.now();
    const v = checkIntent(c, intent);
    if (v.ok && v.clamped) c.clamps += 1;
    return v.ok ? execute(c, intent, v.notional, v.clamped) : refuse(c, intent, v);
  },
  "GET /": () => ({ status: 200, raw: true, headers: { "content-type": "text/html" }, body: readFileSync(new URL("../dashboard/index.html", import.meta.url)) }),
  "GET /onboard": () => ({ status: 200, raw: true, headers: { "content-type": "text/html" }, body: readFileSync(new URL("../dashboard/onboard.html", import.meta.url)) }),
  "GET /oauth/client-metadata.json": () => ({ status: 200, body: {
    client_id: CLIENT_META_URL,
    client_name: "The Desk",
    client_uri: BASE_URL,
    redirect_uris: [REDIRECT_URI],
    grant_types: ["authorization_code"],
    response_types: ["code"],
    token_endpoint_auth_method: "none",
  } }),
  "GET /oauth/start": () => {
    const verifier = randomBytes(32).toString("base64url");
    const challenge = createHash("sha256").update(verifier).digest("base64url");
    const state = randomBytes(8).toString("base64url");
    oauth.verifier = verifier;
    oauth.state = state;
    const auth = new URL("https://accounts.binance.com/agentic-oauth/authorize");
    auth.searchParams.set("response_type", "code");
    auth.searchParams.set("client_id", CLIENT_META_URL);
    auth.searchParams.set("redirect_uri", REDIRECT_URI);
    auth.searchParams.set("code_challenge", challenge);
    auth.searchParams.set("code_challenge_method", "S256");
    auth.searchParams.set("state", state);
    auth.searchParams.set("resource", MCP_RESOURCE);
    return { status: 302, raw: true, headers: { location: auth.toString() } };
  },
  "GET /oauth/callback": async (_body, _key, _ip, q) => {
    if (q.get("error")) return page(400, `authorization refused: ${q.get("error")}\n${q.get("error_description") ?? ""}\n\nstart again: ${BASE_URL}/oauth/start`);
    if (!q.get("code") || q.get("state") !== oauth.state || !oauth.verifier)
      return page(400, `state mismatch or missing code — start again: ${BASE_URL}/oauth/start`);
    const tokRes = await fetch("https://accounts.binance.com/oauth-agentic/token", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code: q.get("code"),
        redirect_uri: REDIRECT_URI,
        client_id: CLIENT_META_URL,
        code_verifier: oauth.verifier,
        resource: MCP_RESOURCE,
      }),
      signal: AbortSignal.timeout(20000),
    });
    const tok = await tokRes.json().catch(() => ({}));
    if (!tokRes.ok || !tok.access_token)
      return page(400, `token exchange failed: HTTP ${tokRes.status}\n${JSON.stringify(tok).slice(0, 400)}\n\nstart again: ${BASE_URL}/oauth/start`);
    setMcpToken(tok.access_token);
    audit.append("MCP_CONNECTED", { via: "oauth_pkce", client: CLIENT_META_URL, token_type: tok.token_type ?? "bearer", expires_in: tok.expires_in ?? null });
    broadcast();
    let toolLines = "(enumeration failed — token is set; check the MCP adapter logs)";
    try {
      const tools = await listMcpTools(tok.access_token);
      toolLines = tools.map((t) => `- ${t.name}: ${(t.description ?? "").split("\n")[0]}`).join("\n");
      audit.append("MCP_TOOLS_ENUMERATED", { count: tools.length, tools: tools.map((t) => t.name) });
    } catch (e) {
      toolLines = `(enumeration failed: ${e.message})`;
    }
    return page(200,
`THE DESK — Agent OS connected.

Bearer token acquired via PKCE. The live adapter is armed — fills it executes now go
through the Agent OS MCP server onto the dedicated sub-account.

To survive a redeploy, set this as env BINANCE_MCP_TOKEN (keep it secret):
${tok.access_token}

Tools enumerated from the live server:

${toolLines}`);
  },
  "GET /v1/books": () => ({ status: 200, body: snapshot() }),
  // Self-serve onboarding: strangers compose inside the bounded vocabulary; validateProposal
  // refuses everything else, verbatim, on the audit chain. Paper is free — the graduation
  // (live envelope, per-fill fees) is the founder's yes, which is also the revenue gate.
  "POST /v1/propose": (body, _key, ip) => {
    if (!proposeAllowed(ip)) return { status: 429, body: { ok: false, refused_by: "compiler", detail: "too many proposals from this address — try again later" } };
    const name = String(body.name ?? "anon").replace(/[<>]/g, "").trim().slice(0, 24) || "anon";
    const plain = typeof body.plain === "string" ? body.plain.replace(/[\u0000-\u001f<>]/g, "").trim().slice(0, 400) || null : null;
    const v = validateProposal({ proposer: name, source_reply: plain, symbols: body.symbols, rules: body.rules }, { maxOrderNotional: 5 });
    if (!v.ok) {
      audit.append("PROPOSAL_REFUSED", { name, plain, violations: v.violations });
      broadcast();
      return { status: 422, body: { ok: false, refused_by: "compiler", violations: v.violations } };
    }
    const api_key = "pub-" + randomUUID().replaceAll("-", "").slice(0, 10);
    const c = addCustomer({ name, api_key, symbols: v.symbols, max_order_notional: 5, daily_loss_cap: 2, float: 10, mode: "paper", expires_in_days: 7, max_drawdown_pct: 10 });
    c.mandate = v.normalized;
    c.plain = plain;
    audit.append("ENVELOPE_OPENED", { customer: name, plain, mandate: v.normalized, notes: v.notes });
    broadcast();
    return { status: 201, body: { ok: true, customer: name, api_key, envelope: c.envelope, mandate: v.normalized, notes: v.notes } };
  },
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

// Public mode: DESK_PUBLIC=1 serves the books, the onboarding counter and the intent API to
// the world — that's the product surface (TradingView webhooks need a public URL). Founder
// routes stay local unless a strong founder key (≥16 chars) is set for the public bind.
const PUBLIC_ROUTES = ["POST /v1/propose", "POST /v1/intent"];
const FOUNDER_ROUTES = ["POST /v1/customers", "POST /v1/revoke"];
const strongFounderKey = (process.env.DESK_FOUNDER_KEY ?? "").length >= 16;
const routes = process.env.DESK_PUBLIC === "1"
  ? Object.fromEntries(Object.entries(ROUTES).filter(([k]) =>
      k.startsWith("GET") || PUBLIC_ROUTES.includes(k) || (strongFounderKey && FOUNDER_ROUTES.includes(k))))
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
      out = handler ? await handler(body, req.headers["x-api-key"], req.socket.remoteAddress, new URL(req.url, "http://localhost").searchParams) : { status: 404, body: { ok: false, error: "no such route" } };
      res.writeHead(out.status, out.raw ? out.headers : { "content-type": "application/json" });
      res.end(out.raw ? out.body : JSON.stringify(out.body, null, 2));
    } catch (e) {
      console.error("request failed:", e);
      try { res.writeHead(500, { "content-type": "application/json" }); res.end(JSON.stringify({ ok: false, error: String(e.message ?? e) })); } catch {}
    }
  });
}).listen(PORT, () => console.log(`desk listening on http://localhost:${PORT} — books at GET /v1/books`));
