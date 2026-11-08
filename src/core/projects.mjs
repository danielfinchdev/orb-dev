// Projects live inside the categories of the workspace (C:\Orb\<windows|linux|ios|android|web|multi>\<proyecto>). The
// app creates them with git from the start (so every task can be undone and isolated copies are possible), and any folder
// the user creates by hand inside a category shows up too. Orb's own folder (core) is never a project.
import fs from 'node:fs';
import path from 'node:path';
import { ctx, tr } from './context.mjs';
import { folderName, isReservedName, isReservedInCategory, isCategory, categoryOf, folderKey, IGNORED_PROJECTS, FINISHED_PROJECTS, CATEGORIES, DEFAULT_CATEGORY, PLATFORMS, MULTI, SHARED_DIR } from './home.mjs';
import { git, ORB_GIT } from './workspace.mjs';
import { projectNameProblem } from './product.mjs';
import { settleDeleting, deletingProjects } from './project-close.mjs';

export const checkCategory = (category) => {
  const c = String(category ?? '').trim().toLowerCase() || DEFAULT_CATEGORY;
  if (!isCategory(c)) throw new Error(tr('msg.projects.badCategory', { category, list: CATEGORIES.join(', ') }));
  return c;
};

// 3.2.1: the name is the folder's name: refused (with the reason) when the folder could not keep it as it is.
export function checkProjectName(name) {
  const problem = projectNameProblem(name);
  if (problem) throw new Error(tr(problem, { name: String(name ?? '').trim() }));
  return String(name).normalize('NFC').trim();
}


// 3.8: a multiplatform project (category multi) is one folder and one repository: a subfolder per platform and
// compartido\ for what they share (API, design, texts, images), with a LEEME.md that says so. `platforms`: the ones it
// has (at least one; web if none).
export function createProject(board, { name, notes = '', category, platforms = [] }, actor) {
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

// 3.2.1: renames a project and, when it is a project folder of a category, its folder too (name = folder). Only when
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
  try {
    board.transaction(() => {
      board.run('UPDATE projects SET name = ?, path = ? WHERE name = ?', next, target, project.name);
      for (const table of ['tasks', 'conversations', 'sessions', 'schedules']) board.run(`UPDATE ${table} SET project = ? WHERE project = ?`, next, project.name);
      if (inside) {
        for (const t of board.all('SELECT id, workdir, project_path FROM tasks WHERE workdir = ? OR project_path = ?', project.path, project.path)) board.run('UPDATE tasks SET workdir = ?, project_path = ? WHERE id = ?', moveIn(t.workdir), moveIn(t.project_path), t.id);
        for (const s of board.all('SELECT id, cwd FROM sessions WHERE project = ?', next)) if (moveIn(s.cwd) !== s.cwd) board.run('UPDATE sessions SET cwd = ? WHERE id = ?', moveIn(s.cwd), s.id);
      }
      if (board.setting('active_project') === project.name) board.setting('active_project', next);
      const prefix = `wb_seen:${project.name}:`;
      for (const r of board.all('SELECT key FROM settings WHERE substr(key, 1, ?) = ?', prefix.length, prefix)) board.run('UPDATE settings SET key = ? WHERE key = ?', `wb_seen:${next}:${r.key.slice(prefix.length)}`, r.key);
    });
  } catch (error) {
    if (inside) { try { fs.renameSync(target, project.path); git(project.path, 'worktree', 'repair'); } catch { /* reported below */ } }
    throw error;
  }
  // The log keeps its entries (logs are only ever added to): the file just follows the new name.
  const oldLog = board.projectLogFile(project.name); const newLog = board.projectLogFile(next);
  try { if (oldLog !== newLog && fs.existsSync(oldLog) && !fs.existsSync(newLog)) fs.renameSync(oldLog, newLog); } catch { /* a new log starts */ }
  board.ensureProjectLog(next);
  board.event(null, actor, 'project.renamed', `${project.name} -> ${next}`);
  for (const what of ['projects', 'tasks', 'conversations', 'sessions']) board.changed(what);
  return board.project(next);
}

const checkPlatforms = (list) => {
  const out = [...new Set((Array.isArray(list) ? list : []).map((x) => String(x ?? '').trim().toLowerCase()).filter(Boolean))];
  for (const x of out) if (!PLATFORMS.includes(x)) throw new Error(tr('msg.projects.badCategory', { category: x, list: PLATFORMS.join(', ') }));
  return out.length ? PLATFORMS.filter((x) => out.includes(x)) : [DEFAULT_CATEGORY];
};

// One platform → its category; several (or multi) → one multiplatform project in multi with them.
export function newProject(board, { name, notes = '', category, platforms }, actor) {
  const list = Array.isArray(platforms) ? platforms : [];
  if (String(category ?? '').toLowerCase() === MULTI || list.length > 1) return createProject(board, { name, notes, category: MULTI, platforms: list }, actor);
  return createProject(board, { name, notes, category: category || list[0] }, actor);
}

// 2.7–3.7: a multiplatform project was a group (tienda-android, tienda-ios… with a shared folder <home>/comun/<name>).
// None is made any more (multi instead); the groups of a workspace of those versions still work together.
export const commonFolder = (group) => path.join(ctx.home, 'comun', folderName(group, 'proyecto'));
// The group of a project: its sister projects (with their folders) and the shared folder; null if it is on its own.
export function groupOf(board, project) {
  const p = typeof project === 'string' ? board.project(project) : project;
  if (!p?.grupo) return null;
  const members = board.all('SELECT name, path FROM projects WHERE grupo = ? ORDER BY name', p.grupo);
  return { name: p.grupo, members, common: commonFolder(p.grupo) };
}

// Keeps the project list in step with the categories: new subfolders become projects, and projects whose folder inside the
// assistant's folder was deleted, or that are not a project folder of a category (2.3.0 took the categories and Orb's own
// folders for projects), are dropped unless they still have open tasks. Linked outside folders are left alone.
// 3.8: the folders of other users' projects of 3.7 (IGNORED_PROJECTS) are not listed; 3.8.1: nor the finished ones.
const FINISHED_GONE_MS = 30 * 24 * 3_600_000;
export function syncProjects(board) {
  const home = ctx.paths.home;
  const norm = folderKey;
  const ignoredList = board.settingJson(IGNORED_PROJECTS);
  const ignored = new Set(Array.isArray(ignoredList) ? ignoredList : []);
  // 3.8.1: the finished projects (project-close.mjs) are not brought back. One whose folder is not found leaves that list
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
  // 3.8.1: a delete left half-way is settled; one under way keeps its project (its folder may already be in the Recycle
  // Bin) until the engine finishes it.
  settleDeleting(board, home);
  const deleting = new Set(deletingProjects(board).map((x) => x.name));
  let changed = false;
  // First what is gone, so a folder found again (or moved into the workspace) gets its own name, not «name (2)».
  // Inside the workspace: a folder deleted or no longer in a category. Outside: a linked folder that no longer exists
  // (one of an earlier workspace, a moved folder), unless its whole drive is missing (a disk unplugged for a while).
  // A project with open tasks stays (removeProject refuses).
  for (const p of board.projects()) {
    if (deleting.has(p.name)) continue;
    const rel = path.relative(home, p.path);
    const inside = Boolean(rel) && !rel.startsWith('..') && !path.isAbsolute(rel);
    if (inside ? fs.existsSync(p.path) && categoryOf(home, p.path) : !rel || fs.existsSync(p.path) || !fs.existsSync(path.parse(p.path).root)) continue;
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
      try { board.addProject({ name, path: folder }, 'orb', { fromUser: true }); changed = true; } catch { /* unreadable folder: skipped */ }
    }
  }
  // A project registered as «name (2)» before 3.8 (its name was held by a stale twin) takes its folder's name back once
  // that name is free.
  for (const p of board.projects()) {
    const m = /^(.+) \(\d+\)$/.exec(p.name);
    if (!m || m[1] !== path.basename(p.path) || folderName(m[1], '') !== m[1] || board.project(m[1]) || !categoryOf(home, p.path)) continue;
    try { renameProject(board, { name: p.name, to: m[1] }, 'orb'); changed = true; } catch { /* busy or not a valid name: next time */ }
  }
  // Folders not listed that no longer exist leave the list (board.addProject takes out the ones added again).
  const others = [...ignored].filter((k) => !finished.some((x) => x.key === k));
  if (others.some((k) => !present.has(k))) board.settingJson(IGNORED_PROJECTS, others.filter((k) => present.has(k)));
  return changed;
}
