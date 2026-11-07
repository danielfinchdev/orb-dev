// 3.8: core, Orb's own folder inside the workspace (src/core/home.mjs › paths). Here:
//   - migrateWorkspace: the folders Orb 3.7 kept at the top of the workspace (.orb, orb.json, bitacora, mcp-servers,
//     android\adb-tools) move into core once, before the database opens. Each one is renamed in one step when it can be;
//     otherwise (a file held open, another volume) it is merged file by file: copied next to its place, checked (size and
//     sha256), switched in by a rename, and only then the old one deleted. A run that stops halfway is finished by the
//     next one (core\migracion-carpetas.json, written before anything moves, says the paths still have to be rewritten);
//     a second run with nothing to move does nothing.
//   - rewritePaths: the absolute paths that pointed into those folders (orb.json: accounts, connectors; the database:
//     isolated copies, images, plans; the git worktrees of the isolated copies) are made to point into core.
//   - coreHealth / protectCore: whether core is whole, and core hidden in the Explorer.
// No engine imports: the engine, the app's main process (src/main/main.mjs) and the tests use it.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { paths, LEGACY, moveLogs } from './home.mjs';

export const MOVE_STATE = 'migracion-carpetas.json'; // in core while the paths of the move are not rewritten yet
export const CONFLICTS_DIR = 'conflictos-migracion'; // in core: an old file that differed from the one already in core

const exists = (p) => { try { fs.lstatSync(p); return true; } catch { return false; } };
const isDir = (p) => { try { return fs.statSync(p).isDirectory(); } catch { return false; } };
const isFile = (p) => { try { return fs.statSync(p).isFile(); } catch { return false; } };
const sha = (file) => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const stamp = () => new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');

// What moves where (only the ones whose old place exists are moved).
export function legacyMoves(home) {
  const p = paths(home);
  return [
    { from: path.join(home, LEGACY.internal), to: p.core },
    { from: path.join(home, LEGACY.config), to: p.config },
    { from: path.join(home, LEGACY.logs), to: p.logs, logs: true },
    { from: path.join(home, LEGACY.mcp), to: p.mcp },
    { from: path.join(home, ...LEGACY.adb), to: p.adb }
  ];
}
export const hasLegacy = (home) => legacyMoves(home).some((m) => exists(m.from));

// The old prefix → the new one, for the paths Orb wrote (folders end with the separator, so a project called
// «bitacora-web» is not touched), also as they look inside JSON text (backslashes doubled).
export function rewritePairs(home) {
  const s = path.sep;
  const pairs = legacyMoves(home).map((m, i) => (i === 1 ? [m.from, m.to] : [m.from + s, m.to + s]));
  const json = pairs.map(([a, b]) => [JSON.stringify(a).slice(1, -1), JSON.stringify(b).slice(1, -1)]).filter(([a], i) => a !== pairs[i][0]);
  return [...pairs, ...json];
}
const replaceAll = (text, pairs) => pairs.reduce((t, [a, b]) => (t.includes(a) ? t.split(a).join(b) : t), text);

// Moves `from` to `to`: one rename when `to` is not there yet; otherwise (or when the rename fails) entry by entry.
function move(from, to, { logs = false, conflicts }) {
  if (!exists(from)) return;
  if (!exists(to)) {
    fs.mkdirSync(path.dirname(to), { recursive: true });
    try { fs.renameSync(from, to); return; } catch { /* held open or another volume: entry by entry */ }
  }
  if (isDir(from)) {
    if (logs && isDir(to)) { moveLogs(from, to); if (!exists(from)) return; }
    fs.mkdirSync(to, { recursive: true });
    for (const name of fs.readdirSync(from)) move(path.join(from, name), path.join(to, name), { logs, conflicts: path.join(conflicts, name) });
    fs.rmdirSync(from); // throws when something could not be moved: the next start tries again
    return;
  }
  if (!exists(to)) {
    // Copy beside its place, check it, switch it in, then delete the old one.
    const tmp = `${to}.${process.pid}.copia`;
    fs.copyFileSync(from, tmp);
    if (fs.statSync(tmp).size !== fs.statSync(from).size || sha(tmp) !== sha(from)) { fs.rmSync(tmp, { force: true }); throw new Error(`la copia de ${from} no coincide`); }
    fs.renameSync(tmp, to);
    fs.rmSync(from, { force: true });
    return;
  }
  // Both there: the same file (a run that stopped after copying) or a different one, which is kept aside, never lost.
  if (isFile(to) && fs.statSync(to).size === fs.statSync(from).size && sha(to) === sha(from)) { fs.rmSync(from, { force: true }); return; }
  fs.mkdirSync(path.dirname(conflicts), { recursive: true });
  fs.renameSync(from, exists(conflicts) ? `${conflicts}-${stamp()}` : conflicts);
}

// → null when there was nothing to do, or { moved: [old paths], rewritten: { config, db, worktrees } }.
export function migrateWorkspace(home) {
  const p = paths(home);
  const moves = legacyMoves(home).filter((m) => exists(m.from));
  const oldState = path.join(home, LEGACY.internal, MOVE_STATE);
  const state = path.join(p.core, MOVE_STATE);
  if (!moves.length && !exists(state)) return null;
  if (!exists(state) && !exists(oldState)) {
    // Written before anything moves, where it moves along: inside .orb when that becomes core in one rename.
    const at = isDir(path.join(home, LEGACY.internal)) && !exists(p.core) ? oldState : state;
    fs.mkdirSync(path.dirname(at), { recursive: true });
    fs.writeFileSync(at, `${JSON.stringify({ v: 1, home, started: new Date().toISOString() }, null, 2)}\n`);
  }
  const conflicts = path.join(p.core, CONFLICTS_DIR, stamp());
  for (const m of moves) move(m.from, m.to, { logs: m.logs, conflicts: path.join(conflicts, path.relative(home, m.from)) });
  // An old adb-tools folder leaves an empty android category behind: it stays (it is one of the six).
  const rewritten = rewritePaths(home);
  fs.rmSync(state, { force: true });
  return { moved: moves.map((m) => m.from), rewritten };
}

// orb.json, the database and the isolated copies' worktrees, pointed into core. Safe to run again (an old prefix is never
// part of a new path). → { config, db, worktrees } (what changed).
export function rewritePaths(home, { db = paths(home).db } = {}) {
  const p = paths(home);
  const pairs = rewritePairs(home);
  const exact = legacyMoves(home).map((m) => [m.from, m.to]);
  let config = false;
  if (isFile(p.config)) {
    const fix = (v) => {
      if (typeof v === 'string') { const e = exact.find(([a]) => a === v); return e ? e[1] : replaceAll(v, pairs); }
      if (Array.isArray(v)) return v.map(fix);
      if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, fix(x)]));
      return v;
    };
    const raw = fs.readFileSync(p.config, 'utf8');
    let parsed = null; try { parsed = JSON.parse(raw); } catch { /* not ours to fix: loadConfig says why */ }
    if (parsed) {
      const next = `${JSON.stringify(fix(parsed), null, 2)}\n`;
      if (next !== `${JSON.stringify(parsed, null, 2)}\n`) {
        const tmp = `${p.config}.${process.pid}.tmp`;
        fs.writeFileSync(tmp, next); fs.renameSync(tmp, p.config); config = true;
      }
    }
  }
  return { config, db: rewriteDb(db, home), worktrees: repairWorktrees(p.worktrees) };
}

// Every text column of every table (one pass per column). → rows changed.
export function rewriteDb(file, home) {
  if (!isFile(file)) return 0;
  const pairs = rewritePairs(home);
  const exact = legacyMoves(home).map((m) => [m.from, m.to]);
  const { DatabaseSync } = process.getBuiltinModule('node:sqlite');
  const db = new DatabaseSync(file);
  let changed = 0;
  try {
    db.exec('PRAGMA busy_timeout = 8000');
    const q = (name) => `"${String(name).replace(/"/g, '""')}"`;
    const all = db.prepare("SELECT name, sql FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'").all();
    const virtual = all.filter((t) => /^CREATE VIRTUAL/i.test(t.sql ?? '')).map((t) => t.name);
    const tables = all.filter((t) => !virtual.includes(t.name) && !virtual.some((v) => t.name.startsWith(`${v}_`))).map((t) => t.name);
    db.exec('BEGIN IMMEDIATE');
    try {
      for (const t of tables) {
        for (const c of db.prepare(`PRAGMA table_info(${q(t)})`).all()) {
          if (!/^(|TEXT|.*CHAR.*|CLOB)$/i.test(String(c.type ?? '').trim())) continue;
          const col = q(c.name);
          const expr = pairs.reduce((e) => `REPLACE(${e}, ?, ?)`, col);
          const where = pairs.map(() => `instr(${col}, ?) > 0`).join(' OR ');
          changed += Number(db.prepare(`UPDATE ${q(t)} SET ${col} = ${expr} WHERE typeof(${col}) = 'text' AND (${where})`).run(...pairs.flat(), ...pairs.map(([a]) => a)).changes);
          const cases = exact.map(() => 'WHEN ? THEN ?').join(' ');
          changed += Number(db.prepare(`UPDATE ${q(t)} SET ${col} = CASE ${col} ${cases} END WHERE ${col} IN (${exact.map(() => '?').join(', ')})`).run(...exact.flat(), ...exact.map(([a]) => a)).changes);
        }
      }
      db.exec('COMMIT');
    } catch (error) { try { db.exec('ROLLBACK'); } catch { /* none */ } throw error; }
  } finally { db.close(); }
  return changed;
}

// An isolated copy is a git worktree: its repository keeps where it lives (<repo>\.git\worktrees\<n>\gitdir). After a
// move it points to the old place; written again as git itself writes it (what `git worktree repair` does).
export function repairWorktrees(dir) {
  let n = 0;
  let entries = []; try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return 0; }
  for (const e of entries) {
    if (!e.isDirectory()) continue;
    const dotgit = path.join(dir, e.name, '.git');
    let link; try { link = fs.readFileSync(dotgit, 'utf8').match(/^gitdir:\s*(.+?)\s*$/m)?.[1]; } catch { continue; }
    if (!link) continue;
    const back = path.join(path.resolve(path.join(dir, e.name), link), 'gitdir');
    if (!isFile(back)) continue;
    const want = `${dotgit.split(path.sep).join('/')}\n`;
    if (fs.readFileSync(back, 'utf8') !== want) { fs.writeFileSync(back, want); n++; }
  }
  return n;
}

// Whether core is whole: { ok, missing: ['core' | 'config' | 'db'] }. A database that was never made (a workspace
// created a moment ago) also reads as missing: the engine decides with the backups (src/core/backup.mjs › repairCore).
export function coreHealth(home) {
  const p = paths(home);
  if (!isDir(p.core)) return { ok: false, missing: ['core'] };
  const missing = [];
  if (!isFile(p.config)) missing.push('config');
  if (!isFile(p.db)) missing.push('db');
  return { ok: !missing.length, missing };
}

// core hidden in the Explorer, also with «show hidden files» (system attribute) on Windows; elsewhere nothing (the
// workspace is the user's). No access rules: see docs/ARCHITECTURE.md (core) for why a deny ACE was left out.
export function protectCore(home) {
  if (process.platform !== 'win32') return false;
  try { return spawnSync('attrib', ['+h', '+s', paths(home).core], { windowsHide: true, timeout: 5000 }).status === 0; } catch { return false; }
}
