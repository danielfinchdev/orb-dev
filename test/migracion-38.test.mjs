// 3.8: a data folder of 3.5–3.7 opened by Orb 3.8 is moved once (src/core/migrate-38.mjs): a copy of the database and a
// readable archive first, then the bots, replicas, links, other users and their settings go; the owner's data stay and
// become plain single-owner rows. Run twice, it does nothing more; a new 3.8 database is left alone. The phone access
// never serves another user's device (also before the migration) and never opens on a database it could not migrate.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { tempHome, ROOT, startEngine, until } from './helpers.mjs';
import { useHome, ctx } from '../src/core/context.mjs';
import { writeJson } from '../src/core/home.mjs';
import { openDb } from '../src/core/db.mjs';
import { Board } from '../src/core/board.mjs';
import { marks } from '../src/core/inbox.mjs';
import { ARCHIVE_DIR, PRE_COPY, MARK, DROPPED_TABLES, takeNotice } from '../src/core/migrate-38.mjs';
import * as C from '../src/core/mobile-crypto.mjs';
import { newVapidKeys } from '../src/engine/webpush.mjs';
import { createBackup, restoreInto } from '../src/core/backup.mjs';
import { createRemote } from '../src/engine/remote.mjs';

const { DatabaseSync } = process.getBuiltinModule('node:sqlite');
const homes = [];
after(() => { for (const h of homes) h.cleanup(); });
const schema = (v) => fs.readFileSync(path.join(ROOT, 'test', 'fixtures', `esquema-${v}.sql`), 'utf8');
const NOW = '2026-10-01T10:00:00.000Z';
const OWNER = 'p-dani'; const ANA = 'p-ana';

// A realistic 3.7 database: an owner (Dani) and a second user (Ana), bots, a group, reminders, replicas, the links' queue,
// devices of every kind, a loan, shares, chat-list marks; written by 3.7's own schema, triggers on.
function build37(file, pc) {
  const db = new DatabaseSync(file);
  db.exec(schema('3.7'));
  const run = (sql, ...a) => db.prepare(sql).run(...a);
  const set = (k, v) => run('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)', k, typeof v === 'string' ? v : JSON.stringify(v));
  for (const k of ['conversations_migrated', 'persons_migrated', 'home_migrated', 'notices_migrated']) set(k, '1');
  set('orb_self', 'a'.repeat(32)); set('bots_seeded', '1'); set('net_names', '{}'); set('connections.adb', '{"x":1}'); set('handback_pending', '[]'); set('hub_handoffs', '{}');
  set('bot_taint:1', '1'); set('ha_allow:light.salon', '1'); set('browser_pace:example.com', '{}'); set('secret:ha_token', 'abc'); set('agent_id:ffff', { agent: 'bot:1', person: OWNER });
  set('remote_keys', { priv: C.b64.enc(pc.priv), vapid: newVapidKeys() });
  run("INSERT INTO persons (id, name, role, language, tz, pin_hash, created_at) VALUES (?, 'Dani', 'owner', 'es', 'Europe/Madrid', 'pin', ?)", OWNER, NOW);
  run("INSERT INTO persons (id, name, role, language, tz, created_at) VALUES (?, 'Ana', 'user', 'es', 'America/Bogota', ?)", ANA, NOW);
  const ps = (pid, k, v) => run('INSERT INTO person_settings (person_id, key, value) VALUES (?, ?, ?)', pid, k, JSON.stringify(v));
  ps(OWNER, 'brain', { agent: 'claude', model: 'claude-opus-5-5', account: 'claude', reasoning: 'high', orchestrate: false });
  ps(OWNER, 'preview', 'none'); ps(OWNER, 'active_project', 'web-dani'); ps(OWNER, 'rules', ['Regla del dueño']); ps(OWNER, 'bots.location', 'local');
  ps(ANA, 'brain', { agent: 'codex' }); ps(ANA, 'preview', 'all');
  // Projects, conversations, chat, tasks, sessions, schedules of both.
  run("INSERT INTO projects (name, path, created_at, person_id) VALUES ('web-dani', 'C:/x/web-dani', ?, ?), ('web-ana', 'C:/x/web-ana', ?, ?)", NOW, OWNER, NOW, ANA);
  const conv = (title, pid, extra = {}) => Number(run('INSERT INTO conversations (title, titled, created_at, updated_at, person_id, bot_id, group_id) VALUES (?, 1, ?, ?, ?, ?, ?)', title, NOW, NOW, pid, extra.bot ?? null, extra.group ?? null).lastInsertRowid);
  const line = (c, role, body, pid) => run('INSERT INTO chat (role, body, at, conversation_id, person_id) VALUES (?, ?, ?, ?, ?)', role, body, NOW, c, pid);
  const ids = {};
  ids.cDani = conv('Plan de Dani', OWNER); line(ids.cDani, 'usuario', 'hola Orb', OWNER); line(ids.cDani, 'orb', 'hola Dani', OWNER);
  ids.cAna = conv('Secreto de Ana', ANA); line(ids.cAna, 'usuario', 'mi secreto', ANA);
  run("INSERT INTO bots (name, created_at, updated_at, person_id) VALUES ('Casa', ?, ?, ?), ('Bot de Ana', ?, ?, ?)", NOW, NOW, OWNER, NOW, NOW, ANA);
  run("INSERT INTO bot_groups (name, created_at, updated_at, person_id) VALUES ('Familia', ?, ?, ?)", NOW, NOW, OWNER);
  run('INSERT INTO bot_group_members (group_id, bot_id) VALUES (1, 1), (1, 2)');
  ids.cBot = conv('Casa', OWNER, { bot: 1 }); line(ids.cBot, 'usuario', 'enciende la luz', OWNER); line(ids.cBot, 'orb', 'hecho', OWNER);
  ids.cGroup = conv('Familia', OWNER, { group: 1 }); line(ids.cGroup, 'usuario', 'hola familia', ANA);
  set(`pending_questions:${ids.cBot}`, '[{"q":"¿Seguro?"}]');
  run("INSERT INTO bot_reminders (bot_id, text, start_at, created_at, person_id) VALUES (1, 'Sacar la basura', ?, ?, ?)", NOW, NOW, OWNER);
  run("INSERT INTO bot_requests (bot_id, kind, created_at, updated_at, person_id) VALUES (1, 'ha', ?, ?, ?)", NOW, NOW, OWNER);
  run("INSERT INTO memory_log (at, person_id, scope, actor, op, status, text) VALUES (?, ?, 'bot:1', 'bot', 'add', 'applied', 'le gusta el té')", NOW, OWNER);
  run("INSERT INTO bot_sessions (bot_id, person_id, session_id, turns) VALUES (1, ?, 'cli-1', 3)", OWNER);
  const task = (title, project, pid, c) => Number(run("INSERT INTO tasks (project, title, description, status, created_by, created_at, updated_at, person_id, conversation_id) VALUES (?, ?, 'd', 'done', 'orb', ?, ?, ?, ?)", project, title, NOW, NOW, pid, c).lastInsertRowid);
  ids.tDani = task('Tarea de Dani', 'web-dani', OWNER, ids.cDani); ids.tAna = task('Tarea de Ana', 'web-ana', ANA, ids.cAna);
  for (const [t, pid] of [[ids.tDani, OWNER], [ids.tAna, ANA]]) {
    run("INSERT INTO messages (from_agent, to_agent, task_id, body, at, person_id) VALUES ('claude', 'orb', ?, 'listo', ?, ?)", t, NOW, pid);
    run("INSERT INTO events (task_id, actor, kind, at, person_id) VALUES (?, 'orb', 'task.created', ?, ?)", t, NOW, pid);
  }
  for (const [id, pid] of [['s-dani', OWNER], ['s-ana', ANA]]) {
    run("INSERT INTO sessions (id, kind, agent, cwd, title, created_at, updated_at, person_id) VALUES (?, 'chat', 'claude', 'C:/x', ?, ?, ?, ?)", id, `Sesión ${id}`, NOW, NOW, pid);
    run("INSERT INTO session_items (session_id, role, kind, body, at) VALUES (?, 'user', 'text', 'hola', ?)", id, NOW);
  }
  run("INSERT INTO schedules (project, title, description, every, created_at, person_id) VALUES ('web-dani', 'Revisar', 'd', 'daily', ?, ?), ('web-ana', 'De Ana', 'd', 'daily', ?, ?)", NOW, OWNER, NOW, ANA);
  // Devices: the owner's phone (with its key: it must keep working), Ana's phone, a linked Orb and an Orb Terminal.
  const phones = { dani: C.newKeyPair(), ana: C.newKeyPair() };
  ids.dDani = crypto.randomUUID(); ids.dAna = crypto.randomUUID();
  const dev = (id, name, kind, pid, kp) => run("INSERT INTO devices (id, name, token_hash, created_at, last_seen, public_key, kind, meta, kind_ok, person_id, push) VALUES (?, ?, ?, ?, ?, ?, ?, '{\"v\":3}', 1, ?, NULL)", id, name, `clave:${id}`, new Date().toISOString(), new Date().toISOString(), kp ? C.b64.enc(kp.pub) : 'x', kind, pid);
  dev(ids.dDani, 'Móvil de Dani', 'phone', OWNER, phones.dani); dev(ids.dAna, 'Móvil de Ana', 'phone', ANA, phones.ana);
  dev(crypto.randomUUID(), 'Orb del taller', 'orb', OWNER); dev(crypto.randomUUID(), 'Terminal', 'terminal', OWNER);
  run("INSERT INTO link_queue (method, created_at, person_id, request_id) VALUES ('chat.send', ?, ?, 'r1')", NOW, OWNER);
  run("INSERT INTO link_seen (request_id, peer, at) VALUES ('r0', 'peer', ?)", NOW);
  run("INSERT INTO link_persons (peer, local_person, remote_person) VALUES ('peer', ?, 'x')", OWNER);
  run("INSERT INTO account_loans (account_id, lender, person_id, created_at) VALUES ('claude', ?, ?, ?)", OWNER, ANA, NOW);
  run("INSERT INTO shares (resource_type, resource_id, person_id, right, created_at) VALUES ('bot', '1', ?, 'talk', ?), ('project', 'web-dani', ?, 'view', ?)", ANA, NOW, ANA, NOW);
  run("INSERT INTO audit (at, person_id, method, decision) VALUES (?, ?, 'bots.list', 'deny')", NOW, ANA);
  run("INSERT INTO usage_ledger (at, day, person_id, account_id, turns, usd) VALUES (?, '2026-10-01', ?, 'claude', 2, 0.5), (?, '2026-10-01', ?, 'claude', 1, 0.25)", NOW, OWNER, NOW, ANA);
  // Chat-list marks and the lists' settings of both.
  run("INSERT INTO inbox_sections (person_id, zone, name, created_at) VALUES (?, 'orb', 'Trabajo', ?), (?, 'bots', 'Casa', ?), (?, 'orb', 'De Ana', ?)", OWNER, NOW, OWNER, NOW, ANA, NOW);
  run("INSERT INTO inbox_items (person_id, kind, item_id, pinned, section_id, last_read) VALUES (?, 'conversation', ?, 1, 1, 2), (?, 'bot', '1', 1, 2, 0), (?, 'conversation', ?, 1, 3, 0)", OWNER, String(ids.cDani), OWNER, ANA, String(ids.cAna));
  set(`inbox_since:${OWNER}`, '1'); set(`inbox_since:${ANA}`, '1'); set(`sidebar_completed:${OWNER}`, '["s-dani"]'); set(`sidebar_kept:${ANA}`, '[]');
  db.close();
  return { ids, phones };
}

// orb.json of 3.7 (with what 3.8 no longer reads) and the folders of 3.7.
function files37(t) {
  const file = path.join(t.home, 'orb.json');
  const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
  raw.userName = '';
  raw.bots = { rules: ['Nada sin mi permiso'], location: 'local' }; raw.oce = { share: true }; raw.monitor = { enabled: true };
  raw.role = 'centro'; raw.devTarget = 'taller'; raw.ui = { ...raw.ui, mode: 'bots' }; raw.browser = { enabled: true, sites: { 'example.com': { perHour: 5 } } };
  raw.accounts = [...raw.accounts.map((a) => ({ ...a, person: OWNER })), { id: 'claude-ana', agent: 'claude', label: 'Claude de Ana', home: '', enabled: true, person: ANA }];
  raw.mcpServers = [{ name: 'de-ana', command: 'x', person: ANA }, { name: 'mio', command: 'y', person: OWNER }];
  writeJson(file, raw);
  const put = (p, text = 'x') => { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, text); };
  put(path.join(t.home, 'bots', 'personas', OWNER, 'memoria-global.md'), 'memoria del dueño');
  put(path.join(t.home, '.orb', 'bots-borrados', 'viejo', 'memoria.md'));
  put(path.join(t.home, '.orb', 'datos', 'enlaces.json'), '{"box":"sellado"}');
  put(path.join(t.home, '.orb', 'imagenes', ANA, 'a.png')); put(path.join(t.home, '.orb', 'imagenes', OWNER, 'b.png'));
  put(path.join(t.home, '.orb', 'cuentas', ANA, 'claude-ana', 'credenciales.json'));
  put(path.join(t.home, 'bitacora', `general-${ANA}.md`), 'bitácora de Ana');
  const local = path.join(t.base, 'localappdata'); put(path.join(local, 'OrbPuente', 'orb.json'), '{}'); put(path.join(local, 'OrbPuente', 'oce.json'), '{}');
  process.env.ORB_BRIDGE_DIR = path.join(local, 'OrbPuente');
  return local;
}

const names = (board, type) => board.all('SELECT name FROM sqlite_master WHERE type = ?', type).map((r) => r.name);
const archived = (t, ...p) => path.join(t.home, '.orb', ARCHIVE_DIR, ...p);
const readJson = (f) => JSON.parse(fs.readFileSync(f, 'utf8'));

test('una base 3.7 de dos usuarios: copia y archivo primero, luego fuera bots, réplicas, enlaces y el otro usuario', () => {
  const t = tempHome(); homes.push(t);
  const { ids } = build37(path.join(t.home, '.orb', 'datos', 'orb.db'), C.newKeyPair());
  const local = files37(t);
  useHome(t.home);
  let board = new Board();
  // The copy and the archive.
  assert.ok(fs.existsSync(path.join(t.home, '.orb', 'datos', PRE_COPY)), 'copia de la base de antes');
  const old = new DatabaseSync(path.join(t.home, '.orb', 'datos', PRE_COPY), { readOnly: true });
  assert.equal(old.prepare('SELECT COUNT(*) AS n FROM bots').get().n, 2, 'la copia tiene la base tal cual');
  old.close();
  assert.ok(fs.existsSync(archived(t, 'LEEME.txt')));
  assert.deepEqual(readJson(archived(t, 'bots', 'bots.json')).map((b) => b.name), ['Casa', 'Bot de Ana']);
  assert.equal(readJson(archived(t, 'bots', 'grupos.json'))[0].members.length, 2);
  assert.equal(readJson(archived(t, 'bots', 'recordatorios.json'))[0].text, 'Sacar la basura');
  assert.equal(readJson(archived(t, 'bots', 'memorias-historial.json')).length, 1);
  assert.deepEqual(readJson(archived(t, 'bots', 'conversaciones', `${ids.cBot}.json`)).chat.map((l) => l.body), ['enciende la luz', 'hecho']);
  assert.equal(fs.readFileSync(archived(t, 'bots', 'carpeta', 'personas', OWNER, 'memoria-global.md'), 'utf8'), 'memoria del dueño');
  assert.ok(fs.existsSync(archived(t, 'bots', 'borrados', 'viejo', 'memoria.md')));
  assert.ok(!fs.existsSync(path.join(t.home, 'bots')) && !fs.existsSync(path.join(t.home, '.orb', 'bots-borrados')));
  assert.ok(fs.existsSync(archived(t, 'enlaces.json')) && !fs.existsSync(path.join(t.home, '.orb', 'datos', 'enlaces.json')));
  assert.ok(fs.existsSync(archived(t, 'orb-puente.json')) && !fs.existsSync(path.join(local, 'OrbPuente', 'orb.json')));
  assert.ok(fs.existsSync(path.join(local, 'OrbPuente', 'oce.json')), 'el oce.json de Open Control Edge no se toca');
  // Ana's export, then her data gone.
  const ana = archived(t, 'usuarios', `Ana-${ANA}`);
  assert.equal(readJson(path.join(ana, 'usuario.json')).name, 'Ana');
  assert.equal(readJson(path.join(ana, 'usuario.json')).pin_hash, undefined);
  assert.deepEqual(readJson(path.join(ana, 'conversaciones', `${ids.cAna}.json`)).chat.map((l) => l.body), ['mi secreto']);
  assert.deepEqual(readJson(path.join(ana, 'tareas.json')).map((x) => x.title), ['Tarea de Ana']);
  assert.deepEqual(readJson(path.join(ana, 'proyectos.json')).map((x) => x.name), ['web-ana']);
  assert.deepEqual(readJson(path.join(ana, 'cuentas.json')).accounts.map((a) => a.id), ['claude-ana']);
  assert.equal(readJson(path.join(ana, 'ajustes.json')).preview, 'all');
  assert.ok(fs.existsSync(path.join(ana, 'imagenes', 'a.png')) && fs.existsSync(path.join(ana, 'cuentas', 'claude-ana', 'credenciales.json')) && fs.existsSync(path.join(ana, 'bitacora-general.md')));
  assert.equal(readJson(archived(t, 'tablas', 'prestamos.json')).length, 1);
  assert.equal(readJson(archived(t, 'orb-json-retirado.json')).role, 'centro');

  // The database: no table, index or trigger of 3.5–3.7.
  for (const gone of DROPPED_TABLES) assert.ok(!names(board, 'table').includes(gone), gone);
  assert.deepEqual(names(board, 'trigger'), []);
  for (const gone of ['chat_uid', 'conversations_bot', 'conversations_person', 'tasks_person', 'devices_person', 'link_queue_request', 'bots_person']) assert.ok(!names(board, 'index').includes(gone), gone);
  const devCols = board.all('PRAGMA table_info(devices)').map((c) => c.name);
  for (const gone of ['role', 'admin', 'kind_ok', 'approve', 'dev_ok']) assert.ok(!devCols.includes(gone), gone);
  // The owner's data, intact and without a person.
  assert.deepEqual(board.all('SELECT title FROM conversations ORDER BY id').map((r) => r.title), ['Plan de Dani']);
  assert.deepEqual(board.chat(ids.cDani).map((l) => l.body), ['hola Orb', 'hola Dani']);
  assert.deepEqual(board.all('SELECT title FROM tasks').map((r) => r.title), ['Tarea de Dani']);
  assert.deepEqual(board.all('SELECT name FROM projects').map((r) => r.name), ['web-dani']);
  assert.deepEqual(board.all('SELECT title FROM schedules').map((r) => r.title), ['Revisar']);
  assert.deepEqual(board.all('SELECT id FROM sessions').map((r) => r.id), ['s-dani']);
  assert.equal(board.one('SELECT COUNT(*) AS n FROM session_items').n, 1);
  assert.equal(board.one('SELECT COUNT(*) AS n FROM messages').n, 1);
  assert.deepEqual(board.all('SELECT name FROM devices').map((r) => r.name), ['Móvil de Dani'], 'sin el móvil de Ana, el Orb enlazado ni la terminal');
  for (const tb of ['conversations', 'chat', 'tasks', 'sessions', 'schedules', 'projects', 'events', 'devices', 'messages', 'usage_ledger']) assert.equal(board.one(`SELECT COUNT(*) AS n FROM ${tb} WHERE person_id IS NOT NULL`).n, 0, tb);
  assert.equal(board.one('SELECT SUM(usd) AS s FROM usage_ledger').s, 0.75, 'el gasto se queda en los totales');
  // Chat-list marks: the owner's under 'owner', without the bots' zone or Ana's.
  assert.deepEqual(board.all('SELECT person_id, kind, item_id, pinned FROM inbox_items').map((r) => ({ ...r })), [{ person_id: 'owner', kind: 'conversation', item_id: String(ids.cDani), pinned: 1 }]);
  assert.deepEqual(board.all('SELECT person_id, zone, name FROM inbox_sections').map((r) => ({ ...r })), [{ person_id: 'owner', zone: 'orb', name: 'Trabajo' }]);
  assert.equal(marks(board).get(`conversation:${ids.cDani}`).pinned, true, 'el dueño ve sus marcas');
  // Settings.
  assert.equal(board.setting('inbox_since:owner'), '1');
  assert.equal(board.setting('sidebar_completed'), '["s-dani"]');
  assert.equal(board.setting('active_project'), 'web-dani');
  for (const k of ['orb_self', 'bots_seeded', 'net_names', 'connections.adb', 'handback_pending', 'hub_handoffs', 'persons_migrated', 'home_migrated', 'bot_taint:1', 'ha_allow:light.salon', 'browser_pace:example.com', 'secret:ha_token', 'agent_id:ffff', `pending_questions:${ids.cBot}`, `inbox_since:${OWNER}`, `inbox_since:${ANA}`, `sidebar_kept:${ANA}`]) assert.equal(board.setting(k), undefined, k);
  assert.equal(board.setting(MARK), '1');
  // orb.json: the owner's settings in, what 3.8 has not out.
  const raw = readJson(path.join(t.home, 'orb.json'));
  for (const k of ['bots', 'oce', 'monitor', 'role', 'devTarget']) assert.equal(raw[k], undefined, k);
  assert.equal(raw.ui.mode, undefined); assert.equal(raw.browser.sites, undefined); assert.equal(raw.browser.enabled, true);
  assert.equal(raw.userName, 'Dani'); assert.equal(raw.tz, 'Europe/Madrid'); assert.equal(raw.mobile.preview, 'none');
  assert.equal(raw.orchestrator.model, 'claude-opus-5-5'); assert.equal(raw.orchestrator.reasoning, 'high'); assert.equal(raw.orchestrator.orchestrate, false);
  assert.ok(!raw.accounts.some((a) => a.id === 'claude-ana' || 'person' in a));
  assert.deepEqual(raw.mcpServers, [{ name: 'mio', command: 'y' }]);
  assert.equal(ctx.config.orchestrator.model, 'claude-opus-5-5', 'la configuración en memoria también');
  // The owner's images back where 3.8 keeps them.
  assert.ok(fs.existsSync(path.join(t.home, '.orb', 'imagenes', 'b.png')) && !fs.existsSync(path.join(t.home, '.orb', 'imagenes', ANA)));
  // Told once.
  const notice = takeNotice(board);
  assert.equal(notice.bots, 2); assert.deepEqual(notice.users, ['Ana']); assert.equal(notice.archive, archived(t));
  assert.equal(takeNotice(board), null);
  board.db.close();

  // Opened twice more: nothing runs again and everything keeps working.
  fs.writeFileSync(archived(t, 'LEEME.txt'), 'tocado');
  for (let i = 0; i < 2; i++) {
    board = new Board();
    assert.equal(fs.readFileSync(archived(t, 'LEEME.txt'), 'utf8'), 'tocado', 'la migración no vuelve a correr');
    const c = board.createConversation({ title: 'Nueva' });
    board.addChat('usuario', 'hola', null, c.id);
    assert.equal(board.chat(c.id).length, 1);
    assert.equal(takeNotice(board), null);
    board.db.close();
  }
});

test('una base nueva de 3.8 no se toca (ni copia ni archivo)', () => {
  const t = tempHome(); homes.push(t);
  const board = new Board();
  assert.equal(board.setting(MARK), '1');
  assert.ok(!fs.existsSync(path.join(t.home, '.orb', 'datos', PRE_COPY)));
  assert.ok(!fs.existsSync(archived(t)));
  assert.equal(takeNotice(board), null);
  board.db.close();
});

for (const v of ['3.6', '3.5.1']) {
  test(`una base ${v} salta a 3.8: las migraciones viejas primero, luego la de 3.8`, () => {
    const t = tempHome(); homes.push(t);
    const file = path.join(t.home, '.orb', 'datos', 'orb.db');
    const db = new DatabaseSync(file);
    db.exec(schema(v));
    db.exec("INSERT INTO settings (key, value) VALUES ('notices_migrated', '1')");
    db.prepare("INSERT INTO conversations (title, titled, created_at, updated_at) VALUES ('Mía', 1, ?, ?)").run(NOW, NOW);
    db.prepare("INSERT INTO chat (role, body, at, conversation_id) VALUES ('usuario', 'hola', ?, 1)").run(NOW);
    db.prepare("INSERT INTO bots (name, created_at, updated_at) VALUES ('Viejo', ?, ?)").run(NOW, NOW);
    db.prepare("INSERT INTO conversations (title, titled, created_at, updated_at, bot_id) VALUES ('Viejo', 1, ?, ?, 1)").run(NOW, NOW);
    db.prepare("INSERT INTO devices (id, name, token_hash, created_at, kind) VALUES ('o', 'Otro Orb', 'h', ?, 'orb'), ('p', 'Móvil', 'h2', ?, 'phone')").run(NOW, NOW);
    if (v === '3.6') {
      db.prepare("INSERT INTO persons (id, name, role, created_at) VALUES ('p1', 'Dani', 'owner', ?)").run(NOW);
      db.exec("INSERT INTO settings (key, value) VALUES ('persons_migrated', '1'); UPDATE conversations SET person_id = 'p1'; UPDATE devices SET person_id = 'p1'");
    }
    db.close();
    useHome(t.home);
    const board = new Board();
    assert.deepEqual(board.all('SELECT title FROM conversations').map((r) => r.title), ['Mía']);
    assert.deepEqual(board.chat(1).map((l) => l.body), ['hola']);
    assert.deepEqual(board.all('SELECT name FROM devices').map((r) => r.name), ['Móvil']);
    for (const gone of DROPPED_TABLES) assert.ok(!names(board, 'table').includes(gone), gone);
    assert.deepEqual(readJson(archived(t, 'bots', 'bots.json')).map((b) => b.name), ['Viejo']);
    assert.ok(fs.existsSync(path.join(t.home, '.orb', 'datos', PRE_COPY)));
    board.db.close();
  });
}

test('el acceso del móvil: no se abre sobre una base sin migrar y nunca sirve un dispositivo de otro usuario', async () => {
  // A 3.7 database that could not be migrated (opened here outside its home: nothing is migrated).
  const t = tempHome(); homes.push(t);
  const file = path.join(t.base, 'otra-3.7.db');
  build37(file, C.newKeyPair());
  const legacy = new Board(openDb(file));
  const remote = createRemote({ board: legacy, api: { call: async () => null }, log: () => {}, emit: () => {}, version: 'test' });
  await assert.rejects(remote.start(), /3\.7/);
  legacy.db.close();

  // The engine on a 3.7 home with the phone access on: migrated before the access opens; Dani's phone is served, Ana's
  // is not (gone), and a device with another person (a database not migrated yet) is refused.
  const port = 20000 + Math.floor(Math.random() * 20000);
  const u = tempHome({ mobile: { enabled: true, port } }); homes.push(u);
  const pc = C.newKeyPair();
  const { ids, phones } = build37(path.join(u.home, '.orb', 'datos', 'orb.db'), pc);
  const engine = await startEngine(u.home, { env: { ORB_REMOTE_BIND: '127.0.0.1' } });
  try {
    await until(async () => (await engine.call('remote.status')).running, 'servidor del móvil');
    const me = async (id, kp) => {
      const key = C.sessionKey(kp.priv, C.publicKeyOf(pc.priv));
      const box = C.seal(key, { t: Date.now(), m: 'me', b: { v: 3 } }, C.AAD.request(id));
      return (await fetch(`http://127.0.0.1:${port}/api/me`, { method: 'POST', headers: { 'X-Orb-Device': id, 'Content-Type': 'application/json' }, body: JSON.stringify(box) })).status;
    };
    assert.equal(await me(ids.dDani, phones.dani), 200, 'el móvil del dueño sigue enlazado');
    assert.equal(await me(ids.dAna, phones.ana), 401, 'el de Ana ya no');
    assert.match(fs.readFileSync(path.join(u.home, '.orb', 'ejecuciones', 'motor.log'), 'utf8'), /3\.8: datos de 3\.7 migrados: 2 bots .*1 usuarios \(Ana\)/);
    const db = new DatabaseSync(path.join(u.home, '.orb', 'datos', 'orb.db'));
    db.exec('PRAGMA busy_timeout = 5000');
    assert.match(db.prepare("SELECT body FROM chat WHERE role = 'notice' ORDER BY id DESC").all().map((r) => r.body).join(' | '), /Orb 3\.8 ya no tiene bots ni usuarios\. Hemos guardado lo anterior en .*archivo-3\.7/, 'el aviso al dueño');
    db.prepare("UPDATE devices SET person_id = 'p-otro' WHERE id = ?").run(ids.dDani);
    db.close();
    assert.equal(await me(ids.dDani, phones.dani), 401, 'un dispositivo de otra persona nunca actúa como el dueño');
  } finally { await engine.stop(); }
});

test('las copias de seguridad llevan el archivo de 3.7 (sin las carpetas de cuentas, salvo con las cuentas)', async () => {
  const t = tempHome(); homes.push(t);
  new Board().db.close();
  const put = (p) => { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, 'x'); };
  put(archived(t, 'LEEME.txt')); put(archived(t, 'bots', 'bots.json')); put(archived(t, 'usuarios', 'Ana-p', 'cuentas', 'claude', 'credenciales.json'));
  const secret = crypto.randomBytes(32);
  for (const includeAccounts of [false, true]) {
    const { file } = await createBackup({ home: t.home, secret, version: 'test', includeAccounts });
    const target = path.join(t.base, `restaurada-${includeAccounts}`);
    await restoreInto(target, file, { secret });
    const back = (...p) => path.join(target, '.orb', ARCHIVE_DIR, ...p);
    assert.ok(fs.existsSync(back('LEEME.txt')) && fs.existsSync(back('bots', 'bots.json')));
    assert.equal(fs.existsSync(back('usuarios', 'Ana-p', 'cuentas', 'claude', 'credenciales.json')), includeAccounts);
  }
});
