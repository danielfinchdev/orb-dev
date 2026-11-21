// Projects live inside the categories of the workspace (C:\Orb\<windows|linux|ios|android|web|multi>\<proyecto>). The
// app creates them with git from the start (so every task can be undone and isolated copies are possible), and any folder
// the user creates by hand inside a category shows up too. Orb's own folder (core) is never a project.
import fs from 'node:fs';
import path from 'node:path';
import { ctx, tr } from '../../platform/context.mjs';
import { folderName, isReservedName, isReservedInCategory, isCategory, categoryOf, folderKey, CATEGORIES, DEFAULT_CATEGORY, PLATFORMS, MULTI, SHARED_DIR } from '../../platform/paths.mjs';
import { IGNORED_PROJECTS, FINISHED_PROJECTS } from '../../platform/state.mjs';
import { git, ORB_GIT } from '../../platform/git.mjs';
import { projectNameProblem } from '../../shared/product.mjs';
import { saveConfig } from '../../platform/config.mjs';
import { scopesRenamed, scopesRemoved } from '../extensions/catalog.mjs';
import { settleDeleting, deletingProjects } from './project-close.mjs';

export const checkCategory = (category) => {
  const c = String(category ?? '').trim().toLowerCase() || DEFAULT_CATEGORY;
  if (!isCategory(c)) throw new Error(tr('msg.projects.badCategory', { category, list: CATEGORIES.join(', ') }));
  return c;
};

// the name is the folder's name: refused (with the reason) when the folder could not keep it as it is.
export function checkProjectName(name) {
  const problem = projectNameProblem(name);
  if (problem) throw new Error(tr(problem, { name: String(name ?? '').trim() }));
  return String(name).normalize('NFC').trim();
}


// a multiplatform project (category multi) is one folder and one repository: a subfolder per platform and
// compartido\ for what they share (API, design, texts, images), with a LEEME.md that says so. `platforms`: the ones it
// has (at least one; web if none).
// template: false makes only the empty folder (no git repository, .gitignore, platform subfolders or first commit).
export function createProject(board, { name, notes = '', category, platforms = [], template = true }, actor) {
  const clean = String(name ?? '').normalize('NFC').trim();
  checkProjectName(clean);
  if (board.project(clean)) throw new Error(tr('msg.projects.exists', { name: clean }));
  const cat = checkCategory(category);
  const parts = cat === MULTI ? checkPlatforms(platforms) : [];
  const dir = folderName(clean, 'proyecto');
  if (isReservedName(dir)) throw new Error(tr('msg.projects.reserved', { dir, name: ctx.config.assistantName }));
  const folder = path.join(ctx.paths.categories[cat], dir);
  if (fs.existsSync(folder) && fs.readdirSync(folder).length) throw new Error(tr('msg.projects.folderNotEmpty', { folder }));
  fs.mkdirSync(folder, { recursive: true });
  if (template === false) return board.addProject({ name: clean, path: folder, notes }, actor);
  // "-b" needs git 2.28+; older versions get the default branch renamed instead. Without git the project still works
  // (undo then uses a copy of the folder), it just has no branches or GitHub.
  let init = git(folder, 'init', '-q', '-b', 'main');
  if (init.status !== 0 && init.status !== -1) { init = git(folder, 'init', '-q'); if (init.status === 0) git(folder, 'symbolic-ref', 'HEAD', 'refs/heads/main'); }
  if (init.status === 0) {
    fs.writeFileSync(path.join(folder, '.gitignore'), 'node_modules/\ndist/\n.env\n.env.*\n*.env\n!.env.example\n.orb-adjuntos/\nBITACORA.md\n');
  }
  if (parts.length) {
    for (const sub of [...parts, SHARED_DIR]) { fs.mkdirSync(path.join(folder, sub), { recursive: true }); fs.writeFileSync(path.join(folder, sub, '.gitkeep'), ''); }
    fs.writeFileSync(path.join(folder, 'LEEME.md'), tr('msg.projects.multiReadme', { name: clean, list: parts.map((x) => `${x}/`).join(', '), shared: `${SHARED_DIR}/` }));
  }
  if (init.status === 0) {
    git(folder, 'add', '.');
    git(folder, ...ORB_GIT, 'commit', '-q', '-m', tr('sys.projects.firstCommit'));
  }
  return board.addProject({ name: clean, path: folder, notes }, actor);
}

// renames a project and, when it is a project folder of a category, its folder too (name = folder). Only when
// nothing of it is working (no open tasks, no running conversation): the folder moves first and, if the database update
// fails, it moves back. Its tasks, conversations, direct conversations, schedules, working folder, whiteboard marks and
// log file follow it. A linked folder outside Orb's folder keeps its place: only the name changes.
export function renameProject(board, { name, to }, actor) {
  const project = board.project(name); if (!project) throw new Error(tr('msg.board.noProject', { name }));
  const next = checkProjectName(to);
  if (next === project.name) return project;
  const other = board.project(next);
  if (other && other.name !== project.name) throw new Error(tr('msg.projects.exists', { name: next }));
  const open = board.one("SELECT COUNT(*) AS n FROM tasks WHERE project = ? AND status IN ('queued', 'awaiting_approval', 'running')", project.name).n;
  const live = board.one("SELECT COUNT(*) AS n FROM sessions WHERE project = ? AND status = 'running'", project.name).n;
  if (open || live) throw new Error(tr('msg.projects.renameBusy', { name: project.name }));
  const home = ctx.paths.home;
  const rel = path.relative(home, project.path);
  const inside = Boolean(rel) && !rel.startsWith('..') && !path.isAbsolute(rel) && Boolean(categoryOf(home, project.path));
  let target = project.path;
  if (inside) {
    const dir = folderName(next, 'proyecto');
    if (isReservedName(dir)) throw new Error(tr('msg.projects.reserved', { dir, name: ctx.config.assistantName }));
    target = path.join(path.dirname(project.path), dir);
    if (target.toLowerCase() !== project.path.toLowerCase() && fs.existsSync(target)) throw new Error(tr('msg.github.folderExists', { folder: target }));
    try { fs.renameSync(project.path, target); } catch { throw new Error(tr('msg.projects.renameInUse', { folder: project.path })); }
    git(target, 'worktree', 'repair'); // isolated copies of old tasks keep pointing at the moved repository
  }
  const moveIn = (p) => (p && inside && (p === project.path || p.startsWith(project.path + path.sep)) ? target + p.slice(project.path.length) : p);
  // The skills and connectors scoped to it follow the new name, saved before anything else changes: if that fails the whole
  // rename fails (and the folder goes back), so the old name never stays claimable by a new project.
  const swapped = scopesRenamed(ctx.config, project.name, next);
  let scopesSaved = false;
  try {
    if (swapped) { saveConfig(swapped); scopesSaved = true; }
    board.transaction(() => {
      board.run('UPDATE projects SET name = ?, path = ? WHERE name = ?', next, target, project.name);
      for (const table of ['tasks', 'conversations', 'sessions', 'schedules']) board.run(`UPDATE ${table} SET project = ? WHERE project = ?`, next, project.name);
      if (inside) {
        for (const t of board.all('SELECT id, workdir, project_path FROM tasks WHERE workdir = ? OR project_path = ?', project.path, project.path)) board.run('UPDATE tasks SET workdir = ?, project_path = ? WHERE id = ?', moveIn(t.workdir), moveIn(t.project_path), t.id);
        for (const s of board.all('SELECT id, cwd FROM sessions WHERE project = ?', next)) if (moveIn(s.cwd) !== s.cwd) board.run('UPDATE sessions SET cwd = ? WHERE id = ?', moveIn(s.cwd), s.id);
      }
      if (board.setting('active_project') === project.name) board.setting('active_project', next);
      for (const kind of ['wb_seen', 'pr_review']) {
        const prefix = `${kind}:${project.name}:`;
        for (const r of board.all('SELECT key FROM settings WHERE substr(key, 1, ?) = ?', prefix.length, prefix)) board.run('UPDATE settings SET key = ? WHERE key = ?', `${kind}:${next}:${r.key.slice(prefix.length)}`, r.key);
      }
    });
  } catch (error) {
    if (scopesSaved) { try { saveConfig(scopesRenamed(ctx.config, next, project.name) ?? {}); } catch { try { saveConfig(scopesRemoved(ctx.config, next) ?? {}); } catch { /* reported below */ } } }
    if (inside) { try { fs.renameSync(target, project.path); git(project.path, 'worktree', 'repair'); } catch { /* reported below */ } }
    throw error;
  }
  // The log keeps its entries (logs are only ever added to): the file just follows the new name.
  try { board.moveProjectLog(project.name, next); } catch { /* a new log starts */ }
  board.ensureProjectLog(next);
  board.event(null, actor, 'project.renamed', `${project.name} -> ${next}`);
  for (const what of ['projects', 'tasks', 'conversations', 'sessions']) board.changed(what);
  return board.project(next);
}

// Tasks or conversations of the project working or waiting: its folder must not move or change under them. The engine adds
// the scheduler's holds and the coordinator (projects.setCategory, projects.sync).
export function projectHasWork(board, name) {
  const open = board.one("SELECT COUNT(*) AS n FROM tasks WHERE project = ? AND status IN ('queued', 'awaiting_approval', 'running')", name).n;
  const live = board.one("SELECT COUNT(*) AS n FROM sessions WHERE project = ? AND status = 'running'", name).n;
  return open > 0 || live > 0;
}

// Moves a project's folder to another category (<home>\<category>\<folder>), with the same guarantees as renameProject:
// nothing of it working, the folder moves first (one rename on the same volume: it is never in two places) and moves
// back if the database update fails. A multiplatform project keeps its structure, so none moves into or out of multi;
// a linked folder outside Orb's workspace never moves. → the project, or null when it is already there.
export function moveProjectCategory(board, { name, category }, actor) {
  const project = board.project(name); if (!project) throw new Error(tr('msg.board.noProject', { name }));
  // checkCategory falls back to the default one when none is given: here a destination is always required.
  if (!String(category ?? '').trim()) throw new Error(tr('msg.projects.badCategory', { category: '', list: CATEGORIES.join(', ') }));
  const to = checkCategory(category);
  const home = ctx.paths.home;
  const from = categoryOf(home, project.path);
  const dir = path.basename(project.path);
  // only a project folder directly inside its category (<home>\<category>\<project>) is Orb's to move.
  if (!from || path.dirname(project.path).toLowerCase() !== ctx.paths.categories[from].toLowerCase()) throw new Error(tr('msg.projects.moveLinked', { name: project.name }));
  if (to === from) return null;
  if (from === MULTI || to === MULTI) throw new Error(tr('msg.projects.moveMulti', { name: project.name }));
  if (projectHasWork(board, project.name)) throw new Error(tr('msg.projects.moveBusy', { name: project.name }));
  if (isReservedInCategory(to, dir) || isReservedName(dir)) throw new Error(tr('msg.projects.reserved', { dir, name: ctx.config.assistantName }));
  const target = path.join(ctx.paths.categories[to], dir);
  if (fs.existsSync(target)) throw new Error(tr('msg.projects.moveExists', { folder: target }));
  try {
    fs.mkdirSync(ctx.paths.categories[to], { recursive: true });
    fs.renameSync(project.path, target);
  } catch { throw new Error(tr('msg.projects.moveInUse', { folder: project.path })); }
  git(target, 'worktree', 'repair'); // isolated copies of old tasks keep pointing at the moved repository
  const moveIn = (p) => (p && (p === project.path || p.startsWith(project.path + path.sep)) ? target + p.slice(project.path.length) : p);
  try {
    board.transaction(() => {
      board.run('UPDATE projects SET path = ? WHERE name = ?', target, project.name);
      for (const t of board.all('SELECT id, workdir, project_path FROM tasks WHERE project = ? OR workdir = ? OR project_path = ?', project.name, project.path, project.path)) board.run('UPDATE tasks SET workdir = ?, project_path = ? WHERE id = ?', moveIn(t.workdir), moveIn(t.project_path), t.id);
      for (const s of board.all('SELECT id, cwd FROM sessions WHERE project = ?', project.name)) if (moveIn(s.cwd) !== s.cwd) board.run('UPDATE sessions SET cwd = ? WHERE id = ?', moveIn(s.cwd), s.id);
    });
  } catch (error) {
    try { fs.renameSync(target, project.path); } catch {
      throw new Error(tr('msg.projects.moveStranded', { folder: target, old: project.path, detail: String(error?.message ?? error).slice(0, 200) }));
    }
    git(project.path, 'worktree', 'repair');
    throw error;
  }
  board.event(null, actor, 'project.moved', `${project.name}: ${from} -> ${to}`);
  for (const what of ['projects', 'tasks', 'sessions']) board.changed(what);
  return board.project(project.name);
}

const checkPlatforms = (list) => {
  const out = [...new Set((Array.isArray(list) ? list : []).map((x) => String(x ?? '').trim().toLowerCase()).filter(Boolean))];
  for (const x of out) if (!PLATFORMS.includes(x)) throw new Error(tr('msg.projects.badCategory', { category: x, list: PLATFORMS.join(', ') }));
  return out.length ? PLATFORMS.filter((x) => out.includes(x)) : [DEFAULT_CATEGORY];
};

// One platform → its category; several (or multi) → one multiplatform project in multi with them.
export function newProject(board, { name, notes = '', category, platforms, template = true }, actor) {
  const list = Array.isArray(platforms) ? platforms : [];
  if (String(category ?? '').toLowerCase() === MULTI || list.length > 1) return createProject(board, { name, notes, category: MULTI, platforms: list, template }, actor);
  return createProject(board, { name, notes, category: category || list[0], template }, actor);
}

// 2.7–3.7: a multiplatform project was a group (tienda-android, tienda-ios… with a shared folder <home>/comun/<name>).
// None is made any more (multi instead); the groups of a workspace of those versions still work together.
const commonFolder = (group) => path.join(ctx.home, 'comun', folderName(group, 'proyecto'));
// The group of a project: its sister projects (with their folders) and the shared folder; null if it is on its own.
export function groupOf(board, project) {
  const p = typeof project === 'string' ? board.project(project) : project;
  if (!p?.grupo) return null;
  const members = board.all('SELECT name, path FROM projects WHERE grupo = ? ORDER BY name', p.grupo);
  return { name: p.grupo, members, common: commonFolder(p.grupo) };
}

// Keeps the project list in step with the categories: new subfolders become projects, and projects whose folder inside the
// assistant's folder was deleted, or that are not a project folder of a category (the categories and Orb's own
// folders are not projects), are dropped unless they still have open tasks. Linked outside folders are left alone.
// the folders of other users' projects of 3.7 (IGNORED_PROJECTS) are not listed, nor the finished ones.
const FINISHED_GONE_MS = 30 * 24 * 3_600_000;
// what the last pass found with nothing to change, per board: the engine looks every 5 s (and each list asked for
// every 2 s), and the real path of every folder (folderKey) costs a disk lookup per part of the path (~65 ms with 50
// projects). The same projects, folders, existence and lists as then: nothing can have changed, nothing is looked up.
// What the fingerprint cannot see (a folder of the path that starts pointing elsewhere with the same names) is looked
// at anyway by a whole pass at least once a minute (SETTLED_MS). The clock is monotonic: a
// system clock set back (NTP, by hand) must not put the whole pass off.
const settled = new WeakMap();
const SETTLED_MS = 60_000;
// Whether a project's folder is still where a project of the list may be. Inside the workspace: it exists and is in a
// category. Outside: a linked folder that exists, or whose whole drive is missing (a disk unplugged for a while).
const inPlace = (home, p) => {
  const rel = path.relative(home, p.path);
  const inside = Boolean(rel) && !rel.startsWith('..') && !path.isAbsolute(rel);
  return inside ? Boolean(fs.existsSync(p.path) && categoryOf(home, p.path)) : !rel || fs.existsSync(p.path) || !fs.existsSync(path.parse(p.path).root);
};
const openTasks = (board, name) => board.one("SELECT COUNT(*) AS n FROM tasks WHERE project = ? AND status IN ('queued', 'awaiting_approval', 'running')", name).n;
const fingerprint = (board, home, ignored, deleting) => {
  const cats = CATEGORIES.map((cat) => { try { return fs.readdirSync(ctx.paths.categories[cat], { withFileTypes: true }).map((e) => `${e.isDirectory() ? 'd' : 'f'}${e.name}`).join('/'); } catch { return '-'; } });
  // A project out of place stays while it has open tasks: how many it has is part of what was found.
  const projects = board.all('SELECT name, path FROM projects ORDER BY name').map((p) => `${p.name}|${p.path}|${inPlace(home, p) ? '' : openTasks(board, p.name)}`);
  return JSON.stringify([home, cats, projects, [...ignored].sort(), [...deleting].sort()]);
};
export function syncProjects(board) {
  const home = ctx.paths.home;
  // Each folder's real path once per pass (it was asked up to three times).
  const keys = new Map();
  const norm = (folder) => { let k = keys.get(folder); if (k === undefined) { k = folderKey(folder); keys.set(folder, k); } return k; };
  const ignoredList = board.settingJson(IGNORED_PROJECTS);
  const ignored = new Set(Array.isArray(ignoredList) ? ignoredList : []);
  // the finished projects (project-close.mjs) are not brought back. One whose folder is not found leaves that list
  // only after FINISHED_GONE_MS (a folder renamed for a while, a disk unplugged: it is still finished when it is back).
  const finishedList = board.settingJson(FINISHED_PROJECTS);
  const finished = Array.isArray(finishedList) ? finishedList.filter((x) => x && typeof x.key === 'string') : [];
  let finishedDirty = false;
  const finishedNow = finished.flatMap((x) => {
    if (fs.existsSync(x.path)) { if (!x.missingSince) return [x]; finishedDirty = true; const { missingSince, ...back } = x; return [back]; }
    if (!x.missingSince) { finishedDirty = true; return [{ ...x, missingSince: new Date().toISOString() }]; }
    if (Date.now() - Date.parse(x.missingSince) > FINISHED_GONE_MS) { finishedDirty = true; return []; }
    return [x];
  });
  if (finishedDirty) board.settingJson(FINISHED_PROJECTS, finishedNow);
  for (const x of finished) ignored.add(x.key);
  // a delete left half-way is settled; one under way keeps its project (its folder may already be in the Recycle
  // Bin) until the engine finishes it.
  settleDeleting(board, home);
  const deleting = new Set(deletingProjects(board).map((x) => x.name));
  const print = fingerprint(board, home, ignored, deleting);
  const last = settled.get(board);
  if (last?.print === print && performance.now() - last.at < SETTLED_MS) return false;
  let changed = false; let again = false; // again: something to look at again next time (changed, or failed for now)
  // First what is gone, so a folder found again (or moved into the workspace) gets its own name, not «name (2)».
  // Inside the workspace: a folder deleted or no longer in a category. Outside: a linked folder that no longer exists
  // (one of an earlier workspace, a moved folder), unless its whole drive is missing (a disk unplugged for a while).
  // A project with open tasks stays (removeProject refuses).
  for (const p of board.projects()) {
    if (deleting.has(p.name) || inPlace(home, p)) continue;
    try { board.removeProject(p.name, 'orb'); changed = true; } catch { /* open tasks: kept */ }
  }
  const byPath = new Map(board.projects().map((p) => [norm(p.path), p]));
  const present = new Set();
  for (const cat of CATEGORIES) {
    let entries; try { entries = fs.readdirSync(ctx.paths.categories[cat], { withFileTypes: true }); } catch { continue; }
    for (const e of entries) {
      if (!e.isDirectory() || isReservedInCategory(cat, e.name)) continue;
      const folder = path.join(ctx.paths.categories[cat], e.name);
      present.add(norm(folder));
      if (byPath.has(norm(folder)) || ignored.has(norm(folder))) continue;
      // The same folder name in two categories: the second says which one («app (android)»), never a bare number.
      let name = e.name;
      if (board.project(name)) { name = `${e.name} (${cat})`; for (let i = 2; board.project(name); i++) name = `${e.name} (${cat} ${i})`; }
      try { board.addProject({ name, path: folder }, 'orb', { fromUser: true }); changed = true; } catch { again = true; /* unreadable folder: skipped */ }
    }
  }
  // A project registered as «name (2)» before 3.8 (its name was held by a stale twin) takes its folder's name back once
  // that name is free.
  for (const p of board.projects()) {
    const m = /^(.+) \(\d+\)$/.exec(p.name);
    if (!m || m[1] !== path.basename(p.path) || folderName(m[1], '') !== m[1] || board.project(m[1]) || !categoryOf(home, p.path)) continue;
    try { renameProject(board, { name: p.name, to: m[1] }, 'orb'); changed = true; } catch { again = true; /* busy or not a valid name: next time */ }
  }
  // Folders not listed that no longer exist leave the list (board.addProject takes out the ones added again).
  const others = [...ignored].filter((k) => !finished.some((x) => x.key === k));
  if (others.some((k) => !present.has(k))) { board.settingJson(IGNORED_PROJECTS, others.filter((k) => present.has(k))); again = true; }
  if (changed || again) settled.delete(board); else settled.set(board, { print, at: performance.now() });
  return changed;
}
