// 3.8.1: the end of a project (Proyectos › right click, or «…»):
//   - finishProject: everything of it is closed (its pending tasks cancelled, its tasks, conversations and direct
//     conversations in «Completadas», its schedules paused) and it leaves Orb's lists, while its folder stays where it
//     is. FINISHED_PROJECTS remembers it, so the project sync (projects.mjs › syncProjects) does not bring it back;
//     reopenProject lists it again (and turns its schedules back on).
//   - deleteProject: its folder goes (to the Recycle Bin: main.mjs moves it there with Electron and then tells the
//     engine; permanently only when the user chose so) and it leaves Orb. Behind the master password (permissions.mjs ›
//     UNLOCK_METHODS) and only from this PC. deletableFolder decides what may go: only a project folder straight inside
//     a category of the workspace, compared by real path (a junction or a link never leads out of it), never a
//     category, core or the workspace itself.
// Both refuse while something of the project works (a task running, a direct conversation answering).
// No engine imports: the engine and the app's main process (the check before the Recycle Bin) use it.
import fs from 'node:fs';
import path from 'node:path';
import { tr } from './context.mjs';
import { CATEGORIES, folderKey, isReservedInCategory, FINISHED_PROJECTS } from './home.mjs';

// FINISHED_PROJECTS (a setting): [{ name, path, key (folderKey), category, at, schedules (the ones it paused) }]
const SIDEBAR_DONE = 'sidebar_completed'; // the «Completadas» of the sidebar (api.mjs › sidebar.complete)
const PENDING = ['queued', 'awaiting_approval', 'limited', 'blocked'];

const userError = (key, vars) => Object.assign(new Error(tr(key, vars)), { userFacing: true });
const realLower = (p) => fs.realpathSync.native(p).replace(/^\\\\\?\\/, '').toLowerCase();

// The real path of a project folder that may be deleted, or a user-facing error. home: the workspace.
export function deletableFolder(home, folder) {
  const refuse = () => { throw userError('msg.projects.notDeletable'); };
  if (typeof folder !== 'string' || !path.isAbsolute(folder)) refuse();
  let st; try { st = fs.lstatSync(folder); } catch { throw userError('msg.projects.folderGone', { folder }); }
  if (st.isSymbolicLink() || !st.isDirectory()) refuse(); // a link or a junction: never followed out of the workspace
  let real; let root;
  try { real = realLower(folder); root = realLower(home); } catch { refuse(); }
  const parts = path.relative(root, real).split(path.sep);
  if (parts.length !== 2 || parts.some((x) => !x || x === '..') || path.isAbsolute(parts[0])) refuse();
  const [category, name] = parts;
  if (!CATEGORIES.includes(category) || isReservedInCategory(category, name)) refuse();
  // The category itself is the workspace's own folder (not a link to somewhere else).
  try { if (realLower(path.join(home, category)) !== path.join(root, category)) refuse(); } catch { refuse(); }
  return fs.realpathSync.native(folder);
}

// Something of the project working now: a task running, or a direct conversation answering.
function refuseBusy(board, name) {
  const tasks = board.one("SELECT COUNT(*) AS n FROM tasks WHERE project = ? AND status = 'running'", name).n;
  const live = board.one("SELECT COUNT(*) AS n FROM sessions WHERE project = ? AND status = 'running'", name).n;
  if (tasks || live) throw userError('msg.projects.busyRunning', { name });
}
const mustProject = (board, name) => { const p = board.project(name); if (!p) throw userError('msg.board.noProject', { name }); return p; };

// Its pending tasks cancelled, and every task, conversation and direct conversation of it in «Completadas».
function closeAll(board, name, actor) {
  for (const t of board.all(`SELECT id FROM tasks WHERE project = ? AND status IN (${PENDING.map(() => '?').join(', ')})`, name, ...PENDING)) board.cancel(t.id, actor);
  const keys = board.all('SELECT id FROM tasks WHERE project = ? ORDER BY id DESC', name).map((t) => `t${t.id}`);
  const done = board.settingJson(SIDEBAR_DONE) ?? [];
  board.settingJson(SIDEBAR_DONE, [...keys.filter((k) => !done.includes(k)), ...done].slice(0, 2000));
  for (const c of board.all("SELECT id FROM conversations WHERE project = ? AND status = 'open'", name)) board.setConversationDone(c.id, true);
  board.run('UPDATE sessions SET settled = 1 WHERE project = ?', name);
  for (const what of ['tasks', 'conversations', 'sessions', 'sidebar']) board.changed(what);
}

export const finishedProjects = (board) => { const list = board.settingJson(FINISHED_PROJECTS); return Array.isArray(list) ? list.filter((x) => x && typeof x.key === 'string') : []; };
// The folders the project sync leaves alone.
export const finishedKeys = (board) => new Set(finishedProjects(board).map((x) => x.key));

export function finishProject(board, name, actor, { category = null } = {}) {
  const p = mustProject(board, name);
  refuseBusy(board, p.name);
  closeAll(board, p.name, actor);
  const schedules = board.all('SELECT id FROM schedules WHERE project = ? AND enabled = 1', p.name).map((s) => s.id);
  if (schedules.length) { board.run(`UPDATE schedules SET enabled = 0 WHERE id IN (${schedules.map(() => '?').join(', ')})`, ...schedules); board.changed('schedules'); }
  const key = folderKey(p.path);
  board.settingJson(FINISHED_PROJECTS, [{ name: p.name, path: p.path, key, category, at: new Date().toISOString(), schedules }, ...finishedProjects(board).filter((x) => x.key !== key)].slice(0, 500));
  board.removeProject(p.name, actor);
  board.event(null, actor, 'project.finished', p.name);
  return { name: p.name };
}

// Listed again (under its own name, or «name (category)» when another project took it meanwhile).
export function reopenProject(board, key, actor) {
  const item = finishedProjects(board).find((x) => x.key === String(key ?? ''));
  if (!item) throw userError('msg.projects.notFinished');
  if (!fs.existsSync(item.path)) {
    board.settingJson(FINISHED_PROJECTS, finishedProjects(board).filter((x) => x.key !== item.key));
    throw userError('msg.projects.folderGone', { folder: item.path });
  }
  let name = item.name;
  const taken = (n) => { const o = board.project(n); return o && folderKey(o.path) !== item.key; };
  if (taken(name)) { const base = `${item.name} (${item.category ?? 'proyecto'})`; name = base; for (let i = 2; taken(name); i++) name = `${base.slice(0, -1)} ${i})`; }
  board.settingJson(FINISHED_PROJECTS, finishedProjects(board).filter((x) => x.key !== item.key));
  const p = board.addProject({ name, path: item.path }, actor, { fromUser: true });
  const ids = (Array.isArray(item.schedules) ? item.schedules : []).map(Number).filter(Number.isInteger);
  if (ids.length) { board.run(`UPDATE schedules SET enabled = 1 WHERE project = ? AND id IN (${ids.map(() => '?').join(', ')})`, p.name, ...ids); board.changed('schedules'); }
  board.event(null, actor, 'project.reopened', p.name);
  return p;
}

// What deleting would remove (the engine's check before main.mjs moves the folder to the Recycle Bin). → { name, path }
export function checkDelete(board, home, name) {
  const p = mustProject(board, name);
  refuseBusy(board, p.name);
  return { name: p.name, path: deletableFolder(home, p.path) };
}

// trashed: main.mjs already moved the folder to the Recycle Bin (it must be gone); otherwise it is deleted here, for
// good (the user chose so when the Recycle Bin could not take it).
export function deleteProject(board, home, name, actor, { trashed = false } = {}) {
  const { name: n, path: folder } = trashed ? { name: mustProject(board, name).name, path: null } : checkDelete(board, home, name);
  const p = board.project(n);
  if (trashed) { refuseBusy(board, n); if (fs.existsSync(p.path)) throw userError('msg.projects.notTrashed'); }
  else fs.rmSync(folder, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  closeAll(board, n, actor);
  for (const s of board.all('SELECT id FROM schedules WHERE project = ?', n)) board.run('DELETE FROM schedules WHERE id = ?', s.id);
  board.changed('schedules');
  board.removeProject(n, actor);
  board.event(null, actor, 'project.deleted', `${n} -> ${p.path}${trashed ? ' (papelera)' : ''}`);
  return { name: n, trashed };
}
