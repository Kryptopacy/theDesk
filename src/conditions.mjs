// Condition language v2: indicators are series, conditions compare two series (or a
// series to a constant), triggers combine conditions with all / any / at_least(k).
// Confluence is a primitive, not a hack. Persistence (for_bars) is verification.
// The vocabulary is bounded — unknown indicators/ops are refused by the validators.

import { sma, ema, rsi, bollinger, macd, stochastic, atrPct, volumeRatio, roc, rollingHigh, rollingLow } from "./indicators.mjs";

const cl = (c) => c.map((x) => x.close);

export const INDICATORS = {
  price: (c) => cl(c),
  rsi: (c, p) => rsi(cl(c), p.period ?? 14),
  sma: (c, p) => sma(cl(c), p.period ?? 20),
  ema: (c, p) => ema(cl(c), p.period ?? 20),
  bb_pct: (c, p) => bollinger(cl(c), p.period ?? 20, p.stddev ?? 2).map((x) => (x == null ? null : x.pos)),
  macd_hist: (c, p) => macd(cl(c), p.fast ?? 12, p.slow ?? 26, p.signal ?? 9).hist,
  stoch: (c, p) => stochastic(c, p.period ?? 14),
  atr_pct: (c, p) => atrPct(c, p.period ?? 14),
  volume_ratio: (c, p) => volumeRatio(c, p.baseline ?? 20),
  roc: (c, p) => roc(cl(c), p.period ?? 10),
  breakout_high: (c, p) => rollingHigh(cl(c), p.period ?? 20),
  breakout_low: (c, p) => rollingLow(cl(c), p.period ?? 20),
};

export const OPS = new Set(["above", "below", "crosses_above", "crosses_below"]);

const num = (v) => (typeof v === "number" && Number.isFinite(v) ? v : null);

// resolve a side spec ({indicator, params} | {const}) into a number[]
export function seriesFor(side, candles) {
  if (side.const !== undefined) { const k = num(side.const); return candles.map(() => k); }
  const fn = INDICATORS[side.indicator];
  if (!fn) throw new Error(`unknown indicator "${side.indicator}"`);
  return fn(candles, side.params ?? {});
}

function cmpAt(cond, candles, i) {
  const L = seriesFor(cond.left, candles), R = seriesFor(cond.right, candles);
  const lv = num(L[i]), rv = num(R[i]), lp = num(L[i - 1]), rp = num(R[i - 1]);
  if (lv == null || rv == null) return { ok: false, left: lv, right: rv };
  let ok = false;
  switch (cond.op) {
    case "above": ok = lv > rv; break;
    case "below": ok = lv < rv; break;
    case "crosses_above": ok = lp != null && rp != null && lp <= rp && lv > rv; break;
    case "crosses_below": ok = lp != null && rp != null && lp >= rp && lv < rv; break;
  }
  return { ok, left: lv, right: rv };
}

// one condition at bar i, honoring persistence (for_bars, static ops only)
function evalCondition(cond, candles, i) {
  const fb = Math.max(1, cond.for_bars ?? 1);
  if (fb > 1 && !["above", "below"].includes(cond.op)) {
    return { ok: false, detail: "for_bars requires a static op (above/below)" };
  }
  for (let j = i - fb + 1; j <= i; j++) {
    const r = cmpAt(cond, candles, j);
    if (j === i) return { ...r, ok: r.ok }; // report current-bar values even if earlier bars failed
    if (!r.ok) return { ok: false };
  }
  return { ok: true };
}

// trigger: single condition | { op: "all"|"any"|"at_least", count?, conditions: [...] }
// returns { fired, matches: [{ label, ok, left, right }] } — full transparency per bar
export function evalTrigger(trigger, candles, i) {
  const conds = trigger.conditions ?? [trigger];
  const matches = conds.map((c) => {
    const r = evalCondition(c, candles, i);
    const label = `${c.left.indicator ?? "const"} ${c.op} ${c.right.const ?? c.right.indicator}${c.for_bars ? ` for ${c.for_bars} bars` : ""}`;
    return { label, ok: !!r.ok, left: r.left, right: r.right };
  });
  const hits = matches.filter((m) => m.ok).length;
  let fired;
  if (trigger.op === "any") fired = hits >= 1;
  else if (trigger.op === "at_least") fired = hits >= (trigger.count ?? 1);
  else fired = hits === matches.length; // "all" or single condition
  return { fired, matches, hits, total: matches.length };
}
