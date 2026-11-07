// 3.6 «Personas» (WS3): el modo Orb por persona. Ana (dueña) y Leo tienen cada uno su proyecto, conversación, tarea,
// programada, conversación directa y bitácora; ninguno ve nada del otro por la API ni por las herramientas de los agentes
// (MCP), y un proyecto compartido se ve, se habla o se edita según lo compartido.
import { tempHome, until, ROOT } from './helpers.mjs';
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { spawn } from 'node:child_process';
import { Board } from '../src/core/board.mjs';
import { createPerson } from '../src/core/persons.mjs';
import { principalOf, AuthzError } from '../src/core/authz.mjs';
import { decide, confineFor } from '../src/core/guard.mjs';
import { Sessions, agentToken } from '../src/engine/sessions.mjs';
import { Orchestrator } from '../src/engine/orchestrator.mjs';
import { Scheduler } from '../src/engine/scheduler.mjs';
import { buildApi } from '../src/engine/api.mjs';
import { writeLog } from '../src/engine/logs.mjs';

let t; let board; let sessions; let orchestrator; let api; let ana; let leo; let asAna; let asLeo; const events = [];
const ids = {};
before(async () => {
  t = tempHome();
  board = new Board();
  sessions = new Sessions(board, { emit: (event, payload) => events.push({ event, payload }) });
  orchestrator = new Orchestrator(board, 'clave', { emit: (event, payload) => events.push({ event, payload }) });
  const scheduler = new Scheduler(board, sessions, { orchestrator, emit: () => {} });
  api = buildApi({ board, sessions, orchestrator, scheduler, emit: (event, payload) => events.push({ event, payload }), log: () => {}, version: 'test' });
  ana = board.ownerId();
  leo = createPerson(board, { name: 'Leo', caps: { dev: true } }).id;
  asAna = principalOf(board, { desktop: true });
  asLeo = principalOf(board, { desktop: true, person: leo });
  // Each one with their own things (the texts carry a mark to look for in what the other one gets).
  const as = (who) => (method, params = {}) => api.call(method, params, who);
  const A = as(asAna); const L = as(asLeo);
  await A('projects.create', { name: 'web-ana', category: 'web' });
  await L('projects.create', { name: 'web-leo', category: 'web' });
  // Leo spends his own account (in his own folder of Orb).
  const acc = await L('accounts.add', { agent: 'claude', label: 'Cuenta de Leo' });
  ids.leoAccount = acc.id;
  assert.equal(acc.person, leo);
  assert.ok(acc.home.includes(path.join('cuentas', leo)), 'en su carpeta');
  ids.anaConv = (await A('chat.send', { text: 'SECRETO-ANA hola', project: 'web-ana' })).conversation;
  ids.leoConv = (await L('chat.send', { text: 'SECRETO-LEO hola', project: 'web-leo' })).conversation;
  ids.anaTask = (await A('tasks.create', { project: 'web-ana', title: 'SECRETO-ANA tarea', description: 'd' })).id;
  ids.leoTask = (await L('tasks.create', { project: 'web-leo', title: 'SECRETO-LEO tarea', description: 'd' })).id;
  ids.anaSched = (await A('schedules.create', { project: 'web-ana', title: 'SECRETO-ANA programada', description: 'd', every: 'daily', at_time: '09:00' })).id;
  ids.leoSched = (await L('schedules.create', { project: 'web-leo', title: 'SECRETO-LEO programada', description: 'd', every: 'daily', at_time: '09:00' })).id;
  ids.anaSession = (await A('sessions.create', { agent: 'claude', project: 'web-ana', title: 'SECRETO-ANA directa' })).id;
  ids.leoSession = (await L('sessions.create', { agent: 'claude', project: 'web-leo', title: 'SECRETO-LEO directa' })).id;
  writeLog(board, 'general', { tema: 'SECRETO-ANA general', hecho: 'x' }, 'Orb');
  writeLog(board, 'general', { tema: 'SECRETO-LEO general', hecho: 'x' }, 'Orb', { person: leo });
  writeLog(board, 'web-ana', { tema: 'SECRETO-ANA bitácora', hecho: 'x' }, 'Orb');
  await until(() => !orchestrator.busy, 'las respuestas del asistente');
});
after(() => { sessions.stopAll(); orchestrator.stopAll(); orchestrator.closeLive(); try { board.db.close(); } catch { /* closed */ } t.cleanup(); });

const call = (who, method, params = {}) => api.call(method, params, who);
const denied = (p) => assert.rejects(p, (e) => e instanceof AuthzError || /no tienes acceso|no es tuya/i.test(e.message));
const lists = async (who) => JSON.stringify(await Promise.all([
  call(who, 'conversations.list'), call(who, 'tasks.list'), call(who, 'projects.list'), call(who, 'schedules.list'), call(who, 'sessions.list'),
  call(who, 'logs.list'), call(who, 'logs.read', { project: 'general' }), call(who, 'mentions.options'), call(who, 'approvals.list'), call(who, 'chat.list', {}),
  call(who, 'conversations.search', { q: 'secreto' }), call(who, 'tasks.live'), call(who, 'usage.get'), call(who, 'app.state').then((s) => ({ counts: s.counts, active: s.activeProject, chats: s.chats }))
]));

test('lo de cada uno es suyo: ninguna lista enseña lo del otro (tampoco al dueño)', async () => {
  const leoSees = await lists(asLeo);
  assert.ok(!leoSees.includes('SECRETO-ANA') && !leoSees.includes('web-ana'), 'Leo no ve nada de Ana');
  assert.ok(leoSees.includes('SECRETO-LEO tarea') && leoSees.includes('web-leo'), 'sí lo suyo');
  const anaSees = await lists(asAna);
  assert.ok(!anaSees.includes('SECRETO-LEO') && !anaSees.includes('web-leo'), 'la dueña no ve el contenido de Leo');
  assert.ok(anaSees.includes('SECRETO-ANA tarea'));
  // Each one's general log is theirs.
  assert.match(await call(asLeo, 'logs.read', { project: 'general' }), /SECRETO-LEO general/);
  assert.match(await call(asAna, 'logs.read', { project: 'general' }), /SECRETO-ANA general/);
  // Rows carry their person.
  assert.equal(board.task(ids.leoTask).person_id, leo);
  assert.equal(board.one('SELECT person_id FROM schedules WHERE id = ?', ids.leoSched).person_id, leo);
  assert.equal(sessions.get(ids.leoSession).person_id, leo);
  assert.equal(sessions.get(ids.leoSession).account, ids.leoAccount, 'su conversación gasta su cuenta');
  assert.equal(board.conversation(ids.leoConv).person_id, leo);
  assert.equal(board.project('web-leo').person_id, leo);
});

test('con los ids del otro, todo se niega', async () => {
  for (const [who, mine, theirs] of [[asLeo, 'leo', 'ana'], [asAna, 'ana', 'leo']]) {
    const conv = ids[`${theirs}Conv`]; const task = ids[`${theirs}Task`]; const s = ids[`${theirs}Session`]; const proj = `web-${theirs}`; const sched = ids[`${theirs}Sched`];
    for (const [m, p] of [['chat.list', { conversation: conv }], ['chat.send', { conversation: conv, text: 'x' }], ['conversations.update', { id: conv, title: 'x' }], ['conversations.remove', { id: conv }],
      ['tasks.get', { id: task }], ['tasks.cancel', { id: task }], ['tasks.followup', { id: task, text: 'x' }], ['sessions.items', { id: s }], ['sessions.send', { id: s, text: 'x' }], ['sessions.remove', { id: s }],
      ['projects.info', { name: proj }], ['projects.remove', { name: proj }], ['whiteboard.load', { project: proj }], ['whiteboard.save', { project: proj, elements: [] }], ['logs.read', { project: proj }],
      ['tasks.create', { project: proj, title: 'x', description: 'y' }], ['sessions.create', { agent: 'claude', project: proj }], ['schedules.update', { id: sched, enabled: false }], ['schedules.run', { id: sched }],
      ['projects.setActive', { name: proj }]]) {
      await denied(call(who, m, p), `${mine} → ${m}`);
    }
  }
  assert.ok(board.one("SELECT COUNT(*) AS n FROM audit WHERE decision = 'deny' AND person_id = ?", leo).n > 10, 'queda en la auditoría');
  assert.ok(!JSON.stringify(board.all('SELECT * FROM audit')).includes('SECRETO'), 'sin contenido');
});

test('@ solo adjunta lo que la persona puede ver', async () => {
  const { expandMentions } = await import('../src/engine/mentions.mjs');
  const text = `mira @tarea:${ids.anaTask} y @conversacion:${ids.anaSession} y @bitacora:web-ana`;
  assert.equal(expandMentions(board, sessions, text, { principal: asLeo }), '');
  assert.match(expandMentions(board, sessions, text, { principal: asAna }), /SECRETO-ANA tarea/);
});

test('modo Orb: sin permiso de programar, nada', async () => {
  const eva = createPerson(board, { name: 'Eva' }).id;
  const asEva = principalOf(board, { desktop: true, person: eva });
  await assert.rejects(call(asEva, 'projects.create', { name: 'web-eva', category: 'web' }), /programar/);
  await assert.rejects(call(asEva, 'sessions.create', { agent: 'claude' }), /programar/);
});

test('una sesión de otra persona solo trabaja dentro de la carpeta de su proyecto (ruta real)', () => {
  const own = board.project('web-leo').path; const other = board.project('web-ana').path;
  const confine = confineFor({ roots: [own], others: [other] });
  const ask = (x) => decide({ permission: 'editar', confine, internalDir: path.join(t.home, '.orb'), ...x }).decision;
  assert.equal(ask({ tool: 'Read', paths: [path.join(own, 'index.html')] }), 'allow');
  assert.equal(ask({ tool: 'Read', paths: ['src/app.js'] }), 'allow', 'relativa: dentro');
  assert.equal(ask({ tool: 'Read', paths: [path.join(other, 'index.html')] }), 'deny', 'el proyecto de otra persona');
  assert.equal(ask({ tool: 'Read', paths: [path.join(own, '..', 'web-ana', 'x')] }), 'deny', 'con ..');
  assert.equal(ask({ tool: 'Glob', patterns: ['../**/*.md'] }), 'deny', 'un patrón que sale');
  assert.equal(ask({ tool: 'Bash', command: `type "${path.join(other, 'secreto.txt')}"` }), 'deny', 'un comando que nombra otra carpeta');
  assert.equal(ask({ tool: 'Read', paths: [path.join(own, '.env')] }), 'deny', 'secretos, aunque estén dentro');
  // A link inside the project that points to the other one.
  const link = path.join(own, 'enlace');
  try { fs.symlinkSync(other, link, 'junction'); } catch { /* links not allowed here */ }
  if (fs.existsSync(link)) assert.equal(ask({ tool: 'Read', paths: [path.join(link, 'index.html')] }), 'deny', 'por un enlace');
  // The owner's sessions are not confined.
  assert.equal(decide({ permission: 'editar', tool: 'Read', paths: [path.join(other, 'x')] }).decision, 'allow');
});

function mcp(env) {
  const child = spawn(process.execPath, [path.join(ROOT, 'src', 'mcp', 'server.mjs')], { env: { ...process.env, ORB_HOME: t.home, ...env }, stdio: ['pipe', 'pipe', 'inherit'] });
  const replies = new Map(); let n = 0;
  readline.createInterface({ input: child.stdout }).on('line', (l) => { const m = JSON.parse(l); replies.get(m.id)?.(m); });
  const rpc = (method, params) => new Promise((r) => { const id = ++n; replies.set(id, r); child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`); });
  return {
    call: async (name, args = {}) => { const r = (await rpc('tools/call', { name, arguments: args })).result; return { error: Boolean(r.isError), text: r.content[0].text }; },
    close: () => child.stdin.end()
  };
}

test('las herramientas de un agente de Leo solo ven lo de Leo', async () => {
  const worker = mcp({ ORB_AGENT: 'claude', ORB_TASK_ID: String(ids.leoTask), ORB_AGENT_TOKEN: agentToken(board, 'claude', ids.leoTask, leo) });
  try {
    const listed = await worker.call('orb_list_tasks');
    assert.ok(!listed.error && listed.text.includes('SECRETO-LEO') && !listed.text.includes('SECRETO-ANA'), listed.text);
    const summary = await worker.call('orb_board');
    assert.ok(!summary.text.includes('SECRETO-ANA') && !summary.text.includes('Ana'), summary.text);
    assert.ok((await worker.call('orb_get_task', { id: ids.anaTask })).error, 'la tarea de Ana');
    assert.ok((await worker.call('orb_update_task', { id: ids.anaTask, note: 'x' })).error);
    assert.ok((await worker.call('orb_send_message', { to: 'codex', body: 'x', task_id: ids.anaTask })).error);
  } finally { worker.close(); }
  // The coordinator of Leo's conversation: his logs and projects only.
  const crypto = await import('node:crypto');
  const key = 'clave-coordinador';
  board.setting('orchestrator_key_hash', crypto.createHash('sha256').update(key).digest('hex'));
  const { conversationSig } = await import('../src/engine/sessions.mjs');
  const boss = mcp({ ORB_AGENT: 'orb', ORB_ORCH_KEY: key, ORB_CONVERSATION: String(ids.leoConv), ORB_CONVERSATION_TOKEN: conversationSig(key, ids.leoConv) });
  try {
    const general = await boss.call('orb_read_log', { project: 'general' });
    assert.ok(general.text.includes('SECRETO-LEO general') && !general.text.includes('SECRETO-ANA'), general.text);
    assert.ok((await boss.call('orb_read_log', { project: 'web-ana' })).error, 'la bitácora del proyecto de Ana');
    assert.ok(!(await boss.call('orb_read_log', {})).text.includes('web-ana'));
    assert.ok((await boss.call('orb_create_task', { project: 'web-ana', title: 'x', description: 'y' })).error);
    const made = await boss.call('orb_create_task', { project: 'web-leo', title: 'Del asistente de Leo', description: 'y' });
    assert.ok(!made.error, made.text);
    assert.equal(board.task(JSON.parse(made.text).id).person_id, leo);
    assert.ok((await boss.call('orb_write_log', { project: 'web-ana', tema: 'x', hecho: 'y' })).error);
  } finally { boss.close(); }
  // A conversation id without its signature works for nobody.
  const forged = mcp({ ORB_AGENT: 'orb', ORB_ORCH_KEY: key, ORB_CONVERSATION: String(ids.anaConv), ORB_CONVERSATION_TOKEN: 'a'.repeat(64) });
  try { assert.ok(!(await forged.call('orb_list_tasks')).text.includes('SECRETO-LEO')); } finally { forged.close(); }
});

test('el asistente de Leo le habla a Leo y con su cuenta', async () => {
  const { persona } = await import('../src/engine/orchestrator.mjs');
  assert.match(persona(board, leo), /Leo te pide algo/);
  assert.ok(!/Ana/.test(persona(board, leo)));
  assert.equal(orchestrator.lane(ids.leoConv).liveAccount, ids.leoAccount);
  const spent = board.one('SELECT COUNT(*) AS n FROM usage_ledger WHERE person_id = ? AND conversation_id = ?', leo, ids.leoConv).n;
  assert.ok(spent >= 1, 'su turno queda apuntado a su nombre');
});
