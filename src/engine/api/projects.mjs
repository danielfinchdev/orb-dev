// Window actions of projects (create, import, finish, delete, git and GitHub) and of the phone's Android tools.
import path from 'node:path';
import { ctx, tr } from '../../platform/context.mjs';
import { categoryOf, CATEGORIES, PLATFORMS } from '../../platform/paths.mjs';
import { newProject, checkProjectName, renameProject, moveProjectCategory, projectHasWork } from '../../domain/projects/projects.mjs';
import { layoutPlan, layoutApply } from '../workspace-layout.mjs';
import { finishProject, finishedProjects, reopenProject, checkDelete, deleteProject, abortDelete } from '../../domain/projects/project-close.mjs';
import { oneLine } from '../../shared/text.mjs';
import { adbStatus, ensureAdb } from '../host/android.mjs';
import { projectIcon, setProjectIcon, clearProjectIcon, renameProjectIcon } from '../project-icons.mjs';
import { git } from '../../platform/git.mjs';
import { fail, str, oneOf } from './common.mjs';
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
// github.mjs stays lazy (startup cost): its oid pattern and comment limit are repeated here on purpose.
const gh = lazy(() => import('../host/github.mjs'));

export function projectMethods({ emit, realHome, insideHome, project, holding, coordinatorBusy, syncSoon, cut, android, grants, board, sessions, scheduler, chatTrees, log }) {
  // The project as a commit dialog of chat `session` sees it: a chat in its own worktree commits and pushes there, on its
  // own branch. Only the chat id comes from the caller; the folder is Orb's record (ChatWorktrees.folderFor).
  const inChat = (name, session) => {
    const p = project(name);
    const sid = str(session, 'conversación', 64, { optional: true });
    const dir = sid ? chatTrees.folderFor(sid, p.name) : null;
    return dir ? { ...p, path: dir } : p;
  };
  const syncBusy = (name) => scheduler.held(name) || coordinatorBusy(name) || projectHasWork(board, name);
  // anything working (tasks, conversations, schedules) may be using the folders «Ordenar carpetas» moves.
  const arrangeBusy = () => board.projects().some((p) => scheduler.held(p.name) || coordinatorBusy(p.name))
    || board.one("SELECT COUNT(*) AS n FROM tasks WHERE status IN ('queued', 'awaiting_approval', 'running')").n > 0
    || board.one("SELECT COUNT(*) AS n FROM sessions WHERE status = 'running'").n > 0;
  const methods = {
    'projects.list': () => {
      syncSoon();
      const active = board.activeName();
      // the open tasks of every project in one query (not one per project).
      const open = new Map(board.all("SELECT project, COUNT(*) AS n FROM tasks WHERE status IN ('queued', 'awaiting_approval', 'running') GROUP BY project").map((r) => [r.project, r.n]));
      return board.projects().map((p) => ({ ...p, inHome: insideHome(p.path), category: categoryOf(realHome, p.path), active: active === p.name, open: open.get(p.name) ?? 0 }));
    },
    // category multi (or several platforms) = one multiplatform project with a folder per platform.
    // template: false = only the empty folder (no git repository, no first files); without it, as always.
    'projects.create': ({ name, notes, category, platforms, template }) => board.project(newProject(board, {
      name: str(name, 'nombre', 60), notes: str(notes, 'notas', 2000, { optional: true }), category: oneOf(category, CATEGORIES, 'categoría', undefined),
      platforms: Array.isArray(platforms) ? platforms.slice(0, PLATFORMS.length).map((c) => oneOf(c, PLATFORMS, 'plataforma')) : [],
      template: template !== false
    }, 'usuario').name),
    // the folder of a project to another category (domain/projects/projects.mjs moveProjectCategory); the window only.
    'projects.setCategory': ({ name, category }) => {
      const old = project(name);
      if (scheduler.held(old.name) || coordinatorBusy(old.name)) throw new Error(tr('msg.projects.moveBusy', { name: old.name }));
      // (the domain function checks the project's own tasks and conversations, projectHasWork, the same as projects.sync)
      const p = moveProjectCategory(board, { name: old.name, category: str(category, 'categoría', 40) }, 'usuario');
      if (!p) return { ...old, category: categoryOf(realHome, old.path), moved: false };
      chatTrees.followProject(old.name, old.path, p);
      return { ...p, category: categoryOf(realHome, p.path), moved: true };
    },
    // «Ordenar carpetas» on demand: the plan of the welcome (app.layoutPlan) plus whether anything is working, because
    // folders in use cannot move; projects.layoutApply is app.layoutApply once nothing is.
    'projects.layoutPlan': () => ({ ...layoutPlan(), busy: arrangeBusy() }),
    'projects.layoutApply': ({ choices }) => {
      if (arrangeBusy()) throw new Error(tr('msg.projects.arrangeBusy'));
      return layoutApply(choices, { emit, log, board });
    },
    'projects.import': ({ name, folder }) => board.addProject({ name: checkProjectName(str(name, 'nombre', 60)), path: str(folder, 'carpeta', 1000) }, 'usuario', { fromUser: true }),
    'projects.remove': ({ name }) => board.removeProject(project(name).name, 'usuario'),
    // a new name (and folder) for a project with nothing working in it (domain/projects/projects.mjs renameProject).
    'projects.rename': ({ name, to }) => {
      const old = project(name); const from = old.name;
      const p = renameProject(board, { name: from, to: str(to, 'nombre', 60) }, 'usuario');
      renameProjectIcon(from, p.name);
      chatTrees.followProject(from, old.path, p);
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
    // local: true is the list's read (git only, no gh, no network); without it the page's full read.
    'projects.info': async ({ name, local }) => (await gh()).projectInfo(project(name), { local: local === true }),
    // A commit or a merge changes the folder off the event loop: the project is held so no task starts in it meanwhile.
    'projects.commit': async ({ name, session, message, files, push }) => {
      const p = inChat(name, session); const g = await gh();
      // the dialog of «Hacer commit…»: some files, a message with a body, and «Commit y push» (never forced).
      if (Array.isArray(files)) {
        const text = str(message, 'mensaje', 5000); const list = files.slice(0, 500).map((f) => str(f, 'archivo', 500));
        return holding(p.name, async () => {
          const out = await g.commitAll(p, text, { files: list });
          if (!push) return { ...out, pushed: false };
          try { await g.push(p, out.branch); } catch (error) { return { ...out, pushed: false, pushError: oneLine(error.message, 300) }; } // the commit is done: the push error is shown, not thrown
          return { ...out, pushed: true };
        });
      }
      const text = str(message, 'mensaje', 200);
      return holding(p.name, () => g.commitAll(p, text));
    },
    'projects.commitFiles': async ({ name, session }) => (await gh()).changedFiles(inChat(name, session)),
    'projects.commitSuggest': async ({ name, session }) => {
      const p = inChat(name, session); const g = await gh();
      const files = await g.changedFiles(p);
      const { suggestCommitMessage } = await import('../commit-message.mjs');
      return suggestCommitMessage(board, { files, context: await g.commitContext(p, files) });
    },
    'projects.merge': async ({ name, branch }) => {
      const p = project(name); const b = str(branch, 'rama', 120); const g = await gh();
      const out = await holding(p.name, () => g.mergeBranch(p, b));
      // the task that owned the branch lets its copy and branch go (src/engine/scheduler/index.mjs › branchMerged).
      try { await scheduler.branchMerged(p.name, b); } catch (error) { log(`tras unir ${b}: ${error.message}`); }
      return out;
    },
    // Pull requests for the phone. The number is a plain integer (never "1e3" or text with spaces); gh gets it as an argument.
    // state (open, merged, closed) is the project page's read, with checks and dates; left out it is the phone's list as ever.
    'projects.prs': async ({ name, state }) => (await gh()).listPrs(project(name), state === undefined || state === null ? {} : { state: oneOf(state, ['open', 'merged', 'closed'], 'estado') }),
    // The filter's three numbers; never fails (zeros and `error` when GitHub cannot be read). force: skip the two-minute memory.
    'projects.prCounts': async ({ name, force }, principal) => (await gh()).prCounts(project(name), { force: force === true && (!principal || principal.channel === 'desktop') }),
    // «Revisar tarea» of a PR: the read-only review task that already looks at it, or a new one. The link PR → task lives in
    // Orb's own setting (pr_review:<project>:<n> = { id, oid }), never in text a PR author can write: the mark in the brief is
    // informational. A review is reused only while it exists, is the user's own task of this project and the PR still has the
    // commit it was made for; new commits get a new review.
    'projects.prReview': async ({ name, number }) => {
      const p = project(name); const n = prNumber(number); const mark = `[orb-pr-review:${n}]`; const key = `pr_review:${p.name}:${n}`;
      const pr = await (await gh()).viewPr(p, n);
      const oid = pr.headRefOid || '';
      const saved = board.settingJson(key);
      const found = saved && Number.isInteger(saved.id) ? board.task(saved.id) : null;
      // reused only for the very commit it reviewed: without a known head (gh gave none) nothing says it still is
      if (oid && found && found.project === p.name && found.created_by === 'usuario' && found.review_of == null && found.readonly && !found.trashed_at && String(saved.oid ?? '') === oid) return { id: found.id, created: false };
      const plain = (v, max) => oneLine(String(v ?? '').replace(/\[orb-pr-review:/gi, '['), max);
      const review = scheduler.reviewProject(p.name, { actor: 'usuario', focus: tr('msg.api.prReviewFocus', { n, title: plain(pr.title, 120), head: plain(pr.headRefName, 120), base: plain(pr.baseRefName, 120), mark }) });
      board.settingJson(key, { id: review.id, oid });
      return { id: review.id, created: true };
    },
    // «Sincronizar»: what it would do (it fetches, which only refreshes the local copy of the remote) and then doing it.
    // The folder changes, so it is held; the push goes through github.push (secrets check) like «Subir rama».
    // Anything working in the project (the same check as «Cambiar categoría») refuses it: the plan says `busy` instead.
    'projects.syncPlan': async ({ name }) => {
      const p = project(name);
      if (syncBusy(p.name)) return { state: 'busy', busy: true, reason: tr('msg.projects.syncBusy'), branch: '', upstream: '', behind: 0, ahead: 0, changes: 0 };
      return { ...(await (await gh()).syncPlan(p)), busy: false };
    },
    'projects.sync': async ({ name, behind, ahead }) => {
      const p = project(name); const g = await gh();
      if (syncBusy(p.name)) throw new Error(tr('msg.projects.syncBusy'));
      const count = (v, what) => { if (!Number.isInteger(v) || v < 0 || v > 100_000) fail(tr('msg.api.invalid', { name: what })); return v; };
      const expect = { behind: count(behind, 'commits por traer'), ahead: count(ahead, 'commits por subir') };
      return holding(p.name, () => g.syncRun(p, { expect }));
    },
    // The newest PR of a branch in any state (a merged or closed one too); read-only, like projects.pr.
    'projects.branchPr': async ({ name, branch }) => (await gh()).branchPr(project(name), str(branch, 'rama', 120)),
    'projects.pr': async ({ name, number }) => (await gh()).viewPr(project(name), prNumber(number)),
    'projects.mergePr': async ({ name, number, method, headRefOid }) => {
      const p = project(name); const n = prNumber(number); const oid = headOid(headRefOid); const m = oneOf(method, ['merge', 'squash', 'rebase'], 'método', 'merge'); const g = await gh();
      return holding(p.name, () => g.mergePr(p, n, m, oid));
    },
    'projects.prComment': async ({ name, number, body }) => {
      const p = project(name); const n = prNumber(number); const text = str(body, 'comentario', 20000);
      if (!text.trim()) fail(tr('msg.api.missing', { name: 'comentario' }));
      return (await gh()).commentPr(p, n, text);
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
