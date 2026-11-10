// The board's projects: adding, removing, the active one and each project's log file.
// Part of the Board class (board.mjs adds these methods to it).
import fs from 'node:fs';
import path from 'node:path';
import { ctx, tr } from '../../platform/context.mjs';
import { folderName, folderKey } from '../../platform/paths.mjs';
import { projectLogHeader, logBody } from '../../platform/journal-files.mjs';
import { IGNORED_PROJECTS, FINISHED_PROJECTS, DELETING_PROJECTS } from '../../platform/state.mjs';
import { oneLine } from '../../shared/text.mjs';
import { git, isGitRepo } from '../../platform/git.mjs';
import { ROOT_LOG_MAX, now, same, checkProjectPath } from './board-common.mjs';

export class BoardProjects {
  // ---- projects
  // Agents (MCP) can only create projects; moving one to another folder is a user action (fromUser).
  addProject({ name, path: folder, notes = '' }, actor, { fromUser = false } = {}) {
    name = oneLine(name, 60);
    if (!name || !folder) throw new Error(tr('sys.board.nameAndPath'));
    const existing = this.project(name);
    if (existing && !same(existing.path, folder) && !fromUser) throw new Error(tr('sys.board.projectElsewhere', { name: existing.name }));
    const checked = existing && same(existing.path, folder) ? existing.path : checkProjectPath(folder, { fromUser });
    // One folder, one project: the same folder under another name is the project that already exists.
    const twin = !existing && this.projects().find((p) => same(p.path, checked));
    if (twin) return twin;
    this.run(`INSERT INTO projects (name, path, notes, created_at) VALUES (?, ?, ?, ?)
              ON CONFLICT(name) DO UPDATE SET path = excluded.path, notes = excluded.notes`, name, checked, String(notes ?? '').slice(0, 2000), now());
    this.ensureProjectLog(name);
    try { this.mergeRootLog(name, checked); } catch { /* the folder's log stays where it is: merged on a later add */ }
    // 3.8: a folder added (by hand, or by an agent) is listed again even if it was another user's project of 3.7.
    const ignored = this.settingJson(IGNORED_PROJECTS);
    if (Array.isArray(ignored) && ignored.includes(folderKey(checked))) this.settingJson(IGNORED_PROJECTS, ignored.filter((k) => k !== folderKey(checked)));
    // 3.8.1: and a finished one added again by hand (or by an agent) is open again.
    const finished = this.settingJson(FINISHED_PROJECTS);
    if (Array.isArray(finished) && finished.some((x) => x?.key === folderKey(checked))) this.settingJson(FINISHED_PROJECTS, finished.filter((x) => x?.key !== folderKey(checked)));
    this.event(null, actor, 'project.saved', `${name} -> ${checked}`);
    this.changed('projects');
    return this.project(name);
  }
  project(name) { return this.one('SELECT * FROM projects WHERE name = ?', String(name ?? '')); }
  // 3.8.1: between the check of «Eliminar proyecto» and its end (project-close.mjs): nothing of it starts.
  isDeleting(name) { const list = this.settingJson(DELETING_PROJECTS); return Array.isArray(list) && list.some((x) => x?.name === name); }
  projects() { return this.all('SELECT * FROM projects ORDER BY name'); }
  removeProject(name, actor) {
    const project = this.project(name); if (!project) throw new Error(tr('msg.board.noProject', { name }));
    const open = this.one("SELECT COUNT(*) AS n FROM tasks WHERE project = ? AND status IN ('queued', 'awaiting_approval', 'running')", project.name).n;
    if (open) throw new Error(tr('msg.board.projectOpenTasks', { open }));
    this.run('DELETE FROM projects WHERE name = ?', project.name);
    if (this.setting('active_project') === project.name) this.setting('active_project', '');
    this.event(null, actor, 'project.removed', `${project.name} (la carpeta no se borra)`);
    this.changed('projects');
  }

  // Each project has its log in <home>/bitacora/proyectos/<name>.md: outside the repo, so it never ends up in git.
  projectLogFile(name) { return path.join(ctx.paths.projectLogs, `${folderName(name, 'proyecto')}.md`); }
  ensureProjectLog(name) {
    const file = this.projectLogFile(name);
    if (!fs.existsSync(file)) { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, projectLogHeader(name, ctx.config?.language)); }
    return file;
  }
  // 3.8.2: a project's log under another name (a rename, a project closed or reopened). When the new name already has a
  // log, the old one is added at its end (a log only grows) and removed once the new file is read back holding it; one
  // with nothing but its header just goes. Never a second file («name (2).md») beside the first.
  moveProjectLog(from, to) {
    const oldLog = this.projectLogFile(from); const newLog = this.projectLogFile(to);
    if (oldLog === newLog || !fs.existsSync(oldLog)) return;
    if (!fs.existsSync(newLog)) { fs.renameSync(oldLog, newLog); return; }
    const body = logBody(fs.readFileSync(oldLog, 'utf8'));
    const has = () => fs.readFileSync(newLog, 'utf8').replace(/\r\n/g, '\n').includes(body);
    if (body && !has()) {
      fs.appendFileSync(newLog, `\n${body}\n`);
      if (!has()) return; // not verified: the old file stays
    }
    fs.rmSync(oldLog, { force: true });
  }
  // 3.8.2: one log system, Orb's (core\bitacora). A BITACORA.md a project brings in its folder (another tool's log) is
  // added once at the end of the project's log, whole, and removed from the folder only after the log is read back
  // holding it. One that git tracks is left in the folder (removing it would change the repository); it is not added a
  // second time (its text is already in the log). → whether it was merged.
  mergeRootLog(name, folder) {
    const src = path.join(folder, 'BITACORA.md');
    // 3.8.2 (final review): only a plain file of its own. Not a link nor a second name of another file (a hard link an
    // agent made to core\datos would put Orb's data in a log agents read), and not a huge one.
    let text; try { const st = fs.lstatSync(src); if (!st.isFile() || st.isSymbolicLink() || st.nlink > 1 || st.size > ROOT_LOG_MAX) return false; text = fs.readFileSync(src, 'utf8'); } catch { return false; }
    const whole = text.replace(/\r\n/g, '\n').trim();
    const file = this.ensureProjectLog(name);
    const has = () => fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n').includes(whole);
    if (whole && !has()) {
      fs.appendFileSync(file, `\n## ${tr('sys.logs.importedRoot', { date: new Date().toISOString().slice(0, 10) })}\n\n${whole}\n`);
      if (!has()) return false;
    }
    if (isGitRepo(folder) && git(folder, 'ls-files', '--error-unmatch', '--', 'BITACORA.md').status === 0) return true;
    try { fs.rmSync(src); } catch { /* read-only or in use: left where it is, already merged */ }
    this.event(null, 'orb', 'log.merged', `${name}: BITACORA.md`);
    return true;
  }

  // Working folder of the session ("today we work on X"): every new task goes there.
  activeName() { return this.setting('active_project') || ''; }
  activeProject() { const name = this.activeName(); return name ? this.project(name) ?? null : null; }
  setActiveProject(name, actor) {
    if (!name) { this.setting('active_project', ''); this.event(null, actor, 'project.active', 'ninguno'); this.changed('projects'); return null; }
    const project = this.project(name); if (!project) throw new Error(tr('sys.board.unknownProject', { name }));
    // 3.2: the same folder again (the assistant sets it on each request) says nothing: the notice came out again and again.
    if (this.activeName() === project.name) return project;
    this.setting('active_project', project.name);
    this.event(null, actor, 'project.active', `${project.name} -> ${project.path}`);
    this.notice(tr('msg.board.activeFolder', { name: project.name, path: project.path }), 'info');
    this.changed('projects');
    return project;
  }
}
