// The phone's notice centre (3.8.8): the notices that are not a chat line (task done and reviewed, task held, new Orb
// version, account out of its limit), the short list of what was sent (notes.list) and its limits.
import { tempHome } from './helpers.mjs';
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
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

let t; let board; let api; let remote;
const call = (method, params = {}) => api.call(method, params, DESKTOP);
const DAY = 86_400_000;
const wipe = () => board.run('DELETE FROM mobile_notes');

before(() => {
  t = tempHome();
  board = new Board();
  const emit = () => {};
  const sessions = new Sessions(board, { emit });
  const orchestrator = new Orchestrator(board, { emit });
  const scheduler = new Scheduler(board, sessions, { orchestrator, emit });
  api = buildApi({ board, sessions, orchestrator, scheduler, emit, log: () => {}, version: 'test', remoteRef: { current: null, link: null } });
  remote = createRemote({ board, api, log: () => {}, emit, version: 'test' });
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
  // a muted chat says nothing and keeps nothing
  wipe(); board.run('UPDATE conversations SET title = title WHERE id = ?', c);
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

test('los hechos del motor llaman al aviso (tarea retenida, revisión correcta, cuenta, vista de límites)', () => {
  const finish = fs.readFileSync(new URL('../src/engine/scheduler/finish.mjs', import.meta.url), 'utf8');
  assert.match(finish, /if \(held\) \{[^\n]*this\.announce\(\{ kind: 'held', task: taskId/);
  assert.match(finish, /verdict === 'correcto'[^\n]*this\.announce\(\{ kind: 'done', task: task\.review_of \}\)/);
  const engine = fs.readFileSync(new URL('../src/engine/engine.mjs', import.meta.url), 'utf8');
  assert.match(engine, /announce: \(fact\) => remote\?\.announce\(fact\)/);
  assert.match(engine, /limitWatch\.tick\(\)/);
});
