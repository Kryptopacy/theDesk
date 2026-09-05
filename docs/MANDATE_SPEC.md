# Mandate Contract Specification

The mandate is the compile target for plain-English strategies and the source of truth for
everything the executor is allowed to do. One JSON file per agent, written to `mandates/`,
hash-chained into the audit log.

## Schema (v1)

```jsonc
{
  "version": 1,
  "id": "mdt_<ulid>",
  "created_from": "<the user's verbatim plain-English strategy>",
  "created_at": "<ISO 8601>",
  "approved_at": null,                    // set on one-click approval; null = not live

  "symbols": ["BTCUSDT"],                 // hard whitelist, agent may not trade anything else
  "quote_asset": "USDT",
  "budget_usdt": 10,                      // total capital the mandate may deploy

  "risk": {
    "max_order_notional_usdt": 5,         // per-order cap; floor = Binance min notional (≈5 USDT on BTCUSDT)
    "daily_loss_cap_usdt": 2,             // agent halts for the UTC day when breached
    "max_open_orders": 1,
    "forbidden_actions": ["margin", "futures", "transfer_out"],
    "position_risk": {
      "max_drawdown_pct": 10,             // desk floor: max position drawdown before force exit — customers may tighten, never loosen
      "stop_loss_pct": null,              // customer-declared stop (optional; effective stop = min(this, floor))
      "take_profit_pct": null             // customer-declared take profit (optional)
    }
  },

  "schedule": {                           // optional; absent = event-driven only
    "recurrence": "weekly",
    "day": "FR",
    "time_utc": "12:00"
  },

  "rules": [                              // compiled entry/exit conditions
    {
      "id": "r1",
      "kind": "recurring_buy",
      "quote_amount_usdt": 30,
      "trigger": { "type": "schedule" }
    },
    {
      "id": "r2",
      "kind": "take_profit_partial",
      "pct_of_position": 20,
      "trigger": { "type": "price_gain_since_avg_entry", "pct": 10 }
    }
  ],

  "kill_conditions": [                    // executor self-halts and requests revocation when true
    { "metric": "daily_pnl_usdt", "op": "<=", "value": -2 },
    { "metric": "drawdown_pct_from_entry", "op": ">=", "value": 15 }
  ]
}
```

## Compilation rules

1. **Conservative defaults win.** Anything ambiguous in the source text compiles to the
   tighter constraint (lower cap, smaller size, narrower whitelist) and is surfaced to the
   user at approval time as an explicit "we interpreted X as Y" note.
2. **No rule, no action.** Orders may only originate from a rule in `rules[]`. There is no
   free-form trading mode; "discretionary" is not a compilable intent in v1.
3. **The mandate is the permission scope.** The Agent OS permission grant the executor
   operates under is generated from `symbols`, `budget_usdt`, and
   `risk.forbidden_actions` — the agent structurally cannot trade outside the contract.
4. **Risk caps constrain deployment, never de-risking.** The per-order notional cap
   applies to buys only; a sell may exceed it up to position value. A mandate that
   forbids its own exit is a design bug, not a safety feature.
5. **Actions are an allowlist.** Only BUY/SELL within the mandate's whitelist exist.
   Unknown action verbs (margin, futures, transfers, anything new) are refused by
   default, not matched against a blocklist.
6. **Partial sells must clear exchange min notional.** A partial take-profit that would
   place an order below the exchange minimum (≈5 USDT on BTCUSDT) compiles to a full
   exit instead, with the interpretation surfaced at approval time.
7. **Approval is a gate, not a formality.** The executor refuses to start (and refuses to
   continue after any mandate edit) until `approved_at` is set on the current hash.

## Rule schema v2 — conditions, triggers, confluence

Signal rules express strategy logic over indicator series:

```jsonc
{
  "id": "r1",
  "kind": "signal",
  "action": "buy",                      // buy | sell
  "notional": 5,                        // buys only; sells default to full position
  "trigger": {
    "op": "at_least",                   // all | any | at_least (confluence voting) — omit for single condition
    "count": 2,
    "conditions": [
      { "left": { "indicator": "rsi", "params": { "period": 14 } }, "op": "below", "right": { "const": 38 } },
      { "left": { "indicator": "bb_pct" }, "op": "below", "right": { "const": 0.15 } },
      { "left": { "indicator": "volume_ratio" }, "op": "above", "right": { "const": 1.25 }, "for_bars": 2 }
    ]
  }
}
```

- **Indicators** (series from public OHLCV, all parameterized): `price`, `rsi`, `sma`, `ema`,
  `bb_pct`, `macd_hist`, `stoch`, `atr_pct`, `volume_ratio`, `roc`, `breakout_high`, `breakout_low`.
- **Ops**: `above`, `below`, `crosses_above`, `crosses_below` (series vs series, or vs a constant).
- **`for_bars`** (1–10) is persistence/verification: "held for N consecutive bars" (static ops only).
- **Groups** combine conditions: `all` (highest conviction), `any`, `at_least k` (confluence).
  The conviction level is the customer's dial; the risk envelope is untouched by it.
- Every fired rule reports its full condition table (each condition's values and ✓/✗) into
  the audit log — verification is visible, not implied.
- Validators refuse unknown indicators, unknown ops, oversized `for_bars`, and >5 conditions.

## Perps & leverage (design, pre-execution)

Envelopes carry `instrument: "spot" | "usdm_perp"` and `max_leverage` (desk-capped,
customer tightens only), isolated margin only. Caps apply to **exposure** (margin ×
leverage), not margin. The position guard composes three bounds and takes the tightest:
customer stop, desk drawdown floor, and **half the estimated liquidation distance** — the
desk always exits before the exchange's liquidation engine. Funding rates (public data)
are both a tracked cost line and an indicator condition. Perp *execution* unlocks when the
Agent OS MCP tool list is enumerated; the risk model above is instrument-agnostic.

## Worked example

Input (the demo persona):

> "Buy ₦50k of BTC every Friday. Sell 20% if it pumps 10%. Never lose more than ₦10k."

Compiles to: `symbols: ["BTCUSDT"]`, weekly recurring buy on FRIDAYS, partial take-profit
rule, `daily_loss_cap` from the "never lose more than" clause, NGN→USDT converted at
approval-time rate and shown to the user. Ambiguity ("₦10k total or per week?") resolves to
the tighter reading with a visible interpretation note.

## Risk model — four layers

1. **Order gate** (pre-trade): whitelist, per-order cap, min notional, action allowlist,
   revoked-customer check. No order enters without passing.
2. **Position guard** (continuous): every open position is evaluated every cycle against
   live price. Customer-declared `stop_loss_pct` / `take_profit_pct` exit on trigger; the
   desk-imposed `max_drawdown_pct` floor force-exits regardless of the customer's
   declarations — a customer who "believes" through a deep drawdown gets exited at the
   floor and the exit is logged as a desk-initiated `RISK_EXIT`. Exits are de-risking, so
   no cap can block them.
3. **Day guard** (account): `daily_loss_cap_usdt` halts the envelope until the next UTC day.
4. **Plug** (founder): revocation binds mid-flight; all further intents are refused.

Honesty note: v1 evaluates the guard on the polling cadence (closed bars in backtests,
~1-minute polling live); intrabar gap risk exists until websocket streams are added.
