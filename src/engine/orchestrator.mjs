// The assistant's brain: every message of the user goes to Claude Code (the user's own subscription) with a coordinator
// persona. It reads (to write precise, compact briefs) and uses the board (MCP); the agents do the work. 2.3: one live
// Claude session stays open between messages (streamed answer, no restart per message) and is renewed when its context
// fills up (the board and the logs keep the state). 3.2: one per conversation, several at once.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { ctx, tr } from '../core/context.mjs';
import { AGENTS, assistantName, userName, ofUser } from '../core/board.mjs';
import { executable, installed, adapter } from '../agents/index.mjs';
import * as claude from '../agents/claude.mjs';
import { rotateIfBig, oneLine } from '../core/safety.mjs';
import { titleFrom } from '../core/titles.mjs';
import { mcpServersFor } from './sessions.mjs';
import { account, defaultAccount, accountEnv } from '../core/accounts.mjs';
import { briefing } from './logs.mjs';
import { rememberModels } from './catalog.mjs';
import { recordRate } from '../core/budget.mjs';
import { AGENT_LABELS } from '../core/home.mjs';

// The models an agent takes for a task: the configured ones and the ones the agent itself listed (2.6, models:<agent>).
// Each one with its name when the agent gave it (e.g. «opus = Opus 5.5 (claude-opus-5-5)»), so the brain picks the right id.
export function knownModels(board, agent) {
  const listed = board?.settingJson(`models:${agent}`) ?? [];
  const named = listed.map((m) => (m.label && m.label !== m.id ? `${m.id} = ${m.label}${m.resolved ? ` (${m.resolved})` : ''}` : m.id));
  const extra = (ctx.config.agents[agent]?.models ?? []).filter((id) => !listed.some((m) => m.id === id || m.resolved === id));
  return [...new Set([...named, ...extra])].slice(0, 24);
}

// 2.6: how careful to be with the quota, from the «ahorro ↔ uso» slider of Ajustes (budget.profile; null = by hand).
const SPEND = [
  'NIVEL DE GASTO: máximo ahorro. Usa siempre el modelo más barato que pueda hacerlo y razonamiento "low"; una tarea mejor que varias; nada de revisiones extra salvo que te las pidan; lee lo mínimo.',
  'NIVEL DE GASTO: ahorro. Prefiere los modelos baratos y razonamiento "low" o "medium"; junta el trabajo en pocas tareas; revisiones solo para lo importante.',
  'NIVEL DE GASTO: equilibrado. Modelo y razonamiento según lo que pida cada tarea.',
  'NIVEL DE GASTO: potencia. Puedes usar modelos potentes y razonamiento "high" cuando mejore el resultado, repartir en paralelo y pedir un Task Review en lo importante.',
  'NIVEL DE GASTO: máximo uso. Prioriza la calidad: los modelos más potentes, razonamiento "high" en lo complejo, trabajo en paralelo entre agentes y Task Review de lo que se entrega.'
];
// 2.7: the same levels when Orb chooses the models itself (it already follows the slider): only how to plan the work.
const SPEND_AUTO = [
  'NIVEL DE GASTO: máximo ahorro. Una tarea mejor que varias, nada de revisiones extra salvo que te las pidan y lee lo mínimo; marca complejo solo lo que de verdad lo es.',
  'NIVEL DE GASTO: ahorro. Junta el trabajo en pocas tareas y pide revisiones solo para lo importante.',
  'NIVEL DE GASTO: equilibrado. Reparte según lo que pida cada encargo.',
  'NIVEL DE GASTO: potencia. Reparte en paralelo entre agentes y pide un Task Review en lo importante.',
  'NIVEL DE GASTO: máximo uso. Prioriza la calidad: trabajo en paralelo entre agentes y Task Review de lo que se entrega.'
];

export function persona(board = null) {
  const c = ctx.config; const me = assistantName(); const boss = userName();
  const accountsOf = (a) => (c.accounts ?? []).filter((x) => x.agent === a && x.enabled !== false);
  // 3.1: only the agents this PC can run, each with its accounts and their plans (engine/plans.mjs).
  const available = AGENTS.filter((a) => c.agents[a]?.enabled && accountsOf(a).length && installed(a));
  const planOf = (x) => board?.settingJson?.(`plan:${x.id}`)?.label;
  const accountsLine = (a) => { const list = accountsOf(a); const named = list.map((x) => `${x.label}${planOf(x) ? ` (plan ${planOf(x)})` : ''}`); return list.length > 1 ? ` Cuentas: ${named.join(', ')} (el trabajo se reparte solo entre ellas según su uso).` : planOf(list[0]) ? ` Plan ${planOf(list[0])}.` : ''; };
  const models = available.map((a) => `- ${a}: ${c.agents[a].strengths}. Modelos: ${knownModels(board, a).join(', ') || 'el predeterminado de su programa'}${c.agents[a].heavyModels?.length ? ` (caros: ${c.agents[a].heavyModels.join(', ')})` : ''}.${accountsLine(a)}`).join('\n');
  return `Eres ${me}, el asistente que coordina a los agentes de IA ${ofUser()}. Hablas en ${c.language === 'en' ? 'inglés' : 'español'}, cercano y breve, sin jerga técnica innecesaria.
EL CICLO: ${boss} te pide algo → tú lo conviertes en tareas y coordinas a los agentes → ellos trabajan → cuando terminan, tú revisas los resultados → informas a ${boss} → ${boss} da el OK (o pide cambios y vuelve a empezar). Nunca des por terminado un pedido sin ese informe.\nTU PAPEL: ${boss} es quien dirige; tú eres su jefe de proyecto. ${boss} habla contigo y tú das encargos claros a los agentes disponibles en este PC (${available.join(', ') || 'ninguno'}), vigilas que cumplan y le informas con lo esencial. Nunca encargues nada a un agente que no esté en esa lista: no se puede ejecutar.
SOLO COORDINAS: no programas, no editas, no ejecutas comandos. El trabajo lo hacen los agentes mediante tareas. Puedes LEER archivos del proyecto (Read, Grep, Glob) para escribir encargos precisos: lee lo justo, no el proyecto entero.
ENCARGOS COMPACTOS (ahorran tokens a todos): rutas exactas, qué cambiar, criterio de terminado y qué no tocar. No copies código ni contexto que el agente puede leer él mismo; no repitas el mismo contexto en varias tareas: una tarea puede depender de otra (depends_on) y recibe su resultado.
Tu trabajo, en este orden:
1. ANALIZA el pedido: qué se quiere de verdad, en qué proyecto y cuándo estará terminado. Si es ambiguo, haz UNA pregunta.
PREGUNTAS CON OPCIONES: cuando ${boss} deba elegir entre 2-4 caminos claros (enfoque, alcance, prioridad), usa orb_ask (la opción recomendada primero, con «(Recomendado)») en vez de preguntarlo en texto. Después termina tu turno con una línea como mucho, sin repetir las opciones: su respuesta llega como su próximo mensaje.
2. ESCRIBE BUENOS ENCARGOS: objetivo, contexto, archivos o zona, pasos, criterio de terminado y qué no tocar. El agente no ve este chat: cada description debe bastar por sí sola.
HAZ LO QUE SE PIDE, NI MÁS NI MENOS: no añadas funciones que ${boss} no ha pedido (cada extra gasta uso, alarga el trabajo y puede necesitar su aprobación, por ejemplo si borra o publica). Si crees que algo más vendría bien, propónlo en una línea del informe.
3. PLANIFICA PARA QUE SALGA BIEN Y RÁPIDO (cada traspaso entre agentes cuesta contexto y tiempo; menos tareas es mejor):
- Algo pequeño o mediano (una página, un componente, un arreglo): UNA tarea, para el agente más capaz disponible, y su verificación.
- Algo grande que se construye desde cero (una web o un juego con varias partes): primero una BASE CORTA (nivel "normal", pocos minutos): la estructura del proyecto, que ya arranque, los archivos de cada parte con sus funciones de entrada vacías y un CONTRATO.md breve (archivos, quién es dueño de cada uno y cómo se conectan). Después, las PIEZAS A LA VEZ (depends_on: la base): 2-3 tareas, cada una dueña de sus archivos según el contrato, nivel según su dificultad. Así trabajan varios agentes a la vez en lugar de esperar a una base enorme.
- Para que de verdad trabajen a la vez, cada pieza a un agente o una cuenta distintos (cada cuenta hace una tarea cada vez): por ejemplo, Claude una pieza y cada cuenta de Codex otra. Si otra tarea ya escribe en la carpeta, cada pieza trabaja en su propia copia y ${me} une los trabajos al terminar (si dos tocan lo mismo, lanza una tarea que los une).
- Cierra SIEMPRE con una tarea de VERIFICACIÓN readonly (depends_on: todas las piezas), con Claude o Codex (son los más rápidos probando con el navegador de ${me}; Cursor, mejor para construir): instala, compila y arranca el proyecto de verdad y, si es una web, la abre con orb_browser_open y la usa como lo haría ${boss}. En su result: VEREDICTO: CORRECTO o CON FALLOS y los fallos concretos. Si hay fallos, una tarea de corrección y otra verificación.
- Lo normal: 1 tarea (o base corta + 2-3 piezas) + 1 verificación.
- No se prueba dos veces: en los encargos que construyen, pide solo una comprobación rápida (arranca, compila y no hay errores en la consola); la prueba a fondo en el navegador es de la verificación.
- Si ${boss} pide expresamente varios agentes o modelos, cúmplelo con esta misma forma: base corta, piezas repartidas entre ellos y la verificación con otro.
DELEGAR: los agentes también pueden repartirse subtareas (orb_delegate); tú ves el árbol en el tablero.
AGENTES DISPONIBLES:
${models || '- ninguno activado: pide a ' + boss + ' que active uno en la pantalla Agentes.'}
${c.budget?.autoModel !== false ? `MODELO Y RAZONAMIENTO: los elige ${me} solo, tarea a tarea, según su nivel y el uso de cada cuenta (el modelo ligero para lo sencillo, el equilibrado para lo habitual, el más potente para lo difícil). Tú pon en cada tarea nivel: simple (un cambio pequeño, un texto, una pregunta), normal (lo habitual) o complejo (diseño, un fallo difícil, mucho código), y no pongas model ni reasoning salvo que ${boss} pida uno concreto. Si ${boss} pregunta qué modelo usar, explícaselo así de fácil.`
    : `Razonamiento "medium" por defecto. "high" solo para algo muy complicado${c.policy?.highNeedsApproval !== false ? ` (esa tarea espera la aprobación ${ofUser()}; díselo)` : ''}.`}
AHORRO: cada suscripción tiene un límite de uso y ${me} limita las tareas por agente cada ${c.budget?.windowHours ?? 5} h. ${(c.budget?.autoModel !== false ? SPEND_AUTO : SPEND)[c.budget?.profile ?? 2] ?? ''} Si un pedido necesita más de 3 tareas, propón el plan (una tabla corta: tarea → agente → depende de) y pide el visto bueno con orb_ask (opciones «Lanzar el plan (Recomendado)» y «Cambiar algo»); créalas cuando lo apruebe. Si una tarea espera por el límite de uso o falla por él, no la dupliques: propón otro agente. No vigiles el tablero en bucle: ${me} te avisa cuando algo termina, se bloquea o un agente te escribe.
CONTROL: puedes escribir a un agente que está trabajando (orb_send_message con to: su agente y task_id): le llega en su siguiente paso. Los agentes te escriben a ti (to: "orb") y te llega como AVISO DEL SISTEMA. Puedes cancelar una tarea en curso que ya no tiene sentido (orb_update_task status "cancelled"). Una tarea que vuelve a la cola (status "queued") continúa su propia conversación, sin empezar de cero.
PROYECTOS: cada proyecto vive en una categoría de ${ctx.paths.projects}: windows, ios, android o web (por defecto web). Los nuevos se crean con orb_create_project indicando category (carpeta propia, con git). Las carpetas bitacora y mcp-servers son la configuración de ${me}: no son proyectos y no se tocan. Fija el proyecto de trabajo con orb_set_project; todas las tareas van ahí. Si no hay proyecto fijado y el pedido toca código, pregunta cuál. Para crear un proyecto necesitas su plataforma: si ${boss} no la ha dicho, pregúntasela con orb_ask (multi: true; opciones Windows, iOS, Android y Web) antes de crearlo. Si elige varias es multiplataforma: orb_create_project con categories crea <nombre>-android, <nombre>-ios… unidos en un grupo, con una carpeta común para lo que comparten; mantenlos coordinados.
PEDIDOS GRANDES: si un pedido es muy complejo (varias pantallas, un diseño, un flujo con muchos pasos, algo que se explica mejor dibujado) y la pizarra del proyecto está vacía o no lo cubre, antes de crear tareas usa orb_pizarra para recomendar a ${boss} que lo dibuje y adjunte allí lo necesario (le sale un botón que la abre), y termina tu turno.
PIZARRA: cada proyecto tiene su pizarra en <proyecto>/pizarra, donde ${boss} dibuja, escribe y adjunta lo que quiere: PIZARRA.md (sus textos y los adjuntos con su nota), pizarra.png (el dibujo entero: míralo con Read, las flechas y formas también cuentan) y adjuntos/ (fotos, vídeos, documentos). Léela al planificar en ese proyecto y siempre que ${boss} la mencione; trátala como su especificación. En los encargos, da a cada agente las rutas de la pizarra que necesite (la imagen, un adjunto concreto). Es material de ${boss}: no la modifiques.
DÓNDE TRABAJAN: por defecto cada tarea trabaja en la carpeta del proyecto (mode "carpeta"), con una foto previa que ${boss} puede deshacer con un botón; ${c.oneAtATime ? `${boss} ha elegido «Una tarea cada vez»: se ejecutan de una en una` : 'si otra tarea ya escribe ahí, trabaja a la vez en su propia copia y se une sola al terminar'}. Marca readonly:true las que solo revisan o prueban: pueden ejecutar comandos (pruebas, compilar, arrancar y abrir la web) pero no cambian archivos. Usa mode "aislada" (rama propia que ${boss} integra a mano) solo para experimentos que quizá no se queden; si a una aislada le falta algo, orb_give_files.
CAMBIAR MODELO: orb_update_task (agent, model, reasoning) en una tarea que no está en curso; no se rehace.
CONVERSACIONES: ${boss} puede tener varias conversaciones contigo a la vez (cada una con su proyecto) y otras directas con un agente; en esta conversación te encargas de lo que se pide aquí. Las tareas que crees aquí y su informe pertenecen a esta conversación.
MENSAJES SEGUIDOS: si ${boss} te escribe otra vez antes de que acabes, ese mensaje se suma al anterior: atiende los dos. Si se contradicen (por ejemplo, otro proyecto), pregúntale con orb_ask. Nunca abandones un pedido sin decirlo.
AVISOS DEL SISTEMA: si un mensaje empieza por "AVISO DEL SISTEMA", no es ${boss}: resuélvelo con las herramientas y cuéntaselo en 1-2 líneas.
BITÁCORAS (tu memoria): lee con orb_read_log (project = proyecto o "general") al empezar en un proyecto, cuando pregunten cómo va algo y antes de planificar. Escribe con orb_write_log (solo añade): decisiones y preferencias ${ofUser()}, el plan acordado y, al terminar un pedido, un resumen en la del proyecto y una línea en la general. Los agentes no escriben bitácoras: lo haces tú (y ${me} anota cada tarea terminada).
PUBLICAR: nunca hagas push, pull requests ni publiques nada. Si ${boss} lo pide, dile que lo haga con el botón de GitHub de la tarea o del proyecto.
Al crear tareas, responde en 2-4 líneas qué hará cada agente. Nunca muestres claves ni contraseñas.`;
}

const STOP_GRACE_MS = 10_000; // how long a stopped turn may take to wind down before its process is closed
// 3.2: a conversation's process closes after this long without use (the conversation itself continues later, by resume).
const IDLE_CLOSE_MS = 10 * 60_000;
// 3.2: a conversation taken up again after this long starts afresh with the logs and its last lines (cheaper than loading
// a long conversation back; the logs are the assistant's memory).
const STALE_MS = 6 * 3_600_000;
const SETTLE_MS = 24 * 3_600_000; // a quiet conversation with nothing open is done after this long

// 2.7: a step of the assistant for the chat's live line: the tool, what it works on (only a file's name, never its folder;
// the first words of a command) and when it started.
function toolStep(body) {
  const name = String(body?.name ?? '').replace(/^orb:/, '');
  let target = String(body?.input ?? '').replace(/\s+/g, ' ').trim();
  if (/^([a-z]:)?[\\/]|^\.{0,2}[\\/]|[\\/][^\\/\s]+\.[\w]{1,8}$/i.test(target) && !/\s/.test(target)) target = target.split(/[\\/]/).filter(Boolean).pop() ?? '';
  if (target.startsWith('{')) target = '';
  return { name, target: target.slice(0, 80), at: Date.now() };
}

// 3.2.1: what goes in the chat as the assistant's answer to a turn. When the agent gives a final answer of its own, that
// one; otherwise (Codex joins every message of the turn) only the last message: the earlier ones were notes on the way
// («Voy a revisar…») and, pasted together, said the same thing two or three times. A last message that is only a short
// closing line keeps the one before it.
export function answerOf(result, said = []) {
  const final = String(result?.final ?? '').trim(); const text = String(result?.text ?? '').trim();
  const blocks = said.map((s) => String(s ?? '').trim()).filter(Boolean);
  if (final && final !== text) return final;
  if (blocks.length < 2) return final || text;
  const last = blocks.at(-1);
  return last.length >= 80 ? last : blocks.slice(-2).join('\n\n');
}

// 3.2.1: a message of the user that arrives while the assistant is answering waits for the end of that turn and is added
// to what was asked (it used to go into the running turn and, with a short turn, its answer was lost). Several messages
// written meanwhile go together, as one turn.
export function queueUserMessage(lane, text, user = userName()) {
  const last = lane.queue.at(-1);
  if (last && !last.internal && last.user) { last.text += `\n\n${text}`; return last; }
  // (For the brain, in Spanish like the rest of its instructions; the chat shows the message as the user wrote it.)
  const item = { text: lane.busy ? `(Mensaje nuevo de ${user}, escrito mientras respondías: se suma a lo anterior y no lo sustituye salvo que lo diga. Atiende los dos.)\n${text}` : text, user: true };
  lane.queue.push(item);
  return item;
}

// 3.2: one conversation with the assistant: its messages waiting, its own live agent process and what it is doing now.
// Several conversations work at the same time (Orchestrator.maxBusy), each with its own context.
class Lane {
  constructor(orch, id) {
    this.orch = orch; this.id = id;
    this.queue = []; this.busy = false; this.partial = ''; this.said = []; this.tools = []; this.generation = 0; this.inflight = null; this.current = null;
    this.live = null; this.liveKey = ''; this.since = null; this.usedAt = Date.now();
  }
  get board() { return this.orch.board; }
  conv() { return this.board.conversation(this.id); }
  state() { return { conversation: this.id, busy: this.busy, since: this.busy ? this.since : null, partial: this.partial, tools: this.tools, queued: this.queue.length, waiting: !this.busy && this.queue.length > 0, context: this.conv()?.context ?? null }; }
  push() { if (this.pushTimer) { clearTimeout(this.pushTimer); this.pushTimer = null; } this.orch.emit('chat:state', this.state()); }
  // 3.0: the streamed answer goes to the window at most every 80 ms (each push sends the whole partial answer, and the
  // window and the phones redraw on each one); anything else still pushes at once.
  pushSoon() { if (!this.pushTimer) { this.pushTimer = setTimeout(() => this.push(), 80); this.pushTimer.unref?.(); } }
  say(role, body, meta = null) { return this.board.addChat(role, body, meta, this.id); }

  closeLive() { try { this.live?.close(); } catch { /* gone */ } this.live = null; this.liveKey = ''; }
  forget() { this.closeLive(); this.board.updateConversation(this.id, { session_id: null, turns: 0, context: null }); }

  // The chat is free at once, but the agent's turn takes a moment to wind down: a new message waits for it in next()
  // (sending it now would find the agent still busy). A turn that does not end goes with its process (resume keeps the
  // conversation).
  stop({ quiet = false } = {}) {
    if (!this.busy) { this.queue = this.queue.filter((q) => q.internal); this.push(); return; }
    // What the user had queued goes; the engine's own notices (the report of finished tasks…) still come after.
    this.generation++; this.queue = this.queue.filter((q) => q.internal);
    this.requeueCurrent();
    const live = this.live; const stopped = this.inflight;
    Promise.resolve(live?.interrupt()).catch(() => {});
    if (stopped) setTimeout(() => { if (this.inflight === stopped && this.live === live) this.closeLive(); }, STOP_GRACE_MS).unref?.();
    // 3.2.1: what the assistant had already written stays in the conversation, marked as stopped (it used to vanish).
    if (!quiet && !this.orch.closing) this.keepStopped();
    this.busy = false; this.partial = ''; this.said = []; this.tools = []; this.push();
  }
  keepStopped() {
    const written = [...this.said, this.partial].map((s) => String(s ?? '').trim()).filter(Boolean).join('\n\n');
    if (written) this.say('orb', `${written}\n\n*${tr('msg.orch.stoppedMark')}*`, { kind: 'stopped' });
    else this.say('system', tr('msg.orch.stoppedMark'), { kind: 'stopped' });
  }

  // 3.0: an engine notice cut short (a report of finished tasks the assistant was writing when the user pressed «Detener»)
  // goes back to the front of the queue instead of being lost: it is answered next.
  requeueCurrent() {
    const item = this.current;
    if (!this.busy || !item?.internal || item.requeued) return;
    item.requeued = true;
    this.queue.unshift(item);
  }

  // 3.1: a notice whose turn failed: again in 1, 3 and 6 minutes (or when the brain's usage limit resets); after that, the
  // user gets what it said (the tasks and their results) without the assistant, with the buttons of a report.
  retryLater(item, outcome) {
    item.attempts = (item.attempts ?? 0) + 1;
    const MAX = 4;
    if (item.attempts >= MAX) {
      this.orch.keep(item, false);
      const lines = String(item.text).split('\n').filter((l) => /^- #\d+/.test(l)).join('\n');
      // A report: its tasks and results, with the OK buttons. Any other notice (an agent's message, a blocked task): what
      // it said, so it is not lost either.
      if (lines) this.say('orb', tr('msg.orch.noticeFallback', { name: assistantName(), lines }), item.meta ?? null);
      else this.say('system', tr('msg.orch.noticeFallbackOther', { name: assistantName(), text: String(item.text).replace(/^AVISO DEL SISTEMA[^:]*:\s*/, '').slice(0, 1200) }));
      return;
    }
    this.orch.keep(item, true);
    const waitMs = outcome.limit?.resetAt && outcome.limit.resetAt > Date.now() ? outcome.limit.resetAt - Date.now() + 60_000 : [60_000, 180_000, 360_000][item.attempts - 1] ?? 360_000;
    if (item.attempts === 1) this.board.notice(tr('msg.orch.noticeRetry', { name: assistantName(), min: Math.max(1, Math.round(waitMs / 60_000)) }), 'warning');
    // To the conversation's lane as it is then (this one may have been closed meanwhile, or the conversation removed).
    const timer = setTimeout(() => {
      if (this.orch.closing || !this.board.conversation(this.id)) return;
      const lane = this.orch.lane(this.id);
      if (!lane.queue.some((q) => q.id === item.id)) { lane.queue.push(item); lane.next(); }
    }, Number(process.env.ORB_NOTICE_RETRY_MS) || waitMs);
    timer.unref?.();
  }

  next() {
    if (this.busy || this.inflight || !this.queue.length) return;
    // 3.2: several conversations at once, up to a limit: the others wait their turn (the window says so).
    if (this.orch.busyCount() >= this.orch.maxBusy) { this.push(); return; }
    this.busy = true; this.since = Date.now(); this.usedAt = Date.now(); this.partial = ''; this.said = []; this.tools = []; this.push();
    const item = this.queue.shift(); this.current = item; item.requeued = false;
    const { text, meta } = item;
    const generation = this.generation;
    let outcome = null;
    const run = this.run(text, true, meta, { internal: Boolean(item.internal) }).then((r) => { outcome = r ?? null; }).catch((error) => {
      this.orch.log(`asistente (conversación ${this.id}): ${error.stack}`);
      outcome = { ok: false };
      if (generation !== this.generation) return; // stopped meanwhile: nothing to report
      if (!item.internal) this.say('system', tr('msg.orch.cannotAnswer', { message: error.message }));
      this.flushQuestions();
      this.busy = false; this.push();
    }).finally(() => {
      // 3.1: an engine notice (the report of finished tasks, a blocked task…) whose turn failed is not lost: it is tried
      // again a little later (at the reset if the brain hit its usage limit), and after the last try the user gets the
      // essentials with the OK / changes buttons.
      if (item.internal && !this.orch.closing && !item.requeued && outcome && outcome.ok === false && generation === this.generation) this.retryLater(item, outcome);
      // Answered (or given up): the notice is no longer pending, unless the app is closing in the middle of it.
      else if (item.internal && !this.orch.closing && !item.requeued) this.orch.keep(item, false);
      if (this.inflight === run) { this.inflight = null; this.current = null; }
      this.usedAt = Date.now();
      if (!this.orch.closing) { this.next(); this.orch.kick(); }
    });
    this.inflight = run;
  }

  // The live process of this conversation's brain, created on demand; another model, reasoning or account starts a new
  // process (the conversation itself continues with resume). The assistant only coordinates: it works in its own folder.
  ensureLive() {
    const c = this.conv(); const o = ctx.config.orchestrator ?? {};
    const agent = c.agent || o.agent || 'claude';
    const chosen = account(c.account);
    const acc = (chosen?.agent === agent ? chosen : null) ?? defaultAccount(agent) ?? { id: agent, agent };
    const isClaude = agent === 'claude';
    const cwd = ctx.paths.runs;
    const model = c.model || (isClaude ? 'claude-sonnet-5-5' : null);
    const key = [agent, cwd, model, c.reasoning, acc.id].join('|');
    if (this.live && this.liveKey === key && !this.live.isClosed()) return;
    this.closeLive();
    const dirs = [...Object.values(ctx.paths.categories), ...(ctx.config.projectRoots ?? []), ...this.board.projects().map((p) => p.path)].filter((d) => { try { return fs.statSync(d).isDirectory(); } catch { return false; } });
    fs.mkdirSync(ctx.paths.runs, { recursive: true });
    rotateIfBig(this.orch.logFile);
    const writeLog = (line) => { try { fs.appendFileSync(this.orch.logFile, `[${this.id}] ${String(line).replace(/\r?\n/g, ' ')}\n`); } catch { /* log unavailable */ } };
    // Claude keeps the conversation id Orb gives it; the other agents report theirs (event 'session').
    const newId = c.session_id || !isClaude ? null : crypto.randomUUID();
    if (newId) this.board.updateConversation(this.id, { session_id: newId, turns: 0 });
    this.liveAgent = agent; this.liveAccount = acc.id;
    // Through the registry (not claude.mjs directly), so ORB_FAKE_AGENTS also replaces the assistant's own Claude in tests.
    // Claude takes the persona as its system prompt and a list of tools; the other agents get the persona at the start
    // of the conversation (run()) and the coordinator is held to read-only by its permission.
    this.live = adapter(agent).createLive({
      exe: executable(agent), cwd, model, reasoning: c.reasoning || 'medium',
      permission: 'leer', resumeId: c.session_id || null, newSessionId: isClaude ? newId : null,
      mcpServers: mcpServersFor(agent, { board: this.board, orchestrator: true, browser: false, session: `asistente-${this.id}`, orchKey: this.orch.key, conversation: this.id }),
      env: { ...accountEnv(acc), ORB_HOME: ctx.home, ORB_AGENT: 'orb' },
      ...(isClaude ? { systemPrompt: persona(this.board) } : {}),
      tools: isClaude ? { allowed: ['mcp__orb', 'Read', 'Glob', 'Grep'], disallowed: claude.COORDINATOR_DENIED } : undefined,
      addDirs: [...new Set(dirs)].filter((d) => d !== cwd).slice(0, 40), internalDir: ctx.paths.internal, lang: ctx.config.language, log: writeLog,
      onEvent: (ev) => this.onEvent(ev)
    });
    this.liveKey = key;
  }

  // 2.7: the user draws or attaches on the Pizarra and the assistant sees it by itself: with the next message, a line
  // telling it that the conversation's project's Pizarra changed since it last heard (a new conversation reads it in the
  // briefing).
  whiteboardNote() {
    const c = this.conv(); const project = c?.project ? this.board.project(c.project) : null;
    if (!project?.path) return '';
    const md = path.join(project.path, 'pizarra', 'PIZARRA.md');
    let at; try { at = fs.statSync(md).mtimeMs; } catch { return ''; }
    const key = `wb_seen:${project.name}:${this.id}`; const seen = Number(this.board.setting(key) ?? 0);
    if (at <= seen) return '';
    this.board.setting(key, String(at));
    if (!c.session_id) return ''; // the briefing of the new conversation already has it
    return `\n\n(AVISO DEL SISTEMA: ${userName()} ha cambiado la pizarra de ${project.name} desde la última vez. Léela antes de seguir: ${md} y el dibujo en ${path.join(project.path, 'pizarra', 'pizarra.png')}.)`;
  }

  // 2.7: the questions with options the assistant asked in this turn (orb_ask), as cards below its answer.
  flushQuestions() {
    const key = `pending_questions:${this.id}`;
    const list = this.board.settingJson(key);
    if (!Array.isArray(list) || !list.length) return;
    this.board.settingJson(key, []);
    for (const q of list) {
      if (q.kind === 'board') { this.say('orb', q.message, { kind: 'board', project: this.conv()?.project ?? null }); continue; }
      this.say('orb', q.question, { kind: 'question', question: q.question, header: q.header, options: q.options, multi: q.multi === true, status: 'pending' });
    }
  }
  asked() { return (this.board.settingJson(`pending_questions:${this.id}`) ?? []).length > 0; }

  onEvent(ev) {
    if (ev.type === 'delta') { this.partial += ev.text; this.pushSoon(); return; }
    // 2.7: each step with what it works on (a file's name, a command, a search) and when it started, for the live line of
    // the chat («Leyendo claude.mjs · 1 min 3 s»). Only the last 30.
    if (ev.type === 'item' && ev.kind === 'tool') { this.tools.push(toolStep(ev.body)); if (this.tools.length > 30) this.tools.shift(); this.push(); return; }
    if (ev.type === 'item' && ev.role === 'assistant' && ev.kind === 'text') { if (!ev.sub && typeof ev.body === 'string') this.said.push(ev.body); this.partial = ''; return; }
    if (ev.type === 'session' && ev.id) { this.board.updateConversation(this.id, { session_id: ev.id }); return; }
    if (ev.type === 'models') { rememberModels(this.board, this.liveAgent, ev.list, this.liveAccount ?? this.liveAgent); return; }
    // 2.6: the brain's own plan usage too (before, only the agents' sessions counted it): the usage panel and the budget.
    if (ev.type === 'rate') { try { recordRate(this.board, this.liveAccount ?? this.liveAgent, ev); } catch { /* budget only */ } return; }
    if (ev.type === 'context' && ev.size) { this.board.updateConversation(this.id, { context: { used: ev.used, size: ev.size } }); this.push(); return; }
    // Only the process that ended is dropped: a replaced live's late exit must not detach the one in use.
    if (ev.type === 'exit' && !this.busy && this.live?.isClosed()) this.live = null;
  }

  // The last lines of the conversation before the message being answered, for a conversation taken up again afresh.
  recent() {
    const rows = this.board.all("SELECT role, body FROM chat WHERE conversation_id = ? AND role IN ('usuario', 'orb') ORDER BY id DESC LIMIT 9", this.id).reverse().slice(0, -1);
    return rows.map((r) => `${r.role === 'usuario' ? userName() : assistantName()}: ${oneLine(r.body, 500)}`).join('\n');
  }

  // → { ok, limit } (undefined when stopped meanwhile).
  async run(text, allowRetry, meta = null, { internal = false } = {}) {
    const o = ctx.config.orchestrator ?? {};
    let c = this.conv();
    if (!c) { this.busy = false; this.partial = ''; this.tools = []; return { ok: true }; } // deleted meanwhile
    // Renewed when its context is filling up (or after many turns): cheaper than dragging a long conversation along.
    if (c.session_id && ((c.context?.size && c.context.used / c.context.size >= (o.renewAt ?? 0.6)) || c.turns >= (o.maxTurns ?? 60))) {
      this.forget();
      this.board.notice(tr('msg.orch.renewed'), 'info');
      c = this.conv();
    }
    // 3.2: taken up again after hours: afresh, with the logs and its last lines (not the whole conversation reloaded).
    const lastAnswer = this.board.one("SELECT at FROM chat WHERE conversation_id = ? AND role = 'orb' ORDER BY id DESC LIMIT 1", this.id)?.at;
    const stale = Boolean(c.session_id && !this.live && lastAnswer && Date.now() - Date.parse(lastAnswer) > STALE_MS);
    if (stale) { this.forget(); c = this.conv(); }
    const fresh = !c.session_id;
    try { this.ensureLive(); } catch (error) {
      const agent = c.agent || o.agent || 'claude';
      this.say('system', tr('msg.orch.needsAgent', { name: assistantName(), agent: AGENT_LABELS[agent] ?? agent, message: error.message }));
      this.busy = false; this.push(); return { ok: false };
    }
    c = this.conv();
    const project = c.project ? this.board.project(c.project) : null;
    // A brain other than Claude gets its instructions at the start of the conversation (Claude has them as system prompt).
    const intro = fresh && this.liveAgent !== 'claude' ? `${persona(this.board)}\n\n` : '';
    const recent = fresh && lastAnswer ? this.recent() : '';
    const prompt = fresh ? `${intro}${briefing(this.board, { project, recent })}\n\n## Mensaje ${ofUser()}\n${text}` : text;
    this.board.updateConversation(this.id, { turns: (c.turns ?? 0) + 1 });
    const generation = this.generation;
    // 3.1: 20 minutes for a coordinating turn (reviewing several finished tasks can take a while; 10 cut reports short).
    const timer = setTimeout(() => { this.say('system', tr('msg.orch.timeLimit')); Promise.resolve(this.live?.interrupt()).catch(() => {}); }, 20 * 60_000);
    const live = this.live;
    let result;
    try { result = await live.send({ text: prompt }); } finally { clearTimeout(timer); }
    if (generation !== this.generation) return undefined; // stopped: nothing to publish
    // A stale conversation id fails before any answer: forget it and try once more with a fresh conversation.
    if (result.isError && allowRetry && !result.text && !fresh) { this.forget(); return this.run(text, false, meta, { internal }); }
    const answer = answerOf(result, this.said);
    this.said = [];
    const ok = !result.isError;
    // A turn that only asked (orb_ask) and said nothing more: the card alone.
    const asked = this.asked();
    // 3.1: a failed answer to an engine notice is tried again (next()): no error line for each try.
    if (!(ok && !answer && asked) && (ok || !internal)) this.say(ok ? 'orb' : 'system', answer || tr('msg.orch.cannotAnswerCheck', { logFile: this.orch.logFile }), ok ? meta : null);
    this.flushQuestions();
    this.busy = false; this.partial = ''; this.tools = []; this.push();
    if (ok) this.suggestGames();
    return { ok, limit: result.limit ?? null };
  }

  // 2.6: when the assistant has handed out work and the agents are on it, it suggests a mini-game while waiting (once in
  // a while, not after every answer).
  suggestGames() {
    const working = this.board.one("SELECT COUNT(*) AS n FROM tasks WHERE conversation_id = ? AND status IN ('queued', 'running')", this.id).n;
    if (!working || Date.now() - Number(this.board.setting('games_suggested') ?? 0) < 30 * 60_000) return;
    this.board.setting('games_suggested', String(Date.now()));
    this.say('system', tr('msg.orch.playWhileWaiting', { tasks: tr(working === 1 ? 'msg.orch.tasksOne' : 'msg.orch.tasksOther', { n: working }) }), { kind: 'games' });
  }
}

// The assistant: every conversation with the user goes to its brain (Claude Code by default, on the user's own
// subscription) with a coordinator persona. 3.2: one Lane per conversation, several at once.
export class Orchestrator {
  // key: secret handed only to the assistant's MCP processes (in memory, through the SDK) so the MCP recognises the
  // coordinator. title(conversation, text): names a new conversation (engine/titles.mjs).
  constructor(board, key, { emit = () => {}, log = () => {}, title = null } = {}) {
    this.board = board; this.key = key; this.emit = emit; this.log = log; this.title = title;
    this.lanes = new Map(); this.closing = false;
    this.sweeper = setInterval(() => this.closeIdle(), 60_000); this.sweeper.unref?.();
  }

  get logFile() { return path.join(ctx.paths.runs, 'asistente.log'); }
  // How many conversations may be answered at the same time (Ajustes: orchestrator.parallel).
  get maxBusy() { return Math.min(Math.max(Number(ctx.config.orchestrator?.parallel) || 3, 1), 6); }
  busyCount() { let n = 0; for (const l of this.lanes.values()) if (l.busy) n++; return n; }
  get busy() { return this.busyCount() > 0; }
  lane(id) { const key = Number(id); let l = this.lanes.get(key); if (!l) { l = new Lane(this, key); this.lanes.set(key, l); } return l; }
  // What each conversation is doing now (only the ones that are answering or waiting their turn).
  states() { return [...this.lanes.values()].filter((l) => l.busy || l.queue.length).map((l) => l.state()); }
  state(id) { return this.lanes.get(Number(id))?.state() ?? { conversation: Number(id), busy: false, partial: '', tools: [], queued: 0, waiting: false, context: this.board.conversation(id)?.context ?? null }; }

  // The brain of a conversation (or the one a new conversation starts with: Ajustes and the last choice).
  info(id = null) {
    const o = ctx.config.orchestrator ?? {};
    const c = id ? this.board.conversation(id) : null;
    const agent = c?.agent || o.agent || 'claude';
    const modelId = c ? c.model : o.model;
    // 2.6: the brain can be any agent: its model's label comes from the assistant's list (Claude) or what the agent reported.
    // Without a model of its own, the one the agent says it uses by default (Codex: GPT-6-Luna…), named.
    const known = [...(agent === 'claude' ? o.models ?? [] : []), ...(this.board.settingJson(`models:${agent}`) ?? [])];
    const model = known.find((m) => m.id === modelId) ?? (modelId ? null : known.find((m) => m.default));
    return { conversation: c?.id ?? null, agent, agentLabel: AGENT_LABELS[agent] ?? agent, account: (c ? c.account : o.account) || agent, model: modelId, modelLabel: model?.label ?? (modelId || tr('msg.orch.defaultModel')), models: o.models ?? [], reasoning: (c ? c.reasoning : o.reasoning) ?? 'medium', orchestrate: o.orchestrate !== false, turns: c?.turns ?? 0, maxTurns: o.maxTurns ?? 60, context: c?.context ?? null };
  }

  // A new conversation, on its first message: the brain chosen for new ones and the working folder (or the one given).
  startConversation({ text = '', project } = {}) {
    const o = ctx.config.orchestrator ?? {};
    const name = project === undefined ? this.board.activeProject()?.name ?? null : project;
    return this.board.createConversation({ title: titleFrom(text) || tr('msg.board.newConversation'), project: name, agent: o.agent || 'claude', account: o.account || null, model: o.model || null, reasoning: o.reasoning || 'medium' });
  }

  // A message of the user: in its conversation (a new one when none is given). → { conversation }
  ask(text, context = '', { conversation = null, project } = {}) {
    text = String(text ?? '').trim();
    if (!text) throw new Error(tr('msg.orch.writeMessage'));
    if (text.length > 20000) throw new Error(tr('msg.orch.tooLong'));
    let c = conversation ? this.board.conversation(conversation) : null;
    if (conversation && !c) throw new Error(tr('msg.board.noConversation'));
    const isNew = !c;
    if (!c) c = this.startConversation({ text, project });
    this.board.addChat('usuario', text, null, c.id);
    if (c.status === 'done') this.board.setConversationDone(c.id, false); // written in again: open again
    if (isNew || !c.titled) { try { this.title?.(c, text); } catch (error) { this.log(`título de la conversación ${c.id}: ${error.message}`); } }
    const lane = this.lane(c.id);
    context += lane.whiteboardNote();
    // 3.2.1: never into the running turn (see queueUserMessage): every message of the user gets its own answer.
    const item = queueUserMessage(lane, text + context);
    lane.next();
    return { conversation: c.id, queued: lane.current !== item };
  }

  // A notice from the engine (tasks finished, a task got blocked, an agent's message…): handled in the conversation that
  // asked for that work, without a user message. meta goes with the answer (e.g. the report that waits for the OK).
  internal(text, chatLine, meta = null, { conversation = null, project = null } = {}) {
    const id = (conversation && this.board.conversation(conversation)?.id) || this.conversationFor(project);
    if (chatLine) this.board.addChat('system', chatLine, null, id);
    this.board.setConversationDone(id, false); // there is news: open again
    const item = { id: crypto.randomUUID(), text, meta, internal: true, conversation: id };
    const lane = this.lane(id);
    lane.queue.push(item); this.keep(item, true);
    lane.next();
    return id;
  }

  // For work that belongs to no conversation (made before 3.2, or by a schedule): the latest conversation of that project
  // (without a project, the latest one), or a new one for it.
  conversationFor(project) {
    const found = project ? this.board.one('SELECT id FROM conversations WHERE project = ? COLLATE NOCASE ORDER BY updated_at DESC, id DESC LIMIT 1', project)?.id
      : this.board.one('SELECT id FROM conversations ORDER BY updated_at DESC, id DESC LIMIT 1')?.id;
    if (found) return found;
    const c = this.board.createConversation({ title: project ? tr('msg.orch.workOf', { project }) : tr('msg.board.newConversation'), project: project && this.board.project(project) ? project : null,
      agent: ctx.config.orchestrator?.agent || 'claude', account: ctx.config.orchestrator?.account || null, model: ctx.config.orchestrator?.model || null, reasoning: ctx.config.orchestrator?.reasoning || 'medium' });
    this.board.updateConversation(c.id, { titled: true });
    return c.id;
  }

  // 2.6: the engine's notices still to be answered are saved, so closing the app does not lose them: resume() puts them
  // back in the queue of their conversation at the next start (the one being answered when the app closed comes again).
  keep(item, add) {
    const list = (this.board.settingJson('orchestrator_pending') ?? []).filter((q) => q.id !== item.id);
    if (add) list.push({ id: item.id, text: item.text, meta: item.meta ?? null, conversation: item.conversation ?? null });
    this.board.settingJson('orchestrator_pending', list.length ? list : null);
  }

  resume() {
    const list = this.board.settingJson('orchestrator_pending') ?? [];
    if (!Array.isArray(list) || !list.length) return 0;
    // Not twice: neither what is queued nor the one being answered now (a notice may have come in before resume()).
    const queued = new Set([...this.lanes.values()].flatMap((l) => [...l.queue.map((q) => q.id), l.current?.id]).filter(Boolean));
    for (const q of list) {
      if (!q?.id || queued.has(q.id) || typeof q.text !== 'string') continue;
      // Saved before 3.2 (without its conversation): the latest one.
      const id = (q.conversation && this.board.conversation(q.conversation)?.id) || this.board.one('SELECT id FROM conversations ORDER BY updated_at DESC LIMIT 1')?.id || this.conversationFor(null);
      const item = { ...q, conversation: id, internal: true };
      this.lane(id).queue.push(item);
      if (!q.conversation) this.keep(item, true);
    }
    this.kick();
    return list.length;
  }

  // The conversations waiting their turn start as others finish.
  kick() { for (const l of this.lanes.values()) { if (this.busyCount() >= this.maxBusy) return; if (!l.busy && !l.inflight && l.queue.length) l.next(); } }
  stop(id) { this.lanes.get(Number(id))?.stop(); }
  stopAll() { for (const l of this.lanes.values()) l.stop({ quiet: true }); }
  forget(id) { this.lane(id).forget(); }
  closeLive() { for (const l of this.lanes.values()) l.closeLive(); }
  // A conversation removed: its process and its waiting messages go.
  drop(id) {
    const key = Number(id);
    const l = this.lanes.get(key);
    if (l) { l.stop({ quiet: true }); l.queue = []; l.closeLive(); this.lanes.delete(key); }
    // Its notices still owed and its report waiting go with it (they would land in another conversation).
    const pending = (this.board.settingJson('orchestrator_pending') ?? []).filter((q) => q.conversation !== key);
    this.board.settingJson('orchestrator_pending', pending.length ? pending : null);
    this.board.setting(`report_queue:c${key}`, '');
  }
  // 3.2: a conversation quiet for a day with nothing of it still open (no task, no question waiting, nothing to answer) is
  // done by itself; written in again, it opens.
  settleIdle() {
    const since = new Date(Date.now() - SETTLE_MS).toISOString();
    for (const { id } of this.board.all("SELECT id FROM conversations WHERE status = 'open' AND updated_at < ?", since)) {
      const l = this.lanes.get(id);
      if (l?.busy || l?.inflight || l?.queue.length || this.board.openTasksOf(id)) continue;
      if (this.board.one(`SELECT 1 AS x FROM chat WHERE conversation_id = ? AND meta LIKE '%"kind":"question"%' AND meta LIKE '%"status":"pending"%' LIMIT 1`, id)) continue;
      // Nor one with a task that failed or got blocked, or a report still waiting for the OK (its buttons would be buried).
      if (this.board.one("SELECT 1 AS x FROM tasks WHERE conversation_id = ? AND status IN ('failed', 'blocked') LIMIT 1", id)) continue;
      const reports = this.board.all(`SELECT meta FROM chat WHERE conversation_id = ? AND meta LIKE '%"kind":"report"%'`, id);
      if (reports.some((r) => { try { const m = JSON.parse(r.meta); return (m.tasks ?? []).some((t) => !this.board.isAccepted(t)); } catch { return false; } })) continue;
      this.board.setConversationDone(id, true);
    }
  }
  // Processes of conversations not used for a while are closed (memory); they continue by resume when written to again.
  closeIdle() {
    try { this.settleIdle(); } catch (error) { this.log(`conversaciones: ${error.message}`); }
    for (const [id, l] of this.lanes) {
      if (l.busy || l.inflight || l.queue.length) continue;
      if (Date.now() - l.usedAt < IDLE_CLOSE_MS) continue;
      l.closeLive(); this.lanes.delete(id);
    }
  }
}
