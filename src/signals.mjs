// Signal engine v2: evaluates trigger-based rules over closed candles and emits intents.
// A rule is { id, action: "buy"|"sell", notional?, trigger }. A trigger is a single
// condition or a group ({ op: "all"|"any"|"at_least", count?, conditions: [...] }) —
// see conditions.mjs. Every intent still passes the envelope gate; the engine has no
// privileges a webhook doesn't have.

import { evalTrigger } from "./conditions.mjs";

const fmt = (x) => (typeof x === "number" ? Number(x.toPrecision(5)).toString() : "?");

export function evaluateRules(mandate, candles, state) {
  const intents = [];
  const last = candles[candles.length - 1];
  state.evaluated ??= {};

  for (const rule of mandate.rules) {
    if (state.evaluated[rule.id] === last.openTime) continue; // one evaluation per closed bar
    const t = evalTrigger(rule.trigger, candles, candles.length - 1);
    if (t.fired) {
      const reason = `${t.hits}/${t.total} conditions met — ` + t.matches.map((m) =>
        `${m.label} [${fmt(m.left)} vs ${fmt(m.right)}] ${m.ok ? "✓" : "✗"}`).join("; ");
      intents.push({ rule: rule.id, symbol: mandate.symbol, side: rule.action, notional: rule.notional ?? null, reason, detail: t, bar: last.openTime });
    }
    state.evaluated[rule.id] = last.openTime;
  }
  return intents;
}
