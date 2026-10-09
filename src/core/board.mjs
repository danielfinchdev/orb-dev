// The shared board: projects, tasks with dependencies and approvals, events, messages between agents and the assistant's chat.
import fs from 'node:fs';
import path from 'node:path';
import { openDb, taskOptions, checkPolicy } from './db.mjs';
import { ctx, tr } from './context.mjs';
import { AGENT_IDS, folderName, projectLogHeader, isConfigName, categoryOf, CATEGORIES } from './home.mjs';
import { oneLine, MAX_DESCRIPTION } from './safety.mjs';
import { contentHash, sign, verify, detectSensitivity, defaultApprovalKey } from './approval.mjs';
import { PRODUCT } from './product.mjs';

export const AGENTS = AGENT_IDS;
// limited (2.3): stopped by the account's usage limit; continues by itself when the limit resets (tasks.limited_until).
export const STATUSES = ['queued', 'awaiting_approval', 'running', 'done', 'failed', 'blocked', 'cancelled', 'limited'];
const FINISHED = new Set(['done', 'failed', 'cancelled']);
const MODES = ['carpeta', 'aislada'];
const now = () => new Date().toISOString();
const parse = (task) => task && { ...task, mode: task.mode ?? 'carpeta', readonly: Boolean(task.readonly), ...taskOptions({ reasoning: task.reasoning ?? undefined, fast: task.fast == null ? undefined : Boolean(task.fast) }), depends_on: JSON.parse(task.depends_on), sensitivity: JSON.parse(task.sensitivity) };

// The user's name as the assistant writes it ("el usuario" when not set).
export const userName = () => ctx.config?.userName?.trim() || 'el usuario';
// "de Ana" / "del usuario" (Spanish contracts de + el).
export const ofUser = () => (ctx.config?.userName?.trim() ? `de ${ctx.config.userName.trim()}` : 'del usuario');
// The same two for what the user reads in the app (chat notices), in the language of the settings.
export const userLabel = () => ctx.config?.userName?.trim() || tr('msg.board.theUser');
export const ofUserLabel = () => (ctx.config?.userName?.trim() ? tr('msg.board.ofName', { name: ctx.config.userName.trim() }) : tr('msg.board.ofTheUser'));
export const assistantName = () => ctx.config?.assistantName?.trim() || PRODUCT.assistant;

// A worker (any actor but the orchestrator) may only close its own running task.
const WORKER_STATUSES = ['done', 'failed', 'blocked'];
// Orchestrator transitions through MCP. Nothing leaves "done"; "awaiting_approval" only leaves through the app (approve/reject);
// a running task is cancelled from the app because that also stops its process.
const ORCHESTRATOR_TO = { queued: ['failed', 'blocked', 'cancelled', 'queued'], cancelled: ['queued', 'blocked', 'failed'] };
const real = (p) => { try { return fs.realpathSync(p); } catch { return path.resolve(String(p)); } };
const same = (a, b) => real(a).toLowerCase() === real(b).toLowerCase();
const inside = (root, p) => { const rel = path.relative(root, p); return Boolean(rel) && !rel.startsWith('..') && !path.isAbsolute(rel); };

// Validated model id for an agent: one of its configured models, or any well-formed id when the list is empty (CLI default).
export function checkModel(agent, model) {
  if (!model) return null;
  const models = ctx.config.agents[agent]?.models ?? [];
  if (models.length && !models.includes(model)) throw new Error(tr('msg.board.noModel', { agent, model, models: models.join(', ') }));
  if (!/^[\w.:\-[\]=,]{1,80}$/.test(model)) throw new Error(tr('msg.board.badModelId', { model }));
  return model;
}

// Projects live in the categories of the assistant's folder (each subfolder of windows, ios, android or web is one). Agents (MCP) may only register folders there or in the
// extra roots of the settings; the user can also link any outside folder from the app (fromUser). Never a drive root, the
// assistant's folder itself, its own folders (.orb, bitacora, mcp-servers), a category folder itself (inside the assistant's
// folder a project is always <category>\<project>) or a folder that contains the assistant's.
export function checkProjectPath(target, { fromUser = false } = {}) {
  let r; try { r = fs.realpathSync(target); } catch { throw new Error(tr('msg.board.pathMissing', { target })); }
  if (!fs.statSync(r).isDirectory()) throw new Error(tr('msg.board.pathNotFolder', { target }));
  if (path.parse(r).root.toLowerCase() === r.toLowerCase()) throw new Error(tr('msg.board.driveRoot'));
  const home = real(ctx.home);
  if (same(r, home)) throw new Error(tr('msg.board.isHome', { name: assistantName() }));
  if (inside(r, home)) throw new Error(tr('msg.board.containsHome', { name: assistantName() }));
  if (inside(home, r)) {
    const first = path.relative(home, r).split(path.sep)[0];
    if (isConfigName(first)) throw new Error(tr('msg.board.internalFolder', { name: assistantName(), first }));
    if (!categoryOf(home, r)) throw new Error(tr('msg.board.notInCategory', { name: assistantName(), list: CATEGORIES.join(', '), target }));
  } else if (!fromUser) {
    const roots = [home, ...(ctx.config.projectRoots ?? []).map(real)];
    if (!roots.some((root) => inside(root, r))) throw new Error(`la ruta está fuera de la carpeta de ${assistantName()} (${home}): ${target}. ${userName()} puede vincularla desde la app.`);
  }
  return r;
}

export class Board {
  // approvalKey: HMAC key that signs approvals (only the app's user actions sign; the scheduler verifies).
  // noKey: processes that must never hold the secret (the MCP server): approvals cannot be verified there, so sensitive
  // tasks count as not approved and nothing is re-checked.
  constructor(db = openDb(), { approvalKey, noKey = false } = {}) { this.db = db; this._key = approvalKey ?? null; this.noKey = noKey; this.listeners = new Set(); }
  get key() { if (this.noKey) return null; return this._key ??= defaultApprovalKey(); }

  // The engine listens to push changes to the window; MCP processes have no listeners (the engine polls the database).
  onChange(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  changed(what) { for (const fn of this.listeners) { try { fn(what); } catch { /* a listener must never break a write */ } } }

  all(sql, ...params) { return this.db.prepare(sql).all(...params); }
  one(sql, ...params) { return this.db.prepare(sql).get(...params); }
  run(sql, ...params) { return this.db.prepare(sql).run(...params); }

  transaction(fn) {
    this.db.exec('BEGIN IMMEDIATE');
    try { const out = fn(); this.db.exec('COMMIT'); return out; } catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }

  setting(key, value) {
    if (value === undefined) return this.one('SELECT value FROM settings WHERE key = ?', key)?.value;
    this.run('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', key, String(value));
  }
  settingJson(key, value) {
    if (value === undefined) { try { return JSON.parse(this.setting(key) || 'null'); } catch { return null; } }
    this.setting(key, value === null ? '' : JSON.stringify(value));
  }

  event(taskId, actor, kind, detail = '') {
    this.run('INSERT INTO events (task_id, actor, kind, detail, at) VALUES (?, ?, ?, ?, ?)', taskId ?? null, String(actor), kind, String(detail).slice(0, 4000), now());
    this.changed('events');
  }

  // ---- projects
  // Agents (MCP) can only create projects; moving one to another folder is a user action (fromUser).
  addProject({ name, path: folder, notes = '' }, actor, { fromUser = false } = {}) {
    name = oneLine(name, 60);
    if (!name || !folder) throw new Error('name y path son obligatorios');
    const existing = this.project(name);
    if (existing && !same(existing.path, folder) && !fromUser) throw new Error(`el proyecto «${existing.name}» ya existe en otra carpeta: cambiar su ruta solo se puede desde la app`);
    const checked = existing && same(existing.path, folder) ? existing.path : checkProjectPath(folder, { fromUser });
    // One folder, one project: the same folder under another name is the project that already exists.
    const twin = !existing && this.projects().find((p) => same(p.path, checked));
    if (twin) return twin;
    this.run(`INSERT INTO projects (name, path, notes, created_at) VALUES (?, ?, ?, ?)
              ON CONFLICT(name) DO UPDATE SET path = excluded.path, notes = excluded.notes`, name, checked, String(notes ?? '').slice(0, 2000), now());
    this.ensureProjectLog(name);
    this.event(null, actor, 'project.saved', `${name} -> ${checked}`);
    this.changed('projects');
    return this.project(name);
  }
  project(name) { return this.one('SELECT * FROM projects WHERE name = ?', String(name ?? '')); }
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
    if (!fs.existsSync(file)) { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, projectLogHeader(name)); }
    return file;
  }

  // Working folder of the session ("today we work on X"): every new task goes there.
  activeProject() { const name = this.setting('active_project'); return name ? this.project(name) ?? null : null; }
  setActiveProject(name, actor) {
    if (!name) { this.setting('active_project', ''); this.event(null, actor, 'project.active', 'ninguno'); this.changed('projects'); return null; }
    const project = this.project(name); if (!project) throw new Error(`proyecto desconocido "${name}": regístralo antes con orb_add_project`);
    this.setting('active_project', project.name);
    this.event(null, actor, 'project.active', `${project.name} -> ${project.path}`);
    this.addChat('system', tr('msg.board.activeFolder', { name: project.name, path: project.path }));
    this.changed('projects');
    return project;
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
      events: this.all('SELECT actor, kind, detail, at FROM events WHERE task_id = ? ORDER BY id DESC LIMIT 300', task.id).reverse(),
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
  createTask({ project, title, description, agent = 'any', account = null, model = null, reasoning, fast, launch = 'auto', priority = 2, depends_on = [], sensitivity = [], mode = 'carpeta', readonly = false, parent_id = null, review_of = null, schedule_id = null }, actor) {
    if (!MODES.includes(mode)) throw new Error('mode debe ser carpeta o aislada');
    const proj = this.project(project);
    if (!proj) throw new Error(`proyecto desconocido "${project}": regístralo antes con orb_add_project`);
    const active = this.activeProject();
    if (active && proj.name !== active.name && actor !== 'usuario') throw new Error(`hoy se trabaja en ${active.name} (${active.path}): no se crean tareas en otra carpeta. Si ${userName()} quiere cambiar, usa antes orb_set_project.`);
    if (!title || !description) throw new Error('title y description son obligatorios');
    title = oneLine(title);
    if (String(description).length > MAX_DESCRIPTION) throw new Error(`description demasiado larga (${String(description).length} caracteres, máximo ${MAX_DESCRIPTION}): resume o apunta a un archivo`);
    if (agent !== 'any' && !AGENTS.includes(agent)) throw new Error(`agente no válido: ${agent} (usa ${AGENTS.join(', ')} o any)`);
    if (model && agent === 'any') throw new Error('para elegir modelo, elige también el agente');
    model = agent === 'any' ? null : checkModel(agent, model);
    // An account chosen on purpose: it must belong to the task's agent.
    if (account && !(ctx.config.accounts ?? []).some((a) => a.id === account && (agent === 'any' || a.agent === agent))) throw new Error(`la cuenta ${account} no es de ${agent}`);
    if (account && agent === 'any') agent = (ctx.config.accounts ?? []).find((a) => a.id === account).agent;
    if (!['auto', 'manual'].includes(launch)) throw new Error('launch debe ser auto o manual');
    if (!Array.isArray(depends_on) || depends_on.length > 20) throw new Error('depends_on: como mucho 20 tareas');
    for (const dep of depends_on) if (!this.task(dep)) throw new Error(`depends_on: no existe la tarea #${dep}`);
    if (!Array.isArray(sensitivity)) throw new Error('sensitivity debe ser una lista');
    const unknown = sensitivity.filter((s) => !ctx.config.sensitive.includes(s));
    if (unknown.length) throw new Error(`sensitivity no válida: ${unknown.join(', ')}`);
    ({ reasoning, fast } = taskOptions({ reasoning, fast }));
    const policy = checkPolicy({ agent, model, reasoning, fast });
    // Approval does not depend on the creator declaring it: a task made by a worker always waits for the user,
    // and a keyword net adds the tags the creator forgot.
    const tags = [...new Set(sensitivity)]; const reasons = [];
    if (!tags.length) { const found = detectSensitivity(`${title}\n${description}`); tags.push(...found); if (found.length) reasons.push(tr('msg.board.reasonKeywords', { words: found.join(', ') })); }
    if (policy.approval) { tags.push('razonamiento_alto'); reasons.push(tr('msg.board.reasonHighReasoning', { who: model ?? agent })); }
    // A subtask an agent delegates from its own task (orb_delegate) goes straight to the queue when the user trusts
    // delegation, the parent task came from the assistant or the user, nothing looks risky and the parent has not used
    // its quota of subtasks. Anything else made by an agent waits for the user, as always.
    const parent = parent_id ? this.task(parent_id) : null;
    const d = ctx.config.delegation ?? {};
    const trusted = parent && d.enabled !== false && d.trusted !== false && !tags.length && ['orb', 'usuario'].includes(parent.created_by)
      && this.one('SELECT COUNT(*) AS n FROM tasks WHERE parent_id = ?', parent.id).n < (d.maxPerTask ?? 4);
    if (actor !== 'orb' && actor !== 'usuario' && !trusted) { tags.push('creada_por_agente'); reasons.push(tr('msg.board.reasonByAgent', { actor, name: assistantName() })); }
    const status = tags.length ? 'awaiting_approval' : 'queued';
    const at = now();
    const { lastInsertRowid } = this.run(`INSERT INTO tasks (project, title, description, agent, account, model, reasoning, fast, launch, priority, depends_on, sensitivity, status, created_by, project_path, created_at, updated_at, mode, readonly, parent_id, review_of, schedule_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, proj.name, title, String(description), agent, account || null, model, reasoning, Number(fast), launch, Math.min(Math.max(Number(priority) || 2, 1), 3),
      JSON.stringify(depends_on.map(Number)), JSON.stringify([...new Set(tags)]), status, String(actor), proj.path, at, at, mode, Number(Boolean(readonly)), parent_id ? Number(parent_id) : null, review_of ? Number(review_of) : null, schedule_id ? Number(schedule_id) : null);
    const id = Number(lastInsertRowid);
    this.event(id, actor, 'task.created', status);
    if (status === 'awaiting_approval') { const tagList = [...new Set(tags)].join(', '); this.addChat('system', reasons.length ? tr('msg.board.needsApprovalWhy', { id, title, tags: tagList, reasons: reasons.join('; ') }) : tr('msg.board.needsApproval', { id, title, tags: tagList })); }
    // Even a task the user typed waits for an explicit "Aprobar" when it looks sensitive: one more click, with the reasons on screen.
    this.changed('tasks');
    return this.task(id);
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
      this.addChat('system', tr(moved ? 'msg.board.backToApprovalMoved' : 'msg.board.backToApprovalStale', { id: task.id, title: task.title }));
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
      if (reassigning) throw new Error(`solo ${assistantName()} puede cambiar agente, modelo, reasoning o fast de una tarea`);
      if (task.assigned_to !== actor || task.status !== 'running') throw new Error(`la tarea #${id} no es tuya o no está en curso: solo puedes actualizar tu propia tarea en curso`);
      if (context.taskId !== undefined && context.taskId !== '' && Number(context.taskId) !== task.id) throw new Error(`tu tarea es la #${context.taskId}, no la #${id}`);
      if (status && !WORKER_STATUSES.includes(status)) throw new Error(`un agente solo puede cerrar su tarea con ${WORKER_STATUSES.join(', ')}`);
    } else {
      if (status && !(ORCHESTRATOR_TO[status] ?? []).includes(task.status)) throw new Error(`transición no permitida: ${task.status} → ${status}${task.status === 'running' ? ' (las tareas en curso se cancelan desde la app)' : ''}`);
      if (task.status === 'done' && (result !== undefined || reassigning)) throw new Error('una tarea terminada no se modifica');
    }
    const reassign = {};
    if (reasoning !== undefined || fast !== undefined) {
      if (task.status === 'running') throw new Error('la tarea está en curso: cancélala antes de cambiar reasoning o fast');
      const options = taskOptions({ reasoning: reasoning === undefined ? task.reasoning : reasoning, fast: fast === undefined ? task.fast : fast });
      if (reasoning !== undefined) reassign.reasoning = options.reasoning;
      if (fast !== undefined) reassign.fast = Number(options.fast);
    }
    if (agent !== undefined || model !== undefined) {
      if (task.status === 'running') throw new Error(`la tarea #${id} está en curso: cancélala antes de cambiar agente o modelo`);
      const nextAgent = agent ?? task.agent;
      if (nextAgent !== 'any' && !AGENTS.includes(nextAgent)) throw new Error(tr('msg.board.badAgent', { agent: nextAgent }));
      const nextModel = model === undefined ? (agent !== undefined ? null : task.model) : (model || null);
      if (nextModel && nextAgent === 'any') throw new Error('para elegir modelo, elige también el agente');
      Object.assign(reassign, { agent: nextAgent, model: nextAgent === 'any' ? null : checkModel(nextAgent, nextModel), assigned_to: null });
    }
    if (Object.keys(reassign).length) {
      const after = { agent: reassign.agent ?? task.agent, model: 'model' in reassign ? reassign.model : task.model, reasoning: reassign.reasoning ?? task.reasoning, fast: 'fast' in reassign ? Boolean(reassign.fast) : task.fast };
      if (checkPolicy(after).approval && !task.sensitivity.includes('razonamiento_alto')) reassign.sensitivity = JSON.stringify([...task.sensitivity, 'razonamiento_alto']);
    }
    if (status && !STATUSES.includes(status)) throw new Error(`estado no válido: ${status}`);
    if (status === 'awaiting_approval') throw new Error('solo el sistema pone tareas en espera de aprobación');
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
      const nextModel = nextAgent === 'any' ? null : checkModel(nextAgent, model || null);
      const { reasoning: nextReasoning } = taskOptions({ reasoning: reasoning || task.reasoning, fast: false });
      const policy = checkPolicy({ agent: nextAgent, model: nextModel, reasoning: nextReasoning, fast: false });
      const tags = policy.approval ? [...new Set([...task.sensitivity, 'razonamiento_alto'])] : task.sensitivity.filter((t) => t !== 'razonamiento_alto');
      const fields = { agent: nextAgent, model: nextModel, reasoning: nextReasoning, fast: 0, assigned_to: nextAgent === 'any' ? null : nextAgent, sensitivity: JSON.stringify(tags), ...this.clearApproval() };
      if (['queued', 'awaiting_approval'].includes(task.status)) fields.status = policy.approval ? 'awaiting_approval' : 'queued';
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
  depsDone(task) { return task.depends_on.every((dep) => { const d = this.task(dep); return d?.status === 'done' && d.pid == null; }); }
  failedDeps(task) { return task.depends_on.filter((dep) => ['failed', 'cancelled'].includes(this.task(dep)?.status)); }
  warnBlockedByDeps() {
    for (const task of this.all("SELECT * FROM tasks WHERE status IN ('queued', 'awaiting_approval')").map(parse)) {
      for (const dep of this.failedDeps(task)) {
        const key = `dep_warned:${task.id}:${dep}`;
        if (this.setting(key)) continue;
        this.setting(key, '1');
        this.addChat('system', tr(this.task(dep).status === 'failed' ? 'msg.board.depFailed' : 'msg.board.depCancelled', { id: task.id, title: task.title, dep }));
      }
    }
  }

  readyTasks(launch) {
    return this.all("SELECT * FROM tasks WHERE status = 'queued' AND launch = ? ORDER BY priority ASC, id ASC", launch).map(parse).filter((t) => this.approvalOk(t) && this.depsDone(t));
  }

  claimNext(agent, project) {
    return this.transaction(() => {
      this.revalidateQueued();
      const task = this.readyTasks('manual').find((t) => (t.agent === agent || t.agent === 'any') && (!project || t.project.toLowerCase() === String(project).toLowerCase()));
      if (!task) return null;
      return this.patch(task.id, { status: 'running', assigned_to: agent }, agent, 'task.claimed', 'queued');
    });
  }

  // ---- messages between agents, the assistant and the user
  send({ from, to, body, task_id }) {
    if (!body) throw new Error('body es obligatorio');
    if (![...AGENTS, 'all', 'usuario', 'orb'].includes(to)) throw new Error(`destinatario no válido: ${to} (usa ${AGENTS.join(', ')}, all, usuario o orb)`);
    body = String(body).slice(0, 8000);
    if (to === 'usuario') this.addChat('system', `💬 ${from}${task_id ? tr('msg.board.taskRef', { id: task_id }) : ''}: ${body}`);
    const { lastInsertRowid } = this.run('INSERT INTO messages (from_agent, to_agent, task_id, body, at) VALUES (?, ?, ?, ?, ?)', String(from), to, task_id ?? null, body, now());
    this.changed('messages');
    return { id: Number(lastInsertRowid), from, to, task_id: task_id ?? null };
  }

  inbox(agent, markRead = true) {
    const rows = this.all(`SELECT m.* FROM messages m WHERE (m.to_agent = ? OR m.to_agent = 'all') AND m.from_agent != ?
      AND NOT EXISTS (SELECT 1 FROM message_reads r WHERE r.message_id = m.id AND r.agent = ?) ORDER BY m.id LIMIT 100`, agent, agent, agent);
    if (markRead) for (const m of rows) this.run('INSERT OR IGNORE INTO message_reads (message_id, agent) VALUES (?, ?)', m.id, agent);
    return rows;
  }

  // ---- the assistant's chat and the activity feed
  // meta: extra data of a chat line, e.g. { kind: 'report', tasks: [ids] } for the assistant's report that waits for the user's OK.
  addChat(role, body, meta = null) {
    const { lastInsertRowid } = this.run('INSERT INTO chat (role, body, meta, at) VALUES (?, ?, ?, ?)', role, String(body), meta ? JSON.stringify(meta) : null, now());
    this.changed('chat');
    return { id: Number(lastInsertRowid) };
  }
  // Changes the extra data of a chat message (e.g. an approval card that was answered).
  patchChatMeta(id, meta) { this.run('UPDATE chat SET meta = ? WHERE id = ?', JSON.stringify(meta), Number(id)); this.changed('chat'); }
  chat(limit = 200) {
    return this.all('SELECT * FROM (SELECT * FROM chat ORDER BY id DESC LIMIT ?) ORDER BY id', limit)
      .map((r) => { let meta = null; try { meta = r.meta ? JSON.parse(r.meta) : null; } catch { /* ignore */ } return { ...r, meta }; });
  }

  // ---- the end of the loop: the user gives the OK to finished work
  isAccepted(taskId) { return this.setting(`accepted:${Number(taskId)}`) === '1'; }
  accept(taskIds, actor) {
    const done = [];
    for (const id of taskIds) {
      const task = this.task(id);
      if (!task || task.status !== 'done' || this.isAccepted(id)) continue;
      this.setting(`accepted:${task.id}`, '1');
      this.event(task.id, actor, 'task.accepted', 'OK del usuario');
      done.push(task);
    }
    if (done.length) this.changed('tasks');
    return done;
  }
  recentEvents(limit = 80) {
    return this.all('SELECT e.*, t.title FROM events e LEFT JOIN tasks t ON t.id = e.task_id ORDER BY e.id DESC LIMIT ?', limit);
  }

  summary(agent) {
    const counts = Object.fromEntries(this.all('SELECT status, COUNT(*) AS n FROM tasks GROUP BY status').map((r) => [r.status, r.n]));
    const active = this.all("SELECT * FROM tasks WHERE status NOT IN ('done', 'cancelled') ORDER BY priority, id LIMIT 50").map(parse);
    const project = this.activeProject();
    return {
      paused: this.setting('paused') === '1',
      activeProject: project ? `${project.name} — ${project.path}` : `ninguno (pregunta a ${userName()} en qué proyecto se trabaja)`,
      projectsFolder: ctx.paths.projects,
      categories: CATEGORIES.map((c) => `${c} — ${ctx.paths.categories[c]}`),
      projects: this.projects().map((p) => `${p.name} — ${p.path}`),
      counts,
      active: active.map((t) => ({ id: t.id, project: t.project, title: t.title, agent: t.assigned_to ?? t.agent, launch: t.launch, status: t.status, depends_on: t.depends_on })),
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
