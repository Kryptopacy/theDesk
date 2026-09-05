// Live demo: indicator-driven mandates on real Binance data, gated by the same risk
// engine as every other input. Fetches public klines (no API key), walks the closed
// 4-hour bars, fires rule crossings as intents, and routes them through the envelope.
//
// The demo mandate (a customer's strategy, expressed entirely with Binance indicators):
//   r1: BUY 5 USDT when RSI(14) crosses below 35   (oversold entry)
//   r2: SELL everything when RSI(14) crosses above 65 (overbought exit)
// Run: node src/signals-demo.mjs
import { checkIntent } from "./envelope.mjs";
import { evaluateRules } from "./signals.mjs";
import { guardPosition } from "./riskguard.mjs";
import { MockBroker } from "./broker.mjs";
import { AuditLog } from "./audit.mjs";

const SYMBOL = "BTCUSDT";
const INTERVAL = "4h";

async function fetchKlines(base) {
  const res = await fetch(`${base}/api/v3/klines?symbol=${SYMBOL}&interval=${INTERVAL}&limit=200`, { signal: AbortSignal.timeout(10000) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}
let rows = null;
for (const base of ["https://api.binance.com", "https://data-api.binance.vision", "https://api1.binance.com"]) {
  try { rows = await fetchKlines(base); console.log(`data source: ${base}`); break; }
  catch (e) { console.error(`source unreachable (${base}): ${e.cause?.code ?? e.message}`); }
}
if (!rows) { console.error("all klines sources unreachable"); process.exit(1); }
const candles = rows.slice(0, -1).map((r) => ({ openTime: r[0], close: Number(r[4]) })); // drop the still-open bar
console.log(`live: ${candles.length} closed ${INTERVAL} bars of ${SYMBOL}, latest close ${candles.at(-1).close.toLocaleString()} USDT\n`);

const mandate = {
  symbol: SYMBOL,
  rules: [
    { id: "r1", action: "buy", notional: 5,
      trigger: { conditions: [ { left: { indicator: "rsi", params: { period: 14 } }, op: "crosses_below", right: { const: 35 } } ] } },
    { id: "r2", action: "sell",
      trigger: { conditions: [ { left: { indicator: "rsi", params: { period: 14 } }, op: "crosses_above", right: { const: 65 } } ] } },
  ],
};
const customer = {
  name: "binance-rsi",
  active: true,
  dayPnl: 0,
  envelope: { symbols: [SYMBOL], max_order_notional: 5, daily_loss_cap: 2, fee_bps: 30,
              position_risk: { max_drawdown_pct: 10, stop_loss_pct: null, take_profit_pct: null } },
  broker: new MockBroker({ volatility: 0 }),
  qty: 0, avgEntry: 0, clamps: 0, refusals: 0, fills: 0, revenue: 0,
};
const audit = new AuditLog("audit/signals-demo.jsonl");
const state = {};

let trades = 0;
for (let i = 30; i < candles.length; i++) {
  const intents = evaluateRules(mandate, candles.slice(0, i + 1), state);
  for (const intent of intents) {
    const bar = new Date(candles[i].openTime).toISOString().slice(0, 16).replace("T", " ");
    if (intent.side === "sell" && customer.qty <= 0) {
      audit.append("SIGNAL_IGNORED", { customer: customer.name, rule: intent.rule, reason: "sell signal while flat" });
      console.log(`${bar}  [${intent.rule} FIRED] ${intent.reason} → ignored (flat, nothing to sell)`);
      continue;
    }
    // the engine sells its whole position; buys use the rule's notional
    const notional = intent.side === "sell" ? customer.qty * candles[i].close : intent.notional;
    const full = { ...intent, side: intent.side, notional };
    const v = checkIntent(customer, full);
    if (!v.ok) {
      customer.refusals += 1;
      audit.append("REFUSED", { customer: customer.name, intent: full, detail: v.detail });
      console.log(`${bar}  [${intent.rule} FIRED] ${intent.reason} → ${intent.side.toUpperCase()} ${notional.toFixed(2)} USDT → REFUSED: ${v.detail}`);
      continue;
    }
    const notionalExec = intent.side === "buy" ? v.notional : notional;
    const fill = customer.broker.marketOrder(SYMBOL, intent.side.toUpperCase(), notionalExec);
    if (!fill.ok) { console.log(`${bar}  [${intent.rule}] ${intent.reason} → fill failed: ${fill.error}`); continue; }
    const fee = (notionalExec * customer.envelope.fee_bps) / 10_000;
    customer.revenue += fee; customer.fills += 1; if (v.clamped) customer.clamps += 1;
    if (intent.side === "buy") {
      customer.avgEntry = (customer.avgEntry * customer.qty + candles[i].close * (notionalExec / candles[i].close)) / (customer.qty + notionalExec / candles[i].close);
      customer.qty += notionalExec / candles[i].close;
    } else {
      customer.dayPnl += notionalExec - (notionalExec / candles[i].close) * customer.avgEntry;
      customer.qty = 0;
    }
    trades += 1;
    audit.append("FILL", { customer: customer.name, rule: intent.rule, symbol: SYMBOL, side: intent.side, notional: notionalExec, price: candles[i].close, fee, clamped: v.clamped });
    console.log(`${bar}  [${intent.rule} FIRED] ${intent.reason} → ${intent.side.toUpperCase()} ${notionalExec.toFixed(2)} USDT @ ${candles[i].close.toLocaleString()} → FILLED (fee ${fee.toFixed(4)}${v.clamped ? ", CLAMPED to envelope cap" : ""})`);
  }

  // layer 2: the position guard evaluates every closed bar — desk floor backstops the strategy
  if (customer.qty > 0) {
    const g = guardPosition({ avgEntry: customer.avgEntry, price: candles[i].close }, customer.envelope.position_risk);
    if (g.exit) {
      const notional = customer.qty * candles[i].close;
      const fill = customer.broker.marketOrder(SYMBOL, "SELL", notional);
      if (fill.ok) {
        const fee = (notional * customer.envelope.fee_bps) / 10_000;
        customer.revenue += fee; customer.fills += 1;
        customer.dayPnl += notional - customer.qty * customer.avgEntry;
        customer.qty = 0;
        audit.append("RISK_EXIT", { customer: customer.name, kind: g.kind, detail: g.detail, price: candles[i].close, notional });
        console.log(`${new Date(candles[i].openTime).toISOString().slice(0, 16).replace("T", " ")}  [RISK GUARD] ${g.detail} → FORCE EXIT ${notional.toFixed(2)} USDT (${g.kind})`);
      }
    }
  }
}

console.log(`\n— mandate backtest over the live window —`);
console.log(`fills: ${customer.fills}, refusals: ${customer.refusals}, clamps: ${customer.clamps}, fees earned: ${customer.revenue.toFixed(4)} USDT`);
console.log(`position: ${customer.qty.toFixed(8)} BTC, dayPnl(realized): ${customer.dayPnl.toFixed(2)} USDT, envelope: [${customer.envelope.symbols.join(",")}] cap ${customer.envelope.max_order_notional}/order, loss ${customer.envelope.daily_loss_cap}/day`);
const v = audit.verify();
console.log(`audit chain: ${v.ok ? `VERIFIED (${v.events} events)` : "BROKEN"}`);
