// Amendment protocol: how the crowd (or the founder) proposes changes to the mandate.
// The crowd steers inside a bounded variable zone; the hard bounds are immutable and the
// validator refuses anything outside them. Applying an amendment re-arms the approval
// gate — the founder must approve the new version before the executor acts again.

import { INDICATORS, OPS } from "./conditions.mjs";

export const SYMBOL_UNIVERSE = [
  "BTCUSDT", "ETHUSDT", "BNBUSDT", "SOLUSDT", "XRPUSDT", "DOGEUSDT", "ADAUSDT",
  "TRXUSDT", "LINKUSDT", "AVAXUSDT", "TONUSDT", "SHIBUSDT", "DOTUSDT", "NEARUSDT",
  "APTUSDT", "PEPEUSDT", "LTCUSDT", "SUIUSDT", "ARBUSDT", "OPUSDT",
];

const RULE_KINDS = new Set(["recurring_buy", "take_profit_full", "dip_buy", "signal"]);
const IMMUTABLE_FIELDS = new Set(["budget_usdt", "risk", "quote_asset", "kill_conditions", "id"]);
const PROPOSAL_FIELDS = new Set(["proposer", "source_reply", "symbols", "rules", "schedule", "note"]);

function validateSignalRule(r, violations) {
  if (!["buy", "sell"].includes(r.action)) { violations.push({ clause: "rules", detail: "signal rule needs action buy|sell" }); return; }
  const t = r.trigger;
  const conds = t?.conditions ?? (t?.left ? [t] : null);
  if (!conds || conds.length === 0 || conds.length > 5) { violations.push({ clause: "rules", detail: "signal rules need 1-5 conditions" }); return; }
  for (const c of conds) {
    if (c.left?.indicator && !INDICATORS[c.left.indicator]) violations.push({ clause: "rules", detail: `unknown indicator "${c.left.indicator}"` });
    if (c.right?.indicator && !INDICATORS[c.right.indicator]) violations.push({ clause: "rules", detail: `unknown indicator "${c.right.indicator}"` });
    if (!OPS.has(c.op)) violations.push({ clause: "rules", detail: `unknown op "${c.op}"` });
    if (c.for_bars != null && (!(c.for_bars >= 1) || c.for_bars > 10)) violations.push({ clause: "rules", detail: "for_bars must be 1-10" });
  }
  if (t?.op === "at_least" && (!(t.count >= 1) || t.count > conds.length))
    violations.push({ clause: "rules", detail: "at_least count must be between 1 and the number of conditions" });
}

export function validateProposal(p, ctx = {}) {
  const violations = [];
  const notes = [];

  for (const k of Object.keys(p)) if (!PROPOSAL_FIELDS.has(k)) violations.push({ clause: "schema", detail: `unknown proposal field "${k}"` });
  for (const k of Object.keys(p).filter((k) => IMMUTABLE_FIELDS.has(k)))
    violations.push({ clause: "immutable", detail: `"${k}" cannot be changed by any proposal — the crowd cannot raise the budget or touch risk bounds` });

  const symbols = p.symbols ?? [];
  if (!Array.isArray(symbols) || symbols.length === 0 || symbols.length > 3)
    violations.push({ clause: "symbols", detail: "proposal must whitelist 1-3 symbols" });
  for (const s of symbols) if (!SYMBOL_UNIVERSE.includes(s)) violations.push({ clause: "symbols", detail: `${s} is outside the tradable universe` });
  if (ctx.holdingSymbol && symbols.length && !symbols.includes(ctx.holdingSymbol))
    violations.push({ clause: "symbols", detail: `fund holds an open ${ctx.holdingSymbol} position — an amendment cannot strand it; include it until flat` });

  const rules = p.rules ?? [];
  if (!Array.isArray(rules) || rules.length === 0) violations.push({ clause: "rules", detail: "proposal must contain at least one rule" });
  const normalized = [];
  for (const r of rules) {
    if (!RULE_KINDS.has(r.kind)) { violations.push({ clause: "rules", detail: `rule kind "${r.kind}" is not expressible — unknown intents cannot be compiled` }); continue; }
    if (r.kind === "signal") validateSignalRule(r, violations);
    const nr = { ...r };
    if (r.kind === "recurring_buy") {
      let amt = Number(r.quote_amount_usdt);
      if (!(amt > 0)) { violations.push({ clause: "rules", detail: "recurring_buy needs a positive quote_amount_usdt" }); continue; }
      if (amt > ctx.maxOrderNotional) { amt = ctx.maxOrderNotional; notes.push(`buy size clamped to the ${ctx.maxOrderNotional} USDT per-order cap (proposed ${r.quote_amount_usdt})`); }
      nr.quote_amount_usdt = amt;
    }
    if ((r.kind === "take_profit_full" || r.kind === "dip_buy") && !(Number(r.trigger?.pct) > 0))
      violations.push({ clause: "rules", detail: `${r.kind} needs a positive trigger.pct` });
    normalized.push(nr);
  }

  if (p.schedule && p.schedule.recurrence && !["daily", "weekly"].includes(p.schedule.recurrence))
    violations.push({ clause: "schedule", detail: `recurrence "${p.schedule.recurrence}" not permitted` });

  return { ok: violations.length === 0, violations, notes, normalized, symbols: [...new Set(symbols)] };
}

export function applyAmendment(mandate, proposal, validated) {
  const m2 = structuredClone(mandate);
  m2.version += 1;
  m2.symbols = validated.symbols;
  m2.rules = validated.normalized;
  m2.schedule = proposal.schedule ?? null;
  m2.created_from = proposal.source_reply;          // verbatim crowd reply becomes the policy text
  m2.amended_from = proposal.proposer;
  m2.approved_at = null;                            // re-arms the approval gate
  return m2;
}
