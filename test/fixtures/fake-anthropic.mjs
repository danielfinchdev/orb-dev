// A stand-in for the Anthropic API on 127.0.0.1, so the real Claude Code of the SDK can run a turn without network or
// account: the first request of a turn that offers tools answers with the tool call the test asks for; once the tool's
// result comes back (or when no tools are offered), it answers with plain text. Every request is kept in `requests`.
import http from 'node:http';

export async function fakeAnthropic({ tool }) {
  const requests = [];
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      let json = {}; try { json = JSON.parse(body); } catch { /* not JSON */ }
      requests.push({ url: req.url, body: json });
      if (!/\/v1\/messages(\?|$)/.test(req.url)) { res.writeHead(404, { 'content-type': 'application/json' }); res.end('{"type":"error","error":{"type":"not_found_error","message":"no"}}'); return; }
      const all = json.messages ?? [];
      const answered = all.some((m) => Array.isArray(m.content) && m.content.some((c) => c.type === 'tool_result'));
      const offers = (json.tools ?? []).some((t) => t.name === tool.name);
      const blocks = !answered && offers ? [{ type: 'tool_use', id: `toolu_${requests.length}`, name: tool.name, input: tool.input }] : [{ type: 'text', text: 'listo' }];
      const message = { id: `msg_${requests.length}`, type: 'message', role: 'assistant', model: json.model ?? 'claude-x', content: blocks, stop_reason: blocks[0].type === 'tool_use' ? 'tool_use' : 'end_turn', stop_sequence: null, usage: { input_tokens: 10, output_tokens: 5 } };
      if (!json.stream) { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify(message)); return; }
      res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' });
      const send = (event, data) => res.write(`event: ${event}\ndata: ${JSON.stringify({ type: event, ...data })}\n\n`);
      send('message_start', { message: { ...message, content: [], stop_reason: null, usage: { input_tokens: 10, output_tokens: 1 } } });
      blocks.forEach((b, index) => {
        if (b.type === 'tool_use') {
          send('content_block_start', { index, content_block: { ...b, input: {} } });
          send('content_block_delta', { index, delta: { type: 'input_json_delta', partial_json: JSON.stringify(b.input) } });
        } else {
          send('content_block_start', { index, content_block: { type: 'text', text: '' } });
          send('content_block_delta', { index, delta: { type: 'text_delta', text: b.text } });
        }
        send('content_block_stop', { index });
      });
      send('message_delta', { delta: { stop_reason: message.stop_reason, stop_sequence: null }, usage: { output_tokens: 5 } });
      send('message_stop', {});
      res.end();
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  return { url: `http://127.0.0.1:${server.address().port}`, requests, close: () => new Promise((r) => { server.closeAllConnections?.(); server.close(r); }) };
}
