# The 72-Hour Fund

**An AI agent ran a real fund on Binance for the entire duration of the hackathon. This is its transcript.**

Built on [Binance Agent OS](https://www.binance.com/en/blog/ecosystem/5991233187660196794) for the Agent OS Mini Hackathon (Track A, deadline 2026-09-08 23:59 UTC).

## The concept

A micro-fund ($10 USDT — deliberately pocket-change, the "people's fund") managed end-to-end by an autonomous agent — opened when the hackathon clock started, closed at the submission deadline. Not a demo of an agent: **a living entry.**

- **Every decision is public, live.** A public dashboard streams the agent's full decision log — every market observation, every reasoning step, every order, every fill, running P&L — updated continuously. A black box recorder that isn't black.
- **It writes to its shareholders.** The agent publishes a daily letter on X: what it did, why, what it's watching. The submission isn't a one-shot post; it's the final entry in a thread the judges can scroll.
- **It cannot break its policy.** The fund operates under a mandate contract (whitelisted symbols, per-order notional cap, daily loss cap, kill conditions) enforced before every action — and the Agent OS permission grant is scoped to the mandate itself. The agent structurally cannot exceed it.
- **You can fire it mid-order.** Permissions are revocable at any moment; the revocation binds between decision and execution. Demonstrated live in the trailer.

## Why it's uncontestable

1. **Evidence, not claims.** 500 entries will ask judges to believe a video. This one says: *it is running right now — here's the URL, here's all of it.*
2. **The time moat.** Continuous audited autonomy cannot be faked, and another entrant starting Sept 7 has 24 hours of runtime, not 72. The clock is the component nobody can code around.
3. **No losing outcome.** Sized so every result is the good story: profit → it works. Loss → total transparency, public autopsy. Flat → 72 hours of discipline, zero rule breaks.
4. **It demos Binance's own pitch.** An agent holding real money under scoped, revocable permissions for 72 continuous hours is the strongest proof of their keyless-connect + kill-switch story — showcaseable by their social team as-is.

## Architecture

```
Market data (MCP) ──▶ ┌──────────────────────────────┐
                      │   Governed Executor           │──▶ Binance Agent OS MCP
Policy (mandate) ───▶ │   mandate checker → decide →  │    (scoped permissions,
                      │   order → verify → log        │     dedicated sub-account)
                      └──────┬───────────────┬────────┘
                             │               │
                     hash-chained       every N min:
                     audit log (JSONL)  push → public dashboard
                             │
                     daily shareholder letter (X)
```

**Agent OS components:** MCP server (trading + market data), dedicated sub-account, scoped/revocable permissions (the kill switch), mandate contract compiled from the founder's plain-English policy.

## Repo layout

- `docs/MANDATE_SPEC.md` — the fund policy contract (schema + worked example)
- `docs/DEMO_SCRIPT.md` — the 3-minute trailer beat sheet
- `docs/PLAN.md` — build plan; the moat = hours of runtime banked before the deadline
- `src/` — executor, audit log, dashboard feed, letter generator

## Submission mechanics

Track A: trailer video + this GitHub + survey, posted as the final reply in the fund's own X thread. Follow + repost the [announcement](https://www.binance.com/en/blog/community/8802181509900814931). Track B claimed by the fund's first spot trade.
