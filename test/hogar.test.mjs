// 3.7 (Orb Server, WS3): one home per bot and a live copy on the other linked Orbs. Engines on loopback with the fake
// agents: «srv» plays the Orb Server (role centro), «pc» the owner's PC, «pc2» another PC and «srv2» a new server.
// - the 3.6 database migrates (uids, this Orb as home, the change log);
// - a bot made on the PC has its copy on the Server (memory, reminders, chat), read-only there;
// - «Pasar al Server»: the move with its checks; the copy forwards writes to the home; a reminder rings once;
// - a move during a running turn waits, cuts it and the message sent meanwhile is answered on the new home;
// - same name on both: kept both, then merged;
// - Server off: forced takeover on the PC; the Server comes back, steps down, what it did is added (marked), its memory
//   change waits as a proposal and the reminder it rang is told;
// - unlinking: cancel, bring all back, leave them (frozen copies) and restore one on a new Server.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import { tempHome, startEngine, until as untilShort, wait, ROOT } from './helpers.mjs';
import { paths } from '../src/core/home.mjs';
import { orbIdOf } from '../src/core/backup.mjs';

const { DatabaseSync } = process.getBuiltinModule('node:sqlite');
// 3.7: up to five engines talk over loopback here; with the whole suite running (a loaded PC) a step may take far longer
// than alone. Every wait gets at least 45 s: the checks are the same, only the patience grows (it returns as soon as true).
const until = (fn, what, ms) => untilShort(fn, what, Math.max(ms ?? 0, 45_000));
// A port nobody listens on (a fixed «+1» could be taken).
const freePort = () => new Promise((resolve, reject) => { const s = net.createServer(); s.once('error', reject); s.listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => resolve(port)); }); });
const env = { ORB_REMOTE_BIND: '127.0.0.1', ORB_WOL_DRY: '1', ORB_REPLICA_MS: '400', ORB_MOVE_TURN_MS: '1500', ORB_FORWARD_MS: '8000' };
const tmp = []; const engines = new Map();
const db = (home, fn) => { const d = new DatabaseSync(paths(home).db); d.exec('PRAGMA busy_timeout = 8000'); try { return fn(d); } finally { d.close(); } };
const rows = (home, sql, ...args) => db(home, (d) => d.prepare(sql).all(...args));
const one = (home, sql, ...args) => rows(home, sql, ...args)[0];
let srv; let pc; let tSrv; let tPc; let portSrv;
const key = (t) => orbIdOf(t.home).orbId;
async function engine(name, t) { const e = await startEngine(t.home, { env }); engines.set(name, e); return e; }
async function link(from, to, port) {
  const q = await to.call('link.qr', { device: 'orb' });
  const peer = await from.call('link.connect', { code: q.code, address: `127.0.0.1:${port}` });
  return peer;
}
const homeOf = async (e, name) => (await e.call('bots.list')).bots.find((b) => b.name === name);
const byUid = async (e, uid) => (await e.call('bots.list')).bots.find((b) => b.uid === uid);
const linesOf = (t, uid) => rows(t.home, 'SELECT c.uid, c.role, c.body, c.meta FROM chat c JOIN conversations v ON v.id = c.conversation_id JOIN bots b ON b.id = v.bot_id WHERE b.uid = ? ORDER BY c.id', uid);
const homesReady = (e, k) => until(async () => (await e.call('bots.homes')).some((h) => h.key === k && h.online), 'el otro Orb se ve', 20000);

before(async () => {
  if (!fs.existsSync(path.join(ROOT, 'src', 'renderer', 'index.html'))) throw new Error('compila antes la interfaz (npm run build)');
  portSrv = await freePort();
  tSrv = tempHome({ role: 'centro', mobile: { enabled: true, port: portSrv, name: 'Servidor' } }); tmp.push(tSrv);
  tPc = tempHome({ mobile: { name: 'Portátil' } }); tmp.push(tPc);
  srv = await engine('srv', tSrv); pc = await engine('pc', tPc);
  await until(async () => (await srv.call('remote.status')).running, 'acceso del servidor');
  // Two bots of the same name before linking (a Server of 3.6 and a PC each had theirs).
  await srv.call('bots.create', { name: 'Notas', role_text: 'Notas del servidor', tools: ['recordatorios'] });
  const n = await pc.call('bots.create', { name: 'Notas', role_text: 'Notas del PC', tools: ['recordatorios'] });
  await pc.call('bots.memory.set', { id: n.id, text: 'Ana prefiere las listas cortas' });
  await link(pc, srv, portSrv);
  await homesReady(pc, key(tSrv)); await homesReady(srv, key(tPc));
});
after(async () => {
  for (const e of engines.values()) await e.stop();
  for (const t of tmp) t.cleanup();
});

test('migración de 3.6: cada bot recibe su uid, este Orb es su casa y su historia entra en el registro', async () => {
  const t = tempHome(); tmp.push(t);
  const { Board } = await import('../src/core/board.mjs');
  const B = await import('../src/core/bots.mjs');
  let board = new Board();
  const b = B.createBot(board, { name: 'Antiguo' });
  board.addChat('usuario', 'hola de 3.6', null, B.botConversation(board, b));
  B.createReminder(board, { bot_id: b.id, text: 'Regar', when: '2099-01-01T10:00' });
  board.db.close();
  // As a 3.6 database: no uid, no home, no change log, no triggers.
  db(t.home, (d) => {
    for (const r of d.prepare("SELECT name FROM sqlite_master WHERE type = 'trigger'").all()) d.exec(`DROP TRIGGER ${r.name}`);
    for (const i of ['bots_uid', 'bots_home', 'chat_uid', 'bot_reminders_uid', 'memory_log_uid', 'bot_requests_uid', 'bot_groups_uid']) d.exec(`DROP INDEX IF EXISTS ${i}`);
    for (const [tb, c] of [['bots', 'uid'], ['bots', 'home'], ['bots', 'home_epoch'], ['bots', 'home_state'], ['bots', 'home_fork'], ['bots', 'needs'], ['chat', 'uid'], ['bot_reminders', 'uid'], ['memory_log', 'uid'], ['bot_requests', 'uid'], ['bot_groups', 'uid'], ['bot_groups', 'home'], ['bot_groups', 'home_epoch']]) d.exec(`ALTER TABLE ${tb} DROP COLUMN ${c}`);
    d.exec("DROP TABLE bot_changes; DROP TABLE replica_cursor; DELETE FROM settings WHERE key IN ('home_migrated', 'orb_self')");
  });
  board = new Board();
  const row = board.one('SELECT * FROM bots WHERE id = ?', b.id);
  assert.match(row.uid, /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/, 'uid UUIDv7');
  assert.equal(row.home, orbIdOf(t.home).orbId, 'su casa es este Orb (su identidad, nunca «self»)');
  assert.equal(row.home_epoch, 0); assert.equal(row.home_state, 'active');
  assert.ok(board.one("SELECT uid FROM chat WHERE body = 'hola de 3.6'").uid, 'la línea tiene uid');
  assert.ok(board.one('SELECT uid FROM bot_reminders WHERE bot_id = ?', b.id).uid);
  const kinds = board.all('SELECT kind FROM bot_changes WHERE bot_uid = ?', row.uid).map((r) => r.kind);
  assert.ok(kinds.includes('chat') && kinds.includes('reminder'), 'la historia entra en el registro de cambios');
  const R = await import('../src/core/replica.mjs');
  assert.equal(R.isHomeHere(board, row), true);
  // A single Orb behaves as 3.6: the reminder is there to ring.
  board.run('UPDATE bot_reminders SET next_run = ? WHERE bot_id = ?', new Date(Date.now() - 1000).toISOString(), b.id);
  assert.equal(B.takeDueReminders(board).length, 1);
  board.db.close();
});

test('la copia: un bot del PC aparece en el Server con su memoria, recordatorios y chat, solo de lectura', async () => {
  const agenda = await pc.call('bots.create', { name: 'Agenda', role_text: 'Mis citas', tools: ['recordatorios'] });
  assert.equal(agenda.homeHere, true); assert.equal(agenda.homeKind, 'here');
  await pc.call('bots.memory.set', { id: agenda.id, text: 'Prefiere las citas por la tarde' });
  await pc.call('bots.reminders.create', { id: agenda.id, text: 'Cita con el dentista', when: '2099-05-04T10:00' });
  await pc.call('bots.send', { id: agenda.id, text: 'hola agenda' });
  await until(() => linesOf(tPc, agenda.uid).some((l) => l.role === 'bot'), 'responde en el PC');
  const copy = await until(async () => { const b = await byUid(srv, agenda.uid); return b && linesOf(tSrv, agenda.uid).length >= 2 && b; }, 'la copia en el Server', 20000);
  assert.equal(copy.homeHere, false); assert.equal(copy.readOnly, true); assert.equal(copy.homeName, 'Portátil');
  assert.match((await srv.call('bots.memory.get', { id: copy.id })).text, /por la tarde/);
  const rem = await until(async () => (await srv.call('bots.reminders.list', { id: copy.id }))[0], 'su recordatorio');
  assert.equal(rem.executor, false, 'en la copia no suena');
  assert.equal((await pc.call('bots.reminders.list', { id: agenda.id }))[0].executor, true);
  assert.deepEqual(linesOf(tSrv, agenda.uid).map((l) => l.uid), linesOf(tPc, agenda.uid).map((l) => l.uid), 'las mismas líneas, por uid');
  // Never replicated: its live session with the agent.
  assert.equal(one(tSrv.home, 'SELECT COUNT(*) AS n FROM bot_sessions WHERE bot_id = ?', copy.id).n, 0);
});

test('«Pasar al Server»: se copia, se comprueba y cambia de casa; la copia del PC manda lo que escribes allí', async () => {
  const agenda = await homeOf(pc, 'Agenda');
  const r = await pc.call('bots.move', { id: agenda.id, to: key(tSrv) });
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(r.epoch, 1);
  await until(async () => (await byUid(srv, agenda.uid))?.homeHere, 'ahora se ejecuta en el Server');
  const here = await byUid(pc, agenda.uid);
  assert.equal(here.homeHere, false); assert.equal(here.readOnly, true); assert.equal(here.homeKind, 'server');
  assert.equal((await pc.call('bots.reminders.list', { id: here.id }))[0].executor, false, 'el PC ya no lo hace sonar');
  // A message written on the PC goes to the Server (the same line, by uid), the answer comes back.
  const sent = await pc.call('bots.send', { id: here.id, text: 'mensaje desde el PC' });
  assert.equal(sent.forwarded, true);
  const answered = (t) => { const l = linesOf(t, agenda.uid); const i = l.findIndex((x) => x.body === 'mensaje desde el PC'); return i >= 0 && l.slice(i + 1).some((x) => x.role === 'bot'); };
  await until(() => answered(tSrv), 'el Server contesta', 20000);
  await until(() => answered(tPc), 'la respuesta llega al PC', 20000);
  // Its first turn on the new home started with the handoff note (a new live session).
  assert.ok(linesOf(tSrv, agenda.uid).some((l) => l.role === 'bot' && /te han pasado de/.test(l.body)), 'empezó con la nota de traspaso');
  const users = linesOf(tPc, agenda.uid).filter((l) => l.body === 'mensaje desde el PC');
  assert.equal(users.length, 1, 'una sola vez en el PC');
  await until(() => !JSON.parse(linesOf(tPc, agenda.uid).find((l) => l.body === 'mensaje desde el PC').meta ?? 'null')?.pending, 'ya no está pendiente');
  // A change on the copy goes to its home.
  await pc.call('bots.update', { id: here.id, role_text: 'Mis citas y las de casa' });
  await until(async () => (await byUid(srv, agenda.uid)).role_text === 'Mis citas y las de casa', 'cambiado en el Server');
  // The journal says done.
  const moves = (await pc.call('replica.status')).moves;
  assert.ok(moves.some((m) => m.bot_uid === agenda.uid && m.phase === 'done'));
});

test('un recordatorio suena una sola vez con los dos encendidos', async () => {
  const agenda = await homeOf(srv, 'Agenda');
  const rem = (await srv.call('bots.reminders.create', { id: agenda.id, text: 'Tomar agua', when: '2099-06-01T09:00' }));
  db(tSrv.home, (d) => d.prepare('UPDATE bot_reminders SET next_run = ? WHERE id = ?').run(new Date(Date.now() + 1500).toISOString(), rem.id));
  const rang = (t) => linesOf(t, agenda.uid).filter((l) => /Tomar agua/.test(l.body)).length;
  await until(() => rang(tSrv) === 1 && rang(tPc) === 1, 'suena en el Server y su línea llega al PC', 20000);
  await wait(3000);
  assert.equal(rang(tSrv), 1); assert.equal(rang(tPc), 1, 'el PC no lo hace sonar otra vez');
});

test('pasar un bot mientras contesta: espera, corta y lo que escribes mientras se contesta en la casa nueva', async () => {
  const b = await pc.call('bots.create', { name: 'Lento', tools: [] });
  await pc.call('bots.send', { id: b.id, text: 'piensa mucho DUERME' });
  await until(async () => (await pc.call('bots.list')).states.some((s) => s.bot === b.id && s.busy), 'está contestando');
  const moving = pc.call('bots.move', { id: b.id, to: key(tSrv) });
  await until(async () => (await byUid(pc, b.uid))?.homeState === 'moving', 'en traslado');
  await pc.call('bots.send', { id: b.id, text: 'mientras se pasa' });
  const r = await moving;
  assert.equal(r.ok, true, JSON.stringify(r)); assert.equal(r.cut, true, 'cortó el turno en curso'); assert.equal(r.held, 1, 'guardó el mensaje');
  assert.ok(linesOf(tPc, b.uid).some((l) => /Se ha cortado la respuesta/.test(l.body)));
  await until(() => { const l = linesOf(tSrv, b.uid); const i = l.findIndex((x) => x.body === 'mientras se pasa'); return i >= 0 && l.slice(i + 1).some((x) => x.role === 'bot'); }, 'contesta en el Server', 20000);
  assert.equal(linesOf(tSrv, b.uid).filter((l) => l.body === 'mientras se pasa').length, 1, 'una sola vez');
});

test('mismo nombre en los dos: se quedan los dos, se avisa y se pueden unir', async () => {
  const mine = (await pc.call('bots.list')).bots.find((b) => b.name === 'Notas' && b.homeHere);
  const r = await pc.call('bots.move', { id: mine.id, to: key(tSrv) });
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.ok(r.sameName, 'avisa de que allí hay otro con ese nombre');
  const there = (await srv.call('bots.list')).bots.filter((b) => /^Notas/.test(b.name) && b.homeHere);
  assert.equal(there.length, 2, 'los dos en el Server');
  const moved = there.find((b) => b.uid === mine.uid); const own = there.find((b) => b.uid !== mine.uid);
  const m = await srv.call('bots.merge', { survivor: own.id, other: moved.id });
  assert.equal(m.ok, true); assert.ok(m.proposals >= 1, 'su memoria espera como propuesta');
  const pend = await srv.call('bots.memory.pending');
  assert.ok(pend.some((p) => /listas cortas/.test(p.text)));
  const arch = await byUid(srv, mine.uid);
  assert.equal(arch.homeState, 'archived'); assert.equal(arch.paused, true);
});

test('Server apagado: se toma el control en el PC; al volver, se aparta y lo suyo se añade sin pisar nada', async () => {
  const b = await pc.call('bots.create', { name: 'Casa', tools: ['recordatorios'] });
  await pc.call('bots.reminders.create', { id: b.id, text: 'Sacar la basura', when: '2099-07-01T21:00' });
  assert.equal((await pc.call('bots.move', { id: b.id, to: key(tSrv) })).ok, true);
  await until(async () => (await byUid(srv, b.uid))?.homeHere, 'en el Server');
  await until(async () => linesOf(tPc, b.uid).length === linesOf(tSrv, b.uid).length, 'la copia al día');
  const srvBot = one(tSrv.home, 'SELECT id FROM bots WHERE uid = ?', b.uid).id;
  await engines.get('srv').stop(); engines.delete('srv');
  try {
  await until(async () => !(await pc.call('bots.homes')).find((h) => h.key === key(tSrv))?.online, 'el PC ve el Server apagado');
  const ask = await pc.call('bots.move', { id: b.id, to: 'here' });
  assert.equal(ask.step, 'confirm'); assert.match(ask.confirm, /sigue encendido/);
  const taken = await pc.call('bots.move', { id: b.id, to: 'here', force: true });
  assert.equal(taken.ok, true); assert.equal(taken.forced, true); assert.equal(taken.epoch, 2);
  assert.equal((await byUid(pc, b.uid)).homeHere, true);
  const before = linesOf(tPc, b.uid).length;
  await pc.call('bots.send', { id: b.id, text: 'ahora en el PC' });
  await until(() => linesOf(tPc, b.uid).slice(before).some((l) => l.role === 'bot'), 'contesta en el PC');
  // Meanwhile the Server «went on» on its own (as if it had been cut off, not off): a line, a reminder rang, a memory.
  db(tSrv.home, (d) => {
    const conv = d.prepare('SELECT id FROM conversations WHERE bot_id = ? ORDER BY id LIMIT 1').get(srvBot).id;
    d.prepare("INSERT INTO chat (role, body, at, conversation_id) VALUES ('bot', 'hecho en el Server a solas', ?, ?)").run(new Date().toISOString(), conv);
    d.prepare('UPDATE bot_reminders SET last_run = ? WHERE bot_id = ?').run(new Date().toISOString(), srvBot);
    d.prepare("INSERT INTO memory_log (at, scope, actor, op, status, text) VALUES (?, ?, 'bot', 'append', 'applied', 'el contenedor web se reinicia los lunes')").run(new Date().toISOString(), `bot:${srvBot}`);
  });
  fs.writeFileSync(path.join(paths(tSrv.home).bots, String(srvBot), 'memoria.md'), 'el contenedor web se reinicia los lunes\n');
  } finally { srv = await engine('srv', tSrv); }
  await until(async () => {
    const s = one(tSrv.home, 'SELECT home, home_epoch FROM bots WHERE uid = ?', b.uid);
    return s.home === key(tPc) && s.home_epoch === 2;
  }, 'el Server se aparta', 30000);
  const line = await until(() => linesOf(tPc, b.uid).find((l) => l.body === 'hecho en el Server a solas'), 'su línea llega al PC', 20000);
  assert.equal(JSON.parse(line.meta).offline, 'Servidor', 'marcada como de mientras estaba desconectado');
  assert.ok(linesOf(tPc, b.uid).some((l) => /sonó en Servidor mientras estaba desconectado/.test(l.body)), 'el recordatorio que sonó allí');
  const pend = await pc.call('bots.memory.pending');
  assert.ok(pend.some((p) => /contenedor web/.test(p.text)), 'su memoria, como propuesta');
  assert.doesNotMatch((await pc.call('bots.memory.get', { id: b.id })).text, /contenedor web/, 'sin pisar la de aquí');
  // Exactly one runs it.
  assert.equal(one(tPc.home, 'SELECT home FROM bots WHERE uid = ?', b.uid).home, key(tPc));
  await homesReady(pc, key(tSrv)); await homesReady(srv, key(tPc));
});

test('desenlazar: cancelar no hace nada; traer todos los devuelve al PC antes de cortar', async () => {
  const t2 = tempHome({ mobile: { name: 'Portátil 2' } }); tmp.push(t2);
  const pc2 = await engine('pc2', t2);
  const peer = await link(pc2, srv, portSrv);
  await homesReady(pc2, key(tSrv)); await homesReady(srv, key(t2));
  const v = await pc2.call('bots.create', { name: 'Viajes', tools: [] });
  assert.equal((await pc2.call('bots.move', { id: v.id, to: key(tSrv) })).ok, true);
  assert.deepEqual(await pc2.call('bots.unlink', { peer: peer.id, mode: 'cancel' }), { ok: true, cancelled: true });
  assert.equal((await pc2.call('link.peers')).length, 1, 'sigue enlazado');
  const r = await pc2.call('bots.unlink', { peer: peer.id, mode: 'bring' });
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal((await byUid(pc2, v.uid)).homeHere, true, 'Viajes vuelve al PC');
  assert.equal((await pc2.call('link.peers')).length, 0, 'y el enlace se cierra');
  await until(() => one(tSrv.home, 'SELECT home_state FROM bots WHERE uid = ?', v.uid)?.home_state === 'archived', 'en el Server queda como copia congelada');
});

test('desenlazar dejándolos en el Server; restaurar una copia en un Server nuevo', async () => {
  const agenda = await homeOf(pc, 'Agenda');
  assert.equal(agenda.homeHere, false);
  // The PC's copy up to date with its home first (under load the last pull may still be on its way).
  await until(async () => (await pc.call('replica.sync').catch(() => null), linesOf(tPc, agenda.uid).length === linesOf(tSrv, agenda.uid).length), 'la copia del PC al día');
  const peer = (await pc.call('link.peers')).find((p) => p.orb === key(tSrv));
  const r = await pc.call('bots.unlink', { peer: peer.id, mode: 'leave' });
  assert.equal(r.ok, true); assert.ok(r.archived >= 1);
  const frozen = await byUid(pc, agenda.uid);
  assert.equal(frozen.homeState, 'archived'); assert.equal(frozen.homeKnown, false);
  assert.ok(linesOf(tPc, agenda.uid).length > 2, 'su historia sigue aquí');
  // A new Server: the copy goes there and runs there.
  const port2 = await freePort();
  const t3 = tempHome({ role: 'centro', mobile: { enabled: true, port: port2, name: 'Servidor nuevo' } }); tmp.push(t3);
  const srv2 = await engine('srv2', t3);
  await until(async () => (await srv2.call('remote.status')).running, 'acceso del servidor nuevo');
  await link(pc, srv2, port2);
  await homesReady(pc, key(t3)); await homesReady(srv2, key(tPc));
  const res = await pc.call('bots.restore', { id: frozen.id, to: key(t3) });
  assert.equal(res.ok, true, JSON.stringify(res)); assert.equal(res.restored, true);
  await until(async () => (await byUid(srv2, agenda.uid))?.homeHere, 'se ejecuta en el Server nuevo');
  assert.ok(linesOf(t3, agenda.uid).length >= linesOf(tPc, agenda.uid).length - 1, 'con su historia');
  assert.match((await srv2.call('bots.memory.get', { id: (await byUid(srv2, agenda.uid)).id })).text, /por la tarde/);
});
