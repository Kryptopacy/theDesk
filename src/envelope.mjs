// The risk gate — pure function, shared by every input path. Whether an intent comes
// from a webhook, a bot, or the desk's own indicator engine, it passes through the
// identical envelope check. The discipline is universal.

const MIN_NOTIONAL_USDT = 5; // Binance spot filter, ~5 USDT per order

export function checkIntent(customer, intent) {
  const e = customer.envelope;
  if (!customer.active) return { ok: false, status: 403, detail: `customer "${customer.name}" is revoked — permissions were withdrawn mid-flight` };
  if (!e.symbols.includes(intent.symbol)) return { ok: false, status: 422, detail: `${intent.symbol} outside envelope whitelist [${e.symbols.join(", ")}]` };
  if (!["buy", "sell"].includes(intent.side)) return { ok: false, status: 422, detail: `"${intent.side}" is not an executable side` };
  if (!(intent.notional > 0)) return { ok: false, status: 422, detail: "notional must be positive" };
  if (customer.dayPnl <= -e.daily_loss_cap) return { ok: false, status: 429, detail: `daily loss cap ${e.daily_loss_cap} USDT reached (${customer.dayPnl.toFixed(2)}) — envelope halts until next UTC day` };
  let notional = intent.notional, clamped = false;
  if (intent.side === "buy" && notional > e.max_order_notional) { notional = e.max_order_notional; clamped = true; } // desks clamp, they don't guess
  if (notional < MIN_NOTIONAL_USDT) return { ok: false, status: 422, detail: `notional ${notional} below exchange min notional ${MIN_NOTIONAL_USDT} USDT` };
  return { ok: true, notional, clamped };
}
