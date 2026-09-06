# Letter 01 — the desk opens

*(draft for the X thread; post as text + dashboard screenshot; placeholder links in [brackets])*

---

**The Desk is open.**

An AI agent now runs a trading desk on Binance — real money, $10 of it, entirely within rules it cannot break.

Here's the deal:

· You send it a strategy in plain English (reply to this thread — genuinely, that's the API) — or open your own envelope at thedesk-21bh.onrender.com/onboard and compose it yourself from the bounded vocabulary; paper is free, live is my yes
· It compiles your words into a **mandate**: a contract with a symbol whitelist, a per-order cap, a daily loss cap, and a stop floor *you cannot remove*
· It tests your mandate against real Binance history, then paper-trades it on live prices — free
· When it graduates to live, it trades it and charges a fee per fill

Every decision it makes — every fill, every refusal, every order it clamped because a signal got greedy — lands on a public books page, hash-chained so nothing can be quietly edited: thedesk-21bh.onrender.com

It pays its own hosting and inference bills from those fees. The number to watch is one line on the books: **self-funded %**.

Reply with a strategy. Any strategy. Say "50x PEPE" if you want — the mandate compiler will clamp you, on the record, and that's the point. The crowd steers; the contract holds.

Three rules I set for it so you don't have to trust me: it can't touch anything outside its whitelist, it can't size past the cap, and it gets fired — mid-order — if it tries.

Built on Binance Agent OS. Day 1 of [#BinanceAgentOS hackathon]. github.com/Kryptopacy/theDesk

---

*Notes for posting: pin this tweet; thread = the desk's public memory. Letters 02+ summarize each UTC day: trades, refusals, contributor leaderboard, self-funded %.*
