// 3.8: core, Orb's own folder inside the workspace (src/core/home.mjs › paths). Here:
//   - migrateWorkspace: Orb 3.7's own data at the top of the workspace (.orb, orb.json) moves into core once, before the
//     database opens. It is Orb's, so it moves without asking (only when it is there: a folder without .orb or orb.json
//     is never taken for a 3.7 workspace).
//   - planWorkspace / applyLayout: the other folders 3.7 kept at the top (bitacora, android\adb-tools, each server in
//     mcp-servers) are the user's to decide about. The window lists them with what would happen to each (move into
//     core, move as a project into a category, or keep where it is) and nothing moves until the user confirms. 3.8.1:
//     every MCP server goes into core\mcp by default, also one the user wrote (the owner's definition), and the projects
//     that are MCP servers are offered once to a workspace set up by 3.8.0 (which made them projects). What the user kept
//     is remembered (core\carpetas.json) and not asked again; a kept bitacora or adb-tools is used where it is (home.mjs
//     › paths). moveIntoCore: the same move for one project, from Ajustes › Skills y MCP.
//   - Moving: one rename when it can be. Before anything moves, every folder is checked to be free (on Windows a
//     folder some program is using cannot be renamed): if one is not, nothing moves and the window says which one to
//     close (code 'busy', «Reintentar»). Across volumes, or into a folder that already exists, it is merged file by
//     file: copied next to its place, checked (size and sha256), switched in by a rename, and only then the old one
//     deleted. A run that stops halfway is finished by the next one (core\migracion-carpetas.json, written before
//     anything moves, lists the moves); a second run with nothing to move does nothing.
//   - rewritePaths: the absolute paths that pointed into what moved (orb.json: accounts, connectors; the database:
//     isolated copies, images, plans; the git worktrees of the isolated copies) are made to point to the new place.
//     What the user wrote in a message is left as written (only Orb's own .orb paths, e.g. attached images, change).
//   - coreHealth / protectCore: whether core is whole, and core hidden in the Explorer.
// No engine imports: the engine, the app's main process (src/main/main.mjs) and the tests use it.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { paths, LEGACY, moveLogs, CATEGORIES, CORE_DIR, LOGS_DIR, MCP_DIR } from './home.mjs';
import { translate } from './i18n.mjs';
import { isMcpProject, startCommand } from './extensions.mjs';

export const MOVE_STATE = 'migracion-carpetas.json'; // in core while the moves are not finished and their paths rewritten
export const CONFLICTS_DIR = 'conflictos-migracion'; // in core: an old file that differed from the one already in core
export const LAYOUT_FILE = 'carpetas.json'; // in core: what the user decided about the folders of 3.7 ({ decided: { id: choice } })

const exists = (p) => { try { fs.lstatSync(p); return true; } catch { return false; } };
const isDir = (p) => { try { return fs.statSync(p).isDirectory(); } catch { return false; } };
const isFile = (p) => { try { return fs.statSync(p).isFile(); } catch { return false; } };
const sha = (file) => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const stamp = () => new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
const sleep = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
const readJson = (f) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return null; } };
const writeJsonAtomic = (file, value) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`); fs.renameSync(tmp, file);
};

// Where things live in core, whatever paths() says about a folder kept at the top.
const coreLogs = (home) => path.join(home, CORE_DIR, LOGS_DIR);
const coreAdb = (home) => path.join(home, CORE_DIR, 'herramientas', 'adb');
const coreMcp = (home) => path.join(home, CORE_DIR, MCP_DIR);
const notes = (home) => [path.join(home, CORE_DIR, MOVE_STATE), path.join(home, LEGACY.internal, MOVE_STATE)];

// Orb 3.7's own data: moved when the engine starts.
export function ownMoves(home) {
  const p = paths(home);
  return [{ from: path.join(home, LEGACY.internal), to: p.core }, { from: path.join(home, LEGACY.config), to: p.config, file: true }];
}
// Everything 3.7 kept at the top, all into core: how the names of a backup made by 3.7 are read (backup.mjs ›
// legacyName), and so the paths its orb.json and database hold.
export function legacyMoves(home) {
  return [...ownMoves(home),
    { from: path.join(home, LEGACY.logs), to: coreLogs(home), logs: true },
    { from: path.join(home, LEGACY.mcp), to: coreMcp(home) },
    { from: path.join(home, ...LEGACY.adb), to: coreAdb(home) }];
}

// ---- the folders the user decides about
const USER_MARKS = ['.git', 'AGENTS.md', 'BITACORA.md', 'CLAUDE.md', 'package.json', 'pyproject.toml'];
// A server folder the user wrote (or develops): a project, not a part of Orb.
export const isUserProject = (dir) => USER_MARKS.some((n) => exists(path.join(dir, n)));
const layoutFile = (home) => path.join(home, CORE_DIR, LAYOUT_FILE);
const decisions = (home) => readJson(layoutFile(home))?.decided ?? {};
// 3.8.1: the general log lives in core (the owner's definition), so moving it there is the default. A «keep» an Orb 3.8.0
// remembered (its default was «keep» then) is asked about once more (carpetas.json › logsAsked); the answer given now
// is final.
const LOGS_ASKED = 2;
const logsKept = (home, done) => done.bitacora === 'keep' && (readJson(layoutFile(home))?.logsAsked ?? 0) >= LOGS_ASKED;
// 3.8.1: every MCP server lives in core\mcp (the owner's definition; 3.8.0 made the ones the user writes projects). A
// workspace that went through «Ordenar carpetas» before 3.8.1 (carpetas.json without mcpAsked) is asked once about the
// projects of its categories that are MCP servers (e.g. windows\gmail-multi-mcp), with «Mover a core» by default; the
// answer given then is final, and later ones move from Ajustes › Skills y MCP («Mover a core»).
const MCP_ASKED = 2;
const askMcpProjects = (home) => { const f = readJson(layoutFile(home)); return Boolean(f) && (f.mcpAsked ?? 0) < MCP_ASKED; };
// The user's own files at the top of the logs (not Orb's GENERAL.md, nor proyectos): what other tools read, so the
// window names where each one is now (views/layout.jsx).
const userLogFiles = (dir) => { try { return fs.readdirSync(dir, { withFileTypes: true }).filter((e) => e.isFile() && !e.name.startsWith('.') && e.name.toLowerCase() !== 'general.md').map((e) => e.name).sort(); } catch { return []; } };
// A name free in `dir` (name, name-2, name-3…).
const freeIn = (dir, name) => { let n = name; for (let i = 2; exists(path.join(dir, n)); i++) n = `${name}-${i}`; return path.join(dir, n); };

// What the window shows before anything moves. → { items, pending } with items:
//   { id, kind: 'logs' | 'adb' | 'mcp', name, from, project, choice (the default), choices, kept (the user kept it) }
// choices: 'move' (into core), 'keep', 'mcp' (core\mcp: a server Orb manages) or a category (as a project there).
// pending: something there that the user has not decided about yet.
export function planWorkspace(home) {
  const done = decisions(home);
  const items = [];
  const add = (it) => items.push({ ...it, kept: it.id === 'bitacora' ? logsKept(home, done) : done[it.id] === 'keep' });
  const logs = path.join(home, LEGACY.logs);
  if (isDir(logs)) add({ id: 'bitacora', kind: 'logs', name: LEGACY.logs, from: logs, project: false, choice: 'move', choices: ['move', 'keep'] });
  const adb = path.join(home, ...LEGACY.adb);
  if (isDir(adb)) add({ id: 'adb', kind: 'adb', name: LEGACY.adb.join(path.sep), from: adb, project: false, choice: 'move', choices: ['move', 'keep'] });
  const servers = path.join(home, LEGACY.mcp);
  let list = []; try { list = fs.readdirSync(servers, { withFileTypes: true }).filter((e) => e.isDirectory() && !e.name.startsWith('.')); } catch { /* none */ }
  // 3.8.1: every server goes into core\mcp by default, also one the user writes (it keeps working there; Ajustes › Skills
  // y MCP › «Editar en un proyecto» to improve it); a category is still a choice.
  for (const e of list) {
    const from = path.join(servers, e.name);
    add({ id: `mcp:${e.name}`, kind: 'mcp', name: `${LEGACY.mcp}${path.sep}${e.name}`, from, project: isUserProject(from), choice: MCP_DIR, choices: [MCP_DIR, ...CATEGORIES, 'keep'] });
  }
  if (askMcpProjects(home)) {
    for (const cat of CATEGORIES) {
      let found = []; try { found = fs.readdirSync(path.join(home, cat), { withFileTypes: true }).filter((e) => e.isDirectory() && !e.name.startsWith('.')); } catch { /* none */ }
      for (const e of found) {
        const from = path.join(home, cat, e.name);
        if (!isMcpProject(from) || !startCommand(from)) continue;
        const id = `mcpProject:${cat}/${e.name}`;
        items.push({ id, kind: 'mcp', name: `${cat}${path.sep}${e.name}`, from, project: true, choice: MCP_DIR, choices: [MCP_DIR, 'keep'], kept: Boolean(done[id]) });
      }
    }
  }
  return { items, pending: items.some((it) => !it.kept) };
}

function targetOf(home, item, choice) {
  if (item.kind === 'logs') return coreLogs(home);
  if (item.kind === 'adb') return coreAdb(home);
  const name = path.basename(item.from);
  if (choice === MCP_DIR) return path.join(coreMcp(home), name);
  return freeIn(path.join(home, choice), name);
}

// A folder some program is using (its working folder, an open file) cannot be renamed on Windows: tried with a rename
// to a name beside it and back, so that a move never starts on it and stops halfway.
function isHeld(dir) {
  if (process.platform !== 'win32' || !isDir(dir)) return false;
  const probe = `${dir}.orb-comprobando`;
  try { fs.renameSync(dir, probe); } catch (error) { return ['EBUSY', 'EPERM', 'EACCES'].includes(error.code); }
  for (let i = 0; ; i++) { try { fs.renameSync(probe, dir); return false; } catch (error) { if (i >= 50) throw error; sleep(100); } }
}
export class LayoutBusy extends Error {
  constructor(list, language = 'es') {
    super(translate(language, 'data.layout.busy', { paths: list.join(', ') }));
    this.code = 'busy'; this.userFacing = true; this.paths = list;
  }
}
const BUSY_CODES = ['EBUSY', 'EPERM', 'EACCES', 'ENOTEMPTY'];

// Moves the folders as the user chose. choices: { [item.id]: choice } (an item without one is left as it is,
// undecided). Throws LayoutBusy (nothing moved) when a folder to move is in use. → { moved, rewritten, logs } or null
// (logs: when the logs moved into core, { dir, files, readOnly }: where they are now and the user's own files in them,
// full paths, and which of those are read-only).
export function applyLayout(home, choices = {}, { language = 'es' } = {}) {
  const { items } = planWorkspace(home);
  const moves = []; const decided = {};
  for (const it of items) {
    const c = choices?.[it.id];
    if (c === undefined || c === null) continue;
    if (!it.choices.includes(c)) throw Object.assign(new Error(translate(language, 'data.layout.badChoice', { name: it.name })), { userFacing: true });
    decided[it.id] = c;
    if (c !== 'keep') moves.push({ from: it.from, to: targetOf(home, it, c), ...(it.kind === 'logs' ? { logs: true } : {}) });
  }
  const held = moves.filter((m) => isHeld(m.from)).map((m) => m.from);
  if (held.length) throw new LayoutBusy(held, language);
  const saved = readJson(layoutFile(home)) ?? {};
  writeJsonAtomic(layoutFile(home), { ...saved, v: 1, decided: { ...decisions(home), ...decided }, ...(decided.bitacora ? { logsAsked: LOGS_ASKED } : {}), mcpAsked: MCP_ASKED });
  if (!moves.length) return null;
  const logsMove = moves.find((m) => m.logs);
  const own = logsMove ? userLogFiles(logsMove.from) : [];
  const [state] = notes(home);
  writeJsonAtomic(state, { v: 2, home, started: new Date().toISOString(), moves: [...(readJson(state)?.moves ?? []), ...moves] });
  const r = finish(home, state, language);
  if (logsMove && !exists(logsMove.from)) {
    const files = own.map((n) => path.join(logsMove.to, n));
    // The read-only ones: Orb's agents only read them (orb_write_log never changes a file's attributes).
    const readOnly = files.filter((f) => { try { return (fs.statSync(f).mode & 0o200) === 0; } catch { return false; } });
    r.logs = { dir: logsMove.to, files, readOnly };
  }
  return r;
}

// 3.8.1: a project that is an MCP server moves into core\mcp (Ajustes › Skills y MCP › «Mover a core»): the same steps
// as «Ordenar carpetas» (checked free first, a note in case it stops halfway, orb.json and the database pointed to the new
// place). → the new folder. Throws LayoutBusy (nothing moved) when some program is using it.
export function moveIntoCore(home, from, { language = 'es' } = {}) {
  const to = path.join(coreMcp(home), path.basename(from));
  if (exists(to)) throw Object.assign(new Error(translate(language, 'ext.err.mcpExists', { name: path.basename(from) })), { userFacing: true });
  if (isHeld(from)) throw new LayoutBusy([from], language);
  const [state] = notes(home);
  writeJsonAtomic(state, { v: 2, home, started: new Date().toISOString(), moves: [...(readJson(state)?.moves ?? []), { from, to }] });
  finish(home, state, language);
  return to;
}

// The moves of a note (each one skipped when already done), then the paths, then the note goes.
function finish(home, note, language) {
  const read = readJson(note) ?? {};
  // A note of the first 3.8 builds (v1) has no list: Orb's own data was what it moved.
  const moves = Array.isArray(read.moves) ? read.moves.filter((m) => typeof m?.from === 'string' && typeof m?.to === 'string') : ownMoves(home);
  const conflicts = path.join(home, CORE_DIR, CONFLICTS_DIR, stamp());
  for (const m of moves) {
    try { move(m.from, m.to, { logs: m.logs, conflicts: path.join(conflicts, path.relative(home, m.from)) }); }
    catch (error) { if (BUSY_CODES.includes(error.code)) throw new LayoutBusy([m.from], language); throw error; }
  }
  // An emptied mcp-servers goes (one with other files in it stays, as the user left it).
  try { const s = path.join(home, LEGACY.mcp); if (isDir(s) && !fs.readdirSync(s).length) fs.rmdirSync(s); } catch { /* kept */ }
  const rewritten = rewritePaths(home, { moves });
  for (const f of notes(home)) fs.rmSync(f, { force: true });
  return { moved: moves.filter((m) => !exists(m.from)).map((m) => m.from), rewritten };
}

// The old prefix → the new one for each move (folders end with the separator, so a project called «bitacora-web» is
// not touched), also as they look inside JSON text (backslashes doubled).
export function rewritePairs(moves) {
  const s = path.sep;
  const pairs = moves.map((m) => (m.file ? [m.from, m.to] : [m.from + s, m.to + s]));
  const json = pairs.map(([a, b]) => [JSON.stringify(a).slice(1, -1), JSON.stringify(b).slice(1, -1)]).filter(([a], i) => a !== pairs[i][0]);
  return [...pairs, ...json];
}
const replaceAll = (text, pairs) => pairs.reduce((t, [a, b]) => (t.includes(a) ? t.split(a).join(b) : t), text);

// Moves `from` to `to`: one rename when `to` is not there yet; otherwise (or across volumes) entry by entry.
function move(from, to, { logs = false, conflicts }) {
  if (!exists(from)) return;
  if (!exists(to)) {
    fs.mkdirSync(path.dirname(to), { recursive: true });
    try { fs.renameSync(from, to); return; } catch (error) { if (error.code !== 'EXDEV' && !BUSY_CODES.includes(error.code)) throw error; /* another volume or held: entry by entry */ }
  }
  // A folder where a file is (or the other way round): the old one is kept aside, never lost.
  if (exists(to) && isDir(from) !== isDir(to)) { aside(from, conflicts); return; }
  if (isDir(from)) {
    if (logs && isDir(to)) { moveLogs(from, to); if (!exists(from)) return; }
    fs.mkdirSync(to, { recursive: true });
    for (const name of fs.readdirSync(from)) move(path.join(from, name), path.join(to, name), { logs, conflicts: path.join(conflicts, name) });
    fs.rmdirSync(from); // throws when something could not be moved: the next run tries again
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
  aside(from, conflicts);
}
function aside(from, conflicts) {
  fs.mkdirSync(path.dirname(conflicts), { recursive: true });
  fs.renameSync(from, exists(conflicts) ? `${conflicts}-${stamp()}` : conflicts);
}

// Orb 3.7's own data into core (and a move that stopped halfway, finished). → null when there was nothing to do, or
// { moved: [old paths], rewritten }.
export function migrateWorkspace(home, { language = 'es' } = {}) {
  const p = paths(home);
  const own = ownMoves(home).filter((m) => exists(m.from));
  const [state, oldState] = notes(home);
  if (!own.length && !exists(state) && !exists(oldState)) return null;
  if (!exists(state) && !exists(oldState)) {
    const held = own.filter((m) => !exists(m.to) && isHeld(m.from)).map((m) => m.from);
    if (held.length) throw new LayoutBusy(held, language);
    // Written before anything moves, where it moves along: inside .orb when that becomes core in one rename.
    writeJsonAtomic(isDir(path.join(home, LEGACY.internal)) && !exists(p.core) ? oldState : state, { v: 2, home, started: new Date().toISOString(), moves: ownMoves(home) });
  }
  return finish(home, exists(state) ? state : oldState, language);
}

// Inside `root` (also through a junction or a link, and for a folder not made yet: its nearest existing parent counts).
export function inside(root, target) {
  const real = (p) => {
    let at = path.resolve(p); const rest = [];
    for (;;) {
      try { return path.join(fs.realpathSync.native(at), ...rest.reverse()); } catch { /* not there: its parent */ }
      const up = path.dirname(at); if (up === at) return path.resolve(p);
      rest.push(path.basename(at)); at = up;
    }
  };
  const r = real(root).toLowerCase().replace(/[\\/]+$/, ''); const t = real(target).toLowerCase().replace(/[\\/]+$/, '');
  return t === r || t.startsWith(r + path.sep);
}

// orb.json, the database and the isolated copies' worktrees, pointed to where things moved. Safe to run again (an old
// prefix is never part of a new path). moves: what moved (by default everything 3.7 kept at the top, into core: a backup
// made by 3.7). A backup folder that now falls inside the workspace is dropped (backups never live there: the default
// one is used). → { config, db, worktrees } (what changed).
export function rewritePaths(home, { db = paths(home).db, moves = legacyMoves(home) } = {}) {
  const p = paths(home);
  const pairs = rewritePairs(moves);
  const exact = moves.map((m) => [m.from, m.to]);
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
      const fixed = fix(parsed);
      if (typeof fixed.backup?.folder === 'string' && fixed.backup.folder && inside(home, fixed.backup.folder)) { fixed.backup = { ...fixed.backup }; delete fixed.backup.folder; }
      const next = `${JSON.stringify(fixed, null, 2)}\n`;
      if (next !== `${JSON.stringify(parsed, null, 2)}\n`) {
        const tmp = `${p.config}.${process.pid}.tmp`;
        fs.writeFileSync(tmp, next); fs.renameSync(tmp, p.config); config = true;
      }
    }
  }
  return { config, db: rewriteDb(db, home, moves), worktrees: repairWorktrees(p.worktrees) };
}

// A backups' folder inside the workspace (3.7 allowed one; core\copias-seguridad is where 3.7 kept them) is dropped from
// orb.json: backups never live there (the default folder is used), and the settings can be saved again. → whether it was.
export function keepBackupsOutside(home) {
  const file = paths(home).config;
  const c = readJson(file);
  if (typeof c?.backup?.folder !== 'string' || !c.backup.folder || !inside(home, c.backup.folder)) return false;
  delete c.backup.folder;
  writeJsonAtomic(file, c);
  return true;
}

// What the user wrote stays as written: in these columns (when the row is the user's) only Orb's own .orb paths change
// (an image Orb attached), never a path the user typed.
const USER_TEXT = { chat: { body: "role = 'user'" }, session_items: { body: "role = 'user'" }, session_queue: { text: '1' } };

// Every text column of every table. → rows changed.
export function rewriteDb(file, home, moves = legacyMoves(home)) {
  if (!isFile(file)) return 0;
  const all = rewritePairs(moves);
  const ownDir = path.join(home, LEGACY.internal) + path.sep;
  const own = all.filter(([a]) => a.startsWith(ownDir) || a.startsWith(JSON.stringify(ownDir).slice(1, -1)));
  const exact = moves.map((m) => [m.from, m.to]);
  const { DatabaseSync } = process.getBuiltinModule('node:sqlite');
  const db = new DatabaseSync(file);
  let changed = 0;
  try {
    db.exec('PRAGMA busy_timeout = 8000');
    const q = (name) => `"${String(name).replace(/"/g, '""')}"`;
    const listed = db.prepare("SELECT name, sql FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'").all();
    const virtual = listed.filter((t) => /^CREATE VIRTUAL/i.test(t.sql ?? '')).map((t) => t.name);
    const tables = listed.filter((t) => !virtual.includes(t.name) && !virtual.some((v) => t.name.startsWith(`${v}_`))).map((t) => t.name);
    db.exec('BEGIN IMMEDIATE');
    try {
      for (const t of tables) {
        const cols = db.prepare(`PRAGMA table_info(${q(t)})`).all();
        const names = cols.map((c) => c.name);
        for (const c of cols) {
          if (!/^(|TEXT|.*CHAR.*|CLOB)$/i.test(String(c.type ?? '').trim())) continue;
          const col = q(c.name);
          const cond = USER_TEXT[t]?.[c.name];
          const user = Boolean(cond) && (cond === '1' || names.includes('role'));
          const groups = user ? [[`NOT (${cond})`, all], [cond, own]] : [['1', all]];
          for (const [scope, pairs] of groups) {
            if (!pairs.length) continue;
            const expr = pairs.reduce((e) => `REPLACE(${e}, ?, ?)`, col);
            const where = pairs.map(() => `instr(${col}, ?) > 0`).join(' OR ');
            changed += Number(db.prepare(`UPDATE ${q(t)} SET ${col} = ${expr} WHERE typeof(${col}) = 'text' AND (${scope}) AND (${where})`).run(...pairs.flat(), ...pairs.map(([a]) => a)).changes);
          }
          if (user) continue; // a whole cell that is an old folder is the user's text too
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

// core hidden in the Explorer on Windows (hidden only: a system attribute would make the user's own backup tools skip
// it); elsewhere nothing (the workspace is the user's). No access rules: see docs/ARCHITECTURE.md (core) for why a deny
// ACE was left out.
export function protectCore(home) {
  if (process.platform !== 'win32') return false;
  try { return spawnSync('attrib', ['-s', '+h', paths(home).core], { windowsHide: true, timeout: 5000 }).status === 0; } catch { return false; }
}
