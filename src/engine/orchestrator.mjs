// The assistant's brain: every message of the user goes to Claude Code (the user's own subscription) with a coordinator
// persona. It can only read file names and use the board (MCP); the agents do the work. The conversation continues with
// --resume and is renewed every few turns (the board and the logs keep the state).
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { ctx } from '../core/context.mjs';
import { AGENTS, assistantName, userName, ofUser } from '../core/board.mjs';
import { executable } from '../agents/index.mjs';
import * as claude from '../agents/claude.mjs';
import { cleanEnv, killTree } from '../agents/common.mjs';
import { rotateIfBig } from '../core/safety.mjs';
import { mcpServersFor, browserEnv } from './sessions.mjs';
import { account, defaultAccount, accountEnv } from '../core/accounts.mjs';
import { briefing } from './logs.mjs';

export function persona() {
  const c = ctx.config; const me = assistantName(); const boss = userName();
  const accountsOf = (a) => (c.accounts ?? []).filter((x) => x.agent === a && x.enabled !== false);
  const models = AGENTS.filter((a) => c.agents[a]?.enabled && accountsOf(a).length).map((a) => `- ${a}: ${c.agents[a].strengths}. Modelos: ${(c.agents[a].models ?? []).join(', ') || 'el predeterminado de su programa'}${c.agents[a].heavyModels?.length ? ` (caros: ${c.agents[a].heavyModels.join(', ')})` : ''}.${accountsOf(a).length > 1 ? ` Cuentas: ${accountsOf(a).map((x) => x.label).join(', ')} (el trabajo se reparte solo entre ellas según su cupo).` : ''}`).join('\n');
  return `Eres ${me}, el asistente que coordina a los agentes de IA ${ofUser()}. Hablas en ${c.language === 'en' ? 'inglés' : 'español'}, cercano y breve, sin jerga técnica innecesaria.
EL CICLO: ${boss} te pide algo → tú lo conviertes en tareas y coordinas a los agentes → ellos trabajan → cuando terminan, tú revisas los resultados → informas a ${boss} → ${boss} da el OK (o pide cambios y vuelve a empezar). Nunca des por terminado un pedido sin ese informe.\nTU PAPEL: ${boss} es quien dirige; tú eres su jefe de proyecto. ${boss} habla contigo y tú das encargos claros a los agentes (${AGENTS.join(', ')}), vigilas que cumplan y le informas con lo esencial.
SOLO COORDINAS: no programas, no editas, no ejecutas comandos. El trabajo lo hacen los agentes mediante tareas.
Tu trabajo, en este orden:
1. ANALIZA el pedido: qué se quiere de verdad, en qué proyecto y cuándo estará terminado. Si es ambiguo, haz UNA pregunta.
2. ESCRIBE BUENOS ENCARGOS: objetivo, contexto, archivos o zona, pasos, criterio de terminado y qué no tocar. El agente no ve este chat: cada description debe bastar por sí sola.
3. COORDINA: divide en tareas pequeñas, da cada una al agente que mejor la hace y usa depends_on para el orden. Para algo importante, añade una tarea de revisión (readonly) con un agente distinto al que lo hizo.
AGENTES DISPONIBLES:
${models || '- ninguno activado: pide a ' + boss + ' que active uno en la pantalla Agentes.'}
Razonamiento "medium" por defecto. "high" solo para algo muy complicado${c.policy?.highNeedsApproval !== false ? ` (esa tarea espera la aprobación ${ofUser()}; díselo)` : ''}.
AHORRO: cada suscripción tiene cupo y ${me} limita las tareas por agente cada ${c.budget?.windowHours ?? 5} h. Si un pedido necesita más de 3 tareas, propón el plan (tarea → agente) y espera el "sí". Si una tarea espera por cupo o falla por límite, no la dupliques: propón otro agente. No vigiles el tablero en bucle.
PROYECTOS: los proyectos nuevos se crean con orb_create_project (carpeta propia dentro de ${ctx.paths.projects}, con git). Fija el proyecto de trabajo con orb_set_project; todas las tareas van ahí. Si no hay proyecto fijado y el pedido toca código, pregunta cuál.
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

export class Orchestrator {
  // key: secret handed only to this chat process (through its environment) so the MCP recognises it as the coordinator.
  constructor(board, key, { emit = () => {}, log = () => {} } = {}) {
    this.board = board; this.key = key; this.emit = emit; this.log = log;
    this.queue = []; this.busy = false; this.partial = ''; this.tools = []; this.child = null; this.generation = 0;
  }

  get logFile() { return path.join(ctx.paths.runs, 'asistente.log'); }
  state() { return { busy: this.busy, partial: this.partial, tools: this.tools, queued: this.queue.length }; }
  push() { this.emit('chat:state', this.state()); }

  info() {
    const o = ctx.config.orchestrator ?? {};
    const model = (o.models ?? []).find((m) => m.id === o.model);
    return { model: o.model, modelLabel: model?.label ?? o.model, models: o.models ?? [], reasoning: o.reasoning ?? 'medium', orchestrate: o.orchestrate !== false, turns: Number(this.board.setting('orchestrator_session') ? this.board.setting('orchestrator_turns') ?? 0 : 0), maxTurns: o.maxTurns ?? 20 };
  }

  ask(text) {
    text = String(text ?? '').trim();
    if (!text) throw new Error('escribe un mensaje');
    if (text.length > 20000) throw new Error('mensaje demasiado largo (máximo 20 000 caracteres)');
    this.board.addChat('usuario', text);
    this.queue.push({ text });
    this.next();
  }

  // A notice from the engine (a task got blocked…): handled as a request, without a user message in the chat.
  // meta goes with the answer (e.g. the report that waits for the user's OK).
  internal(text, chatLine, meta = null) {
    if (chatLine) this.board.addChat('system', chatLine);
    this.queue.push({ text, meta });
    this.next();
  }

  reset() {
    this.generation++;
    killTree(this.child);
    this.queue = [];
    this.board.setting('orchestrator_session', ''); this.board.setting('orchestrator_turns', '0');
    this.board.addChat('system', `Nueva conversación. ${assistantName()} ya no recuerda lo anterior, pero el tablero y las bitácoras siguen igual.`);
    this.busy = false; this.partial = ''; this.tools = []; this.push();
  }

  stop() { if (this.child) { this.generation++; killTree(this.child); this.queue = []; this.busy = false; this.partial = ''; this.tools = []; this.board.addChat('system', 'Detenido.'); this.push(); } }

  next() {
    if (this.busy || !this.queue.length) return;
    this.busy = true; this.partial = ''; this.tools = []; this.push();
    const { text, meta } = this.queue.shift();
    this.run(text, true, meta);
  }

  run(text, allowRetry, meta = null) {
    const o = ctx.config.orchestrator ?? {};
    let session = this.board.setting('orchestrator_session');
    const turns = Number(this.board.setting('orchestrator_turns') ?? 0);
    if (session && turns >= (o.maxTurns ?? 20)) {
      session = ''; this.board.setting('orchestrator_session', ''); this.board.setting('orchestrator_turns', '0');
      this.board.addChat('system', '♻️ Conversación renovada para no gastar de más (el tablero y las bitácoras siguen igual).');
    }
    this.board.setting('orchestrator_turns', String((session ? turns : 0) + 1));
    if (!session) text = `${briefing(this.board)}\n\n## Mensaje ${ofUser()}\n${text}`;
    let exe;
    try { exe = executable('claude'); } catch (error) {
      this.board.addChat('system', `${assistantName()} necesita Claude Code para pensar: ${error.message}`);
      this.busy = false; this.push(); return this.next();
    }
    const generation = this.generation;
    fs.mkdirSync(ctx.paths.runs, { recursive: true });
    rotateIfBig(this.logFile);
    const id = session || crypto.randomUUID();
    if (!session) this.board.setting('orchestrator_session', id);
    const dirs = [ctx.paths.projects, ...(ctx.config.projectRoots ?? []), ...this.board.projects().map((p) => p.path)].filter((d) => { try { return fs.statSync(d).isDirectory(); } catch { return false; } });
    const active = this.board.activeProject();
    // Free mode works inside the working project only: never in the assistant's own folder (database, secret, logs).
    const free = o.orchestrate === false && Boolean(active?.path && fs.existsSync(active.path));
    if (o.orchestrate === false && !free) this.board.addChat('system', '🛠️ El modo libre necesita un proyecto de trabajo: mientras no elijas uno, solo coordino.');
    const cwd = free ? active.path : ctx.paths.runs;
    // The browser only when it works by itself (free mode); coordinating, it hands the browsing to the agents.
    const mcpFile = claude.writeMcpConfig(path.join(ctx.paths.runs, 'asistente-mcp.json'), mcpServersFor('claude', { orchestrator: true, browser: free, session: 'asistente' }));
    const tools = free
      ? { permissionMode: 'acceptEdits', allowed: FREE_TOOLS, disallowed: claude.DENIED, systemPrompt: freePersona(cwd), addDirs: [...new Set(dirs)].filter((d) => d !== cwd && d !== ctx.paths.projects).slice(0, 40) }
      : { allowed: ['mcp__orb', 'Glob'], disallowed: ['Bash', 'Edit', 'Write', 'NotebookEdit', 'Read', 'Grep', 'WebFetch', 'WebSearch', 'Task', 'Skill'], systemPrompt: persona(), addDirs: [...new Set(dirs)].slice(0, 40) };
    const cmd = claude.buildTurn({ exe, prompt: text, model: o.model || 'claude-sonnet-5-5', reasoning: o.reasoning || 'medium', session: { id, resume: Boolean(session) }, mcpFile, tools });
    const log = fs.openSync(this.logFile, 'a');
    let child;
    try { child = spawn(cmd.cmd, cmd.args, { cwd, env: cleanEnv({ ...accountEnv(account(o.account) ?? defaultAccount('claude') ?? { agent: 'claude' }), ORB_HOME: ctx.home, ORB_AGENT: 'orb', ORB_ORCH_KEY: this.key, ...(free ? browserEnv('orb', 'asistente') : {}) }), windowsHide: true, stdio: ['pipe', 'pipe', log] }); }
    catch (error) { fs.closeSync(log); this.board.addChat('system', `No pude arrancar Claude Code: ${error.message}`); this.busy = false; this.push(); return this.next(); }
    this.child = child;
    const parser = claude.createParser();
    let buffer = '';
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
      buffer += chunk;
      let nl;
      while ((nl = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, nl).trim(); buffer = buffer.slice(nl + 1);
        if (!line) continue;
        for (const item of parser.push(line)) {
          if (item.kind === 'text' && item.role === 'assistant') this.partial = parser.state.text;
          if (item.kind === 'tool') this.tools.push(String(item.body.name).replace(/^orb:/, ''));
        }
        if (generation === this.generation) this.push();
      }
    });
    child.stdin.on('error', () => {});
    child.stdin.end(text);
    // Coordinating is quick; free mode may run commands and edit for a while (same limit as a task).
    const timer = setTimeout(() => { this.board.addChat('system', 'Tiempo máximo alcanzado: me detengo.'); killTree(child); }, free ? (ctx.config.timeoutMinutes ?? 60) * 60_000 : 10 * 60_000);
    let finished = false;
    const done = (code) => {
      if (finished) return; finished = true;
      clearTimeout(timer); try { fs.closeSync(log); } catch { /* closed */ }
      if (this.child === child) this.child = null;
      if (generation !== this.generation) return; // reset or stop: nothing to publish
      // A stale session id makes --resume fail before any output: forget it and try once more with a fresh conversation.
      if (code !== 0 && session && allowRetry && !parser.state.text) { this.board.setting('orchestrator_session', ''); this.board.setting('orchestrator_turns', '0'); return this.run(text, false, meta); }
      const answer = (parser.state.isError ? parser.state.final : parser.state.final || parser.state.text).trim();
      const ok = code === 0 && !parser.state.isError;
      this.board.addChat(ok ? 'orb' : 'system', answer || `No he podido responder. Revisa en Agentes que Claude Code tenga la sesión iniciada (registro: ${this.logFile}).`, ok ? meta : null);
      this.busy = false; this.partial = ''; this.tools = []; this.push();
      this.next();
    };
    child.on('error', (error) => { try { fs.appendFileSync(this.logFile, `${error.message}\n`); } catch { /* log unavailable */ } done(-1); });
    child.on('close', (code) => done(code ?? -1));
  }
}
