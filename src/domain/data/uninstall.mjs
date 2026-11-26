// «Desinstalar Orb» and «Restablecer Orb» (Ajustes › Datos): what is deleted is computed first as a plan (planUninstall), the
// window shows that plan as it is, and runPlan carries out exactly that plan, step by step, with a journal on disk so a cut
// can be finished or reported at the next start.
//
// Rules that never bend:
//  - Every path must be inside what Orb itself owns (classify): core, this workspace's key files and replicas in the app's data
//    folder, this Orb's backup files (checked by the orbId in their header), and project folders that carry BOTH marks (the
//    database token and the .orb-creada file). Anything else is skipped, never deleted.
//  - A link or a junction is never followed: as a target it is refused; inside a tree it is removed as a link.
//  - The folder the user chose for the backups is never removed, only this Orb's backup files in it.
//  - Order: projects to the Recycle Bin, data, the vault and its replica, the PC's key last (and only if nothing encrypted stays).
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { paths, homeKey, oldHomeKey, categoryOf, CATEGORIES, writeJson, isHome } from '../../platform/paths.mjs';
import { DEFAULT_CONFIG, merge } from '../../platform/config-file.mjs';
import { git, REF_PREFIX, BRANCH_PREFIX } from '../../platform/git.mjs';
import { BOXES, normalizeKeep, keepsKey } from '../../shared/uninstall-boxes.mjs';
import { isRef } from '../security/connector-secrets.mjs';
import { marked } from '../projects/created-marks.mjs';
import { ARCHIVE_DIR } from './legacy/migrate-38.mjs';
import * as K from './backup.mjs';
import { lstatOrNull, plainChain, sizeOf, removeTree, removeIfEmpty, isUnder, isSameOrUnder, keyOf } from './safe-delete.mjs';

export const JOURNAL_FILE = 'desinstalando.json';
export const MARK_FILE = 'desinstalado.json';
export const RESET_MARK = 'restablecido';
export const KEPT_PROJECTS = 'proyectos-conservados.json';

// The rows of the projects Orb made (with their token), read from a database that is not open. → [] when there is none.
export function projectsMadeByOrb(file) {
  if (!lstatOrNull(file)) return [];
  try {
    const { DatabaseSync } = process.getBuiltinModule('node:sqlite');
    const db = new DatabaseSync(file, { readOnly: true });
    try { return db.prepare('SELECT name, path, notes, grupo, created_at, created_by_orb FROM projects WHERE created_by_orb IS NOT NULL').all().map((r) => ({ ...r })); } finally { db.close(); }
  } catch { return []; }
}
// At the start of a core made fresh: those rows go back into the new database, still marked (the folders still hold their
// .orb-creada file), and the note goes. A row whose token is not a token, or whose folder is not in a category, is not taken.
export function importKeptProjects(home, board) {
  const file = path.join(paths(home).core, KEPT_PROJECTS);
  let list; try { list = JSON.parse(fs.readFileSync(file, 'utf8')).projects; } catch { return 0; }
  let n = 0;
  for (const r of Array.isArray(list) ? list : []) {
    if (typeof r?.name !== 'string' || typeof r?.path !== 'string' || !marked(r.path, r.created_by_orb) || !categoryOf(home, r.path)) continue;
    board.run('INSERT OR IGNORE INTO projects (name, path, notes, grupo, created_at, created_by_orb) VALUES (?, ?, ?, ?, ?, ?)', r.name, r.path, String(r.notes ?? ''), r.grupo ?? null, String(r.created_at ?? new Date().toISOString()), r.created_by_orb);
    n++;
  }
  fs.rmSync(file, { force: true });
  return n;
}
// A folder bigger than this may not fit in the Recycle Bin: it is listed apart, and only goes if the user says so.
export const TRASH_LIMIT = 4 * 1024 ** 3;

// ---- what each thing inside core belongs to
const SETTINGS_CORE = new Set(['orb.json', 'normas', 'skills', 'mcp', 'preparacion', 'cuentas', 'keybindings.json', 'carpetas.json', 'herramientas', 'iconos']);
const SETTINGS_DATA = new Set(['android', 'adb-huellas.json', 'ffmpeg-huellas.json']);
// This PC's key and every old form of it (src-tauri/vault/src/machine.rs › load): the sealed key and its asides, the plain one,
// Orb 3.8.0's, the lock, the «clave nueva / anterior» signals and the recovery wrap of the backups.
export const KEY_NAME = /^(clave2?\.(enc|bin|lock)|clave2?\.[^\\/]+\.enc|clave-(anterior|volver|nueva)\.json|copia-clave\.json)$/i;
const DB_NAME = /^orb\.db(-wal|-shm|-journal)?$/i;
// Which box a direct child of core\datos belongs to (the key and the database are handled apart).
const dataBox = (name) => (name === 'orb-id.json' ? 'backups' : name === 'enlaces.json' ? 'link' : SETTINGS_DATA.has(name) ? 'settings' : 'chats');
// Which box a direct child of core belongs to; null: core\datos, handled by dataBox.
export function coreBox(name) {
  const n = String(name).toLowerCase();
  if (n === 'datos') return null;
  if (SETTINGS_CORE.has(n)) return 'settings';
  if (n === 'bitacora') return 'journals';
  if (n === 'secretos') return 'vault';
  if (n === 'copias-seguridad') return 'backups';
  // ejecuciones, copias, imagenes, descargas, adjuntos-movil, restaurar-pendiente, antes-de-restaurar-*, anterior-*, the 3.7 archives…
  return 'chats';
}
// The tables of orb.db by box: a table not named here is a chats table (an older database's leftovers go with them).
const LINK_TABLES = ['devices', 'mobile_notes'];
const KEEP_TABLES = ['projects', 'settings', ...LINK_TABLES];
// The rows of `settings` (a mixed bag of per-chat state, project lists and flags) that stay: the migration flags always, the
// lists of finished and ignored projects with the projects, everything but the link's and the backups' with the chats.
const FLAG_KEYS = new Set(['conversations_migrated', 'notices_migrated']);
export function keepSetting(key, keep) {
  if (FLAG_KEYS.has(key)) return true;
  if (key === 'projects_ignored' || key === 'projects_finished') return keep.projects === true;
  if (key === 'projects_deleting') return false;
  if (!keep.chats) return false;
  if (!keep.link && /^(remote_keys|relink_)/.test(key)) return false;
  if (!keep.backups && /^backup_/.test(key)) return false;
  return true;
}

// The workspace seen by this code: every path is derived from here (tests pass temporary folders).
// backupDirs: where this workspace's copies may be (the default folder, the chosen one, the ones noted in ultima.json); a
// resumed run passes the list its journal kept, since ultima.json may be gone by then.
// signKey: this PC's key (a Buffer) that signs the journal; without it a journal can be written but never trusted.
export function uninstallEnv({ home, userData, config = {}, backupDirs = null, signKey = null }) {
  const realHome = (() => { try { return fs.realpathSync.native(home); } catch { return path.resolve(home); } })();
  return { home: path.resolve(home), realHome, userData: path.resolve(userData), config, p: paths(home), signKey, backupDirs: backupDirs ?? K.knownBackupDirs(home, config) };
}
const keyNames = (env) => [...new Set([homeKey(env.home), oldHomeKey(env.home)])];
const clavesDir = (env) => path.join(env.userData, 'claves');

// What a path is, if it is something this code may delete: 'core' (inside core), 'key' (a key file in claves), 'replica' (the
// vault's copy in claves), 'location' (a file of the app's data folder), 'backup' (a .orbbak), 'last' (ultima.json),
// 'backupdir' (this workspace's default backups folder, only when empty), 'category' / 'home' (only when empty).
export function classify(env, target) {
  if (typeof target !== 'string' || !path.isAbsolute(target) || /^[\\/]{2}/.test(target)) return null;
  const t = path.resolve(target);
  const underHome = (root) => isUnder(root, t);
  if (underHome(env.p.core)) return plainChain(env.realHome, rebase(env, t)) ? 'core' : null;
  const claves = clavesDir(env);
  if (path.dirname(keyOf(t)) === keyOf(claves) && plainChain(env.userData, t)) {
    const name = path.basename(t);
    for (const k of keyNames(env)) {
      if (name === `${k}-secretos`) return 'replica';
      if (name === `${k}.enc` || name === `${k}.v2.enc` || (name.startsWith(`${k}.`) && name.endsWith('.enc'))) return 'key';
    }
    return null;
  }
  if (path.dirname(keyOf(t)) === keyOf(env.userData) && ['ubicacion.json', MARK_FILE, JOURNAL_FILE].includes(path.basename(t)) && plainChain(env.userData, t)) return 'location';
  if (keyOf(t) === keyOf(clavesDir(env))) return 'claves';
  if (t.toLowerCase().endsWith(K.EXT)) {
    const dir = path.dirname(t);
    const where = path.basename(dir).startsWith('antes-de-empezar-de-nuevo-') ? path.dirname(dir) : dir;
    return env.backupDirs.some((d) => keyOf(d) === keyOf(where)) ? 'backup' : null;
  }
  const def = K.defaultBackupDir(env.home);
  if (isSameOrUnder(def, t) && path.basename(t) === 'ultima.json' && path.dirname(keyOf(t)) === keyOf(def)) return 'last';
  if (keyNames(env).some((k) => keyOf(t) === keyOf(path.join(K.backupRoot(), k)))) return 'backupdir';
  if (CATEGORIES.some((c) => keyOf(t) === keyOf(path.join(env.home, c)))) return 'category';
  if (keyOf(t) === keyOf(env.home)) return 'home';
  return null;
}
// A path of the workspace seen through its real path (so a junction above the workspace does not matter, one below does).
const rebase = (env, t) => path.join(env.realHome, path.relative(env.home, t));

// A project row Orb itself made: both marks agree, and the folder is <home>\<category>\<name> (never deeper, never outside).
export function ownedProject(env, row) {
  const folder = typeof row?.path === 'string' ? row.path : '';
  if (!folder || !path.isAbsolute(folder) || /^[\\/]{2}/.test(folder)) return { ok: false, why: 'outside' };
  if (!isUnder(env.home, folder)) return { ok: false, why: 'outside' };
  const parts = path.relative(env.home, path.resolve(folder)).split(/[\\/]/);
  if (parts.length !== 2 || !categoryOf(env.home, folder)) return { ok: false, why: 'depth' };
  if (!plainChain(env.realHome, rebase(env, path.resolve(folder)))) return { ok: false, why: 'link' };
  const st = lstatOrNull(folder);
  if (!st?.isDirectory()) return { ok: false, why: 'missing' };
  if (!marked(folder, row.created_by_orb)) return { ok: false, why: 'unmarked' };
  return { ok: true };
}

// ---- the plan
const STAGES = ['projects', 'data', 'vault', 'key', 'end'];
const gitBranches = (repo) => {
  const r = git(repo, 'for-each-ref', '--format=%(refname)', `refs/heads/${BRANCH_PREFIX}/chat-*`, REF_PREFIX);
  return r.status === 0 ? r.stdout.split(/\r?\n/).map((s) => s.trim()).filter(Boolean) : [];
};
// Isolated copies (a chat's or a task's) that hold changes not joined to the project: listed so the user knows they go.
function dirtyCopies(env, projects) {
  const out = [];
  for (const root of [env.p.chatTrees, env.p.worktrees]) {
    let names; try { names = fs.readdirSync(root, { withFileTypes: true }); } catch { continue; }
    for (const e of names) {
      if (!e.isDirectory() || out.length >= 50) continue;
      const dir = path.join(root, e.name);
      if (!lstatOrNull(path.join(dir, '.git'))) continue;
      const st = git(dir, 'status', '--porcelain=v1', '-uno');
      const un = git(dir, 'status', '--porcelain=v1', '--untracked-files=normal');
      if (st.status === 0 && un.status === 0 && !st.stdout.trim() && !un.stdout.trim()) continue;
      const common = git(dir, 'rev-parse', '--path-format=absolute', '--git-common-dir');
      const repo = common.status === 0 ? path.dirname(common.stdout.trim()) : '';
      const project = projects.find((p) => repo && keyOf(p.path) === keyOf(repo))?.name ?? null;
      out.push({ dir, project });
    }
  }
  return out;
}

const childrenOf = (dir) => { try { return fs.readdirSync(dir); } catch { return []; } };

// mode: 'uninstall' | 'reset'. keep: { box: boolean }. projects: the board's rows. devices: how many phones are linked.
// forever: names of the projects the user agreed to delete for good (too big for the Recycle Bin).
// → { id, mode, keep, forced, copyFirst, items, boxes, trash, keptProjects, dirty, keyKept, wipeDb, facts }
export async function planUninstall({ env, mode = 'uninstall', keep = {}, copyFirst = false, projects = [], devices = 0, forever = [], trashLimit = TRASH_LIMIT }) {
  const mcpKeys = (env.config?.mcpServers ?? []).some((s) => s?.env && Object.values(s.env).some((v) => isRef(v)));
  const { keep: k, forced } = normalizeKeep(keep, { mode, mcpKeys, copyFirst });
  const items = [];
  let n = 0;
  const add = (item) => { items.push({ id: `i${++n}`, ...item }); };
  // what is left alone and why (a link or a junction, or a path outside what Orb owns), so the window can say it
  const skipped = [];
  const addPath = (stage, box, p, extra = {}) => {
    const st = lstatOrNull(p); if (!st) return;
    if (!classify(env, p) || st.isSymbolicLink()) { skipped.push({ box, path: p, why: st.isSymbolicLink() ? 'link' : 'outside' }); return; }
    const s = sizeOf(p);
    add({ stage, kind: 'path', box, path: p, bytes: s.bytes, files: s.files, ...extra });
  };
  const core = env.p.core;
  const coreLinked = !plainChain(env.realHome, rebase(env, core)) && Boolean(lstatOrNull(core));
  if (coreLinked) skipped.push({ box: 'core', path: core, why: 'link' });

  // projects: the ones Orb made go to the Recycle Bin; the rest stay, and the old ones are listed.
  const trash = []; const keptProjects = []; const refsRepos = [];
  const trashed = new Set();
  const foreverSet = new Set(forever);
  for (const row of projects) {
    const owned = ownedProject(env, row);
    if (!owned.ok) { keptProjects.push({ name: row.name, path: row.path, why: owned.why === 'unmarked' ? 'old' : owned.why }); continue; }
    if (k.projects) { keptProjects.push({ name: row.name, path: row.path, why: 'chosen' }); continue; }
    const s = sizeOf(row.path);
    const big = s.bytes > trashLimit;
    if (big && !foreverSet.has(row.name)) { keptProjects.push({ name: row.name, path: row.path, why: 'big', bytes: s.bytes }); continue; }
    trash.push({ name: row.name, path: row.path, token: row.created_by_orb, bytes: s.bytes, files: s.files, forever: big });
    trashed.add(row.name);
  }
  for (const t of trash) add({ stage: 'projects', kind: 'project', box: 'projects', path: t.path, name: t.name, token: t.token, bytes: t.bytes, files: t.files, forever: t.forever });

  // data: what is inside core, box by box
  if (!coreLinked) {
    for (const name of childrenOf(core)) {
      const box = coreBox(name);
      const full = path.join(core, name);
      if (box === null) {
        for (const d of childrenOf(full)) {
          const dfull = path.join(full, d);
          if (KEY_NAME.test(d) || DB_NAME.test(d)) continue; // the key goes last; the database has its own step
          const dbox = dataBox(d);
          if (!k[dbox]) addPath('data', dbox, dfull);
        }
        continue;
      }
      if (box === 'vault') { if (!k.vault) addPath('vault', 'vault', full); continue; }
      if (name === 'restablecido' || name === 'proyectos-conservados.json') continue;
      if (!k[box]) addPath('data', box, full);
    }
  }
  // the database: its tables by box (or the files, when nothing in it stays)
  const dbFiles = childrenOf(env.p.data).filter((d) => DB_NAME.test(d)).map((d) => path.join(env.p.data, d));
  const dbSize = dbFiles.reduce((a, f) => a + (lstatOrNull(f)?.size ?? 0), 0);
  const left = keptProjects.length > 0;
  const wipeDb = mode === 'uninstall' && !k.chats && !k.link && !k.projects && !left;
  if (dbFiles.length && plainChain(env.realHome, rebase(env, env.p.db))) {
    if (wipeDb) for (const f of dbFiles) add({ stage: 'data', kind: 'path', box: 'chats', path: f, bytes: lstatOrNull(f)?.size ?? 0, files: 1 });
    else if (!k.chats || !k.link) add({ stage: 'data', kind: 'db', box: !k.chats ? 'chats' : 'link', path: env.p.db, keep: k, bytes: dbSize, devices });
  }
  // the isolated copies and the branches Orb made in the projects that stay
  if (!k.chats) {
    for (const row of projects) {
      if (trashed.has(row.name)) continue;
      const g = lstatOrNull(path.join(row.path, '.git'));
      if (g?.isDirectory() && (gitBranches(row.path).length > 0 || ownWorktrees(env, row.path))) refsRepos.push(row.path);
    }
    for (const repo of refsRepos) add({ stage: 'data', kind: 'refs', box: 'chats', path: repo, bytes: 0, files: 0 });
  }
  // the backups: only this Orb's files (header orbId), in every folder where its copies are; the default folder with its note
  const backupFiles = [];
  if (!k.backups) {
    const orbId = K.knownOrbId(env.home);
    if (orbId) {
      for (const dir of K.knownBackupDirs(env.home, env.config)) {
        const list = [...await K.listBackups(dir)];
        for (const sub of childrenOf(dir).filter((x) => x.startsWith('antes-de-empezar-de-nuevo-'))) list.push(...await K.listBackups(path.join(dir, sub)));
        for (const b of list) {
          if (b.damaged || b.orbId !== orbId) continue;
          const st = lstatOrNull(b.file);
          if (!st?.isFile()) continue;
          if (backupFiles.some((x) => keyOf(x) === keyOf(b.file))) continue;
          backupFiles.push(b.file);
          add({ stage: 'data', kind: 'backup', box: 'backups', path: b.file, bytes: st.size, files: 1, orbId });
        }
      }
      const last = path.join(K.defaultBackupDir(env.home), 'ultima.json');
      if (lstatOrNull(last)?.isFile()) add({ stage: 'data', kind: 'path', box: 'backups', path: last, bytes: lstatOrNull(last).size, files: 1 });
    }
  }
  // the vault's copy outside the workspace (every old name too) goes with the vault
  if (!k.vault) for (const name of keyNames(env)) { const r = path.join(clavesDir(env), `${name}-secretos`); if (lstatOrNull(r)) addPath('vault', 'vault', r); }
  // this PC's key, last: only when nothing encrypted stays
  // an earlier vault may sit in what is kept (core's anterior-* and antes-de-restaurar-* folders): its key stays too
  const oldVault = k.chats && childrenOf(core).some((n) => /^(anterior-|antes-de-restaurar-)/.test(n));
  const keyKept = keepsKey(k) || oldVault;
  if (!keyKept) {
    for (const d of childrenOf(env.p.data)) if (KEY_NAME.test(d)) addPath('key', 'key', path.join(env.p.data, d));
    for (const c of childrenOf(clavesDir(env))) { const f = path.join(clavesDir(env), c); if (classify(env, f) === 'key') addPath('key', 'key', f); }
  }
  // where the app finds the workspace: it goes only when nothing at all stays (no box, no project), or what stays would be orphaned
  if (mode === 'uninstall' && !BOXES.some((b) => k[b]) && keptProjects.length === 0) {
    const loc = path.join(env.userData, 'ubicacion.json');
    if (lstatOrNull(loc)?.isFile()) add({ stage: 'end', kind: 'path', box: 'settings', path: loc, bytes: lstatOrNull(loc).size, files: 1 });
  }
  // in the order they are done (a stable sort: the projects, the data, the vault, the key last)
  items.sort((a, b) => STAGES.indexOf(a.stage) - STAGES.indexOf(b.stage) || (a.kind === 'refs') - (b.kind === 'refs'));
  const boxes = Object.fromEntries(BOXES.map((b) => [b, { bytes: 0, files: 0, items: 0 }]));
  for (const i of items) { const b = boxes[i.box] ?? (boxes[i.box] = { bytes: 0, files: 0, items: 0 }); b.bytes += i.bytes ?? 0; b.files += i.files ?? 0; b.items++; }
  boxes.link.devices = k.link ? 0 : devices;
  const oldProjects = keptProjects.filter((x) => x.why === 'old');
  const orbId = k.backups ? null : K.knownOrbId(env.home);
  const id = crypto.createHash('sha256').update(JSON.stringify([mode, k, items.map((i) => [i.stage, i.kind, i.path, i.name ?? null]), copyFirst])).digest('hex').slice(0, 24);
  return { id, mode, keep: k, forced, copyFirst, items, boxes, trash, keptProjects, oldProjects, dirty: k.chats ? [] : dirtyCopies(env, projects), keyKept, wipeDb, coreLinked, skipped, orbId, facts: { mcpKeys } };
}

// ---- the journal: where the run is, outside core (core is part of what goes)
export const journalPath = (userData) => path.join(userData, JOURNAL_FILE);
export function readJournal(userData) {
  try { const j = JSON.parse(fs.readFileSync(journalPath(userData), 'utf8')); return j && j.v === 1 && Array.isArray(j.items) ? j : null; } catch { return null; }
}
// The journal is signed with this PC's key (HMAC): what a program of the user's PC writes in the app's data folder is never
// run. Without the key, or with another signature, it is not resumed and the start says so.
const signature = (key, j) => { const { sig, ...rest } = j; return crypto.createHmac('sha256', key).update(JSON.stringify(rest)).digest('hex'); };
export function journalTrusted(journal, signKey) {
  if (!signKey || typeof journal?.sig !== 'string' || !/^[0-9a-f]{64}$/.test(journal.sig)) return false;
  return crypto.timingSafeEqual(Buffer.from(signature(signKey, journal)), Buffer.from(journal.sig));
}
const saveJournal = (env, j) => {
  fs.mkdirSync(env.userData, { recursive: true });
  if (env.signKey) j.sig = signature(env.signKey, j); else delete j.sig;
  writeJson(journalPath(env.userData), j);
};

// ---- the steps
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function retried(fn, tries = 4) {
  let last;
  for (let i = 0; i < tries; i++) {
    try { return fn(); } catch (error) {
      last = error;
      if (!['EBUSY', 'EPERM', 'EACCES', 'ENOTEMPTY'].includes(error?.code)) throw error;
      await sleep(250 * (i + 1));
    }
  }
  throw last;
}
// Clears orb.db in place by box (no file is deleted): the tables of the boxes not kept, the rows of `settings` that do not stay,
// and the free pages (VACUUM), so nothing deleted lingers in the file.
export function clearDb(file, keep) {
  const { DatabaseSync } = process.getBuiltinModule('node:sqlite');
  const db = new DatabaseSync(file);
  try {
    db.exec('PRAGMA busy_timeout = 8000');
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'").all().map((r) => r.name);
    db.exec('BEGIN IMMEDIATE');
    try {
      const cleared = [];
      for (const t of tables) {
        if (t === 'settings' || t === 'projects') continue;
        const isLink = LINK_TABLES.includes(t);
        if ((isLink && keep.link) || (!isLink && keep.chats)) continue;
        db.exec(`DELETE FROM "${t.replace(/"/g, '""')}"`); cleared.push(t);
      }
      if (tables.includes('settings')) {
        for (const r of db.prepare('SELECT key FROM settings').all()) if (!keepSetting(r.key, keep)) db.prepare('DELETE FROM settings WHERE key = ?').run(r.key);
      }
      if (cleared.length) { try { db.exec(`DELETE FROM sqlite_sequence WHERE name IN (${cleared.map((t) => `'${t.replace(/'/g, "''")}'`).join(',')})`); } catch { /* no sequences */ } }
      db.exec('COMMIT');
    } catch (error) { db.exec('ROLLBACK'); throw error; }
    db.exec('PRAGMA wal_checkpoint(TRUNCATE)');
    db.exec('VACUUM');
  } finally { db.close(); }
}

// Whether the repository lists a worktree inside core copias (the folder of an isolated copy).
const ownWorktrees = (env, repo) => { const wt = git(repo, 'worktree', 'list', '--porcelain'); return wt.status === 0 && wt.stdout.split(/\r?\n/).some((l) => l.startsWith('worktree ') && isUnder(env.p.copies, l.slice(9).trim())); };
// The projects the database knows (read on its own, the engine's handle may be closed).
function dbProjectPaths(env) {
  if (!lstatOrNull(env.p.db)) return [];
  try {
    const { DatabaseSync } = process.getBuiltinModule('node:sqlite');
    const db = new DatabaseSync(env.p.db, { readOnly: true });
    try { return db.prepare('SELECT path FROM projects').all().map((r) => r.path); } finally { db.close(); }
  } catch { return []; }
}
// Deletes the isolated copies' refs and branches Orb made in a project that stays. A worktree entry of core\copias is pruned
// (its folder went with copias\); the user's own worktrees are never touched.
function cleanRefs(env, repo) {
  if (ownWorktrees(env, repo)) git(repo, 'worktree', 'prune');
  for (const ref of gitBranches(repo)) git(repo, 'update-ref', '-d', ref);
}

async function runItem(env, item, hooks) {
  if (item.kind === 'project') {
    const row = hooks.project?.(item.name);
    if (row && !ownedProject(env, row).ok) throw Object.assign(new Error(`not owned: ${item.name}`), { code: 'ENOTOWNED' });
    if (!row && !lstatOrNull(item.path)) return; // gone already
    const r = await hooks.trash(item.path, item.token, item.name, item.forever === true);
    if (r?.ok === false) throw Object.assign(new Error(r.noTrash ? 'noTrash' : r.locked ? 'locked' : 'trash'), { code: r.noTrash ? 'ENOTRASH' : 'EBUSY' });
    hooks.dropProject?.(item.name);
    return;
  }
  const refuse = (why) => { throw Object.assign(new Error(`not allowed (${why}): ${item.path}`), { code: 'EALLOW' }); };
  // each kind only takes the classes that belong to it: whatever the journal says, a folder such as the workspace itself, a
  // category or the keys' folder is never removed here (those are only removed when empty, by settleWorkspace)
  if (item.kind === 'db') {
    if (typeof item.path !== 'string' || keyOf(item.path) !== keyOf(env.p.db) || !plainChain(env.realHome, rebase(env, env.p.db))) refuse('database');
    if (lstatOrNull(item.path)) await retried(() => clearDb(item.path, item.keep));
    return;
  }
  if (item.kind === 'refs') {
    if (typeof item.path !== 'string' || !dbProjectPaths(env).some((p) => keyOf(p) === keyOf(item.path))) refuse('not a project');
    if (lstatOrNull(item.path)) cleanRefs(env, item.path);
    return;
  }
  // path and backup: re-checked against what Orb owns right before it goes
  const what = classify(env, item.path);
  const allowed = item.kind === 'backup' ? ['backup'] : item.kind === 'path' ? ['core', 'key', 'replica', 'location', 'last'] : [];
  if (!what || !allowed.includes(what)) refuse(what ?? 'unknown');
  if (item.kind === 'backup') {
    const st = lstatOrNull(item.path);
    if (!st) return;
    if (!st.isFile()) throw Object.assign(new Error('not a file'), { code: 'EALLOW' });
    const { header } = await K.readHeader(item.path);
    if (header.orbId !== item.orbId) throw Object.assign(new Error('another Orb'), { code: 'EALLOW' });
  }
  await retried(() => removeTree(item.path));
}

// The healthy core the next start needs, written before it: orb.json and an empty database, so neither repairCore nor
// restoreMissing finds anything «missing» to bring back from a backup or a replica.
export async function writeHealthyCore(env, { keepSettings, welcome = true, resetMark = false } = {}) {
  const p = env.p;
  fs.mkdirSync(p.data, { recursive: true });
  let config = null;
  if (keepSettings) { try { config = JSON.parse(fs.readFileSync(p.config, 'utf8')); } catch { config = null; } }
  if (!config) {
    let language = 'es';
    try { language = JSON.parse(fs.readFileSync(p.config, 'utf8')).language === 'en' ? 'en' : 'es'; } catch { language = env.config?.language === 'en' ? 'en' : 'es'; }
    config = merge(DEFAULT_CONFIG, { language });
  }
  if (welcome) config = { ...config, setupPending: true };
  writeJson(p.config, config);
  if (!fs.existsSync(p.db)) { const { openDb } = await import('./db.mjs'); openDb(p.db).close(); }
  if (resetMark) fs.writeFileSync(path.join(p.core, RESET_MARK), `${new Date().toISOString()}\n`);
}

function pruneEmptyDirs(dir, keepRoot = true) {
  const st = lstatOrNull(dir);
  if (!st?.isDirectory() || st.isSymbolicLink()) return;
  for (const n of childrenOf(dir)) pruneEmptyDirs(path.join(dir, n), false);
  if (!keepRoot) removeIfEmpty(dir);
}

// What is left of the workspace when the run ends: a healthy core when something stays (or always on a reset), nothing
// at all when everything went (the empty folders only, never anything with content).
export async function settleWorkspace(env, plan) {
  const { keep, mode } = plan;
  if (!lstatOrNull(env.p.core)) {
    if (mode === 'reset') { fs.mkdirSync(env.p.core, { recursive: true }); await writeHealthyCore(env, { keepSettings: keep.settings, resetMark: true }); }
    return { core: mode === 'reset' };
  }
  if (plan.items?.length) pruneEmptyDirs(env.p.core, true);
  const anyKept = BOXES.some((b) => keep[b]) || plan.keptProjects.length > 0;
  if (mode === 'reset' || anyKept) {
    await writeHealthyCore(env, { keepSettings: keep.settings, resetMark: mode === 'reset' });
    return { core: true };
  }
  // «Borrar todo»: the categories and the workspace only if they are empty
  fs.rmSync(path.join(env.p.core, RESET_MARK), { force: true });
  fs.rmSync(path.join(env.p.core, 'proyectos-conservados.json'), { force: true });
  removeIfEmpty(env.p.core);
  for (const c of CATEGORIES) removeIfEmpty(path.join(env.home, c));
  removeIfEmpty(env.home);
  // the backups' own folder of this workspace, and the keys' folder, when nothing else is in them
  for (const k of keyNames(env)) removeIfEmpty(path.join(K.backupRoot(), k));
  return { core: false };
}

// Carries the plan out. hooks: trash(path, token, name) → { ok } (the Recycle Bin: only the app can), project(name) → the board's
// row, dropProject(name), closeDb(), onStep(journal). Stops at the first thing that cannot be done: the journal says what
// went and what did not, and nothing after it is touched. → { ok, done, failed, pending }.
export async function runPlan({ env, plan, hooks = {}, resume = null }) {
  if (resume) resume.stopped = false;
  const journal = resume ?? { v: 1, id: plan.id, mode: plan.mode, home: env.home, userData: env.userData, startedAt: new Date().toISOString(), keep: plan.keep, keptProjects: plan.keptProjects.map((x) => ({ name: x.name, why: x.why })), wipeDb: plan.wipeDb, keyKept: plan.keyKept, backupDirs: env.backupDirs, orbId: plan.orbId ?? null, items: plan.items.map((i) => ({ ...i, state: 'pending' })) };
  const save = () => { saveJournal(env, journal); hooks.onStep?.(journal); };
  save();
  const todo = journal.items.filter((i) => i.state !== 'done').sort((a, b) => STAGES.indexOf(a.stage) - STAGES.indexOf(b.stage) || (a.kind === 'refs') - (b.kind === 'refs'));
  let dbClosed = false;
  for (const item of todo) {
    if (item.stage !== 'projects' && !dbClosed) { await hooks.closeDb?.(); dbClosed = true; }
    // a restart has no app to ask for the Recycle Bin: that folder stays where it is, and the report says so
    if (item.kind === 'project' && hooks.noHost) { item.state = 'skipped'; continue; }
    try { await runItem(env, item, hooks); item.state = 'done'; delete item.error; } catch (error) {
      item.state = 'failed'; item.error = String(error?.message ?? error).slice(0, 300); item.code = error?.code ?? null;
      // a failure that was reported stops for good: only the user's confirmation (confirmResume) lets a start go on with it
      journal.stopped = true;
      save();
      return report(journal, false);
    }
    save();
  }
  if (journal.items.some((i) => i.state === 'pending')) return report(journal, false);
  if (!dbClosed) { await hooks.closeDb?.(); dbClosed = true; }
  try { await settleWorkspace(env, { ...plan, items: journal.items }); } catch (error) { journal.settle = String(error?.message ?? error).slice(0, 300); save(); return { ...report(journal, false), settle: journal.settle }; }
  return report(journal, true);
}
const report = (journal, ok) => ({
  ok,
  done: journal.items.filter((i) => i.state === 'done').map((i) => ({ box: i.box, path: i.path, name: i.name ?? null })),
  failed: journal.items.filter((i) => i.state === 'failed').map((i) => ({ box: i.box, path: i.path, name: i.name ?? null, error: i.error, code: i.code ?? null })),
  pending: journal.items.filter((i) => i.state === 'pending').map((i) => ({ box: i.box, path: i.path, name: i.name ?? null })),
  skipped: journal.items.filter((i) => i.state === 'skipped').map((i) => ({ box: i.box, path: i.path, name: i.name ?? null }))
});

// The run is over (all done): the journal goes. Kept (with what failed) otherwise, for the next start.
export const closeJournal = (userData) => { try { fs.rmSync(journalPath(userData), { force: true }); } catch { /* the next start tries again */ } };

// At the start: a journal left by a run that was cut (the process died). Only a journal signed with this PC's key, for a
// workspace this app knows (the saved location, or a real Orb folder), is run again, with the backup folders it was signed with. The deletes that need no app are finished (every item checked again against what Orb owns); a
// project still waiting for the Recycle Bin is only reported. A run that stopped on a reported failure (stopped) waits for the
// user's confirmation (confirmResume). → { resumed, ok, done, failed, pending, skipped, stopped?, untrusted? } or null.
const onlyEndLeft = (j) => Array.isArray(j.items) && j.items.some((i) => i.stage === 'key') && j.items.every((i) => i.state === 'done' || i.stage === 'end');
const knownHome = (userData, home) => {
  try { const saved = JSON.parse(fs.readFileSync(path.join(userData, 'ubicacion.json'), 'utf8')).home; if (typeof saved === 'string' && keyOf(saved) === keyOf(home)) return true; } catch { /* no saved location */ }
  return isHome(home);
};
export async function resumeJournal({ userData, signKey = null, confirmed = false }) {
  const journal = readJournal(userData);
  if (!journal) return null;
  const nothing = { done: [], failed: [], pending: [], skipped: [] };
  if (!journalTrusted(journal, signKey)) {
    // The run died after the PC key went (the signature cannot open any more) with only its last step left (the saved location
    // and the mark): there is nothing to finish, and reading it only to close the file does no harm.
    if (onlyEndLeft(journal)) { closeJournal(userData); return { resumed: false, ok: true, closed: true, ...nothing }; }
    return { resumed: false, ok: false, untrusted: 'signature', ...nothing };
  }
  const h = journal.home;
  if (typeof h !== 'string' || !path.isAbsolute(h) || !knownHome(userData, h)) return { resumed: false, ok: false, untrusted: 'home', ...nothing };
  const config = (() => { try { return JSON.parse(fs.readFileSync(path.join(h, 'core', 'orb.json'), 'utf8')); } catch { return {}; } })();
  // the folders of copies were written, signed, when the run began: ultima.json and orb.json may be gone by now
  const dirs = (Array.isArray(journal.backupDirs) ? journal.backupDirs : []).filter((d) => typeof d === 'string' && path.isAbsolute(d));
  const env = uninstallEnv({ home: h, userData, backupDirs: dirs, config, signKey });
  if (journal.stopped === true && !confirmed) return { resumed: false, ok: false, stopped: true, ...report(journal, false) };
  const plan = { mode: journal.mode, keep: journal.keep, keptProjects: journal.keptProjects ?? [], keyKept: journal.keyKept, wipeDb: journal.wipeDb };
  for (const i of journal.items) if (i.state === 'failed') i.state = 'pending';
  const r = await runPlan({ env, plan, resume: journal, hooks: { noHost: true } });
  if (r.ok) closeJournal(userData);
  return { resumed: true, ...r };
}

// What waits at the start, for the window to offer «Seguir borrando» / «Dejarlo así»: 'stopped' (a reported failure), 'untrusted' (a
// journal that cannot be checked) or null. done / left count the items.
export function pendingJournal(userData, signKey) {
  const j = readJournal(userData);
  if (!j) return { state: null };
  const done = j.items.filter((i) => i.state === 'done').length;
  const left = j.items.length - done;
  if (!journalTrusted(j, signKey)) return { state: 'untrusted', done, left };
  return { state: j.stopped === true ? 'stopped' : 'running', done, left };
}

// «Seguir» after a stopped run: the user confirmed, so the next start runs the journal again. → true when it was signed and stopped.
export function confirmResume(userData, signKey) {
  const journal = readJournal(userData);
  if (!journal || !journalTrusted(journal, signKey) || journal.stopped !== true) return false;
  journal.stopped = false;
  saveJournal({ userData, signKey }, journal);
  return true;
}

// The same at the start, and what could not be finished is left in a note for the window (takeReport says it once).
export const REPORT_FILE = 'desinstalacion-informe.json';
export async function resumeAndReport(userData, signKey = null) {
  const r = await resumeJournal({ userData, signKey });
  if (r && (!r.ok || r.skipped.length)) writeJson(path.join(userData, REPORT_FILE), { at: new Date().toISOString(), ok: r.ok, stopped: r.stopped === true, untrusted: r.untrusted ?? null, done: r.done.length, failed: r.failed.length + r.pending.length, skipped: r.skipped.length });
  return r;
}
export function takeReport(userData) {
  const file = path.join(userData, REPORT_FILE);
  try { const r = JSON.parse(fs.readFileSync(file, 'utf8')); fs.rmSync(file, { force: true }); return r; } catch { return null; }
}

export { ARCHIVE_DIR };
