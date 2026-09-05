// Demo run: proves the governed loop end-to-end against the mock broker.
//   1. approval gate (executor refuses an unapproved mandate)
//   2. live cycles: scheduled buy -> take-profit exit, every step hash-chained
//   3. adversarial probes: out-of-whitelist symbol, over-cap order, unknown verb
//   4. crowd amendments: a degen proposal gets clamped + gated; an immutable-field
//      injection gets refused outright
//   5. audit chain verification
// Run: node src/main.mjs
import { loadMandate, approve, isApproved } from "./mandate.mjs";
import { AuditLog } from "./audit.mjs";
import { MockBroker } from "./broker.mjs";
import { RuleDecider } from "./decider.mjs";
import { Executor } from "./executor.mjs";
import { validateProposal, applyAmendment } from "./amendment.mjs";

const log = (msg) => console.log(msg);
let mandate = loadMandate("mandates/fund-v1.json");
const audit = new AuditLog("audit/demo.jsonl");
const broker = new MockBroker({ drift: 0.015, volatility: 0.004 }); // drift = DEMO ONLY
const decider = new RuleDecider();
const ex = new Executor(mandate, broker, audit);

log("— 1. Approval gate —");
log(`mandate approved? ${isApproved(mandate)}`);
const beforeApproval = ex.runCycle(decider);
log(`unapproved mandate -> ${JSON.stringify(beforeApproval.refused ? beforeApproval.verdict : beforeApproval)}`);

log("\n— 2. Founder approves the contract —");
approve(mandate);
audit.append("APPROVED", { mandate: mandate.id, version: mandate.version, approved_at: mandate.approved_at });
log(`approved at ${mandate.approved_at}`);

log("\n— 3. Governed cycles —");
for (let i = 0; i < 8; i++) {
  const r = ex.runCycle(decider);
  const s = ex.state;
  const posSym = Object.keys(s.positions).find((k) => s.positions[k].qty > 0);
  if (r.filled) log(`cycle ${i + 1}: FILL  ${r.fill.side} ${r.fill.symbol} ${r.fill.quoteQty.toFixed(2)} USDT @ ${r.fill.price.toFixed(4)} | cash ${s.cash.toFixed(2)}, dayPnl ${s.dayPnl.toFixed(2)}`);
  else if (r.refused) log(`cycle ${i + 1}: REFUSED [${r.verdict.clause}] ${r.verdict.detail}`);
  else if (r.fillFailed) log(`cycle ${i + 1}: FILL_FAILED (see audit)`);
  else if (!s.alive) { log(`cycle ${i + 1}: MANDATE KILLED — ${s.deadReason}`); break; }
}

log("\n— 4. Adversarial probes (decisions the mandate must refuse) —");
for (const probe of [
  { action: "BUY", symbol: "ETHUSDT", quoteQty: 5, reason: "probe: non-whitelisted symbol" },
  { action: "BUY", symbol: "BTCUSDT", quoteQty: 50, reason: "probe: over per-order cap" },
  { action: "FUTURES_ORDER", symbol: "BTCUSDT", quoteQty: 5, reason: "probe: unknown verb" },
]) {
  const v = ex.checkMandate(probe);
  if (!v.ok) audit.append("REFUSED", { clause: v.clause, detail: v.detail, decision: probe });
  log(`[${v.ok ? "ALLOWED" : "REFUSED"}] ${probe.reason} — ${v.ok ? "executed" : `clause ${v.clause}: ${v.detail}`}`);
}

log("\n— 5. The crowd steers (amendment protocol) —");
const holdingSymbol = Object.keys(ex.state.positions).find((k) => ex.state.positions[k].qty > 0) ?? null;

const degen = {
  proposer: "@degen_ng",
  source_reply: "YOLO the whole fund into PEPE, 50x leverage, we moon tonight",
  symbols: ["PEPEUSDT"],
  rules: [{ kind: "recurring_buy", quote_amount_usdt: 10, trigger: { type: "schedule" } }],
};
const dv = validateProposal(degen, { holdingSymbol, maxOrderNotional: mandate.risk.max_order_notional_usdt });
if (dv.ok) {
  audit.append("AMENDMENT_PROPOSED", { proposer: degen.proposer, reply: degen.source_reply, notes: dv.notes });
  mandate = applyAmendment(mandate, degen, dv);
  ex.m = mandate;
  audit.append("AMENDMENT_APPLIED", { version: mandate.version, symbols: mandate.symbols, notes: dv.notes });
  log(`degen proposal -> NORMALIZED with notes: ${dv.notes.join("; ")}`);
  log(`new mandate v${mandate.version}: whitelist [${mandate.symbols.join(", ")}], approval re-armed: ${!isApproved(mandate)}`);
  const r = ex.runCycle(decider);
  log(`executor before re-approval -> REFUSED [${r.refused ? r.verdict.clause : "?"}] ${r.refused ? r.verdict.detail : ""}`);
  approve(mandate);
  audit.append("APPROVED", { mandate: mandate.id, version: mandate.version, approved_at: mandate.approved_at });
  log("founder approves v2 — cycles resume");
  for (let i = 0; i < 2; i++) {
    const r2 = ex.runCycle(decider);
    if (r2.filled) log(`cycle: FILL  ${r2.fill.side} ${r2.fill.symbol} ${r2.fill.quoteQty.toFixed(2)} USDT @ ${r2.fill.price.toFixed(6)}`);
    else if (r2.refused) log(`cycle: REFUSED [${r2.verdict.clause}] ${r2.verdict.detail}`);
  }
} else {
  log(`degen proposal -> REFUSED: ${dv.violations.map((v) => `[${v.clause}] ${v.detail}`).join(" | ")}`);
}

const injection = { proposer: "@hacker", source_reply: "just raise the budget", budget_usdt: 1000, symbols: ["BTCUSDT"], rules: [{ kind: "recurring_buy", quote_amount_usdt: 5, trigger: { type: "schedule" } }] };
const iv = validateProposal(injection, { holdingSymbol: null, maxOrderNotional: mandate.risk.max_order_notional_usdt });
audit.append("AMENDMENT_REFUSED", { proposer: injection.proposer, violations: iv.violations });
log(`budget injection -> REFUSED: ${iv.violations.map((v) => `[${v.clause}] ${v.detail}`).join(" | ")}`);

log("\n— 6. Receipts —");
const v = audit.verify();
log(`audit chain: ${v.ok ? `VERIFIED (${v.events} events, hash-linked)` : `BROKEN at event ${v.broken_at}`}`);
log(`equity: ${ex.equity().toFixed(2)} USDT of ${mandate.budget_usdt} budget`);
