// Mandate loading + validation. The mandate is the only source of authority for the executor.
import { readFileSync } from "node:fs";

const REQUIRED_TOP = ["version", "id", "symbols", "quote_asset", "budget_usdt", "risk", "rules"];
const REQUIRED_RISK = ["max_order_notional_usdt", "daily_loss_cap_usdt", "max_open_orders", "forbidden_actions"];

export function loadMandate(path) {
  const m = JSON.parse(readFileSync(path, "utf8"));
  validateMandate(m);
  return m;
}

export function validateMandate(m) {
  for (const k of REQUIRED_TOP) if (m[k] === undefined) throw new Error(`mandate missing field: ${k}`);
  for (const k of REQUIRED_RISK) if (m.risk[k] === undefined) throw new Error(`mandate missing risk.${k}`);
  if (!Array.isArray(m.symbols) || m.symbols.length === 0) throw new Error("mandate.symbols must be a non-empty whitelist");
  if (!Array.isArray(m.rules) || m.rules.length === 0) throw new Error("mandate.rules must be non-empty");
  if (m.risk.max_order_notional_usdt <= 0) throw new Error("max_order_notional_usdt must be positive");
  return true;
}

export const isApproved = (m) => typeof m.approved_at === "string" && m.approved_at.length > 0;

export function approve(m, iso = new Date().toISOString()) {
  m.approved_at = iso;
  return m;
}
