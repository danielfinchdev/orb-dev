// Every action the window can ask the engine for. Parameters are validated here (the window is trusted UI, but its
// inputs come from people and agents' text, so nothing is passed on unchecked). Actions marked as the user's ("usuario")
// are the only ones that sign approvals or publish.
// The dispatcher checks every call first (src/core/permissions.mjs: this PC may call anything, a linked phone or browser
// only what is marked for it) and the methods live in several files: here the conversations, chat, tasks, sessions,
// projects, schedules, logs, whiteboard and usage; api-link.mjs, api-accounts.mjs, api-inbox.mjs and api-data.mjs the
// rest.
import fs from 'node:fs';
import path from 'node:path';
import { ctx, saveConfig, tr } from '../core/context.mjs';
import { AGENT_IDS, categoryOf, CATEGORIES, PLATFORMS } from '../core/home.mjs';
import { accountsOf, accountDir, accountLabel, accounts as allAccounts } from '../core/accounts.mjs';
import { usageReport, modelName } from '../core/budget.mjs';
import { brainOf } from './orchestrator.mjs';
import { newProject, syncProjects, checkProjectName, renameProject } from '../core/projects.mjs';
import { finishProject, finishedProjects, reopenProject, checkDelete, deleteProject, abortDelete } from '../core/project-close.mjs';
import { PRODUCT } from '../core/product.mjs';
import { listSchedules, createSchedule, updateSchedule, removeSchedule, runSchedule, getSchedule, describe as describeSchedule, EVERY } from '../core/schedules.mjs';
import { oneLine, redactSecrets, localStamp } from '../core/safety.mjs';
import { quickRun } from '../agents/index.mjs';
import { PERMISSIONS } from './sessions.mjs';
import { readLog, writeLog, logFiles } from './logs.mjs';
import { expandMentions, mentionOptions } from './mentions.mjs';
import { ofUserLabel, userLabel, userName, assistantName } from '../core/board.mjs';
import { adbStatus, ensureAdb } from './android.mjs';
import { extensionMethods } from './api-extensions.mjs';
import { layoutPlan, layoutApply, guardOutside } from './workspace-layout.mjs';
import { modelCatalog, chooseModel, LEVELS, REASONING_LEVELS, levelsOf } from './catalog.mjs';
import { titleFrom } from '../core/titles.mjs';
import { autoTitle } from './titles.mjs';
import { projectIcon, setProjectIcon, clearProjectIcon, renameProjectIcon } from './project-icons.mjs';
import { git, slug } from '../core/workspace.mjs';
import { authorize, PermissionError } from '../core/permissions.mjs';
import { fld, fail, str, int, oneOf, images, DECISION } from './api-common.mjs';
import { linkMethods } from './api-link.mjs';
import { accountMethods } from './api-accounts.mjs';
import { dataApi } from './api-data.mjs';
import { inboxMethods } from './api-inbox.mjs';
import { masterMethods, checkUnlock } from './api-master.mjs';
import { appMethods } from './api-app.mjs';
import { sealConnectors } from '../core/connector-secrets.mjs';

export { fail, str, int, oneOf } from './api-common.mjs';

// 3.8.1: what only some calls need is loaded the first time one of them comes (the engine's start does not wait for it).
const lazy = (load) => { let p = null; return () => (p ??= load()); };
const gh = lazy(() => import('./github.mjs'));
const inst = lazy(() => import('./installer.mjs'));
const exp = lazy(() => import('./expert.mjs'));
const boards = lazy(() => import('./whiteboard.mjs'));

export function buildApi({ board, sessions, orchestrator, scheduler, emit, log, version, remoteRef = { current: null }, onUnlocked = () => {} }) {
  const realHome = (() => { try { return fs.realpathSync(ctx.home); } catch { return ctx.home; } })();
  let catalogCache = null; // models.catalog, for a few seconds (see there)
  const insideHome = (p) => { const rel = path.relative(realHome, p); return Boolean(rel) && !rel.startsWith('..') && !path.isAbsolute(rel); };
  const project = (name) => board.project(str(name, 'proyecto', 200)) ?? fail(tr('msg.api.noProject', { name }));
  let lastChat = board.one('SELECT MAX(id) AS id FROM chat')?.id ?? 0;
  const conversationId = (id) => { const c = board.conversation(int(id, 'conversación')); if (!c) fail(tr('msg.board.noConversation')); return c.id; };
  let whiteboardOf = null; const wb = async () => (whiteboardOf ??= (await boards()).whiteboard(board));
  // 2.7: a picture the window may show: an image file inside Orb's folder, a project, or an agent account's own folder
  // (Codex keeps what it makes in <CODEX_HOME>/generated_images). 25 MB at most.
  const allowedImage = (file) => {
    const real = (() => { try { return fs.realpathSync(file); } catch { return fail(tr('msg.api.badImage')); } })();
    if (!/\.(png|jpe?g|webp|gif)$/i.test(real)) fail(tr('msg.api.badImage'));
    const roots = [ctx.home, ...board.projects().map((p) => p.path), ...[...accountsOf('codex'), ...accountsOf('claude')].map((a) => accountDir(a))];
    const inside = (root) => { try { const r = fs.realpathSync(root); return real.toLowerCase().startsWith(`${r.toLowerCase()}${path.sep}`); } catch { return false; } };
    if (!roots.some(inside)) fail(tr('msg.api.badImage'));
    if (fs.statSync(real).size > 25 * 1024 * 1024) fail(tr('msg.api.badImage'));
    return real;
  };

  // 3.2.1: a task the user rejects says so in its conversation, and the assistant hears it (it used to keep saying the
  // task was waiting for approval). If other tasks of the request already finished, their report now comes with it.
  const taskRejected = (task) => {
    const conv = board.conversationOfTask(task.id);
    const line = tr('msg.api.taskRejected', { id: task.id, title: oneLine(task.title, 120) });
    if (!conv || task.created_by !== 'orb' || !orchestrator) { board.addChat('system', line, { task: task.id }, conv ?? null); return; }
    if ((board.settingJson(`report_queue:c${conv}`) ?? []).length) { board.addChat('system', line, { task: task.id }, conv); scheduler?.queueReport?.(task); return; }
    orchestrator.internal(`AVISO DEL SISTEMA (no es ${userName()}): ${userName()} ha rechazado la tarea #${task.id} «${oneLine(task.title)}». No se hará y no se ha tocado ningún archivo. No la vuelvas a crear salvo que te lo pida. Díselo en una línea y sigue con el resto del pedido, si lo hay.`, line, null, { conversation: conv, project: task.project });
  };
  // 3.2.1: a model by the name the selector shows (its agent's list, or the account's own), else the agent's own name for it.
  const modelLabelOf = (agent, account, id) => {
    try {
      const entry = (catalogCache?.value ?? modelCatalog(board)).find((a) => a.id === agent);
      const found = [...(entry?.accountModels?.[account] ?? []), ...(entry?.models ?? [])].find((m) => m.id === id);
      if (found?.label) return found.label;
    } catch { /* the name the agent gave it */ }
    const named = modelName(board, account, id);
    return named !== id ? named : /^[a-z]+$/.test(id) ? id[0].toUpperCase() + id.slice(1) : id;
  };
  // A task text cut for the lists (the window shows a few hundred characters of each).
  const cut = (s) => (typeof s === 'string' && s.length > 1200 ? `${s.slice(0, 1200)}…` : s);
  // Folders made by hand in the Explorer: the engine's loop looks every 5 s; a list asked for in between looks at most
  // every 2 s (each refresh of the window asks for it).
  let lastSync = 0;
  const syncSoon = () => { if (Date.now() - lastSync > 2000) { lastSync = Date.now(); syncProjects(board); } };
  const withAccepted = (m) => (m.meta?.kind === 'report' ? { ...m, meta: { ...m.meta, accepted: m.meta.tasks.length > 0 && m.meta.tasks.every((id) => board.isAccepted(id)) } } : m);
  // 3.2: the conversations for the sidebar, with how their tasks go, whether the assistant is answering in them now and
  // whether a question of its waits for the user (three queries for all of them, not three each).
  const conversationList = () => {
    const counts = {};
    for (const r of board.all('SELECT conversation_id AS c, status, COUNT(*) AS n FROM tasks WHERE conversation_id IS NOT NULL GROUP BY conversation_id, status')) (counts[r.c] ??= {})[r.status] = r.n;
    const asking = new Set(board.all(`SELECT DISTINCT conversation_id AS c FROM chat WHERE conversation_id IS NOT NULL AND meta LIKE '%"kind":"question"%' AND meta LIKE '%"status":"pending"%'`).map((r) => r.c));
    const live = new Map(orchestrator.states().map((x) => [x.conversation, x]));
    return board.conversations().map((c) => ({ id: c.id, title: c.title, project: c.project, agent: c.agent, account: c.account, model: c.model, reasoning: c.reasoning, status: c.status,
      created_at: c.created_at, updated_at: c.updated_at, done_at: c.done_at, context: c.context ?? null, tasks: counts[c.id] ?? {}, busy: Boolean(live.get(c.id)?.busy), waiting: Boolean(live.get(c.id)?.waiting), asking: asking.has(c.id) }));
  };
  // 3.2: a conversation is done when the user gave the OK to its work and none of its tasks is still open.
  const settleConversation = (id) => { if (id && board.conversation(id)?.status === 'open' && !board.openTasksOf(id) && !orchestrator.state(id).busy) board.setConversationDone(id, true); };

  // The user's OK closes the loop: tasks marked accepted, a line in the chat and an entry in the project's log.
  const accept = (ids, project) => {
    // 3.2.1: an undone task has no result left to accept.
    const done = board.accept(ids.filter((id) => !board.settingJson(`undone:${id}`)), 'usuario');
    if (!done.length) fail(tr('msg.api.noDoneTasks'));
    const name = userLabel();
    board.notice(tr(done.length > 1 ? 'msg.api.okMany' : 'msg.api.okOne', { who: ofUserLabel(), ids: done.map((t) => `#${t.id}`).join(', ') }), 'success');
    // 3.2.1: signed as Orb with whose OK it is (not «Orbe (app)»), and the general log gets each cycle too (it only had the
    // assistant's first entry of the day).
    const entry = { tema: tr('sys.logs.okTopic', { ids: done.map((t) => `#${t.id}`).join(', ') }), pedido: tr('sys.logs.okRequest'), hecho: tr('sys.logs.okDone', { user: name, list: done.map((t) => `#${t.id} ${oneLine(t.title, 80)}`).join('; ') }), estado: tr('sys.logs.okStatus') };
    const author = `${PRODUCT.name} (${tr('sys.logs.okBy', { user: name })})`;
    const where = project ?? done[0].project;
    try { writeLog(board, where, entry, author); } catch (error) { log(`bitácora del OK: ${error.message}`); }
    try { writeLog(board, 'general', { ...entry, tema: tr('sys.logs.okGeneralTopic', { project: where, ids: done.map((t) => `#${t.id}`).join(', ') }) }, author); } catch (error) { log(`bitácora general del OK: ${error.message}`); }
    return done.map((t) => t.id);
  };
  // 3.8.1: a coordinator in the middle of a turn in a conversation of the project (it could create a task right after).
  const coordinatorBusy = (name) => board.all('SELECT id FROM conversations WHERE project = ?', name).some((c) => orchestrator?.state(c.id)?.busy);
  // What the other parts of the API share.
  const shared = { board, sessions, orchestrator, scheduler, emit, log, version, remoteRef, project, conversationId };
  const data = dataApi(shared); // 3.6 (WS5): backups

  const methods = {
    'app.state': () => ({
      version, home: ctx.home, paths: { core: ctx.paths.core, projects: ctx.paths.projects, logs: ctx.paths.logs, mcp: ctx.paths.mcp, categories: ctx.paths.categories }, categories: CATEGORIES,
      config: ctx.config, paused: board.setting('paused') === '1', activeProject: board.activeProject(),
      approvals: sessions.allPendingApprovals().map((a) => ({ id: a.id, session_id: a.session_id, body: { title: a.body?.title, reason: a.body?.reason }, session: a.session })),
      counts: Object.fromEntries(board.all('SELECT status, COUNT(*) AS n FROM tasks GROUP BY status').map((r) => [r.status, r.n])),
      // 3.2: what each conversation with the assistant is doing now (only the ones answering or waiting their turn).
      chats: orchestrator.states(), assistant: orchestrator.info(null),
      // 2.6: the tasks («t<id>») and direct conversations («s<id>») the user put away in «Completadas» of the sidebar;
      // 3.2: kept, the finished tasks the user brought back (a finished task goes to «Completadas» by itself).
      completed: board.settingJson('sidebar_completed') ?? [], kept: board.settingJson('sidebar_kept') ?? [],
      // 3.2.1: the agents this PC can run now (installed, on, with an account): the lists of the window offer only these.
      agentsAvailable: board.availableAgents()
    }),
    // 3.8: the data of 3.7 were updated (or never were 3.7): engine.mjs answers these two itself while they could not be.
    'app.migrationState': () => ({ failed: false }),
    'app.migrationRetry': () => ({ failed: false }),
    // 3.8: core is whole (engine.mjs › coreBlocked answers these two while it is not).
    'app.coreState': () => null,
    'app.coreRepair': () => ({ missing: false }),
    // 3.8: the folders Orb 3.7 kept at the top of the workspace: what would happen to each, and the user's choice
    // (nothing moves before it; src/core/core-folder.mjs).
    'app.layoutPlan': () => layoutPlan(),
    'app.layoutApply': ({ choices }) => layoutApply(choices, { emit, log, board }),
    'conversations.list': () => conversationList(),
    // 3.2: completed by hand (or open again): a task («t<id>»), a direct conversation («s<id>») or a conversation with the
    // assistant («c<id>»).
    'sidebar.complete': ({ key, done }) => {
      const k = str(key, 'elemento', 100);
      if (!/^[tsc][\w-]{1,90}$/.test(k)) fail(tr('msg.api.missing', { name: fld('elemento') }));
      const finish = done !== false;
      const completedKey = 'sidebar_completed'; const keptKey = 'sidebar_kept';
      if (k[0] === 'c') { board.setConversationDone(conversationId(k.slice(1)), finish); return { ok: true }; }
      // A direct conversation: its own «settled» (writing in it again opens it), not the list.
      if (k[0] === 's') { sessions.update(sessions.must(k.slice(1)).id, { settled: finish }); board.settingJson(completedKey, (board.settingJson(completedKey) ?? []).filter((x) => x !== k)); board.changed('sidebar'); return { ok: true }; }
      const list = (board.settingJson(completedKey) ?? []).filter((x) => x !== k);
      if (finish) list.unshift(k);
      board.settingJson(completedKey, list.slice(0, 2000));
      if (k[0] === 't') { const kept = (board.settingJson(keptKey) ?? []).filter((x) => x !== k); if (!finish) kept.unshift(k); board.settingJson(keptKey, kept.slice(0, 500)); }
      board.changed('sidebar');
      return { ok: true };
    },
    'config.save': ({ patch, unlock }) => {
      // 3.8: a connector's keys never reach orb.json: they go into the vault and orb.json keeps references. With the window
      // unlocked (a change that needs it: checkUnlock), the keys are tied to the connectors' commands as they are now.
      const p = patch ?? {};
      const sealed = Array.isArray(p.mcpServers) ? sealConnectors(ctx.master, p.mcpServers, { trusted: Boolean(ctx.master?.checkToken(unlock)) }) : null;
      const c = saveConfig(sealed ? { ...p, mcpServers: sealed } : p); emit('config:changed', c);
      if (p.backup) guardOutside(); // the chosen backups' folder, kept from the agents
      return c;
    },

    // Git is needed for undo with history, isolated copies and GitHub: the Agents screen warns when it is missing.
    'installer.check': async () => (await inst()).check(),
    'installer.start': async ({ ids }) => { if (!Array.isArray(ids) || ids.some((x) => typeof x !== 'string')) fail(tr('msg.api.badList')); return (await inst()).start(ids, emit); },
    'installer.progress': async () => (await inst()).progress(),
    'system.check': async () => { const r = await quickRun('git', ['--version'], { timeoutMs: 8000 }); return { platform: process.platform, git: r.ok ? r.out.replace(/^git version\s*/, '') : null }; },

    'projects.list': () => {
      syncSoon();
      const active = board.activeName();
      // 3.8.1: the open tasks of every project in one query (it was one per project).
      const open = new Map(board.all("SELECT project, COUNT(*) AS n FROM tasks WHERE status IN ('queued', 'awaiting_approval', 'running') GROUP BY project").map((r) => [r.project, r.n]));
      return board.projects().map((p) => ({ ...p, inHome: insideHome(p.path), category: categoryOf(realHome, p.path), active: active === p.name, open: open.get(p.name) ?? 0 }));
    },
    // 3.8: category multi (or several platforms) = one multiplatform project with a folder per platform.
    'projects.create': ({ name, notes, category, platforms }) => board.project(newProject(board, {
      name: str(name, 'nombre', 60), notes: str(notes, 'notas', 2000, { optional: true }), category: oneOf(category, CATEGORIES, 'categoría', undefined),
      platforms: Array.isArray(platforms) ? platforms.slice(0, PLATFORMS.length).map((c) => oneOf(c, PLATFORMS, 'plataforma')) : []
    }, 'usuario').name),
    'projects.import': ({ name, folder }) => board.addProject({ name: checkProjectName(str(name, 'nombre', 60)), path: str(folder, 'carpeta', 1000) }, 'usuario', { fromUser: true }),
    'projects.remove': ({ name }) => board.removeProject(project(name).name, 'usuario'),
    // 3.2.1: a new name (and folder) for a project with nothing working in it (core/projects.mjs renameProject).
    'projects.rename': ({ name, to }) => {
      const from = project(name).name;
      const p = renameProject(board, { name: from, to: str(to, 'nombre', 60) }, 'usuario');
      renameProjectIcon(from, p.name);
      return p;
    },
    'projects.setActive': ({ name }) => board.setActiveProject(name ? project(name).name : '', 'usuario'),
    // 3.8.1: the end of a project (src/core/project-close.mjs). Finished: it leaves Orb, its folder stays (listed in
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
      const stop = (n) => {
        for (const t of board.all("SELECT id FROM tasks WHERE project = ? AND status = 'running'", n)) { try { scheduler.cancel(t.id, 'usuario'); } catch { /* finished meanwhile */ } }
        for (const s of board.all('SELECT id FROM sessions WHERE project = ?', n)) { sessions.stop(s.id); sessions.closeLive(s.id); }
      };
      const out = deleteProject(board, ctx.home, p.name, 'usuario', { ticket: typeof ticket === 'string' ? ticket : '', trashed: trashed === true, stop });
      clearProjectIcon(p);
      return out;
    },
    'projects.deleteAbort': ({ name, ticket }) => abortDelete(board, str(name, 'proyecto', 200), typeof ticket === 'string' ? ticket : ''),
    // 3.2: the projects' icons (their favicon or app icon, or one chosen here) for the sidebar: { name: dataUrl | null }.
    'projects.icons': () => Object.fromEntries(board.projects().map((x) => [x.name, projectIcon(x)])),
    'projects.setIcon': ({ name, path: file }) => { const p = project(name); const icon = setProjectIcon(p, str(file, 'imagen', 1000)); board.changed('projects'); return icon; },
    // 3.2: only the current branch (the hover card of a conversation): one quick git call, nothing from the network.
    'projects.branch': ({ name }) => { const p = project(name); const r = git(p.path, 'rev-parse', '--abbrev-ref', 'HEAD'); return { branch: r.status === 0 ? r.stdout.trim() || null : null }; },
    // 3.2, God mode: the project's actions (commands of the user's own, run in a terminal window from the bar or with their
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
    'projects.commit': async ({ name, message }) => (await gh()).commitAll(project(name), str(message, 'mensaje', 200)),
    'projects.merge': async ({ name, branch }) => (await gh()).mergeBranch(project(name), str(branch, 'rama', 120)),
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
    'android.install': () => ensureAdb({ log, force: true }),

    'github.status': async () => (await gh()).status(),
    'github.contributions': async () => (await gh()).contributions(),
    'github.login': async () => (await gh()).login(),

    // 3.2: a conversation's lines (the last 160, or 120 more before a line).
    // Without a conversation: the lines of none (tasks made by hand or by a schedule), which the window shows as notices.
    'chat.list': ({ conversation, before }) => board.chat(conversation == null ? null : conversationId(conversation), before ? 120 : 160, { before: before ? int(before, 'mensaje') : null }).map(withAccepted),
    // A message to a conversation with the assistant; without one, it starts a new conversation (in the project given, or
    // the working folder). → { conversation }
    // brain ({ agent, model, reasoning }): 3.8, a new conversation started from a phone with the brain chosen there (the
    // one new conversations start with is this PC's setting).
    'chat.send': ({ text, conversation, project: name, brain }, principal) => {
      const t = str(text, 'mensaje', 20000);
      const id = conversation == null ? null : conversationId(conversation);
      const proj = name === undefined ? undefined : name ? project(name).name : null;
      if (brain !== undefined) {
        if (id || !brain || typeof brain !== 'object' || Array.isArray(brain)) fail(tr('msg.api.badParams'));
        const c = orchestrator.startConversation({ text: t, project: proj });
        const pick = Object.fromEntries(['agent', 'model', 'reasoning'].filter((k) => brain[k] !== undefined).map((k) => [k, brain[k]]));
        try { methods['chat.settings']({ conversation: c.id, ...pick }, principal); } catch (error) { board.run('DELETE FROM conversations WHERE id = ?', c.id); board.changed('conversations'); throw error; }
        return orchestrator.ask(t, expandMentions(board, sessions, t), { conversation: c.id, project: proj });
      }
      if (!id && (brainOf().agent || 'claude') === 'cursor') fail(tr('msg.api.cursorNoCoordinate'));
      return orchestrator.ask(t, expandMentions(board, sessions, t), { conversation: id, project: proj });
    },
    'chat.stop': ({ conversation }) => orchestrator.stop(conversationId(conversation)),
    // 3.6: «Compactar»: the conversation's coordinator compacts its own context (or starts afresh with the briefing and
    // its last lines when its agent cannot). → { ok, how: 'compacted' | 'renewed' }
    'chat.compact': ({ conversation }) => orchestrator.compact(conversationId(conversation)),
    // 3.2: rename, change the project of a conversation, mark it done or open it again.
    'conversations.update': ({ id, title, project: name, done }) => {
      const c = conversationId(id);
      if (title !== undefined) board.updateConversation(c, { title: oneLine(str(title, 'título', 80), 80), titled: true });
      if (name !== undefined) board.setConversationProject(c, name ? project(name).name : '', 'usuario');
      if (done !== undefined) board.setConversationDone(c, Boolean(done));
      return board.conversation(c);
    },
    // Deleted with its lines (its tasks stay, in Tareas).
    'conversations.remove': ({ id }) => {
      const c = conversationId(id);
      orchestrator.drop(c);
      // 3.8: its tasks still to do (queued, waiting or working) stop with it: they would go on in the scope of the tasks
      // of no conversation, sharing messages with the manual and scheduled ones. The finished ones stay in Tareas.
      for (const t of board.all('SELECT id, status FROM tasks WHERE conversation_id = ?', c)) {
        if (!board.isFinished(t.status)) { try { scheduler.cancel(t.id, 'usuario'); } catch { /* finished meanwhile */ } }
      }
      board.run('DELETE FROM chat WHERE conversation_id = ?', c);
      board.run('UPDATE tasks SET conversation_id = NULL WHERE conversation_id = ?', c);
      board.run('DELETE FROM conversations WHERE id = ?', c);
      board.setting(`pending_questions:${c}`, '');
      board.changed('conversations');
      return { ok: true };
    },
    // 3.2: the search of the sidebar: conversations (with the assistant and direct) whose title or messages have the words.
    'conversations.search': ({ q }) => {
      const words = String(q ?? '').trim().toLowerCase().slice(0, 100);
      if (words.length < 2) return { conversations: [], sessions: [] };
      const like = `%${words.replace(/[%_!]/g, (m) => `!${m}`)}%`;
      // SQLite's LIKE ignores case only for ASCII: with accents or «ñ» the words are matched here, in JavaScript.
      if (/[^\x00-\x7f]/.test(words)) {
        const has = (s) => String(s ?? '').toLowerCase().includes(words);
        const conversations = board.all(`SELECT c.id, c.title, (SELECT group_concat(m.body, ' ') FROM chat m WHERE m.conversation_id = c.id AND m.role IN ('usuario', 'orb')) AS text FROM conversations c WHERE c.bot_id IS NULL AND c.group_id IS NULL`).filter((r) => has(r.title) || has(r.text)).slice(0, 100).map((r) => r.id);
        const found = board.all(`SELECT s.id, s.title, (SELECT group_concat(i.body, ' ') FROM session_items i WHERE i.session_id = s.id AND i.kind = 'text') AS text FROM sessions s WHERE s.kind = 'chat'`).filter((r) => has(r.title) || has(r.text)).slice(0, 100).map((r) => r.id);
        return { conversations, sessions: found };
      }
      const conversations = board.all(`SELECT DISTINCT c.id FROM conversations c LEFT JOIN chat m ON m.conversation_id = c.id AND m.role IN ('usuario', 'orb') WHERE c.bot_id IS NULL AND c.group_id IS NULL AND (lower(c.title) LIKE ? ESCAPE '!' OR lower(m.body) LIKE ? ESCAPE '!') LIMIT 100`, like, like).map((r) => r.id);
      const found = board.all(`SELECT DISTINCT s.id FROM sessions s LEFT JOIN session_items i ON i.session_id = s.id AND i.kind = 'text' WHERE s.kind = 'chat' AND (lower(s.title) LIKE ? ESCAPE '!' OR lower(i.body) LIKE ? ESCAPE '!') LIMIT 100`, like, like).map((r) => r.id);
      return { conversations, sessions: found };
    },
    // 2.7: pictures the agents make (Codex image_gen): shown in the conversation, a zone marked to change, saved in the
    // project. Read only from the agents' own picture folders, Orb's folder and the projects; written only into Orb's
    // folder (the marked copy) and <project>/imagenes.
    'images.read': ({ path: file }) => {
      const f = allowedImage(str(file, 'imagen', 1000));
      const ext = path.extname(f).slice(1).toLowerCase();
      return { dataUrl: `data:${ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg' : ext === 'webp' ? 'image/webp' : ext === 'gif' ? 'image/gif' : 'image/png'};base64,${fs.readFileSync(f).toString('base64')}` };
    },
    'images.mark': ({ dataUrl }) => {
      const m = /^data:image\/png;base64,([A-Za-z0-9+/=]+)$/.exec(String(dataUrl ?? ''));
      if (!m || m[1].length > 34 * 1024 * 1024) fail(tr('msg.api.badImage'));
      const dir = path.join(ctx.paths.internal, 'imagenes'); fs.mkdirSync(dir, { recursive: true });
      const file = path.join(dir, `zona-${Date.now()}.png`); fs.writeFileSync(file, Buffer.from(m[1], 'base64'));
      return { path: file };
    },
    'images.save': ({ path: file, project: name, title }) => {
      const f = allowedImage(str(file, 'imagen', 1000));
      const p = project(name);
      const dir = path.join(p.path, 'imagenes'); fs.mkdirSync(dir, { recursive: true });
      // 3.2.1: a name people can read: the first words of what was asked for (or "imagen" and the date), not Codex's
      // internal "exec-6ac8e3e7-….png".
      const ext = path.extname(f).toLowerCase() || '.png';
      const words = slug(oneLine(str(title, 'título', 300, { optional: true }) ?? '', 300).split(/\s+/).slice(0, 6).join(' '));
      const own = path.basename(f, path.extname(f));
      const internal = /^(exec|ig|img|image)[-_]?[0-9a-f-]{8,}$/i.test(own) || /^[0-9a-f-]{16,}$/i.test(own);
      const stem = words && words !== 'tarea' ? words : internal ? `imagen-${localStamp()}` : own.replace(/[^\w.-]/g, '_');
      let base = `${stem}${ext}`;
      for (let i = 2; fs.existsSync(path.join(dir, base)); i++) base = `${stem}-${i}${ext}`;
      fs.copyFileSync(f, path.join(dir, base));
      return { path: path.join(dir, base), name: base };
    },
    // 2.7: the Pizarra of each project (src/engine/whiteboard.mjs), saved in <project>/pizarra.
    'whiteboard.load': async ({ project }) => (await wb()).load({ project: str(project, 'proyecto', 200) }),
    'whiteboard.save': async ({ project, elements, appState, files, png }) => (await wb()).save({ project: str(project, 'proyecto', 200), elements, appState, files, png }),
    'whiteboard.attach': async ({ project, paths }) => (await wb()).attach({ project: str(project, 'proyecto', 200), paths }),
    'whiteboard.note': async ({ project, file, note }) => (await wb()).note({ project: str(project, 'proyecto', 200), file: str(file, 'archivo', 200), note }),
    'whiteboard.remove': async ({ project, file }) => (await wb()).remove({ project: str(project, 'proyecto', 200), file: str(file, 'archivo', 200) }),
    'whiteboard.folder': async ({ project }) => (await wb()).folder({ project: str(project, 'proyecto', 200) }),
    // 2.7: the answer to a question card (orb_ask): the options picked and/or own words, or skipped. The card keeps it and
    // the assistant gets it as the user's next message, in the conversation of the question.
    'chat.answer': ({ id, choices, other, skip }) => {
      const row = board.chatRow(int(id, 'mensaje'));
      if (row?.meta?.kind !== 'question' || row.meta.status !== 'pending' || !row.conversation_id || !board.conversation(row.conversation_id)) fail(tr('msg.api.questionGone'));
      const labels = new Set(row.meta.options.map((o) => o.label));
      const picked = (Array.isArray(choices) ? choices : []).map((c) => String(c)).filter((c) => labels.has(c)).slice(0, row.meta.multi ? 4 : 1);
      const own = other === undefined ? '' : oneLine(str(other, 'respuesta', 2000, { optional: true }) ?? '', 2000).trim();
      if (!skip && !picked.length && !own) fail(tr('msg.api.answerEmpty'));
      const answer = skip ? '' : [...picked, ...(own ? [own] : [])].join(' · ');
      board.patchChatMeta(row.id, { ...row.meta, status: skip ? 'skipped' : 'answered', answer });
      const text = skip ? tr('msg.api.questionSkipped', { question: row.meta.question }) : tr('msg.api.questionAnswer', { question: row.meta.question, answer });
      return orchestrator.ask(text, '', { conversation: row.conversation_id });
    },
    'chat.accept': ({ id }) => {
      const row = board.chatRow(int(id, 'mensaje'));
      if (row?.meta?.kind !== 'report') fail(tr('msg.api.notReport'));
      // 3.2.1: the OK to the report also settles the tasks of that request Orb held «for your review» (a read-only check
      // that changed build files, for instance), which the report already explained: before, they stayed blocked for ever.
      const held = row.conversation_id ? board.all("SELECT id FROM tasks WHERE conversation_id = ? AND status = 'blocked' AND updated_at <= ?", row.conversation_id, row.at)
        .map((r) => r.id).filter((tid) => board.one("SELECT 1 AS x FROM events WHERE task_id = ? AND kind = 'task.held' AND id > COALESCE((SELECT MAX(id) FROM events WHERE task_id = ? AND kind = 'task.launched'), 0)", tid, tid)) : [];
      for (const tid of held) board.patch(tid, { status: 'done' }, 'usuario', 'task.review_accepted');
      const out = accept([...row.meta.tasks, ...held], row.meta.project);
      // 3.2: the OK closes the conversation when nothing of it is still open (written in again, it opens).
      settleConversation(row.conversation_id);
      return out;
    },
    // The assistant's brain (2.6: any installed agent and model, with its reasoning and account). 3.2: of a conversation
    // (conversation given) and, always, the one new conversations start with; orchestrate: whether a new conversation is
    // with the assistant (on) or directly with the agent chosen (off: the user hands out the work).
    // 3.8: a linked phone or browser changes only that conversation's brain; the one new conversations start with (and
    // «orchestrate») is a setting of this PC.
    'chat.settings': ({ conversation, agent, model, reasoning, orchestrate, account: acc }, principal) => {
      const remote = principal?.channel !== 'desktop';
      if (remote && (conversation == null || orchestrate !== undefined)) throw new PermissionError('config.save');
      const o = brainOf();
      const conv = conversation == null ? null : board.conversation(conversationId(conversation));
      const base = conv ? { agent: conv.agent, account: conv.account, model: conv.model, reasoning: conv.reasoning } : o;
      const patch = {};
      if (agent !== undefined) {
        if (!modelCatalog(board).some((a) => a.id === agent)) fail(tr('msg.api.agentUnavailable', { agent: String(agent).slice(0, 40) }));
        patch.agent = agent;
      }
      const brain = patch.agent ?? base.agent ?? 'claude';
      if (acc !== undefined) { patch.account = str(acc, 'cuenta', 40); if (patch.account && !allAccounts().some((a) => a.id === patch.account)) fail(tr('msg.api.noAccount')); }
      else if (patch.agent && patch.agent !== (base.agent ?? 'claude')) patch.account = brain; // another agent: its own account
      if (model !== undefined) {
        const m = String(model ?? '');
        if (brain === 'claude' && m && !o.models.some((x) => x.id === m) && !/^(sonnet|opus|haiku)$/.test(m)) {
          // 2.6: a model Claude Code itself offers (discovered) joins the assistant's models, so the settings stay valid.
          const offered = (board.settingJson('models:claude') ?? []).find((x) => x.id === m);
          if (!offered || !/^[\w.:-]{1,80}$/.test(m)) fail(tr('msg.api.modelUnavailable'));
          if (!remote) patch.models = [...o.models, { id: m, label: offered.label }];
        }
        if (m && !/^[A-Za-z0-9][\w.:\-/[\]=,@]{0,79}$/.test(m)) fail(tr('msg.api.modelUnavailable'));
        patch.model = m || (brain === 'claude' ? 'claude-sonnet-5-5' : '');
      } else if (patch.agent && patch.agent !== (base.agent ?? 'claude')) patch.model = brain === 'claude' ? 'claude-sonnet-5-5' : '';
      if (reasoning !== undefined) patch.reasoning = oneOf(reasoning, REASONING_LEVELS, 'razonamiento');
      // 3.6: «Extra» (xhigh) only with a model that takes it; changing to a model without it leaves «Alto».
      if ((patch.reasoning ?? base.reasoning) === 'xhigh' && (reasoning !== undefined || patch.model !== undefined || patch.agent !== undefined)) {
        if (!levelsOf(modelCatalog(board), brain, patch.model ?? base.model, patch.account ?? base.account).includes('xhigh')) {
          if (reasoning === 'xhigh') fail(tr('msg.api.reasoningUnavailable'));
          patch.reasoning = 'high';
        }
      }
      if (orchestrate !== undefined && !conv) patch.orchestrate = Boolean(orchestrate);
      // Cursor's command line cannot take Orb's tools (MCP): it can talk directly, not coordinate the agents.
      if (brain === 'cursor' && (conv || (patch.orchestrate ?? o.orchestrate !== false))) fail(tr('msg.api.cursorNoCoordinate'));
      const before = { ...base };
      if (conv) {
        const fields = {};
        for (const k of ['agent', 'account', 'model', 'reasoning']) if (patch[k] !== undefined) fields[k] = patch[k] || null;
        board.updateConversation(conv.id, fields);
        // Another agent, or another account (its conversation lives in that account's folder): this conversation goes on
        // afresh with the logs instead of failing to resume.
        if ((patch.agent && patch.agent !== before.agent) || (patch.account !== undefined && patch.account !== before.account)) orchestrator.forget(conv.id);
      }
      // On this PC the choice is also the one the next new conversation starts with.
      if (!remote) { const c = saveConfig({ orchestrator: patch }); emit('config:changed', c); }
      const info = orchestrator.info(conv?.id ?? null);
      const level = { low: tr('msg.api.reasoningLow'), medium: tr('msg.api.reasoningMedium'), high: tr('msg.api.reasoningHigh'), xhigh: tr('msg.api.reasoningXhigh') }[info.reasoning] ?? info.reasoning;
      if ((patch.model !== undefined && patch.model !== before.model) || (patch.agent && patch.agent !== (before.agent ?? 'claude')) || (patch.reasoning && patch.reasoning !== before.reasoning)) board.notice(tr('msg.api.assistantBrain', { name: assistantName(), agent: info.agentLabel, label: info.modelLabel, reasoning: level }), 'info');
      return info;
    },
    // 2.6: the brains to choose from (agent + model), which ones spend the quota faster and how used each account is.
    // Kept for a few seconds: the window asks again on every change of the board (while the agents work, many a second).
    // 2.7: the guide of Ajustes › Tareas y usos: each agent's models by kind (light, balanced, most capable) and what Orb
    // would choose for a simple, normal and complex task with the current slider.
    'models.guide': () => modelCatalog(board).map((a) => ({
      id: a.id, label: a.label,
      tiers: Object.fromEntries(['light', 'balanced', 'heavy'].map((tier) => [tier, a.models.filter((m) => m.id && m.tier === tier).map((m) => m.label)])),
      picks: Object.fromEntries(LEVELS.map((level) => { const p = chooseModel(board, a.id, level, a.accounts[0]?.id ?? a.id, { writes: true }); return [level, { label: p.label, tier: p.tier, reasoning: p.reasoning }]; })),
      // 3.2.1: what the read-only tasks (reviews and verifications) really get: they may use the light model.
      readPicks: Object.fromEntries(LEVELS.map((level) => { const p = chooseModel(board, a.id, level, a.accounts[0]?.id ?? a.id, { writes: false }); return [level, { label: p.label, tier: p.tier, reasoning: p.reasoning }]; }))
    })),
    'models.catalog': () => {
      // 3.2: with the accounts' real usage in the key: the usage bubble reads it from here and must not see an old figure.
      const rates = board.all("SELECT key, value FROM settings WHERE key LIKE 'rate:%'").map((r) => `${r.key}=${r.value.length}:${r.value.slice(0, 40)}`);
      const key = JSON.stringify([ctx.config.orchestrator, ctx.config.agentOrder, Object.keys(ctx.config.agents).map((a) => ctx.config.agents[a]?.enabled), board.setting('models_rev'), rates]);
      if (catalogCache && catalogCache.key === key && Date.now() - catalogCache.at < 5000) return catalogCache.value;
      const value = modelCatalog(board, { discover: true, log });
      catalogCache = { key, at: Date.now(), value };
      return value;
    },

    // 3.0: the list of every view, sent on each refresh: long texts cut (the whole task is tasks.get) and no approval
    // signatures (only the detail needs them).
    'tasks.list': ({ limit }) => {
      // 3.8.1: a range of the settings' key (its index), not LIKE (which read every setting: one per accepted task, …).
      const undone = new Set(board.all("SELECT key FROM settings WHERE key >= 'undone:' AND key < 'undone;' AND value <> '' AND value <> 'null'").map((r) => Number(r.key.slice('undone:'.length))));
      // 3.8.1: the rows are new objects: changed in place (copying each task twice cost more than reading it).
      return board.panelTasks(Math.min(Number(limit) || 150, 500)).map((task) => {
        delete task.approval_hash; delete task.approval_sig;
        task.description = cut(task.description); task.result = cut(task.result);
        if (undone.has(task.id)) task.undone = true;
        return task;
      });
    },
    'tasks.live': () => scheduler.live(),
    'tasks.get': ({ id }) => {
      const d = board.taskDetail(int(id, 'tarea'));
      const children = board.all('SELECT id, title, status, agent, assigned_to, model FROM tasks WHERE parent_id = ? OR review_of = ? ORDER BY id', d.id, d.id);
      // 3.2.1: «Deshecha» (undone: the files are as before the task), the model by its name («Haiku 4.5», not «haiku») and the
      // account that ran it by the name the user gave it («Codex Pro»).
      const who = d.assigned_to ?? d.agent; const acc = d.run_account ?? d.account ?? null;
      return { ...d, accepted: board.isAccepted(d.id), previewHash: board.previewHash(d), hasCheckpoint: Boolean(board.settingJson(`checkpoint:${d.id}`)?.before), review: board.settingJson(`review:${d.id}`), children,
        undone: board.settingJson(`undone:${d.id}`), modelLabel: d.model ? modelLabelOf(who, acc ?? who, d.model) : null, accountLabel: acc && accountsOf(who).length > 1 ? accountLabel(acc) : null };
    },
    'tasks.create': (p) => board.createTask({
      project: project(p.project).name, title: str(p.title, 'título', 200), description: str(p.description, 'descripción', 12000),
      agent: oneOf(p.agent, [...AGENT_IDS, 'any'], 'agente', 'any'), model: str(p.model, 'modelo', 80, { optional: true }) || null,
      reasoning: oneOf(p.reasoning, ['low', 'medium', 'high'], 'razonamiento', 'medium'), mode: oneOf(p.mode, ['carpeta', 'aislada'], 'modo', 'carpeta'),
      readonly: Boolean(p.readonly), account: str(p.account, 'cuenta', 40, { optional: true }) || null, level: oneOf(p.level, ['simple', 'normal', 'complejo'], 'nivel', null), depends_on: Array.isArray(p.depends_on) ? p.depends_on.map((d) => int(d, 'dependencia')) : []
    }, 'usuario'),
    'tasks.approve': ({ id, decision, hash }) => {
      const out = board.approve(int(id, 'tarea'), decision === 'approved' ? 'approved' : 'rejected', 'usuario', str(hash, 'huella', 100));
      if (out?.status === 'cancelled') { try { taskRejected(out); } catch (error) { log?.(`rechazo #${out.id}: ${error.message}`); } }
      return out;
    },
    'tasks.retry': ({ id }) => board.retry(int(id, 'tarea'), 'usuario'),
    'tasks.cancel': ({ id }) => scheduler.cancel(int(id, 'tarea'), 'usuario'),
    'tasks.reassign': ({ id, agent, model, reasoning }) => board.reassign(int(id, 'tarea'), { agent: oneOf(agent, [...AGENT_IDS, 'any'], 'agente'), model: str(model, 'modelo', 80, { optional: true }) || null, reasoning: oneOf(reasoning, ['low', 'medium', 'high'], 'razonamiento') }, 'usuario'),
    'tasks.followup': ({ id, text, images: files }) => scheduler.followup(int(id, 'tarea'), str(text, 'mensaje', 20000), images(files)),
    'tasks.undo': ({ id }) => scheduler.undo(int(id, 'tarea')),
    'tasks.launchAnyway': ({ id }) => { const t = board.task(int(id, 'tarea')); if (t?.status !== 'queued') fail(tr('msg.api.onlyQueued')); board.setting(`budget_ok:${t.id}`, '1'); board.event(t.id, 'usuario', 'budget.authorised', 'lanzar aunque supere el límite de uso'); return true; },
    'tasks.accept': ({ id }) => accept([int(id, 'tarea')]),
    'tasks.discardBranch': ({ id }) => scheduler.discardBranch(int(id, 'tarea')),

    'sessions.list': ({ archived }) => sessions.list({ archived: Boolean(archived) }),
    'sessions.create': (p) => {
      const proj = p.project ? project(p.project) : null;
      const cwd = proj ? proj.path : ctx.paths.projects;
      // Without a project the agent sits in the assistant's own folder (its database, secret and logs): it may only look.
      if (!proj && p.permission && p.permission !== 'leer') fail(tr('msg.api.readOnlyNoProject'));
      const created = sessions.create({ kind: 'chat', agent: oneOf(p.agent, AGENT_IDS, 'agente'), account: str(p.account, 'cuenta', 40, { optional: true }) || null, model: str(p.model, 'modelo', 80, { optional: true }) || null,
        reasoning: oneOf(p.reasoning, REASONING_LEVELS, 'razonamiento', 'medium'), permission: proj ? oneOf(p.permission, PERMISSIONS, 'permiso', 'editar') : 'leer',
        project: proj?.name ?? null, cwd, title: str(p.title, 'título', 80, { optional: true }) || tr('msg.api.chatWith', { agent: p.agent }) });
      // 3.2: a title given here stays; without one, Orb names it from its first message.
      return p.title ? sessions.update(created.id, { titled: true }) : created;
    },
    'sessions.items': ({ id, after, before, limit }) => sessions.items(str(id, 'conversación', 64), { after: Number(after) || 0, before: Number(before) || 0, limit: Number(limit) || 200 }),
    // A message to a conversation: a new turn, or (while it works) steer the running turn or wait in its queue.
    // mode: 'auto' (steer when the agent can, else queue), 'steer' or 'queue'.
    'sessions.send': ({ id, text, images: files, mode }) => {
      const s = sessions.must(str(id, 'conversación', 64));
      if (s.kind === 'task') {
        // A running task: the message reaches its agent at once when it can (steer); otherwise after its turn.
        if (sessions.isRunning(s.id) && oneOf(mode, ['auto', 'steer', 'queue'], 'modo', 'auto') !== 'queue' && !(files ?? []).length) {
          const out = sessions.message(s.id, str(text, 'mensaje', 20000), { mode: 'steer' });
          if (out.steered) return out;
        }
        scheduler.followup(s.task_id, str(text, 'mensaje', 20000), images(files));
        return { queued: true };
      }
      const t = str(text, 'mensaje', 20000);
      // 3.2: a new direct conversation is named by Orb from its first message (at once a quick title, then a better one).
      if (s.kind === 'chat' && !s.titled) {
        const quick = titleFrom(t) || s.title;
        sessions.update(s.id, { title: quick, titled: true });
        autoTitle(board, { agent: s.agent, account: s.account, text: t }).then((better) => { if (better && sessions.get(s.id)?.title === quick) sessions.update(s.id, { title: better }); }).catch(() => {});
      }
      return sessions.message(s.id, t, { images: images(files), mode: oneOf(mode, ['auto', 'steer', 'queue'], 'modo', 'auto'), context: expandMentions(board, sessions, t) });
    },
    'sessions.queue': ({ id }) => sessions.queue(str(id, 'conversación', 64)),
    'sessions.editQueued': ({ id, queueId, text, remove, move }) => sessions.editQueued(str(id, 'conversación', 64), int(queueId, 'mensaje'), { text: text === undefined ? undefined : str(text, 'mensaje', 20000), remove: Boolean(remove), move: oneOf(move, ['up', 'down'], 'mover', undefined) }),
    'sessions.approve': ({ id, request, decision }) => sessions.respond(str(id, 'conversación', 64), str(request, 'petición', 200), oneOf(decision, DECISION, 'decisión')),
    'sessions.resume': ({ id }) => sessions.resume(str(id, 'conversación', 64)),
    'sessions.fork': ({ id, title }) => sessions.fork(str(id, 'conversación', 64), { title: str(title, 'título', 80, { optional: true }) || undefined }),
    'sessions.settle': ({ id, settled }) => sessions.update(sessions.must(str(id, 'conversación', 64)).id, { settled: settled !== false }),
    'approvals.list': () => sessions.allPendingApprovals(),
    'mentions.options': () => mentionOptions(board, sessions),
    'schedules.list': () => listSchedules(board).map((s) => ({ ...s, when: describeSchedule({ ...s, hours: s.at_time }) })),
    'schedules.create': (p) => createSchedule(board, { project: project(p.project).name, title: str(p.title, 'título', 120), description: str(p.description, 'descripción', 8000), agent: oneOf(p.agent, [...AGENT_IDS, 'any'], 'agente', 'any'), model: str(p.model, 'modelo', 80, { optional: true }) || null,
      readonly: Boolean(p.readonly), every: oneOf(p.every, EVERY, 'frecuencia'), at_time: str(p.at_time, 'hora', 5, { optional: true }) || '09:00', weekdays: Array.isArray(p.weekdays) ? p.weekdays.map(Number) : [], hours: Number(p.hours) || 6 }, 'usuario'),
    'schedules.update': ({ id, enabled, approve, title, description }) => updateSchedule(board, int(id, 'programada'), { enabled, approved: approve === true, title, description }),
    'schedules.remove': ({ id }) => removeSchedule(board, int(id, 'programada')),
    'schedules.run': ({ id }) => runSchedule(board, getSchedule(board, int(id, 'programada')) ?? fail(tr('msg.api.noScheduled')), 'usuario'),
    'tasks.review': ({ id, agent, focus }) => scheduler.createReview(board.task(int(id, 'tarea')) ?? fail(tr('msg.api.noTaskThat')), { actor: 'usuario', agent: oneOf(agent, AGENT_IDS, 'agente', null), focus: str(focus, 'foco', 500, { optional: true }) }),
    'projects.review': ({ name, agent, focus }) => scheduler.reviewProject(project(name).name, { actor: 'usuario', agent: oneOf(agent, AGENT_IDS, 'agente', null), focus: str(focus, 'foco', 500, { optional: true }) }),
    'projects.securityReview': ({ name, agent }) => scheduler.securityReview(project(name).name, { actor: 'usuario', agent: oneOf(agent, AGENT_IDS, 'agente', null) }),
    // 3.6: «Compactar» in a direct conversation: the agent's own compaction (Claude /compact, Codex thread/compact/start).
    'sessions.compact': ({ id }) => sessions.compact(sessions.must(str(id, 'conversación', 64)).id),
    'sessions.stop': ({ id }) => { const s = sessions.must(str(id, 'conversación', 64)); if (s.kind === 'task') return scheduler.cancel(s.task_id, 'usuario'); return sessions.stop(s.id); },
    'sessions.update': ({ id, title, model, reasoning, permission, archived }) => {
      const s = sessions.must(str(id, 'conversación', 64));
      if (s.kind === 'task' && (model !== undefined || permission !== undefined || reasoning !== undefined)) fail(tr('msg.api.taskModelFromTask'));
      const fields = {};
      if (title !== undefined) fields.title = oneLine(str(title, 'título', 80), 80);
      if (model !== undefined) fields.model = str(model, 'modelo', 80, { optional: true }) || null;
      if (reasoning !== undefined) fields.reasoning = oneOf(reasoning, REASONING_LEVELS, 'razonamiento');
      // 3.6: «Extra» only with a model that takes it (the conversation's, or the one chosen now).
      if ((fields.reasoning ?? s.reasoning) === 'xhigh' && (reasoning !== undefined || model !== undefined) && !levelsOf(modelCatalog(board), s.agent, fields.model !== undefined ? fields.model : s.model, s.account).includes('xhigh')) {
        if (reasoning === 'xhigh') fail(tr('msg.api.reasoningUnavailable'));
        fields.reasoning = 'high';
      }
      if (permission !== undefined) { fields.permission = oneOf(permission, PERMISSIONS, 'permiso'); if (!s.project && fields.permission !== 'leer') fail(tr('msg.api.readOnlyNoProject2')); }
      if (archived !== undefined) fields.archived = Boolean(archived);
      return sessions.update(s.id, fields);
    },
    'sessions.remove': ({ id }) => sessions.remove(str(id, 'conversación', 64)),

    'logs.list': () => logFiles(board).map(([name, file]) => { let size = 0; try { size = fs.statSync(file).size; } catch { /* empty */ } return { name, size }; }),
    'logs.read': ({ project: name, whole }) => readLog(board, str(name, 'bitácora', 200), { whole: Boolean(whole), chars: 40000 }),

    'activity.list': ({ q, limit }) => {
      const rows = board.recentEvents(Math.min(Number(limit) || 300, 2000));
      const needle = String(q ?? '').toLowerCase().trim();
      return (needle ? rows.filter((r) => `${r.actor} ${r.kind} ${r.detail} ${r.title ?? ''}`.toLowerCase().includes(needle)) : rows).map((r) => ({ ...r, detail: redactSecrets(r.detail) }));
    },
    // 3.2.1: only the accounts of the agents this PC can run (not every agent Orb knows).
    'usage.get': () => { const avail = board.availableAgents(); return usageReport(board).filter((u) => !avail || avail.includes(u.agent)); },
    // 2.6: the accounts working right now (the assistant's brain and the agents' running sessions), with the windows of
    // their plan the agents reported (session, weekly…), for the panel of the context ring.
    'usage.now': () => {
      // 3.2: the brain of the conversations answering now (or the one new conversations use).
      const brain = orchestrator.info(null); const answering = orchestrator.states().find((x) => x.busy);
      const brainAccount = answering ? board.conversation(answering.conversation)?.account ?? brain.account : brain.account;
      const busy = board.all("SELECT DISTINCT account, agent FROM sessions WHERE status = 'running' AND account IS NOT NULL");
      const report = usageReport(board);
      // Then the other accounts whose plan reported its usage lately (a task that just finished still counts).
      const ids = [...new Set([brainAccount, ...busy.map((s) => s.account), ...report.filter((u) => u.windows?.length).map((u) => u.account)].filter(Boolean))];
      return ids.map((id) => report.find((u) => u.account === id) ?? { account: id, agent: busy.find((s) => s.account === id)?.agent ?? brain.agent, label: id, windows: [] })
        .map((u) => ({ account: u.account, agent: u.agent, label: u.label, windows: u.windows ?? [], cooldownUntil: u.cooldownUntil ?? null, brain: u.account === brainAccount }));
    },
    // Expert mode (PC only, read-only): the project's files, git and the machine's load.
    'expert.tree': async ({ project: name, dir }) => (await exp()).tree(project(name).path, str(dir, 'carpeta', 1000, { optional: true })),
    'expert.read': async ({ project: name, path: file }) => (await exp()).readFile(project(name).path, str(file, 'archivo', 1000)),
    'expert.status': async ({ project: name }) => (await exp()).gitStatus(project(name).path),
    'expert.diff': async ({ project: name, path: file }) => (await exp()).gitDiff(project(name).path, str(file, 'archivo', 1000, { optional: true })),
    'expert.log': async ({ project: name, limit }) => (await exp()).gitLog(project(name).path, limit),
    'expert.system': async () => ({ ...(await exp()).systemStats(ctx.home), running: sessions.runningCount(), byAgent: Object.fromEntries(AGENT_IDS.map((a) => [a, sessions.runningCount(a)])) }),
    'control.pause': () => { board.setting('paused', '1'); board.changed('settings'); return true; },
    'control.resume': () => { board.setting('paused', '0'); board.changed('settings'); return true; },
    ...accountMethods(shared),
    ...linkMethods(shared),
    ...inboxMethods(shared),
    ...data.methods,
    ...masterMethods({ ...shared, onUnlocked }),
    ...extensionMethods(shared),
    ...appMethods({ home: ctx.home, version }) // 3.8.1: this PC's tools (terminal, editors, feedback…)
  };
  return {
    // principal: who calls, built only by the entry points (engine.mjs and dev-control.mjs: this PC; remote.mjs: a
    // linked device). A call without one is refused (never this PC by default).
    async call(method, params, principal) {
      if (!principal) throw new PermissionError(method);
      const fn = Object.hasOwn(methods, method) ? methods[method] : null;
      if (!fn) fail(tr('msg.api.unknownAction', { method }));
      if (params === null || typeof params !== 'object' || Array.isArray(params)) fail(tr('msg.api.badParams'));
      authorize(principal, method);
      // 3.8: and, for what the master password guards, a fresh unlock of this PC's window (src/engine/api-master.mjs).
      checkUnlock(method, params);
      const out = await fn(params, principal);
      // 3.1: an agent turned on or off, checked again, or an account added or removed: the list of available agents is
      // updated at once (the next task may already be for it).
      if (/^(config\.save|agents\.(status|check)|accounts\.(add|update|remove))$/.test(method)) { try { scheduler.refreshAvailable(true); } catch { /* next tick */ } }
      return out;
    },
    // The method names (test/permisos.test.mjs checks each one has its line in src/core/permissions.mjs).
    methodNames: () => Object.keys(methods),
    // New chat lines since the last call, sent to the window as 'chat:new' (corner robot, robot notices) or 'notice' (toasts).
    notifyNewChat() {
      const rows = board.all('SELECT id, role, body, meta, conversation_id FROM chat WHERE id > ? ORDER BY id LIMIT 20', lastChat);
      if (!rows.length) return;
      lastChat = rows[rows.length - 1].id;
      for (const r of rows) if (r.role === 'notice') { let m = null; try { m = JSON.parse(r.meta); } catch { /* plain */ } emit('notice', { body: oneLine(r.body, 300), tone: m?.tone ?? 'info' }); } // 2.7: a passing notification, not a chat line
      else if (r.role !== 'usuario') {
        let meta = null; try { meta = r.meta ? JSON.parse(r.meta) : null; } catch { /* plain */ }
        // 3.2: a plain line of no conversation (a task made by hand or by a schedule) passes by as a notification.
        if (r.role === 'system' && r.conversation_id == null && !meta?.kind) emit('notice', { body: oneLine(r.body, 300), tone: 'info' });
        else emit('chat:new', { role: r.role, body: oneLine(r.body, 240), meta, conversation: r.conversation_id ?? null });
      }
    },
    // 3.6: the daily backup (03:00 in the owner's zone), looked at from the engine's loop.
    dataTick: () => data.tick(),
    // Running tasks stay "running": the next start continues them (scheduler.finish does not close them while closing).
    shutdown() { scheduler.closing = true; orchestrator.closing = true; sessions.stopAll(); orchestrator.stopAll(); orchestrator.closeLive(); log('motor detenido'); }
  };
}

