// The shared board: projects, tasks with dependencies and approvals, events, messages between agents and the assistant's chat.
import { openDb, taskOptions, checkPolicy } from '../data/db.mjs';
import { ctx, tr } from '../../platform/context.mjs';
import { CATEGORIES } from '../../platform/paths.mjs';
import { oneLine, MAX_DESCRIPTION } from '../../shared/text.mjs';
import { contentHash, sign, verify, detectSensitivity, deletionAskedByUser, askedByUser, defaultApprovalKey } from '../security/approval.mjs';
import { AUTONOMY, globalAutonomy, autonomyOf } from '../security/guard.mjs';
import { BoardProjects } from './board-projects.mjs';
import { BoardConversations } from './board-conversations.mjs';
import { now, real, same, inside } from './board-common.mjs';
import { AGENTS, assistantName, checkProjectPath, userName } from './board-common.mjs';
export { AGENTS, assistantName, checkProjectPath, userName } from './board-common.mjs';


// limited (2.3): stopped by the account's usage limit; continues by itself when the limit resets (tasks.limited_until).
export const STATUSES = ['queued', 'awaiting_approval', 'running', 'done', 'failed', 'blocked', 'cancelled', 'limited'];
const FINISHED = new Set(['done', 'failed', 'cancelled']);
const MODES = ['carpeta', 'aislada'];
const parse = (task) => {
  if (!task) return task;
  const { reasoning, fast } = taskOptions({ reasoning: task.reasoning ?? undefined, fast: task.fast == null ? undefined : Boolean(task.fast) });
  task.mode ??= 'carpeta'; task.readonly = Boolean(task.readonly); task.reasoning = reasoning; task.fast = fast;
  // A corrupt column in one row must not break every list (3.8.3 repaso): it reads as empty.
  const list = (v) => { try { const j = JSON.parse(v ?? '[]'); return Array.isArray(j) ? j : []; } catch { return []; } };
  task.depends_on = list(task.depends_on); task.sensitivity = list(task.sensitivity);
  // 3.8.3: «Auto» or «Preguntar» (null: the global level now) and what the user asked for in so many words.
  task.user_asked = list(task.user_asked);
  return task;
};

// The user's name as the assistant writes it ("el usuario" when not set).
// "de Ana" / "del usuario" (Spanish contracts de + el).
export const ofUser = () => (ctx.config?.userName?.trim() ? `de ${ctx.config.userName.trim()}` : 'del usuario');
// The same two for what the user reads in the app (chat notices), in the language of the settings.
export const userLabel = () => ctx.config?.userName?.trim() || tr('msg.board.theUser');
export const ofUserLabel = () => (ctx.config?.userName?.trim() ? tr('msg.board.ofName', { name: ctx.config.userName.trim() }) : tr('msg.board.ofTheUser'));
// 3.2.1: the tags of a sensitive task in words («elimina datos»), never the internal ones («destructive»).
export const tagWords = (tags) => [...new Set(tags)].map((tag) => { const key = `sensitive.${tag}`; const w = tr(key); return w === key ? tag : w; }).join(', ');

// 3.2.1: an event's text stored as a key (eventKey) is told in the app's language when it is read (Actividad, a task's
// history), not fixed in the language of the moment it happened. A var { k, v } is itself a key; old texts stay as they are.
const EVENT_KEY = '@t:';
export const eventKey = (key, vars = {}) => `${EVENT_KEY}${JSON.stringify({ k: key, v: vars })}`;
export function eventText(detail) {
  const s = String(detail ?? '');
  if (!s.startsWith(EVENT_KEY)) return detail;
  try {
    const { k, v } = JSON.parse(s.slice(EVENT_KEY.length));
    const vars = Object.fromEntries(Object.entries(v ?? {}).map(([name, val]) => [name, val && typeof val === 'object' && val.k ? tr(val.k, val.v ?? {}) : val]));
    return tr(k, vars);
  } catch { return s; }
}

// A worker (any actor but the orchestrator) may only close its own running task.
const WORKER_STATUSES = ['done', 'failed', 'blocked'];
// Orchestrator transitions through MCP. Nothing leaves "done"; "awaiting_approval" only leaves through the app (approve/reject);
// a running task is cancelled from the app because that also stops its process.
// 3.1: the coordinator may also cancel a running task (or one waiting for its usage to reset): the engine stops its process.
const ORCHESTRATOR_TO = { queued: ['failed', 'blocked', 'cancelled', 'queued'], cancelled: ['queued', 'blocked', 'failed', 'running', 'limited'] };

// Validated model id for an agent: one of its configured models, or any well-formed id when the list is empty (CLI default).
// 2.6: listed = the models the agent itself reported (models:<agent>), also valid.
export function checkModel(agent, model, listed = []) {
  if (!model) return null;
  const configured = ctx.config.agents[agent]?.models ?? [];
  // An alias the agent listed (opus) also stands for the full id it resolves to (claude-opus-5-5).
  const models = configured.length ? [...new Set([...configured, ...(listed ?? []).flatMap((m) => [m.id ?? m, m.resolved].filter(Boolean))])] : [];
  if (models.length && !models.includes(model)) throw new Error(tr('msg.board.noModel', { agent, model, models: models.join(', ') }));
  if (!/^[A-Za-z0-9][\w.:\-/[\]=,@]{0,79}$/.test(model)) throw new Error(tr('msg.board.badModelId', { model }));
  return model;
}


export class Board {
  // approvalKey: HMAC key that signs approvals (only the app's user actions sign; the scheduler verifies).
  // noKey: processes that must never hold the secret (the MCP server): approvals cannot be verified there, so sensitive
  // tasks count as not approved and nothing is re-checked.
  constructor(db = openDb(), { approvalKey, noKey = false } = {}) { this.db = db; this._key = approvalKey ?? null; this.noKey = noKey; this.listeners = new Set(); }
  get key() { if (this.noKey) return null; return this._key ??= defaultApprovalKey(); }

  // The engine listens to push changes to the window; MCP processes have no listeners (the engine polls the database).
  onChange(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  // hints: what changed exactly (a chat line's conversation), for the listeners that need it; never content.
  changed(what, hints = null) { for (const fn of this.listeners) { try { fn(what, hints); } catch { /* a listener must never break a write */ } } }

  all(sql, ...params) { return this.stmt(sql).all(...params); }
  one(sql, ...params) { return this.stmt(sql).get(...params); }
  run(sql, ...params) { return this.stmt(sql).run(...params); }
  // 3.8.1: each query is compiled once and kept (the lists of the window run the same few hundred queries on every
  // refresh; compiling one costs more than running it). Bounded: SQL built with a variable number of fields or
  // placeholders could otherwise grow it without end. SQLite compiles a kept statement again by itself when the schema
  // changes.
  stmt(sql) {
    if (this._stmtDb !== this.db) { this._stmts = new Map(); this._stmtDb = this.db; }
    let s = this._stmts.get(sql);
    if (!s) { if (this._stmts.size >= 400) this._stmts.clear(); s = this.db.prepare(sql); this._stmts.set(sql, s); }
    return s;
  }

  transaction(fn) {
    this.db.exec('BEGIN IMMEDIATE');
    try { const out = fn(); this.db.exec('COMMIT'); return out; } catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }

  // Orb's internal state (the settings table; every key is registered in src/platform/state.mjs › STATE_KEYS).
  setting(key, value) {
    if (value === undefined) return this.one('SELECT value FROM settings WHERE key = ?', key)?.value;
    this.run('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', key, String(value));
  }
  settingJson(key, value) {
    if (value === undefined) { try { return JSON.parse(this.setting(key) || 'null'); } catch { return null; } }
    // 3.8.3: null removes the row (it reads back as null, as before); an empty row left per key piled up for good.
    if (value === null) this.run('DELETE FROM settings WHERE key = ?', key);
    else this.setting(key, JSON.stringify(value));
  }

  // 3.1: the agents this PC can really run (turned on, installed and with an account). The engine keeps the list here
  // (agents_available), so the MCP processes, the app and the scheduler all check against the same thing. null: not known
  // yet (a board without an engine, e.g. the first instant): nothing is refused.
  availableAgents() { const list = this.settingJson('agents_available'); return Array.isArray(list) ? list : null; }
  checkAvailable(agent) {
    if (!agent || agent === 'any') return;
    const list = this.availableAgents();
    if (list && !list.includes(agent)) throw new Error(tr('sys.board.agentUnavailable', { agent, list: list.length ? list.join(', ') : tr('sys.board.noAgentsAvailable') }));
  }

  event(taskId, actor, kind, detail = '') {
    this.run('INSERT INTO events (task_id, actor, kind, detail, at) VALUES (?, ?, ?, ?, ?)', taskId ?? null, String(actor), kind, String(detail).slice(0, 4000), now());
    this.changed('events');
  }

  // ---- tasks
  task(id) { return parse(this.one('SELECT * FROM tasks WHERE id = ?', Number(id))); }

  tasks({ project, status, agent, limit = 100 } = {}) {
    const where = []; const params = [];
    if (project) { where.push('project = ? COLLATE NOCASE'); params.push(project); }
    if (status) { where.push('status = ?'); params.push(status); }
    if (agent) { where.push('(agent = ? OR assigned_to = ?)'); params.push(agent, agent); }
    const sql = `SELECT * FROM tasks ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY id DESC LIMIT ?`;
    return this.all(sql, ...params, Math.min(Math.max(Number(limit) || 100, 1), 500)).map(parse);
  }

  taskDetail(id) {
    const task = this.task(id); if (!task) throw new Error(tr('msg.board.noTask', { id }));
    return {
      ...task,
      events: this.all('SELECT actor, kind, detail, at FROM events WHERE task_id = ? ORDER BY id DESC LIMIT 300', task.id).reverse().map((e) => ({ ...e, detail: eventText(e.detail) })),
      messages: this.all('SELECT id, from_agent, to_agent, body, at FROM messages WHERE task_id = ? ORDER BY id DESC LIMIT 100', task.id).reverse(),
      dependencies: task.depends_on.map((dep) => { const d = this.task(dep); return d && { id: d.id, title: d.title, status: d.status, result: d.result }; })
    };
  }

  // Open tasks however old (so none disappears) plus the last `finished` closed ones.
  panelTasks(finished = 100) {
    const open = this.all("SELECT * FROM tasks WHERE status NOT IN ('done', 'cancelled') ORDER BY id DESC");
    const closed = this.all("SELECT * FROM tasks WHERE status IN ('done', 'cancelled') ORDER BY id DESC LIMIT ?", Number(finished));
    return [...open, ...closed].sort((a, b) => b.id - a.id).map(parse);
  }

  // mode: "carpeta" (default: the project folder, in turn with the other writing tasks) or "aislada" (own branch and copy).
  // readonly: the task only reads (research, review): it may run at the same time as others in the same folder.
  // 3.2: conversation_id: the conversation that asked for it (its report goes back there); a subtask, a review or a join
  // task belongs to the one of the task it comes from.
  createTask({ project, title, description, agent = 'any', account = null, model = null, reasoning, fast, launch = 'auto', priority = 2, depends_on = [], sensitivity = [], mode = 'carpeta', readonly = false, parent_id = null, review_of = null, schedule_id = null, level = null, fixedBrief = false, internal = false, conversation_id = null, autonomy }, actor) {
    if (!MODES.includes(mode)) throw new Error(tr('sys.board.badMode'));
    const proj = this.project(project);
    if (!proj) throw new Error(tr('sys.board.unknownProject', { name: project }));
    // 3.8.1: a project being deleted takes nothing new (project-close.mjs › checkDelete).
    if (this.isDeleting(proj.name)) throw new Error(tr('msg.projects.deleting', { name: proj.name }));
    const convId = (conversation_id ? this.conversation(conversation_id)?.id : null) ?? (parent_id ? this.conversationOfTask(parent_id) : review_of ? this.conversationOfTask(review_of) : null);
    // A subtask or a review is checked against the project of its own conversation, not the folder another one set.
    const conversation = convId ? this.conversation(convId) : null;
    // The folder the work must stay in: the conversation's project (3.2: several conversations work at once, each in its
    // own), else the working folder of the app.
    const active = conversation ? (conversation.project ? this.project(conversation.project) : null) : this.activeProject();
    // 2.7: the projects of a multiplatform group work together: a task may go to a sister of the active project.
    // 3.1: internal: a task the engine itself needs in that project (joining a copy), whatever project is active now.
    if (!internal && active && proj.name !== active.name && actor !== 'usuario' && !(active.grupo && proj.grupo === active.grupo)) throw new Error(tr('sys.board.otherFolder', { name: active.name, path: active.path, user: userName() }));
    if (!title || !description) throw new Error(tr('sys.board.titleAndDesc'));
    title = oneLine(title);
    if (String(description).length > MAX_DESCRIPTION) throw new Error(tr('sys.board.descTooLong', { n: String(description).length, max: MAX_DESCRIPTION }));
    if (agent !== 'any' && !AGENTS.includes(agent)) throw new Error(tr('sys.board.badAgent', { agent, list: AGENTS.join(', ') }));
    if (model && agent === 'any') throw new Error(tr('sys.board.modelNeedsAgent'));
    model = agent === 'any' ? null : checkModel(agent, model, this.settingJson(`models:${agent}`));
    // An account chosen on purpose: it must belong to the task's agent.
    if (account && !(ctx.config.accounts ?? []).some((a) => a.id === account && (agent === 'any' || a.agent === agent))) throw new Error(tr('sys.board.accountNotOf', { account, agent }));
    if (account && agent === 'any') agent = (ctx.config.accounts ?? []).find((a) => a.id === account).agent;
    this.checkAvailable(agent);
    if (!['auto', 'manual'].includes(launch)) throw new Error(tr('sys.board.badLaunch'));
    if (!Array.isArray(depends_on) || depends_on.length > 20) throw new Error(tr('sys.board.dependsMax'));
    for (const dep of depends_on) if (!this.task(dep)) throw new Error(tr('sys.board.dependsMissing', { id: dep }));
    if (!Array.isArray(sensitivity)) throw new Error(tr('sys.board.sensitivityList'));
    const unknown = sensitivity.filter((s) => !ctx.config.sensitive.includes(s));
    if (unknown.length) throw new Error(tr('sys.board.badSensitivity', { list: unknown.join(', ') }));
    ({ reasoning, fast } = taskOptions({ reasoning, fast }));
    const policy = checkPolicy({ agent, model, reasoning, fast });
    // 3.8.3: the task's level: a subtask takes its parent's, the user may choose it (the API), anything else takes the
    // global one now (Ajustes › Agentes; an agent never chooses it).
    const parentTask = parent_id ? this.task(parent_id) : null;
    const mine = parentTask?.autonomy ?? (actor === 'usuario' && AUTONOMY.includes(autonomy) ? autonomy : globalAutonomy());
    const auto = mine === 'auto';
    // Approval does not depend on the creator declaring it: a task made by a worker always waits for the user,
    // and a keyword net adds the tags the creator forgot.
    const tags = [...new Set(sensitivity)]; const reasons = [];
    // 3.0: fixedBrief: a read-only brief written by Orb itself (Security Review), whose checklist names «secretos» and
    // «credenciales» on purpose; only for code paths of the engine (the API does not pass it).
    let askedNote = null;
    let found = [];
    if (!tags.length && !(fixedBrief && readonly)) { found = detectSensitivity(`${title}\n${description}`); tags.push(...found); }
    // 3.1: what the user asked for in their own words is already their decision. 3.2.1: one rule, whether the assistant
    // marked the task as destructive or the keyword net found it (approval.mjs deletionAskedByUser): the user's current
    // request asks to delete and names the files the task deletes. Narrow on purpose:
    // - only «destructive» (credentials, payments, publishing and sending stay behind the click whatever was said);
    // - only the user's current request (their messages since the assistant last answered), not something said before;
    // - only tasks the assistant writes, never the engine's own (whose text can carry an agent's words).
    if (actor === 'orb' && !internal && tags.includes('destructive') && deletionAskedByUser(this.currentRequest(convId), `${title}\n${description}`)) {
      tags.splice(tags.indexOf('destructive'), 1); found = found.filter((tag) => tag !== 'destructive');
      askedNote = eventKey('msg.board.askedByUser', { words: { k: 'msg.board.deleteWords' } });
    }
    // 3.8.3 («Auto»): the words that only meant «inside the project» no longer wait (keys and passwords the code uses,
    // deleting inside the folder: the checkpoint undoes it), nor high reasoning (the usage limits cover the cost). A push,
    // a payment, an email or a folder that moved still wait; a push the user's current request asked for does not.
    let asked = [];
    if (auto) {
      const quiet = ['credential_access', 'destructive'];
      if (actor === 'orb' && !internal) { asked = askedByUser(this.currentRequest(convId)); if (asked.includes('publish')) quiet.push('publish'); }
      if (actor === 'usuario') { asked = askedByUser(`${title}\n${description}`); if (asked.includes('publish')) quiet.push('publish'); }
      for (const t of quiet) { const i = tags.indexOf(t); if (i >= 0) tags.splice(i, 1); }
      found = found.filter((t) => !quiet.includes(t));
      if (asked.includes('publish')) askedNote = eventKey('msg.board.askedByUser', { words: { k: 'msg.board.publishWords' } });
    }
    if (found.length) reasons.push(tr('msg.board.reasonKeywords', { words: tagWords(found) }));
    if (policy.approval && !auto) { tags.push('razonamiento_alto'); reasons.push(tr('msg.board.reasonHighReasoning', { who: model ?? agent })); }
    // A subtask an agent delegates from its own task (orb_delegate) goes straight to the queue when the user trusts
    // delegation, the parent task came from the assistant or the user, nothing looks risky and the parent has not used
    // its quota of subtasks. Anything else made by an agent waits for the user, as always.
    const parent = parentTask;
    const d = ctx.config.delegation ?? {};
    const quota = parent && this.one('SELECT COUNT(*) AS n FROM tasks WHERE parent_id = ?', parent.id).n < (d.maxPerTask ?? 4);
    // 3.8.3 («Auto»): a subtask in the same project goes straight to the queue (with the same quota); one for another
    // project still waits. 3.8.3 (security review): only under a task of the user or the assistant, as before: a subtask's
    // own subtasks wait (otherwise each level brought 4 more without a click, and each one's deletions are held apart).
    const trusted = parent && d.enabled !== false && !tags.length && quota && ['orb', 'usuario'].includes(parent.created_by)
      && (auto ? parent.project === proj.name : d.trusted !== false);
    if (actor !== 'orb' && actor !== 'usuario' && !trusted) { tags.push('creada_por_agente'); reasons.push(tr('msg.board.reasonByAgent', { actor, name: assistantName() })); }
    const status = tags.length ? 'awaiting_approval' : 'queued';
    const at = now();
    const { lastInsertRowid } = this.run(`INSERT INTO tasks (project, title, description, agent, account, model, reasoning, fast, launch, priority, depends_on, sensitivity, status, created_by, project_path, created_at, updated_at, mode, readonly, parent_id, review_of, schedule_id, level, conversation_id, autonomy, user_asked)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, proj.name, title, String(description), agent, account || null, model, reasoning, Number(fast), launch, Math.min(Math.max(Number(priority) || 2, 1), 3),
      JSON.stringify(depends_on.map(Number)), JSON.stringify([...new Set(tags)]), status, String(actor), proj.path, at, at, mode, Number(Boolean(readonly)), parent_id ? Number(parent_id) : null, review_of ? Number(review_of) : null, schedule_id ? Number(schedule_id) : null, ['simple', 'normal', 'complejo'].includes(level) ? level : null, convId ?? null, mine, asked.length ? JSON.stringify(asked) : null);
    const id = Number(lastInsertRowid);
    this.event(id, actor, 'task.created', status);
    if (askedNote) this.event(id, 'orb', 'note', askedNote);
    if (status === 'awaiting_approval') { const tagList = tagWords(tags); this.addChat('system', reasons.length ? tr('msg.board.needsApprovalWhy', { id, title, tags: tagList, reasons: reasons.join('; ') }) : tr('msg.board.needsApproval', { id, title, tags: tagList }), { kind: 'attention', task: id }, convId ?? null); }
    // Even a task the user typed waits for an explicit "Aprobar" when it looks sensitive: one more click, with the reasons on screen.
    this.changed('tasks');
    return this.task(id);
  }

  // The user's current request in a conversation: their messages since the assistant's answer before the last one (the
  // request, the plan the assistant proposed and the user's «sí»). 3.2: only that conversation's (with several at once,
  // another one's words do not count). 3.8.3 (security review): of an answer to a question card, only what the user typed
  // (the question and its options are the assistant's words, and an agent's words never ask for anything).
  currentRequest(convId) {
    const inConv = convId ? ' AND conversation_id = ?' : ' AND conversation_id IS NULL';
    const lastAnswer = this.one(`SELECT id AS n FROM chat WHERE role = 'orb'${inConv} ORDER BY id DESC LIMIT 1 OFFSET 1`, ...(convId ? [convId] : []))?.n ?? 0;
    const own = (r) => { try { const m = JSON.parse(r.meta ?? 'null'); return m?.answer ? String(m.own ?? '') : r.body; } catch { return r.body; } };
    return this.all(`SELECT body, meta FROM chat WHERE role = 'usuario' AND id > ?${inConv} ORDER BY id DESC LIMIT 5`, lastAnswer, ...(convId ? [convId] : [])).map(own).join('\n');
  }

  // expect: only apply if the task is still in that status (compare-and-set); throws if someone else moved it first.
  patch(id, fields, actor, kind = 'task.updated', expect) {
    const keys = Object.keys(fields);
    const res = this.run(`UPDATE tasks SET ${keys.map((k) => `${k} = ?`).join(', ')}, updated_at = ? WHERE id = ?${expect ? ' AND status = ?' : ''}`,
      ...keys.map((k) => fields[k] ?? null), now(), Number(id), ...(expect ? [expect] : []));
    if (expect && !res.changes) throw new Error(tr('msg.board.notInState', { id, expect }));
    this.event(Number(id), actor, kind, fields.status ?? fields.result ?? '');
    this.changed('tasks');
    return this.task(id);
  }

  // ---- approvals: the user signs what they saw (description, agent, model, folder, tags, effort); any change invalidates it.
  projectPathNow(task) { return this.project(task.project)?.path ?? task.project_path; }
  previewHash(task) { return contentHash({ ...task, project_path: this.projectPathNow(task) }); }
  approvalOk(task) { return !task.sensitivity.length || verify(this.key, task); }
  clearApproval() { return { approved_by: null, approval_hash: null, approval_sig: null }; }

  // Queued tasks whose approval is missing or stale, or whose folder moved, go back to waiting for the user.
  revalidateQueued() {
    if (this.noKey) return []; // without the secret every signature would look forged
    const back = [];
    for (const task of this.all("SELECT * FROM tasks WHERE status = 'queued'").map(parse)) {
      const project = this.project(task.project);
      const moved = Boolean(task.project_path && project && !same(task.project_path, project.path));
      if (!moved && this.approvalOk(task)) continue;
      const tags = moved && !task.sensitivity.includes('ruta_cambiada') ? [...task.sensitivity, 'ruta_cambiada'] : task.sensitivity;
      this.patch(task.id, { status: 'awaiting_approval', sensitivity: JSON.stringify(tags), ...this.clearApproval() }, 'orb', 'approval.required', 'queued');
      this.addChat('system', tr(moved ? 'msg.board.backToApprovalMoved' : 'msg.board.backToApprovalStale', { id: task.id, title: task.title }), { task: task.id });
      back.push(task.id);
    }
    return back;
  }

  // Agents may report progress, but only the user (app) can release a task that waits for approval.
  // ctx.taskId: ORB_TASK_ID of the calling worker (set for tasks launched by the engine).
  updateTask(id, args, actor, context = {}) { return this.transaction(() => this.updateTaskNow(id, args, actor, context)); }

  updateTaskNow(id, { status, note, result, agent, model, reasoning, fast, progress }, actor, context) {
    const task = this.task(id); if (!task) throw new Error(tr('msg.board.noTask', { id }));
    const reassigning = agent !== undefined || model !== undefined || reasoning !== undefined || fast !== undefined;
    if (actor !== 'orb') {
      if (reassigning) throw new Error(tr('sys.board.onlyAssistant', { name: assistantName() }));
      if (task.assigned_to !== actor || task.status !== 'running') throw new Error(tr('sys.board.notYours', { id }));
      if (context.taskId !== undefined && context.taskId !== '' && Number(context.taskId) !== task.id) throw new Error(tr('sys.board.yourTask', { mine: context.taskId, id }));
      if (status && !WORKER_STATUSES.includes(status)) throw new Error(tr('sys.board.workerStatus', { list: WORKER_STATUSES.join(', ') }));
    } else {
      if (status && !(ORCHESTRATOR_TO[status] ?? []).includes(task.status)) throw new Error(tr('sys.board.badTransition', { from: task.status, to: status, extra: task.status === 'running' ? tr('sys.board.cancelFromApp') : '' }));
      if (task.status === 'done' && (result !== undefined || reassigning)) throw new Error(tr('sys.board.doneLocked'));
    }
    const reassign = {};
    if (reasoning !== undefined || fast !== undefined) {
      if (task.status === 'running') throw new Error(tr('sys.board.runningOptions'));
      const options = taskOptions({ reasoning: reasoning === undefined ? task.reasoning : reasoning, fast: fast === undefined ? task.fast : fast });
      if (reasoning !== undefined) reassign.reasoning = options.reasoning;
      if (fast !== undefined) reassign.fast = Number(options.fast);
    }
    if (agent !== undefined || model !== undefined) {
      if (task.status === 'running') throw new Error(tr('sys.board.runningAgent', { id }));
      const nextAgent = agent ?? task.agent;
      if (nextAgent !== 'any' && !AGENTS.includes(nextAgent)) throw new Error(tr('msg.board.badAgent', { agent: nextAgent }));
      if (agent !== undefined) this.checkAvailable(nextAgent);
      const nextModel = model === undefined ? (agent !== undefined ? null : task.model) : (model || null);
      if (nextModel && nextAgent === 'any') throw new Error(tr('sys.board.modelNeedsAgent'));
      Object.assign(reassign, { agent: nextAgent, model: nextAgent === 'any' ? null : checkModel(nextAgent, nextModel, this.settingJson(`models:${nextAgent}`)), assigned_to: null });
    }
    if (Object.keys(reassign).length) {
      const after = { agent: reassign.agent ?? task.agent, model: 'model' in reassign ? reassign.model : task.model, reasoning: reassign.reasoning ?? task.reasoning, fast: 'fast' in reassign ? Boolean(reassign.fast) : task.fast };
      if (checkPolicy(after).approval && autonomyOf(task) !== 'auto' && !task.sensitivity.includes('razonamiento_alto')) reassign.sensitivity = JSON.stringify([...task.sensitivity, 'razonamiento_alto']);
    }
    if (status && !STATUSES.includes(status)) throw new Error(tr('sys.board.badStatus', { status }));
    if (status === 'awaiting_approval') throw new Error(tr('sys.board.systemOnly'));
    let next = status;
    const changed = Object.keys(reassign).length > 0 && (task.sensitivity.length > 0 || 'sensitivity' in reassign);
    if (changed && task.status === 'queued') next = 'awaiting_approval';
    if (status === 'queued' && ('sensitivity' in reassign || (task.sensitivity.length && !verify(this.key, { ...task, ...reassign })))) next = 'awaiting_approval';
    // A progress report (percent and what it is doing now) is shown live; it is not kept in the history.
    if (progress !== undefined && progress !== null) {
      const percent = Math.max(0, Math.min(100, Math.round(Number(progress) || 0)));
      if (task.status === 'running') this.settingJson(`progress:${task.id}`, { percent, note: note ? String(note).slice(0, 200) : null, at: now() });
      if (!status && result === undefined && !Object.keys(reassign).length) return task;
    } else if (note) this.event(task.id, actor, 'note', String(note).slice(0, 4000));
    const fields = { ...reassign };
    if (next) fields.status = next;
    if (next === 'awaiting_approval' || changed) Object.assign(fields, this.clearApproval());
    if (result !== undefined) fields.result = String(result ?? '').slice(0, 8000);
    if (next === 'queued') Object.assign(fields, { assigned_to: null, pid: null });
    return Object.keys(fields).length ? this.patch(task.id, fields, actor, 'task.updated', task.status) : task;
  }

  // App actions. Retry only from a stopped state; the click counts as the user's approval except for high reasoning.
  retry(id, actor) {
    return this.transaction(() => {
      const task = this.task(id); if (!task) throw new Error(tr('msg.board.noTask', { id }));
      if (!['failed', 'blocked', 'cancelled', 'limited'].includes(task.status)) throw new Error(tr('msg.board.retryState', { id, status: task.status }));
      const out = this.patch(id, { status: 'queued', assigned_to: task.agent === 'any' ? null : task.assigned_to, pid: null, ...this.clearApproval() }, actor, 'task.retry', task.status);
      if (!out.sensitivity.length) return out;
      if (out.sensitivity.includes('razonamiento_alto')) return this.patch(id, { status: 'awaiting_approval' }, actor, 'approval.required', 'queued');
      return this.signNow(out, actor);
    });
  }
  cancel(id, actor) {
    return this.transaction(() => {
      const task = this.task(id); if (!task) throw new Error(tr('msg.board.noTask', { id }));
      if (this.isFinished(task.status)) throw new Error(tr('msg.board.alreadyFinished', { id, status: task.status }));
      return this.patch(id, { status: 'cancelled' }, actor, 'task.updated', task.status);
    });
  }

  // App: the user changes the agent, model or reasoning of a task that is not running. Same branch and copy.
  reassign(id, { agent, model, reasoning }, actor) {
    return this.transaction(() => {
      const task = this.task(id); if (!task) throw new Error(tr('msg.board.noTask', { id }));
      if (task.status === 'running') throw new Error(tr('msg.board.runningCancelModel', { id }));
      if (task.status === 'done') throw new Error(tr('msg.board.alreadyDone', { id }));
      const nextAgent = agent || task.agent;
      if (nextAgent !== 'any' && !AGENTS.includes(nextAgent)) throw new Error(tr('msg.board.badAgent', { agent: nextAgent }));
      if (agent) this.checkAvailable(nextAgent);
      const nextModel = nextAgent === 'any' ? null : checkModel(nextAgent, model || null, this.settingJson(`models:${nextAgent}`));
      const { reasoning: nextReasoning } = taskOptions({ reasoning: reasoning || task.reasoning, fast: false });
      const policy = checkPolicy({ agent: nextAgent, model: nextModel, reasoning: nextReasoning, fast: false });
      const tags = policy.approval && autonomyOf(task) !== 'auto' ? [...new Set([...task.sensitivity, 'razonamiento_alto'])] : task.sensitivity.filter((t) => t !== 'razonamiento_alto');
      const fields = { agent: nextAgent, model: nextModel, reasoning: nextReasoning, fast: 0, assigned_to: nextAgent === 'any' ? null : nextAgent, sensitivity: JSON.stringify(tags), ...this.clearApproval() };
      if (['queued', 'awaiting_approval'].includes(task.status)) fields.status = tags.includes('razonamiento_alto') ? 'awaiting_approval' : 'queued';
      const out = this.patch(id, fields, actor, 'task.reassigned', task.status);
      this.event(id, actor, 'note', `modelo cambiado: ${task.assigned_to ?? task.agent}/${task.model ?? 'predeterminado'} → ${nextAgent}/${nextModel ?? 'predeterminado'} · ${nextReasoning}`);
      if (out.status === 'queued' && out.sensitivity.length) return this.signNow(out, actor);
      return out;
    });
  }

  // User actions on a task they are looking at count as their approval.
  signNow(task, actor, status) {
    if (this.noKey) throw new Error(tr('msg.board.signOnlyApp'));
    const approved = { ...task, project_path: this.projectPathNow(task) };
    const hash = contentHash(approved);
    return this.patch(task.id, { ...(status ? { status } : {}), approved_by: actor, project_path: approved.project_path, approval_hash: hash, approval_sig: sign(this.key, task.id, hash) }, actor, 'task.approved');
  }

  // The user wrote to the agent of a stopped task: back to the queue, in the same copy and branch.
  requeue(id, actor, kind = 'task.followup') {
    return this.transaction(() => {
      const task = this.task(id); if (!task) throw new Error(tr('msg.board.noTask', { id }));
      if (task.status === 'running') throw new Error(tr('msg.board.isRunning', { id }));
      if (task.status === 'awaiting_approval' && task.sensitivity.includes('razonamiento_alto')) return task;
      const out = this.patch(id, { status: 'queued', pid: null, assigned_to: task.agent === 'any' ? null : task.assigned_to }, actor, kind, task.status);
      return out.sensitivity.length ? this.signNow(out, actor) : out;
    });
  }

  // Only the app calls this. expectedHash: what the window showed (see previewHash); a mismatch means the task changed meanwhile.
  approve(id, decision, actor, expectedHash) {
    return this.transaction(() => {
      const task = this.task(id); if (!task) throw new Error(tr('msg.board.noTask', { id }));
      if (task.status !== 'awaiting_approval') throw new Error(tr('msg.board.notWaiting', { id }));
      if (decision !== 'approved') return this.patch(id, { status: 'cancelled' }, actor, 'task.rejected', 'awaiting_approval');
      if (this.noKey) throw new Error(tr('msg.board.signOnlyApp'));
      if (expectedHash !== undefined && expectedHash !== this.previewHash(task)) throw new Error(tr('msg.board.changedSince', { id }));
      const approved = { ...task, project_path: this.projectPathNow(task) };
      const hash = contentHash(approved);
      return this.patch(id, { status: 'queued', approved_by: actor, project_path: approved.project_path, approval_hash: hash, approval_sig: sign(this.key, id, hash) }, actor, 'task.approved', 'awaiting_approval');
    });
  }

  // A dependency counts as done only once its process is gone too, so its automatic commit already happened.
  // 3.1: and, for one that worked in its own copy alongside others, once its work is in the folder (integrate:<id>).
  depsDone(task) { return task.depends_on.every((dep) => this.depDone(this.task(dep))); }
  depDone(d) { return d?.status === 'done' && d.pid == null && !this.setting(`integrate:${d.id}`); }
  // 3.8.3: why a queued task has not started, for the user (every list of tasks, PC and phone) and the coordinator.
  // → { kind: 'paused' } (the whole queue is paused) | { kind: 'manual' } (Ajustes: tasks do not start by themselves)
  //   | { kind: 'deps', on: [{ id, status, held }] } (it waits for those)
  //   | { kind: 'notice', text } (what the scheduler said: usage limit, no agent…) | null (its turn comes)
  // A dependency that needs the user (held, failed, blocked) is said first: resuming the queue alone would not start it.
  waitReason(task, paused = this.setting('paused') === '1') {
    if (task?.status !== 'queued') return null;
    const deps = task.depends_on.map((id) => this.task(id)).filter((d) => d && !this.depDone(d));
    const on = (list) => ({ kind: 'deps', on: list.map((d) => ({ id: d.id, status: d.status, held: Boolean(this.heldInfo(d)) })) });
    const stuck = deps.filter((d) => ['failed', 'blocked', 'cancelled'].includes(d.status));
    if (stuck.length) return on(stuck);
    if (paused) return { kind: 'paused' };
    if (ctx.config?.autoRun === false && task.launch === 'auto') return { kind: 'manual' };
    if (deps.length) return on(deps);
    const notice = this.setting(`wait_notice:${task.id}`);
    return notice ? { kind: 'notice', text: notice } : null;
  }
  // 3.8.3: a task Orb stopped after it ran, for the user to review (a mass deletion, a changed remote, a read-only task
  // that wrote): blocked, with a «task.held» since its last launch. → { reasons, folder } or null. The reasons are the
  // ones the scheduler wrote at the front of its result («ha eliminado 2714 archivos»).
  heldInfo(task) {
    if (task?.status !== 'blocked') return null;
    const ev = this.one("SELECT detail FROM events WHERE task_id = ? AND kind = 'task.held' AND detail <> 'blocked' AND id > COALESCE((SELECT MAX(id) FROM events WHERE task_id = ? AND kind = 'task.launched'), 0) ORDER BY id DESC LIMIT 1", task.id, task.id);
    if (!ev) return null;
    const lead = tr('msg.scheduler.needsReview', { reasons: '' });
    const first = String(ev.detail ?? '').split('. ')[0];
    return { reasons: first.startsWith(lead) ? first.slice(lead.length) : first, folder: this.projectPathNow(task) ?? null };
  }
  // 3.1: a blocked dependency stops its dependents too (until someone unblocks it): they are told, and they no longer hold
  // back the report of the request, which would otherwise never come.
  // Also one whose work could not be joined into the folder because the task joining it by hand did not finish.
  failedDeps(task) {
    return task.depends_on.filter((dep) => {
      const d = this.task(dep); if (!d) return false;
      if (['failed', 'cancelled', 'blocked'].includes(d.status)) return true;
      const by = this.settingJson(`integrate:${d.id}`)?.by;
      return Boolean(by && ['failed', 'cancelled', 'blocked'].includes(this.task(by)?.status));
    });
  }
  warnBlockedByDeps() {
    for (const task of this.all("SELECT * FROM tasks WHERE status IN ('queued', 'awaiting_approval')").map(parse)) {
      for (const dep of this.failedDeps(task)) {
        const key = `dep_warned:${task.id}:${dep}`;
        if (this.setting(key)) continue;
        this.setting(key, '1');
        const st = this.task(dep).status;
        this.addChat('system', tr(st === 'failed' ? 'msg.board.depFailed' : st === 'blocked' || st === 'done' ? 'msg.board.depBlocked' : 'msg.board.depCancelled', { id: task.id, title: task.title, dep }), { task: task.id });
      }
    }
  }

  readyTasks(launch) {
    return this.all("SELECT * FROM tasks WHERE status = 'queued' AND launch = ? ORDER BY priority ASC, id ASC", launch).map(parse).filter((t) => this.approvalOk(t) && this.depsDone(t));
  }

  // session: the direct conversation that takes it (the only one that may work on it afterwards).
  claimNext(agent, project, session = null) {
    return this.transaction(() => {
      this.revalidateQueued();
      const task = this.readyTasks('manual').find((t) => (t.agent === agent || t.agent === 'any') && (!project || t.project.toLowerCase() === String(project).toLowerCase()));
      if (!task) return null;
      return this.patch(task.id, { status: 'running', assigned_to: agent, claimed_session: session ? String(session) : null }, agent, 'task.claimed', 'queued');
    });
  }

  // 3.8: manual tasks an agent took before 3.8 (running, claimed by no direct conversation) go back to the queue: only
  // the conversation that claimed a manual task may work on it, and these have none. Called when the engine starts.
  releaseUnclaimed() {
    return this.all("SELECT id FROM tasks WHERE status = 'running' AND launch = 'manual' AND claimed_session IS NULL")
      .map((t) => this.patch(t.id, { status: 'queued', assigned_to: null, pid: null }, 'orb', 'task.updated', 'running').id);
  }

  // ---- the end of the loop: the user gives the OK to finished work
  isAccepted(taskId) { return this.setting(`accepted:${Number(taskId)}`) === '1'; }
  accept(taskIds, actor) {
    const done = [];
    for (const id of taskIds) {
      const task = this.task(id);
      if (!task || task.status !== 'done' || this.isAccepted(id)) continue;
      this.setting(`accepted:${task.id}`, '1');
      this.event(task.id, actor, 'task.accepted', eventKey('sys.events.accepted'));
      done.push(task);
    }
    if (done.length) this.changed('tasks');
    return done;
  }
  recentEvents(limit = 80) {
    return this.all('SELECT e.*, t.title FROM events e LEFT JOIN tasks t ON t.id = e.task_id ORDER BY e.id DESC LIMIT ?', limit).map((e) => ({ ...e, detail: eventText(e.detail) }));
  }

  // 3.2: conversation: the coordinator's, whose project is the one it works in (others may have set the app's folder).
  // 3.8.3: a task's wait or hold in words for the agents' board (orb_board).
  explainForAgents(t) {
    const w = this.waitReason(t); const h = this.heldInfo(t);
    const dep = (d) => `#${d.id} (${d.held ? `retenida: ${userName()} la tiene que aceptar o deshacer` : d.status})`;
    return { ...(w ? { waiting: w.kind === 'paused' ? `cola en pausa: no empieza hasta que ${userName()} pulse «Reanudar»` : w.kind === 'manual' ? `${userName()} inicia las tareas a mano (Ajustes): no empieza sola` : w.kind === 'deps' ? `espera a ${w.on.map(dep).join(', ')}` : w.text } : {}),
      ...(h ? { held: `retenida para que ${userName()} la revise: ${h.reasons} en ${h.folder}` } : {}) };
  }
  summary(agent, conversation = null) {
    const counts = Object.fromEntries(this.all('SELECT status, COUNT(*) AS n FROM tasks GROUP BY status').map((r) => [r.status, r.n]));
    const active = this.all("SELECT * FROM tasks WHERE status NOT IN ('done', 'cancelled') ORDER BY priority, id LIMIT 50").map(parse);
    const conv = conversation ? this.conversation(conversation) : null;
    const project = conv ? (conv.project ? this.project(conv.project) : null) : this.activeProject();
    return {
      paused: this.setting('paused') === '1',
      activeProject: project ? `${project.name} — ${project.path}` : `ninguno (pregunta a ${userName()} en qué proyecto se trabaja)`,
      projectsFolder: ctx.paths.projects,
      categories: CATEGORIES.map((c) => `${c} — ${ctx.paths.categories[c]}`),
      projects: this.projects().map((p) => `${p.name} — ${p.path}`),
      counts,
      // 3.8.3: why each queued one waits, and the ones held for the user's review (the coordinator explains them).
      active: active.map((t) => ({ id: t.id, project: t.project, title: t.title, agent: t.assigned_to ?? t.agent, launch: t.launch, status: t.status, depends_on: t.depends_on, conversation: t.conversation_id ?? null, ...this.explainForAgents(t) })),
      unreadForYou: agent ? this.inbox(agent, false).length : undefined
    };
  }

  // Track record per agent (last 200 finished tasks): the orchestrator uses it to choose better.
  agentStats() {
    const rows = this.all(`SELECT assigned_to AS agent, status, COUNT(*) AS n FROM (SELECT assigned_to, status FROM tasks WHERE status IN ('done', 'failed', 'blocked') AND assigned_to IS NOT NULL ORDER BY id DESC LIMIT 200) GROUP BY assigned_to, status`);
    const out = {};
    for (const r of rows) { out[r.agent] ??= { done: 0, failed: 0, blocked: 0 }; out[r.agent][r.status] = r.n; }
    return out;
  }

  isFinished(status) { return FINISHED.has(status); }
}

// The parts of the class kept in their own files (the same descriptors class methods have).
for (const part of [BoardProjects, BoardConversations]) for (const key of Object.getOwnPropertyNames(part.prototype)) if (key !== 'constructor') Object.defineProperty(Board.prototype, key, Object.getOwnPropertyDescriptor(part.prototype, key));
