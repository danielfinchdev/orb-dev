// 3.8.1: the end of a project (Proyectos › right click, or «…»):
//   - finishProject: everything of it is closed (its pending tasks cancelled, its tasks, conversations and direct
//     conversations in «Completadas», its schedules paused) and it leaves Orb's lists, while its folder stays where it
//     is. FINISHED_PROJECTS remembers it, so the project sync (projects.mjs › syncProjects) does not bring it back;
//     reopenProject lists it again (and turns its schedules back on).
//   - deleteProject: its folder goes (to the Recycle Bin: the app moves it there, src-tauri/src/delete.rs, and then tells the
//     engine; permanently only when the Recycle Bin could not take it and the user chose so) and it leaves Orb. Behind
//     the master password (permissions.mjs › UNLOCK_METHODS) and only from this PC. deletableFolder decides what may go:
//     only a project folder straight inside a category of the workspace, compared by real path (a junction or a link
//     never leads out of it), never a category, core or the workspace itself.
// Both refuse while something of the project works (a task running, a direct conversation or a coordinator answering).
// The tasks, conversations, direct conversations and schedules of a project are tied to it by NAME: when it leaves Orb
// they move to a name of their own («name: finalizado», «name: eliminado»; never a project's name, since «:» cannot be
// in one), so a project that takes the name later starts clean, and a reopened one gets them back under the name it
// gets then (as renameProject moves them).
// Deleting is two steps with the Recycle Bin in between (the app): checkDelete marks the project as being deleted
// (DELETING_PROJECTS: nothing of it starts — board.createTask, the scheduler and the direct conversations refuse —, its
// pending tasks are cancelled and its schedules paused) and returns a one-off ticket; deleteProject (with that ticket)
// finishes, abortDelete undoes it. One left half-way (the app closed meanwhile, or the ticket expired) is settled by
// settleDeleting: finished if its folder is gone, undone if it is still there.
// No engine imports: the engine uses it, and the tests directly.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { tr } from './context.mjs';
import { CATEGORIES, folderKey, isReservedInCategory, FINISHED_PROJECTS, DELETING_PROJECTS } from './home.mjs';

// FINISHED_PROJECTS (a setting): [{ name, path, key (folderKey), category, at, schedules (the ones it paused),
//   archived (the name its rows wait under), missingSince (its folder not found since then) }]
// DELETING_PROJECTS (a setting): [{ name, path, schedules (the ones it paused), ticket, until }]
const SIDEBAR_DONE = 'sidebar_completed'; // the «Completadas» of the sidebar (api.mjs › sidebar.complete)
const PENDING = ['queued', 'awaiting_approval', 'limited', 'blocked'];
const ROW_TABLES = ['tasks', 'conversations', 'sessions', 'schedules'];
export const TICKET_MS = 30 * 60_000; // the user may think about «Reintentar» or «Borrar para siempre» for a while
const sleep = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

const userError = (key, vars) => Object.assign(new Error(tr(key, vars)), { userFacing: true });
const realLower = (p) => fs.realpathSync.native(p).replace(/^\\\\\?\\/, '').toLowerCase();

// The real path of a project folder that may be deleted, or a user-facing error. home: the workspace.
export function deletableFolder(home, folder) {
  const refuse = () => { throw userError('msg.projects.notDeletable'); };
  if (typeof folder !== 'string' || !path.isAbsolute(folder)) refuse();
  putBack(folder); // a probe of an earlier try (folderInUse) that could not give the name back then
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

// Some program is using the folder (its working folder, an open file): Windows does not let it be renamed. Tried with a
// rename to a name beside it and back (as core-folder.mjs › isHeld) before anything is deleted, so a permanent delete
// does not stop half-way on a file in use. The folder never stays under the probe's name without saying where it is:
// a probe left by an earlier try gets its name back first (putBack).
const PROBE = '.orb-comprobando-';
export function putBack(dir) {
  if (fs.existsSync(dir)) return true;
  const base = path.basename(dir); let names = [];
  try { names = fs.readdirSync(path.dirname(dir)).filter((n) => n.startsWith(`${base}${PROBE}`) && n.length === base.length + PROBE.length + 6); } catch { return true; }
  for (const n of names) { try { fs.renameSync(path.join(path.dirname(dir), n), dir); return true; } catch { return false; } }
  return true;
}
export function folderInUse(dir) {
  if (process.platform !== 'win32') return false;
  if (!putBack(dir)) return true;
  try { if (!fs.statSync(dir).isDirectory()) return false; } catch { return false; }
  const probe = `${dir}${PROBE}${crypto.randomBytes(3).toString('hex')}`;
  try { fs.renameSync(dir, probe); } catch (error) { return ['EBUSY', 'EPERM', 'EACCES'].includes(error.code); }
  for (let i = 0; ; i++) { try { fs.renameSync(probe, dir); return false; } catch { if (i >= 50) throw userError('msg.projects.probeStuck', { path: probe }); sleep(100); } }
}

// Something of the project working now: a task running, a direct conversation answering, or (busy) a coordinator in the
// middle of a turn in one of its conversations (it could create a task right after).
function refuseBusy(board, name, busy) {
  const tasks = board.one("SELECT COUNT(*) AS n FROM tasks WHERE project = ? AND status = 'running'", name).n;
  const live = board.one("SELECT COUNT(*) AS n FROM sessions WHERE project = ? AND status = 'running'", name).n;
  if (tasks || live || busy?.(name)) throw userError('msg.projects.busyRunning', { name });
}
const mustProject = (board, name) => { const p = board.project(name); if (!p) throw userError('msg.board.noProject', { name }); return p; };
const cancelPending = (board, name, actor) => {
  for (const t of board.all(`SELECT id FROM tasks WHERE project = ? AND status IN (${PENDING.map(() => '?').join(', ')})`, name, ...PENDING)) {
    try { board.cancel(t.id, actor); } catch { /* finished meanwhile */ }
  }
};
const pauseSchedules = (board, name) => {
  const ids = board.all('SELECT id FROM schedules WHERE project = ? AND enabled = 1', name).map((s) => s.id);
  if (ids.length) { board.run(`UPDATE schedules SET enabled = 0 WHERE id IN (${ids.map(() => '?').join(', ')})`, ...ids); board.changed('schedules'); }
  return ids;
};
const resumeSchedules = (board, name, list) => {
  const ids = (Array.isArray(list) ? list : []).map(Number).filter(Number.isInteger);
  if (ids.length) { board.run(`UPDATE schedules SET enabled = 1 WHERE project = ? AND id IN (${ids.map(() => '?').join(', ')})`, name, ...ids); board.changed('schedules'); }
};

// Its pending tasks cancelled, and every task, conversation and direct conversation of it in «Completadas».
function closeAll(board, name, actor) {
  cancelPending(board, name, actor);
  const keys = board.all('SELECT id FROM tasks WHERE project = ? ORDER BY id DESC', name).map((t) => `t${t.id}`);
  const done = board.settingJson(SIDEBAR_DONE) ?? [];
  board.settingJson(SIDEBAR_DONE, [...keys.filter((k) => !done.includes(k)), ...done].slice(0, 2000));
  for (const c of board.all("SELECT id FROM conversations WHERE project = ? AND status = 'open'", name)) board.setConversationDone(c.id, true);
  board.run('UPDATE sessions SET settled = 1 WHERE project = ?', name);
  for (const what of ['tasks', 'conversations', 'sessions', 'sidebar']) board.changed(what);
}

// The rows of a project (and its log) under another name, as renameProject moves them.
const rowsUnder = (board, name) => ROW_TABLES.some((table) => board.one(`SELECT 1 AS x FROM ${table} WHERE project = ? LIMIT 1`, name));
function moveRows(board, from, to) {
  if (from === to) return;
  for (const table of ROW_TABLES) board.run(`UPDATE ${table} SET project = ? WHERE project = ?`, to, from);
  const oldLog = board.projectLogFile(from); const newLog = board.projectLogFile(to);
  try { if (oldLog !== newLog && fs.existsSync(oldLog) && !fs.existsSync(newLog)) fs.renameSync(oldLog, newLog); } catch { /* the log stays where it was */ }
  for (const what of ROW_TABLES) board.changed(what);
}
// A name of their own for the rows of a project that leaves Orb (kind: 'finished' | 'deleted'), free in every table.
function archiveName(board, name, kind) {
  const base = tr(`sys.projects.archived.${kind}`, { name });
  let n = base; for (let i = 2; board.project(n) || rowsUnder(board, n); i++) n = `${base} (${i})`;
  return n;
}

export const finishedProjects = (board) => { const list = board.settingJson(FINISHED_PROJECTS); return Array.isArray(list) ? list.filter((x) => x && typeof x.key === 'string') : []; };
// The folders the project sync leaves alone.
export const finishedKeys = (board) => new Set(finishedProjects(board).map((x) => x.key));

export function finishProject(board, name, actor, { category = null, busy } = {}) {
  const p = mustProject(board, name);
  if (isDeleting(board, p.name)) throw userError('msg.projects.deleting', { name: p.name });
  refuseBusy(board, p.name, busy);
  closeAll(board, p.name, actor);
  const schedules = pauseSchedules(board, p.name);
  const key = folderKey(p.path);
  board.removeProject(p.name, actor);
  const archived = archiveName(board, p.name, 'finished');
  moveRows(board, p.name, archived);
  board.settingJson(FINISHED_PROJECTS, [{ name: p.name, path: p.path, key, category, at: new Date().toISOString(), schedules, archived }, ...finishedProjects(board).filter((x) => x.key !== key)].slice(0, 500));
  board.event(null, actor, 'project.finished', p.name);
  return { name: p.name };
}

// Listed again (under its own name, or «name (category)» when another project took it meanwhile), with its tasks,
// conversations and schedules under that name and the schedules it paused turned on again.
export function reopenProject(board, key, actor) {
  const item = finishedProjects(board).find((x) => x.key === String(key ?? ''));
  if (!item) throw userError('msg.projects.notFinished');
  if (!fs.existsSync(item.path)) throw userError('msg.projects.folderGone', { folder: item.path });
  let name = item.name;
  const taken = (n) => { const o = board.project(n); return Boolean(o && folderKey(o.path) !== item.key) || (n !== item.name && rowsUnder(board, n)); };
  if (taken(name)) { const base = `${item.name} (${item.category ?? 'proyecto'})`; name = base; for (let i = 2; taken(name); i++) name = `${base.slice(0, -1)} ${i})`; }
  // Its rows wait under their own name (one finished before that existed: under its name, when no project has it).
  const from = item.archived ?? (board.project(item.name) ? null : item.name);
  if (from) moveRows(board, from, name);
  board.settingJson(FINISHED_PROJECTS, finishedProjects(board).filter((x) => x.key !== item.key));
  const p = board.addProject({ name, path: item.path }, actor, { fromUser: true });
  if (from) resumeSchedules(board, p.name, item.schedules);
  board.event(null, actor, 'project.reopened', p.name);
  return p;
}

// ---- deleting
export const deletingProjects = (board) => { const list = board.settingJson(DELETING_PROJECTS); return Array.isArray(list) ? list.filter((x) => x && typeof x.name === 'string') : []; };
export const isDeleting = (board, name) => deletingProjects(board).some((x) => x.name === name);
const dropDeleting = (board, name) => board.settingJson(DELETING_PROJECTS, deletingProjects(board).filter((x) => x.name !== name));
const sameTicket = (a, b) => typeof a === 'string' && typeof b === 'string' && a.length === b.length && crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
function entryFor(board, name, ticket) {
  const entry = deletingProjects(board).find((x) => x.name === name);
  if (!entry || !sameTicket(entry.ticket, ticket) || !(entry.until > Date.now())) throw userError('msg.projects.deleteExpired', { name });
  return entry;
}

// The engine's check before the app moves the folder to the Recycle Bin: what would go, and from now on nothing of the
// project starts (marked as being deleted, its pending tasks cancelled, its schedules paused). A check left from before
// (the window closed half-way) is undone first. → { name, path, ticket } (the ticket: for deleteProject or abortDelete,
// one use, valid TICKET_MS).
export function checkDelete(board, home, name, { busy } = {}) {
  const p = mustProject(board, name);
  if (isDeleting(board, p.name)) abortDelete(board, p.name, null, { force: true });
  refuseBusy(board, p.name, busy);
  const folder = deletableFolder(home, p.path);
  const ticket = crypto.randomBytes(24).toString('hex');
  // Marked first: a task an agent creates from now on is refused (board.createTask), so nothing slips in between.
  board.settingJson(DELETING_PROJECTS, [...deletingProjects(board), { name: p.name, path: p.path, schedules: [], ticket, until: Date.now() + TICKET_MS }]);
  cancelPending(board, p.name, 'orb');
  const schedules = pauseSchedules(board, p.name);
  board.settingJson(DELETING_PROJECTS, deletingProjects(board).map((x) => (x.name === p.name ? { ...x, schedules } : x)));
  board.changed('projects');
  return { name: p.name, path: folder, ticket };
}

// The delete given up (the user cancelled, or it could not be done): the project works again and its schedules are back.
// force: without the ticket (settleDeleting, or a new check).
export function abortDelete(board, name, ticket, { force = false } = {}) {
  const entry = force ? deletingProjects(board).find((x) => x.name === name) : entryFor(board, name, ticket);
  if (!entry) return { name };
  dropDeleting(board, name);
  if (board.project(name)) resumeSchedules(board, name, entry.schedules);
  board.changed('projects');
  return { name };
}

// Finishes a delete started by checkDelete (ticket: the one it returned; force: without it, settleDeleting).
//   trashed: the app already moved the folder to the Recycle Bin (it must be gone). What still works in it is stopped
//     (stop(name): the engine stops its running tasks and direct conversations) instead of refusing: the folder is gone.
//   otherwise: deleted here for good (the user chose so after the Recycle Bin could not take it). Refused, with nothing
//     deleted, while some program uses the folder; one that stops half-way says what is left.
export function deleteProject(board, home, name, actor, { ticket, trashed = false, stop = () => {}, force = false } = {}) {
  const p = mustProject(board, name);
  if (!force) entryFor(board, p.name, ticket);
  if (trashed) {
    if (fs.existsSync(p.path)) throw userError('msg.projects.notTrashed');
  } else {
    const folder = deletableFolder(home, p.path);
    refuseBusy(board, p.name);
    if (folderInUse(folder)) throw userError('msg.projects.folderInUse', { path: folder });
    try { fs.rmSync(folder, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); } catch {
      if (fs.existsSync(folder)) {
        // Part of it is gone: the project stays in Orb (its schedules paused) and the user can delete it again.
        dropDeleting(board, p.name); board.changed('projects');
        throw userError('msg.projects.partlyDeleted', { path: folder });
      }
    }
  }
  try { stop(p.name); } catch { /* each one is stopped as it can be */ }
  dropDeleting(board, p.name);
  closeAll(board, p.name, actor);
  for (const t of board.all("SELECT id FROM tasks WHERE project = ? AND status = 'running'", p.name)) { try { board.cancel(t.id, actor); } catch { /* finished meanwhile */ } }
  board.run('DELETE FROM schedules WHERE project = ?', p.name);
  board.changed('schedules');
  board.removeProject(p.name, actor);
  moveRows(board, p.name, archiveName(board, p.name, 'deleted'));
  board.event(null, actor, 'project.deleted', `${p.name} -> ${p.path}${trashed ? ' (papelera)' : ''}`);
  return { name: p.name, trashed };
}

// The deletes left half-way: all (when the engine starts: no ticket outlives it) or the expired ones (the project sync,
// every few seconds). Its folder gone (the Recycle Bin took it): the delete is finished; still there: undone.
export function settleDeleting(board, home, { all = false } = {}) {
  for (const entry of deletingProjects(board)) {
    if (!all && entry.until > Date.now()) continue;
    try {
      if (board.project(entry.name) && !fs.existsSync(entry.path)) deleteProject(board, home, entry.name, 'orb', { trashed: true, force: true });
      else abortDelete(board, entry.name, null, { force: true });
    } catch { dropDeleting(board, entry.name); }
  }
}
