# Submission checklist — Agent OS Mini Hackathon, Track A

Deadline: **2026-09-08 23:59 UTC**. Do the mechanics early — they're disqualifying if missed.

## Mechanics (do now, in this order)

1. [ ] Follow [@Binance](https://x.com/binance) and repost the announcement
2. [ ] Post [letter-01](letter-01.md) as the desk's own thread (text + dashboard screenshot + books URL)
3. [ ] Reply strategies arrive → compile them (`node src/signals-demo.mjs` flow), clamp/refuse on the record, reply with receipts
4. [ ] **Quote-repost the announcement** with: trailer video + GitHub link + one-line pitch
5. [ ] Complete the survey (link on the announcement page)
6. [ ] Track B: first real spot trade through the MCP server (claims a $4 slot — also the live proof for Track A)

## Quote-repost copy (final, edit free)

> An AI agent now runs a trading desk on Binance. You send the strategy, it executes
> under a risk contract it cannot break — whitelist, caps, an immutable drawdown floor,
> revoked mid-order if it misbehaves — and it charges a fee per fill, publicly, on
> hash-chained books.
>
> Everyone demos agents that trade. The missing layer is an agent that refuses, clamps,
> and gets fired between its thought and its trade. That's the product.
>
> Built on Binance Agent OS (MCP). GitHub: [link] · Live books: [link] · [trailer]

## What the judges see, in order (60-second skim)

1. Trailer: clamp → refusal → desk-floor force-exit → kill switch. 60–90s, captions.
2. README hero: the books screenshot + "revenue is not alpha" line.
3. Live books URL (public read-only instance below) — not a localhost claim.
4. Code: `desk.mjs` (routes), `riskguard.mjs` + the 10s guard sweep, `audit.mjs` (hash chain).

## Public read-only books (while judging is live)

```bash
DESK_PUBLIC=1 PORT=8899 DESK_AUDIT=audit/desk-public.jsonl node src/desk.mjs   # read-only books
./.tools/cloudflared.exe tunnel --url http://localhost:8899                     # quick tunnel, no account
```

`DESK_PUBLIC=1` strips every POST route (no intents, no onboarding, no revocations).
For a longer-lived URL, deploy the same command to any free host (Render/Railway) —
the tunnel is fine for the trailer and the first days of the thread.

## Remaining unblocks (owner: you)

- [ ] MCP connect: `docs/CONNECT.md` steps (5 min) → then `node src/mcp-enumerate.mjs` → paste TOOL map into `src/mcp-broker.mjs` → swap broker in `desk.mjs`
- [ ] Fund the sub-account with the $10 float → first real fill flips self-funded % off zero
- [ ] Record trailer with the live-MCP beat (docs/RECORDING.md)
