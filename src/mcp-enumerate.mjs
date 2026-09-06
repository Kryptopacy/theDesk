// One-shot connect-day tool: handshake with the Binance Agent OS MCP server, enumerate
// the real tool list, and print the TOOL map to paste into src/mcp-broker.mjs.
// Run: node src/mcp-enumerate.mjs   (with BINANCE_MCP_TOKEN set from the desk's /oauth flow)
const MCP_URL = process.env.BINANCE_MCP_URL ?? "https://agent.binance.com/mcp/agentic";

const rpc = async (method, params, sessionId) => {
  const headers = { "content-type": "application/json", accept: "application/json, text/event-stream" };
  if (process.env.BINANCE_MCP_TOKEN) headers.authorization = `Bearer ${process.env.BINANCE_MCP_TOKEN}`;
  if (sessionId) headers["mcp-session-id"] = sessionId;
  const res = await fetch(MCP_URL, {
    method: "POST",
    headers,
    body: JSON.stringify({ jsonrpc: "2.0", id: Date.now(), method, params }),
    signal: AbortSignal.timeout(20000),
  });
  if (!res.ok) throw Object.assign(new Error(`HTTP ${res.status} ${res.statusText}`), { status: res.status, body: await res.text().catch(() => "") });
  const sid = res.headers.get("mcp-session-id");
  const text = await res.text();
  const data = text.startsWith("event:") || text.includes("data:")
    ? JSON.parse(text.split("data:").filter(Boolean).pop())
    : JSON.parse(text);
  return { data, sid };
};

try {
  const init = await rpc("initialize", {
    protocolVersion: "2025-03-26",
    capabilities: {},
    clientInfo: { name: "the-desk", version: "1.0.0" },
  });
  if (init.data.error) throw new Error(`initialize refused: ${JSON.stringify(init.data.error)}`);
  const sessionId = init.sid;
  console.log(`connected — server: ${init.data.result?.serverInfo?.name ?? "?"} ${init.data.result?.serverInfo?.version ?? ""}`);
  await rpc("notifications/initialized", {}, sessionId).catch(() => {});
  const list = await rpc("tools/list", {}, sessionId);
  const tools = list.data.result?.tools ?? [];
  console.log(`\n${tools.length} tools:\n`);
  for (const t of tools) console.log(`- ${t.name}: ${(t.description ?? "").split("\n")[0]}`);
  console.log(`\nPaste into src/mcp-broker.mjs:\n`);
  console.log(`const TOOL = {`);
  console.log(`  PRICE: ${JSON.stringify(pick(tools, /price|ticker/i) ?? "TODO")},`);
  console.log(`  KLINES: ${JSON.stringify(pick(tools, /kline|candle|ohlcv/i) ?? "TODO")},`);
  console.log(`  ORDER: ${JSON.stringify(pick(tools, /order|trade/i) ?? "TODO")},`);
  console.log(`  BALANCE: ${JSON.stringify(pick(tools, /balance|account/i) ?? "TODO")},`);
  console.log(`};`);
} catch (e) {
  if (e.status === 401 || e.status === 403) {
    console.error(`Server wants authentication before tool enumeration (${e.status}).`);
    console.error(`Do the connect steps in docs/CONNECT.md first (claude mcp add → /mcp → Authenticate → scope permissions), then run this again from a session that carries the credentials.`);
  } else {
    console.error(`enumeration failed: ${e.message}${e.body ? `\n${e.body.slice(0, 400)}` : ""}`);
  }
  process.exit(1);
}

function pick(tools, re) {
  return (tools.find((t) => re.test(t.name) || re.test(t.description ?? "")) ?? {}).name;
}
