// Every action the window can ask the engine for. Parameters are validated here (the window is trusted UI, but its
// inputs come from people and agents' text, so nothing is passed on unchecked). Actions marked as the user's ("usuario")
// are the only ones that sign approvals or publish.
import fs from 'node:fs';
import path from 'node:path';
import { ctx, saveConfig, checkAccountHome, tr } from '../core/context.mjs';
import { AGENT_IDS, categoryOf, CATEGORIES } from '../core/home.mjs';
import { MULTI, newAccountId, findAccountFolders, accountsOf, accountDir, accountLabel } from '../core/accounts.mjs';
import { accountInfo as codexAccountInfo } from '../agents/codex.mjs';
import { usageReport, clearCooldown, modelName } from '../core/budget.mjs';
import { createProjects, syncProjects, checkProjectName, renameProject } from '../core/projects.mjs';
import { PRODUCT } from '../core/product.mjs';
import { listSchedules, createSchedule, updateSchedule, removeSchedule, runSchedule, getSchedule, describe as describeSchedule, EVERY } from '../core/schedules.mjs';
import { oneLine, redactSecrets, localStamp } from '../core/safety.mjs';
import { statusAll, status as agentStatus, openLogin, quickRun, forgetInstalled, executable } from '../agents/index.mjs';
import { PERMISSIONS } from './sessions.mjs';
import { readLog, writeLog, logFiles } from './logs.mjs';
import { expandMentions, mentionOptions } from './mentions.mjs';
import { ofUserLabel, userLabel, assistantName, userName } from '../core/board.mjs';
import * as github from './github.mjs';
import * as installer from './installer.mjs';
import * as expert from './expert.mjs';
import { adbStatus, ensureAdb, adbPath } from './android.mjs';
import * as net from '../core/network.mjs';
import { spawn } from 'node:child_process';
import { mcpFolder } from './mcp-folder.mjs';
import { modelCatalog, refreshModels, refreshAllModels, chooseModel, LEVELS } from './catalog.mjs';
import { whiteboard } from './whiteboard.mjs';
import { opti } from './opti.mjs';
import { readOce } from './bridge.mjs';
import { quickStats } from '../core/pc-health.mjs';
import { translate } from '../core/i18n.mjs';
import { titleFrom } from '../core/titles.mjs';
import { autoTitle } from './titles.mjs';
import { projectIcon, setProjectIcon, clearProjectIcon, renameProjectIcon } from './project-icons.mjs';
import { git, slug } from '../core/workspace.mjs';

// Names of the fields in the messages (Spanish as they were; the key is the Spanish word).
const fld = (name) => { const key = `msg.api.f.${String(name).replace(/ /g, '_')}`; const t = tr(key); return t === key ? name : t; };
const fail = (message) => { const e = new Error(message); e.userFacing = true; throw e; };
const str = (v, name, max = 2000, { optional = false } = {}) => {
  if (v == null || v === '') { if (optional) return ''; fail(tr('msg.api.missing', { name: fld(name) })); }
  if (typeof v !== 'string') fail(tr('msg.api.invalid', { name: fld(name) }));
  if (v.length > max) fail(tr('msg.api.tooLong', { name: fld(name), max }));
  return v;
};
const int = (v, name) => { const n = Number(v); if (!Number.isInteger(n) || n < 1) fail(tr('msg.api.invalid', { name: fld(name) })); return n; };
const oneOf = (v, list, name, fallback) => { if (v == null || v === '') return fallback; if (!list.includes(v)) fail(tr('msg.api.invalid', { name: fld(name) })); return v; };
const DECISION = ['allow', 'always', 'deny'];
const images = (list) => {
  if (list == null) return [];
  if (!Array.isArray(list) || list.length > 10 || list.some((f) => typeof f !== 'string' || !path.isAbsolute(f))) fail(tr('msg.api.badAttachments'));
  return list;
};

export function buildApi({ board, sessions, orchestrator, scheduler, emit, log, version, remoteRef = { current: null } }) {
  const realHome = (() => { try { return fs.realpathSync(ctx.home); } catch { return ctx.home; } })();
  let catalogCache = null; // models.catalog, for a few seconds (see there)
  const insideHome = (p) => { const rel = path.relative(realHome, p); return Boolean(rel) && !rel.startsWith('..') && !path.isAbsolute(rel); };
  const project = (name) => board.project(str(name, 'proyecto', 200)) ?? fail(tr('msg.api.noProject', { name }));
  let lastChat = board.one('SELECT MAX(id) AS id FROM chat')?.id ?? 0;
  const conversationId = (id) => { const c = board.conversation(int(id, 'conversación')); if (!c) fail(tr('msg.board.noConversation')); return c.id; };
  const wb = whiteboard(board);
  const optiApi = opti({ board, sessions });
  // 2.7: a picture the window may show: an image file inside Orb's folder, a project, or an agent account's own folder
  // (Codex keeps what it makes in <CODEX_HOME>/generated_images). 25 MB at most.
  const allowedImage = (file) => {
    const real = (() => { try { return fs.realpathSync(file); } catch { return fail(tr('msg.api.badImage')); } })();
    if (!/\.(png|jpe?g|webp|gif)$/i.test(real)) fail(tr('msg.api.badImage'));
    const roots = [ctx.home, ...board.projects().map((p) => p.path), ...accountsOf('codex').map((a) => accountDir(a)), ...accountsOf('claude').map((a) => accountDir(a))];
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
    board.notice(tr(done.length > 1 ? 'msg.api.okMany' : 'msg.api.okOne', { who: ofUserLabel(), ids: done.map((t) => `#${t.id}`).join(', ') }), 'success');
    // 3.2.1: signed as Orb with whose OK it is (not «Orbe (app)»), and the general log gets each cycle too (it only had the
    // assistant's first entry of the day).
    const entry = { tema: tr('sys.logs.okTopic', { ids: done.map((t) => `#${t.id}`).join(', ') }), pedido: tr('sys.logs.okRequest'), hecho: tr('sys.logs.okDone', { user: userLabel(), list: done.map((t) => `#${t.id} ${oneLine(t.title, 80)}`).join('; ') }), estado: tr('sys.logs.okStatus') };
    const author = `${PRODUCT.name} (${tr('sys.logs.okBy', { user: userLabel() })})`;
    const where = project ?? done[0].project;
    try { writeLog(board, where, entry, author); } catch (error) { log(`bitácora del OK: ${error.message}`); }
    try { writeLog(board, 'general', { ...entry, tema: tr('sys.logs.okGeneralTopic', { project: where, ids: done.map((t) => `#${t.id}`).join(', ') }) }, author); } catch (error) { log(`bitácora general del OK: ${error.message}`); }
    return done.map((t) => t.id);
  };

  const methods = {
    'app.state': () => ({
      version, home: ctx.home, paths: { projects: ctx.paths.projects, logs: ctx.paths.logs, mcp: ctx.paths.mcp, categories: ctx.paths.categories }, categories: CATEGORIES,
      config: ctx.config, paused: board.setting('paused') === '1', activeProject: board.activeProject(),
      approvals: sessions.allPendingApprovals().map((a) => ({ id: a.id, session_id: a.session_id, body: { title: a.body?.title, reason: a.body?.reason }, session: a.session })),
      counts: Object.fromEntries(board.all('SELECT status, COUNT(*) AS n FROM tasks GROUP BY status').map((r) => [r.status, r.n])),
      // 3.2: what each conversation with the assistant is doing now (only the ones answering or waiting their turn).
      chats: orchestrator.states(), assistant: orchestrator.info(), optiSession: board.setting('opti_session') ?? null,
      // 2.6: the tasks («t<id>») and direct conversations («s<id>») the user put away in «Completadas» of the sidebar;
      // 3.2: kept, the finished tasks the user brought back (a finished task goes to «Completadas» by itself).
      completed: board.settingJson('sidebar_completed') ?? [], kept: board.settingJson('sidebar_kept') ?? [],
      // 3.2.1: the agents this PC can run now (installed, on, with an account): the lists of the window offer only these.
      agentsAvailable: board.availableAgents()
    }),
    'conversations.list': () => conversationList(),
    // 3.2: completed by hand (or open again): a task («t<id>»), a direct conversation («s<id>») or a conversation with the
    // assistant («c<id>»).
    'sidebar.complete': ({ key, done }) => {
      const k = str(key, 'elemento', 100);
      if (!/^[tsc][\w-]{1,90}$/.test(k)) fail(tr('msg.api.missing', { name: fld('elemento') }));
      const finish = done !== false;
      if (k[0] === 'c') { board.setConversationDone(conversationId(k.slice(1)), finish); return { ok: true }; }
      // A direct conversation: its own «settled» (writing in it again opens it), not the list.
      if (k[0] === 's') { sessions.update(sessions.must(k.slice(1)).id, { settled: finish }); board.settingJson('sidebar_completed', (board.settingJson('sidebar_completed') ?? []).filter((x) => x !== k)); board.changed('sidebar'); return { ok: true }; }
      const list = (board.settingJson('sidebar_completed') ?? []).filter((x) => x !== k);
      if (finish) list.unshift(k);
      board.settingJson('sidebar_completed', list.slice(0, 2000));
      if (k[0] === 't') { const kept = (board.settingJson('sidebar_kept') ?? []).filter((x) => x !== k); if (!finish) kept.unshift(k); board.settingJson('sidebar_kept', kept.slice(0, 500)); }
      board.changed('sidebar');
      return { ok: true };
    },
    'config.save': ({ patch }) => { const c = saveConfig(patch ?? {}); emit('config:changed', c); return c; },

    // «Comprobar» / «Comprobar todo» also ask the agents again for their models (in the background).
    'agents.status': ({ refresh }) => {
      if (refresh) {
        forgetInstalled(); refreshAllModels(board, { force: true, log });
        if (!process.env.ORB_FAKE_AGENTS) import('./plans.mjs').then(({ refreshPlans }) => refreshPlans(board, { force: true, log })).catch(() => {});
      }
      return statusAll({ refresh: Boolean(refresh) });
    },
    'agents.check': ({ agent }) => { const a = oneOf(agent, AGENT_IDS, 'agente'); forgetInstalled(); refreshModels(board, a, { force: true, log }); return agentStatus(a, { refresh: true }); },
    'agents.login': ({ account: id, agent }) => {
      const acc = str(id ?? agent, 'cuenta', 40);
      openLogin(acc);
      // A pause because it had no login is lifted: the user is signing in now.
      if ([translate('es', 'msg.budget.noLogin'), translate('en', 'msg.budget.noLogin')].includes(board.setting(`cooldown_reason:${acc}`))) { board.setting(`cooldown:${acc}`, ''); board.setting(`cooldown_reason:${acc}`, ''); }
    },
    // ---- accounts: several subscriptions of the same agent
    'accounts.add': ({ agent, label, home }) => {
      agent = oneOf(agent, AGENT_IDS, 'agente');
      if (!MULTI[agent]) fail(tr('msg.api.oneAccountOnly', { agent }));
      const before = board.all("SELECT run_account AS a FROM tasks WHERE run_account IS NOT NULL UNION SELECT account FROM tasks WHERE account IS NOT NULL UNION SELECT account FROM sessions WHERE account IS NOT NULL").map((r) => r.a);
      const id = newAccountId(agent, before);
      // Without a folder chosen by the user, the account gets its own inside the assistant's folder.
      const dir = str(home, 'carpeta', 1000, { optional: true }) || path.join(ctx.paths.internal, 'cuentas', id);
      if (!path.isAbsolute(dir)) fail(tr('msg.api.accountAbs'));
      try { checkAccountHome(dir, ctx.config, board.projects().map((p) => p.path)); } catch (error) { fail(error.message); }
      // 3.0: the folder of an account this agent already has (also the default one, ~/.codex, through a link or another
      // spelling) would count the same subscription twice: its quota and its parallel runs.
      const real = (p) => { try { return fs.realpathSync.native(p).toLowerCase(); } catch { return path.resolve(p).toLowerCase(); } };
      if (accountsOf(agent).some((a) => real(accountDir(a)) === real(dir))) fail(tr('msg.ctx.sameHome'));
      fs.mkdirSync(dir, { recursive: true });
      const c = saveConfig({ accounts: [...ctx.config.accounts, { id, agent, label: oneLine(str(label, 'nombre', 60), 60), home: dir, enabled: true }] });
      emit('config:changed', c);
      return c.accounts.find((a) => a.id === id);
    },
    // 2.7: saved logins of this agent elsewhere on the PC that are not accounts yet (only presence is checked).
    'accounts.scan': async ({ agent }) => {
      agent = oneOf(agent, AGENT_IDS, 'agente');
      if (!MULTI[agent]) fail(tr('msg.api.oneAccountOnly', { agent }));
      const found = await findAccountFolders(agent);
      if (agent !== 'codex' || !found.length) return found;
      // Codex says whose account each folder holds: a folder with an account Orb already has, or a copy of another
      // folder found (the most recent is kept), is not offered. Each one gets its plan (Go, Plus, Pro…) for its name.
      let exe = null; try { exe = executable('codex'); } catch { /* not installed: offered as found */ }
      if (!exe) return found;
      // 3.0: three questions at a time (each one starts Codex for a moment), every account and folder compared.
      const limited = async (items, fn, n = 3) => { const out = new Array(items.length); let next = 0; await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => { while (next < items.length) { const i = next++; out[i] = await fn(items[i]); } })); return out; };
      const mine = await limited(accountsOf('codex'), (a) => codexAccountInfo(exe, accountDir(a)));
      const theirs = await limited(found, (f) => codexAccountInfo(exe, f.dir));
      const seen = new Set(mine.map((i) => i?.who).filter(Boolean));
      const out = [];
      // A folder Codex could not say about is offered but never added by itself (unchecked: it may be a copy).
      found.forEach((f, i) => { const info = theirs[i]; if (info?.who && seen.has(info.who)) return; if (info?.who) seen.add(info.who); out.push({ ...f, plan: info?.plan ?? null, checked: Boolean(info?.who) }); });
      return out;
    },
    'accounts.update': ({ id, label, enabled }) => {
      const acc = ctx.config.accounts.find((a) => a.id === str(id, 'cuenta', 40)) ?? fail(tr('msg.api.noAccount'));
      const next = ctx.config.accounts.map((a) => (a.id === acc.id ? { ...a, ...(label !== undefined ? { label: oneLine(str(label, 'nombre', 60), 60) } : {}), ...(enabled !== undefined ? { enabled: Boolean(enabled) } : {}) } : a));
      const c = saveConfig({ accounts: next }); emit('config:changed', c); return true;
    },
    'accounts.remove': ({ id }) => {
      const acc = ctx.config.accounts.find((a) => a.id === str(id, 'cuenta', 40)) ?? fail(tr('msg.api.noAccount'));
      if (acc.id === acc.agent) fail(tr('msg.api.mainAccount'));
      if (board.one("SELECT COUNT(*) AS n FROM tasks WHERE status = 'running' AND run_account = ?", acc.id).n) fail(tr('msg.api.accountRunning'));
      if (board.one("SELECT COUNT(*) AS n FROM sessions WHERE status = 'running' AND account = ?", acc.id).n) fail(tr('msg.api.accountBusy'));
      if (ctx.config.orchestrator.account === acc.id) fail(tr('msg.api.accountAssistant'));
      // The folder (and its login) stays on disk: removing an account from the app never signs anyone out.
      const c = saveConfig({ accounts: ctx.config.accounts.filter((a) => a.id !== acc.id) }); emit('config:changed', c); return true;
    },
    // Git is needed for undo with history, isolated copies and GitHub: the Agents screen warns when it is missing.
    'installer.check': () => installer.check(),
    'installer.start': ({ ids }) => { if (!Array.isArray(ids) || ids.some((x) => typeof x !== 'string')) fail(tr('msg.api.badList')); return installer.start(ids, emit); },
    'installer.progress': () => installer.progress(),
    'system.check': async () => { const r = await quickRun('git', ['--version'], { timeoutMs: 8000 }); return { platform: process.platform, git: r.ok ? r.out.replace(/^git version\s*/, '') : null }; },

    'projects.list': () => (syncSoon(), board.projects()).map((p) => ({ ...p, inHome: insideHome(p.path), category: categoryOf(realHome, p.path), active: board.setting('active_project') === p.name, open: board.one("SELECT COUNT(*) AS n FROM tasks WHERE project = ? AND status IN ('queued', 'awaiting_approval', 'running')", p.name).n })),
    // 2.7: several platforms at once (categories) = a multiplatform group; returns the first project and the whole list.
    'projects.create': ({ name, notes, category, categories }) => {
      const cats = Array.isArray(categories) && categories.length ? categories.slice(0, 4).map((c) => oneOf(c, CATEGORIES, 'categoría')) : [oneOf(category, CATEGORIES, 'categoría', undefined)];
      const made = createProjects(board, { name: str(name, 'nombre', 60), notes: str(notes, 'notas', 2000, { optional: true }), categories: cats }, 'usuario');
      return { ...made[0], all: made.map((p) => p.name) };
    },
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
    // 3.2: the projects' icons (their favicon or app icon, or one chosen here) for the sidebar: { name: dataUrl | null }.
    'projects.icons': () => Object.fromEntries(board.projects().map((p) => [p.name, projectIcon(p)])),
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
    'projects.info': ({ name }) => github.projectInfo(project(name)),
    'projects.commit': ({ name, message }) => github.commitAll(project(name), str(message, 'mensaje', 200)),
    'projects.merge': ({ name, branch }) => github.mergeBranch(project(name), str(branch, 'rama', 120)),
    'projects.push': ({ name, branch }) => github.push(project(name), str(branch, 'rama', 120)),
    'projects.createPr': ({ name, branch, title, body, base }) => github.createPr(project(name), { branch: str(branch, 'rama', 120), title: str(title, 'título', 200), body: str(body, 'descripción', 20000, { optional: true }), base: str(base, 'rama base', 120, { optional: true }) || undefined }),
    'projects.createRepo': ({ name, repo, isPrivate }) => github.createRepo(project(name), { name: str(repo, 'repositorio', 100), isPrivate: isPrivate !== false }),
    'projects.clone': async ({ repo, name, category }) => {
      if (name) checkProjectName(name);
      const folder = await github.clone(str(repo, 'repositorio', 300), str(name, 'nombre', 60, { optional: true }), oneOf(category, CATEGORIES, 'categoría', undefined));
      return board.addProject({ name: oneLine(name || path.basename(folder), 60), path: folder }, 'usuario', { fromUser: true });
    },

    // Orb's own folders, managed only from Ajustes: the MCP servers' folder and Android's tools.
    'mcp.folder': () => mcpFolder(),
    'android.status': () => adbStatus(),
    'android.install': () => ensureAdb({ log, force: true }),
    // 2.7: Monitoreo del equipo › Red (core/network.mjs): real readings of Windows, PC only.
    'net.wifi': () => net.wifi(),
    'net.nearby': () => net.nearby(),
    'net.devices': async ({ sweep }) => {
      const r = await net.devices({ sweep: sweep === true });
      const names = board.settingJson('net_names') ?? {};
      return { ...r, devices: r.devices.map((d) => ({ ...d, alias: names[d.mac] ?? null })) };
    },
    'net.rename': ({ mac, name }) => {
      const m = str(mac, 'mac', 17); if (!/^([0-9a-f]{2}:){5}[0-9a-f]{2}$/.test(m)) fail(tr('msg.api.invalid', { name: 'mac' }));
      const names = board.settingJson('net_names') ?? {}; const n = oneLine(str(name, 'nombre', 40, { optional: true }) ?? '', 40).trim();
      if (n) names[m] = n; else delete names[m];
      board.settingJson('net_names', names); return true;
    },
    // Another computer of the network, without Orb on it: Windows' own Remote Desktop, or SSH in a terminal (each asks for
    // its own login; Orb never sees it).
    'net.remote': ({ ip, kind, user }) => {
      const host = str(ip, 'ip', 15); if (!/^\d{1,3}(\.\d{1,3}){3}$/.test(host)) fail(tr('msg.api.invalid', { name: 'ip' }));
      const how = oneOf(kind, ['rdp', 'ssh'], 'tipo');
      if (how === 'rdp') { spawn('mstsc.exe', [`/v:${host}`], { detached: true, stdio: 'ignore', windowsHide: false }).unref(); return true; }
      const who = str(user, 'usuario', 32); if (!/^[\w.-]{1,32}$/.test(who)) fail(tr('msg.api.invalid', { name: 'usuario' }));
      spawn('cmd.exe', ['/c', 'start', 'SSH', 'cmd.exe', '/k', 'ssh', `${who}@${host}`], { detached: true, stdio: 'ignore' }).unref();
      return true;
    },
    // Android phones and TVs by adb (wireless pairing with the code the device shows).
    'android.devices': async () => (adbStatus().ready ? { ready: true, devices: await net.adbDevices(adbPath()) } : { ready: false, devices: [] }),
    'android.pair': ({ host, code }) => net.adbPair(adbPath(), str(host, 'dirección', 21), str(code, 'código', 6)),
    'android.connect': ({ host }) => net.adbConnect(adbPath(), str(host, 'dirección', 21)),
    'android.info': ({ serial }) => net.adbInfo(adbPath(), str(serial, 'dispositivo', 80)),

    'github.status': () => github.status(),
    'github.contributions': () => github.contributions(),
    'github.login': () => github.login(),

    // 3.2: a conversation's lines (the last 160, or 120 more before a line).
    // Without a conversation: the lines of none (tasks made by hand or by a schedule), which the window shows as notices.
    'chat.list': ({ conversation, before }) => board.chat(conversation == null ? null : conversationId(conversation), before ? 120 : 160, { before: before ? int(before, 'mensaje') : null }).map(withAccepted),
    // A message to a conversation with the assistant; without one, it starts a new conversation (in the project given, or
    // the working folder). → { conversation }
    'chat.send': ({ text, conversation, project: name }) => {
      const t = str(text, 'mensaje', 20000);
      const id = conversation == null ? null : conversationId(conversation);
      const proj = name === undefined ? undefined : name ? project(name).name : null;
      if (!id && (ctx.config.orchestrator?.agent || 'claude') === 'cursor') fail(tr('msg.api.cursorNoCoordinate'));
      return orchestrator.ask(t, expandMentions(board, sessions, t), { conversation: id, project: proj });
    },
    'chat.stop': ({ conversation }) => orchestrator.stop(conversationId(conversation)),
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
        const conversations = board.all("SELECT c.id, c.title, (SELECT group_concat(m.body, ' ') FROM chat m WHERE m.conversation_id = c.id AND m.role IN ('usuario', 'orb')) AS text FROM conversations c").filter((r) => has(r.title) || has(r.text)).slice(0, 100).map((r) => r.id);
        const found = board.all("SELECT s.id, s.title, (SELECT group_concat(i.body, ' ') FROM session_items i WHERE i.session_id = s.id AND i.kind = 'text') AS text FROM sessions s WHERE s.kind = 'chat'").filter((r) => has(r.title) || has(r.text)).slice(0, 100).map((r) => r.id);
        return { conversations, sessions: found };
      }
      const conversations = board.all("SELECT DISTINCT c.id FROM conversations c LEFT JOIN chat m ON m.conversation_id = c.id AND m.role IN ('usuario', 'orb') WHERE lower(c.title) LIKE ? ESCAPE '!' OR lower(m.body) LIKE ? ESCAPE '!' LIMIT 100", like, like).map((r) => r.id);
      const found = board.all("SELECT DISTINCT s.id FROM sessions s LEFT JOIN session_items i ON i.session_id = s.id AND i.kind = 'text' WHERE s.kind = 'chat' AND (lower(s.title) LIKE ? ESCAPE '!' OR lower(i.body) LIKE ? ESCAPE '!') LIMIT 100", like, like).map((r) => r.id);
      return { conversations, sessions: found };
    },
    // 2.7: Monitoreo del equipo (src/engine/opti.mjs): Opti Bot's conversation, the PC's quick numbers and the answer to
    // one of its action cards. PC only (not in the phone's list).
    'opti.session': () => optiApi.session(),
    'opti.stats': async () => ({ ...(await quickStats()), oce: readOce() }),
    'opti.act': ({ item, decision }) => optiApi.act({ item: int(item, 'tarjeta'), decision: oneOf(decision, ['allow', 'deny'], 'decisión') }),
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
    'whiteboard.load': ({ project }) => wb.load({ project: str(project, 'proyecto', 200) }),
    'whiteboard.save': ({ project, elements, appState, files, png }) => wb.save({ project: str(project, 'proyecto', 200), elements, appState, files, png }),
    'whiteboard.attach': ({ project, paths }) => wb.attach({ project: str(project, 'proyecto', 200), paths }),
    'whiteboard.note': ({ project, file, note }) => wb.note({ project: str(project, 'proyecto', 200), file: str(file, 'archivo', 200), note }),
    'whiteboard.remove': ({ project, file }) => wb.remove({ project: str(project, 'proyecto', 200), file: str(file, 'archivo', 200) }),
    'whiteboard.folder': ({ project }) => wb.folder({ project: str(project, 'proyecto', 200) }),
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
    'chat.settings': ({ conversation, agent, model, reasoning, orchestrate, account: acc }) => {
      const o = ctx.config.orchestrator;
      const conv = conversation == null ? null : board.conversation(conversationId(conversation));
      const base = conv ? { agent: conv.agent, account: conv.account, model: conv.model, reasoning: conv.reasoning } : o;
      const patch = {};
      if (agent !== undefined) {
        if (!modelCatalog(board).some((a) => a.id === agent)) fail(tr('msg.api.agentUnavailable', { agent: String(agent).slice(0, 40) }));
        patch.agent = agent;
      }
      const brain = patch.agent ?? base.agent ?? 'claude';
      if (acc !== undefined) patch.account = str(acc, 'cuenta', 40);
      else if (patch.agent && patch.agent !== (base.agent ?? 'claude')) patch.account = brain; // another agent: its own account
      if (model !== undefined) {
        const m = String(model ?? '');
        if (brain === 'claude' && m && !o.models.some((x) => x.id === m) && !/^(sonnet|opus|haiku)$/.test(m)) {
          // 2.6: a model Claude Code itself offers (discovered) joins the assistant's models, so the settings stay valid.
          const offered = (board.settingJson('models:claude') ?? []).find((x) => x.id === m);
          if (!offered || !/^[\w.:-]{1,80}$/.test(m)) fail(tr('msg.api.modelUnavailable'));
          patch.models = [...o.models, { id: m, label: offered.label }];
        }
        if (m && !/^[A-Za-z0-9][\w.:\-/[\]=,@]{0,79}$/.test(m)) fail(tr('msg.api.modelUnavailable'));
        patch.model = m || (brain === 'claude' ? 'claude-sonnet-5-5' : '');
      } else if (patch.agent && patch.agent !== (base.agent ?? 'claude')) patch.model = brain === 'claude' ? 'claude-sonnet-5-5' : '';
      if (reasoning !== undefined) patch.reasoning = oneOf(reasoning, ['low', 'medium', 'high'], 'razonamiento');
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
      // The choice is also the one the next new conversation starts with.
      const c = saveConfig({ orchestrator: patch });
      emit('config:changed', c);
      const info = orchestrator.info(conv?.id ?? null);
      const level = { low: tr('msg.api.reasoningLow'), medium: tr('msg.api.reasoningMedium'), high: tr('msg.api.reasoningHigh') }[info.reasoning] ?? info.reasoning;
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
      const undone = new Set(board.all("SELECT key FROM settings WHERE key LIKE 'undone:%' AND value <> '' AND value <> 'null'").map((r) => Number(r.key.slice('undone:'.length))));
      return board.panelTasks(Math.min(Number(limit) || 150, 500)).map(({ approval_hash, approval_sig, ...task }) => ({ ...task, description: cut(task.description), result: cut(task.result), ...(undone.has(task.id) ? { undone: true } : {}) }));
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
        reasoning: oneOf(p.reasoning, ['low', 'medium', 'high'], 'razonamiento', 'medium'), permission: proj ? oneOf(p.permission, PERMISSIONS, 'permiso', 'editar') : 'leer',
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
      if (s.kind === 'chat' && !s.titled && !sessions.isOpti(s)) {
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
    'sessions.stop': ({ id }) => { const s = sessions.must(str(id, 'conversación', 64)); if (s.kind === 'task') return scheduler.cancel(s.task_id, 'usuario'); return sessions.stop(s.id); },
    'sessions.update': ({ id, title, model, reasoning, permission, archived }) => {
      const s = sessions.must(str(id, 'conversación', 64));
      if (s.kind === 'task' && (model !== undefined || permission !== undefined || reasoning !== undefined)) fail(tr('msg.api.taskModelFromTask'));
      const fields = {};
      if (title !== undefined) fields.title = oneLine(str(title, 'título', 80), 80);
      if (model !== undefined) fields.model = str(model, 'modelo', 80, { optional: true }) || null;
      if (reasoning !== undefined) fields.reasoning = oneOf(reasoning, ['low', 'medium', 'high'], 'razonamiento');
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
    // 3.2.1: the user lifts an account's usage pause (and its models without usage) by hand.
    'accounts.clearCooldown': ({ account: id }) => {
      const acc = str(id, 'cuenta', 40);
      if (!ctx.config.accounts.some((a) => a.id === acc)) fail(tr('msg.api.noAccount'));
      clearCooldown(board, acc);
      return true;
    },
    // 2.6: the accounts working right now (the assistant's brain and the agents' running sessions), with the windows of
    // their plan the agents reported (session, weekly…), for the panel of the context ring.
    'usage.now': () => {
      // 3.2: the brain of the conversations answering now (or the one new conversations use).
      const brain = orchestrator.info(); const brainAccount = orchestrator.states().find((x) => x.busy) ? board.conversation(orchestrator.states().find((x) => x.busy).conversation)?.account ?? brain.account : brain.account;
      const busy = board.all("SELECT DISTINCT account, agent FROM sessions WHERE status = 'running' AND account IS NOT NULL");
      const report = usageReport(board);
      // Then the other accounts whose plan reported its usage lately (a task that just finished still counts).
      const ids = [...new Set([brainAccount, ...busy.map((s) => s.account), ...report.filter((u) => u.windows?.length).map((u) => u.account)].filter(Boolean))];
      return ids.map((id) => report.find((u) => u.account === id) ?? { account: id, agent: busy.find((s) => s.account === id)?.agent ?? brain.agent, label: id, windows: [] })
        .map((u) => ({ account: u.account, agent: u.agent, label: u.label, windows: u.windows ?? [], cooldownUntil: u.cooldownUntil ?? null, brain: u.account === brainAccount }));
    },
    // Expert mode (PC only, read-only): the project's files, git and the machine's load.
    'expert.tree': ({ project: name, dir }) => expert.tree(project(name).path, str(dir, 'carpeta', 1000, { optional: true })),
    'expert.read': ({ project: name, path: file }) => expert.readFile(project(name).path, str(file, 'archivo', 1000)),
    'expert.status': ({ project: name }) => expert.gitStatus(project(name).path),
    'expert.diff': ({ project: name, path: file }) => expert.gitDiff(project(name).path, str(file, 'archivo', 1000, { optional: true })),
    'expert.log': ({ project: name, limit }) => expert.gitLog(project(name).path, limit),
    'expert.system': () => ({ ...expert.systemStats(ctx.home), running: sessions.runningCount(), byAgent: Object.fromEntries(AGENT_IDS.map((a) => [a, sessions.runningCount(a)])) }),
    // ---- phone access (PC only: these are not in the phone's allowed list)
    'remote.status': () => remoteRef.current.status(),
    'remote.enable': async ({ enabled }) => {
      const c = saveConfig({ mobile: { enabled: Boolean(enabled) } }); emit('config:changed', c);
      if (enabled) await remoteRef.current.start(); else await remoteRef.current.stop();
      return remoteRef.current.status();
    },
    // The ways in: home Wi-Fi and/or Tailscale (the servers reopen with the new choice).
    'remote.configure': async ({ wifi, tailscale }) => {
      const patch = {};
      if (typeof wifi === 'boolean') patch.wifi = wifi;
      if (typeof tailscale === 'boolean') patch.tailscale = tailscale;
      const c = saveConfig({ mobile: patch }); emit('config:changed', c);
      if (c.mobile.enabled) await remoteRef.current.restart();
      return remoteRef.current.status();
    },
    'remote.pair': ({ kind }) => remoteRef.current.pair(oneOf(kind, ['wifi', 'tailscale'], 'vía', undefined)),
    'remote.revoke': ({ id }) => remoteRef.current.revoke(str(id, 'dispositivo', 64)),
    'control.pause': () => { board.setting('paused', '1'); board.changed('settings'); return true; },
    'control.resume': () => { board.setting('paused', '0'); board.changed('settings'); return true; }
  };

  return {
    async call(method, params) {
      const fn = Object.hasOwn(methods, method) ? methods[method] : null;
      if (!fn) fail(tr('msg.api.unknownAction', { method }));
      if (params === null || typeof params !== 'object' || Array.isArray(params)) fail(tr('msg.api.badParams'));
      const out = await fn(params);
      // 3.1: an agent turned on or off, checked again, or an account added or removed: the list of available agents is
      // updated at once (the next task may already be for it).
      if (/^(config\.save|agents\.(status|check)|accounts\.(add|update|remove))$/.test(method)) { try { scheduler.refreshAvailable(true); } catch { /* next tick */ } }
      return out;
    },
    // New chat lines since the last call, sent to the window as 'chat:new' (corner robot, robot notices) or 'notice' (toasts).
    notifyNewChat() {
      try { optiApi.flush(); } catch { /* Opti Bot off or its conversation gone */ }
      const rows = board.all('SELECT id, role, body, meta, conversation_id FROM chat WHERE id > ? ORDER BY id LIMIT 20', lastChat);
      if (!rows.length) return;
      lastChat = rows[rows.length - 1].id;
      for (const r of rows) if (r.role === 'notice') { let tone = 'info'; try { tone = JSON.parse(r.meta)?.tone ?? 'info'; } catch { /* plain */ } emit('notice', { body: oneLine(r.body, 300), tone }); } // 2.7: a passing notification, not a chat line
      else if (r.role !== 'usuario') {
        let meta = null; try { meta = r.meta ? JSON.parse(r.meta) : null; } catch { /* plain */ }
        // 3.2: a plain line of no conversation (a task made by hand or by a schedule) passes by as a notification.
        if (r.role === 'system' && r.conversation_id == null && !meta?.kind) emit('notice', { body: oneLine(r.body, 300), tone: 'info' });
        else emit('chat:new', { role: r.role, body: oneLine(r.body, 240), meta, conversation: r.conversation_id ?? null });
      }
    },
    // Running tasks stay "running": the next start continues them (scheduler.finish does not close them while closing).
    shutdown() { scheduler.closing = true; orchestrator.closing = true; sessions.stopAll(); orchestrator.stopAll(); orchestrator.closeLive(); log('motor detenido'); }
  };
}
