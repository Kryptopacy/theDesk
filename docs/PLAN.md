# Build Plan — deadline 2026-09-08 23:59 UTC

**The moat is the clock: every hour before the deadline is an hour of runtime another entrant
cannot have. Tonight matters more than polish.**

Working days remaining: ~3.5 (today is 2026-09-05, Nigeria is UTC+1).

## Day 1 — tonight (2026-09-05) ⚡ FUND OPENS

- [x] Project scaffolded
- [ ] **USER:** connect MCP server (one URL + browser auth from Binance account)
- [ ] **USER:** follow @Binance + repost announcement (eligibility step, do now)
- [ ] **USER:** fund the dedicated Agent OS sub-account ($10 USDT — minimum viable; spot BTCUSDT min notional ≈ 5 USDT, so plan for a handful of minimum-size trades)
- [ ] **USER:** Track B qualifying trade — tiny SPOT trade via the MCP-connected agent, tonight
- [ ] Enumerate actual MCP tool list → confirms executor surface
- [x] Mandate v1 + executor core done & demo-verified (`src/main.mjs`): approval gate, mandate checker, refusal-with-clause, kill conditions, hash-chained audit log, multi-symbol ledger
- [x] Crowd amendment protocol (`src/amendment.mjs`): bounded variable zone, immutable hard bounds, degen-clamp + injection-refusal proven
- [x] Indicator signal engine (`src/indicators.mjs`, `src/signals.mjs`) on live Binance klines (keyless, multi-endpoint fallback) — mandate round-trip verified
- [x] Position guard (`src/riskguard.mjs`): customer SL/TP + immutable desk drawdown floor — deterministic + live-integrated demos pass
- [x] Paper mode (`src/paperbroker.mjs` + desk): first-class envelope mode — real prices, adverse slippage, free, audited, time-boxed (7d) with 402 graduation gate; books split paper/live funnel
- [x] Condition language v2 (`src/conditions.mjs`): series-vs-series conditions, all/any/at_least confluence groups, for_bars persistence, 12-indicator library (incl. macd/bollinger/stoch/atr) — confluence demo on live data passes; signals v2 migration regression-verified
- [x] Leverage design (`src/leverage-demo.mjs`): real funding + liquidation math, force-exit at half liq. distance; execution gated on MCP tool list
- [x] Backtest mode (`src/backtest.mjs`): walk-forward with full risk stack active (floor, loss cap, clamps), adverse slippage, HODL baseline — 3-mandate suite on live data passes
- [x] **PACKAGING (done 2026-09-05 night):** git repo + initial commit; dashboard (`dashboard/index.html` served at `/` — stats, funnel, envelopes, live feed); CONNECT.md (user's exact MCP checklist incl. server URL + permission toggles); MCP adapter skeleton (`src/mcp-broker.mjs`, real URL, tool names pending enumeration); compiler prompt (`docs/COMPILER_PROMPT.md`, few-shots incl. degen clamp); letter-01 draft
- [ ] **USER:** MCP connect per docs/CONNECT.md → I enumerate tool list, swap adapter, first real trade (Track B), clock starts
- [ ] **USER:** create empty public GitHub repo + send URL (I push); or install `gh` and I create it
- [ ] Letters 02+ daily; trailer on Day 3; survey
- [ ] LLM compiler prompt: crowd reply text → schema-valid proposal (in-session compilation works for the demo; needs a key for unattended runs)
- [ ] **First real order executed by the agent tonight → clock starts, banked runtime begins**

## Day 2 (2026-09-06)

- [ ] Hash-chained audit log hardened (JSONL, append-only)
- [ ] Public dashboard: static page reading pushed JSON, 5-minute cadence, free hosting
  (Vercel/GH Pages — spartan but live; degrade gracefully, no websockets)
- [ ] Daily letter generator: audit log → X-ready letter (post #1 goes out tonight)
- [ ] Kill-switch path: detect permission revocation → self-halt → mandate dead, logged
- [ ] Refusal behaviors on camera: out-of-whitelist symbol, over-cap order

## Day 3 (2026-09-07)

- [ ] Dress rehearsal: full trailer run-through, fix what breaks
- [ ] Dashboard polish (readable on a phone — judges will open it from X)
- [ ] Letter #2
- [ ] **USER:** record trailer (DEMO_SCRIPT.md, under 3:00), push GitHub public
- [ ] **USER:** post submission as final reply in the fund's X thread, early UTC evening
- [ ] **USER:** complete the survey

## Day 4 (2026-09-08) — deadline day

- [ ] Fund closes at a published time before 12:00 UTC: final P&L snapshot + closing letter
- [ ] Nothing new. Re-record buffer only. Submitted by 12:00 UTC at the latest.

## Standing decisions

- Track B trade is SPOT via the MCP agent (unambiguous eligibility; perps likely qualify but T&C unverifiable from here; futures min order sizes exceed the $10 fund anyway)
- Fund sized at $10 so every outcome is a good story — see README "no losing outcome"; trade activity will be sparse at min notional, so the dashboard's value is decision volume (every observation + reasoning logged, including decisions NOT to trade), not fill volume
- Payments/self-funding stretch: DROPPED (the live-fund frame replaced it; don't reopen scope)
