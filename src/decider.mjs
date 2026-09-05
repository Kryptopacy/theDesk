// RuleDecider: deterministic brain that implements the mandate's rules. Every cycle it
// emits a decision — including an explicit "no action" with a reason — so the dashboard
// shows decision volume, not just fill volume. An LLM decider can implement the same
// interface later; the mandate checker gates both identically.

export class RuleDecider {
  constructor() {
    this.lastBuyAt = null;
  }

  decide(mandate, market, state) {
    const { symbol } = market;
    const buyRule = mandate.rules.find((r) => r.kind === "recurring_buy");

    if (state.positionQty > 0 && state.avgEntry > 0) {
      const tpRule = mandate.rules.find((r) => r.kind === "take_profit_full" || r.kind === "take_profit_partial");
      if (tpRule) {
        const gainPct = ((market.price - state.avgEntry) / state.avgEntry) * 100;
        if (gainPct >= tpRule.trigger.pct) {
          const sellValue = tpRule.kind === "take_profit_full" ? state.positionValue : state.positionValue * (tpRule.pct_of_position / 100);
          return {
            action: "SELL",
            symbol,
            quoteQty: Math.min(sellValue, state.positionValue),
            reason: `rule ${tpRule.id}: price ${gainPct.toFixed(2)}% above avg entry ${state.avgEntry.toFixed(2)} (trigger ${tpRule.trigger.pct}%)`,
          };
        }
      }
    }

    if (buyRule && state.cash >= buyRule.quote_amount_usdt) {
      if (state.deployed + buyRule.quote_amount_usdt <= mandate.budget_usdt) {
        return {
          action: "BUY",
          symbol,
          quoteQty: buyRule.quote_amount_usdt,
          reason: `rule ${buyRule.id}: scheduled buy of ${buyRule.quote_amount_usdt} ${mandate.quote_asset} (deployed ${state.deployed}/${mandate.budget_usdt})`,
        };
      }
      return { action: "NONE", reason: `budget fully deployed (${state.deployed}/${mandate.budget_usdt} ${mandate.quote_asset})` };
    }

    return { action: "NONE", reason: "no rule condition met" };
  }
}
