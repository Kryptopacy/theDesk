// Backtest mode — stage 1 of the mandate lifecycle:
//   backtest (this) -> paper (live prices, simulated) -> live (Agent OS MCP)
// Same mandate, same risk engine, same adverse-slippage assumption at every stage; only
// the broker changes. Walk-forward over closed bars with the FULL risk stack active —
// desk floor, daily loss cap, clamps — so strategies that would have been force-exited
// don't get to look good. Fills are bar-close with adverse slippage (intrabar not modeled).
// Usage: node src/backtest.mjs [mandate.json]   (no arg = demo suite on live data)
import { loadMandate } from "./mandate.mjs";
import { evaluateRules } from "./signals.mjs";
import { guardPosition } from "./riskguard.mjs";
import { checkIntent } from "./envelope.mjs";

const SYMBOL = "BTCUSDT", INTERVAL = "4h", LIMIT = 200;
const SLIP = 0.0003, FEE = 0.001, BUDGET = 10;

async function fetchKlines() {
  for (const base of ["https://api.binance.com", "https://data-api.binance.vision", "https://api1.binance.com"]) {
    try {
      const res = await fetch(`${base}/api/v3/klines?symbol=${SYMBOL}&interval=${INTERVAL}&limit=${LIMIT}`, { signal: AbortSignal.timeout(10000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.json();
    } catch (e) { console.error(`source unreachable (${base}): ${e.cause?.code ?? e.message}`); }
  }
  process.exit(1);
}

function runBacktest(name, mandate, candles) {
  const envelope = {
    symbols: mandate.symbols ?? [SYMBOL],
    max_order_notional: mandate.risk.max_order_notional_usdt,
    daily_loss_cap: mandate.risk.daily_loss_cap_usdt,
    fee_bps: 0,
    position_risk: mandate.risk.position_risk ?? { max_drawdown_pct: 10 },
  };
  const customer = { name, active: true, dayPnl: 0, envelope };
  let qty = 0, avgEntry = 0, cash = BUDGET, deployed = 0, realized = 0, fees = 0;
  let trades = 0, wins = 0, forceExits = 0, refusals = 0, clamps = 0;
  let peak = BUDGET, maxDD = 0, curDay = null;
  const state = {};

  for (let i = 30; i < candles.length; i++) {
    const bar = candles[i], price = bar.close;
    const day = new Date(bar.openTime).toISOString().slice(0, 10);
    if (day !== curDay) { curDay = day; customer.dayPnl = 0; } // day guard resets per UTC day

    for (const intent of evaluateRules(mandate, candles.slice(0, i + 1), state)) {
      if (intent.side === "sell" && qty <= 0) continue;
      const notional = intent.side === "sell" ? qty * price : intent.notional;
      const v = checkIntent(customer, { ...intent, notional });
      if (!v.ok) { refusals += 1; continue; }
      if (intent.side === "buy" && deployed + v.notional > BUDGET) { refusals += 1; continue; }
      if (v.clamped) clamps += 1;
      const fillPrice = intent.side === "buy" ? price * (1 + SLIP) : price * (1 - SLIP);
      const fee = v.notional * FEE;
      fees += fee;
      const baseQty = v.notional / fillPrice;
      if (intent.side === "buy") {
        avgEntry = (avgEntry * qty + fillPrice * baseQty) / (qty + baseQty);
        qty += baseQty; cash -= v.notional + fee; deployed += v.notional;
      } else {
        const sold = Math.min(baseQty, qty);
        const pnl = sold * fillPrice - sold * avgEntry;
        realized += pnl; trades += 1; if (pnl > 0) wins += 1;
        customer.dayPnl += pnl;
        qty -= sold; cash += sold * fillPrice - fee; deployed = Math.max(0, deployed - sold * avgEntry);
      }
    }

    if (qty > 0) {
      const g = guardPosition({ avgEntry, price }, envelope.position_risk);
      if (g.exit) {
        const fillPrice = price * (1 - SLIP);
        const fee = qty * fillPrice * FEE;
        fees += fee;
        const pnl = qty * fillPrice - qty * avgEntry;
        realized += pnl; trades += 1; if (pnl > 0) wins += 1; forceExits += 1;
        customer.dayPnl += pnl;
        cash += qty * fillPrice - fee; deployed = Math.max(0, deployed - qty * avgEntry); qty = 0;
      }
    }
    const equity = cash + qty * price;
    peak = Math.max(peak, equity);
    maxDD = Math.max(maxDD, (peak - equity) / peak);
  }
  const finalEquity = cash + qty * candles.at(-1).close;
  return { name, trades, wins, winRate: trades ? ((wins / trades) * 100).toFixed(0) : "—", realized, fees, maxDD: (maxDD * 100).toFixed(1), forceExits, refusals, clamps, finalEquity, openQty: qty };
}

const rows = await fetchKlines();
const candles = rows.slice(0, -1).map((r) => ({ openTime: r[0], close: Number(r[4]), high: Number(r[2]), low: Number(r[3]), volume: Number(r[5]) }));
const first = candles[0].close, last = candles.at(-1).close;
console.log(`backtest: ${candles.length} closed ${INTERVAL} bars of ${SYMBOL} (${new Date(candles[0].openTime).toISOString().slice(0, 10)} → ${new Date(candles.at(-1).openTime).toISOString().slice(0, 10)}), buy&hold over the window: ${(((last - first) / first) * 100).toFixed(1)}%\n`);
console.log("mandate            | trades | win%  | realized | fees  | maxDD% | force-exits | refusals | final equity");
console.log("-------------------|--------|-------|----------|-------|--------|-------------|----------|-------------");

const argFile = process.argv[2];
const mandates = argFile
  ? [{ name: argFile.split(/[\\/]/).pop().replace(/\.json$/, ""), mandate: loadMandate(argFile) }]
  : [
      { name: "rsi-reversion", mandate: { symbol: SYMBOL, rules: [
        { id: "b1", action: "buy", notional: 5, trigger: { conditions: [ { left: { indicator: "rsi", params: { period: 14 } }, op: "crosses_below", right: { const: 35 } } ] } },
        { id: "b2", action: "sell", trigger: { conditions: [ { left: { indicator: "rsi", params: { period: 14 } }, op: "crosses_above", right: { const: 65 } } ] } },
      ], risk: { max_order_notional_usdt: 5, daily_loss_cap_usdt: 2, position_risk: { max_drawdown_pct: 10 } } } },
      { name: "confluence-2of3", mandate: { symbol: SYMBOL, rules: [
        { id: "b1", action: "buy", notional: 5, trigger: { op: "at_least", count: 2, conditions: [
          { left: { indicator: "rsi", params: { period: 14 } }, op: "below", right: { const: 38 } },
          { left: { indicator: "bb_pct", params: { period: 20, stddev: 2 } }, op: "below", right: { const: 0.15 } },
          { left: { indicator: "volume_ratio", params: { baseline: 20 } }, op: "above", right: { const: 1.25 } },
        ] } },
        { id: "b2", action: "sell", trigger: { conditions: [ { left: { indicator: "rsi", params: { period: 14 } }, op: "crosses_above", right: { const: 65 } } ] } },
      ], risk: { max_order_notional_usdt: 5, daily_loss_cap_usdt: 2, position_risk: { max_drawdown_pct: 10 } } } },
      { name: "breakout+bracket", mandate: { symbol: SYMBOL, rules: [
        { id: "b1", action: "buy", notional: 5, trigger: { conditions: [ { left: { indicator: "price" }, op: "crosses_above", right: { indicator: "breakout_high", params: { period: 20 } } } ] } },
      ], risk: { max_order_notional_usdt: 5, daily_loss_cap_usdt: 2, position_risk: { take_profit_pct: 8, max_drawdown_pct: 5 } } } },
    ];

for (const { name, mandate } of mandates) {
  const r = runBacktest(name, mandate, candles);
  console.log(`${r.name.padEnd(18)} | ${String(r.trades).padStart(6)} | ${String(r.winRate).padStart(4)}% | ${(r.realized >= 0 ? "+" : "") + r.realized.toFixed(4).padStart(7)} | ${r.fees.toFixed(4)} | ${String(r.maxDD).padStart(6)} | ${String(r.forceExits).padStart(11)} | ${String(r.refusals).padStart(8)} | ${(r.finalEquity >= 0 ? "" : "") + r.finalEquity.toFixed(2)} USDT${r.openQty > 0 ? ` (open ${r.openQty.toPrecision(3)} BTC)` : ""}`);
}
console.log(`\nsame mandate, three stages: backtest (this) -> paper (live prices) -> live (Agent OS MCP).`);
console.log(`the risk stack is active in ALL three — refusals and force-exits above are the desk working.`);
