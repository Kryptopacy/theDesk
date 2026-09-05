// Live adapter for the Binance Agent OS MCP server. Surface-compatible with
// MockBroker/PaperBroker, so desk.mjs addCustomer() swaps it in with one line.
//
// Server URL (official docs): https://agent.binance.com/mcp/agentic  (transport: http)
// MCP currently covers: Spot / Futures / Convert trading, market data (order book,
// price feeds, klines), account (balances, positions, transfers).
//
// TOOL NAMES BELOW ARE PLACEHOLDERS — enumerated from the live server on first connect
// (tools/list). Update the TOOL map, then this adapter goes live.

const MCP_URL = process.env.BINANCE_MCP_URL ?? "https://agent.binance.com/mcp/agentic";

const TOOL = {
  PRICE: "PLACEHOLDER_market_price",       // e.g. ticker/price for a symbol
  KLINES: "PLACEHOLDER_market_klines",
  ORDER: "PLACEHOLDER_spot_order",         // market order on the dedicated sub-account
  BALANCE: "PLACEHOLDER_account_balance",
};

export class McpBroker {
  constructor({ float = 10, feeRate = 0.001 } = {}) {
    this.feeRate = feeRate;
    this.balances = { USDT: float }; // reconciled against BALANCE after connect
    this.baseBalances = {};
  }

  async #rpc(name, args) {
    const res = await fetch(MCP_URL, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json, text/event-stream" },
      body: JSON.stringify({ jsonrpc: "2.0", id: Date.now(), method: "tools/call", params: { name, arguments: args } }),
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) throw new Error(`MCP ${name} -> HTTP ${res.status}`);
    return res.json();
  }

  async observe(symbol) {
    const r = await this.#rpc(TOOL.PRICE, { symbol });
    return { symbol, price: Number(r?.result?.content?.[0]?.text ?? r?.result?.price), ts: new Date().toISOString(), via: "mcp" };
  }

  async marketOrder(symbol, side, quoteQty) {
    if (quoteQty < 5) return { ok: false, error: "below min notional 5 USDT" };
    try {
      const r = await this.#rpc(TOOL.ORDER, { symbol, side: side.toUpperCase(), quoteOrderQty: quoteQty });
      const c = r?.result?.content?.[0]?.text;
      if (r?.result?.isError) return { ok: false, error: String(c ?? "order rejected") };
      const fill = typeof c === "string" ? JSON.parse(c) : (c ?? {});
      const price = Number(fill.price ?? fill.executedQty ? fill.executedPrice : 0) || Number(fill.price) || 0;
      const notional = Number(fill.executedQty ?? fill.cummulativeQuoteQty ?? quoteQty);
      return { ok: true, symbol, side, quoteQty: notional, price, fee: notional * this.feeRate, orderId: fill.orderId, ts: new Date().toISOString(), via: "mcp" };
    } catch (e) {
      return { ok: false, error: String(e.message ?? e) };
    }
  }
}
