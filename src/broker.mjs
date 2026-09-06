// Broker interface: the executor only talks to this surface. MockBroker simulates the
// exchange for development and demo runs; the live McpBroker (Agent OS MCP server) plugs
// into the same surface once the real tool list is enumerated. Multi-symbol so the fund
// can rotate its whitelist without stranding the ledger.

export const MIN_NOTIONAL_USDT = 5; // Binance spot filter, ~5 USDT per order

const SEED_PRICES = {
  BTCUSDT: 64000, ETHUSDT: 3200, BNBUSDT: 600, SOLUSDT: 150, XRPUSDT: 2.5,
  DOGEUSDT: 0.15, ADAUSDT: 0.6, TRXUSDT: 0.3, LINKUSDT: 15, AVAXUSDT: 25,
  TONUSDT: 5, SHIBUSDT: 0.00002, DOTUSDT: 4, NEARUSDT: 5, APTUSDT: 8,
  PEPEUSDT: 0.000012, LTCUSDT: 90, SUIUSDT: 3, ARBUSDT: 0.8, OPUSDT: 1.7,
};

export class MockBroker {
  constructor({ drift = 0, volatility = 0.004, feeRate = 0.001 } = {}) {
    this.drift = drift; // DEMO ONLY: lets the simulator reach the take-profit in a few cycles
    this.volatility = volatility;
    this.feeRate = feeRate;
    this.prices = {};
    this.balances = { USDT: 10 };
    this.baseBalances = {};
  }

  observe(symbol) {
    if (!(symbol in this.prices)) this.prices[symbol] = SEED_PRICES[symbol] ?? 100;
    this.prices[symbol] *= 1 + this.drift + (Math.random() - 0.5) * 2 * this.volatility;
    return { symbol, price: this.prices[symbol], ts: new Date().toISOString() };
  }

  marketOrder(symbol, side, quoteQty) {
    if (!(symbol in this.prices)) this.prices[symbol] = SEED_PRICES[symbol] ?? 100; // an order can be the first touch of a symbol
    const price = this.prices[symbol];
    const fee = quoteQty * this.feeRate;
    if (side === "BUY") {
      if (quoteQty < MIN_NOTIONAL_USDT) return { ok: false, error: `below min notional ${MIN_NOTIONAL_USDT} USDT` };
      const cost = quoteQty + fee;
      if (cost > this.balances.USDT) return { ok: false, error: `insufficient USDT: need ${cost.toFixed(2)}, have ${this.balances.USDT.toFixed(2)}` };
      this.balances.USDT -= cost;
      this.baseBalances[symbol] = (this.baseBalances[symbol] ?? 0) + quoteQty / price;
    } else {
      let baseQty = quoteQty / price;
      const held = this.baseBalances[symbol] ?? 0;
      const fullClose = held > 0 && baseQty >= held * 0.99; // closing the position is de-risking — exempt from the min-notional gate
      if (!fullClose && quoteQty < MIN_NOTIONAL_USDT) return { ok: false, error: `below min notional ${MIN_NOTIONAL_USDT} USDT` };
      if (baseQty > held) {
        if (baseQty - held <= held * 0.01) baseQty = held; // dust tolerance: close what we hold
        else return { ok: false, error: `insufficient ${symbol}` };
      }
      this.baseBalances[symbol] = held - baseQty;
      this.balances.USDT += quoteQty - fee;
    }
    return { ok: true, symbol, side, quoteQty, price, fee, ts: new Date().toISOString() };
  }
}
