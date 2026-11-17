// The JSON-RPC side of an MCP server (initialize, ping, tools/list, tools/call), shared by the assistant's stdio server
// (src/mcp/server.mjs) and the loopback HTTP server for agents outside Orb (src/engine/host/mcp-external.mjs). No imports
// of the engine: the stdio process loads this file too.
// tools: [{ name, description, inputSchema, run(args), readOnly? }]. authorize(): runs before every tool (throws to refuse).
// → async (message) → the JSON-RPC reply object, or null when the message needs none (a notification).
export const text = (value) => ({ content: [{ type: 'text', text: typeof value === 'string' ? value : JSON.stringify(value, null, 2) }] });

export function rpcHandler({ serverInfo, instructions, tools, authorize = async () => {}, extraArgsMessage = (list) => `unexpected arguments: ${list}`, unknownToolMessage = (name) => `unknown tool: ${name}`, unsupportedMessage = (method) => `unsupported method: ${method}` }) {
  return async (msg) => {
    if (!msg || typeof msg !== 'object' || Array.isArray(msg)) return { jsonrpc: '2.0', id: null, error: { code: -32600, message: 'invalid request' } };
    if (msg.id === undefined) return null; // a notification
    const reply = (payload) => ({ jsonrpc: '2.0', id: msg.id, ...payload });
    try {
      if (msg.method === 'initialize') return reply({ result: { protocolVersion: msg.params?.protocolVersion ?? '2025-06-18', capabilities: { tools: {} }, serverInfo, instructions } });
      if (msg.method === 'ping') return reply({ result: {} });
      if (msg.method === 'tools/list') return reply({ result: { tools: tools.map(({ run, readOnly, ...t }) => ({ ...t, ...(readOnly ? { annotations: { readOnlyHint: true } } : {}) })) } });
      if (msg.method === 'tools/call') {
        const tool = tools.find((t) => t.name === msg.params?.name);
        if (!tool) return reply({ error: { code: -32602, message: unknownToolMessage(msg.params?.name) } });
        try {
          const args = msg.params.arguments ?? {};
          if (!args || typeof args !== 'object' || Array.isArray(args)) throw new Error('arguments must be an object');
          // Strict arguments: anything outside the schema (e.g. a forged "from") is refused instead of being passed on.
          const extra = Object.keys(args).filter((k) => !Object.hasOwn(tool.inputSchema.properties ?? {}, k));
          if (extra.length) throw new Error(extraArgsMessage(extra.join(', ')));
          await authorize(tool);
          const out = await tool.run(args);
          return reply({ result: out?.content ? out : text(out) }); // tools with pictures return MCP content themselves
        } catch (error) { return reply({ result: { ...text(`Error: ${error.message}`), isError: true } }); }
      }
      return reply({ error: { code: -32601, message: unsupportedMessage(msg.method) } });
    } catch (error) { return reply({ error: { code: -32603, message: error.message } }); }
  };
}
