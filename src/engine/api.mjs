// Every action the window can ask the engine for. Parameters are validated here (the window is trusted UI, but its
// inputs come from people and agents' text, so nothing is passed on unchecked). Actions marked as the user's ("usuario")
// are the only ones that sign approvals or publish.
import fs from 'node:fs';
import path from 'node:path';
import { ctx, saveConfig, checkAccountHome } from '../core/context.mjs';
import { AGENT_IDS } from '../core/home.mjs';
import { MULTI, newAccountId } from '../core/accounts.mjs';
import { usageReport } from '../core/budget.mjs';
import { createProject, syncProjects } from '../core/projects.mjs';
import { oneLine, redactSecrets } from '../core/safety.mjs';
import { statusAll, status as agentStatus, openLogin, quickRun, forgetInstalled } from '../agents/index.mjs';
import { PERMISSIONS } from './sessions.mjs';
import { readLog, writeLog, logFiles } from './logs.mjs';
import { ofUser, userName } from '../core/board.mjs';
import * as github from './github.mjs';
import * as installer from './installer.mjs';
import * as expert from './expert.mjs';

const fail = (message) => { const e = new Error(message); e.userFacing = true; throw e; };
const str = (v, name, max = 2000, { optional = false } = {}) => {
  if (v == null || v === '') { if (optional) return ''; fail(`falta ${name}`); }
  if (typeof v !== 'string') fail(`${name} no válido`);
  if (v.length > max) fail(`${name} demasiado largo (máximo ${max})`);
  return v;
};
const int = (v, name) => { const n = Number(v); if (!Number.isInteger(n) || n < 1) fail(`${name} no válido`); return n; };
const oneOf = (v, list, name, fallback) => { if (v == null || v === '') return fallback; if (!list.includes(v)) fail(`${name} no válido`); return v; };
const DECISION = ['allow', 'always', 'deny'];
const images = (list) => {
  if (list == null) return [];
  if (!Array.isArray(list) || list.length > 10 || list.some((f) => typeof f !== 'string' || !path.isAbsolute(f))) fail('adjuntos no válidos');
  return list;
};

export function buildApi({ board, sessions, orchestrator, scheduler, emit, log, version, remoteRef = { current: null } }) {
  const realHome = (() => { try { return fs.realpathSync(ctx.home); } catch { return ctx.home; } })();
  const insideHome = (p) => { const rel = path.relative(realHome, p); return Boolean(rel) && !rel.startsWith('..') && !path.isAbsolute(rel); };
  const project = (name) => board.project(str(name, 'proyecto', 200)) ?? fail(`no existe el proyecto ${name}`);
  let lastChat = board.one('SELECT MAX(id) AS id FROM chat')?.id ?? 0;

  // The current conversation with the assistant (since the last "Nueva conversación"), at most 120 messages.
  const currentChat = () => {
    const all = board.chat(300);
    let start = 0;
    all.forEach((m, i) => { if (m.role === 'system' && /^Nueva conversaci/.test(m.body)) start = i; });
    return all.slice(start).slice(-120).map((m) => (m.meta?.kind === 'report' ? { ...m, meta: { ...m.meta, accepted: m.meta.tasks.length > 0 && m.meta.tasks.every((id) => board.isAccepted(id)) } } : m));
  };

  // The user's OK closes the loop: tasks marked accepted, a line in the chat and an entry in the project's log.
  const accept = (ids, project) => {
    const done = board.accept(ids, 'usuario');
    if (!done.length) fail('no hay tareas hechas pendientes de tu OK');
    board.addChat('system', `👍 OK ${ofUser()}: ${done.map((t) => `#${t.id}`).join(', ')} aceptada${done.length > 1 ? 's' : ''}.`);
    try { writeLog(board, project ?? done[0].project, { tema: `OK a ${done.map((t) => `#${t.id}`).join(', ')}`, pedido: 'revisar el trabajo terminado', hecho: `${userName()} dio el OK a: ${done.map((t) => `#${t.id} ${oneLine(t.title, 80)}`).join('; ')}`, estado: 'aceptado' }, `${ctx.config.assistantName} (app)`); } catch (error) { log(`bitácora del OK: ${error.message}`); }
    return done.map((t) => t.id);
  };

  const methods = {
    'app.state': () => ({
      version, home: ctx.home, paths: { projects: ctx.paths.projects, logs: ctx.paths.logs },
      config: ctx.config, paused: board.setting('paused') === '1', activeProject: board.activeProject(),
      counts: Object.fromEntries(board.all('SELECT status, COUNT(*) AS n FROM tasks GROUP BY status').map((r) => [r.status, r.n])),
      chat: orchestrator.state(), assistant: orchestrator.info()
    }),
    'config.save': ({ patch }) => { const c = saveConfig(patch ?? {}); emit('config:changed', c); return c; },

    'agents.status': ({ refresh }) => { if (refresh) forgetInstalled(); return statusAll({ refresh: Boolean(refresh) }); },
    'agents.check': ({ agent }) => agentStatus(oneOf(agent, AGENT_IDS, 'agente'), { refresh: true }),
    'agents.login': ({ account: id, agent }) => {
      const acc = str(id ?? agent, 'cuenta', 40);
      openLogin(acc);
      // A pause because it had no login is lifted: the user is signing in now.
      if (board.setting(`cooldown_reason:${acc}`) === 'no tiene la sesión iniciada') { board.setting(`cooldown:${acc}`, ''); board.setting(`cooldown_reason:${acc}`, ''); }
    },
    // ---- accounts: several subscriptions of the same agent
    'accounts.add': ({ agent, label, home }) => {
      agent = oneOf(agent, AGENT_IDS, 'agente');
      if (!MULTI[agent]) fail(`${agent} guarda su sesión en un sitio fijo: solo admite una cuenta`);
      const before = board.all("SELECT run_account AS a FROM tasks WHERE run_account IS NOT NULL UNION SELECT account FROM tasks WHERE account IS NOT NULL UNION SELECT account FROM sessions WHERE account IS NOT NULL").map((r) => r.a);
      const id = newAccountId(agent, before);
      // Without a folder chosen by the user, the account gets its own inside the assistant's folder.
      const dir = str(home, 'carpeta', 1000, { optional: true }) || path.join(ctx.paths.internal, 'cuentas', id);
      if (!path.isAbsolute(dir)) fail('la carpeta de la cuenta debe ser una ruta absoluta');
      try { checkAccountHome(dir, ctx.config, board.projects().map((p) => p.path)); } catch (error) { fail(error.message); }
      fs.mkdirSync(dir, { recursive: true });
      const c = saveConfig({ accounts: [...ctx.config.accounts, { id, agent, label: oneLine(str(label, 'nombre', 60), 60), home: dir, enabled: true }] });
      emit('config:changed', c);
      return c.accounts.find((a) => a.id === id);
    },
    'accounts.update': ({ id, label, enabled }) => {
      const acc = ctx.config.accounts.find((a) => a.id === str(id, 'cuenta', 40)) ?? fail('esa cuenta no existe');
      const next = ctx.config.accounts.map((a) => (a.id === acc.id ? { ...a, ...(label !== undefined ? { label: oneLine(str(label, 'nombre', 60), 60) } : {}), ...(enabled !== undefined ? { enabled: Boolean(enabled) } : {}) } : a));
      const c = saveConfig({ accounts: next }); emit('config:changed', c); return true;
    },
    'accounts.remove': ({ id }) => {
      const acc = ctx.config.accounts.find((a) => a.id === str(id, 'cuenta', 40)) ?? fail('esa cuenta no existe');
      if (acc.id === acc.agent) fail('la cuenta principal de cada agente no se quita (puedes desactivarla)');
      if (board.one("SELECT COUNT(*) AS n FROM tasks WHERE status = 'running' AND run_account = ?", acc.id).n) fail('esa cuenta tiene tareas en marcha');
      if (board.one("SELECT COUNT(*) AS n FROM sessions WHERE status = 'running' AND account = ?", acc.id).n) fail('esa cuenta tiene una conversación trabajando: detenla antes');
      if (ctx.config.orchestrator.account === acc.id) fail('el asistente usa esa cuenta: elige otra en Ajustes antes');
      // The folder (and its login) stays on disk: removing an account from the app never signs anyone out.
      const c = saveConfig({ accounts: ctx.config.accounts.filter((a) => a.id !== acc.id) }); emit('config:changed', c); return true;
    },
    // Git is needed for undo with history, isolated copies and GitHub: the Agents screen warns when it is missing.
    'installer.check': () => installer.check(),
    'installer.start': ({ ids }) => { if (!Array.isArray(ids) || ids.some((x) => typeof x !== 'string')) fail('lista no válida'); return installer.start(ids, emit); },
    'installer.progress': () => installer.progress(),
    'system.check': async () => { const r = await quickRun('git', ['--version'], { timeoutMs: 8000 }); return { platform: process.platform, git: r.ok ? r.out.replace(/^git version\s*/, '') : null }; },

    'projects.list': () => (syncProjects(board), board.projects()).map((p) => ({ ...p, inHome: insideHome(p.path), active: board.setting('active_project') === p.name, open: board.one("SELECT COUNT(*) AS n FROM tasks WHERE project = ? AND status IN ('queued', 'awaiting_approval', 'running')", p.name).n })),
    'projects.create': ({ name, notes }) => createProject(board, { name: str(name, 'nombre', 60), notes: str(notes, 'notas', 2000, { optional: true }) }, 'usuario'),
    'projects.import': ({ name, folder }) => board.addProject({ name: str(name, 'nombre', 60), path: str(folder, 'carpeta', 1000) }, 'usuario', { fromUser: true }),
    'projects.remove': ({ name }) => board.removeProject(project(name).name, 'usuario'),
    'projects.setActive': ({ name }) => board.setActiveProject(name ? project(name).name : '', 'usuario'),
    'projects.info': ({ name }) => github.projectInfo(project(name)),
    'projects.commit': ({ name, message }) => github.commitAll(project(name), str(message, 'mensaje', 200)),
    'projects.merge': ({ name, branch }) => github.mergeBranch(project(name), str(branch, 'rama', 120)),
    'projects.push': ({ name, branch }) => github.push(project(name), str(branch, 'rama', 120)),
    'projects.createPr': ({ name, branch, title, body, base }) => github.createPr(project(name), { branch: str(branch, 'rama', 120), title: str(title, 'título', 200), body: str(body, 'descripción', 20000, { optional: true }), base: str(base, 'rama base', 120, { optional: true }) || undefined }),
    'projects.createRepo': ({ name, repo, isPrivate }) => github.createRepo(project(name), { name: str(repo, 'repositorio', 100), isPrivate: isPrivate !== false }),
    'projects.clone': async ({ repo, name }) => {
      const folder = await github.clone(str(repo, 'repositorio', 300), str(name, 'nombre', 60, { optional: true }));
      return board.addProject({ name: oneLine(name || path.basename(folder), 60), path: folder }, 'usuario', { fromUser: true });
    },

    'github.status': () => github.status(),
    'github.login': () => github.login(),

    'chat.list': () => currentChat(),
    'chat.send': ({ text }) => orchestrator.ask(str(text, 'mensaje', 20000)),
    'chat.reset': () => orchestrator.reset(),
    'chat.stop': () => orchestrator.stop(),
    'chat.accept': ({ id }) => {
      const row = board.chat(500).find((m) => m.id === int(id, 'mensaje'));
      if (row?.meta?.kind !== 'report') fail('ese mensaje no es un informe');
      return accept(row.meta.tasks, row.meta.project);
    },
    // The assistant's model (Sonnet / Opus) and mode ("Orquestador" ticked = only coordinate; unticked = free mode).
    'chat.settings': ({ model, orchestrate, account: acc }) => {
      const o = ctx.config.orchestrator;
      const patch = {};
      if (acc !== undefined) patch.account = str(acc, 'cuenta', 40);
      if (model !== undefined) { if (!o.models.some((m) => m.id === model)) fail('modelo no disponible para el asistente'); patch.model = model; }
      if (orchestrate !== undefined) patch.orchestrate = Boolean(orchestrate);
      const before = { ...o };
      const c = saveConfig({ orchestrator: patch });
      emit('config:changed', c);
      const label = (id) => c.orchestrator.models.find((m) => m.id === id)?.label ?? id;
      if (patch.model && patch.model !== before.model) board.addChat('system', `🧠 Modelo del asistente: ${label(patch.model)} (razonamiento ${c.orchestrator.reasoning === 'medium' ? 'medio' : c.orchestrator.reasoning}).`);
      if (patch.orchestrate !== undefined && patch.orchestrate !== before.orchestrate) board.addChat('system', patch.orchestrate ? '🧭 Modo orquestador: solo coordina y reparte encargos entre los agentes.' : '🛠️ Modo libre: el asistente puede leer, ejecutar y editar directamente en la carpeta del proyecto (sin push ni publicar).');
      return orchestrator.info();
    },

    'tasks.list': ({ limit }) => board.panelTasks(Math.min(Number(limit) || 150, 500)),
    'tasks.live': () => scheduler.live(),
    'tasks.get': ({ id }) => {
      const d = board.taskDetail(int(id, 'tarea'));
      const children = board.all('SELECT id, title, status, agent, assigned_to, model FROM tasks WHERE parent_id = ? OR review_of = ? ORDER BY id', d.id, d.id);
      return { ...d, accepted: board.isAccepted(d.id), previewHash: board.previewHash(d), hasCheckpoint: Boolean(board.settingJson(`checkpoint:${d.id}`)?.before), review: board.settingJson(`review:${d.id}`), children };
    },
    'tasks.create': (p) => board.createTask({
      project: project(p.project).name, title: str(p.title, 'título', 200), description: str(p.description, 'descripción', 12000),
      agent: oneOf(p.agent, [...AGENT_IDS, 'any'], 'agente', 'any'), model: str(p.model, 'modelo', 80, { optional: true }) || null,
      reasoning: oneOf(p.reasoning, ['low', 'medium', 'high'], 'razonamiento', 'medium'), mode: oneOf(p.mode, ['carpeta', 'aislada'], 'modo', 'carpeta'),
      readonly: Boolean(p.readonly), account: str(p.account, 'cuenta', 40, { optional: true }) || null, depends_on: Array.isArray(p.depends_on) ? p.depends_on.map((d) => int(d, 'dependencia')) : []
    }, 'usuario'),
    'tasks.approve': ({ id, decision, hash }) => board.approve(int(id, 'tarea'), decision === 'approved' ? 'approved' : 'rejected', 'usuario', str(hash, 'huella', 100)),
    'tasks.retry': ({ id }) => board.retry(int(id, 'tarea'), 'usuario'),
    'tasks.cancel': ({ id }) => scheduler.cancel(int(id, 'tarea'), 'usuario'),
    'tasks.reassign': ({ id, agent, model, reasoning }) => board.reassign(int(id, 'tarea'), { agent: oneOf(agent, [...AGENT_IDS, 'any'], 'agente'), model: str(model, 'modelo', 80, { optional: true }) || null, reasoning: oneOf(reasoning, ['low', 'medium', 'high'], 'razonamiento') }, 'usuario'),
    'tasks.followup': ({ id, text, images: files }) => scheduler.followup(int(id, 'tarea'), str(text, 'mensaje', 20000), images(files)),
    'tasks.undo': ({ id }) => scheduler.undo(int(id, 'tarea')),
    'tasks.launchAnyway': ({ id }) => { const t = board.task(int(id, 'tarea')); if (t?.status !== 'queued') fail('solo para tareas en cola que esperan cupo'); board.setting(`budget_ok:${t.id}`, '1'); board.event(t.id, 'usuario', 'budget.authorised', 'lanzar aunque supere el cupo'); return true; },
    'tasks.accept': ({ id }) => accept([int(id, 'tarea')]),
    'tasks.discardBranch': ({ id }) => scheduler.discardBranch(int(id, 'tarea')),

    'sessions.list': ({ archived }) => sessions.list({ archived: Boolean(archived) }),
    'sessions.create': (p) => {
      const proj = p.project ? project(p.project) : null;
      const cwd = proj ? proj.path : ctx.paths.projects;
      // Without a project the agent sits in the assistant's own folder (its database, secret and logs): it may only look.
      if (!proj && p.permission && p.permission !== 'leer') fail('sin proyecto, el agente solo puede leer: elige un proyecto para que pueda editar');
      return sessions.create({ kind: 'chat', agent: oneOf(p.agent, AGENT_IDS, 'agente'), account: str(p.account, 'cuenta', 40, { optional: true }) || null, model: str(p.model, 'modelo', 80, { optional: true }) || null,
        reasoning: oneOf(p.reasoning, ['low', 'medium', 'high'], 'razonamiento', 'medium'), permission: proj ? oneOf(p.permission, PERMISSIONS, 'permiso', 'editar') : 'leer',
        project: proj?.name ?? null, cwd, title: str(p.title, 'título', 80, { optional: true }) || `Conversación con ${p.agent}` });
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
      return sessions.message(s.id, str(text, 'mensaje', 20000), { images: images(files), mode: oneOf(mode, ['auto', 'steer', 'queue'], 'modo', 'auto') });
    },
    'sessions.queue': ({ id }) => sessions.queue(str(id, 'conversación', 64)),
    'sessions.editQueued': ({ id, queueId, text, remove, move }) => sessions.editQueued(str(id, 'conversación', 64), int(queueId, 'mensaje'), { text: text === undefined ? undefined : str(text, 'mensaje', 20000), remove: Boolean(remove), move: oneOf(move, ['up', 'down'], 'mover', undefined) }),
    'sessions.approve': ({ id, request, decision }) => sessions.respond(str(id, 'conversación', 64), str(request, 'petición', 200), oneOf(decision, DECISION, 'decisión')),
    'sessions.resume': ({ id }) => sessions.resume(str(id, 'conversación', 64)),
    'sessions.fork': ({ id, title }) => sessions.fork(str(id, 'conversación', 64), { title: str(title, 'título', 80, { optional: true }) || undefined }),
    'sessions.settle': ({ id, settled }) => sessions.update(sessions.must(str(id, 'conversación', 64)).id, { settled: settled !== false }),
    'approvals.list': () => sessions.allPendingApprovals(),
    'chat.approve': ({ request, decision }) => orchestrator.respond(str(request, 'petición', 200), oneOf(decision, DECISION, 'decisión')),
    'tasks.review': ({ id, agent, focus }) => scheduler.createReview(board.task(int(id, 'tarea')) ?? fail('no existe esa tarea'), { actor: 'usuario', agent: oneOf(agent, AGENT_IDS, 'agente', null), focus: str(focus, 'foco', 500, { optional: true }) }),
    'projects.review': ({ name, agent, focus }) => scheduler.reviewProject(project(name).name, { actor: 'usuario', agent: oneOf(agent, AGENT_IDS, 'agente', null), focus: str(focus, 'foco', 500, { optional: true }) }),
    'sessions.stop': ({ id }) => { const s = sessions.must(str(id, 'conversación', 64)); if (s.kind === 'task') return scheduler.cancel(s.task_id, 'usuario'); return sessions.stop(s.id); },
    'sessions.update': ({ id, title, model, reasoning, permission, archived }) => {
      const s = sessions.must(str(id, 'conversación', 64));
      if (s.kind === 'task' && (model !== undefined || permission !== undefined || reasoning !== undefined)) fail('el modelo de una tarea se cambia desde la tarea');
      const fields = {};
      if (title !== undefined) fields.title = oneLine(str(title, 'título', 80), 80);
      if (model !== undefined) fields.model = str(model, 'modelo', 80, { optional: true }) || null;
      if (reasoning !== undefined) fields.reasoning = oneOf(reasoning, ['low', 'medium', 'high'], 'razonamiento');
      if (permission !== undefined) { fields.permission = oneOf(permission, PERMISSIONS, 'permiso'); if (!s.project && fields.permission !== 'leer') fail('sin proyecto, el agente solo puede leer'); }
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
    'usage.get': () => usageReport(board),
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
      if (enabled) await remoteRef.current.start(); else remoteRef.current.stop();
      return remoteRef.current.status();
    },
    'remote.pair': () => remoteRef.current.pair(),
    'remote.revoke': ({ id }) => remoteRef.current.revoke(str(id, 'dispositivo', 64)),
    'control.pause': () => { board.setting('paused', '1'); board.changed('settings'); return true; },
    'control.resume': () => { board.setting('paused', '0'); board.changed('settings'); return true; }
  };

  return {
    async call(method, params) {
      const fn = Object.hasOwn(methods, method) ? methods[method] : null;
      if (!fn) fail(`acción desconocida: ${method}`);
      if (params === null || typeof params !== 'object' || Array.isArray(params)) fail('parámetros no válidos');
      return fn(params);
    },
    // New chat lines since the last call (the window uses them for notifications when it is in the background).
    notifyNewChat() {
      const rows = board.all('SELECT id, role, body FROM chat WHERE id > ? ORDER BY id LIMIT 20', lastChat);
      if (!rows.length) return;
      lastChat = rows[rows.length - 1].id;
      for (const r of rows) if (r.role !== 'usuario') emit('chat:new', { role: r.role, body: oneLine(r.body, 240) });
    },
    shutdown() { sessions.stopAll(); orchestrator.stop(); log('motor detenido'); }
  };
}
