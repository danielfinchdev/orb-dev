// Every action the window can ask the engine for. Parameters are validated here (the window is trusted UI, but its
// inputs come from people and agents' text, so nothing is passed on unchecked). Actions marked as the user's ("usuario")
// are the only ones that sign approvals or publish.
// The dispatcher checks every call first (src/domain/security/permissions.mjs: this PC may call anything, a linked phone or browser
// only what is marked for it) and the methods live in several files: here the conversations, chat, tasks, sessions,
// projects, schedules, logs, whiteboard and usage; api-link.mjs, api-accounts.mjs, api-inbox.mjs and api-data.mjs the
// rest. Window actions by topic: projects.mjs (projects, Android), chat.mjs (conversations, chat, whiteboard), work.mjs (models, tasks, sessions, schedules).
import fs from 'node:fs';
import path from 'node:path';
import { ctx, tr } from '../../platform/context.mjs';
import { saveConfig } from '../../platform/config.mjs';
import { AGENT_IDS } from '../../platform/config-file.mjs';
import { CATEGORIES } from '../../platform/paths.mjs';
import { accountsOf, accountDir } from '../../domain/usage/accounts.mjs';
import { usageReport, usageHistory, modelName } from '../../domain/usage/budget.mjs';
import { syncProjects } from '../../domain/projects/projects.mjs';
import { PRODUCT } from '../../shared/product.mjs';
import { oneLine } from '../../shared/text.mjs';
import { redactSecrets } from '../../shared/secrets-scan.mjs';
import { quickRun } from '../../agents/index.mjs';
import { AUTONOMY } from '../../domain/security/guard.mjs';
import { readLog, writeLog, logFiles } from '../../domain/journal/journal.mjs';
import { ofUserLabel, userLabel, userName } from '../../domain/tasks/board.mjs';
import { createAndroid } from '../host/android.mjs';
import { grantMethods } from '../security/grants.mjs';
import { agentAuth } from '../../domain/security/agent-auth.mjs';
import { createSecretRequests } from '../security/agent-secrets.mjs';
import { createPrTools } from '../host/pr-tools.mjs';
import { createCiWatch } from '../scheduler/ci-watch.mjs';
import { createHtmlPages } from '../host/html-pages.mjs';
import { createTerminals } from '../host/user-terminal.mjs';
import { extensionMethods } from './extensions.mjs';
import { rulesMethods } from './rules.mjs';
import { layoutPlan, layoutApply, guardOutside } from '../workspace-layout.mjs';
import { modelCatalog, chooseModel, LEVELS } from '../usage/catalog.mjs';
import { git } from '../../platform/git.mjs';
import { authorize, PermissionError } from '../../domain/security/permissions.mjs';
import { fld, fail, str, int, oneOf, images, lazy } from './common.mjs';
import { linkMethods } from './link.mjs';
import { accountMethods } from './accounts.mjs';
import { dataApi } from './data.mjs';
import { inboxMethods } from './inbox.mjs';
import { keysMethods } from './keys.mjs';
import { mcpExtMethods } from './mcp-ext.mjs';
import { masterMethods, checkUnlock } from './master.mjs';
import { appMethods } from './app.mjs';
import { musicMethods } from '../host/music.mjs';
import { sealConnectors } from '../../domain/security/connector-secrets.mjs';
import { createFeeds } from '../feeds.mjs';
import { fold } from '../../domain/conversations/inbox.mjs';
import { projectMethods } from './projects.mjs';
import { chatMethods } from './chat.mjs';
import { trashTools } from './trash.mjs';
import { workMethods } from './work.mjs';
import { readActivity, buildReport, hidePcPaths } from '../../domain/activity/activity.mjs';
import { snapshotBefore, recordUserCall } from '../../domain/activity/record.mjs';

export { fail, str, int, oneOf } from './common.mjs';

// what only some calls need is loaded the first time one of them comes (the engine's start does not wait for it).
// A failed load is not kept (a file locked for a moment): the next call tries again.
const inst = lazy(() => import('../host/installer.mjs'));
const exp = lazy(() => import('../host/expert.mjs'));
const boards = lazy(() => import('../whiteboard.mjs'));
const prRef = ({ id, session, number, headRefOid }) => ({
  id: int(id, 'petición'), session: str(session, 'conversación', 200), number: int(number, 'pull request'),
  headRefOid: headRefOid == null ? null : str(headRefOid, 'commit', 64)
});

const htmlRef = ({ id, session }) => ({ id: str(id, 'página', 64), session: str(session, 'conversación', 200) });

export function buildApi({ board, sessions, orchestrator, scheduler, emit: emitRaw, log, version, remoteRef = { current: null }, onUnlocked = () => {}, onLocked = () => {} }) {
  // A deleted or trashed chat takes the HTML pages it showed with it (htmlPages is declared below; it exists by the first event).
  const emit = (event, payload) => { emitRaw(event, payload); if (event === 'session:removed' && payload?.id != null) htmlPages.dropSession(payload.id); };
  if (sessions.emit === emitRaw) sessions.emit = emit; // sessions.remove() emits through the engine's own emit
  const realHome = (() => { try { return fs.realpathSync(ctx.home); } catch { return ctx.home; } })();
  let catalogCache = null; // models.catalog, for a few seconds (see there)
  const insideHome = (p) => { const rel = path.relative(realHome, p); return Boolean(rel) && !rel.startsWith('..') && !path.isAbsolute(rel); };
  const project = (name) => board.project(str(name, 'proyecto', 200)) ?? fail(tr('msg.api.noProject', { name }));
  // Runs `work` with the project held (no task starts in it meanwhile); a project already held is refused.
  const holding = async (name, work) => {
    if (scheduler.held(name)) throw new Error(tr('msg.scheduler.projectBusy'));
    const release = scheduler.hold(name);
    try { return await work(); } finally { release(); }
  };
  let lastChat = board.one('SELECT MAX(id) AS id FROM chat')?.id ?? 0;
  const conversationId = (id) => { const c = board.conversation(int(id, 'conversación')); if (!c) fail(tr('msg.board.noConversation')); return c.id; };
  let whiteboardOf = null; const wb = async () => (whiteboardOf ??= (await boards()).whiteboard(board));
  // a picture the window may show: an image file inside Orb's folder, a project, or an agent account's own folder
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

  // a task the user rejects says so in its conversation, and the assistant hears it (otherwise it would keep saying the
  // task was waiting for approval). If other tasks of the request already finished, their report comes with it.
  const taskRejected = (task) => {
    const conv = board.conversationOfTask(task.id);
    const line = tr('msg.api.taskRejected', { id: task.id, title: oneLine(task.title, 120) });
    if (!conv || task.created_by !== 'orb' || !orchestrator) { board.addChat('system', line, { task: task.id }, conv ?? null); return; }
    if ((board.settingJson(`report_queue:c${conv}`) ?? []).length) { board.addChat('system', line, { task: task.id }, conv); scheduler?.queueReport?.(task); return; }
    orchestrator.internal(`AVISO DEL SISTEMA (no es ${userName()}): ${userName()} ha rechazado la tarea #${task.id} «${oneLine(task.title)}». No se hará y no se ha tocado ningún archivo. No la vuelvas a crear salvo que te lo pida. Díselo en una línea y sigue con el resto del pedido, si lo hay.`, line, null, { conversation: conv, project: task.project });
  };
  // a model by the name the selector shows (its agent's list, or the account's own), else the agent's own name for it.
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
  // the conversations for the sidebar, with how their tasks go, whether the assistant is answering in them now and
  // whether a question of its waits for the user (three queries for all of them, not three each).
  const conversationList = () => {
    const counts = {};
    for (const r of board.all('SELECT conversation_id AS c, status, COUNT(*) AS n FROM tasks WHERE conversation_id IS NOT NULL GROUP BY conversation_id, status')) (counts[r.c] ??= {})[r.status] = r.n;
    const asking = new Set(board.all(`SELECT DISTINCT conversation_id AS c FROM chat WHERE conversation_id IS NOT NULL AND meta LIKE '%"kind":"question"%' AND meta LIKE '%"status":"pending"%'`).map((r) => r.c));
    const live = new Map(orchestrator.states().map((x) => [x.conversation, x]));
    return board.conversations().map((c) => ({ id: c.id, title: c.title, project: c.project, agent: c.agent, account: c.account, model: c.model, reasoning: c.reasoning, status: c.status,
      created_at: c.created_at, updated_at: c.updated_at, done_at: c.done_at, context: c.context ?? null, tasks: counts[c.id] ?? {}, busy: Boolean(live.get(c.id)?.busy), waiting: Boolean(live.get(c.id)?.waiting), asking: asking.has(c.id) }));
  };
  // a conversation is done when the user gave the OK to its work and none of its tasks is still open.
  const settleConversation = (id) => { if (id && board.conversation(id)?.status === 'open' && !board.openTasksOf(id) && !orchestrator.state(id).busy) board.setConversationDone(id, true); };

  // The user's OK closes the loop: tasks marked accepted, a line in the chat and an entry in the project's log.
  const accept = (ids, project) => {
    // an undone task has no result left to accept.
    const done = board.accept(ids.filter((id) => !board.settingJson(`undone:${id}`)), 'usuario');
    if (!done.length) fail(tr('msg.api.noDoneTasks'));
    const name = userLabel();
    board.notice(tr(done.length > 1 ? 'msg.api.okMany' : 'msg.api.okOne', { who: ofUserLabel(), ids: done.map((t) => `#${t.id}`).join(', ') }), 'success');
    // signed as Orb with whose OK it is (not «Orbe (app)»), and the general log gets each cycle too (not only the
    // assistant's first entry of the day).
    const entry = { tema: tr('sys.logs.okTopic', { ids: done.map((t) => `#${t.id}`).join(', ') }), pedido: tr('sys.logs.okRequest'), hecho: tr('sys.logs.okDone', { user: name, list: done.map((t) => `#${t.id} ${oneLine(t.title, 80)}`).join('; ') }), estado: tr('sys.logs.okStatus') };
    const author = `${PRODUCT.name} (${tr('sys.logs.okBy', { user: name })})`;
    const where = project ?? done[0].project;
    try { writeLog(board, where, entry, author); } catch (error) { log(`bitácora del OK: ${error.message}`); }
    try { writeLog(board, 'general', { ...entry, tema: tr('sys.logs.okGeneralTopic', { project: where, ids: done.map((t) => `#${t.id}`).join(', ') }) }, author); } catch (error) { log(`bitácora general del OK: ${error.message}`); }
    return done.map((t) => t.id);
  };
  // a coordinator in the middle of a turn in a conversation of the project (it could create a task right after).
  const coordinatorBusy = (name) => board.all('SELECT id FROM conversations WHERE project = ?', name).some((c) => orchestrator?.state(c.id)?.busy);
  // What the other parts of the API share.
  const shared = { board, sessions, orchestrator, scheduler, emit, log, version, remoteRef, project, conversationId };
  // the phone the agents test apps on, and what the master password gives a chat (grants.mjs).
  const android = createAndroid({ board, log });
  const grants = grantMethods({ board, sessions, log, android });
  // The phone's tools of Orb's MCP server (src/mcp/server.mjs): for the conversation of the server's grant, as it is now.
  // the secrets an agent asks for (agent-secrets.mjs), answered only on this PC's card.
  const secrets = createSecretRequests({ sessions, auth: agentAuth, master: () => ctx.master, emit, log });
  // the pull-request tools of the agents (pr-tools.mjs); a merge is answered only on this PC's card.
  const prTools = createPrTools({ board, sessions, gh: () => import('../host/github.mjs'), holding, emit, log });
  // «Vigilar la CI del PR» (scheduler/ci-watch.mjs): the scheduler's tick calls it; it never merges.
  const ciWatch = createCiWatch({ board, sessions, gh: () => import('../host/github.mjs'), emit, log });
  if (scheduler) scheduler.ciWatch = ciWatch;
  // the HTML pages an agent shows in a chat (html-pages.mjs): sandboxed, internet off, switched on only on this PC.
  const htmlPages = createHtmlPages({ sessions, emit: emitRaw, log });
  agentAuth.onCall = async ({ session }, method, args) => {
    if (method === 'secret' && session) return secrets.request(sessions.get(session), args);
    if (method === 'html' && session) return htmlPages.show(sessions.get(session), args);
    if (method === 'pr' && session) return prTools.run(sessions.get(session), String(args.tool ?? ''), args.args);
    if (method !== 'android' || !session) throw Object.assign(new Error(tr('msg.android.notAllowed')), { userFacing: true });
    const s = sessions.get(session);
    return android.tool(s, String(args.tool ?? ''), args.args);
  };
  // the user's terminal docked under a chat (user-terminal.mjs); Ctrl+J's own terminal is app.openTerminal.
  const terminals = createTerminals({ emit, log });
  // the loopback MCP server for agents outside Orb (off by default: mcp-ext.mjs)
  const mcpExt = mcpExtMethods({ board, log, version, emit });
  mcpExt.startup();
  const data = dataApi(shared); // backups
  let usageAskedAt = 0; // usage.refresh

  const trash = trashTools({ board, sessions, orchestrator, scheduler, emit, log, conversationId });
  const hooks = { ...shared, trash, realHome, insideHome, holding, coordinatorBusy, syncSoon, cut, accept, allowedImage, withAccepted, settleConversation, taskRejected, modelLabelOf, wb, android, grants };
  const methods = {
    'app.state': () => ({
      version, home: ctx.home, paths: { core: ctx.paths.core, projects: ctx.paths.projects, logs: ctx.paths.logs, mcp: ctx.paths.mcp, categories: ctx.paths.categories }, categories: CATEGORIES,
      config: ctx.config, paused: board.setting('paused') === '1', activeProject: board.activeProject(),
      approvals: sessions.allPendingApprovals().map((a) => ({ id: a.id, session_id: a.session_id, body: { title: a.body?.title, reason: a.body?.reason }, session: a.session })),
      counts: Object.fromEntries(board.all('SELECT status, COUNT(*) AS n FROM tasks GROUP BY status').map((r) => [r.status, r.n])),
      // what each conversation with the assistant is doing now (only the ones answering or waiting their turn).
      chats: orchestrator.states(), assistant: orchestrator.info(null),
      // the tasks («t<id>») and direct conversations («s<id>») the user put away in «Completadas» of the sidebar;
      // kept, the finished tasks the user brought back (a finished task goes to «Completadas» by itself).
      completed: board.settingJson('sidebar_completed') ?? [], kept: board.settingJson('sidebar_kept') ?? [],
      // the agents this PC can run now (installed, on, with an account): the lists of the window offer only these.
      agentsAvailable: board.availableAgents()
    }),
    // the data-migration state (3.7 data updated, or never 3.7): engine.mjs answers these two itself while they could not be.
    'app.migrationState': () => ({ failed: false }),
    'app.migrationRetry': () => ({ failed: false }),
    // core is whole (engine.mjs › coreBlocked answers these two while it is not).
    'app.coreState': () => null,
    'app.coreRepair': () => ({ missing: false }),
    // the folders Orb 3.7 kept at the top of the workspace: what would happen to each, and the user's choice
    // (nothing moves before it; src/domain/workspace/core-folder.mjs).
    'app.layoutPlan': () => layoutPlan(),
    'app.layoutApply': ({ choices }) => layoutApply(choices, { emit, log, board }),
    'conversations.list': () => conversationList(),
    // completed by hand (or open again): a task («t<id>»), a direct conversation («s<id>») or a conversation with the
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
    'config.save': ({ patch, unlock }, _principal, { unlocked = false } = {}) => {
      // a connector's keys never reach orb.json: they go into the vault and orb.json keeps references. With the window
      // unlocked (a change that needs it: checkUnlock), the keys are tied to the connectors' commands as they are now.
      const p = patch ?? {};
      const sealed = Array.isArray(p.mcpServers) ? sealConnectors(ctx.master, p.mcpServers, { trusted: unlocked || Boolean(ctx.master?.checkToken(unlock)) }) : null;
      const c = saveConfig(sealed ? { ...p, mcpServers: sealed } : p); emit('config:changed', c);
      if (p.backup) guardOutside(); // the chosen backups' folder, kept from the agents
      return c;
    },

    // Git is needed for undo with history, isolated copies and GitHub: the Agents screen warns when it is missing.
    'installer.check': async () => (await inst()).check(),
    'installer.start': async ({ ids }) => { if (!Array.isArray(ids) || ids.some((x) => typeof x !== 'string')) fail(tr('msg.api.badList')); return (await inst()).start(ids, emit); },
    'installer.progress': async () => (await inst()).progress(),
    'system.check': async () => { const r = await quickRun('git', ['--version'], { timeoutMs: 8000 }); return { platform: process.platform, git: r.ok ? r.out.replace(/^git version\s*/, '') : null }; },

    ...projectMethods(hooks),

    ...chatMethods(hooks),
    ...trash.methods,
    // the brains to choose from (agent + model), which ones spend the quota faster and how used each account is.
    // Kept for a few seconds: the window asks again on every change of the board (while the agents work, many a second).
    // the guide of Ajustes › Tareas y usos: each agent's models by kind (light, balanced, most capable) and what Orb
    // would choose for a simple, normal and complex task with the current slider.
    'models.guide': () => modelCatalog(board).map((a) => ({
      id: a.id, label: a.label,
      tiers: Object.fromEntries(['light', 'balanced', 'heavy'].map((tier) => [tier, a.models.filter((m) => m.id && m.tier === tier).map((m) => m.label)])),
      picks: Object.fromEntries(LEVELS.map((level) => { const p = chooseModel(board, a.id, level, a.accounts[0]?.id ?? a.id, { writes: true }); return [level, { label: p.label, tier: p.tier, reasoning: p.reasoning }]; })),
      // what the read-only tasks (reviews and verifications) really get: they may use the light model.
      readPicks: Object.fromEntries(LEVELS.map((level) => { const p = chooseModel(board, a.id, level, a.accounts[0]?.id ?? a.id, { writes: false }); return [level, { label: p.label, tier: p.tier, reasoning: p.reasoning }]; }))
    })),
    'models.catalog': () => {
      // with the accounts' real usage in the key: the usage bubble reads it from here and must not see an old figure.
      const rates = board.all("SELECT key, value FROM settings WHERE key LIKE 'rate:%'").map((r) => `${r.key}=${r.value.length}:${r.value.slice(0, 40)}`);
      const key = JSON.stringify([ctx.config.orchestrator, ctx.config.agentOrder, Object.keys(ctx.config.agents).map((a) => ctx.config.agents[a]?.enabled), board.setting('models_rev'), rates]);
      if (catalogCache && catalogCache.key === key && Date.now() - catalogCache.at < 5000) return catalogCache.value;
      const value = modelCatalog(board, { discover: true, log });
      catalogCache = { key, at: Date.now(), value };
      return value;
    },
    ...workMethods(hooks),
    // the agents' level for everything that has none of its own (new chats, the tasks the assistant creates):
    // «Auto» or «Preguntar». Also from a linked phone (only these two values; «Acceso total» never comes this way).
    'permissions.setMode': ({ mode }) => { const m = oneOf(mode, AUTONOMY, 'modo'); const c = saveConfig({ permissions: { mode: m } }); emit('config:changed', c); return { mode: m }; },

    // The phone read its notices: the PC's bell is a window thing (local storage), so the window is told. The phone's ids are
    // its own, not the bell's, so everything in the bell counts as seen.
    'notes.markRead': ({ ids } = {}) => {
      if (ids != null && (!Array.isArray(ids) || ids.length > 200 || ids.some((x) => typeof x !== 'string' || x.length > 100))) fail(tr('msg.api.badList'));
      emit('notes:read', { ...(ids ? { ids } : {}), at: Date.now() });
      return { ok: true };
    },
    'logs.list': () => logFiles(board).map(([name, file]) => { let size = 0; try { size = fs.statSync(file).size; } catch { /* empty */ } return { name, size }; }),
    'logs.read': ({ project: name, whole }) => readLog(board, str(name, 'bitácora', 200), { whole: Boolean(whole), chars: 40000 }),

    // Only q/limit: the events array the window has always had. Any other filter: the paged reader of every source
    // ({ items, next }, src/domain/activity/activity.mjs).
    'activity.list': (params, principal) => {
      const { q, limit } = params;
      if (['sources', 'level', 'project', 'from', 'to', 'cursor'].some((k) => params[k] !== undefined)) {
        const page = readActivity(board, params);
        // the phone gets places, not this PC's folders (the same swap as in the report)
        if (principal?.channel === 'desktop') return page;
        const hide = (v) => (typeof v === 'string' ? hidePcPaths(v) : v);
        return { ...page, items: page.items.map((it) => ({ ...it, text: hide(it.text), ...(it.before !== undefined ? { before: hide(it.before) } : {}), ...(it.after !== undefined ? { after: hide(it.after) } : {}) })) };
      }
      const rows = board.recentEvents(Math.min(Number(limit) || 300, 2000));
      const needle = String(q ?? '').toLowerCase().trim();
      return (needle ? rows.filter((r) => `${r.actor} ${r.kind} ${r.detail} ${r.title ?? ''}`.toLowerCase().includes(needle)) : rows).map((r) => ({ ...r, detail: redactSecrets(r.detail) }));
    },
    'activity.report': ({ at, lines }, principal) => buildReport(board, { at, lines, version, remote: principal?.channel !== 'desktop' }),
    // only the accounts of the agents this PC can run (not every agent Orb knows).
    'usage.get': () => { const avail = board.availableAgents(); return usageReport(board).filter((u) => !avail || avail.includes(u.agent)); },
    // the usage page: what was spent in the last 7, 30 or 90 days, by day, agent and model (names as the selector
    // shows them).
    'usage.history': ({ days }) => {
      const out = usageHistory(board, { days: oneOf(days, [7, 30, 90], 'días', 30) });
      return { ...out, models: out.models.map(({ account, ...m }) => ({ ...m, label: m.model ? modelLabelOf(m.agent, account ?? m.agent, m.model) : null })) };
    },
    // the accounts working right now (the assistant's brain and the agents' running sessions), with the windows of
    // their plan the agents reported (session, weekly…), for the panel of the context ring.
    // «Recargar» in the usage panel: the open agents ask their plan now (at most every 20 s), then usage.now.
    'usage.refresh': async () => {
      if (Date.now() - usageAskedAt >= 20_000) {
        usageAskedAt = Date.now();
        const asks = [...sessions.refreshUsage(), ...orchestrator.refreshUsage()];
        await Promise.race([Promise.allSettled(asks), new Promise((r) => { setTimeout(r, 10_000).unref?.(); })]);
      }
      return methods['usage.now']();
    },
    'usage.now': () => {
      // the brain of the conversations answering now (or the one new conversations use).
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
    ...keysMethods(shared),
    ...mcpExt.methods,
    ...data.methods,
    // Orb locked (or a new password): the grants go, and so do the secrets typed for the agents.
    // under the lock screen the user's terminals take nothing and show nothing (user-terminal.mjs).
    ...masterMethods({ ...shared, onUnlocked, onLock: (why) => { secrets.wipe(); prTools.wipe(); htmlPages.wipe(); try { onLocked(); } catch (error) { log(`bloqueo: ${error.message}`); } return grants.revokeAll(why); }, onScreen: (v) => terminals.setLocked(v) }),
    // the private card of a secret an agent asked for (this PC only; saving or using a saved one asks for
    // the master password: permissions.mjs › needsUnlock).
    'secrets.pending': () => secrets.pending(),
    'secrets.answer': ({ id, value, save, saved }) => secrets.answer({ id: int(id, 'petición'), value, save: save === true, saved: saved === true }),
    'secrets.decline': ({ id }) => secrets.decline({ id: int(id, 'petición') }),
    // a merge an agent asked for: shown and answered only on this PC's card.
    'projects.prFix': ({ session, number, kind }) => prTools.fix(str(session, 'conversación', 64), number, kind),
    'ciWatch.list': () => ciWatch.list(),
    'ciWatch.set': ({ session, number, on }) => ciWatch.set(str(session, 'conversación', 64), number, on === true),
    'prConfirm.pending': () => prTools.pending(),
    // the answer names the request by id, chat, PR number and head commit, so a stale card cannot answer another one
    'prConfirm.answer': (a) => prTools.answer(prRef(a)),
    'prConfirm.decline': (a) => prTools.decline(prRef(a)),
    // the HTML pages of the chats: listed, closed and given internet only from this PC's window.
    'htmlPages.list': () => htmlPages.list(),
    'htmlPages.setInternet': (a) => { if (typeof a?.internet !== 'boolean') fail('internet: true o false'); return htmlPages.setInternet(htmlRef(a), a.internet); },
    'htmlPages.get': (a) => htmlPages.get(htmlRef(a)),
    'htmlPages.close': (a) => htmlPages.close(htmlRef(a)),
    // the user's terminal inside Orb (this PC only, never in core or a protected folder).
    'terminal.list': () => terminals.list(),
    'terminal.open': ({ dir }) => terminals.open({ dir: str(dir, 'carpeta', 1000) }),
    'terminal.write': ({ id, text }) => terminals.write({ id: int(id, 'terminal'), text: typeof text === 'string' ? text : '' }),
    'terminal.close': ({ id }) => terminals.close({ id: int(id, 'terminal') }),
    ...extensionMethods(shared),
    ...rulesMethods(shared), // the text rules and the rails (core/normas, orb.json rails)
    ...appMethods({ home: ctx.home, version }), // this PC's tools (terminal, editors, feedback…)
    ...musicMethods({ log }) // the music's tracks, downloaded the first time (src/engine/host/music.mjs)
  };
  const feeds = createFeeds();
  return {
    // principal: who calls, built only by the entry points (engine.mjs and dev-control.mjs: this PC; remote.mjs: a
    // linked device). A call without one is refused (never this PC by default).
    async call(method, params, principal) {
      if (!principal) throw new PermissionError(method);
      // A linked device is refused before the method is looked up: the error must not tell it which methods exist.
      if (principal.channel !== 'desktop') authorize(principal, method);
      const fn = Object.hasOwn(methods, method) ? methods[method] : null;
      if (!fn) fail(tr('msg.api.unknownAction', { method }));
      if (params === null || typeof params !== 'object' || Array.isArray(params)) fail(tr('msg.api.badParams'));
      authorize(principal, method);
      // and, for what the master password guards, a fresh unlock of this PC's window (src/engine/api/master.mjs).
      // a one-use token (rails) is spent here, so the handler is told the unlock was good instead of checking it again.
      const gate = checkUnlock(method, params, { defer: true });
      const unlocked = gate.unlocked;
      let out; let snap;
      try {
        trash.guard(method, params);
        snap = snapshotBefore(method);
        out = await fn(params, principal, { unlocked });
      } catch (error) { gate.settle(false); throw error; }
      gate.settle(true); // the action ran: only now is a one-use token spent
      recordUserCall({ board, method, params, out, principal, snap });
      // the lists of every refresh, as changes since what the caller holds (src/engine/feeds.mjs).
      if (params.since !== undefined) out = feeds.reply(method, params, out, principal);
      // an agent turned on or off, checked again, or an account added or removed: the list of available agents is
      // updated at once (the next task may already be for it).
      if (/^(config\.save|agents\.(status|check)|accounts\.(add|update|remove))$/.test(method)) { try { scheduler.refreshAvailable(true); } catch { /* next tick */ } }
      return out;
    },
    // The method names (test/permisos.test.mjs checks each one has its line in src/domain/security/permissions.mjs).
    methodNames: () => Object.keys(methods),
    // New chat lines since the last call, sent to the window as 'chat:new' (corner robot, robot notices) or 'notice' (toasts).
    notifyNewChat() {
      const rows = board.all('SELECT id, role, body, meta, conversation_id FROM chat WHERE id > ? ORDER BY id LIMIT 20', lastChat);
      if (!rows.length) return;
      lastChat = rows[rows.length - 1].id;
      for (const r of rows) if (r.role === 'notice') { let m = null; try { m = JSON.parse(r.meta); } catch { /* plain */ } emit('notice', { body: oneLine(r.body, 300), tone: m?.tone ?? 'info' }); } // a passing notification, not a chat line
      else if (r.role !== 'usuario') {
        let meta = null; try { meta = r.meta ? JSON.parse(r.meta) : null; } catch { /* plain */ }
        // a plain line of no conversation (a task made by hand or by a schedule) passes by as a notification.
        if (r.role === 'system' && r.conversation_id == null && !meta?.kind) emit('notice', { body: oneLine(r.body, 300), tone: 'info' });
        else emit('chat:new', { role: r.role, body: oneLine(r.body, 240), meta, conversation: r.conversation_id ?? null });
      }
    },
    // the daily backup (03:00 in the owner's zone), looked at from the engine's loop.
    dataTick: () => { data.tick(); trash.purgeIfDue(); },
    purgeTrash: (nowMs) => trash.purge(nowMs),
    // Running tasks stay "running": the next start continues them (scheduler.finish does not close them while closing).
    // adb's server goes with Orb (no phone reachable from this PC while Orb is closed).
    // Returns what is still to be waited for: a task being closed or a copy being joined finishes writing its state first.
    shutdown() { terminals.closeAll(); scheduler.closing = true; orchestrator.closing = true; sessions.stopAll(); orchestrator.stopAll(); orchestrator.closeLive(); android.stopServer().catch(() => {}); log('motor detenido'); return scheduler.drain().catch(() => {}); }
  };
}

