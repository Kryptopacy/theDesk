// Live adapter for the Binance Agent OS MCP server. Surface-compatible with
// MockBroker/PaperBroker, so desk.mjs addCustomer() swaps it in with one line.
//
// Server URL (official docs): https://agent.binance.com/mcp/agentic  (transport: http)
// MCP currently covers: Spot / Futures / Convert trading, market data (order book,
// price feeds, klines), account (balances, positions, transfers).
//
// TOOL NAMES BELOW ARE PLACEHOLDERS — enumerated from the live server on first connect
// (tools/list). Update the TOOL map, then this adapter goes live.

export const MCP_URL = process.env.BINANCE_MCP_URL ?? "https://agent.binance.com/mcp/agentic";

// Bearer token from the OAuth flow (desk /oauth/start → callback). Settable at runtime so
// the live desk picks it up without a restart; BINANCE_MCP_TOKEN env is the boot default.
let mcpToken = process.env.BINANCE_MCP_TOKEN ?? null;
export const setMcpToken = (t) => { mcpToken = t; };

export async function listMcpTools(token) {
  const auth = { authorization: `Bearer ${token}` };
  const post = (method, params, sid) => fetch(MCP_URL, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json, text/event-stream", ...auth, ...(sid ? { "mcp-session-id": sid } : {}) },
    body: JSON.stringify({ jsonrpc: "2.0", id: Date.now(), method, params }),
    signal: AbortSignal.timeout(20000),
  }).then(async (r) => ({ r, sid: r.headers.get("mcp-session-id"), data: await r.text() }));
  const init = await post("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "the-desk", version: "1.0.0" } });
  if (!init.r.ok) throw new Error(`initialize HTTP ${init.r.status}`);
  const initJson = JSON.parse(init.data.split("data:").filter(Boolean).pop() ?? init.data);
  await post("notifications/initialized", {}, init.sid).catch(() => {});
  const list = await post("tools/list", {}, init.sid);
  if (!list.r.ok) throw new Error(`tools/list HTTP ${list.r.status}`);
  const listJson = JSON.parse(list.data.split("data:").filter(Boolean).pop() ?? list.data);
  return listJson.result?.tools ?? [];
}

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
    const headers = { "content-type": "application/json", accept: "application/json, text/event-stream" };
    if (mcpToken) headers.authorization = `Bearer ${mcpToken}`;
    const res = await fetch(MCP_URL, {
      method: "POST",
      headers,
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
    if (side.toUpperCase() === "BUY" && quoteQty < 5) return { ok: false, error: "below min notional 5 USDT" };
    // Full-close sells skip the local min-notional gate — de-risking is never blocked (mirrors
    // Mock/Paper). Binance applies its own NOTIONAL filter server-side; a full-balance sell is
    // the exchange's case to allow or refuse, and the audit records which.
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
