// 3.8: who may do what (src/core/permissions.mjs). This PC: everything. A linked phone or browser: only the methods the
// table marks 'remote'. An agent: no API method; its MCP tools act only on its own signed conversation or task, and an
// agent Orb did not sign (or with a forged conversation) gets nothing.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import path from 'node:path';
import readline from 'node:readline';
import { spawn } from 'node:child_process';
import { tempHome, ROOT } from './helpers.mjs';
import { Board } from '../src/core/board.mjs';
import { createProject } from '../src/core/projects.mjs';
import { METHODS, REMOTE_METHODS, CHANNELS, PermissionError, principalOf, allowed, authorize, ownsTask } from '../src/core/permissions.mjs';
import { guardCall } from '../src/engine/remote.mjs';
import { Sessions, agentToken, conversationSig } from '../src/engine/sessions.mjs';
import { Orchestrator } from '../src/engine/orchestrator.mjs';
import { Scheduler } from '../src/engine/scheduler.mjs';
import { buildApi } from '../src/engine/api.mjs';

let t; let board; let api;
const KEY = 'clave-de-prueba';
const phone = principalOf({ device: { id: 'm1', kind: 'phone' } });
const browser = principalOf({ device: { id: 'b1', kind: 'browser' } });
const desktop = principalOf();
before(() => {
  t = tempHome(); board = new Board();
  const sessions = new Sessions(board, { emit: () => {} });
  const orchestrator = new Orchestrator(board, 'clave', { emit: () => {} });
  const scheduler = new Scheduler(board, sessions, { orchestrator, emit: () => {} });
  api = buildApi({ board, sessions, orchestrator, scheduler, emit: () => {}, log: () => {}, version: 'test', remoteRef: { current: null } });
  createProject(board, { name: 'web' }, 'usuario');
  board.setting('orchestrator_key_hash', crypto.createHash('sha256').update(KEY).digest('hex'));
});
after(() => { try { board.db.close(); } catch { /* closed */ } t.cleanup(); });

test('cada método de la API tiene su línea en la tabla, y ninguna línea sobra', () => {
  const names = api.methodNames().sort();
  assert.deepEqual(names.filter((m) => !Object.hasOwn(METHODS, m)), [], 'métodos sin línea (se negarían en todas partes)');
  assert.deepEqual(Object.keys(METHODS).filter((m) => !names.includes(m)), [], 'líneas de métodos que ya no existen');
  assert.deepEqual([...new Set(Object.values(METHODS))].sort(), ['pc', 'remote']);
  assert.deepEqual(CHANNELS, ['desktop', 'phone', 'browser', 'agent']);
});

test('el PC lo puede todo; el móvil y el navegador, solo lo marcado «remote»; un agente, nada de la API', () => {
  for (const m of api.methodNames()) {
    assert.equal(allowed(desktop, m), true, `PC: ${m}`);
    for (const p of [phone, browser]) assert.equal(allowed(p, m), METHODS[m] === 'remote', `${p.channel}: ${m}`);
    assert.equal(allowed({ channel: 'agent', agent: 'claude' }, m), false, `agente: ${m}`);
    assert.equal(allowed(null, m), false, `sin principal: ${m}`);
  }
  assert.equal(allowed(desktop, 'persons.me'), false, 'un método que no existe no se permite ni en el PC');
  assert.throws(() => authorize(desktop, 'no.existe'), PermissionError);
  // The phone's own checks (remote.mjs) read the same table.
  for (const m of api.methodNames()) assert.equal(guardCall(board, m, {}) === null, REMOTE_METHODS.has(m), m);
});

test('lo que solo es del PC: ajustes, cuentas, copias, Magic Link, núcleo y lo que borra fuera de una conversación', () => {
  const pcOnly = ['config.save', 'accounts.add', 'accounts.remove', 'agents.login', 'agents.install', 'backup.now', 'backup.restore', 'backup.recovery',
    'link.qr', 'link.devices', 'link.revoke', 'remote.enable', 'remote.configure', 'installer.start', 'mcp.folder', 'expert.read',
    'projects.remove', 'projects.import', 'projects.push', 'conversations.remove', 'sessions.remove', 'schedules.remove', 'tasks.discardBranch'];
  for (const m of pcOnly) assert.equal(METHODS[m], 'pc', m);
  for (const m of ['app.state', 'chat.send', 'chat.list', 'tasks.list', 'tasks.create', 'tasks.approve', 'tasks.cancel', 'sessions.approve', 'sessions.stop', 'projects.list', 'usage.now', 'inbox.list']) assert.equal(METHODS[m], 'remote', m);
});

test('un móvil no puede llamar a ningún método del PC (la API lo niega antes de hacer nada)', async () => {
  const before = JSON.stringify(board.all('SELECT * FROM settings ORDER BY key'));
  for (const m of Object.keys(METHODS).filter((x) => METHODS[x] === 'pc')) {
    for (const p of [phone, browser]) await assert.rejects(api.call(m, {}, p), (e) => e instanceof PermissionError && e.status === 403, `${p.channel}: ${m}`);
  }
  assert.equal(JSON.stringify(board.all('SELECT * FROM settings ORDER BY key')), before, 'nada cambió');
  // What it may call works.
  assert.ok((await api.call('projects.list', {}, phone)).some((p) => p.name === 'web'));
});

test('agentes: sin firma nada; el coordinador, solo las tareas de su conversación; el trabajador, su tarea y lo que delega', () => {
  const convA = board.createConversation({ title: 'A' }).id; const convB = board.createConversation({ title: 'B' }).id;
  const a = board.createTask({ project: 'web', title: 'De A', description: 'x', conversation_id: convA }, 'orb');
  const b = board.createTask({ project: 'web', title: 'De B', description: 'x', conversation_id: convB }, 'orb');
  const sub = board.createTask({ project: 'web', title: 'Subtarea de A', description: 'x', parent_id: a.id }, 'claude');
  const loose = board.createTask({ project: 'web', title: 'Sin conversación', description: 'x', launch: 'manual', agent: 'codex' }, 'usuario');
  for (const id of [a.id, b.id, sub.id, loose.id]) assert.equal(ownsTask(board, { signed: false, boss: true, conversation: convA }, id), false, 'sin firma');
  const bossA = { signed: true, boss: true, conversation: convA, agent: 'orb' };
  assert.deepEqual([a.id, sub.id, b.id, loose.id].map((id) => ownsTask(board, bossA, id)), [true, true, false, false]);
  const worker = { signed: true, task: a.id, agent: 'claude' };
  assert.deepEqual([a.id, sub.id, b.id, loose.id].map((id) => ownsTask(board, worker, id)), [true, true, false, false]);
  const direct = { signed: true, task: null, agent: 'codex' };
  assert.equal(ownsTask(board, direct, loose.id), false, 'aún no la ha cogido');
  board.patch(loose.id, { status: 'running', assigned_to: 'codex' }, 'codex', 'task.claimed');
  assert.equal(ownsTask(board, direct, loose.id), true, 'la que cogió (manual, en curso)');
  assert.equal(ownsTask(board, direct, a.id), false);
  assert.equal(ownsTask(board, bossA, 999999), false, 'una tarea que no existe');
});

function mcp(env) {
  const child = spawn(process.execPath, [path.join(ROOT, 'src', 'mcp', 'server.mjs')], { env: { ...process.env, ORB_HOME: t.home, ...env }, stdio: ['pipe', 'pipe', 'inherit'] });
  const replies = new Map(); let n = 0;
  readline.createInterface({ input: child.stdout }).on('line', (l) => { const m = JSON.parse(l); replies.get(m.id)?.(m); });
  const rpc = (method, params) => new Promise((r) => { const id = ++n; replies.set(id, r); child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`); });
  return {
    rpc,
    call: async (name, args = {}) => { const r = (await rpc('tools/call', { name, arguments: args })).result; return { error: Boolean(r.isError), text: r.content[0].text }; },
    close: () => child.stdin.end()
  };
}

test('MCP: un agente sin firma o con la conversación falsificada no ve ni cambia nada', async () => {
  const conv = board.createConversation({ title: 'Real' }).id;
  const task = board.createTask({ project: 'web', title: 'SECRETO-TAREA', description: 'x', conversation_id: conv }, 'orb');
  const status = task.status;
  const unsigned = mcp({ ORB_AGENT: 'claude', ORB_TASK_ID: String(task.id) });
  const madeUp = mcp({ ORB_AGENT: 'claude', ORB_AGENT_TOKEN: 'a'.repeat(64) });
  const forged = mcp({ ORB_AGENT: 'orb', ORB_ORCH_KEY: KEY, ORB_CONVERSATION: String(conv), ORB_CONVERSATION_TOKEN: 'b'.repeat(64) });
  try {
    for (const c of [unsigned, madeUp, forged]) {
      await c.rpc('initialize', {});
      for (const [tool, args] of [['orb_board', {}], ['orb_list_tasks', {}], ['orb_get_task', { id: task.id }], ['orb_update_task', { id: task.id, status: 'done', result: 'falso' }], ['orb_read_messages', {}], ['orb_send_message', { to: 'usuario', body: 'hola' }]]) {
        const r = await c.call(tool, args);
        assert.equal(r.error, true, `${tool}: ${r.text}`);
        assert.doesNotMatch(r.text, /SECRETO-TAREA/);
      }
    }
    const made = await forged.call('orb_create_task', { project: 'web', title: 'Colada', description: 'x' });
    assert.equal(made.error, true, 'la conversación falsificada no crea tareas');
    assert.equal(board.task(task.id).status, status);
    assert.equal(board.one("SELECT COUNT(*) AS n FROM tasks WHERE title = 'Colada'").n, 0);
  } finally { for (const c of [unsigned, madeUp, forged]) c.close(); }
});

test('MCP: el coordinador firmado solo actúa en su conversación; el trabajador, en su tarea', async () => {
  const mine = board.createConversation({ title: 'Mía' }).id; const other = board.createConversation({ title: 'Otra' }).id;
  const own = board.createTask({ project: 'web', title: 'Propia', description: 'x', conversation_id: mine }, 'orb');
  const foreign = board.createTask({ project: 'web', title: 'Ajena', description: 'x', conversation_id: other }, 'orb');
  const boss = mcp({ ORB_AGENT: 'orb', ORB_ORCH_KEY: KEY, ORB_CONVERSATION: String(mine), ORB_CONVERSATION_TOKEN: conversationSig(KEY, mine) });
  const worker = mcp({ ORB_AGENT: 'claude', ORB_TASK_ID: String(own.id), ORB_AGENT_TOKEN: agentToken(board, 'claude', own.id) });
  try {
    for (const c of [boss, worker]) await c.rpc('initialize', {});
    assert.equal((await boss.call('orb_get_task', { id: own.id })).error, false);
    assert.equal((await boss.call('orb_get_task', { id: foreign.id })).error, true, 'la tarea de otra conversación');
    assert.equal((await boss.call('orb_update_task', { id: foreign.id, status: 'cancelled' })).error, true);
    assert.equal((await boss.call('orb_create_task', { project: 'web', title: 'Depende de la ajena', description: 'x', depends_on: [foreign.id] })).error, true);
    const made = await boss.call('orb_create_task', { project: 'web', title: 'Nueva', description: 'x', depends_on: [own.id] });
    assert.equal(made.error, false, made.text);
    assert.equal(board.task(JSON.parse(made.text).id).conversation_id, mine, 'la tarea nueva es de su conversación');
    assert.equal((await worker.call('orb_update_task', { id: foreign.id, status: 'done', result: 'x' })).error, true, 'otra tarea');
    assert.equal((await worker.call('orb_send_message', { to: 'usuario', body: 'hola', task_id: foreign.id })).error, true);
    board.patch(own.id, { status: 'running', assigned_to: 'claude' }, 'claude', 'task.claimed');
    const ok = await worker.call('orb_update_task', { id: own.id, note: 'avanzo', progress: 10 });
    assert.equal(ok.error, false, ok.text);
    assert.equal(board.task(foreign.id).status, foreign.status);
  } finally { boss.close(); worker.close(); }
});
