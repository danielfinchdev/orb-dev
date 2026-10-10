// The assistant's brain: every message of the user goes to Claude Code (the user's own subscription) with a coordinator
// persona. It reads (to write precise, compact briefs) and uses the board (MCP); the agents do the work. 2.3: one live
// Claude session stays open between messages (streamed answer, no restart per message) and is renewed when its context
// fills up (the board and the logs keep the state).
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { ctx, tr } from '../core/context.mjs';
import { AGENTS, assistantName, userName, ofUser } from '../core/board.mjs';
import { executable, installed, adapter } from '../agents/index.mjs';
import * as claude from '../agents/claude.mjs';
import { rotateIfBig } from '../core/safety.mjs';
import { mcpServersFor, browserEnv } from './sessions.mjs';
import { account, defaultAccount, accountEnv } from '../core/accounts.mjs';
import { briefing } from './logs.mjs';
import { rememberModels } from './catalog.mjs';
import { AGENT_LABELS } from '../core/home.mjs';

export function persona() {
  const c = ctx.config; const me = assistantName(); const boss = userName();
  const accountsOf = (a) => (c.accounts ?? []).filter((x) => x.agent === a && x.enabled !== false);
  const models = AGENTS.filter((a) => c.agents[a]?.enabled && accountsOf(a).length && installed(a)).map((a) => `- ${a}: ${c.agents[a].strengths}. Modelos: ${(c.agents[a].models ?? []).join(', ') || 'el predeterminado de su programa'}${c.agents[a].heavyModels?.length ? ` (caros: ${c.agents[a].heavyModels.join(', ')})` : ''}.${accountsOf(a).length > 1 ? ` Cuentas: ${accountsOf(a).map((x) => x.label).join(', ')} (el trabajo se reparte solo entre ellas según su cupo).` : ''}`).join('\n');
  return `Eres ${me}, el asistente que coordina a los agentes de IA ${ofUser()}. Hablas en ${c.language === 'en' ? 'inglés' : 'español'}, cercano y breve, sin jerga técnica innecesaria.
EL CICLO: ${boss} te pide algo → tú lo conviertes en tareas y coordinas a los agentes → ellos trabajan → cuando terminan, tú revisas los resultados → informas a ${boss} → ${boss} da el OK (o pide cambios y vuelve a empezar). Nunca des por terminado un pedido sin ese informe.\nTU PAPEL: ${boss} es quien dirige; tú eres su jefe de proyecto. ${boss} habla contigo y tú das encargos claros a los agentes (${AGENTS.join(', ')}), vigilas que cumplan y le informas con lo esencial.
SOLO COORDINAS: no programas, no editas, no ejecutas comandos. El trabajo lo hacen los agentes mediante tareas. Puedes LEER archivos del proyecto (Read, Grep, Glob) para escribir encargos precisos: lee lo justo, no el proyecto entero.
ENCARGOS COMPACTOS (ahorran tokens a todos): rutas exactas, qué cambiar, criterio de terminado y qué no tocar. No copies código ni contexto que el agente puede leer él mismo; no repitas el mismo contexto en varias tareas: una tarea puede depender de otra (depends_on) y recibe su resultado.
Tu trabajo, en este orden:
1. ANALIZA el pedido: qué se quiere de verdad, en qué proyecto y cuándo estará terminado. Si es ambiguo, haz UNA pregunta.
2. ESCRIBE BUENOS ENCARGOS: objetivo, contexto, archivos o zona, pasos, criterio de terminado y qué no tocar. El agente no ve este chat: cada description debe bastar por sí sola.
3. COORDINA: divide en tareas pequeñas, da cada una al agente que mejor la hace y reparte entre proveedores distintos para que trabajen a la vez. Usa depends_on para el orden. Para algo importante, pide un Task Review: una tarea readonly de revisión con un agente y un modelo distintos de los que lo hicieron.
DELEGAR: los agentes también pueden repartirse subtareas (orb_delegate); tú ves el árbol en el tablero.
AGENTES DISPONIBLES:
${models || '- ninguno activado: pide a ' + boss + ' que active uno en la pantalla Agentes.'}
Razonamiento "medium" por defecto. "high" solo para algo muy complicado${c.policy?.highNeedsApproval !== false ? ` (esa tarea espera la aprobación ${ofUser()}; díselo)` : ''}.
AHORRO: cada suscripción tiene cupo y ${me} limita las tareas por agente cada ${c.budget?.windowHours ?? 5} h. Si un pedido necesita más de 3 tareas, propón el plan (tarea → agente) y espera el "sí". Si una tarea espera por cupo o falla por límite, no la dupliques: propón otro agente. No vigiles el tablero en bucle.
PROYECTOS: cada proyecto vive en una categoría de ${ctx.paths.projects}: windows, ios, android o web (por defecto web). Los nuevos se crean con orb_create_project indicando category (carpeta propia, con git). Las carpetas bitacora y mcp-servers son la configuración de ${me}: no son proyectos y no se tocan. Fija el proyecto de trabajo con orb_set_project; todas las tareas van ahí. Si no hay proyecto fijado y el pedido toca código, pregunta cuál.
DÓNDE TRABAJAN: por defecto cada tarea trabaja en la carpeta del proyecto (mode "carpeta"), por turnos y con una foto previa que ${boss} puede deshacer con un botón. Marca readonly:true las que solo leen. Usa mode "aislada" (rama y copia propias) solo para experimentos o trabajo en paralelo; si a una aislada le falta algo, orb_give_files.
CAMBIAR MODELO: orb_update_task (agent, model, reasoning) en una tarea que no está en curso; no se rehace.
CONVERSACIONES DIRECTAS: ${boss} también puede hablar directamente con un agente en la pestaña Conversaciones; tú te encargas de los encargos coordinados.
AVISOS DEL SISTEMA: si un mensaje empieza por "AVISO DEL SISTEMA", no es ${boss}: resuélvelo con las herramientas y cuéntaselo en 1-2 líneas.
BITÁCORAS (tu memoria): lee con orb_read_log (project = proyecto o "general") al empezar en un proyecto, cuando pregunten cómo va algo y antes de planificar. Escribe con orb_write_log (solo añade): decisiones y preferencias ${ofUser()}, el plan acordado y, al terminar un pedido, un resumen en la del proyecto y una línea en la general. Los agentes no escriben bitácoras: lo haces tú (y ${me} anota cada tarea terminada).
PUBLICAR: nunca hagas push, pull requests ni publiques nada. Si ${boss} lo pide, dile que lo haga con el botón de GitHub de la tarea o del proyecto.
Al crear tareas, responde en 2-4 líneas qué hará cada agente. Nunca muestres claves ni contraseñas.`;
}

// Free mode (the "Orquestador" box unticked): the assistant works directly, like a normal coding assistant, in the project
// folder; it can still hand work to the agents. The same safety limits as a task apply (no push, curl, mass deletion).
export function freePersona(cwd) {
  const me = assistantName(); const boss = userName();
  return `Eres ${me}, el asistente ${ofUser()}. Hablas en ${ctx.config.language === 'en' ? 'inglés' : 'español'}, cercano y claro.
MODO LIBRE: ${boss} ha desactivado el modo «solo orquestador». Puedes leer y buscar en los archivos, ejecutar comandos, editar y crear archivos y consultar la web para resolver lo que te pida directamente. Trabajas en ${cwd}.
Sigues teniendo el tablero (orb_*): si algo es largo o conviene repartirlo entre agentes (Claude, Codex, Cursor), crea tareas como coordinador.
LÍMITES: no hagas push ni publiques, no envíes nada a terceros, no borres archivos en masa y no muestres claves ni contraseñas. Si te lo piden, explica que eso se hace con los botones de GitHub de la app.
BITÁCORAS: anota con orb_write_log las decisiones importantes y lo que cambies (en la del proyecto).
Antes de cambiar algo grande, di en una línea qué vas a hacer.`;
}
const FREE_TOOLS = ['mcp__orb', 'Read', 'Glob', 'Grep', 'Edit', 'Write', 'NotebookEdit', 'Bash', 'WebFetch', 'WebSearch', 'TodoWrite'];

const STOP_GRACE_MS = 10_000; // how long a stopped turn may take to wind down before its process is closed

export class Orchestrator {
  // key: secret handed only to this chat's MCP process (in memory, through the SDK) so the MCP recognises the coordinator.
  constructor(board, key, { emit = () => {}, log = () => {} } = {}) {
    this.board = board; this.key = key; this.emit = emit; this.log = log;
    this.queue = []; this.busy = false; this.partial = ''; this.tools = []; this.generation = 0; this.inflight = null;
    this.live = null; this.liveKey = ''; this.approvals = new Map(); // request id -> chat message id
  }

  get logFile() { return path.join(ctx.paths.runs, 'asistente.log'); }
  state() { return { busy: this.busy, partial: this.partial, tools: this.tools, queued: this.queue.length, context: this.board.settingJson('orchestrator_context') }; }
  push() { this.emit('chat:state', this.state()); }

  info() {
    const o = ctx.config.orchestrator ?? {};
    const agent = o.agent || 'claude';
    // 2.6: the brain can be any agent: its model's label comes from the assistant's list (Claude) or what the agent reported.
    const model = [...(agent === 'claude' ? o.models ?? [] : []), ...(this.board.settingJson(`models:${agent}`) ?? [])].find((m) => m.id === o.model);
    return { agent, agentLabel: AGENT_LABELS[agent] ?? agent, account: o.account || agent, model: o.model, modelLabel: model?.label ?? (o.model || tr('msg.orch.defaultModel')), models: o.models ?? [], reasoning: o.reasoning ?? 'medium', orchestrate: o.orchestrate !== false, turns: Number(this.board.setting('orchestrator_session') ? this.board.setting('orchestrator_turns') ?? 0 : 0), maxTurns: o.maxTurns ?? 60, context: this.board.settingJson('orchestrator_context') };
  }

  ask(text, context = '') {
    text = String(text ?? '').trim();
    if (!text) throw new Error(tr('msg.orch.writeMessage'));
    if (text.length > 20000) throw new Error(tr('msg.orch.tooLong'));
    this.board.addChat('usuario', text);
    // While it answers, a new message corrects it on the fly (it reads it at its next step) instead of waiting.
    if (this.busy && this.live?.steer({ text: text + context })) return;
    this.queue.push({ text: text + context });
    this.next();
  }

  // A notice from the engine (a task got blocked…): handled as a request, without a user message in the chat.
  // meta goes with the answer (e.g. the report that waits for the user's OK).
  internal(text, chatLine, meta = null) {
    if (chatLine) this.board.addChat('system', chatLine);
    this.queue.push({ text, meta, internal: true });
    this.next();
  }

  closeLive() { try { this.live?.close(); } catch { /* gone */ } this.live = null; this.liveKey = ''; }

  forget() {
    this.closeLive();
    this.board.setting('orchestrator_session', ''); this.board.setting('orchestrator_turns', '0'); this.board.settingJson('orchestrator_context', null);
  }

  reset() {
    this.generation++;
    this.queue = [];
    this.forget();
    this.board.addChat('system', tr('msg.orch.newConversation', { name: assistantName() }));
    this.busy = false; this.partial = ''; this.tools = []; this.push();
  }

  // The chat is free at once, but the agent's turn takes a moment to wind down: a new message waits for it in next()
  // (sending it now would find the agent still busy). A turn that does not end goes with its process (resume keeps the
  // conversation).
  stop() {
    if (!this.busy) return;
    // What the user had queued goes; the engine's own notices (the report of finished tasks…) still come after.
    this.generation++; this.queue = this.queue.filter((q) => q.internal);
    const live = this.live; const stopped = this.inflight;
    Promise.resolve(live?.interrupt()).catch(() => {});
    if (stopped) setTimeout(() => { if (this.inflight === stopped && this.live === live) this.closeLive(); }, STOP_GRACE_MS).unref?.();
    this.busy = false; this.partial = ''; this.tools = []; this.board.addChat('system', tr('msg.orch.stopped')); this.push();
  }

  // Free mode: the answer to an approval card in the chat (a risky command the assistant wants to run).
  respond(requestId, decision) {
    if (!this.live?.respond(requestId, decision)) throw new Error(tr('msg.orch.requestGone'));
    return true;
  }

  next() {
    if (this.busy || this.inflight || !this.queue.length) return;
    this.busy = true; this.partial = ''; this.tools = []; this.push();
    const { text, meta } = this.queue.shift();
    const generation = this.generation;
    const run = this.run(text, true, meta).catch((error) => {
      this.log(`asistente: ${error.stack}`);
      if (generation !== this.generation) return; // stopped or reset meanwhile: nothing to report
      this.board.addChat('system', tr('msg.orch.cannotAnswer', { message: error.message }));
      this.busy = false; this.push();
    }).finally(() => { if (this.inflight === run) this.inflight = null; this.next(); });
    this.inflight = run;
  }

  // The live Claude session of the assistant, created on demand; a different mode (coordinate / free), project, model or
  // account starts a new process (the conversation itself continues with resume).
  ensureLive() {
    const o = ctx.config.orchestrator ?? {};
    const active = this.board.activeProject();
    // Free mode works inside the working project only: never in the assistant's own folder (database, secret, logs).
    const free = o.orchestrate === false && Boolean(active?.path && fs.existsSync(active.path));
    if (o.orchestrate === false && !free && !this.warnedFree) { this.warnedFree = true; this.board.addChat('system', tr('msg.orch.freeNeedsProject')); }
    if (free) this.warnedFree = false;
    const cwd = free ? active.path : ctx.paths.runs;
    // 2.6: the brain is any installed agent (Claude by default), on one of its accounts.
    const agent = o.agent || 'claude';
    const chosen = account(o.account);
    const acc = (chosen?.agent === agent ? chosen : null) ?? defaultAccount(agent) ?? { id: agent, agent };
    const key = [agent, free ? 'libre' : 'coordina', cwd, o.model, o.reasoning, acc.id].join('|');
    if (this.live && this.liveKey === key && !this.live.isClosed()) return { free, cwd };
    this.closeLive();
    const session = this.board.setting('orchestrator_session');
    const dirs = [...Object.values(ctx.paths.categories), ...(ctx.config.projectRoots ?? []), ...this.board.projects().map((p) => p.path)].filter((d) => { try { return fs.statSync(d).isDirectory(); } catch { return false; } });
    fs.mkdirSync(ctx.paths.runs, { recursive: true });
    rotateIfBig(this.logFile);
    const writeLog = (line) => { try { fs.appendFileSync(this.logFile, `${String(line).replace(/\r?\n/g, ' ')}\n`); } catch { /* log unavailable */ } };
    // Claude keeps the conversation id Orb gives it; the other agents report theirs (event 'session').
    const newId = session || agent !== 'claude' ? null : crypto.randomUUID();
    if (newId) this.board.setting('orchestrator_session', newId);
    if (!session) this.board.setting('orchestrator_turns', '0');
    // Through the registry (not claude.mjs directly), so ORB_FAKE_AGENTS also replaces the assistant's own Claude in tests.
    // Claude takes the persona as its system prompt and a list of tools; the other agents get the persona at the start
    // of the conversation (run()) and the coordinator is held to read-only by its permission.
    const isClaude = agent === 'claude';
    this.liveAgent = agent;
    this.live = adapter(agent).createLive({
      exe: executable(agent), cwd, model: o.model || (isClaude ? 'claude-sonnet-5-5' : null), reasoning: o.reasoning || 'medium',
      permission: free ? 'editar' : 'leer', resumeId: session || null, newSessionId: isClaude ? newId : null,
      mcpServers: mcpServersFor(agent, { board: this.board, orchestrator: true, browser: free, session: 'asistente', orchKey: this.key }),
      env: { ...accountEnv(acc), ORB_HOME: ctx.home, ORB_AGENT: 'orb', ...(free ? browserEnv('orb', 'asistente') : {}) },
      ...(isClaude ? { systemPrompt: free ? freePersona(cwd) : persona() } : {}),
      tools: !isClaude ? undefined : free ? { disallowed: ['Task'] } : { allowed: ['mcp__orb', 'Read', 'Glob', 'Grep'], disallowed: claude.COORDINATOR_DENIED },
      addDirs: [...new Set(dirs)].filter((d) => d !== cwd).slice(0, 40), internalDir: ctx.paths.internal, lang: ctx.config.language, log: writeLog,
      onEvent: (ev) => this.onEvent(ev)
    });
    this.liveKey = key;
    return { free, cwd };
  }

  onEvent(ev) {
    if (ev.type === 'delta') { this.partial += ev.text; this.push(); return; }
    if (ev.type === 'item' && ev.kind === 'tool') { this.tools.push(String(ev.body?.name ?? '').replace(/^orb:/, '')); this.push(); return; }
    if (ev.type === 'item' && ev.role === 'assistant' && ev.kind === 'text') { this.partial = ''; return; }
    if (ev.type === 'session' && ev.id) { this.board.setting('orchestrator_session', ev.id); return; }
    if (ev.type === 'models') { rememberModels(this.board, this.liveAgent, ev.list); return; }
    if (ev.type === 'context' && ev.size) { this.board.settingJson('orchestrator_context', { used: ev.used, size: ev.size }); this.push(); return; }
    if (ev.type === 'approval') {
      const r = ev.request;
      const msg = this.board.addChat('system', tr('msg.orch.wantsToRun', { name: assistantName(), title: r.title, reason: r.reason }), { kind: 'approval', id: r.id, status: 'pending' });
      this.approvals.set(r.id, msg?.id ?? null);
      return;
    }
    if (ev.type === 'approval_done') {
      const msgId = this.approvals.get(ev.id); this.approvals.delete(ev.id);
      if (msgId) this.board.patchChatMeta(msgId, { kind: 'approval', id: ev.id, status: ev.decision === 'deny' ? 'denied' : 'allowed' });
      return;
    }
    // Only the process that ended is dropped: a replaced live's late exit must not detach the one in use.
    if (ev.type === 'exit' && !this.busy && this.live?.isClosed()) this.live = null;
  }

  async run(text, allowRetry, meta = null) {
    const o = ctx.config.orchestrator ?? {};
    const turns = Number(this.board.setting('orchestrator_turns') ?? 0);
    const c = this.board.settingJson('orchestrator_context');
    // Renewed when its context is filling up (or after many turns): cheaper than dragging a long conversation along.
    if (this.board.setting('orchestrator_session') && ((c?.size && c.used / c.size >= (o.renewAt ?? 0.6)) || turns >= (o.maxTurns ?? 60))) {
      this.forget();
      this.board.addChat('system', tr('msg.orch.renewed'));
    }
    const fresh = !this.board.setting('orchestrator_session');
    let place;
    try { place = this.ensureLive(); } catch (error) {
      const agent = o.agent || 'claude';
      this.board.addChat('system', tr('msg.orch.needsAgent', { name: assistantName(), agent: AGENT_LABELS[agent] ?? agent, message: error.message }));
      this.busy = false; this.push(); return;
    }
    // A brain other than Claude gets its instructions at the start of the conversation (Claude has them as system prompt).
    const intro = fresh && (o.agent || 'claude') !== 'claude' ? `${place.free ? freePersona(place.cwd) : persona()}\n\n` : '';
    const prompt = fresh ? `${intro}${briefing(this.board)}\n\n## Mensaje ${ofUser()}\n${text}` : text;
    this.board.setting('orchestrator_turns', String(Number(this.board.setting('orchestrator_turns') ?? 0) + 1));
    const generation = this.generation;
    const free = (ctx.config.orchestrator ?? {}).orchestrate === false;
    const timer = setTimeout(() => { this.board.addChat('system', tr('msg.orch.timeLimit')); Promise.resolve(this.live?.interrupt()).catch(() => {}); }, free ? (ctx.config.timeoutMinutes ?? 60) * 60_000 : 10 * 60_000);
    const live = this.live;
    let result;
    try { result = await live.send({ text: prompt }); } finally { clearTimeout(timer); }
    if (generation !== this.generation) return; // reset or stop: nothing to publish
    // A stale conversation id fails before any answer: forget it and try once more with a fresh conversation.
    if (result.isError && allowRetry && !result.text && !fresh) { this.forget(); return this.run(text, false, meta); }
    const answer = (result.final || result.text || '').trim();
    const ok = !result.isError;
    this.board.addChat(ok ? 'orb' : 'system', answer || tr('msg.orch.cannotAnswerCheck', { logFile: this.logFile }), ok ? meta : null);
    this.busy = false; this.partial = ''; this.tools = []; this.push();
  }
}
