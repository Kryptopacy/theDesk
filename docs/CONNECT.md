# CONNECT — your checklist (the only steps that need your Binance login)

Source: official Agent OS docs (2026-08-20). Everything here takes ~5 minutes.

## 1. Add the MCP server (Claude Code)

```bash
claude mcp add binance-mcp-server --transport http https://agent.binance.com/mcp/agentic
```

(For this workspace the equivalent MCP config can go into the ZCode/agent config —
same URL, transport http.)

## 2. Authenticate

1. In the agent environment, run `/mcp` — `binance-mcp-server` should be listed.
2. Select it → **[Authenticate]** → browser opens the Binance auth page.
3. Choose the agent in the dropdown.
4. **Set permissions** — toggle what this agent can access. Recommended for the Desk:
   - ✅ Market data (order books, prices, klines)
   - ✅ Spot trading (Track B + house book)
   - ✅ Futures trading (perp envelopes — confirmed available via MCP)
   - ✅ Account: balances, positions, transfers (needed for the settlement leg)
   - ❌ Withdrawals — never
5. Permissions are reviewable any time under **[Sub Accounts] → [Account Management]**.
   **[Disconnect Agents]** revokes one agent; **[Emergency Stop]** revokes all — this is
   the kill switch the trailer demonstrates.

## 3. Fund + first trade (claims Track B)

1. Fund the dedicated Agent OS sub-account with **$10 USDT** (your float).
2. Say "go" in the session — I enumerate the actual MCP tool list, swap the live adapter
   in, and the first agent-executed **spot** trade goes through (tiny, unambiguous Track B
   eligibility). Perp envelopes come after spot is verified.

## What this unlocks, in order

1. Track B claim (first 10,000 pool — first-come first-served)
2. Live execution for the house book → the 72-hour runtime clock starts
3. Tool-list enumeration → MCP adapter constants → real perp execution capability
4. Transfers tool check → whether bill-settlement can run on-rails or is manual for the demo

## Eligibility (confirmed)

Nigeria is not in the excluded list (US, UK, EEA, HK, SG + prohibited jurisdictions).
Follow @Binance + repost the announcement, and complete the survey before the deadline.
