// Confluence demo: one condition set, evaluated under three trigger modes on LIVE
// Binance data — shows how the same indicators serve different conviction levels.
//   ALL       = every condition must hold (highest conviction, fewest fires)
//   AT_LEAST 2 = confluence voting (the practical default)
//   ANY       = loosest (most fires)
// Also prints the full condition table for every bar where the confluence rule fired —
// the "verification" transparency customers see in their books.
// Run: node src/confluence-demo.mjs
import { evalTrigger } from "./conditions.mjs";

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
const candles = rows.slice(0, -1).map((r) => ({ openTime: r[0], close: Number(r[4]), high: Number(r[2]), low: Number(r[3]), volume: Number(r[5]) }));

// The customer's confluence entry: oversold OR band-edge OR volume-backed — at least 2 of 3.
const conds = [
  { left: { indicator: "rsi", params: { period: 14 } }, op: "below", right: { const: 38 } },
  { left: { indicator: "bb_pct", params: { period: 20, stddev: 2 } }, op: "below", right: { const: 0.15 } },
  { left: { indicator: "volume_ratio", params: { baseline: 20 } }, op: "above", right: { const: 1.25 } },
];
const exitCond = { left: { indicator: "rsi", params: { period: 14 } }, op: "crosses_above", right: { const: 65 } };

let tally = { all: 0, at_least_2: 0, any: 0 };
let lastPrinted = null;
console.log(`scanning ${candles.length} closed ${INTERVAL} bars of ${SYMBOL}...\n`);
for (let i = 30; i < candles.length; i++) {
  const slice = candles.slice(0, i + 1);
  if (evalTrigger({ conditions: conds }, slice, i).fired) tally.all += 1;
  const t2 = evalTrigger({ op: "at_least", count: 2, conditions: conds }, slice, i);
  if (t2.fired) {
    tally.at_least_2 += 1;
    const bar = new Date(candles[i].openTime).toISOString().slice(0, 16).replace("T", " ");
    if (tally.at_least_2 <= 3) { // print the first few with full transparency
      console.log(`${bar}  confluence FIRED (2/3):`);
      for (const m of t2.matches) console.log(`   ${m.ok ? "✓" : "✗"} ${m.label.padEnd(46)} ${Number(m.left?.toPrecision(6))} vs ${m.right}`);
      lastPrinted = candles[i].close;
    }
  }
  if (evalTrigger({ op: "any", conditions: conds }, slice, i).fired) tally.any += 1;
}

console.log(`\n— same indicators, three conviction levels, same live window —`);
console.log(`ALL (3/3 required):        ${tally.all} fires`);
console.log(`AT_LEAST 2 (confluence):   ${tally.at_least_2} fires`);
console.log(`ANY (1/3, loosest):        ${tally.any} fires`);
console.log(`\nthe confluence rule is the customer's dial: tighten to ALL, loosen to ANY —`);
console.log(`the envelope (caps, stop floor, loss cap) is unchanged by any of it.`);
console.log(`example exit rule: ${exitCond.left.indicator} ${exitCond.op} ${exitCond.right.const} (RSI overbought exit)`);
