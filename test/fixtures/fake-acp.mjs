// A minimal ACP agent (Agent Client Protocol, JSON-RPC over stdio) to test src/agents/acp.mjs end to end. The tests run it
// as `node fake-acp.mjs` (Node is a real executable on every system; the .mjs is never started as a program).
// Methods: initialize, session/new, session/load (replays its history), session/set_mode, session/set_config_option,
// session/prompt (with session/update notifications) and the session/cancel notification. Keywords in the prompt:
//   PERMISO  asks session/request_permission for "git push origin main" and says which option it got
//   ESPERA   works until session/cancel arrives (answers stopReason "cancelled")
//   CUOTA    fails with a quota error
//   MUERE    the process exits in the middle of the turn
//   NIEGA    refuses (stopReason "refusal")
// Every message received is appended to FAKE_ACP_LOG (when set), so the tests can see what the client sent.
import fs from 'node:fs';
import readline from 'node:readline';

const log = (m) => { if (process.env.FAKE_ACP_LOG) fs.appendFileSync(process.env.FAKE_ACP_LOG, `${JSON.stringify(m)}\n`); };
const write = (m) => process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', ...m })}\n`);
const update = (sessionId, u) => write({ method: 'session/update', params: { sessionId, update: u } });
const text = (t) => ({ type: 'text', text: t });
let nextId = 1; const waiting = new Map(); let cancel = null; const history = [];

function request(method, params) {
  const id = `agente-${nextId++}`;
  return new Promise((resolve) => { waiting.set(id, resolve); write({ id, method, params }); });
}

async function prompt(id, { sessionId, prompt: parts }) {
  const said = (parts ?? []).map((p) => p.text ?? '').join('\n');
  history.push(said);
  update(sessionId, { sessionUpdate: 'agent_thought_chunk', content: text('pensando en ello') });
  update(sessionId, { sessionUpdate: 'plan', entries: [{ content: 'leer', status: 'completed' }, { content: 'responder', status: 'pending' }] });
  update(sessionId, { sessionUpdate: 'tool_call', toolCallId: 'tc1', title: 'Leer a.txt', kind: 'read', status: 'pending' });
  update(sessionId, { sessionUpdate: 'tool_call_update', toolCallId: 'tc1', status: 'completed', content: [{ type: 'content', content: text('contenido de a.txt') }] });
  update(sessionId, { sessionUpdate: 'usage_update', used: 1234, size: 100000 });
  if (/MUERE/.test(said)) { process.stderr.write('el agente ACP se cayó\n'); process.exit(3); }
  if (/CUOTA/.test(said)) return write({ id, error: { code: 429, message: 'Quota exhausted for this account' } });
  if (/NIEGA/.test(said)) return write({ id, result: { stopReason: 'refusal' } });
  let extra = '';
  if (/PERMISO/.test(said)) {
    const answer = await request('session/request_permission', {
      sessionId,
      toolCall: { toolCallId: 'tc2', title: 'git push', kind: 'execute', rawInput: { command: 'git push origin main' } },
      options: [{ optionId: 'si-una', name: 'Permitir', kind: 'allow_once' }, { optionId: 'si-siempre', name: 'Siempre', kind: 'allow_always' }, { optionId: 'no-nunca', name: 'Rechazar siempre', kind: 'reject_always' }, { optionId: 'no', name: 'Rechazar', kind: 'reject_once' }]
    });
    extra = ` elegido: ${answer?.outcome?.outcome === 'selected' ? answer.outcome.optionId : answer?.outcome?.outcome ?? 'nada'}`;
  }
  if (/ESPERA/.test(said)) {
    await new Promise((resolve) => { cancel = resolve; setTimeout(resolve, 20000); });
    cancel = null;
    return write({ id, result: { stopReason: 'cancelled' } });
  }
  update(sessionId, { sessionUpdate: 'agent_message_chunk', content: text('Hola. ') });
  update(sessionId, { sessionUpdate: 'agent_message_chunk', content: text(`ACP recibió: ${said.split('\n')[0].slice(0, 60)}${extra}`) });
  write({ id, result: { stopReason: 'end_turn', usage: { inputTokens: 11, outputTokens: 7 } } });
}

readline.createInterface({ input: process.stdin }).on('line', (line) => {
  let m; try { m = JSON.parse(line); } catch { return; }
  log(m);
  if (m.id != null && !m.method) { waiting.get(m.id)?.(m.result); waiting.delete(m.id); return; } // an answer to our request
  const { id, method, params = {} } = m;
  // FAKE_ACP_SLOW_START=<ms>: a program that takes a while to start (to stop it half-way).
  if (method === 'initialize') return setTimeout(() => write({ id, result: { protocolVersion: 1, agentCapabilities: { loadSession: true, promptCapabilities: { image: false } } } }), Number(process.env.FAKE_ACP_SLOW_START) || 0);
  // FAKE_ACP_MODELS=1: the model option lists its models (in a group, as ACP allows) and says which one is in use.
  const models = process.env.FAKE_ACP_MODELS === '1' ? { currentValue: 'acp-b', options: [{ group: 'g', name: 'Grupo', options: [{ value: 'acp-a', name: 'Modelo A de prueba' }, { value: 'acp-b', name: 'Modelo B de prueba' }] }] } : {};
  const session = { sessionId: 'acp-sesion-1', modes: { currentModeId: 'normal', availableModes: [{ id: 'normal', name: 'Normal' }, { id: 'plan', name: 'Plan (solo lectura)' }] }, configOptions: [{ id: 'modelo', category: 'model', type: 'select', ...models }] };
  if (method === 'session/new') return write({ id, result: session });
  if (method === 'session/load') {
    // A loaded session replays what was said before; the client must not show it again.
    update(params.sessionId, { sessionUpdate: 'agent_message_chunk', content: text('mensaje antiguo repetido') });
    return write({ id, result: { modes: session.modes, configOptions: session.configOptions } });
  }
  if (method === 'session/set_mode' || method === 'session/set_config_option') return write({ id, result: {} });
  if (method === 'session/prompt') return void prompt(id, params);
  if (method === 'session/cancel') { cancel?.(); return; }
  if (id != null) write({ id, error: { code: -32601, message: `método no soportado: ${method}` } });
});
