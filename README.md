# The Desk

**An AI agent runs a trading desk on Binance. You keep the strategy, it keeps the discipline, and it charges rent.**

Built on [Binance Agent OS](https://www.binance.com/en/blog/ecosystem/5991233187660196794) for the Agent OS Mini Hackathon (Track A, deadline 2026-09-08 23:59 UTC).

The Desk is an execution & risk layer: customers pipe signals in — a plain-English strategy, an indicator rule set, or raw trade intents from any webhook or bot — and the desk executes them on Binance under per-customer **risk envelopes**, charging a fee per fill. It pays its own hosting and inference bills from that revenue, and every decision lands on public, hash-chained books.

> Signals are untrusted; bounded downside is the product. The customer's strategy decides when to enter; the desk guarantees the worst-case exit.

## Why this is different

1. **Revenue is not alpha.** "The agent pays its bills" is usually backed by trading luck. Here it's backed by customer fees — an honest P&L with a `self-funded %` line on the public books.
2. **Every input passes the same gate.** A webhook has no privileges an internal engine doesn't have. Over-cap intents get **clamped, on the record**; out-of-whitelist symbols get refused with the clause quoted.
3. **One mandate, three stages.** `backtest → paper → live` — same contract, same risk engine, same adverse-slippage assumption; only the broker changes. Backtests run the full risk stack (desk floor, loss cap, clamps), so strategies that would have been force-exited don't get to look good.
4. **It's the layer, not a rival.** Per-customer envelopes map 1:1 onto Agent OS's own primitives: dedicated sub-accounts, granular per-feature permissions, individual disconnect, emergency killswitch — demonstrated mid-order in the demo.

## The risk stack (active on every intent)

1. **Order gate** — whitelist, per-order cap, exchange min notional, BUY/SELL allowlist, revoked-customer check
2. **Position guard** — customer stop-loss / take-profit plus an **immutable desk drawdown floor** (tighten-only). Open positions are re-priced and guarded on a 10s sweep, not just when an intent arrives; force-exits are logged as desk-initiated `RISK_EXIT` and never blocked by caps or min-notional (closing a position is de-risking). Perp envelopes: the floor is taken at half the estimated liquidation distance — the desk always exits before the liquidation engine
3. **Day guard** — daily loss cap halts the envelope until the next UTC day
4. **The plug** — founder revocation binds mid-flight

## The rule language

Indicators are series; conditions compare series-to-series or series-to-constant (`above` / `below` / `crosses_above` / `crosses_below`); triggers combine with `all` / `any` / `at_least k` — **confluence as a primitive** — and `for_bars` adds persistence ("RSI below 35 *for 2 bars*"). Library from keyless public OHLCV: `rsi`, `sma`, `ema`, `bb_pct`, `macd_hist`, `stoch`, `atr_pct`, `volume_ratio`, `roc`, `breakout_high`, `breakout_low`. Unknown vocabulary is refused by the validators — including for plain-English compilations ([COMPILER_PROMPT](docs/COMPILER_PROMPT.md)).

## Architecture

```
signals:  plain English ──▶ compiler ──▶ proposal ──▶ validate ──▶ founder approval ──┐
          indicator rules (Binance klines, keyless) ─────────────────────────────────┤
          HTTP intents (webhooks, bots, Telegram, TradingView) ──────────────────────┤
                                                                                      ▼
                        ┌──────────────────────────────────────────────────────────────────┐
                        │  THE DESK                                                        │
                        │  envelope gate → position guard → day guard → kill switch        │
                        └──────────────┬───────────────────────────────────┬───────────────┘
                                       │                                   │
                        broker: backtest │ paper (live prices) │ live (Agent OS MCP)   
                                       │                                   │
                        hash-chained audit log ◀───────────────────────────┘
                                       │
                        public books (dashboard) + per-fill fees → self-funding ledger
```

**Agent OS components:** MCP server (`https://agent.binance.com/mcp/agentic` — Spot / Futures / Convert, market data, account), dedicated sub-account, granular permissions + killswitch. Perp execution unlocks at tool enumeration; the risk model is already instrument-agnostic (funding as a cost line and an indicator condition; isolated margin; exposure caps).

**Self-serve:** composition happens on the front end against the same validator the founder uses — strangers compose, they never submit code. Paper envelopes are issued instantly (free, 7-day box); live envelopes are the graduation gate. Public mode (`DESK_PUBLIC=1`) exposes books + `/onboard` + the intent API, strips founder routes unless a strong founder key is set, and throttles proposals (6/hour/address, 100/day).

**Connection tiers (production roadmap):** (1) customer's own Agent OS keyless connection — no secret touches the desk (preferred, demoed); (2) customer **sub-account** API keys — read+trade scopes only, no-withdrawal enforced, IP-pinned, write-only encrypted intake, instant revoke by deleting the key; (3) fee collection on customer accounts via Binance's **OMS-provider mechanism** (API-Key Terms §6: Binance collects a provider's per-trade fee as a markup on transaction fees) — the exchange-native rail for per-fill billing.

## Repo layout

- `src/desk.mjs` — the desk: HTTP API, envelopes, fee meter, public books (`GET /` = dashboard)
- `src/envelope.mjs`, `riskguard.mjs` — the risk gate and position guard (pure functions, shared by every input path)
- `src/conditions.mjs`, `indicators.mjs`, `signals.mjs` — rule language + engine
- `src/mandate.mjs`, `executor.mjs`, `audit.mjs` — mandate contract, governed executor, hash-chained audit log
- `src/broker.mjs` (mock) · `paperbroker.mjs` (live prices) · `mcp-broker.mjs` (Agent OS adapter) · `mcp-enumerate.mjs` (connect-day: enumerate the real MCP tool list, print the TOOL map) · `backtest.mjs` (walk-forward)
- `dashboard/index.html` — public books page · `dashboard/onboard.html` — the counter (`/onboard`): strangers compose a mandate from the bounded vocabulary and get a paper envelope instantly; graduation to live is the founder's yes. Refused proposals land on the audit chain, quoted verbatim.
- `docs/` — [MANDATE_SPEC](docs/MANDATE_SPEC.md) · [PLAN](docs/PLAN.md) · [DEMO_SCRIPT](docs/DEMO_SCRIPT.md) · [CONNECT](docs/CONNECT.md) · [COMPILER_PROMPT](docs/COMPILER_PROMPT.md) · [letter-01](docs/letter-01.md)

## Try it

```bash
node src/desk.mjs          # desk on :8787 — dashboard at http://localhost:8787
node src/backtest.mjs      # walk-forward suite on live data
node src/signals-demo.mjs  # indicator mandate, live klines
node src/main.mjs          # governed-loop demo

DESK_PUBLIC=1 PORT=8899 node src/desk.mjs   # public read-only books — GET-only, tunnel or deploy this
```

## Submission

Track A: trailer + this repo + survey, posted as a reply in the desk's X thread ([letter 01](docs/letter-01.md) opens it). Follow + repost the [announcement](https://www.binance.com/en/blog/community/8802181509900814931). Track B is claimed by the desk's first real spot trade.
