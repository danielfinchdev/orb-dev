// Window actions of projects (create, import, finish, delete, git and GitHub) and of the phone's Android tools.
import path from 'node:path';
import { ctx, tr } from '../../platform/context.mjs';
import { categoryOf, CATEGORIES, PLATFORMS } from '../../platform/paths.mjs';
import { newProject, checkProjectName, renameProject } from '../../domain/projects/projects.mjs';
import { finishProject, finishedProjects, reopenProject, checkDelete, deleteProject, abortDelete } from '../../domain/projects/project-close.mjs';
import { oneLine } from '../../shared/text.mjs';
import { adbStatus, ensureAdb } from '../host/android.mjs';
import { projectIcon, setProjectIcon, clearProjectIcon, renameProjectIcon } from '../project-icons.mjs';
import { git } from '../../platform/git.mjs';
import { fail, str, oneOf } from './common.mjs';
import { fold } from '../../domain/conversations/inbox.mjs';
import { lazy } from './common.mjs';

const prNumber = (v) => {
  const n = typeof v === 'string' && /^\d{1,7}$/.test(v) ? Number(v) : v;
  if (!Number.isInteger(n) || n < 1 || n > 10_000_000) fail(tr('msg.api.invalid', { name: 'número' }));
  return n;
};
const headOid = (v) => {
  if (typeof v !== 'string' || !/^[0-9a-f]{40}$/i.test(v)) fail(tr('msg.github.prNeedsHeadOid'));
  return v.toLowerCase();
};
const gh = lazy(() => import('../host/github.mjs'));

export function projectMethods({ realHome, insideHome, project, holding, coordinatorBusy, syncSoon, cut, android, grants, board, sessions, scheduler, log }) {
  const methods = {
    'projects.list': () => {
      syncSoon();
      const active = board.activeName();
      // the open tasks of every project in one query (not one per project).
      const open = new Map(board.all("SELECT project, COUNT(*) AS n FROM tasks WHERE status IN ('queued', 'awaiting_approval', 'running') GROUP BY project").map((r) => [r.project, r.n]));
      return board.projects().map((p) => ({ ...p, inHome: insideHome(p.path), category: categoryOf(realHome, p.path), active: active === p.name, open: open.get(p.name) ?? 0 }));
    },
    // category multi (or several platforms) = one multiplatform project with a folder per platform.
    'projects.create': ({ name, notes, category, platforms }) => board.project(newProject(board, {
      name: str(name, 'nombre', 60), notes: str(notes, 'notas', 2000, { optional: true }), category: oneOf(category, CATEGORIES, 'categoría', undefined),
      platforms: Array.isArray(platforms) ? platforms.slice(0, PLATFORMS.length).map((c) => oneOf(c, PLATFORMS, 'plataforma')) : []
    }, 'usuario').name),
    'projects.import': ({ name, folder }) => board.addProject({ name: checkProjectName(str(name, 'nombre', 60)), path: str(folder, 'carpeta', 1000) }, 'usuario', { fromUser: true }),
    'projects.remove': ({ name }) => board.removeProject(project(name).name, 'usuario'),
    // a new name (and folder) for a project with nothing working in it (domain/projects/projects.mjs renameProject).
    'projects.rename': ({ name, to }) => {
      const from = project(name).name;
      const p = renameProject(board, { name: from, to: str(to, 'nombre', 60) }, 'usuario');
      renameProjectIcon(from, p.name);
      return p;
    },
    'projects.setActive': ({ name }) => board.setActiveProject(name ? project(name).name : '', 'usuario'),
    // the end of a project (src/domain/projects/project-close.mjs). Finished: it leaves Orb, its folder stays (listed in
    // «Finalizados» to reopen it). Deleted: its folder goes too. The app: projects.deleteCheck (the master password; from
    // then on nothing of the project starts, and it returns a one-off ticket), the Recycle Bin, then projects.delete with
    // that ticket (trashed; or, when the Recycle Bin could not take it and the user chose so, the engine deletes it for
    // good) or projects.deleteAbort (cancelled: it works again, its schedules back on).
    'projects.finish': ({ name }) => { const p = project(name); return finishProject(board, p.name, 'usuario', { category: categoryOf(realHome, p.path), busy: coordinatorBusy }); },
    'projects.finished': () => finishedProjects(board).map(({ key, name, path: folder, category, at }) => ({ key, name, path: folder, category: category ?? null, at })),
    'projects.reopen': ({ key }) => reopenProject(board, str(key, 'proyecto', 2000), 'usuario').name,
    'projects.deleteCheck': ({ name }) => {
      const out = checkDelete(board, ctx.home, project(name).name, { busy: coordinatorBusy });
      // Its direct conversations' processes (idle, but working in that folder) are closed, so the folder can go.
      for (const s of board.all('SELECT id FROM sessions WHERE project = ?', out.name)) sessions.closeLive(s.id);
      return out;
    },
    'projects.delete': ({ name, ticket, trashed }) => {
      const p = project(name);
      if (scheduler.held(p.name)) throw new Error(tr('msg.scheduler.projectBusy')); // a close or a join is working in its folder
      const stop = (n) => {
        for (const t of board.all("SELECT id FROM tasks WHERE project = ? AND status = 'running'", n)) { try { scheduler.cancel(t.id, 'usuario'); } catch { /* finished meanwhile */ } }
        for (const s of board.all('SELECT id FROM sessions WHERE project = ?', n)) { sessions.stop(s.id); sessions.closeLive(s.id); }
        // and its tasks' isolated copies (core\copias\aisladas) go with it, never left behind for ever.
        for (const t of board.all('SELECT * FROM tasks WHERE project = ? AND workdir IS NOT NULL', n)) { try { scheduler.dropCopy(t, p); } catch (error) { log(`borrar copia #${t.id}: ${error.message}`); } }
      };
      const out = deleteProject(board, ctx.home, p.name, 'usuario', { ticket: typeof ticket === 'string' ? ticket : '', trashed: trashed === true, stop });
      clearProjectIcon(p);
      return out;
    },
    'projects.deleteAbort': ({ name, ticket }) => abortDelete(board, str(name, 'proyecto', 200), typeof ticket === 'string' ? ticket : ''),
    // the projects' icons (their favicon or app icon, or one chosen here) for the sidebar: { name: dataUrl | null }.
    'projects.icons': () => Object.fromEntries(board.projects().map((x) => [x.name, projectIcon(x)])),
    'projects.setIcon': ({ name, path: file }) => { const p = project(name); const icon = setProjectIcon(p, str(file, 'imagen', 1000)); board.changed('projects'); return icon; },
    // only the current branch (the hover card of a conversation): one quick git call, nothing from the network.
    'projects.branch': ({ name }) => { const p = project(name); const r = git(p.path, 'rev-parse', '--abbrev-ref', 'HEAD'); return { branch: r.status === 0 ? r.stdout.trim() || null : null }; },
    // God mode: the project's actions (commands of the user's own, run in a terminal window from the bar or with their
    // shortcut). Kept per project; at most 20.
    'actions.list': ({ project: name }) => board.settingJson(`actions:${project(name).name.toLowerCase()}`) ?? [],
    'actions.save': ({ project: name, action: a }) => {
      const p = project(name); const key = `actions:${p.name.toLowerCase()}`;
      if (!a || typeof a !== 'object') fail(tr('msg.api.badParams'));
      const shortcut = str(a.shortcut, 'atajo', 40, { optional: true }) || null;
      if (shortcut && !/^((Ctrl|Alt|Shift|Meta)\+){1,3}([A-Z0-9]|F\d{1,2})$|^F\d{1,2}$/.test(shortcut)) fail(tr('msg.api.badShortcut'));
      const preview = str(a.preview, 'vista previa', 300, { optional: true }) || null;
      if (preview && !/^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d{1,5})?(\/\S*)?$/i.test(preview)) fail(tr('msg.api.badPreview'));
      const list = board.settingJson(key) ?? [];
      const id = typeof a.id === 'string' && /^[\w-]{1,40}$/.test(a.id) ? a.id : `a${Date.now().toString(36)}`;
      const item = { id, name: oneLine(str(a.name, 'nombre', 40), 40), command: str(a.command, 'comando', 2000).trim(), shortcut, preview, openPreview: Boolean(a.openPreview && preview) };
      if (shortcut && list.some((x) => x.id !== id && x.shortcut === shortcut)) fail(tr('msg.api.shortcutTaken', { shortcut }));
      const next = list.some((x) => x.id === id) ? list.map((x) => (x.id === id ? item : x)) : [...list, item];
      if (next.length > 20) fail(tr('msg.api.tooManyActions'));
      board.settingJson(key, next); board.changed('actions');
      return item;
    },
    'actions.remove': ({ project: name, id }) => {
      const key = `actions:${project(name).name.toLowerCase()}`;
      const next = (board.settingJson(key) ?? []).filter((x) => x.id !== String(id));
      board.settingJson(key, next.length ? next : null); board.changed('actions');
      return { ok: true };
    },
    'projects.clearIcon': ({ name }) => { const icon = clearProjectIcon(project(name)); board.changed('projects'); return icon; },
    'projects.info': async ({ name }) => (await gh()).projectInfo(project(name)),
    // A commit or a merge changes the folder off the event loop: the project is held so no task starts in it meanwhile.
    'projects.commit': async ({ name, message }) => {
      const p = project(name); const text = str(message, 'mensaje', 200); const g = await gh();
      return holding(p.name, () => g.commitAll(p, text));
    },
    'projects.merge': async ({ name, branch }) => {
      const p = project(name); const b = str(branch, 'rama', 120); const g = await gh();
      const out = await holding(p.name, () => g.mergeBranch(p, b));
      // the task that owned the branch lets its copy and branch go (src/engine/scheduler/index.mjs › branchMerged).
      try { await scheduler.branchMerged(p.name, b); } catch (error) { log(`tras unir ${b}: ${error.message}`); }
      return out;
    },
    // Pull requests for the phone. The number is a plain integer (never "1e3" or text with spaces); gh gets it as an argument.
    'projects.prs': async ({ name }) => (await gh()).listPrs(project(name)),
    'projects.pr': async ({ name, number }) => (await gh()).viewPr(project(name), prNumber(number)),
    'projects.mergePr': async ({ name, number, method, headRefOid }) => {
      const p = project(name); const n = prNumber(number); const oid = headOid(headRefOid); const m = oneOf(method, ['merge', 'squash', 'rebase'], 'método', 'merge'); const g = await gh();
      return holding(p.name, () => g.mergePr(p, n, m, oid));
    },
    'projects.push': async ({ name, branch }) => (await gh()).push(project(name), str(branch, 'rama', 120)),
    'projects.createPr': async ({ name, branch, title, body, base }) => (await gh()).createPr(project(name), { branch: str(branch, 'rama', 120), title: str(title, 'título', 200), body: str(body, 'descripción', 20000, { optional: true }), base: str(base, 'rama base', 120, { optional: true }) || undefined }),
    'projects.createRepo': async ({ name, repo, isPrivate }) => (await gh()).createRepo(project(name), { name: str(repo, 'repositorio', 100), isPrivate: isPrivate !== false }),
    'projects.clone': async ({ repo, name, category }) => {
      if (name) checkProjectName(name);
      const folder = await (await gh()).clone(str(repo, 'repositorio', 300), str(name, 'nombre', 60, { optional: true }), oneOf(category, CATEGORIES, 'categoría', undefined));
      return board.addProject({ name: oneLine(name || path.basename(folder), 60), path: folder }, 'usuario', { fromUser: true });
    },

    // Android's tools, managed only from Ajustes (the skills and MCP servers of core: api-extensions.mjs).
    'android.status': () => adbStatus(),
    'android.install': () => ensureAdb({ log }),
    'android.pairStart': () => android.pairStart(),
    'android.pairState': () => android.pairState(),
    'android.pairCancel': () => android.pairCancel(),
    'android.pairCode': ({ address, code, connect }) => android.pairCode({ address: str(address, 'dirección', 80), code: str(code, 'código', 6), connect: str(connect, 'dirección', 80, { optional: true }) || null }),
    'android.devices': () => android.devices(),
    // the emulators of this PC's Android SDK (never downloaded by Orb)
    'android.emulators': () => android.emulators(),
    'android.emulatorStart': ({ avd }) => android.emulatorStart({ avd: str(avd, 'emulador', 100) }),
    'android.disconnect': ({ serial }) => android.disconnect({ serial: str(serial, 'móvil', 120) }),
    'android.forget': ({ serial, host }) => android.forget({ serial: str(serial, 'móvil', 120, { optional: true }) || null, host: str(host, 'móvil', 120, { optional: true }) || null }),
    ...grants.methods,

    'github.status': async () => (await gh()).status(),
    'github.contributions': async () => (await gh()).contributions(),
    'github.login': async () => (await gh()).login(),
  };
  return methods;
}
