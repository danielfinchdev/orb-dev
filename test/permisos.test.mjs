// 3.8: who may do what (src/core/permissions.mjs). This PC: everything. A linked phone or browser: only the methods the
// table marks 'remote'. An agent: no API method; its MCP tools act only on its own signed conversation or task, and an
// agent Orb did not sign (or with a forged conversation) gets nothing.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import readline from 'node:readline';
import { spawn } from 'node:child_process';
import { tempHome, ROOT } from './helpers.mjs';
import { Board } from '../src/core/board.mjs';
import { createProject } from '../src/core/projects.mjs';
import { METHODS, REMOTE_METHODS, CHANNELS, PermissionError, principalOf, allowed, authorize, ownsTask } from '../src/core/permissions.mjs';
import { guardCall, shapeResult } from '../src/engine/remote.mjs';
import { ctx } from '../src/core/context.mjs';
import crypto from 'node:crypto';
import { Sessions, mcpServersFor } from '../src/engine/sessions.mjs';
import { AgentAuth, agentAuth } from '../src/engine/agent-auth.mjs';
import { decide } from '../src/core/guard.mjs';
import { Orchestrator } from '../src/engine/orchestrator.mjs';
import { Scheduler } from '../src/engine/scheduler.mjs';
import { buildApi } from '../src/engine/api.mjs';

let t; let board; let api; let scheduler; let sessions; let orchestrator;
const phone = principalOf({ device: { id: 'm1', kind: 'phone' } });
const browser = principalOf({ device: { id: 'b1', kind: 'browser' } });
const desktop = principalOf();
before(() => {
  t = tempHome(); board = new Board();
  sessions = new Sessions(board, { emit: () => {} });
  orchestrator = new Orchestrator(board, { emit: () => {} });
  scheduler = new Scheduler(board, sessions, { orchestrator, emit: () => {} });
  api = buildApi({ board, sessions, orchestrator, scheduler, emit: () => {}, log: () => {}, version: 'test', remoteRef: { current: null } });
  createProject(board, { name: 'web' }, 'usuario');
  createProject(board, { name: 'tienda' }, 'usuario');
});
// An agent's "orb" MCP server exactly as the engine hands it (with its ticket); the coordinator of a conversation; and one
// started with only what its environment claims (no ticket, or a made-up one).
const signed = (agent, opts = {}) => mcpServersFor(agent, opts).orb;
const bossServer = (conv) => signed('claude', { orchestrator: true, browser: false, session: `asistente-${conv}`, conversation: conv });
const claims = (env = {}, ticket = '') => ({ command: process.execPath, args: [path.join(ROOT, 'src', 'mcp', 'server.mjs'), '--ticket-env=ORB_TICKET_orb'], env: { ...env, ORB_AUTH_PIPE: agentAuth.address, ORB_TICKET_orb: ticket } });
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
  const direct = { signed: true, task: null, agent: 'codex', session: 's1' };
  assert.equal(ownsTask(board, direct, loose.id), false, 'aún no la ha cogido');
  board.patch(loose.id, { status: 'running', assigned_to: 'codex', claimed_session: 's1' }, 'codex', 'task.claimed');
  assert.equal(ownsTask(board, direct, loose.id), true, 'la que cogió (manual, en curso)');
  assert.equal(ownsTask(board, { ...direct, session: 's2' }, loose.id), false, 'otra conversación directa del mismo agente no');
  assert.equal(ownsTask(board, { ...direct, session: null }, loose.id), false);
  assert.equal(ownsTask(board, direct, a.id), false);
  assert.equal(ownsTask(board, bossA, 999999), false, 'una tarea que no existe');
  // B4: a coordinator without a conversation owns nothing (not every task of no conversation).
  assert.equal(ownsTask(board, { signed: true, boss: true, conversation: null, agent: 'orb' }, loose.id), false);
});

function mcp(server) {
  const child = spawn(server.command, server.args, { env: { ...process.env, ORB_HOME: t.home, ...server.env }, stdio: ['pipe', 'pipe', 'inherit'] });
  const replies = new Map(); let n = 0;
  readline.createInterface({ input: child.stdout }).on('line', (l) => { const m = JSON.parse(l); replies.get(m.id)?.(m); });
  const rpc = (method, params) => new Promise((r) => { const id = ++n; replies.set(id, r); child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`); });
  return {
    rpc,
    call: async (name, args = {}) => { const m = await rpc('tools/call', { name, arguments: args }); const r = m.result; return r ? { error: Boolean(r.isError), text: r.content[0].text } : { error: true, text: m.error?.message ?? '' }; },
    tools: async () => (await rpc('tools/list', {})).result.tools.map((x) => x.name),
    close: () => child.stdin.end()
  };
}

test('MCP: un agente sin firma, con la conversación falsificada o un coordinador sin conversación no usa ninguna herramienta', async () => {
  const conv = board.createConversation({ title: 'Real' }).id; const other = board.createConversation({ title: 'Otra' }).id;
  const task = board.createTask({ project: 'web', title: 'SECRETO-TAREA', description: 'x', conversation_id: conv }, 'orb');
  const status = task.status;
  // Every tool a signed coordinator or worker gets (the browser's need the app).
  const boss = mcp(bossServer(conv)); const worker = mcp(signed('claude', { taskId: task.id, session: 'sesion-tarea' }));
  const direct = mcp(signed('claude', { session: 'sesion-directa' }));
  const all = new Set();
  for (const c of [boss, worker, direct]) { await c.rpc('initialize', {}); for (const n of await c.tools()) all.add(n); c.close(); }
  for (const n of ['orb_create_task', 'orb_delegate', 'orb_claim_next', 'orb_read_log', 'orb_add_project']) assert.ok(all.has(n), n);
  const unsigned = mcp(claims({ ORB_AGENT: 'claude', ORB_TASK_ID: String(task.id) }));
  const madeUp = mcp(claims({ ORB_AGENT: 'claude' }, 'a'.repeat(64)));
  const noConversation = mcp(signed('claude', { orchestrator: true, browser: false, session: 'asistente-sin-conversacion' }));
  // N1: what a worker with a shell could write in orb.db (the hashes 3.8 kept there) grants nothing any more.
  const sha = (v) => crypto.createHash('sha256').update(v).digest('hex');
  board.setting(`orchestrator_conv:${conv}`, sha('mi-clave'));
  board.settingJson(`agent_id:${sha('b'.repeat(64))}`, { agent: 'claude', task: task.id, session: 'falsa' });
  const forgedBoss = mcp(claims({ ORB_AGENT: 'orb', ORB_CONVERSATION: String(conv), ORB_ORCH_KEY: 'mi-clave' }));
  const forgedWorker = mcp(claims({ ORB_AGENT: 'claude', ORB_AGENT_TOKEN: 'b'.repeat(64) }, 'b'.repeat(64)));
  // N6: a ticket of another engine (a run before this one) is unknown to this one.
  const before = mcp(claims({ ORB_AGENT: 'claude' }, new AgentAuth().issue({ session: 'antes', reply: { home: t.home, who: { agent: 'claude', task: task.id, session: 'antes' } } })));
  const clients = [unsigned, madeUp, noConversation, forgedBoss, forgedWorker, before];
  try {
    for (const c of clients) {
      await c.rpc('initialize', {});
      for (const tool of all) {
        const r = await c.call(tool, tool.includes('task') || tool === 'orb_get_task' ? { id: task.id } : {});
        assert.equal(r.error, true, `${tool}: ${r.text}`);
        assert.doesNotMatch(r.text, /SECRETO-TAREA/);
      }
    }
    assert.equal(board.task(task.id).status, status);
    assert.match((await forgedBoss.rpc('initialize', {})).result.instructions, /Tú eres "agente-sin-clave"/);
  } finally { for (const c of clients) c.close(); board.run("DELETE FROM settings WHERE key LIKE 'agent_id:%' OR key LIKE 'orchestrator_conv:%'"); }
});

test('MCP: el coordinador firmado solo actúa en su conversación; el trabajador, en su tarea', async () => {
  const mine = board.createConversation({ title: 'Mía' }).id; const other = board.createConversation({ title: 'Otra' }).id;
  const own = board.createTask({ project: 'web', title: 'Propia', description: 'x', conversation_id: mine }, 'orb');
  const foreign = board.createTask({ project: 'web', title: 'Ajena', description: 'x', conversation_id: other }, 'orb');
  const boss = mcp(bossServer(mine));
  const worker = mcp(signed('claude', { taskId: own.id, session: 'sesion-propia' }));
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

// M1: «COGE TU TAREA» is a direct conversation's (no task, not the coordinator), and the task it takes is that
// conversation's alone.
test('MCP: solo una conversación directa coge una tarea manual, recibe su resumen y es la única que la trabaja', async () => {
  const conv = board.createConversation({ title: 'Con tareas' }).id;
  const own = board.createTask({ project: 'web', title: 'Del trabajador', description: 'x', conversation_id: conv }, 'orb');
  const manual = board.createTask({ project: 'web', title: 'Manual', description: 'DESCRIPCION-MANUAL', agent: 'claude', launch: 'manual' }, 'usuario');
  const worker = mcp(signed('claude', { taskId: own.id, session: 'sesion-trabajador' }));
  const boss = mcp(bossServer(conv));
  const first = mcp(signed('claude', { session: 'directa-1' }));
  const second = mcp(signed('claude', { session: 'directa-2' }));
  try {
    for (const c of [worker, boss, first, second]) await c.rpc('initialize', {});
    for (const c of [worker, boss]) {
      assert.ok(!(await c.tools()).includes('orb_claim_next'));
      assert.equal((await c.call('orb_claim_next', {})).error, true);
    }
    assert.equal(board.task(manual.id).status, 'queued', 'nadie la deja «en curso» al negarse');
    const got = await first.call('orb_claim_next', {});
    assert.equal(got.error, false, got.text);
    const brief = JSON.parse(got.text);
    assert.equal(brief.id, manual.id); assert.equal(brief.description, 'DESCRIPCION-MANUAL');
    assert.equal(brief.approval_sig, undefined, 'el resumen, no la fila entera'); assert.equal(brief.claimed_session, undefined);
    assert.equal(board.task(manual.id).claimed_session, 'directa-1');
    assert.equal((await second.call('orb_update_task', { id: manual.id, status: 'done', result: 'x' })).error, true, 'otra conversación directa del mismo agente');
    assert.equal((await second.call('orb_get_task', { id: manual.id })).error, true);
    assert.equal((await first.call('orb_update_task', { id: manual.id, status: 'done', result: 'hecho' })).error, false);
    assert.equal(board.task(manual.id).status, 'done');
  } finally { for (const c of [worker, boss, first, second]) c.close(); }
});

// M2: messages are read by task and conversation, and only what is returned is marked as read.
test('MCP: cada agente lee solo los mensajes de sus tareas y de su conversación, y no consume los ajenos', async () => {
  const mine = board.createConversation({ title: 'Mensajes A' }).id; const other = board.createConversation({ title: 'Mensajes B' }).id;
  const a = board.createTask({ project: 'web', title: 'A', description: 'x', conversation_id: mine }, 'orb');
  const a2 = board.createTask({ project: 'web', title: 'A2', description: 'x', conversation_id: mine }, 'orb');
  const b = board.createTask({ project: 'web', title: 'B', description: 'x', conversation_id: other }, 'orb');
  board.run('DELETE FROM messages');
  const ids = {
    own: board.send({ from: 'orb', to: 'claude', body: 'para A', task_id: a.id }).id,
    sameConv: board.send({ from: 'codex', to: 'claude', body: 'de A2', task_id: a2.id, from_task: a2.id }).id,
    forSibling: board.send({ from: 'orb', to: 'claude', body: 'PARA A2', task_id: a2.id }).id,
    foreign: board.send({ from: 'codex', to: 'claude', body: 'AJENO de B', task_id: b.id }).id,
    loose: board.send({ from: 'codex', to: 'all', body: 'SIN TAREA' }).id,
    toBoss: board.send({ from: 'claude', to: 'orb', body: 'al jefe de A', task_id: a.id }).id,
    toOtherBoss: board.send({ from: 'claude', to: 'orb', body: 'AL JEFE DE B', task_id: b.id }).id
  };
  const worker = mcp(signed('claude', { taskId: a.id, session: 'sesion-a' }));
  const boss = mcp(bossServer(mine));
  try {
    for (const c of [worker, boss]) await c.rpc('initialize', {});
    const read = JSON.parse((await worker.call('orb_read_messages')).text).map((m) => m.id).sort();
    assert.deepEqual(read, [ids.own, ids.sameConv].sort());
    const marked = board.all('SELECT message_id FROM message_reads WHERE agent = ?', `claude#${a.id}`).map((r) => r.message_id);
    assert.deepEqual(marked.sort(), read, 'marcados como leídos solo para su tarea');
    // N8: another claude task of the same conversation still has the messages A read (read marks are per task).
    const sibling = (m) => m.task_id === a2.id || (m.task_id === a.id && m.from_task === a.id);
    assert.deepEqual(board.inbox('claude', false, sibling, { reader: `claude#${a2.id}` }).map((m) => m.id).sort(), [ids.forSibling, ids.sameConv].sort());
    const bossRead = (await boss.call('orb_read_messages')).text;
    assert.match(bossRead, /al jefe de A/); assert.doesNotMatch(bossRead, /AL JEFE DE B/);
  } finally { worker.close(); boss.close(); }
});

// B5–B7: the lists, the logs, the messages and the projects of an agent are those of its own work.
test('MCP: listas, bitácoras, mensajes y proyectos, confinados a lo suyo', async () => {
  const mine = board.createConversation({ title: 'Lista A', project: 'tienda' }).id; const other = board.createConversation({ title: 'Lista B' }).id;
  const a = board.createTask({ project: 'tienda', title: 'TAREA-A', description: 'x', conversation_id: mine }, 'orb');
  board.createTask({ project: 'tienda', title: 'SUB-A', description: 'x', parent_id: a.id }, 'claude');
  board.createTask({ project: 'tienda', title: 'MISMO-PROYECTO', description: 'x', conversation_id: other }, 'orb');
  const elsewhere = board.createTask({ project: 'web', title: 'OTRO-PROYECTO', description: 'x', conversation_id: other }, 'orb');
  board.setActiveProject('web', 'usuario');
  const worker = mcp(signed('claude', { taskId: a.id, session: 'sesion-lista' }));
  const boss = mcp(bossServer(mine));
  try {
    for (const c of [worker, boss]) await c.rpc('initialize', {});
    const titles = async (c) => JSON.parse((await c.call('orb_list_tasks', { limit: 200 })).text).map((x) => x.title);
    const w = await titles(worker);
    assert.ok(w.includes('TAREA-A') && w.includes('SUB-A'), 'su tarea y lo que delega');
    assert.ok(!w.includes('MISMO-PROYECTO') && !w.includes('OTRO-PROYECTO'));
    const bt = await titles(boss);
    assert.ok(bt.includes('TAREA-A') && bt.includes('SUB-A') && bt.includes('MISMO-PROYECTO'), 'su conversación y su proyecto');
    assert.ok(!bt.includes('OTRO-PROYECTO'));
    const summary = (await worker.call('orb_board')).text;
    assert.match(summary, /TAREA-A/); assert.doesNotMatch(summary, /OTRO-PROYECTO|MISMO-PROYECTO/);
    assert.doesNotMatch((await boss.call('orb_board')).text, /OTRO-PROYECTO/);
    // Logs: its conversation's projects and the general one.
    assert.equal((await boss.call('orb_write_log', { project: 'tienda', tema: 'Plan', hecho: 'hecho' })).error, false);
    assert.equal((await boss.call('orb_write_log', { project: 'general', tema: 'Plan', hecho: 'hecho' })).error, false);
    assert.equal((await boss.call('orb_read_log', { project: 'web' })).error, true);
    assert.equal((await boss.call('orb_write_log', { project: 'web', tema: 'x', hecho: 'y' })).error, true);
    // Messages: to another agent only about its own task; never «all» or agents about another conversation's task.
    board.run('DELETE FROM messages');
    assert.equal((await worker.call('orb_send_message', { to: 'codex', body: 'hola' })).error, false, 'sobre su propia tarea');
    assert.equal(board.one('SELECT task_id FROM messages ORDER BY id DESC LIMIT 1').task_id, a.id);
    assert.equal((await worker.call('orb_send_message', { to: 'all', body: 'x', task_id: elsewhere.id })).error, true);
    assert.equal((await boss.call('orb_send_message', { to: 'all', body: 'a todos' })).error, true, 'el coordinador también nombra su tarea');
    assert.equal((await boss.call('orb_send_message', { to: 'codex', body: 'x', task_id: elsewhere.id })).error, true);
    assert.equal((await boss.call('orb_send_message', { to: 'codex', body: 'sigue', task_id: a.id })).error, false);
    // Registering a folder as a project: the coordinator only.
    assert.ok(!(await worker.tools()).includes('orb_add_project'));
    assert.ok((await boss.tools()).includes('orb_add_project'));
  } finally { worker.close(); boss.close(); }
});

// B7: Orb delivers an agent's message only inside the conversation of the task it is about.
test('los mensajes entre agentes no salen de su conversación', () => {
  const mine = board.createConversation({ title: 'Entrega A' }).id; const other = board.createConversation({ title: 'Entrega B' }).id;
  const from = board.createTask({ project: 'web', title: 'Envía', description: 'x', conversation_id: mine }, 'orb');
  const near = board.createTask({ project: 'web', title: 'Cerca', description: 'x', conversation_id: mine }, 'orb');
  const far = board.createTask({ project: 'web', title: 'Lejos', description: 'x', conversation_id: other }, 'orb');
  const got = { near: [], far: [] };
  for (const [task, key] of [[near, 'near'], [far, 'far']]) {
    scheduler.running.set(task.id, { agent: 'claude', sessionId: `entrega-${key}` });
    sessions.lives.set(`entrega-${key}`, { live: { caps: { steer: true }, steer: ({ text }) => { got[key].push(text); return true; } } });
  }
  try {
    board.setting('msg_delivered', String(board.one('SELECT COALESCE(MAX(id), 0) AS n FROM messages').n));
    board.send({ from: 'codex', to: 'all', body: 'a todos', task_id: from.id });
    board.send({ from: 'codex', to: 'claude', body: 'a claude', task_id: from.id });
    board.send({ from: 'codex', to: 'claude', body: 'sin tarea' });
    scheduler.deliverMessages();
    assert.equal(got.near.length, 2, got.near.join(' | '));
    assert.deepEqual(got.far, [], 'otra conversación no recibe nada');
  } finally {
    for (const [task, key] of [[near, 'near'], [far, 'far']]) { scheduler.running.delete(task.id); sessions.lives.delete(`entrega-${key}`); }
  }
});

// N2: a worker writes to a sibling task of its own conversation by its number (as its brief says), and Orb hands the
// message to that task only; a task of another conversation stays out of reach.
test('MCP: un trabajador escribe a una tarea hermana de su conversación por su número, y solo a esa', async () => {
  const mine = board.createConversation({ title: 'Hermanas' }).id; const other = board.createConversation({ title: 'Otras' }).id;
  const a = board.createTask({ project: 'web', title: 'Hermana A', description: 'x', conversation_id: mine }, 'orb');
  const b = board.createTask({ project: 'web', title: 'Hermana B', description: 'x', conversation_id: mine }, 'orb');
  const c = board.createTask({ project: 'web', title: 'Hermana C', description: 'x', conversation_id: mine }, 'orb');
  const far = board.createTask({ project: 'web', title: 'Lejana', description: 'x', conversation_id: other }, 'orb');
  const worker = mcp(signed('claude', { taskId: a.id, session: 'sesion-hermana' }));
  const got = { b: [], c: [] };
  for (const [task, key] of [[b, 'b'], [c, 'c']]) {
    scheduler.running.set(task.id, { agent: 'codex', sessionId: `hermana-${key}` });
    sessions.lives.set(`hermana-${key}`, { live: { caps: { steer: true }, steer: ({ text }) => { got[key].push(text); return true; } } });
  }
  try {
    await worker.rpc('initialize', {});
    board.setting('msg_delivered', String(board.one('SELECT COALESCE(MAX(id), 0) AS n FROM messages').n));
    assert.equal((await worker.call('orb_send_message', { to: 'codex', body: 'la API está en /api/v2', task_id: b.id })).error, false);
    const row = board.one('SELECT * FROM messages ORDER BY id DESC LIMIT 1');
    assert.deepEqual([row.task_id, row.from_task], [b.id, a.id]);
    const refused = await worker.call('orb_send_message', { to: 'codex', body: 'x', task_id: far.id });
    assert.equal(refused.error, true); assert.match(refused.text, /no es de tu conversación/);
    scheduler.deliverMessages();
    assert.equal(got.b.length, 1); assert.match(got.b[0], /MENSAJE DE CLAUDE.*\/api\/v2/);
    assert.deepEqual(got.c, [], 'la otra hermana no lo recibe');
    assert.ok(board.one('SELECT 1 AS x FROM message_reads WHERE message_id = ? AND agent = ?', row.id, `codex#${b.id}`), 'leído por esa tarea');
  } finally {
    worker.close();
    for (const [task, key] of [[b, 'b'], [c, 'c']]) { scheduler.running.delete(task.id); sessions.lives.delete(`hermana-${key}`); }
  }
});

// B8: a signature ends with its agent's process or its conversation.
test('MCP: la firma caduca al cerrarse el proceso de la tarea o al borrarse la conversación', async () => {
  const conv = board.createConversation({ title: 'Caduca' }).id;
  const task = board.createTask({ project: 'web', title: 'Caduca', description: 'x', conversation_id: conv }, 'orb');
  const worker = mcp(signed('claude', { taskId: task.id, session: 'sesion-caduca' }));
  const boss = mcp(bossServer(conv));
  try {
    for (const c of [worker, boss]) await c.rpc('initialize', {});
    assert.equal((await worker.call('orb_get_task', { id: task.id })).error, false);
    assert.equal((await boss.call('orb_get_task', { id: task.id })).error, false);
    sessions.closeLive('sesion-caduca'); // the task's process closes (scheduler.finish)
    assert.match((await worker.call('orb_get_task', { id: task.id })).text, /no ha firmado/);
    await api.call('conversations.remove', { id: conv }, desktop);
    assert.match((await boss.call('orb_board')).text, /no ha firmado/);
  } finally { worker.close(); boss.close(); }
});

// N7: every agent process gets new tickets; the ones of its previous process (same conversation) are worth nothing, and
// the coordinator's ends when its process closes too (it gets a new one with the next).
test('MCP: cada proceso tiene su ticket; el de un proceso cerrado no vuelve a valer, tampoco el del coordinador', async () => {
  const conv = board.createConversation({ title: 'Rota' }).id;
  const task = board.createTask({ project: 'web', title: 'Rota', description: 'x', conversation_id: conv }, 'orb');
  const first = signed('claude', { taskId: task.id, session: 'sesion-rota' });
  const ticket = (s) => s.env.ORB_TICKET_orb;
  sessions.closeLive('sesion-rota');
  const second = signed('claude', { taskId: task.id, session: 'sesion-rota' });
  assert.notEqual(ticket(first), ticket(second), 'otro proceso, otro ticket');
  const old = mcp(first); const now = mcp(second);
  const boss = mcp(bossServer(conv));
  try {
    for (const c of [old, now, boss]) await c.rpc('initialize', {});
    assert.match((await old.call('orb_get_task', { id: task.id })).text, /no ha firmado/);
    assert.equal((await now.call('orb_get_task', { id: task.id })).error, false);
    // Its ticket is bound to the server that holds it: the copy in the agent's environment (its shell) is worth nothing.
    const copy = mcp({ ...second }); await copy.rpc('initialize', {});
    assert.match((await copy.rpc('initialize', {})).result.instructions, /Tú eres "desconocido"/); copy.close();
    assert.equal((await boss.call('orb_get_task', { id: task.id })).error, false);
    orchestrator.lane(conv).closeLive(); // the coordinator's process closes
    assert.match((await boss.call('orb_get_task', { id: task.id })).text, /no ha firmado/);
  } finally { for (const c of [old, now, boss]) c.close(); sessions.closeLive('sesion-rota'); }
});

// N1: an agent's shell cannot reach Orb's data by another name (ORB_HOME, the database's name, its tickets and pipe).
test('guardia: ni ORB_HOME, ni orb.db, ni los tickets de Orb en un comando', () => {
  for (const command of ['type %ORB_HOME%\\.orb\\datos\\x', 'Get-Content $env:ORB_HOME/x', 'cat "$ORB_HOME/x"', 'python -c "import os; print(os.environ[\'ORB_HOME\'])"',
    'sqlite3 orb.db "select 1"', 'copy C:\\x\\orb.db-wal .', 'echo $env:ORB_TICKET_orb', 'set | findstr ORB_MCP_github_TOKEN', 'node -e "net.connect(process.env.ORB_AUTH_PIPE)"']) {
    assert.equal(decide({ permission: 'total', tool: 'Bash', command, internalDir: path.join(t.home, '.orb') }).decision, 'deny', command);
  }
  for (const command of ['npm test', 'cat orb.dbx', 'echo robot.db', 'git log --oneline']) assert.notEqual(decide({ permission: 'total', tool: 'Bash', command, internalDir: path.join(t.home, '.orb') }).decision, 'deny', command);
});

// B1: a call that does not say who makes it is refused (never this PC by default).
test('una llamada sin principal se niega, también la de un método inofensivo', async () => {
  for (const m of ['projects.list', 'app.state', 'config.save']) {
    await assert.rejects(api.call(m, {}), (e) => e instanceof PermissionError && e.status === 403, m);
    await assert.rejects(api.call(m, {}, null), PermissionError, m);
  }
  assert.ok(Array.isArray(await api.call('projects.list', {}, desktop)));
});

// The phone's own checks (remote.mjs › guardCall): never full access, never a picture that is not its own upload.
test('móvil: sin acceso total y sin imágenes que no subió él', async () => {
  const uploadsDir = path.join(t.home, '.orb', 'adjuntos-movil');
  assert.match(guardCall(board, 'sessions.create', { agent: 'claude', permission: 'total' }, { uploadsDir }), /acceso total/);
  assert.match(guardCall(board, 'tasks.create', { project: 'web', permission: 'total' }, { uploadsDir }), /acceso total/);
  const total = board.run("INSERT INTO sessions (id, kind, agent, cwd, permission, title, status, created_at, updated_at) VALUES ('total-1', 'chat', 'claude', '.', 'total', 't', 'idle', '', '')");
  assert.ok(total.changes);
  assert.match(guardCall(board, 'sessions.send', { id: 'total-1', text: 'hola' }, { uploadsDir }), /acceso total/);
  assert.equal(guardCall(board, 'sessions.stop', { id: 'total-1' }, { uploadsDir }), null, 'pararla sí');
  assert.match(guardCall(board, 'chat.send', { text: 'x', images: [path.join(t.home, 'orb.json')] }, { uploadsDir }), /imágenes subidas/);
  assert.match(guardCall(board, 'chat.send', { text: 'x', images: [path.join(uploadsDir, '..', 'datos', 'orb.db')] }, { uploadsDir }), /imágenes subidas/);
  assert.match(guardCall(board, 'chat.send', { text: 'x', images: [path.join(uploadsDir, 'foto.png')] }), /imágenes subidas/, 'sin carpeta de subidas, ninguna');
  assert.equal(guardCall(board, 'chat.send', { text: 'x', images: [path.join(uploadsDir, 'foto.png')] }, { uploadsDir }), null);
});

// M4: the phone chooses the brain of one conversation; the one new conversations start with is the PC's.
test('móvil: cambia el cerebro de una conversación, nunca el de las nuevas', async () => {
  const conv = board.createConversation({ title: 'Cerebro' }).id;
  const before = JSON.stringify(ctx.config.orchestrator);
  for (const p of [phone, browser]) {
    await assert.rejects(api.call('chat.settings', { reasoning: 'high' }, p), PermissionError, 'sin conversación');
    await assert.rejects(api.call('chat.settings', { conversation: conv, orchestrate: false }, p), PermissionError, 'el modo de las nuevas');
  }
  const info = await api.call('chat.settings', { conversation: conv, reasoning: 'low' }, phone);
  assert.equal(info.reasoning, 'low');
  assert.equal(board.conversation(conv).reasoning, 'low');
  assert.equal(JSON.stringify(ctx.config.orchestrator), before, 'config.orchestrator no cambia');
  // A new conversation from the phone with its own brain.
  const { conversation } = await api.call('chat.send', { text: 'hola', brain: { reasoning: 'high' } }, phone);
  assert.equal(board.conversation(conversation).reasoning, 'high');
  assert.equal(JSON.stringify(ctx.config.orchestrator), before);
  // On the PC the choice is also the one new conversations start with.
  await api.call('chat.settings', { reasoning: 'high' }, desktop);
  assert.equal(ctx.config.orchestrator.reasoning, 'high');
});

// B3: the state a phone gets has no folder of this PC.
test('móvil: el estado de la app llega sin carpetas del PC', async () => {
  board.setActiveProject('web', 'usuario');
  const state = await api.call('app.state', {}, phone);
  assert.ok(state.home && state.paths && state.activeProject.path, 'el PC sí las tiene');
  const shaped = shapeResult('app.state', state);
  assert.equal(shaped.home, undefined); assert.equal(shaped.paths, undefined);
  assert.equal(shaped.activeProject.name, 'web'); assert.equal(shaped.activeProject.path, undefined);
  assert.ok(!JSON.stringify(shaped).includes(JSON.stringify(t.home).slice(1, -1)), 'ninguna ruta de la carpeta de Orb');
});
