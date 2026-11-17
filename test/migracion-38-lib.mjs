// Shared fixtures of the 3.8 migration tests (a 3.7 database and its folders), split from migracion-38*.test.mjs so each file fits the per-file timeout.
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
export const homes = [];
export const schema = (v) => fs.readFileSync(path.join(ROOT, 'test', 'fixtures', `esquema-${v}.sql`), 'utf8');
export const NOW = '2026-10-01T10:00:00.000Z';
export const OWNER = 'p-dani'; export const ANA = 'p-ana';

// A realistic 3.7 database: an owner (Dani) and a second user (Ana), bots, a group, reminders, replicas, the links' queue,
// devices of every kind, a loan, shares, chat-list marks; written by 3.7's own schema, triggers on.
export function build37(file, pc, { home = null, language = null } = {}) {
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
export function files37(t, ids = {}) {
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

export const names = (board, type) => board.all('SELECT name FROM sqlite_master WHERE type = ?', type).map((r) => r.name);
export const archived = (t, ...p) => path.join(t.home, 'core', ARCHIVE_DIR, ...p);
export const readJson = (f) => JSON.parse(fs.readFileSync(f, 'utf8'));
// The same workspace as Orb 3.7 had it: .orb, orb.json, bitacora and mcp-servers at the top (src/domain/workspace/core-folder.mjs
// moves them into core when the engine starts, before the 3.8 migration of the database).
export function asOrb37(home) {
  const core = path.join(home, 'core');
  fs.renameSync(path.join(core, 'orb.json'), path.join(home, 'orb.json'));
  fs.renameSync(path.join(core, 'bitacora'), path.join(home, 'bitacora'));
  fs.renameSync(path.join(core, 'mcp'), path.join(home, 'mcp-servers'));
  fs.renameSync(core, path.join(home, '.orb'));
}

// ---- F2.5b: the review of the migration (orb-3.8-revision-F2.5.md)
export const dbFile = (t) => path.join(t.home, 'core', 'datos', 'orb.db');
export const datosOf = (t) => path.join(t.home, 'core', 'datos');
export const raw37 = (t, fn) => { const db = new DatabaseSync(dbFile(t)); try { db.exec('PRAGMA busy_timeout = 5000'); return fn(db); } finally { db.close(); } };
export function setup37(opts = {}) {
  const t = tempHome(); homes.push(t);
  const r = build37(dbFile(t), C.newKeyPair(), { home: t.home, ...opts });
  files37(t, r.ids);
  useHome(t.home);
  return { t, ...r };
}
export const own = (board) => board.all('SELECT title FROM conversations WHERE bot_id IS NULL AND group_id IS NULL ORDER BY id').map((r) => r.title);
// A transaction that cannot finish (as with a full disk): a view on a column the migration drops.
export const breakTransaction = (t) => raw37(t, (db) => db.exec('CREATE VIEW ve_role AS SELECT role FROM devices'));
export const fixTransaction = (t) => raw37(t, (db) => db.exec('DROP VIEW ve_role'));

// The files of 3.7 a run moves or deletes once committed (each one, as files37 makes it).
export const files37Of = (t) => [path.join(t.home, 'bots', 'personas', OWNER, 'memoria-global.md'), path.join(t.home, 'core', 'bots-borrados', 'viejo', 'memoria.md'),
  path.join(t.home, 'core', 'datos', 'enlaces.json'), path.join(process.env.ORB_BRIDGE_DIR, 'orb.json'), path.join(t.home, 'core', 'imagenes', ANA, 'a.png'),
  path.join(t.home, 'core', 'imagenes', OWNER, 'b.png'), path.join(t.home, 'core', 'cuentas', ANA, 'claude-ana', 'credenciales.json'),
  path.join(t.home, 'core', 'cuentas', 'claude-ana', '.credentials.json'), path.join(t.home, 'core', 'ejecuciones', 'personas', ANA, 'nota.md'),
  path.join(t.home, 'core', 'ejecuciones', 'personas', OWNER, 'nota.md'), path.join(t.home, 'core', 'bitacora', `general-${ANA}.md`)];
