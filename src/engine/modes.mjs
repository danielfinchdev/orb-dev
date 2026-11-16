// The chat modes behind «/goal», «/plan», «/review» and «/debug» (commands: src/shared/slash.mjs).
// None of them raises the chat's permission: «/plan» lowers it for one turn («Solo lectura»), «/goal» keeps the chat's own,
// «/review» is a read-only task of another agent and «/debug» only adds instructions.
import { tr, ctx } from '../platform/context.mjs';
import { oneLine } from '../shared/text.mjs';
import { canLaunch } from '../domain/usage/budget.mjs';

export const GOAL_DEFAULT_TURNS = 20;
export const GOAL_MAX_TURNS = 100;
export const BLOCKED_AFTER = 3;          // equal blocked turns in a row
const DONE_RE = /(^|\n)[\s>*_`#-]*OBJETIVO CUMPLIDO/i;
const BLOCKED_RE = /(^|\n)[\s>*_`#-]*OBJETIVO BLOQUEADO/i;

export const goalTurns = () => {
  const n = Number(ctx.config?.goal?.maxTurns);
  return Number.isFinite(n) && n >= 1 ? Math.min(Math.floor(n), GOAL_MAX_TURNS) : GOAL_DEFAULT_TURNS;
};

export const goalOf = (board, id) => board.settingJson(`goal:${id}`);
const saveGoal = (sessions, id, goal) => { sessions.board.settingJson(`goal:${id}`, goal); sessions.emit('session:goal', { id, goal }); return goal; };
export const debugOn = (board, id) => board.settingJson(`debug:${id}`) === true;

// what a turn «says»: digits and spacing out, so «failed at 12:01» and «failed at 12:09» are the same failure
const signature = (text) => String(text ?? '').toLowerCase().replace(/\d+/g, '#').replace(/\s+/g, ' ').trim().slice(0, 160);

const goalPrompt = (goal, first) => `${first ? tr('sys.goal.first', { goal: goal.text }) : tr('sys.goal.next', { goal: goal.text })}\n\n${tr('sys.goal.rules')}`;

// the existing usage brakes (the 5-hour and weekly ones, a pause after a limit): the same check that holds a task back
function brakeOf(sessions, s) {
  try {
    const c = canLaunch(sessions.board, s.account ?? s.agent, s.model);
    return c.ok ? '' : c.reason;
  } catch { return ''; }
}

// «/goal <text>» (or «/goal N: <text>» to cap its turns): the first turn goes now, the following ones after each clean turn.
export function startGoal(sessions, id, text) {
  const s = sessions.must(id);
  if (s.kind !== 'chat') throw new Error(tr('msg.modes.onlyChats'));
  if (sessions.running.has(id)) throw new Error(tr('msg.sessions.stillWorking'));
  const m = /^(\d{1,3})\s*(?:turnos?)?\s*:\s*([\s\S]+)$/i.exec(text);
  const goalText = oneLine(m ? m[2] : text, 1500);
  const cap = Math.min(Math.max(1, Number(m?.[1]) || goalTurns()), GOAL_MAX_TURNS);
  const brake = brakeOf(sessions, s);
  if (brake) throw new Error(tr('msg.modes.goalBrake', { reason: brake }));
  const goal = saveGoal(sessions, id, { text: goalText, status: 'active', turns: 0, max: cap, startedAt: new Date().toISOString(), blockedSig: null, blockedCount: 0, lastSig: null, reason: '' });
  sessions.addItem(id, 'system', 'status', tr('msg.modes.goalStarted', { max: cap }));
  // the user's own words ask for what they ask for on the first turn; the turns Orb sends by itself ask for nothing
  try { if (!sessions.send(id, tr('sys.goal.shown', { goal: goalText }), { prompt: goalPrompt(goal, true) })) goalFailed(sessions, id); }
  catch (error) { clearGoal(sessions, id); throw error; }
  return { ok: true, goal: goalOf(sessions.board, id) };
}

// the user ends it («/goal parar») or Orb pauses it with the reason shown in the chat
export function stopGoal(sessions, id, status = 'stopped', reason = '') {
  const goal = goalOf(sessions.board, id); if (!goal) return null;
  if (status === 'stopped' && !['active', 'paused', 'blocked', 'limit'].includes(goal.status)) return goal;
  const next = saveGoal(sessions, id, { ...goal, status, reason: reason || goal.reason });
  if (reason) sessions.addItem(id, 'system', 'status', reason);
  return next;
}

export function clearGoal(sessions, id) { sessions.board.settingJson(`goal:${id}`, null); sessions.emit('session:goal', { id, goal: null }); return { ok: true }; }

// «/goal continuar»: a paused, blocked or capped goal goes on (a blocked one starts counting its failures again, a capped one
// gets a new round of turns: it is always a decision of the user).
export function resumeGoal(sessions, id) {
  const goal = goalOf(sessions.board, id); const s = sessions.must(id);
  if (!goal || !['paused', 'blocked', 'limit'].includes(goal.status)) throw new Error(tr('msg.modes.noGoalToResume'));
  if (sessions.running.has(id)) throw new Error(tr('msg.sessions.stillWorking'));
  const brake = brakeOf(sessions, s);
  if (brake) throw new Error(tr('msg.modes.goalBrake', { reason: brake }));
  const next = saveGoal(sessions, id, { ...goal, status: 'active', turns: goal.status === 'limit' ? 0 : goal.turns, blockedSig: null, blockedCount: 0, lastSig: null, reason: '' });
  try { if (!sessions.send(id, tr('sys.goal.shownResume'), { prompt: goalPrompt(next, false), asked: [] })) goalFailed(sessions, id); }
  catch (error) { saveGoal(sessions, id, { ...next, status: 'paused', reason: error.message }); throw error; }
  return { ok: true, goal: goalOf(sessions.board, id) };
}

// a turn that could not start or whose process failed outright: the goal waits for «continuar» instead of staying «active»
export function goalFailed(sessions, id, why = '') {
  const goal = goalOf(sessions.board, id);
  if (goal?.status !== 'active') return;
  saveGoal(sessions, id, { ...goal, status: 'paused', reason: why || tr('msg.modes.goalNoStart') });
  sessions.addItem(id, 'system', 'status', why || tr('msg.modes.goalNoStart'));
}

// the user wrote into a turn of the goal (steered): that is an interruption, the goal waits for «continuar»
export function goalSteered(sessions, id) {
  const goal = goalOf(sessions.board, id);
  if (goal?.status !== 'active') return;
  saveGoal(sessions, id, { ...goal, status: 'paused', reason: tr('msg.modes.goalSteered') });
  sessions.addItem(id, 'system', 'status', tr('msg.modes.goalSteered'));
}

// Called by Sessions.send when a chat's turn ends (a stopped one included). Decides whether the goal goes on.
export function goalAfterTurn(sessions, id, { result, run }) {
  const goal = goalOf(sessions.board, id);
  if (!goal || goal.status !== 'active') return;
  const text = String(result.final || result.text || '');
  const turns = goal.turns + 1;
  const end = (status, reason, patch = {}) => { saveGoal(sessions, id, { ...goal, turns, ...patch, status, reason }); if (reason) sessions.addItem(id, 'system', 'status', reason); };
  if (run.stopped) return end('paused', tr('msg.modes.goalInterrupted'));
  if (result.limit) return end('paused', tr('msg.modes.goalLimit'));
  if (!result.isError && DONE_RE.test(text)) return end('done', tr('msg.modes.goalDone', { turns }));
  // blocked: a failed turn, a turn that says so, or the same answer again; three equal ones in a row end the goal
  const sig = signature(text); const same = sig !== '' && sig === goal.lastSig;
  const blockedTurn = Boolean(result.isError) || BLOCKED_RE.test(text) || same;
  // consecutive blocked turns are counted whatever their wording (an error with a request id differs every time)
  const blockedCount = blockedTurn ? goal.blockedCount + (goal.blockedCount === 0 && same ? 2 : 1) : 0;
  const blockedSig = blockedTurn ? sig : null;
  const stay = { blockedSig, blockedCount, lastSig: sig };
  if (blockedCount >= BLOCKED_AFTER) return end('blocked', tr('msg.modes.goalBlocked', { n: blockedCount, why: oneLine(text, 160) }), stay);
  // a message queued by the user goes first, a permission or question waits for its answer: the goal does not push on
  if (sessions.queue(id).length) return end('paused', tr('msg.modes.goalQueue'), stay);
  if (sessions.pendingApprovals(id).length) return end('paused', tr('msg.modes.goalAsking'), stay);
  if (turns >= goal.max) return end('limit', tr('msg.modes.goalCap', { max: goal.max }), stay);
  const s = sessions.get(id);
  if (!s || s.archived || s.trashed_at) return end('paused', '', stay);
  const brake = brakeOf(sessions, s);
  if (brake) return end('paused', tr('msg.modes.goalBrake', { reason: brake }), stay);
  const next = saveGoal(sessions, id, { ...goal, turns, ...stay });
  sessions.addItem(id, 'system', 'status', tr('msg.modes.goalTurn', { n: turns + 1, max: goal.max }));
  try { if (!sessions.send(id, tr('sys.goal.shownNext', { n: turns + 1 }), { showUser: false, asked: [], prompt: goalPrompt(next, false) })) goalFailed(sessions, id); }
  catch (error) { saveGoal(sessions, id, { ...next, status: 'paused', reason: error.message }); sessions.addItem(id, 'error', 'text', error.message); }
}

// «/plan [text]»: one turn in «Solo lectura» that proposes a plan. The chat's own permission is not touched, so «accepting
// the plan» is just the next message, which runs with the permission the chat always had.
export function planTurn(sessions, id, text) {
  const s = sessions.must(id);
  if (s.kind !== 'chat') throw new Error(tr('msg.modes.onlyChats'));
  if (sessions.running.has(id)) throw new Error(tr('msg.sessions.stillWorking'));
  const shown = text ? tr('sys.plan.shown', { text }) : tr('sys.plan.shownBare');
  sessions.send(id, shown, { prompt: tr('sys.plan.prompt', { text: text || tr('sys.plan.current') }), turnPermission: 'leer' });
  return { ok: true };
}

// «/debug [text]» turns the debugging instructions on for this chat's next turns (a badge in the chat); «/debug apagar» ends it.
export function debugMode(sessions, id, args) {
  const s = sessions.must(id);
  if (s.kind !== 'chat') throw new Error(tr('msg.modes.onlyChats'));
  if (/^(off|apagar|parar|salir)$/i.test(args)) {
    sessions.board.settingJson(`debug:${id}`, null); sessions.emit('session:debug', { id, on: false });
    sessions.addItem(id, 'system', 'status', tr('msg.modes.debugOff'));
    return { ok: true, debug: false };
  }
  sessions.board.settingJson(`debug:${id}`, true); sessions.emit('session:debug', { id, on: true });
  sessions.addItem(id, 'system', 'status', tr('msg.modes.debugOn'));
  if (args) sessions.message(id, args);
  return { ok: true, debug: true };
}
