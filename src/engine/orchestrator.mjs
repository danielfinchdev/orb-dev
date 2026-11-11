// The assistant's brain: every message of the user goes to Claude Code (the user's own subscription) with a coordinator
// persona. It reads (to write precise, compact briefs) and uses the board (MCP); the agents do the work. One live
// Claude session stays open between messages (streamed answer, no restart per message) and is renewed when its context
// fills up (the board and the logs keep the state). One per conversation, several at once.
// The persona prompt lives in orchestrator-persona.mjs.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { ctx, tr } from '../platform/context.mjs';
import { AGENTS, assistantName, userName, ofUser } from '../domain/tasks/board.mjs';
import { executable, installed, adapter } from '../agents/index.mjs';
import * as claude from '../agents/claude.mjs';
import { runLog } from '../platform/log.mjs';
import { oneLine } from '../shared/text.mjs';
import { titleFrom } from '../shared/titles.mjs';
import { mcpServersOf } from './sessions.mjs';
import { agentAuth } from '../domain/security/agent-auth.mjs';
import { accountEnv } from '../domain/usage/accounts.mjs';
import { briefing } from '../domain/journal/journal.mjs';
import { rememberModels } from './usage/catalog.mjs';
import { recordRate, pickAccount, recordSpend, usageBrake } from '../domain/usage/budget.mjs';
import { maxFixRounds } from '../domain/tasks/rounds.mjs';
import { AGENT_LABELS } from '../platform/config-file.mjs';
import { globalAutonomy } from '../domain/security/guard.mjs';
import { browserOn } from './sessions.mjs';
import { persona } from './orchestrator-persona.mjs';

export { persona, knownModels } from './orchestrator-persona.mjs';

// the assistant's own folder is outside core. Claude Code lets a reading tool look
// inside its working folder (and the extra folders) without asking Orb's guard, so with its folder in core\ejecuciones it
// could read the run logs and, a step away, core\datos\orb.db. An empty folder of its own under the system's temporary
// folder instead (one per workspace); everything else it reads goes through the guard.
export const assistantDir = (home = ctx.home) => path.join(os.tmpdir(), 'orb-asistente', crypto.createHash('sha256').update(path.resolve(String(home ?? '')).toLowerCase()).digest('hex').slice(0, 12));
// the reading tools always go through Orb's guard (canUseTool): only Orb's own tools are pre-allowed.
export const ASSISTANT_ALLOWED = ['mcp__orb'];
// and no extra folders (additionalDirectories): Claude Code reads inside those without asking
// canUseTool either, so every project's .env and keys were open to it. Projects are read through the guard like the rest.
// A turn that failed because the agent no longer has the conversation (deleted, old, another machine): no answer at
// all, and the agent's words say so. Not a usage limit, not a tool error with an answer.
export const staleConversation = (result) => Boolean(result?.isError && !result.limit && !result.text && /resum|no conversation|not found|malformed|thread|session/i.test(result.final ?? ''));

// The brain new conversations start with: Ajustes' (orb.json «orchestrator»).
export const brainOf = () => ctx.config.orchestrator ?? {};

const STOP_GRACE_MS = 10_000; // how long a stopped turn may take to wind down before its process is closed
// a conversation's process closes after this long without use (the conversation itself continues later, by resume).
const IDLE_CLOSE_MS = 10 * 60_000;
// a conversation taken up again after this long starts afresh with the logs and its last lines (cheaper than loading
// a long conversation back; the logs are the assistant's memory).
const STALE_MS = 6 * 3_600_000;
// what the summary of a compaction must keep (the coordinator's work lives in tasks, the board and the logs).
const COMPACT_FOCUS = 'Conserva lo que el usuario ha pedido, las decisiones tomadas, las tareas lanzadas con su número y estado, y lo que queda pendiente.';
const SETTLE_MS = 24 * 3_600_000; // a quiet conversation with nothing open is done after this long

// a step of the assistant for the chat's live line: the tool, what it works on (only a file's name, never its folder;
// the first words of a command) and when it started.
export function toolStep(body) {
  const name = String(body?.name ?? '').replace(/^orb:/, '');
  let target = String(body?.input ?? '').replace(/\s+/g, ' ').trim();
  if (/^([a-z]:)?[\\/]|^\.{0,2}[\\/]|[\\/][^\\/\s]+\.[\w]{1,8}$/i.test(target) && !/\s/.test(target)) target = target.split(/[\\/]/).filter(Boolean).pop() ?? '';
  if (target.startsWith('{')) target = '';
  return { name, target: target.slice(0, 80), at: Date.now() };
}

// what goes in the chat as the assistant's answer to a turn. When the agent gives a final answer of its own, that
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

// a message of the user that arrives while the assistant is answering waits for the end of that turn and is added
// to what was asked (added to the running turn, a short turn could lose its answer). Several messages
// written meanwhile go together, as one turn.
export function queueUserMessage(lane, text, user = userName()) {
  const last = lane.queue.at(-1);
  if (last && !last.internal && last.user) { last.text += `\n\n${text}`; return last; }
  // (For the brain, in Spanish like the rest of its instructions; the chat shows the message as the user wrote it.)
  const item = { text: lane.busy ? `(Mensaje nuevo de ${user}, escrito mientras respondías: se suma a lo anterior y no lo sustituye salvo que lo diga. Atiende los dos.)\n${text}` : text, user: true };
  lane.queue.push(item);
  return item;
}

// one conversation with the assistant: its messages waiting, its own live agent process and what it is doing now.
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
  // the state that ends a turn carries the line it wrote (answer), so the window swaps the streamed text for it in
  // the same frame instead of showing nothing until it reads the conversation again.
  push() {
    if (this.pushTimer) { clearTimeout(this.pushTimer); this.pushTimer = null; }
    const state = this.state();
    if (this.answerId != null && !this.busy) { const row = this.board.chatRow(this.answerId); if (row) state.answer = row.meta?.kind === 'report' ? { ...row, meta: { ...row.meta, accepted: (row.meta.tasks ?? []).length > 0 && row.meta.tasks.every((id) => this.board.isAccepted(id)) } } : row; }
    this.answerId = null;
    this.orch.emit('chat:state', state);
  }
  // the streamed answer goes to the window at most every 80 ms (each push sends the whole partial answer, and the
  // window and the phones redraw on each one); anything else still pushes at once.
  pushSoon() { if (!this.pushTimer) { this.pushTimer = setTimeout(() => this.push(), 80); this.pushTimer.unref?.(); } }
  say(role, body, meta = null) { return this.board.addChat(role, body, meta, this.id); }

  // its coordinator's grant ends with its process (a new process gets a new ticket).
  closeLive() { agentAuth.revokeSession(`asistente-${this.id}`); try { this.live?.close(); } catch { /* gone */ } this.live = null; this.liveKey = ''; }
  // «Compactar»: the brain's own compaction when its agent has one (Claude /compact, Codex's thread compaction): the
  // same conversation goes on from a summary. Otherwise (or if it fails) it is renewed: the next message starts afresh
  // with the briefing, the logs and its last lines, as when the context fills up by itself. → { ok, how }
  async compact() {
    if (this.busy || this.inflight || this.queue.length) throw new Error(tr('msg.orch.compactBusy'));
    const c = this.conv();
    if (!c) throw new Error(tr('msg.board.noConversation'));
    if (!c.session_id) return { ok: true, how: 'none' };
    this.busy = true; this.since = Date.now(); this.usedAt = Date.now(); this.push();
    let how = 'renewed';
    try {
      let live = null;
      try { this.ensureLive(); live = this.live; } catch { live = null; }
      if (typeof live?.compact === 'function') {
        const r = await live.compact({ instructions: COMPACT_FOCUS }).catch((error) => ({ ok: false, error: error.message }));
        if (r?.ok) how = 'compacted'; else this.orch.log(`compactar la conversación ${this.id}: ${r?.error ?? 'sin respuesta'}`);
      }
      if (how !== 'compacted') this.forget();
    } finally { this.busy = false; this.partial = ''; this.tools = []; this.usedAt = Date.now(); this.push(); }
    this.say('system', tr(how === 'compacted' ? 'msg.orch.compacted' : 'msg.orch.compactRenewed'), { kind: 'compacted' });
    if (!this.orch.closing) { this.next(); this.orch.kick(); }
    return { ok: true, how };
  }
  forget() { this.closeLive(); this.board.updateConversation(this.id, { session_id: null, turns: 0, context: null }); }
  // «/clear»: the coordinator starts a new conversation of its agent in this same chat (the lines stay).
  clear() {
    if (this.busy || this.inflight || this.queue.length) throw new Error(tr('msg.orch.compactBusy'));
    this.forget();
    this.say('system', tr('msg.orch.cleared'), { kind: 'cleared' });
    return { ok: true };
  }

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
    // what the assistant had already written stays in the conversation, marked as stopped (not dropped).
    if (!quiet && !this.orch.closing) this.keepStopped();
    this.busy = false; this.partial = ''; this.said = []; this.tools = []; this.push();
  }
  keepStopped() {
    const written = [...this.said, this.partial].map((s) => String(s ?? '').trim()).filter(Boolean).join('\n\n');
    if (written) this.say('orb', `${written}\n\n*${tr('msg.orch.stoppedMark')}*`, { kind: 'stopped' });
    else this.say('system', tr('msg.orch.stoppedMark'), { kind: 'stopped' });
  }

  // an engine notice cut short (a report of finished tasks the assistant was writing when the user pressed «Detener»)
  // goes back to the front of the queue instead of being lost: it is answered next.
  requeueCurrent() {
    const item = this.current;
    if (!this.busy || !item?.internal || item.requeued) return;
    item.requeued = true;
    this.queue.unshift(item);
  }

  // A notice the assistant will not answer: the user gets what it said (the tasks and their results), with the report buttons.
  // braked: the usage brake's verdict when that is why (no tries were made), else the retries ran out.
  giveUp(item, braked = null) {
    this.orch.keep(item, false);
    const lines = String(item.text).split('\n').filter((l) => /^- #\d+/.test(l)).join('\n');
    const why = braked ? 'Braked' : '';
    // A report: its tasks and results, with the OK buttons. Any other notice (an agent's message, a blocked task): what
    // it said, so it is not lost either.
    if (lines) this.say('orb', tr(`msg.orch.noticeFallback${why}`, { name: assistantName(), lines, reason: braked?.reason ?? '' }), item.meta ?? null);
    else this.say('system', tr(`msg.orch.noticeFallbackOther${why}`, { name: assistantName(), reason: braked?.reason ?? '', text: String(item.text).replace(/^AVISO DEL SISTEMA[^:]*:\s*/, '').slice(0, 1200) }));
  }
  // a notice whose turn failed: again in 1, 3 and 6 minutes (or when the brain's usage limit resets); after that, the
  // user gets what it said (the tasks and their results) without the assistant, with the buttons of a report.
  retryLater(item, outcome) {
    item.attempts = (item.attempts ?? 0) + 1;
    const MAX = 4;
    if (item.attempts >= MAX) { this.giveUp(item); return; }
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

  // The real-usage brake of this conversation's account (null when it may run). Launch counts don't apply: answers are not tasks.
  // A deleted conversation or a failing check never brakes: the turn then goes on as before.
  brake() {
    try { const c = this.conv(); return c ? usageBrake(this.board, this.account(c).id) : null; } catch { return null; }
  }
  // One chat line per conversation and reset window, so the user knows automatic work is paused. The reset comes in whole
  // seconds or as ISO with fractions depending on the source: rounded to 10 minutes so the same window keeps one key.
  warnBrake(check) {
    const at = Number(new Date(check.paused ?? check.resetAt ?? NaN));
    const window = Number.isFinite(at) ? `r${Math.round(at / 600_000)}` : `h${Math.floor(Date.now() / 3_600_000)}`;
    const key = `brake_told:${this.id}`;
    if (this.board.setting(key) === window) return;
    this.board.setting(key, window);
    this.say('system', tr('msg.orch.brakeUser', { reason: check.reason }), { kind: 'brake' });
  }

  next() {
    if (this.busy || this.inflight || !this.queue.length) return;
    // several conversations at once, up to a limit: the others wait their turn (the window says so).
    if (this.orch.busyCount() >= this.orch.maxBusy) { this.push(); return; }
    // the message leaves the queue before the window hears «busy»: otherwise «1 en cola» would flash for the very message
    // being answered.
    const item = this.queue.shift();
    // The usage brake also covers the assistant's own turns. An automatic notice gets no turn (nobody is watching and it would
    // burn the window silently): the user sees what it said right away, a report with its OK buttons, as when its retries run
    // out. A message the user typed still runs, but the chat says automatic work is paused.
    const braked = this.brake();
    if (braked && item.internal) { this.giveUp(item, braked); this.push(); this.next(); return; }
    if (braked) this.warnBrake(braked);
    this.current = item; item.requeued = false;
    this.busy = true; this.since = Date.now(); this.usedAt = Date.now(); this.partial = ''; this.said = []; this.tools = []; this.push();
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
      // an engine notice (the report of finished tasks, a blocked task…) whose turn failed is not lost: it is tried
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
  // The account the conversation spends (its own, else the agent's first one).
  account(c) {
    const o = ctx.config.orchestrator ?? {};
    const agent = c.agent || o.agent || 'claude';
    return pickAccount(this.board, { agent, preferred: c.account }) ?? { id: agent, agent };
  }
  ensureLive() {
    const c = this.conv(); const o = ctx.config.orchestrator ?? {};
    const agent = c.agent || o.agent || 'claude';
    const acc = this.account(c);
    const isClaude = agent === 'claude';
    const cwd = assistantDir();
    const visible = this.board.projects();
    const model = c.model || (isClaude ? 'claude-sonnet-5-5' : null);
    const key = [agent, cwd, model, c.reasoning, acc.id, ...visible.map((p) => p.path)].join('|');
    if (this.live && this.liveKey === key && !this.live.isClosed()) return;
    this.closeLive();
    fs.mkdirSync(cwd, { recursive: true });
    fs.mkdirSync(ctx.paths.runs, { recursive: true });
    const writeLog = runLog(this.orch.logFile, { prefix: `[${this.id}] ` });
    // Claude keeps the conversation id Orb gives it; the other agents report theirs (event 'session').
    // a conversation started in the old folder (core\ejecuciones) cannot be resumed from the new one (Claude keeps
    // conversations by folder): it starts afresh with the briefing and its last lines, as after a long pause.
    if (c.session_id && this.board.setting(`assistant_cwd:${this.id}`) !== cwd) { this.board.updateConversation(this.id, { session_id: null, turns: 0, context: null }); c.session_id = null; }
    this.board.setting(`assistant_cwd:${this.id}`, cwd);
    const newId = c.session_id || !isClaude ? null : crypto.randomUUID();
    if (newId) this.board.updateConversation(this.id, { session_id: newId, turns: 0 });
    this.liveAgent = agent; this.liveAccount = acc.id;
    // Through the registry (not claude.mjs directly), so ORB_FAKE_AGENTS also replaces the assistant's own Claude in tests.
    // Claude takes the persona as its system prompt and a list of tools; the other agents get the persona at the start
    // of the conversation (run()) and the coordinator is held to read-only by its permission.
    const a = adapter(agent);
    this.live = a.createLive({
      exe: executable(agent), cwd, model, reasoning: c.reasoning || 'medium',
      permission: 'leer', projectDir: null, resumeId: c.session_id || null, newSessionId: isClaude ? newId : null,
      mcpServers: mcpServersOf(a, agent, { orchestrator: true, browser: false, session: `asistente-${this.id}`, conversation: this.id }),
      env: { ...accountEnv(acc), ORB_AGENT: 'orb' },
      ...(isClaude ? { systemPrompt: persona(this.board) } : {}),
      tools: isClaude ? { allowed: ASSISTANT_ALLOWED, disallowed: claude.COORDINATOR_DENIED } : undefined,
      addDirs: [], internalDir: ctx.paths.internal, lang: ctx.config.language, log: writeLog,
      // no skills of core here: the coordinator has Skill denied; the agents of its tasks get them.
      onEvent: (ev) => this.onEvent(ev)
    });
    this.liveKey = key;
  }

  // the user draws or attaches on the Pizarra and the assistant sees it by itself: with the next message, a line
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

  // the questions with options the assistant asked in this turn (orb_ask), as cards below its answer.
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
    // each step with what it works on (a file's name, a command, a search) and when it started, for the live line of
    // the chat («Leyendo claude.mjs · 1 min 3 s»). Only the last 30.
    if (ev.type === 'item' && ev.kind === 'tool') { this.tools.push(toolStep(ev.body)); if (this.tools.length > 30) this.tools.shift(); this.push(); return; }
    if (ev.type === 'item' && ev.role === 'assistant' && ev.kind === 'text') { if (!ev.sub && typeof ev.body === 'string') this.said.push(ev.body); this.partial = ''; return; }
    if (ev.type === 'session' && ev.id) { this.board.updateConversation(this.id, { session_id: ev.id }); return; }
    if (ev.type === 'models') { rememberModels(this.board, this.liveAgent, ev.list, this.liveAccount ?? this.liveAgent); return; }
    // the brain's own plan usage too (before, only the agents' sessions counted it): the usage panel and the budget.
    if (ev.type === 'rate') { try { recordRate(this.board, this.liveAccount ?? this.liveAgent, ev); } catch { /* budget only */ } return; }
    if (ev.type === 'context' && ev.size) { this.board.updateConversation(this.id, { context: { used: ev.used, size: ev.size } }); this.push(); return; }
    // Only the process that ended is dropped: a replaced live's late exit must not detach the one in use.
    // F2.6c: the coordinator's process is gone: its tickets go with it at once (even mid-turn).
    if (ev.type === 'exit' && this.live?.isClosed()) { agentAuth.revokeSession(`asistente-${this.id}`); if (!this.busy) this.live = null; }
  }

  // The last lines of the conversation before the message being answered, for a conversation taken up again afresh.
  recent() {
    const rows = this.board.all("SELECT role, body FROM chat WHERE conversation_id = ? AND role IN ('usuario', 'orb') ORDER BY id DESC LIMIT 9", this.id).reverse().slice(0, -1);
    const who = userName();
    return rows.map((r) => `${r.role === 'usuario' ? who : assistantName()}: ${oneLine(r.body, 500)}`).join('\n');
  }

  // → { ok, limit } (undefined when stopped meanwhile).
  async run(text, allowRetry, meta = null, { internal = false } = {}) {
    // the message that started this turn gets its reply (chat.send) first; starting the agent's process, reading
    // the logs for the briefing and the rest come right after, in the next turn of the event loop. The order holds: the
    // lane is already busy, so anything sent meanwhile waits in its queue.
    const generation = this.generation;
    await new Promise((resolve) => setImmediate(resolve));
    if (generation !== this.generation || this.orch.closing) return undefined; // stopped (or Orb closing) meanwhile
    const o = ctx.config.orchestrator ?? {};
    let c = this.conv();
    if (!c) { this.busy = false; this.partial = ''; this.tools = []; return { ok: true }; } // deleted meanwhile
    // Renewed when its context is filling up (or after many turns): cheaper than dragging a long conversation along.
    if (c.session_id && ((c.context?.size && c.context.used / c.context.size >= (o.renewAt ?? 0.6)) || c.turns >= (o.maxTurns ?? 60))) {
      this.forget();
      this.board.notice(tr('msg.orch.renewed'), 'info');
      c = this.conv();
    }
    // taken up again after hours: afresh, with the logs and its last lines (not the whole conversation reloaded).
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
    // with the task queue paused the coordinator is told so on every turn (so it does not promise «te aviso cuando
    // terminen» for tasks that could not start).
    const paused = this.board.setting('paused') === '1' ? `\n\n(AVISO DEL SISTEMA: la cola de tareas está en pausa. Las tareas que crees no empezarán hasta que ${userName()} pulse «Reanudar»: díselo y no prometas avisar cuando terminen.)` : '';
    const prompt = fresh ? `${intro}${briefing(this.board, { project, recent })}\n\n## Mensaje ${ofUser()}\n${text}${paused}` : `${text}${paused}`;
    this.board.updateConversation(this.id, { turns: (c.turns ?? 0) + 1 });
    // 20 minutes for a coordinating turn (reviewing several finished tasks can take a while; 10 would cut reports short).
    // a turn that ignores the interrupt goes with its process after the same grace as «Detener» (the
    // lane stayed busy for ever otherwise, and three such lanes left every conversation unanswered).
    const live = this.live; const run = this.inflight;
    const timer = setTimeout(() => {
      this.say('system', tr('msg.orch.timeLimit')); Promise.resolve().then(() => live?.interrupt()).catch(() => {});
      setTimeout(() => { if (this.inflight === run && this.live === live) this.closeLive(); }, STOP_GRACE_MS).unref?.();
    }, 20 * 60_000);
    let result;
    try { result = await live.send({ text: prompt }); } finally { clearTimeout(timer); }
    try { recordSpend(this.board, { account: this.liveAccount, conversation: this.id, usage: result?.usage ?? {} }); } catch { /* usage only */ }
    if (generation !== this.generation) return undefined; // stopped: nothing to publish
    // A stale conversation id fails before any answer: forget it and try once more with a fresh conversation. Only for that failure:
    // a usage limit or any other error must not drop the coordinator's memory.
    if (staleConversation(result) && allowRetry && !fresh) { this.forget(); return this.run(text, false, meta, { internal }); }
    const answer = answerOf(result, this.said);
    this.said = [];
    const ok = !result.isError;
    // A turn that only asked (orb_ask) and said nothing more: the card alone.
    const asked = this.asked();
    // a failed answer to an engine notice is tried again (next()): no error line for each try.
    if (!(ok && !answer && asked) && (ok || !internal)) this.answerId = this.say(ok ? 'orb' : 'system', answer || tr('msg.orch.cannotAnswerCheck', { logFile: this.orch.logFile }), ok ? meta : null)?.id ?? null;
    this.flushQuestions();
    this.busy = false; this.partial = ''; this.tools = []; this.push();
    if (ok) this.suggestGames();
    return { ok, limit: result.limit ?? null };
  }

  // when the assistant has handed out work and the agents are on it, it suggests a mini-game while waiting (once in
  // a while, not after every answer).
  // with the queue paused nothing is promised: the chat says the tasks wait for «Reanudar» (a card with the button),
  // once in a while per conversation.
  suggestGames() {
    const working = this.board.one("SELECT COUNT(*) AS n FROM tasks WHERE conversation_id = ? AND status IN ('queued', 'running')", this.id).n;
    if (working && this.board.setting('paused') === '1') {
      const queued = this.board.one("SELECT COUNT(*) AS n FROM tasks WHERE conversation_id = ? AND status = 'queued'", this.id).n;
      const key = `paused_told:${this.id}`;
      if (!queued || Date.now() - Number(this.board.setting(key) ?? 0) < 10 * 60_000) return;
      this.board.setting(key, String(Date.now()));
      this.say('system', tr('msg.orch.queuePaused', { tasks: tr(queued === 1 ? 'msg.orch.tasksOne' : 'msg.orch.tasksOther', { n: queued }) }), { kind: 'paused' });
      return;
    }
    if (!working || Date.now() - Number(this.board.setting('games_suggested') ?? 0) < 30 * 60_000) return;
    this.board.setting('games_suggested', String(Date.now()));
    this.say('system', tr('msg.orch.playWhileWaiting', { tasks: tr(working === 1 ? 'msg.orch.tasksOne' : 'msg.orch.tasksOther', { n: working }) }), { kind: 'games' });
  }
}

// The assistant: every conversation with the user goes to its brain (Claude Code by default, on the user's own
// subscription) with a coordinator persona. One Lane per conversation, several at once.
export class Orchestrator {
  // Each conversation's coordinator is recognised by its MCP process through a ticket of the engine (agent-auth.mjs).
  // title(conversation, text): names a new conversation (engine/titles.mjs).
  constructor(board, { emit = () => {}, log = () => {}, title = null } = {}) {
    this.board = board; this.emit = emit; this.log = log; this.title = title;
    this.lanes = new Map(); this.closing = false;
    this.sweeper = setInterval(() => this.closeIdle(), 60_000); this.sweeper.unref?.();
  }

  get logFile() { return path.join(ctx.paths.runs, 'asistente.log'); }
  // How many conversations may be answered at the same time (Ajustes: orchestrator.parallel).
  get maxBusy() { return Math.min(Math.max(Number(ctx.config.orchestrator?.parallel) || 3, 1), 6); }
  // the assistant's open agent processes ask their plan's usage now (usage.refresh). → promises
  refreshUsage() { return [...this.lanes.values()].map((l) => { try { return l.live?.refreshUsage?.(); } catch { return null; } }).filter(Boolean); }
  busyCount() { let n = 0; for (const l of this.lanes.values()) if (l.busy) n++; return n; }
  get busy() { return this.busyCount() > 0; }
  lane(id) { const key = Number(id); let l = this.lanes.get(key); if (!l) { l = new Lane(this, key); this.lanes.set(key, l); } return l; }
  // Whether this conversation's assistant is held by the usage brake now (it would not answer an automatic notice).
  braked(id) { return Boolean(this.lane(id).brake()); }
  // What each conversation is doing now (only the ones that are answering or waiting their turn).
  states() { return [...this.lanes.values()].filter((l) => l.busy || l.queue.length).map((l) => l.state()); }
  state(id) { return this.lanes.get(Number(id))?.state() ?? { conversation: Number(id), busy: false, partial: '', tools: [], queued: 0, waiting: false, context: this.board.conversation(id)?.context ?? null }; }

  // The brain of a conversation (or the one a new conversation starts with: Ajustes and the last choice).
  info(id = null) {
    const c = id ? this.board.conversation(id) : null;
    const o = brainOf();
    const agent = c?.agent || o.agent || 'claude';
    const modelId = c ? c.model : o.model;
    // the brain can be any agent: its model's label comes from the assistant's list (Claude) or what the agent reported.
    // Without a model of its own, the one the agent says it uses by default (Codex: GPT-6-Luna…), named.
    const known = [...(agent === 'claude' ? o.models ?? [] : []), ...(this.board.settingJson(`models:${agent}`) ?? [])];
    const model = known.find((m) => m.id === modelId) ?? (modelId ? null : known.find((m) => m.default));
    return { conversation: c?.id ?? null, agent, agentLabel: AGENT_LABELS[agent] ?? agent, account: (c ? c.account : o.account) || agent, model: modelId, modelLabel: model?.label ?? (modelId || tr('msg.orch.defaultModel')), models: o.models ?? [], reasoning: (c ? c.reasoning : o.reasoning) ?? 'medium', orchestrate: o.orchestrate !== false, turns: c?.turns ?? 0, maxTurns: o.maxTurns ?? 60, context: c?.context ?? null };
  }

  // A new conversation, on its first message: the brain chosen for new ones and the working folder (or the one given).
  startConversation({ text = '', project } = {}) {
    const o = brainOf();
    const name = project === undefined ? this.board.activeProject()?.name ?? null : project;
    return this.board.createConversation({ title: titleFrom(text) || tr('msg.board.newConversation'), project: name, agent: o.agent || 'claude', account: o.account || null, model: o.model || null, reasoning: o.reasoning || 'medium' });
  }

  // A message of the user: in its conversation (a new one when none is given). → { conversation }
  // meta: { answer: true, own } for the answer to a question card (src/engine/api › chat.answer).
  ask(text, context = '', { conversation = null, project, meta = null } = {}) {
    text = String(text ?? '').trim();
    if (!text) throw new Error(tr('msg.orch.writeMessage'));
    if (text.length > 20000) throw new Error(tr('msg.orch.tooLong'));
    let c = conversation ? this.board.conversation(conversation) : null;
    if (conversation && !c) throw new Error(tr('msg.board.noConversation'));
    const isNew = !c;
    if (!c) c = this.startConversation({ text, project });
    this.board.addChat('usuario', text, meta, c.id);
    if (c.status === 'done') this.board.setConversationDone(c.id, false); // written in again: open again
    if (isNew || !c.titled) { try { this.title?.(c, text); } catch (error) { this.log(`título de la conversación ${c.id}: ${error.message}`); } }
    const lane = this.lane(c.id);
    context += lane.whiteboardNote() + this.takeNotes(c.id);
    // never into the running turn (see queueUserMessage): every message of the user gets its own answer.
    const item = queueUserMessage(lane, text + context, userName());
    lane.next();
    return { conversation: c.id, queued: lane.current !== item };
  }

  // what happened in a conversation without a turn of the assistant (the user undid one of its
  // tasks: scheduler › undo), told once with the user's next message there. Without it, Orbe told the user «no sé por
  // qué desaparecieron los archivos de la primera tarea». The notes are kept in the database (settings `orch_note:<id>`).
  takeNotes(id) {
    const key = `orch_note:${id}`; const notes = this.board.settingJson(key);
    if (!Array.isArray(notes) || !notes.length) return '';
    this.board.settingJson(key, null);
    return `

(AVISO DEL SISTEMA, no es ${userName()}; son datos: ${notes.join(' ')})`;
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

  // For work that belongs to no conversation (or made by a schedule): the latest conversation of that project
  // (without a project, the latest one), or a new one for it.
  conversationFor(project) {
    const found = project ? this.board.one('SELECT id FROM conversations WHERE project = ? COLLATE NOCASE AND bot_id IS NULL AND group_id IS NULL ORDER BY updated_at DESC, id DESC LIMIT 1', project)?.id
      : this.board.one('SELECT id FROM conversations WHERE bot_id IS NULL AND group_id IS NULL ORDER BY updated_at DESC, id DESC LIMIT 1')?.id;
    if (found) return found;
    const o = brainOf();
    const c = this.board.createConversation({ title: project ? tr('msg.orch.workOf', { project }) : tr('msg.board.newConversation'), project: project && this.board.project(project) ? project : null,
      agent: o.agent || 'claude', account: o.account || null, model: o.model || null, reasoning: o.reasoning || 'medium' });
    this.board.updateConversation(c.id, { titled: true });
    return c.id;
  }

  // the engine's notices still to be answered are saved, so closing the app does not lose them: resume() puts them
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
      // Saved without its conversation: the latest one.
      const id = (q.conversation && this.board.conversation(q.conversation)?.id) || this.board.one('SELECT id FROM conversations WHERE bot_id IS NULL AND group_id IS NULL ORDER BY updated_at DESC LIMIT 1')?.id || this.conversationFor(null);
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
  compact(id) { if (!this.board.conversation(id)) throw new Error(tr('msg.board.noConversation')); return this.lane(id).compact(); }
  stopAll() { for (const l of this.lanes.values()) l.stop({ quiet: true }); }
  forget(id) { this.lane(id).forget(); }
  clear(id) { if (!this.board.conversation(id)) throw new Error(tr('msg.board.noConversation')); return this.lane(id).clear(); }
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
    // Its coordinator's grant ends with it (also with no process open now).
    agentAuth.revokeSession(`asistente-${key}`);
  }
  // a conversation quiet for a day with nothing of it still open (no task, no question waiting, nothing to answer) is
  // done by itself; written in again, it opens.
  settleIdle() {
    const since = new Date(Date.now() - SETTLE_MS).toISOString();
    for (const { id } of this.board.all("SELECT id FROM conversations WHERE status = 'open' AND updated_at < ? AND bot_id IS NULL AND group_id IS NULL", since)) {
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
