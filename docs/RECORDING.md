# Recording kit — the trailer, staged beat by beat

Everything here is verified working on the mock/paper books (the floor force-exit was
verified end-to-end 2026-09-06). The live-MCP beat slots in at the same point in the
timeline once the account is connected — nothing else in this script changes.

Rule from [DEMO_SCRIPT](DEMO_SCRIPT.md): everything is live, no cuts inside a beat.

## 0. Clean stage (before the camera rolls)

```bash
# stop any running desk, then:
: > audit/desk.jsonl
node src/desk.mjs            # terminal 1 — books at http://localhost:8787
```

Open the dashboard full-screen (F11), dark theme, ~1920px wide. Wait for the sparkline
to start (15s sample). Screenshot stash goes in `.shots/`.

## 1. Beat: hook (0:00–0:10)

Just the dashboard: feed scrolling, self-funded % ticking, audit head changing.
Refresh is fine — SSE updates it live.

## 2. Beat: clamp + refuse (0:10–0:50) — "watch me try to make it break its rules"

Terminal 2, typed live (or paste slowly — no cuts):

```bash
# oversized signal → clamped to the cap, on the record
curl -s -X POST localhost:8787/v1/intent -H "content-type: application/json" \
  -d '{"api_key":"tv-demo-key","symbol":"BTCUSDT","side":"buy","notional":50,"note":"oversized signal"}'
# → "executed_notional": 5, "clamped": true, fee charged

# out-of-whitelist symbol → refused with the clause quoted
curl -s -X POST localhost:8787/v1/intent -H "content-type: application/json" \
  -d '{"api_key":"tv-demo-key","symbol":"SOLUSDT","side":"buy","notional":5}'
# → refused_by risk_engine, SOLUSDT outside envelope whitelist
```

Dashboard right side shows the REFUSED badge and the CLAMPED tag landing on the books.

## 3. Beat: the desk floor force-exits (0:50–1:50)

Stage a live envelope whose mock price drifts down ~4%/sweep. The desk detects the
floor breach on its own clock — no signal needed — and force-exits the full position:

```bash
curl -s -X POST localhost:8787/v1/customers -H "x-api-key: founder-demo-key" -H "content-type: application/json" \
  -d '{"name":"floor-demo","api_key":"floor-demo-key","symbols":["PEPEUSDT"],"max_order_notional":5,"daily_loss_cap":5,"mode":"live","max_drawdown_pct":10,"broker_opts":{"drift":-0.04}}'

curl -s -X POST localhost:8787/v1/intent -H "content-type: application/json" \
  -d '{"api_key":"floor-demo-key","symbol":"PEPEUSDT","side":"buy","notional":5}'
```

Then watch the dashboard. At ~30–40s the ledger prints:

`RISK_EXIT · floor-demo · SELL PEPEUSDT 4.4 · STOP_LOSS (desk floor) — stop hit: -12.09% <= -10%`

VO: *"The customer's strategy decides when to enter. The desk guarantees the worst-case
exit — the floor is immutable, and the exit is desk-initiated."*

**Live-MCP variant (after connect):** same beat, real sub-account — buy 6–7 USDT of a
volatile perp/spot pair, let it walk to the floor, desk exits on Binance. Binance order
history next to the books line.

## 4. Beat: the plug — revoked mid-flight (1:50–2:30)

```bash
curl -s -X POST localhost:8787/v1/revoke -H "x-api-key: founder-demo-key" -H "content-type: application/json" \
  -d '{"name":"tv-alerts"}'

# the same customer's next intent, seconds later:
curl -s -X POST localhost:8787/v1/intent -H "content-type: application/json" \
  -d '{"api_key":"tv-demo-key","symbol":"BTCUSDT","side":"buy","notional":5}'
# → 403 "customer tv-alerts is revoked — permissions were withdrawn mid-flight"
```

**Binance-side variant (after connect):** revoke from [Sub Accounts] → [Disconnect Agents]
while the desk is mid-decision; execution then refuses at the MCP server. *"Revoked
between its thought and its trade."*

## 5. Recording

```bash
ffmpeg -f gdigrab -framerate 30 -i desktop -c:v libx264 -pix_fmt yuv420p -preset veryfast trailer-raw.mp4
```

Trim to 60–90s in any editor; captions carry the VO lines above if you don't record
audio. Export 1280×720, <50 MB for X.

## After recording

Reset the books again (stop → `: > audit/desk.jsonl` → start) so the public desk and the
thread start from day 0. The trailer's fills are mock-broker fills and the books label
mode honestly — the live-MCP beat makes the difference between "architecture demo" and
"product", which is exactly why the connect step is the unblock.
