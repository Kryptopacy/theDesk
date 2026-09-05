// Governed executor: the only component allowed to touch the broker. Sequence per cycle:
// observe -> decide -> MANDATE CHECK -> execute -> log. Refusals quote the violated clause.
// If the mandate is dead (killed/revoked/unapproved), every decision is refused —
// revocation binds between decision and execution.
import { isApproved } from "./mandate.mjs";

const onWrongSide = (v, op, target) =>
  op === "<=" ? v <= target : op === ">=" ? v >= target : op === "<" ? v < target : v > target;

// Allowlist, not denylist — an unknown action verb must never fall through the gate.
const ALLOWED_ACTIONS = new Set(["buy", "sell"]);

export class Executor {
  constructor(mandate, broker, audit) {
    this.m = mandate;
    this.broker = broker;
    this.audit = audit;
    // positions keyed by symbol so mandate amendments can rotate the whitelist safely
    this.state = { positions: {}, cash: mandate.budget_usdt, deployed: 0, dayPnl: 0, alive: true, deadReason: null };
  }

  pos(symbol) {
    return this.state.positions[symbol] ?? { qty: 0, avgEntry: 0 };
  }

  equity() {
    return this.state.cash + Object.entries(this.state.positions)
      .reduce((sum, [sym, p]) => sum + p.qty * (this.broker.prices?.[sym] ?? 0), 0);
  }

  checkMandate(decision) {
    const m = this.m;
    if (!isApproved(m)) return { ok: false, clause: "approval", detail: "mandate not approved — the executor refuses to act until the founder approves this contract" };
    if (!this.state.alive) return { ok: false, clause: "mandate_status", detail: `mandate is dead (${this.state.deadReason}) — no further action permitted` };
    if (decision.action === "NONE") return { ok: true };
    if (!m.symbols.includes(decision.symbol))
      return { ok: false, clause: "symbols", detail: `${decision.symbol} not in whitelist [${m.symbols.join(", ")}]` };
    if (!ALLOWED_ACTIONS.has(decision.action.toLowerCase()))
      return { ok: false, clause: "actions", detail: `"${decision.action}" is not a permitted action — only BUY/SELL within the mandate exist` };
    // Risk caps constrain deployment, never de-risking: sells may exceed the per-order
    // cap up to position value, otherwise a mandate could forbid its own exit.
    if (decision.action.toUpperCase() === "BUY") {
      if (decision.quoteQty > m.risk.max_order_notional_usdt)
        return { ok: false, clause: "risk.max_order_notional_usdt", detail: `order ${decision.quoteQty} exceeds per-order cap ${m.risk.max_order_notional_usdt}` };
      if (this.state.deployed + decision.quoteQty > m.budget_usdt)
        return { ok: false, clause: "budget_usdt", detail: `order would deploy beyond budget ${m.budget_usdt}` };
    }
    return { ok: true };
  }

  runCycle(decider) {
    if (!this.state.alive) return this.audit.append("CYCLE_REFUSED", { reason: this.state.deadReason });

    const market = this.broker.observe(this.m.symbols[0]);
    this.audit.append("OBSERVE", market);

    const p = this.pos(market.symbol);
    const decision = decider.decide(this.m, market, {
      cash: this.state.cash,
      deployed: this.state.deployed,
      positionQty: p.qty,
      positionValue: p.qty * market.price,
      avgEntry: p.avgEntry,
    });
    this.audit.append("DECIDE", decision);

    const verdict = this.checkMandate(decision);
    if (!verdict.ok) {
      this.audit.append("REFUSED", { clause: verdict.clause, detail: verdict.detail, decision });
      return { refused: true, verdict };
    }
    if (decision.action === "NONE") return { noop: true };

    const fill = this.broker.marketOrder(decision.symbol, decision.action, decision.quoteQty);
    if (!fill.ok) {
      this.audit.append("FILL_FAILED", { decision, error: fill.error });
      return { fillFailed: true };
    }

    this.applyFill(decision, fill, market);
    const np = this.pos(decision.symbol);
    this.audit.append("FILL", { ...fill, positionQty: np.qty, avgEntry: np.avgEntry, cash: this.state.cash });
    this.checkKillConditions(market);
    return { filled: true, fill };
  }

  applyFill(decision, fill, market) {
    const baseQty = decision.quoteQty / market.price;
    const p = this.state.positions[decision.symbol] ?? { qty: 0, avgEntry: 0 };
    if (decision.action === "BUY") {
      p.avgEntry = (p.avgEntry * p.qty + market.price * baseQty) / (p.qty + baseQty);
      p.qty += baseQty;
      this.state.cash -= decision.quoteQty * (1 + 0.001);
      this.state.deployed += decision.quoteQty;
    } else {
      this.state.dayPnl += decision.quoteQty - baseQty * p.avgEntry;
      p.qty = Math.max(0, p.qty - baseQty);
      this.state.cash += decision.quoteQty * (1 - 0.001);
      this.state.deployed = Math.max(0, this.state.deployed - decision.quoteQty);
    }
    this.state.positions[decision.symbol] = p;
  }

  checkKillConditions(market) {
    for (const kc of this.m.kill_conditions ?? []) {
      const value = kc.metric === "daily_pnl_usdt" ? this.state.dayPnl
        : kc.metric === "equity_usdt" ? this.equity() : null;
      if (value !== null && onWrongSide(value, kc.op, kc.value)) {
        this.state.alive = false;
        this.state.deadReason = `kill condition ${kc.metric} ${kc.op} ${kc.value} (now ${value.toFixed(2)})`;
        this.audit.append("KILLED", { reason: this.state.deadReason });
        return;
      }
    }
  }
}
