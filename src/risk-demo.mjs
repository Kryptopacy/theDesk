// Deterministic demo of the position guard (risk layer 2) over a labeled price path.
// Shows all three exits: customer take-profit, customer stop, and the desk floor
// overriding a looser customer stop. Run: node src/risk-demo.mjs
import { guardPosition } from "./riskguard.mjs";
import { AuditLog } from "./audit.mjs";

const audit = new AuditLog("audit/risk-demo.jsonl");
const log = (s) => console.log(s);

// Customer A: declares TP +15% and a tight stop at -8%. Desk floor is -10% (immutable).
const riskA = { max_drawdown_pct: 10, stop_loss_pct: 8, take_profit_pct: 15 };
let pos = null, realized = 0, fees = 0;

const enter = (price) => { pos = { qty: 5 / price, avgEntry: price }; audit.append("ENTRY", { price }); };
const exit = (price, guard) => {
  const pnl = pos.qty * (price - pos.avgEntry);
  const fee = pos.qty * price * 0.003;
  fees += fee; realized += pnl;
  audit.append("RISK_EXIT", { kind: guard.kind, price, drawdown_pct: +guard.drawdown_pct.toFixed(2), pnl: +pnl.toFixed(4) });
  log(`  EXIT [${guard.kind}] @ ${price} (drawdown ${guard.drawdown_pct.toFixed(2)}%) — realized ${pnl >= 0 ? "+" : ""}${pnl.toFixed(4)} USDT`);
  pos = null;
};

log("— Customer A: TP +15%, own stop -8%, desk floor -10% (immutable) —");
enter(100);
for (const price of [103, 107, 104]) {
  const g = guardPosition({ ...pos, price }, riskA);
  log(`  price ${price} → drawdown ${g.drawdown_pct >= 0 ? "+" : ""}${g.drawdown_pct.toFixed(2)}% → hold (inside envelope)`);
}
{ const g = guardPosition({ ...pos, price: 92 }, riskA); log(`  price 92 →`); exit(92, g); }
enter(100);
{ const g = guardPosition({ ...pos, price: 115 }, riskA); log(`  price 115 →`); exit(115, g); }

log("\n— Customer B: declares NO stop, stop -25% (looser than desk), desk floor -10% wins —");
const riskB = { max_drawdown_pct: 10, stop_loss_pct: 25, take_profit_pct: null };
enter(50);
for (const price of [48, 46.5, 45]) {
  const g = guardPosition({ ...pos, price }, riskB);
  log(`  price ${price} → drawdown ${g.drawdown_pct.toFixed(2)}% → ${g.exit ? "EXIT" : "hold"}${g.exit ? "" : " (customer's -25% stop would still be sleeping)"}`);
}
{ const g = guardPosition({ ...pos, price: 45 }, riskB); exit(45, g); }

log(`\n— books —`);
log(`realized ${realized >= 0 ? "+" : ""}${realized.toFixed(4)} USDT across all guarded exits, fees ${fees.toFixed(4)}`);
const v = audit.verify();
log(`audit chain: ${v.ok ? `VERIFIED (${v.events} events)` : "BROKEN"}`);
