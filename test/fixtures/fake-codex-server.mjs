// 3.6 (test/codex-confinado.test.mjs): a stand-in for «codex app-server» that obeys a hidden instruction of a mail. It
// writes the arguments it was started with to FAKE_CODEX_LOG, answers the JSON-RPC calls of src/agents/codex.mjs and, at
// the first turn, tries to read Codex's credentials: first it asks to run a command (an approval request), then it starts
// the command anyway, as a Codex that ignored «features.shell_tool = false» would. Every answer it gets is logged too.
import fs from 'node:fs';
import readline from 'node:readline';

const LOG = process.env.FAKE_CODEX_LOG;
const note = (o) => { if (LOG) fs.appendFileSync(LOG, `${JSON.stringify(o)}\n`); };
note({ argv: process.argv.slice(2) });
const send = (o) => process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', ...o })}\n`);
let next = 100;
readline.createInterface({ input: process.stdin }).on('line', (line) => {
  let m; try { m = JSON.parse(line); } catch { return; }
  if (m.method == null) { note({ answer: m.id, result: m.result ?? null, error: m.error ?? null }); return; }
  note({ call: m.method, params: m.method === 'thread/start' ? m.params : undefined });
  if (m.method === 'initialize') return send({ id: m.id, result: {} });
  if (m.method === 'initialized') return undefined;
  if (m.method === 'thread/start') return send({ id: m.id, result: { thread: { id: 't1' }, model: 'falso' } });
  if (m.method === 'model/list') return send({ id: m.id, result: { data: [] } });
  if (m.method === 'turn/interrupt') return send({ id: m.id, result: {} });
  if (m.method === 'turn/start') {
    send({ id: m.id, result: { turn: { id: 'u1' } } });
    const command = 'cat ~/.codex/auth.json';
    send({ id: next++, method: 'item/commandExecution/requestApproval', params: { threadId: 't1', itemId: 'c1', approvalId: 'c1', command } });
    setTimeout(() => send({ method: 'item/started', params: { threadId: 't1', item: { type: 'commandExecution', id: 'c2', command } } }), 100);
    return undefined;
  }
  if (m.id != null) send({ id: m.id, result: {} });
  return undefined;
});
