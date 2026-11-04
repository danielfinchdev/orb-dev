// Every action the window can ask the engine for. Parameters are validated here (the window is trusted UI, but its
// inputs come from people and agents' text, so nothing is passed on unchecked). Actions marked as the user's ("usuario")
// are the only ones that sign approvals or publish.
// 3.6: the dispatcher authorizes every call first (src/core/authz.mjs with the rules of src/core/policy.mjs) and the
// methods live in several files: here the conversations, chat, tasks, sessions, projects, schedules, logs, whiteboard and
// usage; api-bots.mjs, api-link.mjs, api-accounts.mjs, api-persons.mjs and api-data.mjs the rest. Each method gets
// (params, principal).
import fs from 'node:fs';
import path from 'node:path';
import { ctx, saveConfig, tr, role, isHeadless } from '../core/context.mjs';
import { AGENT_IDS, categoryOf, CATEGORIES } from '../core/home.mjs';
import { accountsOf, accountDir, accountLabel, accounts as allAccounts } from '../core/accounts.mjs';
import { usageReport, modelName, mayUseAccount, accountPerson, usageByPerson } from '../core/budget.mjs';
import { brainOf } from './orchestrator.mjs';
import { createProjects, syncProjects, checkProjectName, renameProject } from '../core/projects.mjs';
import { PRODUCT } from '../core/product.mjs';
import { listSchedules, createSchedule, updateSchedule, removeSchedule, runSchedule, getSchedule, describe as describeSchedule, EVERY } from '../core/schedules.mjs';
import { oneLine, redactSecrets, localStamp } from '../core/safety.mjs';
import { quickRun } from '../agents/index.mjs';
import { PERMISSIONS } from './sessions.mjs';
import { readLog, writeLog, logFiles } from './logs.mjs';
import { expandMentions, mentionOptions } from './mentions.mjs';
import { ofUserLabel, userLabel, assistantName, userName } from '../core/board.mjs';
import * as github from './github.mjs';
import * as installer from './installer.mjs';
import * as expert from './expert.mjs';
import { adbStatus, ensureAdb, adbPath, markAdbUsed } from './android.mjs';
import * as net from '../core/network.mjs';
import { spawn } from 'node:child_process';
import { mcpFolder } from './mcp-folder.mjs';
import { modelCatalog, chooseModel, LEVELS } from './catalog.mjs';
import { whiteboard } from './whiteboard.mjs';
import { opti } from './opti.mjs';
import { readOce } from './bridge.mjs';
import { quickStats } from '../core/pc-health.mjs';
import { titleFrom } from '../core/titles.mjs';
import { autoTitle } from './titles.mjs';
import { projectIcon, setProjectIcon, clearProjectIcon, renameProjectIcon } from './project-icons.mjs';
import { git, slug } from '../core/workspace.mjs';
import { authorize, principalOf, shapeFor, can, scopeSql, rightOn, ownerOf, RIGHTS, audit, AuthzError } from '../core/authz.mjs';
import { fld, fail, str, int, oneOf, images, DECISION } from './api-common.mjs';
import { botMethods, centroApi } from './api-bots.mjs';
import { linkMethods } from './api-link.mjs';
import { accountMethods } from './api-accounts.mjs';
import { personMethods } from './api-persons.mjs';
import { dataApi, MOVED_OK } from './api-data.mjs';

export { fail, str, int, oneOf } from './api-common.mjs';
// 3.5: what a server without a window (Orb Núcleo) does not do, whatever its role: the PC's development tools (God mode and expert view,
// Opti Bot, which is all Windows, and opening Remote Desktop or a console). Conversations, tasks, schedules, the phone
// access and the MCP servers stay.
// 3.5: the agents' sign-in no longer needs a console (agents.login gives the link and code), so it works on the server too.
const CENTRO_OFF = /^(expert.|opti.|actions.|net.remote$|installer.start$|github.login$)/;
export const centroAllows = (method) => !CENTRO_OFF.test(String(method));
const SHARE_TYPES = ['project', 'bot', 'group', 'integration'];
const SHARE_RANK = { view: 1, talk: 2, edit: 3, own: 4 };
const rank = (r) => SHARE_RANK[r] ?? 0;

export function buildApi({ board, sessions, orchestrator, scheduler, emit, log, version, remoteRef = { current: null }, bots = null }) {
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
  // 3.6: someone other than the owner: only their projects (and the ones shared with them), their own accounts' folders
  // and their own marked copies.
  const allowedImage = (file, who = null) => {
    const real = (() => { try { return fs.realpathSync(file); } catch { return fail(tr('msg.api.badImage')); } })();
    if (!/\.(png|jpe?g|webp|gif)$/i.test(real)) fail(tr('msg.api.badImage'));
    const other = personOf(who);
    const accs = [...accountsOf('codex'), ...accountsOf('claude')].filter((a) => !other || accountPerson(board, a) === other);
    const roots = other ? [markDir(who), ...board.projects({ principal: who }).map((p) => p.path), ...accs.map((a) => accountDir(a))]
      : [ctx.home, ...board.projects({ principal: who?.channel === 'system' ? null : who }).map((p) => p.path), ...accs.map((a) => accountDir(a))];
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
    orchestrator.internal(`AVISO DEL SISTEMA (no es ${userName()}): ${userName()} ha rechazado la tarea #${task.id} «${oneLine(task.title)}». No se hará y no se ha tocado ningún archivo. No la vuelvas a crear salvo que te lo pida. Díselo en una línea y sigue con el resto del pedido, si lo hay.`, line, null, { conversation: conv, project: task.project, person: task.person_id ?? null });
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
  // 3.6: the person a call acts for when it is not the owner (null: the owner, or the engine itself: everything as 3.5.1).
  function personOf(who) { return who && who.channel !== 'system' && who.role !== 'owner' ? who.person : null; }
  function markDir(who) { const p = personOf(who); return path.join(ctx.paths.internal, 'imagenes', ...(p ? [p.replace(/[^\w-]/g, '_')] : [])); }
  const scopeOf = (who) => (who && who.channel !== 'system' ? who : null);
  // The sidebar's lists per person (the owner's keep their 3.5.1 keys).
  const sideKey = (name, who) => (personOf(who) ? `${name}:${personOf(who)}` : name);
  // A task text cut for the lists (the window shows a few hundred characters of each).
  const cut = (s) => (typeof s === 'string' && s.length > 1200 ? `${s.slice(0, 1200)}…` : s);
  // Folders made by hand in the Explorer: the engine's loop looks every 5 s; a list asked for in between looks at most
  // every 2 s (each refresh of the window asks for it).
  let lastSync = 0;
  const syncSoon = () => { if (Date.now() - lastSync > 2000) { lastSync = Date.now(); syncProjects(board); } };
  const withAccepted = (m) => (m.meta?.kind === 'report' ? { ...m, meta: { ...m.meta, accepted: m.meta.tasks.length > 0 && m.meta.tasks.every((id) => board.isAccepted(id)) } } : m);
  // 3.2: the conversations for the sidebar, with how their tasks go, whether the assistant is answering in them now and
  // whether a question of its waits for the user (three queries for all of them, not three each).
  const conversationList = (who = null) => {
    const counts = {};
    for (const r of board.all('SELECT conversation_id AS c, status, COUNT(*) AS n FROM tasks WHERE conversation_id IS NOT NULL GROUP BY conversation_id, status')) (counts[r.c] ??= {})[r.status] = r.n;
    const asking = new Set(board.all(`SELECT DISTINCT conversation_id AS c FROM chat WHERE conversation_id IS NOT NULL AND meta LIKE '%"kind":"question"%' AND meta LIKE '%"status":"pending"%'`).map((r) => r.c));
    const live = new Map(orchestrator.states().map((x) => [x.conversation, x]));
    return board.conversations({ principal: scopeOf(who) }).map((c) => ({ id: c.id, title: c.title, project: c.project, agent: c.agent, account: c.account, model: c.model, reasoning: c.reasoning, status: c.status,
      created_at: c.created_at, updated_at: c.updated_at, done_at: c.done_at, context: c.context ?? null, tasks: counts[c.id] ?? {}, busy: Boolean(live.get(c.id)?.busy), waiting: Boolean(live.get(c.id)?.waiting), asking: asking.has(c.id) }));
  };
  // 3.2: a conversation is done when the user gave the OK to its work and none of its tasks is still open.
  const settleConversation = (id) => { if (id && board.conversation(id)?.status === 'open' && !board.openTasksOf(id) && !orchestrator.state(id).busy) board.setConversationDone(id, true); };

  // The user's OK closes the loop: tasks marked accepted, a line in the chat and an entry in the project's log.
  const accept = (ids, project, who = null) => {
    // 3.2.1: an undone task has no result left to accept.
    const done = board.accept(ids.filter((id) => !board.settingJson(`undone:${id}`)), 'usuario');
    if (!done.length) fail(tr('msg.api.noDoneTasks'));
    // 3.6: said in the name of whoever gives the OK, to them (and in their own general log).
    const other = personOf(who); const name = other ? board.personName(other) : userLabel();
    board.notice(tr(done.length > 1 ? 'msg.api.okMany' : 'msg.api.okOne', { who: other ? tr('msg.board.ofName', { name }) : ofUserLabel(), ids: done.map((t) => `#${t.id}`).join(', ') }), 'success', { person: other });
    // 3.2.1: signed as Orb with whose OK it is (not «Orbe (app)»), and the general log gets each cycle too (it only had the
    // assistant's first entry of the day).
    const entry = { tema: tr('sys.logs.okTopic', { ids: done.map((t) => `#${t.id}`).join(', ') }), pedido: tr('sys.logs.okRequest'), hecho: tr('sys.logs.okDone', { user: name, list: done.map((t) => `#${t.id} ${oneLine(t.title, 80)}`).join('; ') }), estado: tr('sys.logs.okStatus') };
    const author = `${PRODUCT.name} (${tr('sys.logs.okBy', { user: name })})`;
    const where = project ?? done[0].project;
    try { writeLog(board, where, entry, author); } catch (error) { log(`bitácora del OK: ${error.message}`); }
    try { writeLog(board, 'general', { ...entry, tema: tr('sys.logs.okGeneralTopic', { project: where, ids: done.map((t) => `#${t.id}`).join(', ') }) }, author, { person: other }); } catch (error) { log(`bitácora general del OK: ${error.message}`); }
    return done.map((t) => t.id);
  };
  // 3.6: who sits at this PC's window (the owner until persons.switch; the lock screen is WS2's).
  const desktop = { person: null };
  const desktopPrincipal = () => principalOf(board, { desktop: true, person: desktop.person });
  // What the other parts of the API share.
  const shared = { board, sessions, orchestrator, scheduler, emit, log, version, remoteRef, bots, project, conversationId, desktop };
  const data = dataApi(shared); shared.removePersonData = data.removePersonData; // 3.6 (WS5): backups, templates, moving the Orb, exporting and deleting a person

  const methods = {
    // 3.6: what each person sees is theirs (and what is shared with them): their approvals, tasks, conversations and lists.
    'app.state': (p, who) => ({
      version, home: ctx.home, role: role(), paths: { projects: ctx.paths.projects, logs: ctx.paths.logs, mcp: ctx.paths.mcp, categories: ctx.paths.categories }, categories: CATEGORIES,
      config: ctx.config, paused: board.setting('paused') === '1', activeProject: board.activeProject(personOf(who)),
      approvals: visibleApprovals(who).map((a) => ({ id: a.id, session_id: a.session_id, body: { title: a.body?.title, reason: a.body?.reason }, session: a.session })),
      counts: (() => { const s = scopeOf(who) ? scopeSql(who, 'task', 'tasks') : { where: '1=1', args: [] }; return Object.fromEntries(board.all(`SELECT status, COUNT(*) AS n FROM tasks WHERE ${s.where} GROUP BY status`, ...s.args).map((r) => [r.status, r.n])); })(),
      // 3.2: what each conversation with the assistant is doing now (only the ones answering or waiting their turn).
      chats: orchestrator.states().filter((x) => !scopeOf(who) || can(board, who, 'view', { type: 'conversation', id: x.conversation })), assistant: orchestrator.info(null, personOf(who)), optiSession: personOf(who) ? null : board.setting('opti_session') ?? null,
      // 2.6: the tasks («t<id>») and direct conversations («s<id>») the user put away in «Completadas» of the sidebar;
      // 3.2: kept, the finished tasks the user brought back (a finished task goes to «Completadas» by itself).
      completed: board.settingJson(sideKey('sidebar_completed', who)) ?? [], kept: board.settingJson(sideKey('sidebar_kept', who)) ?? [],
      // 3.2.1: the agents this PC can run now (installed, on, with an account): the lists of the window offer only these.
      agentsAvailable: board.availableAgents(),
      // 3.6: this Orb was moved to another machine (Ajustes › Datos): it serves nothing until the user decides.
      moved: ctx.moved ?? null
    }),
    'conversations.list': (p, who) => conversationList(who),
    // 3.2: completed by hand (or open again): a task («t<id>»), a direct conversation («s<id>») or a conversation with the
    // assistant («c<id>»).
    'sidebar.complete': ({ key, done }, who) => {
      const k = str(key, 'elemento', 100);
      if (!/^[tsc][\w-]{1,90}$/.test(k)) fail(tr('msg.api.missing', { name: fld('elemento') }));
      const finish = done !== false;
      const completedKey = sideKey('sidebar_completed', who); const keptKey = sideKey('sidebar_kept', who);
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
    'config.save': ({ patch }) => {
      const before = [role(), ctx.config.devTarget];
      const c = saveConfig(patch ?? {}); emit('config:changed', c);
      // 3.5: a new role (or «Orb para programar») is told at once to the Orbs linked both ways, and to the phones.
      if (role() !== before[0] || ctx.config.devTarget !== before[1]) {
        try { remoteRef.link?.refresh(); } catch { /* next connection */ }
        try { remoteRef.current?.relinkOrbs(); } catch { /* next connection */ }
      }
      return c;
    },

    // Git is needed for undo with history, isolated copies and GitHub: the Agents screen warns when it is missing.
    'installer.check': () => installer.check(),
    'installer.start': ({ ids }) => { if (!Array.isArray(ids) || ids.some((x) => typeof x !== 'string')) fail(tr('msg.api.badList')); return installer.start(ids, emit); },
    'installer.progress': () => installer.progress(),
    'system.check': async () => { const r = await quickRun('git', ['--version'], { timeoutMs: 8000 }); return { platform: process.platform, git: r.ok ? r.out.replace(/^git version\s*/, '') : null }; },

    // 3.6: each person's own projects and the ones shared with them («shared»: with which right; their active one).
    'projects.list': (params, who) => {
      syncSoon();
      const active = board.activeName(personOf(who));
      return board.projects({ principal: scopeOf(who) }).map((p) => {
        const right = scopeOf(who) ? rightOn(board, who.person, { type: 'project', id: p.name }) : 'own';
        return { ...p, inHome: insideHome(p.path), category: categoryOf(realHome, p.path), active: active === p.name, open: board.one("SELECT COUNT(*) AS n FROM tasks WHERE project = ? AND status IN ('queued', 'awaiting_approval', 'running')", p.name).n,
          ...(right && right !== 'own' ? { shared: right, sharedBy: board.personName(p.person_id) } : {}) };
      });
    },
    // 2.7: several platforms at once (categories) = a multiplatform group; returns the first project and the whole list.
    'projects.create': ({ name, notes, category, categories }, who) => {
      const cats = Array.isArray(categories) && categories.length ? categories.slice(0, 4).map((c) => oneOf(c, CATEGORIES, 'categoría')) : [oneOf(category, CATEGORIES, 'categoría', undefined)];
      const made = createProjects(board, { name: str(name, 'nombre', 60), notes: str(notes, 'notas', 2000, { optional: true }), categories: cats, person: personOf(who) }, 'usuario');
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
    'projects.setActive': ({ name }, who) => board.setActiveProject(name ? project(name).name : '', 'usuario', personOf(who)),
    // 3.2: the projects' icons (their favicon or app icon, or one chosen here) for the sidebar: { name: dataUrl | null }.
    'projects.icons': (p, who) => Object.fromEntries(board.projects({ principal: scopeOf(who) }).map((x) => [x.name, projectIcon(x)])),
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
      if (process.platform !== 'win32') fail(tr('msg.api.windowsOnly'));
      const host = str(ip, 'ip', 15); if (!/^\d{1,3}(\.\d{1,3}){3}$/.test(host)) fail(tr('msg.api.invalid', { name: 'ip' }));
      const how = oneOf(kind, ['rdp', 'ssh'], 'tipo');
      if (how === 'rdp') { spawn('mstsc.exe', [`/v:${host}`], { detached: true, stdio: 'ignore', windowsHide: false }).unref(); return true; }
      const who = str(user, 'usuario', 32); if (!/^[\w.-]{1,32}$/.test(who)) fail(tr('msg.api.invalid', { name: 'usuario' }));
      spawn('cmd.exe', ['/c', 'start', 'SSH', 'cmd.exe', '/k', 'ssh', `${who}@${host}`], { detached: true, stdio: 'ignore' }).unref();
      return true;
    },
    // Android phones and TVs by adb (wireless pairing with the code the device shows). Each use notes that Orb started
    // adb, so the engine stops its server when it closes (android.stopAdb).
    'android.devices': async () => (adbStatus().ready ? (markAdbUsed(), { ready: true, devices: await net.adbDevices(adbPath()) }) : { ready: false, devices: [] }),
    'android.pair': ({ host, code }) => (markAdbUsed(), net.adbPair(adbPath(), str(host, 'dirección', 21), str(code, 'código', 6))),
    'android.connect': ({ host }) => (markAdbUsed(), net.adbConnect(adbPath(), str(host, 'dirección', 21))),
    'android.info': ({ serial }) => (markAdbUsed(), net.adbInfo(adbPath(), str(serial, 'dispositivo', 80))),

    'github.status': () => github.status(),
    'github.contributions': () => github.contributions(),
    'github.login': () => github.login(),

    // 3.2: a conversation's lines (the last 160, or 120 more before a line).
    // Without a conversation: the lines of none (tasks made by hand or by a schedule), which the window shows as notices.
    // 3.6: the lines of no conversation: only the caller's own.
    'chat.list': ({ conversation, before }, who) => board.chat(conversation == null ? null : conversationId(conversation), before ? 120 : 160, { before: before ? int(before, 'mensaje') : null, principal: scopeOf(who) }).map(withAccepted),
    // A message to a conversation with the assistant; without one, it starts a new conversation (in the project given, or
    // the working folder). → { conversation }
    'chat.send': ({ text, conversation, project: name }, who) => {
      const t = str(text, 'mensaje', 20000);
      const id = conversation == null ? null : conversationId(conversation);
      const proj = name === undefined ? undefined : name ? project(name).name : null;
      if (!id && (brainOf(board, personOf(who)).agent || 'claude') === 'cursor') fail(tr('msg.api.cursorNoCoordinate'));
      return orchestrator.ask(t, expandMentions(board, sessions, t, { principal: scopeOf(who) }), { conversation: id, project: proj, person: who?.channel === 'system' ? null : who?.person ?? null });
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
    // 3.6: only among the caller's own conversations.
    'conversations.search': ({ q }, who) => {
      const words = String(q ?? '').trim().toLowerCase().slice(0, 100);
      if (words.length < 2) return { conversations: [], sessions: [] };
      const like = `%${words.replace(/[%_!]/g, (m) => `!${m}`)}%`;
      const sc = scopeOf(who) ? scopeSql(who, 'conversation', 'c') : { where: '1=1', args: [] };
      const ss = scopeOf(who) ? scopeSql(who, 'session', 's') : { where: '1=1', args: [] };
      // SQLite's LIKE ignores case only for ASCII: with accents or «ñ» the words are matched here, in JavaScript.
      if (/[^\x00-\x7f]/.test(words)) {
        const has = (s) => String(s ?? '').toLowerCase().includes(words);
        const conversations = board.all(`SELECT c.id, c.title, (SELECT group_concat(m.body, ' ') FROM chat m WHERE m.conversation_id = c.id AND m.role IN ('usuario', 'orb')) AS text FROM conversations c WHERE c.bot_id IS NULL AND c.group_id IS NULL AND ${sc.where}`, ...sc.args).filter((r) => has(r.title) || has(r.text)).slice(0, 100).map((r) => r.id);
        const found = board.all(`SELECT s.id, s.title, (SELECT group_concat(i.body, ' ') FROM session_items i WHERE i.session_id = s.id AND i.kind = 'text') AS text FROM sessions s WHERE s.kind = 'chat' AND ${ss.where}`, ...ss.args).filter((r) => has(r.title) || has(r.text)).slice(0, 100).map((r) => r.id);
        return { conversations, sessions: found };
      }
      const conversations = board.all(`SELECT DISTINCT c.id FROM conversations c LEFT JOIN chat m ON m.conversation_id = c.id AND m.role IN ('usuario', 'orb') WHERE c.bot_id IS NULL AND c.group_id IS NULL AND ${sc.where} AND (lower(c.title) LIKE ? ESCAPE '!' OR lower(m.body) LIKE ? ESCAPE '!') LIMIT 100`, ...sc.args, like, like).map((r) => r.id);
      const found = board.all(`SELECT DISTINCT s.id FROM sessions s LEFT JOIN session_items i ON i.session_id = s.id AND i.kind = 'text' WHERE s.kind = 'chat' AND ${ss.where} AND (lower(s.title) LIKE ? ESCAPE '!' OR lower(i.body) LIKE ? ESCAPE '!') LIMIT 100`, ...ss.args, like, like).map((r) => r.id);
      return { conversations, sessions: found };
    },
    // 2.7: Monitoreo del equipo (src/engine/opti.mjs): Opti Bot's conversation, the PC's quick numbers and the answer to
    // one of its action cards. PC only (not in the phone's list).
    'opti.session': () => optiApi.session(),
    'opti.stats': async () => ({ ...(await quickStats()), oce: readOce() }),
    ...botMethods(shared),
    'opti.act': ({ item, decision }) => optiApi.act({ item: int(item, 'tarjeta'), decision: oneOf(decision, ['allow', 'deny'], 'decisión') }),
    // 2.7: pictures the agents make (Codex image_gen): shown in the conversation, a zone marked to change, saved in the
    // project. Read only from the agents' own picture folders, Orb's folder and the projects; written only into Orb's
    // folder (the marked copy) and <project>/imagenes.
    'images.read': ({ path: file }, who) => {
      const f = allowedImage(str(file, 'imagen', 1000), who);
      const ext = path.extname(f).slice(1).toLowerCase();
      return { dataUrl: `data:${ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg' : ext === 'webp' ? 'image/webp' : ext === 'gif' ? 'image/gif' : 'image/png'};base64,${fs.readFileSync(f).toString('base64')}` };
    },
    'images.mark': ({ dataUrl }, who) => {
      const m = /^data:image\/png;base64,([A-Za-z0-9+/=]+)$/.exec(String(dataUrl ?? ''));
      if (!m || m[1].length > 34 * 1024 * 1024) fail(tr('msg.api.badImage'));
      const dir = markDir(who); fs.mkdirSync(dir, { recursive: true });
      const file = path.join(dir, `zona-${Date.now()}.png`); fs.writeFileSync(file, Buffer.from(m[1], 'base64'));
      return { path: file };
    },
    'images.save': ({ path: file, project: name, title }, who) => {
      const f = allowedImage(str(file, 'imagen', 1000), who);
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
    'chat.accept': ({ id }, who) => {
      const row = board.chatRow(int(id, 'mensaje'));
      if (row?.meta?.kind !== 'report') fail(tr('msg.api.notReport'));
      // 3.2.1: the OK to the report also settles the tasks of that request Orb held «for your review» (a read-only check
      // that changed build files, for instance), which the report already explained: before, they stayed blocked for ever.
      const held = row.conversation_id ? board.all("SELECT id FROM tasks WHERE conversation_id = ? AND status = 'blocked' AND updated_at <= ?", row.conversation_id, row.at)
        .map((r) => r.id).filter((tid) => board.one("SELECT 1 AS x FROM events WHERE task_id = ? AND kind = 'task.held' AND id > COALESCE((SELECT MAX(id) FROM events WHERE task_id = ? AND kind = 'task.launched'), 0)", tid, tid)) : [];
      for (const tid of held) board.patch(tid, { status: 'done' }, 'usuario', 'task.review_accepted');
      const out = accept([...row.meta.tasks, ...held], row.meta.project, who);
      // 3.2: the OK closes the conversation when nothing of it is still open (written in again, it opens).
      settleConversation(row.conversation_id);
      return out;
    },
    // The assistant's brain (2.6: any installed agent and model, with its reasoning and account). 3.2: of a conversation
    // (conversation given) and, always, the one new conversations start with; orchestrate: whether a new conversation is
    // with the assistant (on) or directly with the agent chosen (off: the user hands out the work).
    // 3.6: each person's own: the brain new conversations start with is saved for them (the owner's in Ajustes, as before),
    // and only an account they may spend is accepted.
    'chat.settings': ({ conversation, agent, model, reasoning, orchestrate, account: acc }, who) => {
      const other = personOf(who);
      const o = brainOf(board, other);
      const conv = conversation == null ? null : board.conversation(conversationId(conversation));
      const base = conv ? { agent: conv.agent, account: conv.account, model: conv.model, reasoning: conv.reasoning } : o;
      const patch = {};
      if (agent !== undefined) {
        if (!modelCatalog(board).some((a) => a.id === agent)) fail(tr('msg.api.agentUnavailable', { agent: String(agent).slice(0, 40) }));
        patch.agent = agent;
      }
      const brain = patch.agent ?? base.agent ?? 'claude';
      if (acc !== undefined) { patch.account = str(acc, 'cuenta', 40); if (patch.account && who?.channel !== 'system' && !mayUseAccount(board, who.person, patch.account, { purpose: 'orbe' })) fail(tr('msg.spend.notYours')); }
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
      // The choice is also the one the next new conversation starts with (3.6: of that person).
      if (other) {
        const { models, ...mine } = patch;
        if (models) saveConfig({ orchestrator: { models } }); // a model Claude Code offers joins the list for everyone
        board.personSetting(other, 'brain', { ...(board.personSetting(other, 'brain') ?? {}), ...mine });
        board.changed('settings', { person: other });
      } else { const c = saveConfig({ orchestrator: patch }); emit('config:changed', c); }
      const info = orchestrator.info(conv?.id ?? null, other);
      const level = { low: tr('msg.api.reasoningLow'), medium: tr('msg.api.reasoningMedium'), high: tr('msg.api.reasoningHigh') }[info.reasoning] ?? info.reasoning;
      if ((patch.model !== undefined && patch.model !== before.model) || (patch.agent && patch.agent !== (before.agent ?? 'claude')) || (patch.reasoning && patch.reasoning !== before.reasoning)) board.notice(tr('msg.api.assistantBrain', { name: assistantName(), agent: info.agentLabel, label: info.modelLabel, reasoning: level }), 'info', { person: other });
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
    'tasks.list': ({ limit }, who) => {
      const undone = new Set(board.all("SELECT key FROM settings WHERE key LIKE 'undone:%' AND value <> '' AND value <> 'null'").map((r) => Number(r.key.slice('undone:'.length))));
      return board.panelTasks(Math.min(Number(limit) || 150, 500), { principal: scopeOf(who) }).map(({ approval_hash, approval_sig, ...task }) => ({ ...task, description: cut(task.description), result: cut(task.result), ...(undone.has(task.id) ? { undone: true } : {}) }));
    },
    'tasks.live': (p, who) => scheduler.live().filter((t) => !scopeOf(who) || can(board, who, 'view', { type: 'task', id: t.id })),
    'tasks.get': ({ id }) => {
      const d = board.taskDetail(int(id, 'tarea'));
      const children = board.all('SELECT id, title, status, agent, assigned_to, model FROM tasks WHERE parent_id = ? OR review_of = ? ORDER BY id', d.id, d.id);
      // 3.2.1: «Deshecha» (undone: the files are as before the task), the model by its name («Haiku 4.5», not «haiku») and the
      // account that ran it by the name the user gave it («Codex Pro»).
      const who = d.assigned_to ?? d.agent; const acc = d.run_account ?? d.account ?? null;
      return { ...d, accepted: board.isAccepted(d.id), previewHash: board.previewHash(d), hasCheckpoint: Boolean(board.settingJson(`checkpoint:${d.id}`)?.before), review: board.settingJson(`review:${d.id}`), children,
        undone: board.settingJson(`undone:${d.id}`), modelLabel: d.model ? modelLabelOf(who, acc ?? who, d.model) : null, accountLabel: acc && accountsOf(who).length > 1 ? accountLabel(acc) : null };
    },
    'tasks.create': (p, who) => board.createTask({
      person: who?.channel === 'system' ? null : who?.person ?? null,
      project: project(p.project).name, title: str(p.title, 'título', 200), description: str(p.description, 'descripción', 12000),
      agent: oneOf(p.agent, [...AGENT_IDS, 'any'], 'agente', 'any'), model: str(p.model, 'modelo', 80, { optional: true }) || null,
      reasoning: oneOf(p.reasoning, ['low', 'medium', 'high'], 'razonamiento', 'medium'), mode: oneOf(p.mode, ['carpeta', 'aislada'], 'modo', 'carpeta'),
      readonly: Boolean(p.readonly), account: ownAccount(who, str(p.account, 'cuenta', 40, { optional: true }) || null), level: oneOf(p.level, ['simple', 'normal', 'complejo'], 'nivel', null), depends_on: Array.isArray(p.depends_on) ? p.depends_on.map((d) => int(d, 'dependencia')) : []
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
    'tasks.accept': ({ id }, who) => accept([int(id, 'tarea')], undefined, who),
    'tasks.discardBranch': ({ id }) => scheduler.discardBranch(int(id, 'tarea')),

    'sessions.list': ({ archived }, who) => sessions.list({ archived: Boolean(archived), principal: scopeOf(who) }),
    'sessions.create': (p, who) => {
      const proj = p.project ? project(p.project) : null;
      const cwd = proj ? proj.path : ctx.paths.projects;
      // Without a project the agent sits in the assistant's own folder (its database, secret and logs): it may only look.
      if (!proj && p.permission && p.permission !== 'leer') fail(tr('msg.api.readOnlyNoProject'));
      // 3.6: there it would see everyone's projects: someone other than the owner always picks a project.
      if (!proj && personOf(who)) fail(tr('msg.spend.needProject'));
      const created = sessions.create({ person: who?.channel === 'system' ? null : who?.person ?? null, kind: 'chat', agent: oneOf(p.agent, AGENT_IDS, 'agente'), account: ownAccount(who, str(p.account, 'cuenta', 40, { optional: true }) || null), model: str(p.model, 'modelo', 80, { optional: true }) || null,
        reasoning: oneOf(p.reasoning, ['low', 'medium', 'high'], 'razonamiento', 'medium'), permission: proj ? oneOf(p.permission, PERMISSIONS, 'permiso', 'editar') : 'leer',
        project: proj?.name ?? null, cwd, title: str(p.title, 'título', 80, { optional: true }) || tr('msg.api.chatWith', { agent: p.agent }) });
      // 3.2: a title given here stays; without one, Orb names it from its first message.
      return p.title ? sessions.update(created.id, { titled: true }) : created;
    },
    'sessions.items': ({ id, after, before, limit }) => sessions.items(str(id, 'conversación', 64), { after: Number(after) || 0, before: Number(before) || 0, limit: Number(limit) || 200 }),
    // A message to a conversation: a new turn, or (while it works) steer the running turn or wait in its queue.
    // mode: 'auto' (steer when the agent can, else queue), 'steer' or 'queue'.
    'sessions.send': ({ id, text, images: files, mode }, who) => {
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
      return sessions.message(s.id, t, { images: images(files), mode: oneOf(mode, ['auto', 'steer', 'queue'], 'modo', 'auto'), context: expandMentions(board, sessions, t, { principal: scopeOf(who) }) });
    },
    'sessions.queue': ({ id }) => sessions.queue(str(id, 'conversación', 64)),
    'sessions.editQueued': ({ id, queueId, text, remove, move }) => sessions.editQueued(str(id, 'conversación', 64), int(queueId, 'mensaje'), { text: text === undefined ? undefined : str(text, 'mensaje', 20000), remove: Boolean(remove), move: oneOf(move, ['up', 'down'], 'mover', undefined) }),
    'sessions.approve': ({ id, request, decision }) => sessions.respond(str(id, 'conversación', 64), str(request, 'petición', 200), oneOf(decision, DECISION, 'decisión')),
    'sessions.resume': ({ id }) => sessions.resume(str(id, 'conversación', 64)),
    'sessions.fork': ({ id, title }) => sessions.fork(str(id, 'conversación', 64), { title: str(title, 'título', 80, { optional: true }) || undefined }),
    'sessions.settle': ({ id, settled }) => sessions.update(sessions.must(str(id, 'conversación', 64)).id, { settled: settled !== false }),
    'approvals.list': (p, who) => visibleApprovals(who),
    'mentions.options': (p, who) => mentionOptions(board, sessions, { principal: scopeOf(who) }),
    'schedules.list': (p, who) => listSchedules(board, { principal: scopeOf(who) }).map((s) => ({ ...s, when: describeSchedule({ ...s, hours: s.at_time }) })),
    'schedules.create': (p, who) => createSchedule(board, { person: who?.channel === 'system' ? null : who?.person ?? null, project: project(p.project).name, title: str(p.title, 'título', 120), description: str(p.description, 'descripción', 8000), agent: oneOf(p.agent, [...AGENT_IDS, 'any'], 'agente', 'any'), model: str(p.model, 'modelo', 80, { optional: true }) || null,
      readonly: Boolean(p.readonly), every: oneOf(p.every, EVERY, 'frecuencia'), at_time: str(p.at_time, 'hora', 5, { optional: true }) || '09:00', weekdays: Array.isArray(p.weekdays) ? p.weekdays.map(Number) : [], hours: Number(p.hours) || 6 }, 'usuario'),
    'schedules.update': ({ id, enabled, approve, title, description }) => updateSchedule(board, int(id, 'programada'), { enabled, approved: approve === true, title, description }),
    'schedules.remove': ({ id }) => removeSchedule(board, int(id, 'programada')),
    'schedules.run': ({ id }) => runSchedule(board, getSchedule(board, int(id, 'programada')) ?? fail(tr('msg.api.noScheduled')), 'usuario'),
    'tasks.review': ({ id, agent, focus }, who) => scheduler.createReview(board.task(int(id, 'tarea')) ?? fail(tr('msg.api.noTaskThat')), { actor: 'usuario', agent: oneOf(agent, AGENT_IDS, 'agente', null), focus: str(focus, 'foco', 500, { optional: true }), person: personOf(who) }),
    'projects.review': ({ name, agent, focus }, who) => scheduler.reviewProject(project(name).name, { actor: 'usuario', agent: oneOf(agent, AGENT_IDS, 'agente', null), focus: str(focus, 'foco', 500, { optional: true }), person: personOf(who) }),
    'projects.securityReview': ({ name, agent }, who) => scheduler.securityReview(project(name).name, { actor: 'usuario', agent: oneOf(agent, AGENT_IDS, 'agente', null), person: personOf(who) }),
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

    // 3.6: each person's general log and the logs of the projects they see.
    'logs.list': (p, who) => logFiles(board, { person: scopeOf(who) ? who.person : null }).map(([name, file]) => { let size = 0; try { size = fs.statSync(file).size; } catch { /* empty */ } return { name, size }; }),
    'logs.read': ({ project: name, whole }, who) => readLog(board, str(name, 'bitácora', 200), { whole: Boolean(whole), chars: 40000, person: scopeOf(who) ? who.person : null }),

    // 3.6: the owner's own activity (never what the others do).
    'activity.list': ({ q, limit }, who) => {
      const mine = (r) => !scopeOf(who) || (r.person_id ?? board.ownerId()) === who.person;
      const rows = board.recentEvents(Math.min(Number(limit) || 300, 2000)).filter(mine);
      const needle = String(q ?? '').toLowerCase().trim();
      return (needle ? rows.filter((r) => `${r.actor} ${r.kind} ${r.detail} ${r.title ?? ''}`.toLowerCase().includes(needle)) : rows).map((r) => ({ ...r, detail: redactSecrets(r.detail) }));
    },
    // 3.2.1: only the accounts of the agents this PC can run (not every agent Orb knows).
    // 3.6: the accounts the caller may spend (their own and the ones lent to them, with what is left today).
    'usage.get': (p, who) => { const avail = board.availableAgents(); return usageReport(board, { person: scopeOf(who) ? who.person : null }).filter((u) => !avail || avail.includes(u.agent)); },
    // 3.6: for the owner, what each person spent (numbers only, never on what).
    'usage.byPerson': () => usageByPerson(board),
    // 2.6: the accounts working right now (the assistant's brain and the agents' running sessions), with the windows of
    // their plan the agents reported (session, weekly…), for the panel of the context ring.
    'usage.now': (p, who) => {
      // 3.2: the brain of the conversations answering now (or the one new conversations use). 3.6: the caller's.
      const me = scopeOf(who) ? who.person : null;
      const mineConv = (x) => !me || can(board, who, 'view', { type: 'conversation', id: x.conversation });
      const brain = orchestrator.info(null, personOf(who)); const answering = orchestrator.states().filter(mineConv).find((x) => x.busy);
      const brainAccount = answering ? board.conversation(answering.conversation)?.account ?? brain.account : brain.account;
      const ss = me ? scopeSql(who, 'session', 'sessions') : { where: '1=1', args: [] };
      const busy = board.all(`SELECT DISTINCT account, agent FROM sessions WHERE status = 'running' AND account IS NOT NULL AND ${ss.where}`, ...ss.args);
      const report = usageReport(board, { person: me });
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
    'control.pause': () => { board.setting('paused', '1'); board.changed('settings'); return true; },
    'control.resume': () => { board.setting('paused', '0'); board.changed('settings'); return true; },
    // ---- 3.6: sharing a project (and, with the same rules, a bot, a group or an integration): view, talk or edit.
    // Who may share: the resource's person; someone with «edit» may share it to view or talk. Never to oneself; an
    // integration (Home Assistant, the server) only the owner.
    'shares.list': ({ type, id }, who) => {
      const me = who?.person;
      if (type != null) {
        const res = { type: oneOf(type, SHARE_TYPES, 'tipo'), id: str(String(id ?? ''), 'id', 200) };
        if (who?.channel !== 'system' && !can(board, who, 'view', res)) throw new AuthzError('right', { method: 'shares.list', resource: res });
        const key = shareKey(res);
        const mine = who?.channel === 'system' || rank(rightOn(board, me, res)) >= rank('edit');
        return board.all('SELECT resource_type AS type, resource_id AS id, person_id AS person, right, granted_by, created_at FROM shares WHERE resource_type = ? AND resource_id = ?', res.type, key)
          .filter((s) => mine || s.person === me).map((s) => ({ ...s, name: board.personName(s.person) }));
      }
      // Everything shared with the caller, and everything they shared.
      const withMe = board.all('SELECT resource_type AS type, resource_id AS id, right, granted_by FROM shares WHERE person_id = ? ORDER BY resource_type, resource_id', me).map((s) => ({ ...s, by: board.personName(s.granted_by) }));
      const byMe = board.all('SELECT resource_type AS type, resource_id AS id, person_id AS person, right FROM shares WHERE granted_by = ? ORDER BY resource_type, resource_id', me).map((s) => ({ ...s, name: board.personName(s.person) }));
      return { withMe, byMe };
    },
    'shares.set': ({ type, id, person, right }, who) => {
      const res = { type: oneOf(type, SHARE_TYPES, 'tipo'), id: str(String(id ?? ''), 'id', 200) };
      const r = oneOf(right, RIGHTS, 'permiso');
      const to = str(person, 'persona', 40);
      mayShare(who, res, r, to, 'shares.set');
      const key = shareKey(res);
      board.run(`INSERT INTO shares (resource_type, resource_id, person_id, right, granted_by, created_at) VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(resource_type, resource_id, person_id) DO UPDATE SET right = excluded.right, granted_by = excluded.granted_by`, res.type, key, to, r, who?.person ?? board.ownerId(), new Date().toISOString());
      audit(board, who, 'shares.set', res, 'allow', `${to}:${r}`);
      board.changed('shares', { person: to, res });
      board.changed(res.type === 'project' ? 'projects' : res.type === 'bot' || res.type === 'group' ? 'bots' : 'settings', { person: to });
      return { type: res.type, id: key, person: to, right: r };
    },
    'shares.remove': ({ type, id, person }, who) => {
      const res = { type: oneOf(type, SHARE_TYPES, 'tipo'), id: str(String(id ?? ''), 'id', 200) };
      const to = str(person, 'persona', 40);
      const key = shareKey(res);
      const row = board.one('SELECT right FROM shares WHERE resource_type = ? AND resource_id = ? AND person_id = ?', res.type, key, to);
      // One may always give up what was shared with them; otherwise the same rule as sharing it.
      if (to !== who?.person) mayShare(who, res, row?.right ?? 'view', to, 'shares.remove');
      board.run('DELETE FROM shares WHERE resource_type = ? AND resource_id = ? AND person_id = ?', res.type, key, to);
      // What that person had open of it stops (their own conversations and tasks stay theirs).
      if (res.type === 'project') for (const s of board.all("SELECT id FROM sessions WHERE person_id = ? AND project = ? COLLATE NOCASE AND status = 'running'", to, key)) { try { sessions.stop(s.id); } catch { /* gone */ } }
      try { bots?.unshared?.(res, to); } catch (error) { log(`dejar de compartir: ${error.message}`); }
      audit(board, who, 'shares.remove', res, 'allow', to);
      board.changed('shares', { person: to, res });
      board.changed(res.type === 'project' ? 'projects' : res.type === 'bot' || res.type === 'group' ? 'bots' : 'settings', { person: to });
      return { ok: true };
    },
    ...accountMethods(shared),
    ...linkMethods(shared),
    ...personMethods(shared),
    ...data.methods
  };
  // 3.6: the approval cards a person may answer (of their own sessions and tasks, and those of projects shared with them).
  function visibleApprovals(who) {
    const list = sessions.allPendingApprovals();
    return scopeOf(who) ? list.filter((a) => can(board, who, 'talk', { type: 'session', id: a.session_id })) : list;
  }
  // 3.6: an account chosen on purpose must be one the caller may spend (theirs or lent to them for Orb mode).
  function ownAccount(who, id) {
    if (!id || !scopeOf(who) || mayUseAccount(board, who.person, id, { purpose: 'dev' })) return id;
    return fail(tr('msg.spend.notYours'));
  }
  // Sharing: the canonical id of a resource (a project's name as written, a bot's number) and who may share it.
  function shareKey(res) {
    if (res.type === 'project') return board.one('SELECT name FROM projects WHERE name = ? COLLATE NOCASE', res.id)?.name ?? res.id;
    if (res.type === 'bot') return String(board.one('SELECT id FROM bots WHERE id = ? OR name = ? COLLATE NOCASE', Number(res.id) || -1, res.id)?.id ?? res.id);
    return String(res.id);
  }
  function mayShare(who, res, right, to, method) {
    const deny = (reason) => { audit(board, who, method, res, 'deny', reason); throw new AuthzError(reason === 'notFound' ? 'notFound' : 'right', { method, resource: res }); };
    if (!board.one('SELECT id FROM persons WHERE id = ? AND deleted_at IS NULL', to)) fail(tr('msg.persons.noPerson'));
    if (ownerOf(board, res) == null) deny('notFound');
    if (who?.channel === 'system') return;
    if (res.type === 'integration' && who.role !== 'owner') deny('right');
    const mine = rightOn(board, who.person, res);
    if (!(mine === 'own' || (mine === 'edit' && right !== 'edit'))) deny('right');
    if (to === who?.person) fail(tr('msg.share.notYourself'));
    if (to === ownerOf(board, res)) fail(tr('msg.share.alreadyOwner'));
  }
  const centroCall = centroApi(shared);

  return {
    // 3.6: principal: who calls, built only by the entry points (engine.mjs for this PC's window, remote.mjs for a linked
    // device, the link for a forwarded call, dev-control). Without one, a call from inside the engine itself (system).
    async call(method, params, principal) {
      const who = principal ?? principalOf(board, { system: true });
      // 3.5: taller.<method> on a centre: its workshop (status, wake, queue, queued, or a call forwarded to it).
      if (typeof method === 'string' && method.startsWith('taller.')) {
        if (params === null || typeof params !== 'object' || Array.isArray(params)) fail(tr('msg.api.badParams'));
        authorize(board, who, method, params);
        try { return await remoteRef.current.taller(method.slice(7), params); } catch (error) { error.userFacing = true; throw error; }
      }
      // 3.5: centro.<method> on a workshop: the bots of the centre it is linked with (one Orb per user: its bots live there).
      if (typeof method === 'string' && method.startsWith('centro.')) {
        if (params === null || typeof params !== 'object' || Array.isArray(params)) fail(tr('msg.api.badParams'));
        authorize(board, who, method, params);
        return centroCall(method.slice(7), params, who);
      }
      const fn = Object.hasOwn(methods, method) ? methods[method] : null;
      if (!fn) fail(tr('msg.api.unknownAction', { method }));
      if (ctx.moved && !MOVED_OK.test(method)) fail(tr('data.move.movedAway'));
      if (isHeadless() && !centroAllows(method)) fail(tr('msg.api.centroOff'));
      if (params === null || typeof params !== 'object' || Array.isArray(params)) fail(tr('msg.api.badParams'));
      authorize(board, who, method, params);
      const out = await fn(params, who);
      // 3.1: an agent turned on or off, checked again, or an account added or removed: the list of available agents is
      // updated at once (the next task may already be for it).
      if (/^(config\.save|agents\.(status|check)|accounts\.(add|update|remove))$/.test(method)) { try { scheduler.refreshAvailable(true); } catch { /* next tick */ } }
      return shapeFor(who, method, out);
    },
    // 3.6: the method names (the policy test checks each one has its rule) and this PC's window's principal.
    methodNames: () => Object.keys(methods),
    desktopPrincipal,
    // New chat lines since the last call, sent to the window as 'chat:new' (corner robot, robot notices) or 'notice' (toasts).
    notifyNewChat() {
      try { optiApi.flush(); } catch { /* Opti Bot off or its conversation gone */ }
      const rows = board.all('SELECT id, role, body, meta, conversation_id, person_id FROM chat WHERE id > ? ORDER BY id LIMIT 20', lastChat);
      if (!rows.length) return;
      lastChat = rows[rows.length - 1].id;
      for (const r of rows) if (r.role === 'notice') { let m = null; try { m = JSON.parse(r.meta); } catch { /* plain */ } emit('notice', { body: oneLine(r.body, 300), tone: m?.tone ?? 'info', ...(m?.person ? { person: m.person } : {}) }); } // 2.7: a passing notification, not a chat line (3.6: with whom it is for)
      else if (r.conversation_id != null && bots?.owns(r.conversation_id)) continue;
      else if (r.role !== 'usuario') {
        let meta = null; try { meta = r.meta ? JSON.parse(r.meta) : null; } catch { /* plain */ }
        // 3.2: a plain line of no conversation (a task made by hand or by a schedule) passes by as a notification.
        if (r.role === 'system' && r.conversation_id == null && !meta?.kind) emit('notice', { body: oneLine(r.body, 300), tone: 'info', ...(r.person_id && !board.isOwnerPerson(r.person_id) ? { person: r.person_id } : {}) });
        else emit('chat:new', { role: r.role, body: oneLine(r.body, 240), meta, conversation: r.conversation_id ?? null, ...(r.conversation_id == null && r.person_id && !board.isOwnerPerson(r.person_id) ? { person: r.person_id } : {}) });
      }
    },
    // 3.6: the daily backup (03:00 in the owner's zone) and the persons' trash, looked at from the engine's loop.
    dataTick: () => data.tick(),
    // Running tasks stay "running": the next start continues them (scheduler.finish does not close them while closing).
    shutdown() { bots?.shutdown(); scheduler.closing = true; orchestrator.closing = true; sessions.stopAll(); orchestrator.stopAll(); orchestrator.closeLive(); log('motor detenido'); }
  };
}

