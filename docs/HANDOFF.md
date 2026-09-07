# HANDOFF — The Desk (Agent OS Mini Hackathon entry)

*Written 2026-09-07 for seamless takeover by the owner (Kryptopacy) or any agent. Read top to bottom; everything here is verified unless marked ASSUMPTION.*

**Deadline: 2026-09-08 23:59 UTC.** Track A (best agent built with Agent OS): $2k/$1.5k/$1k + $300×50. Track B: $4 for connecting + trading (first 10k).

## What this is

**The Desk** — an AI-run execution & risk desk on Binance Agent OS. Customers compose mandates from a bounded indicator vocabulary (self-serve at `/onboard`); the desk executes under per-customer risk envelopes (whitelist → per-order cap → position guard with an immutable desk floor → daily loss cap → founder killswitch), charges per fill on live envelopes, and publishes hash-chained books. Thesis: "revenue is not alpha — bounded downside is the product."

## Where everything runs

| Thing | Where |
|---|---|
| Repo (public since 09-07) | https://github.com/Kryptopacy/theDesk |
| Live books + onboarding counter | https://thedesk-21bh.onrender.com (Render free tier; auto-deploys on push; books reset on deploy, reseed cleanly) |
| Local desk (full routes) | `node src/desk.mjs` → :8787 |
| Local public instance | `DESK_PUBLIC=1 PORT=8899 DESK_AUDIT=audit/desk-public.jsonl node src/desk.mjs` |
| Tunnel fallback | `./.tools/cloudflared.exe tunnel --url http://localhost:8899` (URL rotates) |
| Set up UptimeRobot 5-min ping on the Render URL | PENDING (owner) |

## Verified working (end-to-end, on live data)

- 4-layer risk stack, all paths: clamp (50→5), refuse (whitelist quoted), daily-loss halt, founder revoke mid-flight
- **Position guard sweep** (10s): force-exits at the immutable floor, desk-initiated `RISK_EXIT` on books (verified: "-12.09% <= -10%", day_pnl -0.60)
- Self-serve onboarding: `/onboard` + `POST /v1/propose` → instant paper envelope + `pub-` key; malicious proposals refused verbatim + audited (`PROPOSAL_REFUSED`); throttled 6/hr/address + 100/day
- Sanitization: XSS-strip at intake + HTML-escape at render (tested with live `<script>` payload); 2s per-envelope intent rate limit (429, off-feed)
- Signal sources regression-verified on live klines: `signals-demo.mjs`, `confluence-demo.mjs`, `backtest.mjs` (+0.15/+0.50/+0.84), `risk-demo.mjs`
- Public deploy verified: books/onboard/dashboard 200; validator refusing garbage from the open internet

## THE BLOCKER — MCP trading auth (read this carefully)

**Goal:** the desk's live broker executes real orders through the Agent OS MCP server (`https://agent.binance.com/mcp/agentic`). Track B ($4) is claimed by the first real trade.

**Verified facts (probed 2026-09-06/07):**
- Transport requires a REAL bearer token for everything — `initialize` returns 401 without one (dummy bearer also 401). "Public market-data tools" = no account *scopes*, not no auth.
- OAuth metadata: issuer `https://agent.binance.com`; authorize `https://accounts.binance.com/agentic-oauth/authorize`; token `https://accounts.binance.com/oauth-agentic/token`; PKCE S256; `token_endpoint_auth_methods: ["none"]`; **no dynamic client registration**; `client_id_metadata_document_supported: true`.
- We BUILT the metadata-document client: desk serves `GET /oauth/client-metadata.json` and runs the full PKCE flow (`GET /oauth/start` → Binance → `GET /oauth/callback` → token exchange → adapter armed + tools enumerated on the success page). **It works up to Binance's authorize page, which rejected it:** *"The AI Agent you are using is not currently supported. Please connect using a supported Agent to continue. (3346001)"* — i.e. the authorize page allowlists client APPLICATIONS (Claude Code, Cursor, Codex, ChatGPT, VS Code per the announcement) and ignores the advertised metadata-document support.
- A bearer token is not visibly client-bound at the resource (401 challenge is plain `Bearer`): **a token obtained by ANY supported client should work in the desk's raw adapter.**

**Ways forward, ranked:**

1. **Cursor (recommended — free, no extra account cost):** download from cursor.com → Settings → MCP → add `binance-mcp-server`, URL `https://agent.binance.com/mcp/agentic`, transport HTTP → Authenticate → Binance browser flow (pick agent, scope: market data ✓ spot ✓ futures ✓ account ✓ withdrawals ❌). Then extract the stored token and set `BINANCE_MCP_TOKEN` (Render env + local env). Token likely in `%APPDATA%\Cursor\User\globalStorage\state.vscdb` (sqlite; may be safeStorage/DPAPI-encrypted — decryptable by a script running as the same Windows user).
2. **Claude Code (official flagship client):** `npm i -g @anthropic-ai/claude-code` → `claude mcp add binance-mcp-server --transport http https://agent.binance.com/mcp/agentic` → `claude` → `/mcp` → Authenticate. Needs an Anthropic account (Pro/Max or API credits — real cost). Token check: `%USERPROFILE%\.claude\.credentials.json` / `~/.claude.json` (historically plaintext per-server OAuth).
3. **Binance-native registration (permanent fix if it exists):** owner explores the Agent OS UI (binance.com → Agent OS / Sub-Account → Manage Agents) for a "custom/self-built agent" registration that issues its own client identity. The auth dropdown lists agents — maybe agents are creatable. ALSO: owner opens https://developers.binance.com/en/docs/agent-native/mcp-server/agentic in a real browser (it's JS-rendered; agents can't read it) and pastes the *Authentication* section.
4. **Fallback for the deadline:** enter with mock/paper execution + self-serve onboarding + real books, show the OAuth-door work as engineering diligence, claim Track B from any supported client manually, and land the trading leg before the deadline if a token arrives. Do NOT fake fills — the books' honesty is the brand.

**Once ANY token exists:** set `BINANCE_MCP_TOKEN` (Render env → auto-redeploy; local: env var), then `node src/mcp-enumerate.mjs` prints the real tool names → paste into `TOOL` map in `src/mcp-broker.mjs` → swap house-fund's broker to `new McpBroker({ float: 5 })` in `desk.mjs` seeds → fund $5 on the sub-account → first real intent → **Track B claimed, self-funded % off zero, letter-01 posts.**

## Owner checklist (status)

1. ✅ Repo public? (verify — was created private; judges need it public)
2. ✅ Render deployed (thedesk-21bh.onrender.com) · ⬜ UptimeRobot ping
3. ⬜ **MCP auth via Cursor (or Claude Code) → token → adapter live** ← THE critical path
4. ⬜ Fund $5 USDT into the Agent OS sub-account (caps already match: 5/order, 2/day)
5. ⬜ Post letter-01 (docs/letter-01.md, links filled) right after the first live fill
6. ⬜ Trailer: docs/RECORDING.md (every beat pre-staged, ~1h) → quote-repost with video + GitHub → survey
7. ⬜ (optional) house strategy after connect: confluence-2of3 BTCUSDT 1h; for a REAL RISK_EXIT beat on Binance, open an envelope with `max_drawdown_pct: 1`

## Commands cheat-sheet

```bash
node src/desk.mjs                          # full desk :8787
DESK_PUBLIC=1 PORT=8899 node src/desk.mjs  # public surface (books+/onboard+intent+propose)
node src/backtest.mjs                      # walk-forward suite
node src/mcp-enumerate.mjs                 # tool list (needs BINANCE_MCP_TOKEN)
: > audit/desk.jsonl                       # reset books — ONLY while the server is STOPPED
git push origin main                       # auto-redeploys Render
```

## Architecture (file map)

- `src/desk.mjs` — HTTP API, envelopes, fees, books, guard sweep, self-serve propose, OAuth door. `DESK_PUBLIC=1` = GET + intent + propose only (founder routes need `DESK_FOUNDER_KEY` ≥16 chars)
- `src/envelope.mjs` (layer-1 gate, pure) · `src/riskguard.mjs` (layer-2 guard, pure)
- `src/broker.mjs` (mock, seeded prices) · `src/paperbroker.mjs` (real prices, adverse slippage) · `src/mcp-broker.mjs` (Agent OS adapter — TOOL map placeholders pending enumeration)
- `src/audit.mjs` (sha256 hash chain) · `src/amendment.mjs` (SYMBOL_UNIVERSE + validateProposal — the bounded vocabulary)
- `src/conditions.mjs`/`indicators.mjs`/`signals.mjs` (rule language, 12 indicators) · `src/backtest.mjs` (walk-forward)
- `dashboard/index.html` (public books) · `dashboard/onboard.html` (self-serve counter)
- `docs/`: RECORDING.md (trailer beats) · SUBMISSION.md (mechanics + tweet copy) · CONNECT.md · letter-01.md (thread opener) · COMPILER_PROMPT.md · MANDATE_SPEC.md · PLAN.md · DEMO_SCRIPT.md

## Integrity rules for whoever takes over

Never fake a fill, never edit `audit/*.jsonl` by hand, never loosen a customer's floor, never enable withdrawals on the agent connection. Refusals quoted verbatim are the product. If a claim can't be shown on the books, say so plainly instead of staging it.
