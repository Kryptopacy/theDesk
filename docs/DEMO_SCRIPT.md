# Demo Script — 3-minute trailer

Rule: everything is live. No slides, no mocked fills, no cuts inside a beat.
The desk must be running against the real Agent OS MCP server before recording.

## Beat sheet

**0:00–0:10 — Hook.**
Screen on the public books dashboard, feed scrolling, self-funded % ticking.
VO: *"This is a trading desk run by an AI. It charges rent per trade, pays its own
hosting bill, and cannot break its own rules — watch me try to make it."*

**0:10–0:50 — Plain English → mandate.**
Paste a degen reply live: "YOLO into PEPE, 50x leverage." The compiler clamps it:
size → cap, leverage unexpressible, note recorded. Approve the contract. Show the
Agent OS permission grant scoped to the mandate (keyless, from the Binance side).

**0:50–1:50 — Governed execution.**
A real signal arrives (webhook/alert). Order hits the MCP server → fills on the
dedicated sub-account → Binance order history next to the books line. Then the
attacks: a 250-USDT intent **clamped** to the cap mid-request; an out-of-whitelist
symbol **refused** with the clause quoted; a position walked into the desk floor and
**force-exited** with a `RISK_EXIT` on the books.

**1:50–2:30 — The kill switch.**
The desk is mid-decision on a live order. Revoke the agent's permission from Binance
([Disconnect Agents] — or Emergency Stop). Show: decision made → execution refused →
desk marks the customer dead, books record it. VO: *"Revoked between its thought and
its trade."*

**2:30–3:00 — Receipts + close.**
Three artifacts agreeing: the public books, the hash-chained audit log, the Binance
order history. Then the funnel line: *"Same mandate, three stages — backtest, paper
on live prices, live. Only the broker changes."* Close: *"It's been running since
day one of the hackathon. The URL is in the post. Built on Binance Agent OS."*

## Pre-flight checklist

- [ ] Real MCP connection verified; at least one real fill already on the books
- [ ] Kill-switch beat rehearsed twice — it is the moment, do not improvise it
- [ ] Timer run-through: under 3:00 with room to breathe
- [ ] 1080p minimum; dashboard font readable on a phone screen
- [ ] Sub-account balance visible once for transparency
