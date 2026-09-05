// Position guard — layer 2 of the risk model. Evaluates an open position against its
// envelope every cycle. The customer may declare stop_loss_pct and take_profit_pct
// (their strategy's exits); the desk imposes max_drawdown_pct (a floor the customer
// cannot loosen — tighten, never remove). Exits are de-risking, so no cap can block them.

export function guardPosition({ avgEntry, price }, risk) {
  if (!(avgEntry > 0) || !(price > 0)) return { exit: false };
  const dd = ((price - avgEntry) / avgEntry) * 100;

  if (risk.take_profit_pct != null && dd >= risk.take_profit_pct)
    return { exit: true, kind: "TAKE_PROFIT", drawdown_pct: dd, detail: `take profit hit: +${dd.toFixed(2)}% >= +${risk.take_profit_pct}%` };

  const declared = risk.stop_loss_pct;
  const floor = risk.max_drawdown_pct;
  let stop = null, kind = null;
  if (declared != null && floor != null) {
    stop = Math.min(declared, floor);
    kind = declared <= floor ? "STOP_LOSS (customer)" : "STOP_LOSS (desk floor overrides customer's looser stop)";
  } else if (declared != null) { stop = declared; kind = "STOP_LOSS (customer)"; }
  else if (floor != null) { stop = floor; kind = "STOP_LOSS (desk floor)"; }

  if (stop != null && dd <= -stop)
    return { exit: true, kind, drawdown_pct: dd, detail: `stop hit: ${dd.toFixed(2)}% <= -${stop}%` };

  return { exit: false, drawdown_pct: dd };
}
