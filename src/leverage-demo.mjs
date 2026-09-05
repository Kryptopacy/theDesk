// Leverage demo: how perps are handled by design, with REAL market data.
// Fetches the live BTCUSDT perpetual mark price + funding rate from Binance's public
// futures API (keyless), then shows, per leverage level: exposure, estimated liquidation
// price, and the desk's force-exit price (always before the liquidation engine).
// No orders are placed — this is the risk math customers' envelopes run on.
// Run: node src/leverage-demo.mjs
const SYMBOL = "BTCUSDT";

async function fetchJson(url) {
  const res = await fetch(url, { signal: AbortSignal.timeout(10000) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

let mark = null, fundingRate = null, live = true;
try {
  const d = await fetchJson(`https://fapi.binance.com/fapi/v1/premiumIndex?symbol=${SYMBOL}`);
  mark = Number(d.markPrice);
  fundingRate = Number(d.lastFundingRate);
  console.log(`live: ${SYMBOL} perp mark ${mark.toLocaleString()} USDT, funding ${(fundingRate * 100).toFixed(4)}% per 8h (source: fapi.binance.com)`);
} catch (e) {
  live = false;
  mark = 80000; fundingRate = 0.0001;
  console.log(`futures API unreachable (${e.cause?.code ?? e.message}) — using labeled demo values: mark ${mark}, funding ${(fundingRate * 100).toFixed(4)}%`);
}

const MARGIN = 5;          // USDT the customer commits per position (envelope margin cap)
const MMR = 0.004;         // ~Binance isolated maintenance margin rate, lowest BTC tier
const FLOOR_FRACTION = 0.5; // desk force-exits at half the distance to liquidation

console.log(`\nenvelope: instrument=USDM_PERP, margin_mode=ISOLATED, margin cap ${MARGIN} USDT\n`);
console.log("lev | exposure | ~liq. distance | ~liq. price (long) | desk force-exit at | funding cost/day (abs)");
console.log("----|----------|----------------|--------------------|--------------------|-----------------------");
for (const lev of [1, 2, 3, 5, 10]) {
  const exposure = MARGIN * lev;
  const liqDist = Math.max(1 / lev - MMR, 0.002);          // approx distance to liquidation, price terms
  const liqPrice = mark * (1 - liqDist);                    // long side
  const deskDist = liqDist * FLOOR_FRACTION;                // the desk exits at half the distance
  const deskPrice = mark * (1 - deskDist);
  const fundingPerDay = exposure * Math.abs(fundingRate) * 3; // paid every 8h
  console.log(`${String(lev).padEnd(3)} | ${exposure.toFixed(0).padStart(6)} USDT | ${((liqDist) * 100).toFixed(2).padStart(8)}% | ${liqPrice.toFixed(0).padStart(12)} | ${deskPrice.toFixed(0).padStart(12)} (${((deskDist) * 100).toFixed(2)}%) | ${fundingPerDay.toFixed(4).padStart(8)} USDT`);
}

console.log(`
— how leverage is handled, by design —
1. envelope carries instrument + max_leverage; desk caps it, customers tighten only
2. caps are on EXPOSURE (margin x leverage), not margin — leverage can't sneak size in
3. ISOLATED margin only: max loss per position is its margin, never the whole envelope
4. position guard scales with leverage: force-exit at half the liquidation distance —
   the desk's floor is expressed in price terms so the account never meets the liquidation engine
5. funding is a tracked cost line in the books AND an indicator condition
   ("exit when funding flips against me for 3 windows")
6. execution itself unlocks the moment the Agent OS MCP tool list is enumerated —
   same envelope code, futures adapter behind one interface`);
