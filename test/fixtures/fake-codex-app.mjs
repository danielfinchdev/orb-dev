// A minimal "codex app-server" (JSON-RPC over stdio) to test src/agents/codex.mjs. Run as `node fake-codex-app.mjs
// app-server -c …` (Node is the executable; the script is never started as a program). Keywords in the turn's text:
//   PERMISO  asks item/commandExecution/requestApproval for "git push origin main"
//   ESPERA   works until turn/interrupt or turn/steer arrives
//   LIMITE   the account hits its usage limit (rate limits + failed turn with usageLimitExceeded)
//   FALLA    the turn fails with an error
// Every message received (and the command line) goes to FAKE_LOG when it is set.
import fs from 'node:fs';
import readline from 'node:readline';

const log = (m) => { if (process.env.FAKE_LOG) fs.appendFileSync(process.env.FAKE_LOG, `${JSON.stringify(m)}\n`); };
const write = (m) => process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', ...m })}\n`);
const notify = (method, params) => write({ method, params });
log({ argv: process.argv.slice(2), codexHome: process.env.CODEX_HOME ?? null });
let threadId = null; let n = 0; const waiting = new Map(); let wake = null;
const request = (method, params) => new Promise((resolve) => { const id = `srv-${++n}`; waiting.set(id, resolve); write({ id, method, params }); });

async function turn(turnId, text) {
  const done = (status, extra = {}) => notify('turn/completed', { threadId, turn: { id: turnId, status, ...extra } });
  notify('item/started', { threadId, item: { id: 'c1', type: 'commandExecution', command: 'ls' } });
  notify('item/completed', { threadId, item: { id: 'c1', type: 'commandExecution', command: 'ls', aggregatedOutput: 'a.txt\n', exitCode: 0 } });
  notify('item/completed', { threadId, item: { id: 'f1', type: 'fileChange', changes: [{ path: 'a.txt', kind: { type: 'add' } }] } });
  notify('item/completed', { threadId: 'otro-hilo', item: { id: 'x', type: 'agentMessage', text: 'esto es de un subagente' } });
  notify('thread/tokenUsage/updated', { threadId, tokenUsage: { last: { inputTokens: 900 }, total: { inputTokens: 1200, outputTokens: 80, cachedInputTokens: 100 }, modelContextWindow: 272000 } });
  notify('account/rateLimits/updated', { rateLimits: { primary: { usedPercent: 42, resetsAt: 2_000_000_000, windowDurationMins: 300 } } });
  let extra = '';
  if (/PERMISO/.test(text)) { const r = await request('item/commandExecution/requestApproval', { threadId, turnId, itemId: 'c2', command: 'git push origin main' }); extra = ` decisión: ${r?.decision}`; }
  if (/ESPERA/.test(text)) {
    const how = await new Promise((resolve) => { wake = resolve; setTimeout(() => resolve('nada'), 20000); });
    wake = null;
    if (how === 'interrupt') return done('interrupted');
    extra = ` corrección: ${how}`;
  }
  if (/LIMITE/.test(text)) {
    notify('account/rateLimits/updated', { rateLimits: { rateLimitReachedType: 'primary', primary: { usedPercent: 100, resetsAt: 2_000_000_000, windowDurationMins: 300 } } });
    return done('failed', { error: { message: "You've hit your usage limit", codexErrorInfo: 'usageLimitExceeded' } });
  }
  if (/FALLA/.test(text)) return done('failed', { error: { message: 'algo salió mal en Codex' } });
  notify('item/agentMessage/delta', { threadId, itemId: 'm1', delta: 'Codex: ' });
  notify('item/completed', { threadId, item: { id: 'm1', type: 'agentMessage', text: `Codex: ${text.split('\n')[0].slice(0, 60)}${extra}` } });
  done('completed');
}

readline.createInterface({ input: process.stdin }).on('line', (line) => {
  let m; try { m = JSON.parse(line); } catch { return; }
  log(m);
  if (m.id != null && !m.method) { waiting.get(m.id)?.(m.result); waiting.delete(m.id); return; }
  const { id, method, params = {} } = m;
  if (method === 'initialize') return write({ id, result: { userAgent: 'codex-falso/0.0' } });
  if (method === 'initialized') return;
  if (method === 'thread/start') { threadId = 'hilo-nuevo'; return write({ id, result: { thread: { id: threadId }, model: params.model ?? 'gpt-falso' } }); }
  if (method === 'thread/resume') { threadId = params.threadId; return write({ id, result: { thread: { id: threadId }, model: 'gpt-falso' } }); }
  if (method === 'thread/fork') { threadId = `copia-de-${params.threadId}`; return write({ id, result: { thread: { id: threadId }, model: 'gpt-falso' } }); }
  if (method === 'turn/start') { const turnId = `turno-${++n}`; write({ id, result: { turn: { id: turnId } } }); return void turn(turnId, params.input?.[0]?.text ?? ''); }
  if (method === 'turn/steer') { write({ id, result: {} }); return void wake?.(params.input?.[0]?.text ?? ''); }
  if (method === 'turn/interrupt') { write({ id, result: {} }); return void wake?.('interrupt'); }
  if (id != null) write({ id, error: { code: -32601, message: `método no soportado: ${method}` } });
});
