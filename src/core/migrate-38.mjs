// 3.8: the one-time move of a 3.5–3.7 data folder to Orb 3.8, which has no bots, replicas, links between Orbs, Orb
// Terminal, several users, lent accounts or shared projects. Run by db.mjs when this home's database opens (any process;
// one at a time: an exclusive transaction on core/datos/migracion-3.8.lock.db, released by the system if the process dies).
//   1. orb.json as it was (core/datos/migracion-3.8/orb-3.7.json, written once: everything else is built from it; never in
//      the archive or a backup, it has other users' keys) and a checked copy of the database (core/datos/orb-pre-3.8.db:
//      VACUUM INTO a .tmp, quick_check, fsync, rename; remade when the database changed since: FINGERPRINT).
//   2. One transaction: the readable archive (core/archivo-3.7/: the bots, each other user's data, the removed settings,
//      orb.json without other users' keys) is written and the files are COPIED into it (nothing is moved or deleted yet);
//      then the replicas' triggers, the bots' and other users' rows, the tables and indexes, the devices' old columns and
//      the old settings go; the owner's rows lose their person (person_id NULL, dropped in 3.9) and the chat-list marks take
//      the fixed key 'owner'. The plan of what to move and delete (FILES), the new orb.json (NEXT_CONFIG) and the mark
//      «migrated_3_8» are saved in the same transaction.
//   3. After the COMMIT, finish(): the plan (originals deleted once their copy is in the archive, the owner's pictures put
//      back without overwriting), orb.json, the database VACUUMed. A process that ends in between goes on at the next
//      start; until it is done Orb does not run (unfinished(): engine.mjs, the MCP).
// A run that fails before the COMMIT leaves the database and every file of 3.7 as they were (the archive and the copy are
// extra) and the next one goes on with the same archive and copy (migracion-3.8.json). A 3.7 database restored later is a
// new run: a dated archive and copy. 30 days after, the copies of the database lose 3.7's secrets (scrubPreCopies); the
// secrets that move into the master password's vault leave the archive and the copies as soon as they are in it
// (scrubVaultedSecrets).
// Nothing is written outside the data folder but the 3.7 bridge's file (insideData).
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { ctx, validateConfig, tr } from './context.mjs';
import { paths, configFrom, writeJson, categoryOf, folderKey, IGNORED_PROJECTS, BOTS_DIR } from './home.mjs';
import { isValidTz } from './tz.mjs';
import { ME } from './inbox.mjs';
import { redactSecrets } from './safety.mjs';
import { isRef, refOf, secretId } from './connector-secrets.mjs';

const { DatabaseSync } = process.getBuiltinModule('node:sqlite');
export const MARK = 'migrated_3_8';
export const NOTICE = 'migrated_3_8_notice'; // what the engine logs and tells the owner once (takeNotice)
const NEXT_CONFIG = 'migrated_3_8_config'; // { next, base, inputs }: the orb.json to write once the transaction is committed
const FILES = 'migrated_3_8_files'; // the plan of files to move and delete after the COMMIT (finish); there while unfinished
export const DONE_AT = 'migrated_3_8_at'; // when; the copies of the database lose their secrets 30 days later
const SCRUBBED = 'migrated_3_8_scrubbed';
export const ARCHIVE_DIR = 'archivo-3.7';
export const PRE_COPY = 'orb-pre-3.8.db';
export const ORIGINAL_CONFIG = 'orb-3.7.json';
export const WORK_DIR = 'migracion-3.8'; // core/datos: orb.json as it was, until finish()
const RUN_FILE = 'migracion-3.8.json'; // core/datos: the archive and copy of the run not finished yet
export const LOCK_FILE = 'migracion-3.8.lock.db';
export const SCRUB_AFTER_MS = 30 * 86_400_000;
// How long a process waits for another one migrating the same folder (ORB_MIGRATION_LOCK_MS: tests).
const lockWait = () => Number(process.env.ORB_MIGRATION_LOCK_MS ?? 60_000);

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
// The owner's rows that name a project (an other user's project they use stays: keptProjects).
const PROJECT_ROWS = ['tasks', 'schedules', 'sessions', 'conversations'];
const OLD_SETTINGS = ['bots_seeded', 'template_applied', 'orb_self', 'home_migrated', 'oce_optimus', 'oce_optimus_uids', 'oce_machines', 'oce_wanted',
  'net_names', 'connections.adb', 'handback_pending', 'hub_handoffs', 'persons_migrated', 'bots_location_asked', 'bots_move', 'secret:ha_token', 'secret:ha_token_url'];
// agent_id: the agents' signatures (the engine makes new ones at every start; 3.7's also named bots and persons).
const OLD_PREFIXES = ['bot_taint:', 'bot_grant:', 'bot_unconfined:', 'bot_held:', 'bot_handoff:', 'ha_allow:', 'oce_alerted:', 'browser_pace:', 'browser_mass:',
  'vault_ok:', 'vault_down:', 'agent_id:'];
// A task's own settings (<prefix><id>), gone with the other users' tasks (archived with them).
const TASK_SETTINGS = ['accepted:', 'budget_ok:', 'integrate:', 'quiet_notice:', 'checkpoint:', 'undone:', 'review:'];
// The settings of a person's lists: <name>:<person> in 3.6–3.7 (inbox_since:owner since 3.8, the others without a key).
const LIST_SETTINGS = { inbox_since: `inbox_since:${ME}`, sidebar_completed: 'sidebar_completed', sidebar_kept: 'sidebar_kept' };
const PREVIEWS = ['all', 'chat', 'none'];
// What is not copied from another user's isolated copy (dependencies and build output).
const NO_COPY = new Set(['node_modules', '.git', '.venv', '__pycache__', 'dist', 'build', '.next', '.cache']);
// 3.7's bridge with Open Control Edge wrote orb.json in %LOCALAPPDATA%\OrbPuente (oce.json there is OCE's: never touched).
// ORB_BRIDGE_DIR: another folder, only for the tests. A test without it never touches this PC's (node --test sets
// NODE_TEST_CONTEXT in every test process, and the processes they start inherit it).
export const bridgeDir = () => {
  if (process.env.ORB_BRIDGE_DIR) return process.env.ORB_BRIDGE_DIR;
  if (process.env.NODE_TEST_CONTEXT) return null;
  return process.env.LOCALAPPDATA ? path.join(process.env.LOCALAPPDATA, 'OrbPuente') : null;
};

const has = (db, table) => Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(table));
const cols = (db, table) => (has(db, table) ? db.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name) : []);
const all = (db, sql, ...args) => db.prepare(sql).all(...args).map((r) => ({ ...r }));
const one = (db, sql, ...args) => db.prepare(sql).get(...args);
const marks = (list) => list.map(() => '?').join(', ');
const parse = (v) => { try { return JSON.parse(v); } catch { return v; } };
const slug = (s) => String(s ?? '').normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^\w-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'usuario';
const safeId = (id) => String(id).replace(/[^\w-]/g, '_');
const homeTriggers = (db) => db.prepare("SELECT name FROM sqlite_master WHERE type = 'trigger' AND name LIKE 'home\\_%' ESCAPE '\\'").all().map((r) => r.name);
const tables = (db) => db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name").all().map((r) => r.name);
const userError = (message) => Object.assign(new Error(message), { userFacing: true });
const setting = (db, key) => one(db, 'SELECT value FROM settings WHERE key = ?', key)?.value;
const inside = (root, target) => { const r = path.relative(path.resolve(root), path.resolve(target)); return Boolean(r) && !r.startsWith('..') && !path.isAbsolute(r); };
const sha = (text) => crypto.createHash('sha256').update(text).digest('hex');

// Whether a database still has anything of 3.5–3.7.
export function isLegacy(db) {
  return DROPPED_TABLES.some((t) => has(db, t)) || homeTriggers(db).length > 0 || cols(db, 'devices').some((c) => DEVICE_COLUMNS.includes(c));
}
// Whether Orb may not run on this database yet: still 3.7, or committed but its files and orb.json not done (finish()).
export function unfinished(db) {
  return isLegacy(db) || setting(db, FILES) != null || setting(db, NEXT_CONFIG) != null;
}

// Whether the migration may write a path: inside the data folder (home), or 3.7's bridge file.
export function insideData(home, target) {
  if (inside(home, target)) return true;
  const bridge = bridgeDir();
  return Boolean(bridge) && path.resolve(target) === path.resolve(bridge, 'orb.json');
}

// ---- the owner and the others
// The owner of 3.6–3.7: the active owner; else a deleted owner; else the oldest active person allowed to administer;
// else the only person there is. Other people's rows and none of these: the migration stops (nothing is deleted).
function ownerOf(db) {
  if (!has(db, 'persons')) return null;
  const pick = (sql) => one(db, sql)?.id ?? null;
  const caps = cols(db, 'persons').includes('caps');
  return pick("SELECT id FROM persons WHERE role = 'owner' AND deleted_at IS NULL ORDER BY created_at LIMIT 1")
    ?? pick("SELECT id FROM persons WHERE role = 'owner' ORDER BY created_at LIMIT 1")
    ?? (caps ? pick("SELECT id FROM persons WHERE deleted_at IS NULL AND (CASE WHEN json_valid(caps) THEN json_extract(caps, '$.admin') END) = 1 ORDER BY created_at LIMIT 1") : null)
    ?? (one(db, 'SELECT COUNT(*) AS n FROM persons').n === 1 ? pick('SELECT id FROM persons') : null);
}

// The other users' projects the owner keeps (they become the owner's): shared with the owner, or named by the owner's
// tasks, schedules, sessions or conversations. → names.
function keptProjects(db, owner, others) {
  if (!others.length || !cols(db, 'projects').includes('person_id')) return [];
  const theirs = all(db, `SELECT name FROM projects WHERE person_id IN (${marks(others)})`, ...others).map((r) => r.name);
  const mine = (t) => (cols(db, t).includes('person_id') ? '(person_id IS NULL OR person_id = ?)' : '1 = 1');
  return theirs.filter((name) => {
    if (has(db, 'shares') && one(db, "SELECT 1 FROM shares WHERE resource_type = 'project' AND resource_id = ? COLLATE NOCASE AND person_id = ?", name, owner)) return true;
    return PROJECT_ROWS.some((t) => cols(db, t).includes('project') && one(db, `SELECT 1 FROM ${t} WHERE project = ? COLLATE NOCASE AND ${mine(t)} LIMIT 1`, name, ...(cols(db, t).includes('person_id') ? [owner] : [])));
  });
}

// The owner, the other people (also deleted ones and ids of rows nobody owns any more), the conversations of bots and the
// other users' projects the owner keeps.
function whoIs(db) {
  const owner = ownerOf(db);
  const others = new Set(has(db, 'persons') ? all(db, 'SELECT id FROM persons').map((r) => r.id) : []);
  for (const t of PERSON_ROWS) {
    if (!cols(db, t).includes('person_id')) continue;
    for (const r of all(db, `SELECT DISTINCT person_id FROM ${t} WHERE person_id IS NOT NULL`)) others.add(r.person_id);
  }
  others.delete(owner);
  if (!owner && others.size) throw userError(tr('data.migration38.noOwner'));
  const c = cols(db, 'conversations');
  const botConvs = c.includes('bot_id') ? all(db, 'SELECT id FROM conversations WHERE bot_id IS NOT NULL OR group_id IS NOT NULL').map((r) => r.id) : [];
  return { owner, others: [...others], botConvs, kept: keptProjects(db, owner, [...others]) };
}

// ---- files: only inside the data folder (insideData). Before the COMMIT they are only copied into the archive (copy) and
// what to do with the originals goes into the plan; finish() runs it (run).
function fileOps(home) {
  const guard = (target) => { if (!insideData(home, target)) throw new Error(`3.8: ${target} está fuera de la carpeta de datos`); return target; };
  const write = (file, value) => { guard(file); fs.mkdirSync(path.dirname(file), { recursive: true }); writeJson(file, value); };
  const remove = (target) => { guard(target); fs.rmSync(target, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); };
  const copy = (from, to, filter = null) => {
    guard(to);
    if (!fs.existsSync(from)) return false;
    fs.mkdirSync(path.dirname(to), { recursive: true });
    fs.cpSync(from, to, { recursive: true, force: true, ...(filter ? { filter } : {}) });
    return true;
  };
  // A free name next to `to` for a file of the owner that would overwrite another one: «b (3.7).png», «b (3.7 2).png».
  const freeName = (to, taken = new Set()) => {
    const ext = path.extname(to); const stem = to.slice(0, to.length - ext.length);
    for (let i = 1; ; i++) { const f = `${stem} (3.7${i > 1 ? ` ${i}` : ''})${ext}`; if (!fs.existsSync(f) && !taken.has(f.toLowerCase())) return f; }
  };
  const moveFile = (from, to) => { fs.mkdirSync(path.dirname(to), { recursive: true }); try { fs.renameSync(from, to); } catch { fs.cpSync(from, to, { recursive: true }); remove(from); } };
  // One step of the plan; each one can run again (a process that ended in the middle).
  const run = (step) => {
    if (step.op === 'move') { // archived before the COMMIT; the original goes (copied again first if the copy is missing)
      if (!fs.existsSync(step.from)) return;
      if (!fs.existsSync(step.to)) copy(step.from, step.to);
      remove(step.from);
    } else if (step.op === 'remove') remove(step.path);
    else if (step.op === 'place') { // the owner's file back where 3.8 keeps it, never over another one
      if (!fs.existsSync(guard(step.from))) return;
      moveFile(step.from, fs.existsSync(guard(step.to)) ? freeName(step.to) : step.to);
    } else if (step.op === 'rmdir') { try { fs.rmdirSync(guard(step.path)); } catch { /* not empty, or gone: kept */ } }
  };
  return { guard, write, remove, copy, freeName, run };
}

// ---- the run: its archive folder and copy (dated names when an earlier migration's are there: a 3.7 copy restored later)
const stamp = () => new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
const runFile = (p) => path.join(p.data, RUN_FILE);
function runOf(p, ops) {
  try {
    const r = JSON.parse(fs.readFileSync(runFile(p), 'utf8'));
    if (typeof r?.archive === 'string' && typeof r?.copy === 'string' && !/[\\/]/.test(r.archive + r.copy)) return r;
  } catch { /* a new run */ }
  const free = (dir, base, ext = '') => {
    if (!fs.existsSync(path.join(dir, base + ext))) return base + ext;
    for (let i = 1; ; i++) { const name = `${base}-${stamp()}${i > 1 ? `-${i}` : ''}${ext}`; if (!fs.existsSync(path.join(dir, name))) return name; }
  };
  const run = { archive: free(p.internal, ARCHIVE_DIR), copy: free(p.data, PRE_COPY.replace(/\.db$/, ''), '.db'), started: new Date().toISOString() };
  ops.write(runFile(p), run);
  return run;
}
// A restored database starts a new run (backup.mjs): its own copy of orb.json too.
export function forgetRun(home) {
  for (const f of [runFile(paths(home)), path.join(paths(home).data, WORK_DIR)]) { try { fs.rmSync(f, { recursive: true, force: true }); } catch { /* none */ } }
}

// ---- one process at a time (the engine, an MCP server started by an agent, a second window): an exclusive transaction
// on a database of its own. The system releases it when the process ends, however it ends.
function lock(p) {
  fs.mkdirSync(p.data, { recursive: true });
  const db = new DatabaseSync(path.join(p.data, LOCK_FILE));
  try {
    db.exec(`PRAGMA busy_timeout = ${Math.max(0, Math.floor(lockWait()))}`);
    db.exec('BEGIN EXCLUSIVE');
  } catch (error) {
    try { db.close(); } catch { /* closed */ }
    throw /locked|busy/i.test(error?.message ?? '') ? userError(tr('data.migration38.busy')) : error;
  }
  return () => { try { db.exec('ROLLBACK'); } catch { /* none */ } try { db.close(); } catch { /* closed */ } };
}

// ---- 1. the copy of the database, checked before anything is deleted
function checkCopy(file, expected) {
  if (!fs.existsSync(file) || fs.statSync(file).size === 0) return false;
  let db = null;
  try {
    db = new DatabaseSync(file, { readOnly: true });
    if (db.prepare('PRAGMA quick_check').get()?.quick_check !== 'ok') return false;
    const names = tables(db);
    return expected.every((t) => names.includes(t));
  } catch { return false; } finally { try { db?.close(); } catch { /* closed */ } }
}
// What the database holds, cheaply: its tables, how many rows (and the last rowid) of each one, and the settings. A copy
// made before 3.7 was used again (a failed run, then weeks of 3.7, then 3.8 again) does not match and is made again.
export function fingerprint(db) {
  const h = crypto.createHash('sha256');
  for (const t of tables(db)) {
    if (t.startsWith('sqlite_')) continue;
    h.update(`${t}:${one(db, `SELECT COUNT(*) AS n FROM "${t}"`).n}`);
    try { h.update(`:${one(db, `SELECT MAX(rowid) AS m FROM "${t}"`).m}`); } catch { /* WITHOUT ROWID */ }
    h.update('\n');
  }
  if (has(db, 'settings')) for (const r of all(db, 'SELECT key, value FROM settings ORDER BY key')) h.update(`${r.key}=${r.value}\n`);
  return h.digest('hex');
}
const fsync = (file) => { const fd = fs.openSync(file, 'r+'); try { fs.fsyncSync(fd); } finally { fs.closeSync(fd); } };
// → the run, with the copy's fingerprint and the outdated copies of earlier attempts (deleted once the run is done).
function preCopy(db, p, run, ops) {
  const file = path.join(p.data, run.copy);
  const expected = tables(db);
  const print = fingerprint(db);
  if (fs.existsSync(file)) {
    if (run.print === print && checkCopy(file, expected)) return run;
    // Not trusted (empty, cut) or outdated: kept aside until the run is done, never deleted now.
    const bad = checkCopy(file, expected) ? `${file.replace(/\.db$/, '')}-intento-${stamp()}.db` : `${file}.roto-${stamp()}`;
    fs.renameSync(file, ops.guard(bad));
    if (bad.endsWith('.db')) run = { ...run, stale: [...(run.stale ?? []), path.basename(bad)] };
  }
  const tmp = `${file}.tmp`;
  ops.remove(tmp);
  try {
    db.prepare('VACUUM INTO ?').run(ops.guard(tmp));
    fsync(tmp);
    if (!checkCopy(tmp, expected)) throw new Error('quick_check');
    fs.renameSync(tmp, file);
  } catch (error) {
    ops.remove(tmp);
    throw userError(tr('data.migration38.badCopy', { error: error?.message ?? String(error) }));
  }
  run = { ...run, print };
  ops.write(runFile(p), run);
  return run;
}

// ---- 2. the archive (inside the transaction: nobody else writes meanwhile)
const rowsOf = (db, table, where = '', ...args) => (has(db, table) ? all(db, `SELECT * FROM ${table} ${where}`, ...args) : []);
const withoutSecrets = (rows) => rows.map(({ token_hash: _t, public_key: _k, push: _p, pin_hash: _h, pin_salt: _s, ...r }) => r);
// An account or connector of another user without what could open it: keys, tokens, the connectors' environment and
// headers (by name), a value after an option that names a secret («--api-key sk-…»), and anything that looks like a key
// wherever it is (a command, a URL with a password or ?api_key=…).
const SECRET = /key|token|secret|pass|auth|cookie|env|header|credential/i;
const hideValue = (s) => redactSecrets(s)
  .replace(/(\/\/)[^/@\s]+@/g, '$1(oculto)@')
  .replace(/([?&][^=&\s]*(?:key|token|secret|pass|auth|sig)[^=&\s]*=)[^&\s]+/gi, '$1(oculto)');
const deepHide = (v) => (typeof v === 'string' ? hideValue(v) : Array.isArray(v) ? v.map(deepHide) : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, deepHide(x)])) : v);
export function scrub(x) {
  if (!x || typeof x !== 'object') return x;
  const out = {}; const hidden = [];
  for (const [k, v] of Object.entries(x)) {
    if (k === 'person') continue;
    if (SECRET.test(k)) { hidden.push(...(v && typeof v === 'object' && !Array.isArray(v) ? Object.keys(v).map((n) => `${k}.${n}`) : [k])); continue; }
    out[k] = k === 'args' && Array.isArray(v)
      ? v.map((a, i) => (SECRET.test(String(a)) || (i > 0 && /^-/.test(String(v[i - 1])) && !String(v[i - 1]).includes('=') && SECRET.test(String(v[i - 1]))) ? '(oculto)' : deepHide(a)))
      : deepHide(v);
  }
  if (hidden.length) out.ocultos = hidden;
  return out;
}
// orb.json for the archive: other users' (and unknown people's) accounts and connectors without their keys.
const cleanConfig = (raw, owner) => {
  const out = { ...raw };
  for (const k of ['accounts', 'mcpServers']) if (Array.isArray(out[k])) out[k] = out[k].map((x) => (x && typeof x === 'object' && x.person && x.person !== owner ? { ...scrub(x), person: x.person } : x));
  return out;
};

function archiveBots(db, dir, { botConvs }, ops) {
  const out = path.join(dir, 'bots');
  ops.write(path.join(out, 'bots.json'), rowsOf(db, 'bots'));
  ops.write(path.join(out, 'grupos.json'), rowsOf(db, 'bot_groups').map((g) => ({ ...g, members: rowsOf(db, 'bot_group_members', 'WHERE group_id = ? ORDER BY position', g.id) })));
  ops.write(path.join(out, 'recordatorios.json'), rowsOf(db, 'bot_reminders'));
  ops.write(path.join(out, 'peticiones.json'), rowsOf(db, 'bot_requests'));
  ops.write(path.join(out, 'memorias-historial.json'), rowsOf(db, 'memory_log'));
  ops.write(path.join(out, 'sesiones.json'), rowsOf(db, 'bot_sessions'));
  for (const id of botConvs) ops.write(path.join(out, 'conversaciones', `${id}.json`), { conversation: one(db, 'SELECT * FROM conversations WHERE id = ?', id), chat: all(db, 'SELECT * FROM chat WHERE conversation_id = ? ORDER BY id', id) });
}

// A file or folder copied into the archive now; the original goes after the COMMIT.
const archiveFile = (from, to, { ops, plan }) => { if (ops.copy(from, to)) plan.push({ op: 'move', from, to }); };

// One other user: everything that is theirs, readable (rows as JSON), and their files. Their sign-in folders are deleted.
function archivePerson(db, dir, pid, { p, raw, who, ops, plan }) {
  const person = has(db, 'persons') ? one(db, 'SELECT * FROM persons WHERE id = ?', pid) : null;
  const out = path.join(dir, 'usuarios', `${slug(person?.name)}-${slug(pid)}`);
  const mine = (t) => (cols(db, t).includes('person_id') ? rowsOf(db, t, 'WHERE person_id = ?', pid) : []);
  ops.write(path.join(out, 'usuario.json'), person ? withoutSecrets([{ ...person }])[0] : { id: pid });
  ops.write(path.join(out, 'ajustes.json'), Object.fromEntries(rowsOf(db, 'person_settings', 'WHERE person_id = ?', pid).map((r) => [r.key, parse(r.value)])));
  const convs = mine('conversations');
  for (const c of convs) ops.write(path.join(out, 'conversaciones', `${c.id}.json`), { conversation: c, chat: all(db, 'SELECT * FROM chat WHERE conversation_id = ? ORDER BY id', c.id) });
  // Their lines elsewhere (notices without a conversation, lines in someone else's conversation).
  const own = new Set(convs.map((c) => c.id));
  ops.write(path.join(out, 'chat-suelto.json'), mine('chat').filter((l) => !own.has(l.conversation_id)));
  const sessions = mine('sessions');
  for (const s of sessions) ops.write(path.join(out, 'sesiones', `${slug(s.id)}.json`), { session: s, items: rowsOf(db, 'session_items', 'WHERE session_id = ? ORDER BY id', s.id) });
  const tasks = mine('tasks');
  const taskSettings = (id) => Object.fromEntries(TASK_SETTINGS.map((k) => [k.slice(0, -1), setting(db, `${k}${id}`)]).filter(([, v]) => v != null).map(([k, v]) => [k, parse(v)]));
  ops.write(path.join(out, 'tareas.json'), tasks.map((t) => ({ ...t, messages: rowsOf(db, 'messages', 'WHERE task_id = ? ORDER BY id', t.id), events: rowsOf(db, 'events', 'WHERE task_id = ? ORDER BY id', t.id), settings: taskSettings(t.id) })));
  const projects = mine('projects');
  ops.write(path.join(out, 'proyectos.json'), projects);
  ops.write(path.join(out, 'programadas.json'), mine('schedules'));
  ops.write(path.join(out, 'dispositivos.json'), withoutSecrets(mine('devices')));
  ops.write(path.join(out, 'uso.json'), mine('usage_ledger'));
  const accounts = (raw.accounts ?? []).filter((a) => a?.person === pid);
  ops.write(path.join(out, 'cuentas.json'), { accounts: accounts.map(scrub), mcpServers: (raw.mcpServers ?? []).filter((m) => m?.person === pid).map(scrub) });
  const safe = safeId(pid);
  const ctxFiles = { ops, plan };
  archiveFile(path.join(p.internal, 'imagenes', safe), path.join(out, 'imagenes'), ctxFiles);
  archiveFile(path.join(p.internal, 'adjuntos-movil', safe), path.join(out, 'adjuntos-movil'), ctxFiles);
  archiveFile(path.join(p.logs, `general-${safe}.md`), path.join(out, 'bitacora-general.md'), ctxFiles);
  // The logs (registro*.jsonl) of their tasks' and direct conversations' runs go with them; the rest of those folders
  // (MCP configurations, scratch files) and their coordinator's folder of 3.7 (<runs>/personas/<id>) are deleted.
  const runs = [...tasks.map((t) => [path.join(p.runs, String(t.id)), path.join(out, 'ejecuciones', 'tareas', String(t.id))]),
    ...sessions.filter((s) => s.kind !== 'task').map((s) => [path.join(p.runs, 'conversaciones', s.id), path.join(out, 'ejecuciones', 'conversaciones', slug(s.id))])];
  for (const [from, to] of runs) {
    if (!fs.existsSync(from) || !fs.statSync(from).isDirectory()) continue;
    for (const name of fs.readdirSync(from)) if (/^registro.*\.jsonl$/.test(name)) archiveFile(path.join(from, name), path.join(to, name), ctxFiles);
    plan.push({ op: 'remove', path: from });
  }
  plan.push({ op: 'remove', path: path.join(p.runs, 'personas', safe) });
  // Their tasks' isolated copies (work not committed yet) and undo checkpoints: copied (without dependencies or build
  // output); Orb clears the originals at its next start (scheduler.mjs › pruneCopies, pruneCheckpoints).
  const branches = [];
  for (const t of tasks) {
    if (t.branch) branches.push(t.branch);
    if (typeof t.workdir === 'string' && inside(p.worktrees, t.workdir) && fs.existsSync(t.workdir)) {
      ops.copy(t.workdir, path.join(out, 'copias', 'aisladas', path.basename(t.workdir)), (src) => !NO_COPY.has(path.basename(src)) || path.resolve(src) === path.resolve(t.workdir));
    }
    let shots = []; try { shots = fs.readdirSync(p.checkpoints).filter((n) => new RegExp(`^t${Number(t.id)}-\\d+$`).test(n)); } catch { /* none */ }
    for (const n of shots) ops.copy(path.join(p.checkpoints, n), path.join(out, 'copias', 'fotos', n));
  }
  // Their sign-in folders are never kept (they sign in again in their own Orb): Orb's folder for them, and an account's
  // own folder when it is inside Orb's accounts folder and no account of the owner uses it.
  plan.push({ op: 'remove', path: path.join(p.internal, 'cuentas', safe) });
  const kept = new Set((raw.accounts ?? []).filter((a) => a?.person == null || a.person === who.owner).map((a) => a?.home && path.resolve(a.home)).filter(Boolean));
  for (const a of accounts) {
    if (typeof a?.home !== 'string' || !a.home || kept.has(path.resolve(a.home))) continue;
    if (inside(path.join(p.internal, 'cuentas'), a.home)) plan.push({ op: 'remove', path: path.resolve(a.home) });
  }
  return { name: person?.name ?? null, projects, branches };
}

// orb.json without what 3.8 no longer has (the removed part is archived), with the owner's own settings.
function nextConfig(raw, { owner, ownerSettings, person }) {
  const removed = {};
  const next = { ...raw };
  for (const k of ['bots', 'oce', 'monitor', 'role', 'devTarget']) if (k in next) { removed[k] = next[k]; delete next[k]; }
  if (next.ui && typeof next.ui === 'object' && 'mode' in next.ui) { removed['ui.mode'] = next.ui.mode; next.ui = { ...next.ui }; delete next.ui.mode; }
  if (next.browser && typeof next.browser === 'object' && 'sites' in next.browser) { removed['browser.sites'] = next.browser.sites; next.browser = { ...next.browser }; delete next.browser.sites; }
  // Accounts and connectors: anyone else's go (archived with them, or as an unknown user's), the owner's lose «person».
  for (const k of ['accounts', 'mcpServers']) {
    if (!Array.isArray(next[k])) continue;
    next[k] = next[k].filter((x) => !(x && typeof x === 'object' && x.person && x.person !== owner)).map((x) => {
      if (!x || typeof x !== 'object' || !('person' in x)) return x;
      const { person: _p, ...rest } = x; return rest;
    });
  }
  // The owner's settings of 3.6–3.7 (persons and person_settings) where 3.8 reads them. The language of person_settings
  // is the one 3.7 used; the name and the zone only fill what orb.json lacks.
  if (person) {
    if (!String(next.userName ?? '').trim() && person.name) next.userName = person.name;
    const tz = ownerSettings.tz ?? person.tz;
    if (!next.tz && isValidTz(tz)) next.tz = tz;
    if (['es', 'en'].includes(ownerSettings.language)) next.language = ownerSettings.language;
    else if (!next.language && ['es', 'en'].includes(person.language)) next.language = person.language;
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
// The owner's brain only when it is valid there (an account that no longer exists keeps Ajustes' brain).
function buildNext(raw, inputs) {
  const valid = (c) => { try { validateConfig(configFrom(c)); return true; } catch { return false; } };
  let made = nextConfig(raw, inputs);
  if (inputs.ownerSettings.brain && !valid(made.next)) { const plain = nextConfig(raw, { ...inputs, ownerSettings: { ...inputs.ownerSettings, brain: null } }); if (valid(plain.next)) made = plain; }
  return made;
}

// The owner's own images and phone uploads of 3.6–3.7 (one subfolder per person) go back to where 3.8 keeps them, renamed
// when another file has that name (never deleted). → { old path: new path } (chat lines that name them are updated).
function placeOwnerFiles(p, owner, { ops, plan }) {
  const moved = {};
  const safe = safeId(owner);
  for (const sub of ['imagenes', 'adjuntos-movil']) {
    const from = path.join(p.internal, sub, safe);
    if (!fs.existsSync(from) || !fs.statSync(from).isDirectory()) continue;
    const taken = new Set();
    for (const name of fs.readdirSync(from)) {
      let to = path.join(p.internal, sub, name);
      if (fs.existsSync(to) || taken.has(to.toLowerCase())) to = ops.freeName(to, taken);
      taken.add(to.toLowerCase());
      plan.push({ op: 'place', from: path.join(from, name), to });
      moved[path.join(from, name)] = to;
    }
    plan.push({ op: 'rmdir', path: from });
  }
  return moved;
}

// → { ignored: folders (folderKey) of the other users' projects in the categories, moved: the owner's files placed }.
function archiveAll(db, { p, dir, copy, who, raw, ops, plan }) {
  archiveBots(db, dir, who, ops);
  ops.write(path.join(dir, 'tablas', 'personas.json'), withoutSecrets(rowsOf(db, 'persons')));
  ops.write(path.join(dir, 'tablas', 'ajustes-del-dueno.json'), Object.fromEntries((who.owner ? rowsOf(db, 'person_settings', 'WHERE person_id = ?', who.owner) : []).map((r) => [r.key, parse(r.value)])));
  ops.write(path.join(dir, 'tablas', 'compartidos.json'), rowsOf(db, 'shares'));
  ops.write(path.join(dir, 'tablas', 'prestamos.json'), rowsOf(db, 'account_loans'));
  ops.write(path.join(dir, 'tablas', 'auditoria.json'), rowsOf(db, 'audit'));
  ops.write(path.join(dir, 'tablas', 'cola-enlaces.json'), rowsOf(db, 'link_queue'));
  if (raw) ops.write(path.join(dir, ORIGINAL_CONFIG), cleanConfig(raw, who.owner));
  const people = who.others.map((pid) => archivePerson(db, dir, pid, { p, raw: raw ?? {}, who, ops, plan }));
  // Accounts and connectors of a person this database does not know (never given to the owner).
  const known = new Set([who.owner, ...who.others]);
  const lost = (k) => (Array.isArray(raw?.[k]) ? raw[k] : []).filter((x) => x && typeof x === 'object' && x.person && !known.has(x.person)).map((x) => ({ ...scrub(x), person: x.person }));
  if (lost('accounts').length || lost('mcpServers').length) ops.write(path.join(dir, 'usuarios', 'desconocido', 'cuentas.json'), { accounts: lost('accounts'), mcpServers: lost('mcpServers') });
  // Files of 3.5–3.7: the bots' folder and trash, the deleted users' trash, the sealed keys of the links, the bridge's file.
  const f = { ops, plan };
  archiveFile(path.join(p.home, BOTS_DIR), path.join(dir, 'bots', 'carpeta'), f);
  archiveFile(path.join(p.internal, 'bots-borrados'), path.join(dir, 'bots', 'borrados'), f);
  archiveFile(path.join(p.internal, 'personas-borradas'), path.join(dir, 'usuarios', 'borrados'), f);
  archiveFile(path.join(p.data, 'enlaces.json'), path.join(dir, 'enlaces.json'), f);
  const bridge = bridgeDir(); if (bridge) archiveFile(path.join(bridge, 'orb.json'), path.join(dir, 'orb-puente.json'), f);
  // The owner's files of 3.6–3.7 back in place; the owner's coordinator folder of 3.7 (<runs>/personas/<id>) is scratch.
  let moved = {};
  if (who.owner) {
    moved = placeOwnerFiles(p, who.owner, f);
    plan.push({ op: 'remove', path: path.join(p.runs, 'personas', safeId(who.owner)) });
  }
  const ignored = []; const lines = [];
  const kept = new Set(who.kept.map((n) => n.toLowerCase()));
  for (const x of people) {
    const name = x.name ?? 'Un usuario sin nombre';
    lines.push(`- ${name} tendrá que volver a iniciar sesión en su propio Orb: aquí se han borrado sus sesiones (de sus cuentas solo queda el nombre).`);
    const mineNow = x.projects.filter((pr) => kept.has(String(pr.name).toLowerCase()));
    if (mineNow.length) lines.push(`  Sus proyectos ${mineNow.map((pr) => pr.name).join(', ')} ahora son tuyos: estaban compartidos contigo o los usan tus tareas, programadas o conversaciones.`);
    const folders = x.projects.filter((pr) => !kept.has(String(pr.name).toLowerCase()) && typeof pr.path === 'string' && categoryOf(p.home, pr.path));
    for (const pr of folders) ignored.push(folderKey(pr.path));
    if (folders.length) lines.push(`  Las carpetas de ${name} siguen en ${folders.map((pr) => path.relative(p.home, pr.path)).join(', ')}; Orb no las lista (Proyectos › Añadir las vuelve a listar).`);
    if (x.branches.length) lines.push(`  Las ramas de sus tareas siguen en sus repositorios: ${[...new Set(x.branches)].join(', ')}. Sus copias aisladas (lo que no estaba en commits) están en su carpeta, en copias/.`);
  }
  fs.writeFileSync(ops.guard(path.join(dir, 'LEEME.txt')), [
    'Orb 3.8 ya no tiene bots, réplicas, enlaces entre Orbs, Orb Terminal ni varios usuarios.',
    'Aquí está lo que había en Orb 3.7, para consultarlo (Orb no lo usa):',
    '- bots/: los bots, grupos, recordatorios, peticiones y el historial de memorias (JSON), sus conversaciones,',
    '  su carpeta (bots/carpeta: memorias y archivos) y su papelera (bots/borrados).',
    '- usuarios/: lo de cada usuario que no era el dueño (conversaciones, mensajes sueltos, tareas y sus registros,',
    '  copias aisladas y fotos de sus tareas, proyectos, programadas, dispositivos, gasto, archivos y el nombre de sus',
    '  cuentas, sin claves).',
    '- tablas/: personas, compartidos, préstamos de cuentas, auditoría y la cola de enlaces.',
    `- ${ORIGINAL_CONFIG}: orb.json tal como estaba, sin las claves de los otros usuarios. orb-json-retirado.json: los ajustes que 3.8 ya no usa.`,
    '- enlaces.json: claves de los enlaces (cifradas).',
    ...lines,
    `La base de datos completa de antes está en ${copy}.`,
    'Puedes borrar todo esto en Ajustes › Datos › Borrar los datos de Orb 3.7.', ''].join('\n'));
  return { ignored, moved };
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
  // The other users (already archived), their spending too (in their uso.json: it is not the owner's). The projects the
  // owner keeps stay (keptProjects).
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
      for (const { id } of all(db, `SELECT id FROM tasks WHERE ${inOthers}`, ...ids)) {
        run('DELETE FROM messages WHERE task_id = ?', id); run('DELETE FROM events WHERE task_id = ?', id);
        delSettings(TASK_SETTINGS.map((k) => `${k}${id}`));
        run('DELETE FROM tasks WHERE id = ?', id);
      }
    }
    if (own('projects')) run(`DELETE FROM projects WHERE ${inOthers}${who.kept.length ? ` AND name NOT IN (${marks(who.kept)})` : ''}`, ...ids, ...who.kept);
    for (const t of ['schedules', 'events', 'devices', 'messages', 'usage_ledger']) if (own(t)) run(`DELETE FROM ${t} WHERE ${inOthers}`, ...ids);
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
      const v = setting(db, `${k}:${who.owner}`);
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

// The chat lines and session items that name a file of the owner put back elsewhere (placeOwnerFiles) name its new place.
function renameReferences(db, moved, owner) {
  const pairs = Object.entries(moved).flatMap(([from, to]) => [[from, to], [JSON.stringify(from).slice(1, -1), JSON.stringify(to).slice(1, -1)]]);
  if (!pairs.length) return;
  const like = `%${safeId(owner)}%`;
  const fix = (s) => (typeof s === 'string' ? pairs.reduce((out, [a, b]) => out.split(a).join(b), s) : s);
  for (const [table, fields] of [['chat', ['body', 'meta']], ['session_items', ['body']]]) {
    const have = fields.filter((f) => cols(db, table).includes(f));
    if (!have.length) continue;
    for (const row of all(db, `SELECT id, ${have.join(', ')} FROM ${table} WHERE ${have.map((f) => `${f} LIKE ?`).join(' OR ')}`, ...have.map(() => like))) {
      const next = have.map((f) => fix(row[f]));
      if (next.some((v, i) => v !== row[have[i]])) db.prepare(`UPDATE ${table} SET ${have.map((f) => `${f} = ?`).join(', ')} WHERE id = ?`).run(...next, row.id);
    }
  }
}

// Why the last run in this process could not finish, and where its copy is: null or { reason, backup, committed }. Orb
// does not work on the data until a run finishes (engine.mjs); committed: the database is already 3.8's (going back to
// 3.7 would need the copy).
let failure = null;
export const migrationFailure = () => failure;
// What was done, once (the engine logs it and tells the owner). → null or { archive, backup, bots, users, conversations, haToken }.
export function takeNotice(board) {
  const done = board.settingJson(NOTICE);
  if (done) board.run('DELETE FROM settings WHERE key = ?', NOTICE);
  return done || null;
}

// → null (nothing done) or what was done { archive, backup, bots, users, conversations, haToken }. Never throws: a
// database that cannot be copied or archived (no room, a file in use, no owner) is left as it was, one whose files or
// orb.json could not be finished stays unfinished(), and migrationFailure() says why.
export function migrateTo38(db, { home = ctx.home } = {}) {
  try { failure = null; return migrate(db, home); } catch (error) {
    let backup = null;
    try { const r = JSON.parse(fs.readFileSync(runFile(paths(home)), 'utf8')); const f = path.join(paths(home).data, r.copy); if (fs.existsSync(f)) backup = f; } catch { /* no copy yet */ }
    let committed = false; try { committed = Boolean(setting(db, MARK)); } catch { /* closed */ }
    failure = { reason: error?.message ?? String(error), backup, committed };
    return null;
  }
}

// After the COMMIT (or at the next start, if the process ended in between): the files' plan, orb.json, then the run is
// over and the database is compacted (what was deleted no longer sits in its free pages).
function finish(db, home) {
  const p = paths(home);
  const ops = fileOps(home);
  const planned = setting(db, FILES);
  const plan = parse(planned ?? '[]');
  for (const step of Array.isArray(plan) ? plan : []) ops.run(step);
  const pending = setting(db, NEXT_CONFIG);
  if (pending) writeConfig(p, parse(pending), home);
  forgetRun(home);
  db.prepare('DELETE FROM settings WHERE key IN (?, ?)').run(FILES, NEXT_CONFIG);
  if (planned != null) {
    try { db.exec('VACUUM'); db.exec('PRAGMA wal_checkpoint(TRUNCATE)'); } catch { /* another connection reading: next time it is compacted anyway */ }
  }
}
// The new orb.json, never over changes made after it was planned: written when orb.json is still the one it came from,
// nothing when it is already there, and made again from the file as it is now otherwise. A file that cannot be written
// leaves the run unfinished (the engine does not start on 3.7's configuration); its temporary file never stays.
function writeConfig(p, { next, base, inputs }, home) {
  let text = null; try { text = fs.readFileSync(p.config, 'utf8'); } catch { /* none */ }
  let target = next;
  if (text != null && sha(text) !== base) {
    let now = null; try { now = JSON.parse(text); } catch { /* broken by hand */ }
    if (!now || typeof now !== 'object' || Array.isArray(now)) throw userError(tr('data.migration38.badConfig', { error: 'JSON' }));
    target = isDeepStrictEqual(now, next) ? null : buildNext(now, inputs).next;
  }
  if (!target) return;
  if (ctx.home && path.resolve(home) === path.resolve(ctx.home)) ctx.config = configFrom(target); // never 3.7's, even if the file fails
  try { writeJson(p.config, target); } catch (error) { throw userError(tr('data.migration38.badConfig', { error: error?.code ?? error?.message ?? String(error) })); }
}

function migrate(db, home) {
  const p = paths(home);
  const state = () => setting(db, MARK);
  const pendingWork = () => setting(db, FILES) != null || setting(db, NEXT_CONFIG) != null;
  if (state() && !pendingWork()) return null;
  if (!state() && !isLegacy(db)) {
    // A new 3.8 database (or one older than 3.5): only orb.json may hold settings of 3.7.
    let raw = null; try { raw = JSON.parse(fs.readFileSync(p.config, 'utf8')); } catch { /* none yet, or not valid: loadConfig says so */ }
    if (raw && typeof raw === 'object') {
      const { next, removed } = nextConfig(raw, { owner: null, ownerSettings: {}, person: null });
      if (Object.keys(removed).length) { writeJson(p.config, next); ctx.config = configFrom(next); }
    }
    db.prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)').run(MARK, '1');
    return null;
  }
  const release = lock(p);
  try {
    if (state()) { if (pendingWork()) finish(db, home); return null; } // committed: this or another process goes on
    const ops = fileOps(home);
    let run = runOf(p, ops);
    const dir = path.join(p.internal, run.archive);
    const copy = path.join(p.data, run.copy);
    fs.mkdirSync(ops.guard(dir), { recursive: true });
    // orb.json as it was, once, kept out of the archive and the backups (it has other users' keys): what is archived and
    // the new orb.json come from this file.
    const original = path.join(p.data, WORK_DIR, ORIGINAL_CONFIG);
    if (!fs.existsSync(original) && fs.existsSync(p.config)) {
      fs.mkdirSync(path.dirname(original), { recursive: true });
      const tmp = ops.guard(`${original}.tmp`); fs.copyFileSync(p.config, tmp); fs.renameSync(tmp, original);
    }
    let text = null; try { text = fs.readFileSync(original, 'utf8'); } catch { /* no orb.json */ }
    let raw = null; try { raw = JSON.parse(text); } catch { /* not valid: left alone */ }
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) raw = null;
    run = preCopy(db, p, run, ops);
    let done = null;
    db.exec('BEGIN IMMEDIATE');
    try {
      const who = whoIs(db);
      const person = who.owner ? one(db, 'SELECT * FROM persons WHERE id = ?', who.owner) : null;
      const settingsOf = Object.fromEntries((who.owner && has(db, 'person_settings') ? all(db, 'SELECT key, value FROM person_settings WHERE person_id = ?', who.owner) : []).map((r) => [r.key, parse(r.value)]));
      const plan = [];
      const { ignored, moved } = archiveAll(db, { p, dir, copy, who, raw, ops, plan });
      // What the new orb.json is made of (kept with it: made again if orb.json changes before it is written).
      const inputs = { owner: who.owner, ownerSettings: Object.fromEntries(['tz', 'language', 'preview', 'brain'].filter((k) => k in settingsOf).map((k) => [k, settingsOf[k]])),
        person: person ? { name: person.name ?? null, tz: person.tz ?? null, language: person.language ?? null } : null };
      let next = null;
      if (raw) {
        const made = buildNext(raw, inputs);
        ops.write(path.join(dir, 'orb-json-retirado.json'), made.removed);
        next = made.next;
      }
      const bots = has(db, 'bots') ? one(db, 'SELECT COUNT(*) AS n FROM bots').n : 0;
      const users = who.others.map((pid) => (has(db, 'persons') ? one(db, 'SELECT name FROM persons WHERE id = ?', pid)?.name : null) ?? pid);
      done = { archive: dir, backup: copy, bots, users, conversations: who.botConvs.length, haToken: Boolean(setting(db, 'secret:ha_token')) };
      if (who.owner) renameReferences(db, moved, who.owner);
      migrateRows(db, who);
      const set = (k, v) => db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run(k, v);
      // 3.7 kept the owner's working folder in settings: person_settings' only when that one is empty.
      if (typeof settingsOf.active_project === 'string' && !setting(db, 'active_project')) set('active_project', settingsOf.active_project);
      if (ignored.length) { const before = parse(setting(db, IGNORED_PROJECTS) ?? '[]'); set(IGNORED_PROJECTS, JSON.stringify([...new Set([...(Array.isArray(before) ? before : []), ...ignored])])); }
      // Copies of earlier attempts that were outdated (preCopy) go once the run is done.
      for (const name of run.stale ?? []) plan.push({ op: 'remove', path: path.join(p.data, name) });
      set(FILES, JSON.stringify(plan));
      if (next) set(NEXT_CONFIG, JSON.stringify({ next, base: sha(text), inputs }));
      set(NOTICE, JSON.stringify(done));
      set(DONE_AT, new Date().toISOString());
      db.prepare('DELETE FROM settings WHERE key = ?').run(SCRUBBED);
      set(MARK, '1');
      db.exec('COMMIT');
    } catch (error) { try { db.exec('ROLLBACK'); } catch { /* not open */ } throw error; }
    finish(db, home);
    return done;
  } finally {
    release();
    // Done: no process needs the lock any more.
    if (state() && !pendingWork()) { try { fs.rmSync(path.join(p.data, LOCK_FILE), { force: true }); } catch { /* another process still has it open */ } }
  }
}

// ---- the data of 3.7 kept after the migration
// The archives (core/archivo-3.7*) and the copies of the database (core/datos/orb-pre-3.8*). → { archives, copies, bytes }.
export function legacyData(home) {
  const p = paths(home);
  const list = (dir, test) => { try { return fs.readdirSync(dir).filter(test).map((n) => path.join(dir, n)); } catch { return []; } };
  const archives = list(p.internal, (n) => n === ARCHIVE_DIR || n.startsWith(`${ARCHIVE_DIR}-`));
  const copies = list(p.data, (n) => n.startsWith(PRE_COPY.replace(/\.db$/, '')));
  const size = (f) => { try { const st = fs.statSync(f); if (!st.isDirectory()) return st.size; return fs.readdirSync(f).reduce((s, n) => s + size(path.join(f, n)), 0); } catch { return 0; } };
  return { archives, copies, bytes: [...archives, ...copies].reduce((s, f) => s + size(f), 0) };
}
// «Borrar los datos de Orb 3.7» (Ajustes › Datos): never while a run is not done. → what was deleted.
export function deleteLegacyData(db, home) {
  if (unfinished(db) || fs.existsSync(runFile(paths(home)))) throw userError(tr('data.migration38.legacyBusy'));
  const ops = fileOps(home);
  const found = legacyData(home);
  for (const f of [...found.archives, ...found.copies]) ops.remove(f);
  return found;
}

// 30 days after a migration that went well, the copies of the database keep everything but 3.7's secrets: PIN hashes, the
// devices' keys, Home Assistant's token, the phone access's keys and the agents' signatures; then VACUUM, so they are
// not left in free pages. → null (not yet, or done before) or how many copies were cleaned.
export function scrubPreCopies(db, { home = ctx.home, now = Date.now() } = {}) {
  const at = Date.parse(setting(db, DONE_AT) ?? '');
  if (!Number.isFinite(at) || setting(db, SCRUBBED) || unfinished(db) || now - at < SCRUB_AFTER_MS) return null;
  const files = legacyData(home).copies.filter((f) => f.endsWith('.db'));
  for (const file of files) {
    const copy = new DatabaseSync(file);
    try {
      copy.exec('PRAGMA busy_timeout = 5000');
      const c = (t) => cols(copy, t);
      if (c('persons').includes('pin_hash')) copy.exec(`UPDATE persons SET pin_hash = NULL${c('persons').includes('pin_salt') ? ', pin_salt = NULL' : ''}`);
      if (c('devices').includes('token_hash')) copy.exec(`UPDATE devices SET token_hash = 'borrado:' || id${['public_key', 'push'].filter((k) => c('devices').includes(k)).map((k) => `, ${k} = NULL`).join('')}`);
      if (has(copy, 'settings')) copy.exec("DELETE FROM settings WHERE key LIKE 'secret:%' OR key = 'remote_keys' OR key LIKE 'agent_id:%' OR key LIKE 'orchestrator_%'");
      copy.exec('VACUUM');
    } finally { copy.close(); }
  }
  db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run(SCRUBBED, new Date(now).toISOString());
  return files.length;
}

// 3.8, with the master password: what is in the vault (src/core/master.mjs) does not stay in clear anywhere else. The
// owner's connectors' keys in the archived orb.json (archivo-3.7*/orb-3.7.json) become references, and the phones' keys
// (remote_keys) leave the copies of the database (secure_delete and VACUUM, so no free page keeps them), right after
// they are in the vault rather than 30 days later. inVault(id): whether the vault holds that secret. → files changed.
export function scrubVaultedSecrets(home, { inVault = () => false } = {}) {
  const p = paths(home);
  let n = 0;
  const { archives, copies } = legacyData(home);
  for (const dir of archives) {
    const file = path.join(dir, ORIGINAL_CONFIG);
    let raw; try { raw = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { continue; }
    let changed = false;
    for (const s of Array.isArray(raw?.mcpServers) ? raw.mcpServers : []) {
      if (!s || typeof s !== 'object' || !s.env || typeof s.env !== 'object') continue;
      for (const [k, v] of Object.entries(s.env)) if (!isRef(v) && inVault(secretId(s.name, k))) { s.env[k] = refOf(s.name, k); changed = true; }
    }
    if (changed) { writeJson(file, raw); n++; }
  }
  if (inVault('remote_keys')) {
    for (const file of copies.filter((f) => f.endsWith('.db') && path.dirname(f) === p.data)) {
      let copy; try { copy = new DatabaseSync(file); } catch { continue; }
      try {
        copy.exec('PRAGMA busy_timeout = 5000');
        if (!has(copy, 'settings') || !copy.prepare("SELECT 1 FROM settings WHERE key = 'remote_keys'").get()) continue;
        copy.exec('PRAGMA secure_delete = ON');
        copy.exec("DELETE FROM settings WHERE key = 'remote_keys'");
        copy.exec('VACUUM');
        n++;
      } catch { /* busy: the next start */ } finally { copy.close(); }
    }
  }
  return n;
}
