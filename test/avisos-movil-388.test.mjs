// The phone's notice centre (3.8.8): the notices that are not a chat line (task done and reviewed, task held, new Orb
// version, account out of its limit), the short list of what was sent (notes.list) and its limits.
import { tempHome } from './helpers.mjs';
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { Board } from '../src/domain/tasks/board.mjs';
import { Sessions } from '../src/engine/sessions.mjs';
import { Orchestrator } from '../src/engine/orchestrator.mjs';
import { Scheduler } from '../src/engine/scheduler/index.mjs';
import { buildApi } from '../src/engine/api/index.mjs';
import { createRemote, guardCall } from '../src/engine/transport/remote.mjs';
import { noticeNote, createLimitWatch } from '../src/engine/transport/notes-center.mjs';
import { recordNote, listRecent, RECENT_MAX, RECENT_DAYS } from '../src/domain/notes/recent.mjs';
import { DESKTOP, REMOTE_METHODS, principalOf } from '../src/domain/security/permissions.mjs';
import { buildNote } from '../src/shared/notes.mjs';
import { ctx } from '../src/platform/context.mjs';
import { setMark } from '../src/domain/conversations/inbox.mjs';
import { createSchedule } from '../src/domain/schedules/schedules.mjs';
import { prepareWorkdir } from '../src/domain/tasks/checkpoints.mjs';

let t; let board; let api; let remote; let pushLog;
const call = (method, params = {}) => api.call(method, params, DESKTOP);
const DAY = 86_400_000;
const wipe = () => board.run('DELETE FROM mobile_notes');
// A linked phone that can take Web Push (the test agents write the push to ORB_PUSH_LOG instead of sending it).
const link = (id = 'd1') => {
  const at = new Date().toISOString();
  board.run('INSERT OR REPLACE INTO devices (id, name, token_hash, created_at, last_seen, public_key, route, kind, ip, meta, push) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    id, 'Móvil', `clave:${id}`, at, at, 'AAAA', 'lan', 'phone', '127.0.0.1', '{}', JSON.stringify({ endpoint: `https://push.test/${id}` }));
};
const pushed = () => (fs.existsSync(pushLog) ? fs.readFileSync(pushLog, 'utf8').split(/\r?\n/).filter(Boolean).map((l) => JSON.parse(l).data) : []);

before(() => {
  t = tempHome();
  pushLog = path.join(t.home, 'push.log'); process.env.ORB_PUSH_LOG = pushLog;
  board = new Board();
  const emit = () => {};
  const sessions = new Sessions(board, { emit });
  const orchestrator = new Orchestrator(board, { emit });
  const scheduler = new Scheduler(board, sessions, { orchestrator, emit });
  api = buildApi({ board, sessions, orchestrator, scheduler, emit, log: () => {}, version: 'test', remoteRef: { current: null, link: null } });
  remote = createRemote({ board, api, log: () => {}, emit, version: 'test' });
  link();
});
after(() => { try { board.db.close(); } catch { /* closed */ } t.cleanup(); });

test('cada tipo nuevo: una nota sin acciones, con tipo, destino y texto corto', () => {
  const done = noticeNote({ kind: 'done', task: 42 });
  assert.deepEqual({ ...done, id: undefined }, { key: 'done:42', id: undefined, route: { view: 'tasks', id: 42 }, title: 'Orb', body: '#42 terminada y revisada', hidden: false,
    kind: 'done', icon: '/icon.png', actions: [], silent: false, target: { type: 'task', id: 42 } });
  assert.ok(Number.isInteger(done.id) && done.id >= 20_000);
  const held = noticeNote({ kind: 'held', task: 39, reasons: 'ha eliminado 12 archivos' });
  assert.equal(held.body, 'Orb paró la #39 · ha eliminado 12 archivos'); assert.equal(held.kind, 'held'); assert.deepEqual(held.target, { type: 'task', id: 39 });
  assert.equal(noticeNote({ kind: 'held', task: 39, reasons: '' }).body, 'Orb paró la #39 · necesita tu revisión');
  const update = noticeNote({ kind: 'update', version: '3.8.9' });
  assert.equal(update.body, 'Orb 3.8.9 disponible en el PC'); assert.deepEqual(update.target, { type: 'version', id: '3.8.9' });
  assert.deepEqual(update.route, { view: 'chat' });
  const limit = noticeNote({ kind: 'limit', account: 'claude' });
  assert.equal(limit.kind, 'limit'); assert.deepEqual(limit.target, { type: 'account', id: 'claude' }); assert.match(limit.body, /^.+ ya tiene límite otra vez$/);
  for (const n of [done, held, update, limit]) { assert.deepEqual(n.actions, []); assert.equal(n.card, undefined); assert.equal(n.acts, undefined); }
  assert.equal(noticeNote({ kind: 'done', task: 'x' }), null); assert.equal(noticeNote({ kind: 'weird' }), null); assert.equal(noticeNote({ kind: 'update' }), null);
});

test('vista previa apagada: sin detalle, pero con tipo y destino', () => {
  const n = noticeNote({ kind: 'held', task: 39, reasons: 'ha eliminado 12 archivos' }, { preview: 'none', hiddenText: 'Tienes un mensaje nuevo' });
  assert.equal(n.hidden, true); assert.equal(n.body, 'Tienes un mensaje nuevo'); assert.equal(n.title, 'Orb');
  assert.ok(!JSON.stringify(n).includes('eliminado'));
  assert.equal(n.kind, 'held'); assert.deepEqual(n.target, { type: 'task', id: 39 });
  assert.equal(noticeNote({ kind: 'done', task: 1 }, { preview: 'all' }).hidden, false);
});

test('el motivo no lleva rutas ni secretos', () => {
  const n = noticeNote({ kind: 'held', task: 5, reasons: 'ha borrado C:\\Users\\ana\\proyectos\\web\\x.txt y /home/ana/web con sk-abcdefghijkl1234 y Bearer abcdefgh12345678' });
  for (const bad of ['C:\\', 'Users', '/home', 'sk-abc', 'abcdefgh12345678']) assert.ok(!n.body.includes(bad), bad);
  assert.ok(n.body.length <= 160);
  assert.match(n.body, /^Orb paró la #5 · ha borrado …/);
});

test('el idioma del PC elige el texto', () => {
  const was = ctx.config.language;
  ctx.config = { ...ctx.config, language: 'en' };
  try { assert.equal(noticeNote({ kind: 'done', task: 7 }).body, '#7 finished and reviewed'); } finally { ctx.config = { ...ctx.config, language: was }; }
});

test('remote.announce entrega y guarda; la actualización, una sola vez por versión', () => {
  wipe();
  assert.equal(remote.announce({ kind: 'update', version: '3.8.9' }), true);
  assert.equal(remote.announce({ kind: 'update', version: '3.8.9' }), false, 'la misma versión no se repite');
  assert.equal(remote.announce({ kind: 'update', version: '3.9.0' }), true, 'otra versión sí');
  assert.equal(remote.announce({ kind: 'done', task: 42 }), true);
  assert.equal(remote.announce({ kind: 'nada' }), false);
  const { notes } = listRecent(board, {}) && { notes: listRecent(board, {}) };
  assert.deepEqual(notes.map((n) => n.kind), ['done', 'update', 'update']);
  assert.deepEqual(notes[0].target, { type: 'task', id: 42 });
});

test('vista previa apagada en el ajuste del PC: lo guardado tampoco lleva detalle', () => {
  wipe();
  const was = ctx.config.mobile;
  ctx.config = { ...ctx.config, mobile: { ...(was ?? {}), preview: 'none' } };
  try { remote.announce({ kind: 'held', task: 8, reasons: 'ha eliminado 3 archivos' }); } finally { ctx.config = { ...ctx.config, mobile: was }; }
  const [n] = listRecent(board, {});
  assert.equal(n.hidden, true); assert.ok(!n.body.includes('eliminado')); assert.equal(n.kind, 'held');
});

test('un aviso de chat se guarda con su forma de siempre, sin acciones ni tokens', () => {
  wipe();
  const c = board.createConversation({ title: 'Casa' }).id;
  remote.broadcast('chat:new', { role: 'orb', body: 'Ya está', meta: null, conversation: c });
  remote.broadcast('chat:new', { role: 'system', body: 'tarea #3 espera', meta: { kind: 'attention', task: 3 }, conversation: c });
  const [task, msg] = listRecent(board, {});
  assert.equal(msg.kind, 'message'); assert.equal(msg.title, 'Casa'); assert.equal(msg.body, 'Ya está'); assert.deepEqual(msg.route, { view: 'chat', id: c }); assert.deepEqual(msg.target, { type: 'chat', id: c });
  assert.equal(task.kind, 'task'); assert.deepEqual(task.target, { type: 'task', id: 3 });
  for (const n of [task, msg]) { assert.equal(n.actions, undefined); assert.equal(n.card, undefined); assert.equal(n.acts, undefined); assert.ok(!JSON.stringify(n).includes('token')); }
  // the note the app reads today keeps every field it knew
  const live = buildNote({ chat: { kind: 'conversation', id: c, name: 'Casa' }, line: { id: 1, role: 'orb', body: 'Ya está' } });
  for (const f of ['key', 'id', 'route', 'title', 'body', 'kind', 'actions', 'silent']) assert.ok(f in live, f);
});

test('notes.list: del más nuevo al más viejo, since y tope', async () => {
  wipe();
  const now = Date.now();
  for (let i = 1; i <= 5; i++) recordNote(board, { key: `k${i}`, kind: 'done', title: 'Orb', body: `n${i}`, hidden: false, route: { view: 'chat' }, target: { type: 'task', id: i } }, { now: now - (6 - i) * 1000 });
  const all = (await call('notes.list')).notes;
  assert.deepEqual(all.map((n) => n.body), ['n5', 'n4', 'n3', 'n2', 'n1']);
  assert.deepEqual(Object.keys(all[0]).sort(), ['at', 'body', 'hidden', 'id', 'key', 'kind', 'route', 'target', 'title']);
  assert.ok(all[0].id > all[1].id && all[0].at > all[1].at);
  assert.deepEqual((await call('notes.list', { since: all[2].at })).notes.map((n) => n.body), ['n5', 'n4'], 'since es exclusivo');
  assert.deepEqual((await call('notes.list', { limit: 2 })).notes.map((n) => n.body), ['n5', 'n4']);
  assert.equal((await call('notes.list', { limit: 9999 })).notes.length, 5, 'el tope no pasa de lo guardado');
  await assert.rejects(call('notes.list', { since: 'ayer' }));
  await assert.rejects(call('notes.list', { limit: {} }));
});

test('limpieza: como mucho 100 y 7 días, al escribir', () => {
  wipe();
  const now = Date.now();
  for (let i = 0; i < RECENT_MAX + 5; i++) recordNote(board, { key: `k${i}`, kind: 'message', title: 'Orb', body: `m${i}`, route: null }, { now: now + i });
  assert.equal(board.one('SELECT COUNT(*) AS n FROM mobile_notes').n, RECENT_MAX);
  assert.equal(listRecent(board, { limit: 500, now: now + 200 })[0].body, `m${RECENT_MAX + 4}`);
  assert.ok(!board.one("SELECT 1 AS x FROM mobile_notes WHERE body = 'm0'"), 'los más viejos salen primero');
  wipe();
  const old = (body, at) => board.run("INSERT INTO mobile_notes (at, key, kind, title, body) VALUES (?, 'x', 'message', 'Orb', ?)", at, body);
  old('viejo', now - (RECENT_DAYS + 1) * DAY); old('casi', now - (RECENT_DAYS - 1) * DAY);
  assert.deepEqual(listRecent(board, { now }).map((n) => n.body), ['casi'], 'al leer cuenta la antigüedad');
  recordNote(board, { key: 'b', kind: 'message', title: 'Orb', body: 'nuevo' }, { now });
  assert.ok(!board.one("SELECT 1 AS x FROM mobile_notes WHERE body = 'viejo'"), 'se borra al escribir');
  assert.deepEqual(listRecent(board, { now }).map((n) => n.body), ['nuevo', 'casi']);
  assert.deepEqual(listRecent(board, { now: now + 2 * DAY }).map((n) => n.body), ['nuevo']);
});

test('un chat en la papelera no reaparece en la lista (y vuelve si se restaura)', async () => {
  wipe();
  const keep = board.createConversation({ title: 'Se queda' }).id;
  const gone = board.createConversation({ title: 'A la papelera' }).id;
  recordNote(board, { key: 'a', kind: 'message', title: 'Se queda', body: 'uno' }, { conversation: keep });
  recordNote(board, { key: 'b', kind: 'message', title: 'A la papelera', body: 'dos' }, { conversation: gone });
  recordNote(board, { key: 'c', kind: 'done', title: 'Orb', body: 'tres' });
  board.run('UPDATE conversations SET trashed_at = ? WHERE id = ?', new Date().toISOString(), gone);
  assert.deepEqual((await call('notes.list')).notes.map((n) => n.body), ['tres', 'uno']);
  board.run('UPDATE conversations SET trashed_at = NULL WHERE id = ?', gone);
  assert.equal((await call('notes.list')).notes.length, 3);
  // purged for good: its notices go on the next write
  board.run('DELETE FROM conversations WHERE id = ?', gone);
  assert.equal((await call('notes.list')).notes.length, 2, 'una conversación que ya no existe tampoco sale');
  recordNote(board, { key: 'd', kind: 'done', title: 'Orb', body: 'cuatro' });
  assert.ok(!board.one("SELECT 1 AS x FROM mobile_notes WHERE body = 'dos'"));
});

test('permisos: notes.list es del móvil, solo lectura, y la guardia lo deja pasar', () => {
  assert.ok(REMOTE_METHODS.has('notes.list'));
  assert.equal(guardCall(board, 'notes.list', {}), null);
  assert.ok(principalOf({ device: { id: 'd' } }), 'el móvil tiene su principal');
  const src = fs.readFileSync(new URL('../src/engine/api/index.mjs', import.meta.url), 'utf8');
  const body = src.slice(src.indexOf("'notes.list'"), src.indexOf("'logs.list'"));
  assert.ok(!/board\.run|board\.setting|emit\(/.test(body), 'no escribe ni emite');
});

test('«límite otra vez»: solo al pasar de limitado a disponible, una vez', () => {
  const said = [];
  const list = [{ id: 'claude' }, { id: 'codex' }];
  const w = createLimitWatch({ board, announce: (f) => said.push(f), listAccounts: () => list });
  w.tick(); w.tick();
  assert.deepEqual(said, [], 'sin límite no hay aviso');
  board.setting('cooldown:claude', String(Date.now() + 60_000));
  w.tick(); w.tick();
  assert.deepEqual(said, [], 'entrar en el límite no avisa');
  board.setting('cooldown:claude', String(Date.now() - 1));
  w.tick(); w.tick(); w.tick();
  assert.deepEqual(said, [{ kind: 'limit', account: 'claude' }], 'una vez al salir');
  // a pause for another reason (login) is not a usage limit
  board.setting('cooldown:codex', String(Date.now() + 60_000)); board.setting('cooldown_reason:codex', 'sin sesión');
  w.tick(); board.setting('cooldown:codex', '');
  w.tick();
  assert.equal(said.length, 1);
  // starting with an account already limited says nothing, and leaving the limit later says it
  board.setting('cooldown:claude', String(Date.now() + 60_000));
  const w2 = createLimitWatch({ board, announce: (f) => said.push(f), listAccounts: () => list });
  w2.tick(); board.setting('cooldown:claude', ''); w2.tick();
  assert.equal(said.length, 2);
});

test('un chat silenciado no guarda fila; con la caducidad pasada vuelve a avisar', () => {
  wipe();
  const c = board.createConversation({ title: 'Mudo' }).id;
  setMark(board, 'conversation', c, { muted: true });
  remote.broadcast('chat:new', { role: 'orb', body: 'Hola', meta: null, conversation: c });
  assert.equal(board.one('SELECT COUNT(*) AS n FROM mobile_notes').n, 0, 'silenciado: nada guardado');
  setMark(board, 'conversation', c, { muted: true, mutedUntil: new Date(Date.now() - 60_000).toISOString() });
  remote.broadcast('chat:new', { role: 'orb', body: 'Hola otra vez', meta: null, conversation: c });
  assert.equal(board.one('SELECT COUNT(*) AS n FROM mobile_notes').n, 1, 'silencio caducado: avisa');
});

test('la nota en vivo de un mensaje de chat normal es la de siempre', () => {
  wipe(); fs.rmSync(pushLog, { force: true });
  const c = board.createConversation({ title: 'Casa' }).id;
  const line = { id: 7, role: 'orb', body: 'Ya está', meta: null };
  remote.broadcast('chat:new', { ...line, conversation: c });
  const expected = buildNote({ chat: { kind: 'conversation', id: c, name: 'Casa' }, line, preview: 'chat', assistantName: ctx.config.assistantName ?? 'Orb' });
  const [got] = pushed(); assert.ok(got, 'se envió un aviso');
  for (const k of ['title', 'body', 'hidden', 'icon', 'route', 'kind']) assert.deepEqual(got[k], expected[k], k);
  assert.equal(got.tag, `orb-${expected.key}`);
  assert.deepEqual(got.actions.map((a) => a.id), expected.actions.map((a) => a.id));
});

test('sin ningún móvil enlazado no se guarda nada, y la versión nueva no gasta su marca', () => {
  wipe(); board.run('DELETE FROM devices');
  const c = board.createConversation({ title: 'Sin móvil' }).id;
  remote.broadcast('chat:new', { role: 'orb', body: 'Hola', meta: null, conversation: c });
  assert.equal(remote.announce({ kind: 'done', task: 5 }), false);
  assert.equal(remote.announce({ kind: 'update', version: '4.0.0' }), false);
  assert.equal(board.one('SELECT COUNT(*) AS n FROM mobile_notes').n, 0);
  assert.ok(!board.setting('note_update:4.0.0'), 'la marca de «una vez por versión» sigue libre');
  link();
  assert.equal(remote.announce({ kind: 'update', version: '4.0.0' }), true, 'el primer móvil sí lo recibe');
  assert.equal(remote.announce({ kind: 'update', version: '4.0.0' }), false);
});

test('desenlazar vacía la lista: el último dispositivo y «he olvidado la contraseña»', () => {
  wipe(); board.run('DELETE FROM devices'); link('d1'); link('d2');
  remote.announce({ kind: 'done', task: 1 });
  assert.equal(board.one('SELECT COUNT(*) AS n FROM mobile_notes').n, 1);
  remote.revoke('d1');
  assert.equal(board.one('SELECT COUNT(*) AS n FROM mobile_notes').n, 1, 'queda otro móvil: se conserva');
  remote.revoke('d2');
  assert.equal(board.one('SELECT COUNT(*) AS n FROM mobile_notes').n, 0, 'sin móviles: vacía');
  link('d3'); remote.announce({ kind: 'done', task: 2 });
  assert.equal(board.one('SELECT COUNT(*) AS n FROM mobile_notes').n, 1);
  assert.equal(remote.revokeAll(), 1);
  assert.equal(board.one('SELECT COUNT(*) AS n FROM mobile_notes').n, 0);
  link();
});

test('notes.list con la vista previa apagada: oculta lo que se guardó con detalle', async () => {
  wipe();
  const c = board.createConversation({ title: 'Secreto de casa' }).id;
  remote.broadcast('chat:new', { role: 'orb', body: 'Contraseña nueva en el sobre', meta: null, conversation: c });
  remote.announce({ kind: 'held', task: 9, reasons: 'ha eliminado 12 archivos' });
  const shown = (await call('notes.list')).notes;
  assert.ok(shown.some((n) => n.body.includes('sobre')) && shown.every((n) => !n.hidden));
  const was = ctx.config.mobile;
  ctx.config = { ...ctx.config, mobile: { ...(was ?? {}), preview: 'none' } };
  try {
    const hidden = (await call('notes.list')).notes;
    assert.equal(hidden.length, 2);
    for (const n of hidden) { assert.equal(n.hidden, true); assert.equal(n.title, ctx.config.assistantName ?? 'Orb'); assert.ok(!/sobre|eliminado|Secreto/.test(JSON.stringify(n))); }
    assert.deepEqual(hidden.map((n) => n.kind).sort(), ['held', 'message']);
    assert.ok(hidden.every((n) => n.route && n.target), 'conserva destino');
  } finally { ctx.config = { ...ctx.config, mobile: was }; }
});

test('límite: una pausa por uso que pasa a pausa por sesión no marca la cuenta como limitada', () => {
  const said = [];
  const w = createLimitWatch({ board, announce: (f) => said.push(f), listAccounts: () => [{ id: 'gemini' }] });
  board.setting('cooldown:gemini', String(Date.now() + 60_000));
  w.tick(); // paused by usage
  board.setting('cooldown_reason:gemini', 'sin sesión'); // now paused by login
  w.tick();
  board.setting('cooldown:gemini', ''); board.setting('cooldown_reason:gemini', '');
  w.tick();
  assert.deepEqual(said, [], 'iniciar sesión no es «ya hay uso»');
});

// ---- the engine's facts, through the real closing of a task
const gitRaw = (cwd, ...a) => execFileSync('git', ['-C', cwd, '-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'core.autocrlf=false', ...a], { stdio: 'pipe', encoding: 'utf8' });
let projects = 0;
function repo(files = 20) {
  const name = `aviso${++projects}`; const dir = path.join(t.home, 'web', name); fs.mkdirSync(dir, { recursive: true });
  gitRaw(dir, 'init', '-q');
  for (let i = 0; i < files; i++) { const f = path.join(dir, 'src', `f${i}.txt`); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, `file ${i}\n`); }
  gitRaw(dir, 'add', '-A'); gitRaw(dir, 'commit', '-q', '-m', 'base');
  board.addProject({ name, path: dir }, 'usuario', { fromUser: true });
  return { name, dir };
}
const ended = { code: 0, state: { final: 'hecho', text: 'hecho', isError: false }, stderr: '', stopped: false, timedOut: false, limit: null };
// A scheduler whose notices are collected (the real one hands them to remote.announce).
function runner() {
  const facts = [];
  const sched = new Scheduler(board, { closeLive() {}, stop() {} }, { log: () => {}, announce: (f) => facts.push(f) });
  return { facts, sched };
}
const folderTask = (sched, p, extra = {}) => {
  const task = board.createTask({ project: p.name, title: 'Trabajo', description: 'x', agent: 'claude', ...extra }, 'usuario');
  sched.folderWorkspace(board.task(task.id), board.project(p.name));
  board.patch(task.id, { status: 'running', pid: 4242 }, 'orb', 'task.launched');
  return board.task(task.id);
};
const finish = async (sched, id, info = ended) => { sched.running.set(id, { sessionId: 's', agent: 'claude' }); await sched.finish(id, info); };
const linesOf = (id) => board.all('SELECT id, body, meta FROM chat ORDER BY id').map((r) => ({ ...r, meta: r.meta ? JSON.parse(r.meta) : null })).filter((r) => r.meta?.task === id);
const phoneNote = (line) => buildNote({ chat: { kind: 'conversation', id: 1, name: 'x' }, line: { id: line.id, role: 'system', body: line.body, meta: line.meta } });
const withoutQuiet = (line) => ({ ...line, meta: { ...line.meta, quiet: undefined } });
const del = (p, n) => { for (let i = 0; i < n; i++) fs.rmSync(path.join(p.dir, 'src', `f${i}.txt`)); };
const scheduleOf = (p, notify) => { const s = createSchedule(board, { project: p.name, title: 'Noche', description: 'x', agent: 'claude', every: 'every_hours', hours: 1, notify_mobile: notify }, 'usuario'); return s.id ?? s; };

test('tarea retenida por borrado: un solo aviso con motivo fijo; sus líneas de chat quedan pero no avisan', async () => {
  const { facts, sched } = runner(); const p = repo(); const task = folderTask(sched, p);
  del(p, 12);
  await finish(sched, task.id);
  assert.equal(board.task(task.id).status, 'blocked');
  assert.deepEqual(facts, [{ kind: 'held', task: task.id, reasons: 'ha eliminado 12 de 20 archivos del proyecto (60 %)' }]);
  assert.equal(noticeNote(facts[0]).body, `Orb paró la #${task.id} · ha eliminado 12 de 20 archivos del proyecto (60 %)`);
  const lines = linesOf(task.id);
  const stopped = lines.find((l) => l.body.startsWith('⚠️')); const end = lines.find((l) => l.meta.kind === 'task-end');
  assert.ok(stopped && end, 'las dos líneas siguen en el chat');
  for (const l of [stopped, end]) { assert.equal(l.meta.quiet, true); assert.equal(phoneNote(l), null); assert.ok(phoneNote(withoutQuiet(l)), 'sin la marca avisaría'); }
});

test('tarea retenida por archivos con secretos: «necesita tu revisión», sin nombres', async () => {
  const { facts, sched } = runner(); const p = repo(3);
  const task = board.createTask({ project: p.name, title: 'Copia', description: 'x', agent: 'claude', mode: 'aislada' }, 'usuario');
  const wt = prepareWorkdir(board.task(task.id), board.project(p.name), ctx.paths.worktrees);
  fs.writeFileSync(path.join(wt.workdir, '.env'), 'API_KEY=abc\n');
  board.patch(task.id, { status: 'running', pid: 4242, branch: wt.branch, workdir: wt.workdir }, 'orb', 'task.launched');
  await finish(sched, task.id);
  assert.equal(board.task(task.id).status, 'blocked');
  assert.equal(facts.length, 1); assert.equal(facts[0].kind, 'held'); assert.equal(facts[0].reasons, '');
  const note = noticeNote(facts[0]);
  assert.equal(note.body, `Orb paró la #${task.id} · necesita tu revisión`); assert.ok(!/\.env|API_KEY|abc/.test(JSON.stringify(note)));
  const end = linesOf(task.id).find((l) => l.meta.kind === 'task-end');
  assert.equal(end.meta.quiet, true); assert.equal(phoneNote(end), null);
});

test('programación con «no avisar al móvil»: ni aviso nuevo ni cambio en las líneas de chat', async () => {
  const { facts, sched } = runner(); const p = repo();
  const task = folderTask(sched, p, { schedule_id: scheduleOf(p, false) });
  del(p, 12);
  await finish(sched, task.id);
  assert.deepEqual(facts, [], 'sin aviso nuevo');
  const lines = linesOf(task.id);
  const stopped = lines.find((l) => l.body.startsWith('⚠️')); const end = lines.find((l) => l.meta.kind === 'task-end');
  assert.equal(stopped.meta.quiet, undefined, 'la línea de seguridad queda como antes');
  assert.equal(end.meta.quiet, true, 'la de fin ya era silenciosa por la programación');
});

test('programación que sí avisa: el aviso nuevo manda', async () => {
  const { facts, sched } = runner(); const p = repo();
  const task = folderTask(sched, p, { schedule_id: scheduleOf(p, true) });
  del(p, 12);
  await finish(sched, task.id);
  assert.equal(facts.length, 1);
  assert.equal(linesOf(task.id).find((l) => l.body.startsWith('⚠️')).meta.quiet, true);
});

test('tarea de un chat silenciado: no hay aviso nuevo; con el silencio caducado, sí', async () => {
  const { facts, sched } = runner();
  const c = board.createConversation({ title: 'Mudo' }).id;
  setMark(board, 'conversation', c, { muted: true });
  const p = repo(); const task = folderTask(sched, p, { conversation_id: c });
  del(p, 12);
  await finish(sched, task.id);
  assert.deepEqual(facts, []);
  setMark(board, 'conversation', c, { muted: true, mutedUntil: new Date(Date.now() - 60_000).toISOString() });
  const p2 = repo(); const again = folderTask(sched, p2, { conversation_id: c });
  del(p2, 12);
  await finish(sched, again.id);
  assert.equal(facts.length, 1); assert.equal(facts[0].task, again.id);
});

test('revisión correcta: un solo «terminada y revisada»; con fallos no hay aviso y la línea de fin avisa como siempre', async () => {
  const { facts, sched } = runner(); const p = repo(3);
  const doneTask = (title, extra = {}) => { const x = board.createTask({ project: p.name, title, description: 'x', agent: 'claude', ...extra }, 'usuario'); board.patch(x.id, { status: 'done' }, 'orb', 'task.finished'); return x; };
  const review = (of, verdict) => { const r = folderTask(sched, p, { review_of: of.id, readonly: true }); board.patch(r.id, { result: `VEREDICTO: ${verdict}` }, 'orb', 'task.result'); return r; };
  const bad = doneTask('Mal'); const badReview = review(bad, 'CON FALLOS');
  await finish(sched, badReview.id);
  assert.deepEqual(facts, [], 'con fallos: sin aviso de terminada');
  const badEnd = linesOf(badReview.id).find((l) => l.meta.kind === 'task-end');
  assert.equal(badEnd.meta.quiet, undefined); assert.ok(phoneNote(badEnd), 'la línea del resultado avisa como siempre');
  const good = doneTask('Bien'); const goodReview = review(good, 'CORRECTO');
  await finish(sched, goodReview.id);
  assert.deepEqual(facts, [{ kind: 'done', task: good.id }]);
  const goodEnd = linesOf(goodReview.id).find((l) => l.meta.kind === 'task-end');
  assert.equal(goodEnd.meta.quiet, true); assert.equal(phoneNote(goodEnd), null); assert.ok(phoneNote(withoutQuiet(goodEnd)));
  assert.equal(linesOf(good.id).filter((l) => l.meta.quiet).length, 0, 'la línea de cuando acabó la tarea es otro momento');
  // a schedule told not to notify: the correct review says nothing new either
  const quiet = doneTask('Callada', { schedule_id: scheduleOf(p, false) });
  const quietReview = review(quiet, 'CORRECTO');
  await finish(sched, quietReview.id);
  assert.equal(facts.length, 1, 'sin aviso nuevo');
  assert.equal(linesOf(quietReview.id).find((l) => l.meta.kind === 'task-end').meta.quiet, undefined, 'su línea de fin queda como antes');
});

test('el motor: la vigilancia de límites sigue el ritmo de 5 s y los hechos llegan al aviso', () => {
  const engine = fs.readFileSync(new URL('../src/engine/engine.mjs', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
  const slow = engine.slice(engine.indexOf('if (Date.now() - lastSync > 5000) {'), engine.indexOf('const v = board.one'));
  assert.ok(slow.includes('limitWatch.tick()'), 'dentro de la rama lenta');
  assert.equal(engine.split('limitWatch.tick()').length - 1, 1);
  assert.ok(engine.includes('announce: (fact) => remote?.announce(fact)'));
});
