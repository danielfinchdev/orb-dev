// 3.8: a data folder of 3.5–3.7 opened by Orb 3.8 is moved once (src/domain/data/legacy/migrate-38.mjs): a copy of the database and a
// readable archive first, then the bots, replicas, links, other users and their settings go; the owner's data stay and
// become plain single-owner rows. Run twice, it does nothing more; a new 3.8 database is left alone. The phone access
// never serves another user's device (also before the migration) and never opens on a database it could not migrate.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { pathToFileURL } from 'node:url';
import { tempHome, ROOT, startEngine, until, wait } from './helpers.mjs';
import { useHome, ctx } from '../src/platform/context.mjs';
import { writeJson } from '../src/platform/paths.mjs';
import { openDb } from '../src/domain/data/db.mjs';
import { Board } from '../src/domain/tasks/board.mjs';
import { marks } from '../src/domain/conversations/inbox.mjs';
import { ARCHIVE_DIR, PRE_COPY, MARK, DROPPED_TABLES, ORIGINAL_CONFIG, LOCK_FILE, WORK_DIR, SCRUB_AFTER_MS, takeNotice, migrationFailure, isLegacy, unfinished, insideData, bridgeDir, scrub, scrubPreCopies, legacyData, deleteLegacyData } from '../src/domain/data/legacy/migrate-38.mjs';
import { syncProjects } from '../src/domain/projects/projects.mjs';
import { IGNORED_PROJECTS } from '../src/platform/state.mjs';
import { migrationView, folderOf } from '../src/ui/lib/migration.js';
import { startupPhase } from '../src/ui/lib/startup.js';
import * as C from '../src/shared/mobile-crypto.mjs';
import { newVapidKeys } from '../src/engine/transport/webpush.mjs';
import { createBackup, restoreInto } from '../src/domain/data/backup.mjs';
import { createRemote } from '../src/engine/transport/remote.mjs';

const { DatabaseSync } = process.getBuiltinModule('node:sqlite');
const homes = [];
after(() => { for (const h of homes) h.cleanup(); });
const schema = (v) => fs.readFileSync(path.join(ROOT, 'test', 'fixtures', `esquema-${v}.sql`), 'utf8');
const NOW = '2026-10-01T10:00:00.000Z';
const OWNER = 'p-dani'; const ANA = 'p-ana';

// A realistic 3.7 database: an owner (Dani) and a second user (Ana), bots, a group, reminders, replicas, the links' queue,
// devices of every kind, a loan, shares, chat-list marks; written by 3.7's own schema, triggers on.
function build37(file, pc, { home = null, language = null } = {}) {
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
  if (language) ps(OWNER, 'language', language);
  // Projects, conversations, chat, tasks, sessions, schedules of both.
  // Ana's project in a category of the home (its folder stays there), Dani's linked from outside.
  const anaFolder = home ? path.join(home, 'web', 'web-ana') : 'C:/x/web-ana';
  if (home) fs.mkdirSync(anaFolder, { recursive: true });
  // 3.8 (F4): a linked folder that no longer exists leaves the list (syncProjects), so Dani's is a real one.
  const daniFolder = home ? path.join(path.dirname(home), 'enlazadas', 'web-dani') : 'C:/x/web-dani';
  if (home) fs.mkdirSync(daniFolder, { recursive: true });
  run("INSERT INTO projects (name, path, created_at, person_id) VALUES ('web-dani', ?, ?, ?), ('web-ana', ?, ?, ?)", daniFolder, NOW, OWNER, anaFolder, NOW, ANA);
  const conv = (title, pid, extra = {}) => Number(run('INSERT INTO conversations (title, titled, created_at, updated_at, person_id, bot_id, group_id) VALUES (?, 1, ?, ?, ?, ?, ?)', title, NOW, NOW, pid, extra.bot ?? null, extra.group ?? null).lastInsertRowid);
  const line = (c, role, body, pid) => run('INSERT INTO chat (role, body, at, conversation_id, person_id) VALUES (?, ?, ?, ?, ?)', role, body, NOW, c, pid);
  const ids = {};
  ids.cDani = conv('Plan de Dani', OWNER); line(ids.cDani, 'usuario', 'hola Orb', OWNER); line(ids.cDani, 'orb', 'hola Dani', OWNER);
  ids.cAna = conv('Secreto de Ana', ANA); line(ids.cAna, 'usuario', 'mi secreto', ANA);
  // Ana's lines outside her conversations: a notice of hers and a line in Dani's conversation.
  line(null, 'notice', 'aviso de Ana', ANA); line(ids.cDani, 'usuario', 'Ana escribe aquí', ANA);
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
  set(`accepted:${ids.tDani}`, '1'); set(`accepted:${ids.tAna}`, '1'); set(`checkpoint:${ids.tAna}`, { before: 'x' });
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
function files37(t, ids = {}) {
  const file = path.join(t.home, 'core', 'orb.json');
  const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
  raw.userName = '';
  raw.bots = { rules: ['Nada sin mi permiso'], location: 'local' }; raw.oce = { share: true }; raw.monitor = { enabled: true };
  raw.role = 'centro'; raw.devTarget = 'taller'; raw.ui = { ...raw.ui, mode: 'bots' }; raw.browser = { enabled: true, sites: { 'example.com': { perHour: 5 } } };
  const anaHome = path.join(t.home, 'core', 'cuentas', 'claude-ana');
  raw.accounts = [...raw.accounts.map((a) => ({ ...a, person: OWNER })), { id: 'claude-ana', agent: 'claude', label: 'Claude de Ana', home: anaHome, enabled: true, person: ANA },
    { id: 'claude-gone', agent: 'claude', label: 'De alguien borrado', home: '', enabled: true, person: 'p-gone' }];
  raw.mcpServers = [{ name: 'de-ana', command: 'x', args: ['--token=abc'], env: { API_KEY: 'secreto-de-ana' }, person: ANA }, { name: 'mio', command: 'y', person: OWNER }];
  writeJson(file, raw);
  const put = (p, text = 'x') => { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, text); };
  put(path.join(t.home, 'bots', 'personas', OWNER, 'memoria-global.md'), 'memoria del dueño');
  put(path.join(t.home, 'core', 'bots-borrados', 'viejo', 'memoria.md'));
  put(path.join(t.home, 'core', 'datos', 'enlaces.json'), '{"box":"sellado"}');
  put(path.join(t.home, 'core', 'imagenes', ANA, 'a.png')); put(path.join(t.home, 'core', 'imagenes', OWNER, 'b.png'));
  put(path.join(t.home, 'core', 'cuentas', ANA, 'claude-ana', 'credenciales.json')); put(path.join(anaHome, '.credentials.json'), 'token de Ana');
  // The runs: Ana's task (its log and an MCP configuration), the coordinators' folders of 3.7 (one per person).
  const runs = path.join(t.home, 'core', 'ejecuciones');
  if (ids.tAna) { put(path.join(runs, String(ids.tAna), 'registro.jsonl'), '{"fake":1}\n'); put(path.join(runs, String(ids.tAna), 'mcp.json'), '{"env":{"ORB_AGENT_TOKEN":"x"}}'); }
  if (ids.tDani) put(path.join(runs, String(ids.tDani), 'registro.jsonl'), '{"fake":2}\n');
  put(path.join(runs, 'personas', ANA, 'nota.md')); put(path.join(runs, 'personas', OWNER, 'nota.md'));
  put(path.join(t.home, 'core', 'bitacora', `general-${ANA}.md`), 'bitácora de Ana');
  const local = path.join(t.base, 'localappdata'); put(path.join(local, 'OrbPuente', 'orb.json'), '{}'); put(path.join(local, 'OrbPuente', 'oce.json'), '{}');
  process.env.ORB_BRIDGE_DIR = path.join(local, 'OrbPuente');
  return local;
}

const names = (board, type) => board.all('SELECT name FROM sqlite_master WHERE type = ?', type).map((r) => r.name);
const archived = (t, ...p) => path.join(t.home, 'core', ARCHIVE_DIR, ...p);
const readJson = (f) => JSON.parse(fs.readFileSync(f, 'utf8'));
// The same workspace as Orb 3.7 had it: .orb, orb.json, bitacora and mcp-servers at the top (src/domain/workspace/core-folder.mjs
// moves them into core when the engine starts, before the 3.8 migration of the database).
function asOrb37(home) {
  const core = path.join(home, 'core');
  fs.renameSync(path.join(core, 'orb.json'), path.join(home, 'orb.json'));
  fs.renameSync(path.join(core, 'bitacora'), path.join(home, 'bitacora'));
  fs.renameSync(path.join(core, 'mcp'), path.join(home, 'mcp-servers'));
  fs.renameSync(core, path.join(home, '.orb'));
}

test('una base 3.7 de dos usuarios: copia y archivo primero, luego fuera bots, réplicas, enlaces y el otro usuario', () => {
  const t = tempHome(); homes.push(t);
  const { ids } = build37(path.join(t.home, 'core', 'datos', 'orb.db'), C.newKeyPair(), { home: t.home });
  const local = files37(t, ids);
  const before = fs.readFileSync(path.join(t.home, 'core', 'orb.json'), 'utf8');
  useHome(t.home);
  let board = new Board();
  assert.equal(migrationFailure(), null);
  // The copy and the archive.
  assert.ok(fs.existsSync(path.join(t.home, 'core', 'datos', PRE_COPY)), 'copia de la base de antes');
  const old = new DatabaseSync(path.join(t.home, 'core', 'datos', PRE_COPY), { readOnly: true });
  assert.equal(old.prepare('SELECT COUNT(*) AS n FROM bots').get().n, 2, 'la copia tiene la base tal cual');
  old.close();
  assert.ok(fs.existsSync(archived(t, 'LEEME.txt')));
  // orb.json as it was, but without Ana's keys (it goes into every backup); the original is gone once the new one is written.
  const kept = JSON.parse(before);
  const archivedConfig = readJson(archived(t, ORIGINAL_CONFIG));
  assert.deepEqual(archivedConfig.bots, kept.bots, 'orb.json tal como estaba');
  assert.deepEqual(archivedConfig.mcpServers.find((m) => m.name === 'de-ana'), { name: 'de-ana', command: 'x', args: ['(oculto)'], ocultos: ['env.API_KEY'], person: ANA });
  assert.ok(!JSON.stringify(archivedConfig).includes('secreto-de-ana'));
  assert.ok(!fs.existsSync(path.join(t.home, 'core', 'datos', WORK_DIR)), 'el orb.json original ya no está');
  assert.ok(!fs.existsSync(path.join(t.home, 'core', 'datos', 'migracion-3.8.json')));
  assert.equal(fs.existsSync(path.join(t.home, 'core', 'datos', LOCK_FILE)), process.platform !== 'win32', 'el bloqueo: quitado en Windows; fuera, se queda');
  assert.deepEqual(readJson(archived(t, 'bots', 'bots.json')).map((b) => b.name), ['Casa', 'Bot de Ana']);
  assert.equal(readJson(archived(t, 'bots', 'grupos.json'))[0].members.length, 2);
  assert.equal(readJson(archived(t, 'bots', 'recordatorios.json'))[0].text, 'Sacar la basura');
  assert.equal(readJson(archived(t, 'bots', 'memorias-historial.json')).length, 1);
  assert.deepEqual(readJson(archived(t, 'bots', 'conversaciones', `${ids.cBot}.json`)).chat.map((l) => l.body), ['enciende la luz', 'hecho']);
  assert.equal(fs.readFileSync(archived(t, 'bots', 'carpeta', 'personas', OWNER, 'memoria-global.md'), 'utf8'), 'memoria del dueño');
  assert.ok(fs.existsSync(archived(t, 'bots', 'borrados', 'viejo', 'memoria.md')));
  assert.ok(!fs.existsSync(path.join(t.home, 'bots')) && !fs.existsSync(path.join(t.home, 'core', 'bots-borrados')));
  assert.ok(fs.existsSync(archived(t, 'enlaces.json')) && !fs.existsSync(path.join(t.home, 'core', 'datos', 'enlaces.json')));
  assert.ok(fs.existsSync(archived(t, 'orb-puente.json')) && !fs.existsSync(path.join(local, 'OrbPuente', 'orb.json')));
  assert.ok(fs.existsSync(path.join(local, 'OrbPuente', 'oce.json')), 'el oce.json de Open Control Edge no se toca');
  // Ana's export, then her data gone.
  const ana = archived(t, 'usuarios', `Ana-${ANA}`);
  assert.equal(readJson(path.join(ana, 'usuario.json')).name, 'Ana');
  assert.equal(readJson(path.join(ana, 'usuario.json')).pin_hash, undefined);
  assert.deepEqual(readJson(path.join(ana, 'conversaciones', `${ids.cAna}.json`)).chat.map((l) => l.body), ['mi secreto']);
  assert.deepEqual(readJson(path.join(ana, 'tareas.json')).map((x) => x.title), ['Tarea de Ana']);
  assert.deepEqual(readJson(path.join(ana, 'proyectos.json')).map((x) => x.name), ['web-ana']);
  // Her accounts: only their names (no keys); her sign-in folders are deleted, not archived.
  const cuentas = readJson(path.join(ana, 'cuentas.json'));
  assert.deepEqual(cuentas.accounts.map((a) => a.id), ['claude-ana']);
  assert.deepEqual(cuentas.mcpServers, [{ name: 'de-ana', command: 'x', args: ['(oculto)'], ocultos: ['env.API_KEY'] }]);
  assert.ok(!JSON.stringify(cuentas).includes('secreto-de-ana'));
  assert.ok(!fs.existsSync(path.join(ana, 'cuentas')) && !fs.existsSync(path.join(t.home, 'core', 'cuentas', ANA)) && !fs.existsSync(path.join(t.home, 'core', 'cuentas', 'claude-ana')));
  assert.match(fs.readFileSync(archived(t, 'LEEME.txt'), 'utf8'), /Ana tendrá que volver a iniciar sesión en su propio Orb/);
  // An account of a person nobody knows: not given to the owner, archived apart.
  assert.deepEqual(readJson(archived(t, 'usuarios', 'desconocido', 'cuentas.json')).accounts.map((a) => [a.id, a.person]), [['claude-gone', 'p-gone']]);
  assert.equal(readJson(path.join(ana, 'ajustes.json')).preview, 'all');
  assert.ok(fs.existsSync(path.join(ana, 'imagenes', 'a.png')) && fs.existsSync(path.join(ana, 'bitacora-general.md')));
  // Her lines outside her conversations, her spending, her task's settings and run log.
  assert.deepEqual(readJson(path.join(ana, 'chat-suelto.json')).map((l) => l.body), ['aviso de Ana', 'Ana escribe aquí', 'hola familia'], 'también su línea en el grupo de bots');
  assert.deepEqual(readJson(path.join(ana, 'uso.json')).map((u) => u.usd), [0.25]);
  assert.deepEqual(readJson(path.join(ana, 'tareas.json'))[0].settings, { accepted: 1, checkpoint: { before: 'x' } });
  assert.equal(fs.readFileSync(path.join(ana, 'ejecuciones', 'tareas', String(ids.tAna), 'registro.jsonl'), 'utf8'), '{"fake":1}\n');
  assert.ok(!fs.existsSync(path.join(ana, 'ejecuciones', 'tareas', String(ids.tAna), 'mcp.json')), 'nada más de su ejecución');
  const runs = path.join(t.home, 'core', 'ejecuciones');
  assert.ok(!fs.existsSync(path.join(runs, String(ids.tAna))) && !fs.existsSync(path.join(runs, 'personas', ANA)) && !fs.existsSync(path.join(runs, 'personas', OWNER)));
  assert.ok(fs.existsSync(path.join(runs, String(ids.tDani), 'registro.jsonl')), 'las ejecuciones del dueño se quedan');
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
  assert.deepEqual(board.chat(ids.cDani).map((l) => l.body), ['hola Orb', 'hola Dani', '(mensaje de otro usuario de Orb 3.7)'], 'la línea del otro usuario sigue en su sitio, sin su texto');
  assert.deepEqual(board.all('SELECT title FROM tasks').map((r) => r.title), ['Tarea de Dani']);
  assert.deepEqual(board.all('SELECT name FROM projects').map((r) => r.name), ['web-dani']);
  assert.deepEqual(board.all('SELECT title FROM schedules').map((r) => r.title), ['Revisar']);
  assert.deepEqual(board.all('SELECT id FROM sessions').map((r) => r.id), ['s-dani']);
  assert.equal(board.one('SELECT COUNT(*) AS n FROM session_items').n, 1);
  assert.equal(board.one('SELECT COUNT(*) AS n FROM messages').n, 1);
  assert.deepEqual(board.all('SELECT name FROM devices').map((r) => r.name), ['Móvil de Dani'], 'sin el móvil de Ana, el Orb enlazado ni la terminal');
  for (const tb of ['conversations', 'chat', 'tasks', 'sessions', 'schedules', 'projects', 'events', 'devices', 'messages', 'usage_ledger']) assert.equal(board.one(`SELECT COUNT(*) AS n FROM ${tb} WHERE person_id IS NOT NULL`).n, 0, tb);
  assert.equal(board.one('SELECT SUM(usd) AS s FROM usage_ledger').s, 0.5, 'el gasto de Ana no cuenta como del dueño');
  assert.equal(board.one("SELECT COUNT(*) AS n FROM chat WHERE body IN ('aviso de Ana', 'Ana escribe aquí')").n, 0);
  assert.equal(board.setting(`accepted:${ids.tDani}`), '1'); assert.equal(board.setting(`accepted:${ids.tAna}`), undefined); assert.equal(board.setting(`checkpoint:${ids.tAna}`), undefined);
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
  const raw = readJson(path.join(t.home, 'core', 'orb.json'));
  for (const k of ['bots', 'oce', 'monitor', 'role', 'devTarget']) assert.equal(raw[k], undefined, k);
  assert.equal(raw.ui.mode, undefined); assert.equal(raw.browser.sites, undefined); assert.equal(raw.browser.enabled, true);
  assert.equal(raw.userName, 'Dani'); assert.equal(raw.tz, 'Europe/Madrid'); assert.equal(raw.mobile.preview, 'none');
  assert.equal(raw.orchestrator.model, 'claude-opus-5-5'); assert.equal(raw.orchestrator.reasoning, 'high'); assert.equal(raw.orchestrator.orchestrate, false);
  assert.ok(!raw.accounts.some((a) => a.id === 'claude-ana' || a.id === 'claude-gone' || 'person' in a));
  assert.equal(board.setting('migrated_3_8_config'), undefined, 'orb.json ya escrito');
  assert.deepEqual(raw.mcpServers, [{ name: 'mio', command: 'y' }]);
  assert.equal(ctx.config.orchestrator.model, 'claude-opus-5-5', 'la configuración en memoria también');
  // The owner's images back where 3.8 keeps them.
  assert.ok(fs.existsSync(path.join(t.home, 'core', 'imagenes', 'b.png')) && !fs.existsSync(path.join(t.home, 'core', 'imagenes', ANA)));
  // Ana's project folder stays in web/, not listed; added by hand, it is listed again.
  assert.ok(fs.existsSync(path.join(t.home, 'web', 'web-ana')));
  assert.match(fs.readFileSync(archived(t, 'LEEME.txt'), 'utf8'), /Las carpetas de Ana siguen en web[\\/]web-ana; Orb no las lista/);
  syncProjects(board);
  assert.deepEqual(board.projects().map((x) => x.name), ['web-dani']);
  board.addProject({ name: 'web-ana', path: path.join(t.home, 'web', 'web-ana') }, 'usuario', { fromUser: true });
  assert.deepEqual(board.settingJson(IGNORED_PROJECTS), [], 'añadida a mano, ya no se ignora');
  syncProjects(board);
  assert.deepEqual(board.projects().map((x) => x.name).sort(), ['web-ana', 'web-dani']);
  // Told once.
  const notice = takeNotice(board);
  assert.equal(notice.bots, 2); assert.deepEqual(notice.users, ['Ana']); assert.equal(notice.archive, archived(t));
  assert.equal(notice.haToken, true, 'había un token de Home Assistant: el aviso dice que se revoque');
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
  assert.ok(!fs.existsSync(path.join(t.home, 'core', 'datos', PRE_COPY)));
  assert.ok(!fs.existsSync(archived(t)));
  assert.equal(takeNotice(board), null);
  board.db.close();
});

for (const v of ['3.6', '3.5.1']) {
  test(`una base ${v} salta a 3.8: las migraciones viejas primero, luego la de 3.8`, () => {
    const t = tempHome(); homes.push(t);
    const file = path.join(t.home, 'core', 'datos', 'orb.db');
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
    assert.ok(fs.existsSync(path.join(t.home, 'core', 'datos', PRE_COPY)));
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

  // The engine on a 3.7 home with the phone access on: migrated before the access opens; Ana's phone is gone, and Dani's
  // too (F3b-fix: a phone of before 3.8 never proved the master password; he is told to link it again), and a device
  // with another person (a database not migrated yet) is refused.
  const port = 20000 + Math.floor(Math.random() * 20000);
  const u = tempHome({ mobile: { enabled: true, port } }); homes.push(u);
  const pc = C.newKeyPair();
  const { ids, phones } = build37(path.join(u.home, 'core', 'datos', 'orb.db'), pc);
  asOrb37(u.home);
  const engine = await startEngine(u.home, { env: { ORB_REMOTE_BIND: '127.0.0.1' } });
  assert.ok(!fs.existsSync(path.join(u.home, '.orb')) && !fs.existsSync(path.join(u.home, 'orb.json')), 'la carpeta de 3.7 ya está en core');
  try {
    await until(async () => (await engine.call('remote.status')).running, 'servidor del móvil');
    const me = async (id, kp) => {
      const key = C.sessionKey(kp.priv, C.publicKeyOf(pc.priv));
      const box = C.seal(key, { t: Date.now(), m: 'me', b: { v: 3 } }, C.AAD.request(id));
      return (await fetch(`http://127.0.0.1:${port}/api/me`, { method: 'POST', headers: { 'X-Orb-Device': id, 'Content-Type': 'application/json' }, body: JSON.stringify(box) })).status;
    };
    assert.equal(await me(ids.dDani, phones.dani), 401, 'el móvil del dueño, enlazado antes de 3.8, se vuelve a enlazar');
    assert.equal(await me(ids.dAna, phones.ana), 401, 'el de Ana ya no');
    assert.match(fs.readFileSync(path.join(u.home, 'core', 'ejecuciones', 'motor.log'), 'utf8'), /3\.8: datos de 3\.7 migrados: 2 bots .*1 usuarios \(Ana\)/);
    const db = new DatabaseSync(path.join(u.home, 'core', 'datos', 'orb.db'));
    db.exec('PRAGMA busy_timeout = 5000');
    const said = db.prepare("SELECT body FROM chat WHERE role = 'notice' ORDER BY id DESC").all().map((r) => r.body).join(' | ');
    assert.match(said, /Orb 3\.8 ya no tiene bots ni usuarios\. Hemos guardado lo anterior en .*archivo-3\.7/, 'el aviso al dueño');
    assert.match(said, /Vuelve a enlazar tu móvil con Magic Link/);
    // A device of 3.8 that still has a person (a database not migrated yet) is never served.
    const other = '33333333-3333-3333-3333-333333333333';
    db.prepare("INSERT INTO devices (id, name, token_hash, created_at, last_seen, public_key, route, kind, meta, person_id) VALUES (?, 'Otro', ?, ?, ?, ?, 'wifi', 'phone', ?, 'p-otro')").run(other, `clave:${other}`, new Date().toISOString(), new Date().toISOString(), C.b64.enc(phones.dani.pub), JSON.stringify({ v: 4 }));
    db.close();
    assert.equal(await me(other, phones.dani), 401, 'un dispositivo de otra persona nunca actúa como el dueño');
  } finally { await engine.stop(); }
});

test('las copias de seguridad llevan los archivos de 3.7 (también los fechados), nunca carpetas de cuentas', async () => {
  const t = tempHome(); homes.push(t);
  new Board().db.close();
  const put = (p) => { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, 'x'); };
  const dated = `${ARCHIVE_DIR}-2026-11-07-10-00-00`;
  put(archived(t, 'LEEME.txt')); put(archived(t, 'bots', 'bots.json')); put(archived(t, 'usuarios', 'Ana-p', 'cuentas', 'claude', 'credenciales.json'));
  put(path.join(t.home, 'core', dated, 'LEEME.txt'));
  const secret = crypto.randomBytes(32);
  for (const includeAccounts of [false, true]) {
    const { file } = await createBackup({ home: t.home, secret, version: 'test', includeAccounts });
    const target = path.join(t.base, `restaurada-${includeAccounts}`);
    await restoreInto(target, file, { secret });
    const back = (...p) => path.join(target, 'core', ARCHIVE_DIR, ...p);
    assert.ok(fs.existsSync(back('LEEME.txt')) && fs.existsSync(back('bots', 'bots.json')));
    assert.ok(fs.existsSync(path.join(target, 'core', dated, 'LEEME.txt')));
    assert.equal(fs.existsSync(back('usuarios', 'Ana-p', 'cuentas', 'claude', 'credenciales.json')), false, 'ni con las cuentas');
  }
});

// ---- F2.5b: the review of the migration (orb-3.8-revision-F2.5.md)
const dbFile = (t) => path.join(t.home, 'core', 'datos', 'orb.db');
const datosOf = (t) => path.join(t.home, 'core', 'datos');
const raw37 = (t, fn) => { const db = new DatabaseSync(dbFile(t)); try { db.exec('PRAGMA busy_timeout = 5000'); return fn(db); } finally { db.close(); } };
function setup37(opts = {}) {
  const t = tempHome(); homes.push(t);
  const r = build37(dbFile(t), C.newKeyPair(), { home: t.home, ...opts });
  files37(t, r.ids);
  useHome(t.home);
  return { t, ...r };
}
const own = (board) => board.all('SELECT title FROM conversations WHERE bot_id IS NULL AND group_id IS NULL ORDER BY id').map((r) => r.title);
// A transaction that cannot finish (as with a full disk): a view on a column the migration drops.
const breakTransaction = (t) => raw37(t, (db) => db.exec('CREATE VIEW ve_role AS SELECT role FROM devices'));
const fixTransaction = (t) => raw37(t, (db) => db.exec('DROP VIEW ve_role'));

// The files of 3.7 a run moves or deletes once committed (each one, as files37 makes it).
const files37Of = (t) => [path.join(t.home, 'bots', 'personas', OWNER, 'memoria-global.md'), path.join(t.home, 'core', 'bots-borrados', 'viejo', 'memoria.md'),
  path.join(t.home, 'core', 'datos', 'enlaces.json'), path.join(process.env.ORB_BRIDGE_DIR, 'orb.json'), path.join(t.home, 'core', 'imagenes', ANA, 'a.png'),
  path.join(t.home, 'core', 'imagenes', OWNER, 'b.png'), path.join(t.home, 'core', 'cuentas', ANA, 'claude-ana', 'credenciales.json'),
  path.join(t.home, 'core', 'cuentas', 'claude-ana', '.credentials.json'), path.join(t.home, 'core', 'ejecuciones', 'personas', ANA, 'nota.md'),
  path.join(t.home, 'core', 'ejecuciones', 'personas', OWNER, 'nota.md'), path.join(t.home, 'core', 'bitacora', `general-${ANA}.md`)];

test('A1/A2: si la transacción falla tras la copia no se mueve ni se borra nada (BD, orb.json y ficheros), y el reintento deja el archivo completo', () => {
  const { t, ids } = setup37();
  const orbBefore = fs.readFileSync(path.join(t.home, 'core', 'orb.json'), 'utf8');
  const before = files37Of(t).map((f) => [f, fs.readFileSync(f, 'utf8')]);
  before.push([path.join(t.home, 'core', 'ejecuciones', String(ids.tAna), 'mcp.json'), fs.readFileSync(path.join(t.home, 'core', 'ejecuciones', String(ids.tAna), 'mcp.json'), 'utf8')]);
  breakTransaction(t);
  let board = new Board();
  const f = migrationFailure();
  assert.ok(f?.reason, 'dice por qué');
  assert.equal(f.backup, path.join(datosOf(t), PRE_COPY), 'y dónde está la copia');
  assert.ok(isLegacy(board.db));
  assert.deepEqual(own(board), ['Plan de Dani', 'Secreto de Ana']);
  assert.equal(board.one('SELECT COUNT(*) AS n FROM persons').n, 2);
  assert.equal(board.setting(MARK), undefined);
  assert.equal(fs.readFileSync(path.join(t.home, 'core', 'orb.json'), 'utf8'), orbBefore, 'orb.json sin tocar');
  for (const [f, text] of before) assert.equal(fs.existsSync(f) && fs.readFileSync(f, 'utf8'), text, `${path.relative(t.base, f)} sigue en su sitio`);
  assert.equal(f.committed, false, 'Orb 3.7 puede volver a abrir estos datos');
  assert.ok(fs.existsSync(path.join(datosOf(t), WORK_DIR, ORIGINAL_CONFIG)), 'el orb.json original, fuera del archivo');
  assert.ok(!fs.existsSync(archived(t, 'imagenes')) && fs.existsSync(archived(t, 'usuarios', `Ana-${ANA}`, 'imagenes', 'a.png')), 'en el archivo solo hay copias');
  const copyAt = fs.statSync(path.join(datosOf(t), PRE_COPY)).mtimeMs;
  board.db.close();

  // The next start.
  fixTransaction(t);
  board = new Board();
  assert.equal(migrationFailure(), null);
  assert.ok(!isLegacy(board.db));
  const ana = archived(t, 'usuarios', `Ana-${ANA}`);
  assert.deepEqual(readJson(path.join(ana, 'cuentas.json')).accounts.map((a) => a.id), ['claude-ana'], 'las cuentas de Ana siguen en el archivo');
  assert.deepEqual(readJson(path.join(ana, 'cuentas.json')).mcpServers.map((m) => m.name), ['de-ana']);
  assert.equal(readJson(archived(t, 'orb-json-retirado.json')).role, 'centro', 'y los ajustes retirados');
  assert.ok(!fs.readFileSync(archived(t, ORIGINAL_CONFIG), 'utf8').includes('secreto-de-ana'));
  assert.equal(fs.statSync(path.join(datosOf(t), PRE_COPY)).mtimeMs, copyAt, 'la copia buena de antes se usa, no se rehace');
  for (const [f] of before) if (!f.includes(`${path.sep}imagenes${path.sep}${OWNER}`)) assert.ok(!fs.existsSync(f), `${path.relative(t.base, f)} ya no está`);
  assert.equal(fs.readFileSync(path.join(t.home, 'core', 'imagenes', 'b.png'), 'utf8'), 'x', 'las imágenes del dueño, en su sitio de 3.8');
  assert.ok(!fs.readdirSync(path.join(t.home, 'core')).some((n) => n.startsWith(`${ARCHIVE_DIR}-`)), 'el mismo archivo, no otro');
  assert.equal(readJson(path.join(t.home, 'core', 'orb.json')).role, undefined);
  assert.deepEqual(own(board), ['Plan de Dani']);
  board.db.close();
});

// A read-only file cannot be replaced by a rename only on Windows (elsewhere the folder's permissions decide).
const READONLY_BLOCKS = process.platform !== 'win32' && 'solo Windows: renombrar sobre un archivo de solo lectura';
test('R3: si orb.json no se puede escribir tras el COMMIT, Orb no arranca (ni con la configuración de 3.7) y el siguiente arranque lo termina', { skip: READONLY_BLOCKS }, () => {
  const { t } = setup37();
  const file = path.join(t.home, 'core', 'orb.json');
  fs.chmodSync(file, 0o444); // read-only (or held by an antivirus): the rename over it fails
  let board = new Board();
  const f = migrationFailure();
  assert.match(f?.reason ?? '', /orb\.json/);
  assert.equal(f.committed, true, 'la BD ya es de 3.8');
  assert.ok(!isLegacy(board.db) && unfinished(board.db), 'Orb no arranca sobre esto');
  assert.ok(!ctx.config.accounts.some((a) => a.id === 'claude-ana' || a.id === 'claude-gone'), 'ni en memoria las cuentas de otros');
  assert.ok(!(ctx.config.mcpServers ?? []).some((m) => m.name === 'de-ana'));
  assert.deepEqual(fs.readdirSync(t.home).filter((n) => n.endsWith('.tmp')), [], 'sin temporal huérfano');
  assert.equal(takeNotice(board) != null, true);
  board.db.close();
  // Writable again: the next start finishes (the files' plan runs again without harm).
  fs.chmodSync(file, 0o644);
  board = new Board();
  assert.equal(migrationFailure(), null);
  assert.ok(!unfinished(board.db));
  const raw = readJson(file);
  assert.equal(raw.role, undefined); assert.equal(raw.userName, 'Dani');
  assert.ok(!raw.accounts.some((a) => a.id === 'claude-ana'));
  assert.ok(!fs.existsSync(path.join(datosOf(t), WORK_DIR)) && !fs.existsSync(path.join(datosOf(t), 'migracion-3.8.json')));
  board.db.close();
});

test('R3: la configuración pendiente nunca pisa los cambios hechos después en orb.json', { skip: READONLY_BLOCKS }, () => {
  const { t } = setup37();
  const file = path.join(t.home, 'core', 'orb.json');
  fs.chmodSync(file, 0o444);
  new Board().db.close();
  assert.equal(migrationFailure()?.committed, true);
  // Meanwhile orb.json changes (by hand, or Orb 3.7 opened again): still 3.7's, with a change of the user.
  fs.chmodSync(file, 0o644);
  const changed = readJson(file); changed.assistantName = 'Mi Orb'; writeJson(file, changed);
  const board = new Board();
  assert.equal(migrationFailure(), null);
  const raw = readJson(file);
  assert.equal(raw.assistantName, 'Mi Orb', 'el cambio se queda');
  assert.equal(raw.role, undefined, 'y lo de 3.7 se quita igual');
  assert.ok(!raw.accounts.some((a) => a.id === 'claude-ana') && !raw.mcpServers.some((m) => m.name === 'de-ana'));
  assert.equal(raw.orchestrator.model, 'claude-opus-5-5', 'con los ajustes del dueño de 3.7');
  // Already written: opened again, nothing changes.
  board.db.close();
  const text = fs.readFileSync(file, 'utf8');
  new Board().db.close();
  assert.equal(fs.readFileSync(file, 'utf8'), text);
});

test('A2: una copia previa vacía o a medias nunca se da por buena: se aparta y se hace otra comprobada', () => {
  for (const broken of ['', 'SQLite format 3 a medias']) {
    const { t } = setup37();
    const datos = datosOf(t);
    // An interrupted run whose copy was left empty or cut.
    fs.writeFileSync(path.join(datos, PRE_COPY), broken);
    fs.writeFileSync(path.join(datos, 'migracion-3.8.json'), JSON.stringify({ archive: ARCHIVE_DIR, copy: PRE_COPY }));
    const board = new Board();
    assert.equal(migrationFailure(), null);
    const copy = new DatabaseSync(path.join(datos, PRE_COPY), { readOnly: true });
    assert.equal(copy.prepare('PRAGMA quick_check').get().quick_check, 'ok');
    assert.equal(copy.prepare('SELECT COUNT(*) AS n FROM persons').get().n, 2, 'la base tal como era');
    copy.close();
    const aside = fs.readdirSync(datos).filter((n) => n.startsWith(`${PRE_COPY}.roto-`));
    assert.equal(aside.length, 1, 'la mala, apartada (no borrada)');
    assert.equal(fs.readFileSync(path.join(datos, aside[0]), 'utf8'), broken);
    assert.ok(!fs.existsSync(path.join(datos, `${PRE_COPY}.tmp`)));
    board.db.close();
  }
});

test('M1: sin dueño no se borra nada; un dueño borrado sigue siendo el dueño', () => {
  const { t } = setup37();
  raw37(t, (db) => db.exec("UPDATE persons SET role = 'user'"));
  let board = new Board();
  assert.match(migrationFailure()?.reason ?? '', /No se sabe quién es el dueño/);
  assert.ok(isLegacy(board.db));
  assert.deepEqual(own(board), ['Plan de Dani', 'Secreto de Ana'], 'nada borrado');
  board.db.close();
  raw37(t, (db) => db.prepare("UPDATE persons SET role = 'owner', deleted_at = ? WHERE id = ?").run(NOW, OWNER));
  board = new Board();
  assert.equal(migrationFailure(), null);
  assert.deepEqual(own(board), ['Plan de Dani'], 'lo del dueño se queda');
  board.db.close();
});

test('B4: el proyecto de trabajo de settings manda sobre el de person_settings; el idioma del dueño en 3.7, sobre orb.json', () => {
  const { t } = setup37({ language: 'en' });
  raw37(t, (db) => db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('active_project', 'web-actual')").run());
  const board = new Board();
  assert.equal(board.setting('active_project'), 'web-actual');
  assert.equal(readJson(path.join(t.home, 'core', 'orb.json')).language, 'en');
  board.db.close();
});

test('M4: restaurar dos veces una copia de 3.7 ya migrada da cada vez un archivo y una copia nuevos, sin tocar los de antes', async () => {
  const { t } = setup37();
  const secret = crypto.randomBytes(32);
  const { file } = await createBackup({ home: t.home, secret, version: 'test' });
  new Board().db.close();
  const first = fs.readFileSync(archived(t, 'LEEME.txt'), 'utf8');
  const firstCopy = fs.readFileSync(path.join(datosOf(t), PRE_COPY));
  const copies = () => fs.readdirSync(datosOf(t)).filter((n) => /^orb-pre-3\.8.*\.db$/.test(n));
  const archives = () => fs.readdirSync(path.join(t.home, 'core')).filter((n) => n.startsWith(ARCHIVE_DIR));
  for (let i = 1; i <= 2; i++) {
    await restoreInto(t.home, file, { secret });
    useHome(t.home);
    const board = new Board();
    assert.equal(migrationFailure(), null);
    assert.ok(!isLegacy(board.db));
    assert.deepEqual(own(board), ['Plan de Dani']);
    assert.equal(archives().length, i + 1); assert.equal(copies().length, i + 1);
    const notice = takeNotice(board);
    assert.ok(path.basename(notice.archive).startsWith(`${ARCHIVE_DIR}-`), 'un archivo con fecha');
    assert.ok(path.basename(notice.backup).startsWith('orb-pre-3.8-'), 'y una copia con fecha');
    assert.ok(fs.existsSync(path.join(notice.archive, 'usuarios', `Ana-${ANA}`, 'tareas.json')));
    assert.ok(fs.readFileSync(path.join(notice.archive, 'LEEME.txt'), 'utf8').includes(notice.backup), 'el LEEME nombra su copia');
    const copy = new DatabaseSync(notice.backup, { readOnly: true });
    assert.equal(copy.prepare('SELECT COUNT(*) AS n FROM persons').get().n, 2); copy.close();
    board.db.close();
  }
  assert.equal(fs.readFileSync(archived(t, 'LEEME.txt'), 'utf8'), first, 'el primer archivo no se toca');
  assert.ok(fs.readFileSync(path.join(datosOf(t), PRE_COPY)).equals(firstCopy), 'ni la primera copia');
});

test('B5: un proceso vivo con el bloqueo no deja migrar; al morir lo suelta; dos procesos a la vez migran una sola vez', async () => {
  const { t } = setup37();
  const lockFile = path.join(datosOf(t), LOCK_FILE);
  // Another process holds the lock (an exclusive transaction on the lock's database), then dies without letting it go.
  const holder = spawn(process.execPath, ['-e', "const d = new (process.getBuiltinModule('node:sqlite').DatabaseSync)(process.argv[1]); d.exec('BEGIN EXCLUSIVE'); process.stdout.write('ok'); setTimeout(() => {}, 60000);", lockFile], { stdio: ['ignore', 'pipe', 'inherit'] });
  await once(holder.stdout, 'data');
  process.env.ORB_MIGRATION_LOCK_MS = '300';
  try {
    const board = new Board();
    assert.match(migrationFailure()?.reason ?? '', /Otro proceso de Orb está actualizando/);
    assert.ok(isLegacy(board.db));
    assert.deepEqual(own(board), ['Plan de Dani', 'Secreto de Ana']);
    board.db.close();
  } finally { delete process.env.ORB_MIGRATION_LOCK_MS; holder.kill(); }
  await once(holder, 'exit');
  // Its process gone, the system let the lock go. Two processes open the folder at once.
  const src = (f) => JSON.stringify(pathToFileURL(path.join(ROOT, 'src', f)).href);
  const script = `import { useHome } from ${src('platform/context.mjs')}; import { Board } from ${src('domain/tasks/board.mjs')}; import { migrationFailure } from ${src('domain/data/legacy/migrate-38.mjs')};
useHome(process.env.ORB_TEST_HOME); const b = new Board(); process.stdout.write(JSON.stringify({ failure: migrationFailure() })); b.db.close();`;
  const runOne = () => new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['--input-type=module', '-e', script], { env: { ...process.env, ORB_TEST_HOME: t.home }, stdio: ['ignore', 'pipe', 'inherit'] });
    let out = ''; child.stdout.on('data', (d) => { out += d; });
    child.on('exit', (code) => (code === 0 ? resolve(JSON.parse(out)) : reject(new Error(`salida ${code}`))));
  });
  const results = await Promise.all([runOne(), runOne()]);
  assert.deepEqual(results, [{ failure: null }, { failure: null }]);
  assert.deepEqual(fs.readdirSync(path.join(t.home, 'core')).filter((n) => n.startsWith(ARCHIVE_DIR)), [ARCHIVE_DIR], 'un solo archivo');
  assert.equal(fs.existsSync(lockFile), process.platform !== 'win32', 'quitado en Windows; fuera, se queda');
  const board = new Board();
  assert.ok(!isLegacy(board.db));
  assert.deepEqual(own(board), ['Plan de Dani']);
  assert.ok(takeNotice(board), 'avisado una vez');
  board.db.close();
});

test('B8: la migración solo escribe en la carpeta de datos (y el fichero del puente); en pruebas sin ORB_BRIDGE_DIR no hay puente', () => {
  const t = tempHome(); homes.push(t);
  assert.equal(insideData(t.home, path.join(t.home, 'core', 'archivo-3.7', 'x.json')), true);
  assert.equal(insideData(t.home, path.join(t.base, 'fuera.json')), false);
  assert.equal(insideData(t.home, path.join(t.home, '..', 'fuera.json')), false);
  const saved = process.env.ORB_BRIDGE_DIR;
  try {
    process.env.ORB_BRIDGE_DIR = path.join(t.base, 'puente');
    assert.equal(insideData(t.home, path.join(t.base, 'puente', 'orb.json')), true);
    assert.equal(insideData(t.home, path.join(t.base, 'puente', 'oce.json')), false, 'el oce.json nunca');
    delete process.env.ORB_BRIDGE_DIR;
    assert.ok(process.env.NODE_TEST_CONTEXT, 'node --test lo pone');
    assert.equal(bridgeDir(), null, 'nunca el OrbPuente de este PC');
  } finally { if (saved === undefined) delete process.env.ORB_BRIDGE_DIR; else process.env.ORB_BRIDGE_DIR = saved; }
});

test('M2: si la migración falla, Orb no funciona sobre los datos de 3.7 (ni móvil ni tareas), dice por qué y «Reintentar» lo termina', async () => {
  const port = 20000 + Math.floor(Math.random() * 20000);
  const u = tempHome({ mobile: { enabled: true, port } }); homes.push(u);
  const { ids } = build37(dbFile(u), C.newKeyPair(), { home: u.home });
  breakTransaction(u);
  raw37(u, (db) => db.prepare("UPDATE tasks SET status = 'queued' WHERE id = ?").run(ids.tAna));
  const engine = await startEngine(u.home, { env: { ORB_REMOTE_BIND: '127.0.0.1' } });
  try {
    const m = await engine.call('app.migrationState');
    assert.equal(m.failed, true); assert.ok(m.reason);
    assert.equal(m.backup, path.join(datosOf(u), PRE_COPY));
    await assert.rejects(engine.call('app.state'), /Orb no funciona hasta actualizar tus datos/);
    // F5b (A2): the window's first questions, as main.jsx asks them, reach the screen «No se pudieron actualizar…».
    assert.equal(await engine.call('app.coreState'), null);
    const start = await startupPhase((method) => engine.call(method));
    assert.equal(start.phase, 'migration');
    assert.equal(start.data.failed, true);
    await assert.rejects(engine.call('remote.status'), /Orb no funciona hasta actualizar tus datos/);
    // 3.8.2 (M6): the phone access does not open, but a linked phone is told the PC needs attention (not «sin conexión»),
    // with nothing of the data: one fixed state, also readable by the Android app's origin.
    await until(async () => { try { return (await fetch(`http://127.0.0.1:${port}/api/me`, { method: 'POST' })).status === 503; } catch { return false; } }, 'el aviso de atención');
    const me = await fetch(`http://127.0.0.1:${port}/api/me`, { method: 'POST', headers: { Origin: 'http://tauri.localhost', 'Content-Type': 'application/json' }, body: '{}' });
    assert.equal(me.status, 503);
    assert.equal(me.headers.get('access-control-allow-origin'), 'http://tauri.localhost');
    const said = await me.json();
    assert.deepEqual(Object.keys(said).sort(), ['attention', 'error']);
    assert.equal(said.attention, 'migration'); assert.match(said.error, /necesita atención/);
    for (const p of ['/api/call', '/api/events', '/api/pair', '/api/hello']) assert.equal((await fetch(`http://127.0.0.1:${port}${p}`, { method: p === '/api/events' || p === '/api/hello' ? 'GET' : 'POST' })).status, 503, `${p}: solo el aviso`);
    const pageRes = await fetch(`http://127.0.0.1:${port}/`);
    assert.equal(pageRes.status, 503); assert.match(await pageRes.text(), /necesita atención/);
    const { default: http } = await import('node:http');
    const other = await new Promise((resolve, reject) => { const r = http.request({ host: '127.0.0.1', port, path: '/api/me', method: 'POST', headers: { Host: `otro:${port}` } }, (res) => { res.resume(); resolve(res.statusCode); }); r.on('error', reject); r.end(); });
    assert.equal(other, 421, 'otro host, no');
    await wait(2000);
    assert.equal(raw37(u, (db) => db.prepare('SELECT status FROM tasks WHERE id = ?').get(ids.tAna).status), 'queued', 'nada de los otros se ejecuta');
    assert.match(fs.readFileSync(path.join(u.home, 'core', 'ejecuciones', 'motor.log'), 'utf8'), /3\.8: la migración no se pudo hacer/);
    // Fixed (space freed): «Reintentar».
    fixTransaction(u);
    assert.deepEqual(await engine.call('app.migrationRetry'), { failed: false });
    assert.deepEqual(await engine.call('app.migrationState'), { failed: false });
    assert.ok(!(await engine.call('conversations.list')).some((c) => c.title === 'Secreto de Ana'));
    await until(async () => (await engine.call('remote.status')).running, 'el móvil, ya con los datos de 3.8');
  } finally { await engine.stop(); }
});

// ---- F2.5c: the review of F2.5b (orb-3.8-revision-F2.5b.md)
const walk = (dir) => { const out = []; const go = (d) => { let l = []; try { l = fs.readdirSync(d, { withFileTypes: true }); } catch { return; } for (const e of l) { const f = path.join(d, e.name); if (e.isDirectory()) go(f); else out.push(f); } }; go(dir); return out; };
const archives = (home) => fs.readdirSync(path.join(home, 'core')).filter((n) => n.startsWith(ARCHIVE_DIR)).map((n) => path.join(home, 'core', n));

test('A1/B2: ni el archivo ni las copias de seguridad llevan claves de otros usuarios (por nombre ni por valor)', async () => {
  const { t } = setup37();
  const file = path.join(t.home, 'core', 'orb.json');
  const raw = readJson(file);
  raw.mcpServers = raw.mcpServers.map((m) => (m.name === 'de-ana' ? { ...m, command: 'npx servidor sk-ant-abcdefgh123456', url: 'https://ana:clave-de-ana@host/x?sig=zzz-de-ana', args: ['--token=abc', '--api-key', 'valor-suelto-de-ana', 'ghp_abcdefghijklmnop1234'] } : m));
  writeJson(file, raw);
  new Board().db.close();
  assert.equal(migrationFailure(), null);
  const secrets = ['secreto-de-ana', 'token=abc', 'sk-ant-abcdefgh123456', 'clave-de-ana', 'zzz-de-ana', 'valor-suelto-de-ana', 'ghp_abcdefghijklmnop1234'];
  const leaks = (files) => files.flatMap((f) => { const text = fs.readFileSync(f, 'latin1'); return secrets.filter((s) => text.includes(s)).map((s) => `${path.basename(f)}: ${s}`); });
  assert.deepEqual(leaks(archives(t.home).flatMap(walk)), [], 'en el archivo');
  const kept = readJson(path.join(archived(t), 'usuarios', `Ana-${ANA}`, 'cuentas.json')).mcpServers[0];
  assert.equal(kept.url, 'https://(oculto)@host/x?sig=(oculto)'); assert.deepEqual(kept.args, ['(oculto)', '(oculto)', '(oculto)', '[secreto oculto]']);
  const secret = crypto.randomBytes(32);
  for (const includeAccounts of [false, true]) {
    const { file: copy } = await createBackup({ home: t.home, secret, version: 'test', includeAccounts });
    const target = path.join(t.base, `restaurada-${includeAccounts}`);
    await restoreInto(target, copy, { secret });
    assert.deepEqual(leaks(walk(target)), [], `en la copia de seguridad (cuentas: ${includeAccounts})`);
  }
});

test('B3: la base viva no guarda lo borrado en páginas libres (VACUUM tras migrar)', () => {
  const { t } = setup37();
  const board = new Board();
  assert.equal(board.one('PRAGMA freelist_count').freelist_count, 0);
  board.db.close();
  for (const f of ['orb.db', 'orb.db-wal']) { const p = path.join(datosOf(t), f); if (fs.existsSync(p)) assert.ok(!fs.readFileSync(p, 'latin1').includes('mi secreto'), f); }
});

test('M2: una imagen del dueño con el nombre de otra se renombra (nunca se borra) y el chat que la nombra apunta a su sitio nuevo', () => {
  const { t, ids } = setup37();
  const imgs = path.join(t.home, 'core', 'imagenes');
  fs.writeFileSync(path.join(imgs, 'b.png'), 'otra');
  const old = path.join(imgs, OWNER, 'b.png');
  raw37(t, (db) => db.prepare("INSERT INTO chat (role, body, meta, at, conversation_id, person_id) VALUES ('usuario', ?, ?, ?, ?, ?)").run(`mira ${old}`, JSON.stringify({ images: [old] }), NOW, ids.cDani, OWNER));
  const board = new Board();
  assert.equal(fs.readFileSync(path.join(imgs, 'b.png'), 'utf8'), 'otra');
  const moved = path.join(imgs, 'b (3.7).png');
  assert.equal(fs.readFileSync(moved, 'utf8'), 'x', 'la del dueño, renombrada');
  assert.ok(!fs.existsSync(path.join(imgs, OWNER)));
  const line = board.one('SELECT body, meta FROM chat WHERE body LIKE ?', 'mira %');
  assert.equal(line.body, `mira ${moved}`); assert.deepEqual(JSON.parse(line.meta).images, [moved]);
  board.db.close();
});

test('M3: las copias aisladas y las fotos de las tareas de otros se archivan antes de que Orb las limpie', () => {
  const { t, ids } = setup37();
  const work = path.join(t.home, 'core', 'copias', 'aisladas', 'web-ana-7');
  const put = (p, text = 'x') => { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, text); };
  put(path.join(work, 'cambio.txt'), 'sin commit'); put(path.join(work, 'node_modules', 'pkg', 'index.js'));
  put(path.join(t.home, 'core', 'copias', 'fotos', `t${ids.tAna}-123`, 'antes.txt'), 'foto');
  raw37(t, (db) => db.prepare("UPDATE tasks SET workdir = ?, branch = 'orb/t2-web-ana' WHERE id = ?").run(work, ids.tAna));
  new Board().db.close();
  const ana = archived(t, 'usuarios', `Ana-${ANA}`, 'copias');
  assert.equal(fs.readFileSync(path.join(ana, 'aisladas', 'web-ana-7', 'cambio.txt'), 'utf8'), 'sin commit');
  assert.ok(!fs.existsSync(path.join(ana, 'aisladas', 'web-ana-7', 'node_modules')), 'sin dependencias');
  assert.equal(fs.readFileSync(path.join(ana, 'fotos', `t${ids.tAna}-123`, 'antes.txt'), 'utf8'), 'foto');
  assert.match(fs.readFileSync(archived(t, 'LEEME.txt'), 'utf8'), /Las ramas de sus tareas siguen en sus repositorios: orb\/t2-web-ana/);
});

test('M4: los proyectos de otros compartidos con el dueño o usados por lo suyo pasan a ser del dueño (no se borran ni se ignoran)', () => {
  const { t } = setup37();
  const lib = path.join(t.home, 'web', 'lib-ana'); fs.mkdirSync(lib, { recursive: true });
  raw37(t, (db) => {
    db.prepare("INSERT INTO shares (resource_type, resource_id, person_id, right, created_at) VALUES ('project', 'web-ana', ?, 'edit', ?)").run(OWNER, NOW);
    db.prepare("INSERT INTO projects (name, path, created_at, person_id) VALUES ('lib-ana', ?, ?, ?), ('solo-ana', 'C:/x/solo-ana', ?, ?)").run(lib, NOW, ANA, NOW, ANA);
    db.prepare("INSERT INTO schedules (project, title, description, every, created_at, person_id) VALUES ('lib-ana', 'De Dani en lib', 'd', 'daily', ?, ?)").run(NOW, OWNER);
    db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run(IGNORED_PROJECTS, JSON.stringify([path.join(t.home, 'web', 'ya-no-existe').toLowerCase()]));
  });
  const board = new Board();
  assert.deepEqual(board.all('SELECT name, person_id FROM projects ORDER BY name').map((r) => [r.name, r.person_id]), [['lib-ana', null], ['web-ana', null], ['web-dani', null]]);
  assert.ok(!(board.settingJson(IGNORED_PROJECTS) ?? []).some((k) => k.includes('web-ana') || k.includes('lib-ana')));
  assert.match(fs.readFileSync(archived(t, 'LEEME.txt'), 'utf8'), /Sus proyectos (web-ana, lib-ana|lib-ana, web-ana) ahora son tuyos/);
  syncProjects(board);
  assert.deepEqual(board.projects().map((x) => x.name).sort(), ['lib-ana', 'web-ana', 'web-dani']);
  assert.deepEqual(board.settingJson(IGNORED_PROJECTS), [], 'las carpetas que ya no existen salen de la lista');
  board.db.close();
});

test('M5: una copia previa válida pero desfasada (se volvió a usar 3.7 entre intentos) se rehace', () => {
  const { t } = setup37();
  breakTransaction(t);
  new Board().db.close();
  assert.ok(migrationFailure());
  // Orb 3.7 used again for a while.
  raw37(t, (db) => db.prepare("INSERT INTO conversations (title, titled, created_at, updated_at, person_id) VALUES ('De después', 1, ?, ?, ?)").run(NOW, NOW, OWNER));
  fixTransaction(t);
  const board = new Board();
  assert.equal(migrationFailure(), null);
  const copy = new DatabaseSync(path.join(datosOf(t), PRE_COPY), { readOnly: true });
  assert.equal(copy.prepare("SELECT COUNT(*) AS n FROM conversations WHERE title = 'De después'").get().n, 1, 'la copia tiene lo de después');
  copy.close();
  assert.deepEqual(fs.readdirSync(datosOf(t)).filter((n) => n.includes('intento')), [], 'la vieja se borra al terminar');
  board.db.close();
});

test('M7: 30 días después, las copias de la BD de 3.7 pierden sus claves; «Borrar los datos de Orb 3.7» lo borra todo', () => {
  const { t } = setup37();
  const board = new Board();
  const now = Date.now();
  assert.equal(scrubPreCopies(board.db, { home: t.home, now: now + 86_400_000 }), null, 'aún no');
  assert.equal(scrubPreCopies(board.db, { home: t.home, now: now + SCRUB_AFTER_MS + 60_000 }), 1);
  const copy = new DatabaseSync(path.join(datosOf(t), PRE_COPY), { readOnly: true });
  assert.equal(copy.prepare('SELECT COUNT(*) AS n FROM persons WHERE pin_hash IS NOT NULL').get().n, 0);
  assert.equal(copy.prepare("SELECT COUNT(*) AS n FROM devices WHERE token_hash NOT LIKE 'borrado:%' OR public_key IS NOT NULL").get().n, 0);
  assert.equal(copy.prepare("SELECT COUNT(*) AS n FROM settings WHERE key LIKE 'secret:%' OR key = 'remote_keys' OR key LIKE 'agent_id:%'").get().n, 0);
  assert.equal(copy.prepare('SELECT COUNT(*) AS n FROM bots').get().n, 2, 'el resto se queda');
  assert.equal(copy.prepare('PRAGMA freelist_count').get().freelist_count, 0);
  copy.close();
  assert.ok(!fs.readFileSync(path.join(datosOf(t), PRE_COPY), 'latin1').includes('clave:'), 'ni en páginas libres');
  assert.equal(scrubPreCopies(board.db, { home: t.home, now: now + SCRUB_AFTER_MS * 2 }), null, 'una vez');
  // «Borrar los datos de Orb 3.7»: never while a run is unfinished.
  board.run("INSERT INTO settings (key, value) VALUES ('migrated_3_8_files', '[]')");
  assert.throws(() => deleteLegacyData(board.db, t.home), /todavía/);
  board.run("DELETE FROM settings WHERE key = 'migrated_3_8_files'");
  const found = legacyData(t.home);
  assert.equal(found.archives.length, 1); assert.equal(found.copies.length, 1); assert.ok(found.bytes > 0);
  deleteLegacyData(board.db, t.home);
  assert.deepEqual(legacyData(t.home), { archives: [], copies: [], bytes: 0 });
  assert.ok(!fs.existsSync(archived(t)));
  board.db.close();
});

test('B2: scrub oculta el valor tras una opción de secreto y lo que parece una clave en cualquier texto', () => {
  assert.deepEqual(scrub({ name: 'x', command: 'run sk-abcdefghijk', args: ['--api-key', 'abc', '--port', '80', 'xai-abcdefgh1'], url: 'https://u:p@h/?token=t&a=1', env: { K: 'v' }, person: 'p' }),
    { name: 'x', command: 'run [secreto oculto]', args: ['(oculto)', '(oculto)', '--port', '80', '[secreto oculto]'], url: 'https://(oculto)@h/?token=(oculto)&a=1', ocultos: ['env.K'] });
});

test('M6: la pantalla de bloqueo dice la verdad, abre la carpeta de la copia y ofrece buscar una actualización', () => {
  const s = { failed: true, reason: 'EPERM', backup: 'C:\\Orb\\.orb\\datos\\orb-pre-3.8.db', data: 'C:\\Orb\\.orb\\datos\\orb.db', committed: false };
  assert.equal(folderOf(s.backup), 'C:\\Orb\\.orb\\datos');
  assert.equal(migrationView(s, null).body, 'data.migration38.body');
  assert.equal(migrationView({ ...s, committed: true }, null).body, 'data.migration38.bodyCommitted');
  assert.equal(migrationView(s, null).update, null, 'sin actualizador (desde el código)');
  assert.equal(migrationView(s, { state: 'off' }).update, null);
  assert.equal(migrationView(s, { state: 'idle' }).update.action, 'check');
  assert.equal(migrationView(s, { state: 'none' }).update.none, true);
  assert.equal(migrationView(s, { state: 'checking' }).update.busy, true);
  const available = migrationView(s, { state: 'available', version: '3.8.1' }).update;
  assert.deepEqual([available.action, available.version], ['update', '3.8.1']);
  assert.equal(migrationView(s, { state: 'downloading', percent: 40 }).update.percent, 40);
  assert.equal(migrationView(s, { state: 'downloaded' }).update.action, 'restart');
  assert.equal(migrationView({ ...s, backup: null }, null).folder, 'C:\\Orb\\.orb\\datos', 'sin copia: la carpeta de la base');
});

test('F3b M5: Ajustes › Datos cuenta las copias de antes de la 3.8 (guardan las claves de la 3.7)', async () => {
  const { before38 } = await import('../src/engine/api/data.mjs');
  for (const v of ['3.7.2', '3.7', '2.6.0', '3.0.1']) assert.equal(before38(v), true, v);
  for (const v of ['3.8.0', '3.8.1', '3.10.0', '4.0.0', null, undefined, '', 'x']) assert.equal(before38(v), false, String(v));
});

test('3.8.2 (M6): el móvil dice «El PC necesita atención» cuando el PC responde con ese estado, nunca «sin conexión»', () => {
  const bridge = fs.readFileSync(path.join(ROOT, 'src', 'ui', 'lib', 'web-bridge.js'), 'utf8');
  assert.match(bridge, /res\.status === 503 && typeof data\.attention === 'string'\) throw Object\.assign\(new Error\(await tl\('app\.pcAttentionBody'\)\), \{ attention: data\.attention \}\)/);
  assert.match(bridge, /if \(e\.attention\) return \{ mobile: true, needsSetup: false, offline: true, attention: e\.attention/);
  const main = fs.readFileSync(path.join(ROOT, 'src', 'ui', 'main.jsx'), 'utf8');
  const screen = main.slice(main.indexOf('function PcOffline'), main.indexOf('function MigrationFailed'));
  assert.match(screen, /setAttention\(r\.attention \?\? null\)/, 'sigue reintentando y pasa sola a la app cuando el PC se arregla');
  assert.match(screen, /t\('app\.pcAttentionBody'\)/);
  for (const lang of ['es', 'en']) {
    const text = fs.readFileSync(path.join(ROOT, 'src', 'shared', 'locales', lang, 'app.mjs'), 'utf8');
    for (const k of ['app.pcAttentionTitle', 'app.pcAttentionTitleNamed', 'app.pcAttentionBody']) assert.ok(text.includes(`"${k}"`), `${lang}: ${k}`);
  }
  const engine = fs.readFileSync(path.join(ROOT, 'src', 'engine', 'engine.mjs'), 'utf8');
  assert.match(engine, /await stopAttention\(\);\n {4}await run\(next, info\)/, 'el aviso se cierra antes de abrir el acceso de verdad en el mismo puerto');
});
