// 3.8: the one-time move of a 3.5–3.7 data folder to Orb 3.8, which has no bots, replicas, links between Orbs, Orb
// Terminal, several users, lent accounts or shared projects. Run by db.mjs when this home's database opens (any process).
//   1. A copy of the database as it was (.orb/datos/orb-pre-3.8.db) and a readable archive (.orb/archivo-3.7/): the bots
//      (rows as JSON, their conversations, their folder and trash), each other user's data, the removed settings and the
//      sealed enlaces.json. Nothing is deleted before both are written; if they cannot be, the next start tries again.
//   2. orb.json: the owner's own settings (name, time zone, brain, phone previews) move in; what 3.8 no longer has goes.
//   3. One transaction: the replicas' triggers first, then the bots' and other users' rows, then the tables and indexes,
//      the devices' old columns and the old settings; the owner's rows lose their person (person_id NULL, dropped in 3.9)
//      and the chat-list marks take the fixed key 'owner'. The setting «migrated_3_8» marks it done.
// Idempotent: an interrupted run starts again from the top (the archive is rewritten, folders already moved stay moved).
import fs from 'node:fs';
import path from 'node:path';
import { ctx, validateConfig } from './context.mjs';
import { paths, loadConfig, configFrom, writeJson, BOTS_DIR } from './home.mjs';
import { isValidTz } from './tz.mjs';
import { ME } from './inbox.mjs';

export const MARK = 'migrated_3_8';
export const NOTICE = 'migrated_3_8_notice'; // what the engine logs and tells the owner once (takeNotice)
export const ARCHIVE_DIR = 'archivo-3.7';
export const PRE_COPY = 'orb-pre-3.8.db';

// The tables 3.8 no longer has (their indexes go with them).
const BOT_TABLES = ['bot_group_members', 'bot_groups', 'bot_reminders', 'bot_requests', 'bot_sessions', 'memory_log', 'bots'];
const LINK_TABLES = ['bot_changes', 'replica_cursor', 'bot_moves', 'link_persons', 'link_queue', 'link_seen'];
const USER_TABLES = ['shares', 'account_loans', 'person_settings', 'audit', 'persons'];
export const DROPPED_TABLES = [...BOT_TABLES, ...LINK_TABLES, ...USER_TABLES];
// Indexes of 3.5–3.7 on tables that stay.
const DROPPED_INDEXES = ['chat_uid', 'conversations_bot', 'conversations_person', 'tasks_person', 'sessions_person', 'devices_person'];
// devices: the role of a linked Orb, «Puede administrar», the QR's kind check, answering the bots' cards, «Orb para programar».
const DEVICE_COLUMNS = ['role', 'admin', 'kind_ok', 'approve', 'dev_ok'];
// The tables whose rows had a person (3.6–3.7).
const PERSON_ROWS = ['conversations', 'chat', 'tasks', 'sessions', 'schedules', 'projects', 'events', 'devices', 'messages', 'usage_ledger'];
const OLD_SETTINGS = ['bots_seeded', 'template_applied', 'orb_self', 'home_migrated', 'oce_optimus', 'oce_optimus_uids', 'oce_machines', 'oce_wanted',
  'net_names', 'connections.adb', 'handback_pending', 'hub_handoffs', 'persons_migrated', 'bots_location_asked', 'bots_move', 'secret:ha_token', 'secret:ha_token_url'];
// agent_id: the agents' signatures (the engine makes new ones at every start; 3.7's also named bots and persons).
const OLD_PREFIXES = ['bot_taint:', 'bot_grant:', 'bot_unconfined:', 'bot_held:', 'bot_handoff:', 'ha_allow:', 'oce_alerted:', 'browser_pace:', 'browser_mass:',
  'vault_ok:', 'vault_down:', 'agent_id:'];
// The settings of a person's lists: <name>:<person> in 3.6–3.7 (inbox_since:owner since 3.8, the others without a key).
const LIST_SETTINGS = { inbox_since: `inbox_since:${ME}`, sidebar_completed: 'sidebar_completed', sidebar_kept: 'sidebar_kept' };
const PREVIEWS = ['all', 'chat', 'none'];
// 3.7's bridge with Open Control Edge wrote orb.json in %LOCALAPPDATA%\OrbPuente (oce.json there is OCE's: never touched).
// ORB_BRIDGE_DIR: another folder (the tests never touch the real one).
const bridgeDir = () => process.env.ORB_BRIDGE_DIR || (process.env.LOCALAPPDATA ? path.join(process.env.LOCALAPPDATA, 'OrbPuente') : null);

const has = (db, table) => Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(table));
const cols = (db, table) => (has(db, table) ? db.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name) : []);
const all = (db, sql, ...args) => db.prepare(sql).all(...args).map((r) => ({ ...r }));
const one = (db, sql, ...args) => db.prepare(sql).get(...args);
const marks = (list) => list.map(() => '?').join(', ');
const parse = (v) => { try { return JSON.parse(v); } catch { return v; } };
const slug = (s) => String(s ?? '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[^\w-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'usuario';
const homeTriggers = (db) => db.prepare("SELECT name FROM sqlite_master WHERE type = 'trigger' AND name LIKE 'home\\_%' ESCAPE '\\'").all().map((r) => r.name);

// Whether a database still has anything of 3.5–3.7.
export function isLegacy(db) {
  return DROPPED_TABLES.some((t) => has(db, t)) || homeTriggers(db).length > 0 || cols(db, 'devices').some((c) => DEVICE_COLUMNS.includes(c));
}

// The owner, the other people (also deleted ones and ids of rows nobody owns any more) and the conversations of bots.
function whoIs(db) {
  const owner = has(db, 'persons') ? one(db, "SELECT id FROM persons WHERE role = 'owner' AND deleted_at IS NULL ORDER BY created_at LIMIT 1")?.id ?? null : null;
  const others = new Set(has(db, 'persons') ? all(db, 'SELECT id FROM persons').map((r) => r.id) : []);
  for (const t of PERSON_ROWS) {
    if (!cols(db, t).includes('person_id') || t === 'usage_ledger' || t === 'chat') continue;
    for (const r of all(db, `SELECT DISTINCT person_id FROM ${t} WHERE person_id IS NOT NULL`)) others.add(r.person_id);
  }
  others.delete(owner);
  const c = cols(db, 'conversations');
  const botConvs = c.includes('bot_id') ? all(db, 'SELECT id FROM conversations WHERE bot_id IS NOT NULL OR group_id IS NOT NULL').map((r) => r.id) : [];
  return { owner, others: [...others], botConvs, c };
}

// ---- 1. the archive (written before anything is deleted)
const write = (file, value) => { fs.mkdirSync(path.dirname(file), { recursive: true }); writeJson(file, value); };
// A folder or file moved into the archive (merged when an earlier, interrupted run already moved part of it).
function moveInto(from, to) {
  if (!fs.existsSync(from)) return false;
  fs.mkdirSync(path.dirname(to), { recursive: true });
  if (!fs.existsSync(to)) { try { fs.renameSync(from, to); return true; } catch { /* another drive or in use: copy */ } }
  fs.cpSync(from, to, { recursive: true, force: true });
  fs.rmSync(from, { recursive: true, force: true });
  return true;
}
const rowsOf = (db, table, where = '', ...args) => (has(db, table) ? all(db, `SELECT * FROM ${table} ${where}`, ...args) : []);
const withoutSecrets = (rows) => rows.map(({ token_hash: _t, public_key: _k, push: _p, pin_hash: _h, pin_salt: _s, ...r }) => r);

function archiveBots(db, dir, { botConvs }) {
  const out = path.join(dir, 'bots');
  write(path.join(out, 'bots.json'), rowsOf(db, 'bots'));
  write(path.join(out, 'grupos.json'), rowsOf(db, 'bot_groups').map((g) => ({ ...g, members: rowsOf(db, 'bot_group_members', 'WHERE group_id = ? ORDER BY position', g.id) })));
  write(path.join(out, 'recordatorios.json'), rowsOf(db, 'bot_reminders'));
  write(path.join(out, 'peticiones.json'), rowsOf(db, 'bot_requests'));
  write(path.join(out, 'memorias-historial.json'), rowsOf(db, 'memory_log'));
  write(path.join(out, 'sesiones.json'), rowsOf(db, 'bot_sessions'));
  for (const id of botConvs) write(path.join(out, 'conversaciones', `${id}.json`), { conversation: one(db, 'SELECT * FROM conversations WHERE id = ?', id), chat: all(db, 'SELECT * FROM chat WHERE conversation_id = ? ORDER BY id', id) });
}

// One other user: everything that is theirs, readable (rows as JSON), and their files.
function archivePerson(db, dir, pid, { p, raw }) {
  const person = has(db, 'persons') ? one(db, 'SELECT * FROM persons WHERE id = ?', pid) : null;
  const out = path.join(dir, 'usuarios', `${slug(person?.name)}-${slug(pid)}`);
  const mine = (t) => (cols(db, t).includes('person_id') ? rowsOf(db, t, 'WHERE person_id = ?', pid) : []);
  write(path.join(out, 'usuario.json'), person ? withoutSecrets([{ ...person }])[0] : { id: pid });
  write(path.join(out, 'ajustes.json'), Object.fromEntries(rowsOf(db, 'person_settings', 'WHERE person_id = ?', pid).map((r) => [r.key, parse(r.value)])));
  for (const c of mine('conversations')) write(path.join(out, 'conversaciones', `${c.id}.json`), { conversation: c, chat: all(db, 'SELECT * FROM chat WHERE conversation_id = ? ORDER BY id', c.id) });
  for (const s of mine('sessions')) write(path.join(out, 'sesiones', `${slug(s.id)}.json`), { session: s, items: rowsOf(db, 'session_items', 'WHERE session_id = ? ORDER BY id', s.id) });
  write(path.join(out, 'tareas.json'), mine('tasks').map((t) => ({ ...t, messages: rowsOf(db, 'messages', 'WHERE task_id = ? ORDER BY id', t.id), events: rowsOf(db, 'events', 'WHERE task_id = ? ORDER BY id', t.id) })));
  write(path.join(out, 'proyectos.json'), mine('projects'));
  write(path.join(out, 'programadas.json'), mine('schedules'));
  write(path.join(out, 'dispositivos.json'), withoutSecrets(mine('devices')));
  write(path.join(out, 'uso.json'), mine('usage_ledger'));
  write(path.join(out, 'cuentas.json'), { accounts: (raw.accounts ?? []).filter((a) => a?.person === pid), mcpServers: (raw.mcpServers ?? []).filter((m) => m?.person === pid) });
  const safe = String(pid).replace(/[^\w-]/g, '_');
  moveInto(path.join(p.internal, 'imagenes', safe), path.join(out, 'imagenes'));
  moveInto(path.join(p.internal, 'adjuntos-movil', safe), path.join(out, 'adjuntos-movil'));
  moveInto(path.join(p.internal, 'cuentas', safe), path.join(out, 'cuentas'));
  moveInto(path.join(p.logs, `general-${safe}.md`), path.join(out, 'bitacora-general.md'));
}

// orb.json without what 3.8 no longer has (the removed part is archived), with the owner's own settings.
function nextConfig(raw, { owner, others, ownerSettings, person }) {
  const removed = {};
  const next = { ...raw };
  for (const k of ['bots', 'oce', 'monitor', 'role', 'devTarget']) if (k in next) { removed[k] = next[k]; delete next[k]; }
  if (next.ui && typeof next.ui === 'object' && 'mode' in next.ui) { removed['ui.mode'] = next.ui.mode; next.ui = { ...next.ui }; delete next.ui.mode; }
  if (next.browser && typeof next.browser === 'object' && 'sites' in next.browser) { removed['browser.sites'] = next.browser.sites; next.browser = { ...next.browser }; delete next.browser.sites; }
  // Accounts and connectors: the other users' go (archived with them), the owner's lose their «person».
  for (const k of ['accounts', 'mcpServers']) {
    if (!Array.isArray(next[k])) continue;
    next[k] = next[k].filter((x) => !(x && typeof x === 'object' && x.person && x.person !== owner && others.includes(x.person))).map((x) => {
      if (!x || typeof x !== 'object' || !('person' in x)) return x;
      const { person: _p, ...rest } = x; return rest;
    });
  }
  // The owner's settings of 3.6–3.7 (persons and person_settings) where 3.8 reads them.
  if (person) {
    if (!String(next.userName ?? '').trim() && person.name) next.userName = person.name;
    const tz = ownerSettings.tz ?? person.tz;
    if (!next.tz && isValidTz(tz)) next.tz = tz;
    const language = ownerSettings.language ?? person.language;
    if (!next.language && ['es', 'en'].includes(language)) next.language = language;
  }
  if (PREVIEWS.includes(ownerSettings.preview)) next.mobile = { ...next.mobile, preview: ownerSettings.preview };
  const brain = ownerSettings.brain;
  if (brain && typeof brain === 'object') {
    const o = { ...next.orchestrator };
    for (const k of ['agent', 'model', 'account', 'reasoning']) if (typeof brain[k] === 'string' && brain[k]) o[k] = brain[k];
    if (typeof brain.orchestrate === 'boolean') o.orchestrate = brain.orchestrate;
    next.orchestrator = o;
  }
  return { next, removed };
}

function archiveAll(db, { p, who, raw }) {
  const dir = path.join(p.internal, ARCHIVE_DIR);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'LEEME.txt'), [
    'Orb 3.8 ya no tiene bots, réplicas, enlaces entre Orbs, Orb Terminal ni varios usuarios.',
    'Aquí está lo que había en Orb 3.7, para consultarlo (Orb no lo usa):',
    '- bots/: los bots, grupos, recordatorios, peticiones y el historial de memorias (JSON), sus conversaciones,',
    '  su carpeta (bots/carpeta: memorias y archivos) y su papelera (bots/borrados).',
    '- usuarios/: lo de cada usuario que no era el dueño (conversaciones, tareas, proyectos, dispositivos, uso, archivos).',
    '- tablas/: personas, compartidos, préstamos de cuentas, auditoría y la cola de enlaces.',
    '- orb-json-retirado.json: los ajustes de orb.json que 3.8 ya no usa. enlaces.json: claves de los enlaces (cifradas).',
    `La base de datos completa de antes está en ${path.join(p.data, PRE_COPY)}.`, ''].join('\n'));
  archiveBots(db, dir, who);
  write(path.join(dir, 'tablas', 'personas.json'), withoutSecrets(rowsOf(db, 'persons')));
  write(path.join(dir, 'tablas', 'ajustes-del-dueno.json'), Object.fromEntries((who.owner ? rowsOf(db, 'person_settings', 'WHERE person_id = ?', who.owner) : []).map((r) => [r.key, parse(r.value)])));
  write(path.join(dir, 'tablas', 'compartidos.json'), rowsOf(db, 'shares'));
  write(path.join(dir, 'tablas', 'prestamos.json'), rowsOf(db, 'account_loans'));
  write(path.join(dir, 'tablas', 'auditoria.json'), rowsOf(db, 'audit'));
  write(path.join(dir, 'tablas', 'cola-enlaces.json'), rowsOf(db, 'link_queue'));
  for (const pid of who.others) archivePerson(db, dir, pid, { p, raw });
  // Files of 3.5–3.7: the bots' folder and trash, the deleted users' trash, the sealed keys of the links, the bridge's file.
  moveInto(path.join(p.home, BOTS_DIR), path.join(dir, 'bots', 'carpeta'));
  moveInto(path.join(p.internal, 'bots-borrados'), path.join(dir, 'bots', 'borrados'));
  moveInto(path.join(p.internal, 'personas-borradas'), path.join(dir, 'usuarios', 'borrados'));
  moveInto(path.join(p.data, 'enlaces.json'), path.join(dir, 'enlaces.json'));
  const bridge = bridgeDir(); if (bridge) moveInto(path.join(bridge, 'orb.json'), path.join(dir, 'orb-puente.json'));
  // The owner's own images and phone uploads of 3.6–3.7 (one subfolder per person) go back to where 3.8 keeps them.
  if (who.owner) {
    const safe = String(who.owner).replace(/[^\w-]/g, '_');
    for (const sub of ['imagenes', 'adjuntos-movil']) {
      const from = path.join(p.internal, sub, safe);
      if (!fs.existsSync(from)) continue;
      for (const name of fs.readdirSync(from)) { const to = path.join(p.internal, sub, name); if (!fs.existsSync(to)) moveInto(path.join(from, name), to); }
      fs.rmSync(from, { recursive: true, force: true });
    }
  }
  return dir;
}

// ---- 3. the database (one transaction)
function migrateRows(db, who) {
  const run = (sql, ...args) => db.prepare(sql).run(...args);
  const delSettings = (keys) => { for (const k of keys) run('DELETE FROM settings WHERE key = ?', k); };
  const forConversations = (ids) => {
    for (const id of ids) {
      run('DELETE FROM chat WHERE conversation_id = ?', id);
      delSettings([`pending_questions:${id}`, `report_queue:c${id}`]);
      if (has(db, 'inbox_items')) run("DELETE FROM inbox_items WHERE kind = 'conversation' AND item_id = ?", String(id));
      run('DELETE FROM conversations WHERE id = ?', id);
    }
  };
  // The replicas' triggers before any table they name.
  for (const name of homeTriggers(db)) db.exec(`DROP TRIGGER IF EXISTS "${name}"`);
  // The bots: their conversations, their chats in the lists, the cards' shares.
  forConversations(who.botConvs);
  if (has(db, 'inbox_items')) run("DELETE FROM inbox_items WHERE kind IN ('bot', 'group')");
  if (has(db, 'inbox_sections')) run("DELETE FROM inbox_sections WHERE zone = 'bots'");
  // The other users (already archived).
  if (who.others.length) {
    const ids = who.others; const inOthers = `person_id IN (${marks(ids)})`;
    const own = (t) => cols(db, t).includes('person_id');
    if (own('conversations')) forConversations(all(db, `SELECT id FROM conversations WHERE ${inOthers}`, ...ids).map((r) => r.id));
    if (own('chat')) run(`DELETE FROM chat WHERE ${inOthers}`, ...ids);
    if (own('sessions')) {
      for (const { id } of all(db, `SELECT id FROM sessions WHERE ${inOthers}`, ...ids)) {
        for (const t of ['session_items', 'session_queue']) run(`DELETE FROM ${t} WHERE session_id = ?`, id);
        if (has(db, 'inbox_items')) run("DELETE FROM inbox_items WHERE kind = 'session' AND item_id = ?", id);
        run('DELETE FROM sessions WHERE id = ?', id);
      }
    }
    if (own('tasks')) {
      for (const { id } of all(db, `SELECT id FROM tasks WHERE ${inOthers}`, ...ids)) { run('DELETE FROM messages WHERE task_id = ?', id); run('DELETE FROM events WHERE task_id = ?', id); run('DELETE FROM tasks WHERE id = ?', id); }
    }
    for (const t of ['schedules', 'projects', 'events', 'devices', 'messages']) if (own(t)) run(`DELETE FROM ${t} WHERE ${inOthers}`, ...ids);
    run('DELETE FROM message_reads WHERE message_id NOT IN (SELECT id FROM messages)');
    for (const t of ['inbox_items', 'inbox_sections']) if (has(db, t)) run(`DELETE FROM ${t} WHERE ${inOthers}`, ...ids);
    for (const pid of ids) delSettings(Object.keys(LIST_SETTINGS).map((k) => `${k}:${pid}`));
  }
  // The owner: rows without a person (person_id is dropped in 3.9), the lists' marks and settings under the fixed key.
  for (const t of PERSON_ROWS) if (cols(db, t).includes('person_id')) run(`UPDATE ${t} SET person_id = NULL WHERE person_id IS NOT NULL`);
  if (who.owner) {
    // On a clash with a mark already made by 3.8, the owner's of 3.7 stays.
    if (has(db, 'inbox_items')) run('UPDATE OR REPLACE inbox_items SET person_id = ? WHERE person_id = ?', ME, who.owner);
    if (has(db, 'inbox_sections')) run('UPDATE inbox_sections SET person_id = ? WHERE person_id = ?', ME, who.owner);
    for (const [k, to] of Object.entries(LIST_SETTINGS)) {
      const v = one(db, 'SELECT value FROM settings WHERE key = ?', `${k}:${who.owner}`)?.value;
      if (v != null) run('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)', to, v);
      run('DELETE FROM settings WHERE key = ?', `${k}:${who.owner}`);
    }
  }
  // Devices: the linked Orbs and Orb Terminals, and the columns only they used.
  run("DELETE FROM devices WHERE kind IN ('orb', 'terminal')");
  // The tables and indexes of 3.5–3.7.
  for (const t of DROPPED_TABLES) db.exec(`DROP TABLE IF EXISTS ${t}`);
  for (const i of DROPPED_INDEXES) db.exec(`DROP INDEX IF EXISTS ${i}`);
  for (const c of DEVICE_COLUMNS) if (cols(db, 'devices').includes(c)) db.exec(`ALTER TABLE devices DROP COLUMN ${c}`);
  delSettings(OLD_SETTINGS);
  for (const prefix of OLD_PREFIXES) run('DELETE FROM settings WHERE substr(key, 1, ?) = ?', prefix.length, prefix);
}

// Why the last run in this process could not finish (the data stay as they were; the next start tries again).
let failure = null;
export const migrationFailure = () => failure;
// What was done, once (the engine logs it and tells the owner). → null or { archive, backup, bots, users, conversations }.
export function takeNotice(board) {
  const done = board.settingJson(NOTICE);
  if (done) board.run('DELETE FROM settings WHERE key = ?', NOTICE);
  return done || null;
}

// → null (nothing done) or what was done { archive, backup, bots, users, conversations }. Never throws: a database that
// cannot be copied or archived (no room, a file in use) is left as it was.
export function migrateTo38(db, { home = ctx.home } = {}) {
  try { failure = null; return migrate(db, home); } catch (error) { failure = error?.message ?? String(error); return null; }
}
function migrate(db, home) {
  const state = () => one(db, 'SELECT value FROM settings WHERE key = ?', MARK)?.value;
  if (state()) return null;
  const p = paths(home);
  let raw = null; try { raw = JSON.parse(fs.readFileSync(p.config, 'utf8')); } catch { /* none yet, or not valid: loadConfig says so */ }
  if (!isLegacy(db)) {
    // A new 3.8 database (or one older than 3.5): only orb.json may hold settings of 3.7.
    if (raw && typeof raw === 'object') {
      const { next, removed } = nextConfig(raw, { owner: null, others: [], ownerSettings: {}, person: null });
      if (Object.keys(removed).length) { writeJson(p.config, next); ctx.config = loadConfig(home); }
    }
    db.prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)').run(MARK, '1');
    return null;
  }
  // The copy of the database as it was (never over an earlier one: that is the oldest state).
  const copy = path.join(p.data, PRE_COPY);
  if (!fs.existsSync(copy)) db.prepare('VACUUM INTO ?').run(copy);
  const who = whoIs(db);
  const person = who.owner ? one(db, 'SELECT * FROM persons WHERE id = ?', who.owner) : null;
  const ownerSettings = Object.fromEntries((who.owner && has(db, 'person_settings') ? all(db, 'SELECT key, value FROM person_settings WHERE person_id = ?', who.owner) : []).map((r) => [r.key, parse(r.value)]));
  const archive = archiveAll(db, { p, who, raw: raw ?? {} });
  // orb.json: the owner's brain only when it is valid there (an account that no longer exists keeps Ajustes' brain).
  if (raw && typeof raw === 'object') {
    let { next, removed } = nextConfig(raw, { ...who, ownerSettings, person });
    const valid = (c) => { try { validateConfig(configFrom(c)); return true; } catch { return false; } };
    if (ownerSettings.brain && !valid(next)) {
      const plain = nextConfig(raw, { ...who, ownerSettings: { ...ownerSettings, brain: null }, person });
      if (valid(plain.next)) ({ next, removed } = plain);
    }
    write(path.join(archive, 'orb-json-retirado.json'), removed);
    writeJson(p.config, next);
    ctx.config = loadConfig(home);
  }
  const bots = has(db, 'bots') ? one(db, 'SELECT COUNT(*) AS n FROM bots').n : 0;
  const users = who.others.map((pid) => (has(db, 'persons') ? one(db, 'SELECT name FROM persons WHERE id = ?', pid)?.name : null) ?? pid);
  const activeProject = typeof ownerSettings.active_project === 'string' ? ownerSettings.active_project : null;
  const done = { archive, backup: copy, bots, users, conversations: who.botConvs.length };
  db.exec('BEGIN IMMEDIATE');
  try {
    if (!state()) {
      migrateRows(db, who);
      if (activeProject != null) db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('active_project', ?)").run(activeProject);
      db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run(NOTICE, JSON.stringify(done));
      db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run(MARK, '1');
    }
    db.exec('COMMIT');
  } catch (error) { db.exec('ROLLBACK'); throw error; }
  return done;
}
