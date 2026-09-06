// PaperBroker: paper-trading against LIVE Binance prices. Same surface as MockBroker,
// but fills are simulated at the real market price with adverse slippage — paper P&L
// should never flatter the customer. Prices are public (keyless), cached briefly.
// Paper envelopes are time-boxed upstream (desk lifecycle), and paper fills are audited
// with mode:"paper" so the books always separate simulation from reality.

const SOURCES = ["https://api.binance.com", "https://data-api.binance.vision", "https://api1.binance.com"];

export class PaperBroker {
  constructor({ slippageBps = 3, feeRate = 0.001, cacheMs = 5000, float = 10 } = {}) {
    this.slippageBps = slippageBps;
    this.feeRate = feeRate;
    this.cacheMs = cacheMs;
    this.prices = {};
    this.fetchedAt = {};
    this.balances = { USDT: float };
    this.baseBalances = {};
  }

  async #price(symbol) {
    const now = Date.now();
    if (!this.prices[symbol] || now - this.fetchedAt[symbol] > this.cacheMs) {
      let lastErr = null;
      for (const base of SOURCES) {
        try {
          const res = await fetch(`${base}/api/v3/ticker/price?symbol=${symbol}`, { signal: AbortSignal.timeout(8000) });
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          this.prices[symbol] = Number((await res.json()).price);
          this.fetchedAt[symbol] = now;
          lastErr = null;
          break;
        } catch (e) { lastErr = e; }
      }
      if (lastErr) throw new Error(`price feed unavailable for ${symbol}`);
    }
    return this.prices[symbol];
  }

  async observe(symbol) {
    const price = await this.#price(symbol);
    return { symbol, price, ts: new Date().toISOString(), simulated: true };
  }

  async marketOrder(symbol, side, quoteQty) {
    let mid;
    try { mid = await this.#price(symbol); } catch (e) { return { ok: false, error: e.message }; }
    const slip = this.slippageBps / 10_000;
    const price = side === "BUY" ? mid * (1 + slip) : mid * (1 - slip); // adverse fill, always
    const fee = quoteQty * this.feeRate;
    let filledQuoteQty = quoteQty;
    if (side === "BUY") {
      if (quoteQty < 5) return { ok: false, error: `below min notional 5 USDT` };
      const cost = quoteQty + fee;
      if (cost > this.balances.USDT) return { ok: false, error: `insufficient USDT: need ${cost.toFixed(2)}, have ${this.balances.USDT.toFixed(2)}` };
      this.balances.USDT -= cost;
      this.baseBalances[symbol] = (this.baseBalances[symbol] ?? 0) + quoteQty / price;
    } else {
      let baseQty = quoteQty / price;
      const held = this.baseBalances[symbol] ?? 0;
      const fullClose = held > 0 && baseQty >= held * 0.99; // closing the position is de-risking — exempt from the min-notional gate
      if (!fullClose && quoteQty < 5) return { ok: false, error: `below min notional 5 USDT` };
      if (baseQty > held) {
        if (baseQty - held <= held * 0.01) baseQty = held; // dust tolerance: close what we hold
        else return { ok: false, error: `insufficient ${symbol}` };
      }
      this.baseBalances[symbol] = held - baseQty;
      filledQuoteQty = baseQty * price;
      this.balances.USDT += filledQuoteQty - fee;
    }
    return { ok: true, symbol, side, quoteQty: filledQuoteQty, price, fee, slippage_bps: this.slippageBps, simulated: true, ts: new Date().toISOString() };
  }
}
