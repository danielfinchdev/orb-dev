// Scheduled tasks: "every Monday at 9 review the dependencies", "every night run the tests". A schedule creates a
// normal task when it is due (same approvals, usage limits and agents as any task). One created by the assistant needs the
// user's approval once before it runs on its own; one created by the user is approved already. A schedule never piles
// up work: while its last task is still open, the next run waits.
// «once» runs a single time at a date and time (at_time holds its local 'YYYY-MM-DDTHH:mm') and then turns
// itself off; «same_chat» sends every run to one chat, so its results and the talk about them stay together.
import { createHash } from 'node:crypto';
import { oneLine } from '../../shared/text.mjs';
import { ctx, tr } from '../../platform/context.mjs';
import { AGENT_IDS as AGENTS } from '../../platform/config-file.mjs';
import { brainAccount, configuredAccount } from '../usage/accounts.mjs';
import { nextLocalRun, systemTz, ownerTz, isValidTz } from '../../shared/tz.mjs';

export const EVERY = ['once', 'hourly', 'every_hours', 'daily', 'weekly', 'monthly'];
const ONCE_AT = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])T([01]\d|2[0-3]):[0-5]\d$/;
const now = () => new Date();
const parseRow = (r) => r && { ...r, enabled: Boolean(r.enabled), approved: Boolean(r.approved), readonly: Boolean(r.readonly), same_chat: Boolean(r.same_chat), notify_mobile: Boolean(r.notify_mobile), weekdays: (() => { try { const j = JSON.parse(r.weekdays || '[]'); return Array.isArray(j) ? j : []; } catch { return []; } })() };

// A zone a schedule may name: an IANA name the runtime knows (an offset such as «+01:00» is not a place and is refused).
export const validScheduleTz = (tz) => typeof tz === 'string' && /^[A-Za-z][A-Za-z0-9_+-]*(\/[A-Za-z0-9_+-]+){0,2}$/.test(tz) && isValidTz(tz);

// every: hourly | every_hours (N hours, in `hours`) | daily (at at_time) | weekly (weekdays 0-6, Sunday = 0, at at_time)
// | monthly (day `month_day` at at_time; a month without that day runs on its last day).
// the wall time is the schedule's zone (`tz`), else the owner's (default this machine's), right across daylight-saving changes.
// once: the instant of its local date and time, or null when that has passed.
export function nextRun({ every, at_time: at = '09:00', weekdays = [], hours = 6, month_day: day = 1 }, from = now(), tz = null) {
  if (!EVERY.includes(every)) throw new Error(tr('msg.schedules.badEvery'));
  if (every === 'once') return ONCE_AT.test(String(at ?? '')) ? nextLocalRun({ every, start: at }, tz || systemTz(), new Date(from).getTime()) : null;
  const time = /^\d{1,2}:\d{2}$/.test(String(at ?? '')) ? at : '09:00';
  // January has 31 days: the start only carries the day of the month, which nextLocalRun clamps to short months
  const start = every === 'monthly' ? `2000-01-${String(Math.min(31, Math.max(1, Number(day) || 1))).padStart(2, '0')}T00:00` : undefined;
  const next = nextLocalRun({ every, time, start, weekdays: (weekdays?.length ? weekdays : every === 'weekly' ? [1] : []).map(Number), hours }, tz || systemTz(), new Date(from).getTime());
  if (!next) throw new Error(tr('msg.schedules.badEvery'));
  return next;
}

export function describe(s) {
  const days = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'].map((d) => tr(`msg.schedules.day.${d}`));
  if (s.every === 'once') { const [date, time] = String(s.at_time ?? '').split('T'); return tr('msg.schedules.once', { date, time }); }
  if (s.every === 'hourly') return tr('msg.schedules.hourly');
  if (s.every === 'every_hours') return tr('msg.schedules.everyHours', { n: s.hours ?? s.at_time });
  if (s.every === 'daily') return tr('msg.schedules.daily', { time: s.at_time });
  if (s.every === 'weekly') return tr('msg.schedules.weekly', { days: (s.weekdays.length ? s.weekdays : [1]).map((d) => days[d]).join(', '), time: s.at_time });
  if (s.every === 'monthly') return tr('msg.schedules.monthly', { day: s.month_day ?? 1, time: s.at_time });
  return s.every;
}

export function listSchedules(board) {
  return board.all('SELECT * FROM schedules ORDER BY id').map(parseRow);
}
// The fingerprint of what approving a schedule lets run on its own: whoever approves sends the one they saw, so an edit made
// after the list was loaded is refused instead of approved unseen.
export const scheduleHash = (s) => createHash('sha256').update(JSON.stringify([s.id, s.project, s.title, s.description, s.agent, s.model ?? null, Boolean(s.readonly), s.every, s.at_time, s.month_day ?? null, s.tz ?? null, [...(s.weekdays ?? [])], s.autonomy ?? null, Boolean(s.same_chat), Boolean(s.notify_mobile)])).digest('hex').slice(0, 32);
export const getSchedule = (board, id) => parseRow(board.one('SELECT * FROM schedules WHERE id = ?', Number(id)));

// `only` (an update) limits the checks to what the patch changes, so editing the title of a schedule whose agent is
// away, or whose «once» date has passed, still works.
function validate(board, a, only = { project: true, text: true, agent: true, timing: true }) {
  if (only.project && !board.project(a.project)) throw new Error(tr('msg.schedules.noProject', { project: a.project }));
  if (only.text && (!String(a.title ?? '').trim() || !String(a.description ?? '').trim())) throw new Error(tr('sys.board.titleAndDesc'));
  if (only.timing) {
    if (!EVERY.includes(a.every)) throw new Error(tr('sys.schedules.badEvery', { list: EVERY.join(', ') }));
    if (a.tz && !validScheduleTz(a.tz)) throw new Error(tr('sys.schedules.badTz'));
    if (a.every === 'once') {
      if (!ONCE_AT.test(String(a.at_time ?? '')) || !nextRun({ every: 'once', at_time: a.at_time }, now(), a.tz || ownerTz(ctx.config))) throw new Error(tr('sys.schedules.badDate'));
    } else if (a.at_time && !/^([01]\d|2[0-3]):[0-5]\d$/.test(a.at_time)) throw new Error(tr('sys.schedules.badTime'));
    if (a.every === 'monthly' && a.month_day != null && (!Number.isInteger(a.month_day) || a.month_day < 1 || a.month_day > 31)) throw new Error(tr('sys.schedules.badMonthDay'));
    if (a.weekdays && (!Array.isArray(a.weekdays) || a.weekdays.some((d) => !Number.isInteger(d) || d < 0 || d > 6))) throw new Error(tr('sys.schedules.badWeekdays'));
  }
  if (only.agent) {
    if (a.agent && a.agent !== 'any' && !AGENTS.includes(a.agent)) throw new Error(tr('sys.board.badAgent', { agent: a.agent, list: AGENTS.join(', ') }));
    board.checkAvailable(a.agent);
  }
}

// What the table keeps of a schedule's timing. every_hours keeps its N in at_time's place ("6") so the table stays simple.
function timingOf(a) {
  const at = a.every === 'every_hours' ? String(Math.max(1, Math.min(168, Number(a.hours) || 6))) : a.at_time || '09:00';
  const monthDay = a.every === 'monthly' ? Math.min(31, Math.max(1, Number(a.month_day) || 1)) : null;
  const tz = a.tz ? String(a.tz) : null;
  const next = nextRun({ every: a.every, at_time: a.every === 'every_hours' ? '00:00' : at, weekdays: a.weekdays ?? [], hours: Number(at), month_day: monthDay ?? 1 }, now(), tz || ownerTz(ctx.config));
  return { at, monthDay, tz, weekdays: a.weekdays ?? [], next };
}

// The permission level the runs of a schedule take: none follows Ajustes (never above it) and «preguntar» always asks.
// Only this PC's window may loosen it; the phone, a linked browser and the agents may only tighten it (a value they
// send that is not «preguntar» leaves what the schedule has).
export function clampAutonomy(want, current, desktop) {
  if (want === undefined) return current ?? null;
  const next = want === 'preguntar' ? 'preguntar' : null;
  return next === 'preguntar' || desktop === true ? next : current ?? null;
}

export function createSchedule(board, a, actor, { desktop = false } = {}) {
  validate(board, a);
  const { at, monthDay, tz, next } = timingOf(a);
  const user = actor === 'usuario';
  const approved = user ? 1 : 0;
  const conversation = a.same_chat && a.conversation_id != null && board.conversation(Number(a.conversation_id)) ? Number(a.conversation_id) : null;
  const { lastInsertRowid } = board.run(`INSERT INTO schedules (project, title, description, agent, model, readonly, every, at_time, weekdays, enabled, approved, next_run, created_at, same_chat, conversation_id, tz, month_day, autonomy, notify_mobile)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, board.project(a.project).name, oneLine(a.title, 120), String(a.description).slice(0, 8000), a.agent || 'any', a.model || null, Number(Boolean(a.readonly)), a.every, at, JSON.stringify(a.weekdays ?? []), approved, next.toISOString(), now().toISOString(), Number(Boolean(a.same_chat)), conversation,
    tz, monthDay, clampAutonomy(a.autonomy, null, desktop), Number(!(user && a.notify_mobile === false)));
  const s = getSchedule(board, Number(lastInsertRowid));
  board.notice(tr('msg.schedules.created', { title: s.title, when: describe({ ...s, hours: at }), project: s.project }) + (approved ? '' : tr('msg.schedules.needsApproval')), 'success');
  board.changed('schedules');
  return s;
}

// The fields a patch may change besides enabled / approved / title / description: the ones create takes, checked the same way.
const EDITABLE = ['project', 'agent', 'model', 'readonly', 'every', 'at_time', 'hours', 'weekdays', 'month_day', 'tz', 'same_chat', 'notify_mobile', 'autonomy'];
const TIMING = ['every', 'at_time', 'hours', 'weekdays', 'month_day', 'tz'];
const given = (patch, k) => patch[k] !== undefined;

export function updateSchedule(board, id, patch, { desktop = false } = {}) {
  const s = getSchedule(board, id); if (!s) throw new Error(tr('msg.schedules.noSchedule'));
  const fields = {};
  if (patch.enabled !== undefined) fields.enabled = Number(Boolean(patch.enabled));
  if (patch.approved) {
    // The fingerprint covers the stored schedule, so an approval that also edits it would approve text nobody saw.
    if (patch.enabled !== undefined || patch.title !== undefined || patch.description !== undefined || EDITABLE.some((k) => given(patch, k))) throw new Error(tr('msg.schedules.approveAlone'));
    if (typeof patch.hash !== 'string' || !patch.hash) throw new Error(tr('msg.schedules.needsHash'));
    if (patch.hash !== scheduleHash(s)) throw new Error(tr('msg.schedules.changedSince'));
    fields.approved = 1;
  }
  if (patch.title !== undefined) fields.title = oneLine(patch.title, 120);
  if (patch.description !== undefined) fields.description = String(patch.description).slice(0, 8000);
  const edits = EDITABLE.filter((k) => given(patch, k));
  if (patch.title !== undefined || patch.description !== undefined || edits.length) {
    const timingEdit = TIMING.some((k) => given(patch, k));
    const current = { title: s.title, description: s.description, project: s.project, agent: s.agent, every: s.every, at_time: s.every === 'every_hours' ? null : s.at_time, hours: s.every === 'every_hours' ? Number(s.at_time) : 6, weekdays: s.weekdays, month_day: s.month_day, tz: s.tz };
    const merged = { ...current, ...Object.fromEntries(['title', 'description', ...EDITABLE].filter((k) => given(patch, k)).map((k) => [k, patch[k]])) };
    validate(board, merged, { project: given(patch, 'project'), text: patch.title !== undefined || patch.description !== undefined, agent: given(patch, 'agent'), timing: timingEdit });
    if (given(patch, 'project')) { fields.project = board.project(merged.project).name; if (fields.project !== s.project) fields.conversation_id = null; } // the «same chat» belonged to the old project
    if (given(patch, 'agent')) fields.agent = merged.agent || 'any';
    if (given(patch, 'model')) fields.model = merged.model || null;
    // only this PC's window may take «read only» off; any other channel may only turn it on
    if (given(patch, 'readonly') && (patch.readonly || !s.readonly || desktop)) fields.readonly = Number(Boolean(patch.readonly));
    if (given(patch, 'same_chat')) { fields.same_chat = Number(Boolean(patch.same_chat)); if (!patch.same_chat) fields.conversation_id = null; }
    if (given(patch, 'notify_mobile')) fields.notify_mobile = Number(patch.notify_mobile === true);
    if (given(patch, 'autonomy')) fields.autonomy = clampAutonomy(patch.autonomy, s.autonomy, desktop);
    if (timingEdit) {
      const { at, monthDay, tz, weekdays, next } = timingOf(merged);
      Object.assign(fields, { every: merged.every, at_time: at, month_day: monthDay, tz, weekdays: JSON.stringify(weekdays) });
      // a «once» schedule that already ran stays spent until it is switched on again: its next run is the new date
      fields.next_run = next ? next.toISOString() : null;
    }
  }
  const keys = Object.keys(fields);
  if (keys.length) board.run(`UPDATE schedules SET ${keys.map((k) => `${k} = ?`).join(', ')} WHERE id = ?`, ...keys.map((k) => fields[k]), s.id);
  board.changed('schedules');
  return getSchedule(board, s.id);
}

export function removeSchedule(board, id) { board.run('DELETE FROM schedules WHERE id = ?', Number(id)); board.changed('schedules'); return true; }

// the chat of a «same chat» schedule: the one it has, else a new one named after it (the brain chosen for new
// chats), kept for the next runs. A deleted chat is replaced on the next run.
function chatOf(board, s) {
  if (!s.same_chat) return null;
  if (s.conversation_id != null && board.conversation(s.conversation_id)) return s.conversation_id;
  const o = ctx.config?.orchestrator ?? {};
  const c = board.createConversation({ title: s.title, project: s.project, agent: o.agent || 'claude', ...brainAccount(configuredAccount(o, o.agent || 'claude'), o.agent || 'claude'), model: o.model || null, reasoning: o.reasoning || 'medium' });
  board.updateConversation(c.id, { titled: true });
  board.run('UPDATE schedules SET conversation_id = ? WHERE id = ?', c.id, s.id);
  return c.id;
}

// Creates the task of a schedule now (when due, or "Ejecutar ahora"). A «once» schedule is spent by it: it turns off.
export function runSchedule(board, s, actor = 'usuario') {
  // an agent that is no longer on this PC does not stop the schedule: this run goes to any available agent.
  const gone = s.agent && s.agent !== 'any' && board.availableAgents() && !board.availableAgents().includes(s.agent);
  // the next run first: if it cannot be worked out (a row written by hand), no task is created
  const next = s.every === 'once' ? null : nextRun({ every: s.every, at_time: s.every === 'every_hours' ? '00:00' : s.at_time, weekdays: s.weekdays, hours: Number(s.at_time), month_day: s.month_day ?? 1 }, now(), validScheduleTz(s.tz) ? s.tz : ownerTz(ctx.config));
  const task = board.createTask({ project: s.project, title: tr('msg.schedules.runTitle', { title: s.title }), description: s.description, agent: gone ? 'any' : s.agent, model: gone ? null : s.model, readonly: s.readonly, schedule_id: s.id, conversation_id: chatOf(board, s), ...(s.autonomy === 'preguntar' ? { autonomy: 'preguntar' } : {}) }, s.approved ? 'usuario' : actor);
  if (gone) board.event(task.id, 'orb', 'note', `${s.agent} no está disponible en este PC: la ejecución va a cualquier agente disponible`);
  if (s.every === 'once') board.run('UPDATE schedules SET last_run = ?, last_task = ?, next_run = NULL, enabled = 0 WHERE id = ?', now().toISOString(), task.id, s.id);
  else {
    board.run('UPDATE schedules SET last_run = ?, last_task = ?, next_run = ? WHERE id = ?', now().toISOString(), task.id, next.toISOString(), s.id);
  }
  board.changed('schedules');
  return task;
}

// Called by the scheduler's tick: launches the schedules that are due.
export function runDue(board, log = () => {}) {
  const open = new Set(['queued', 'awaiting_approval', 'running', 'limited']);
  for (const s of listSchedules(board)) {
    if (!s.enabled || !s.approved || !s.next_run || Date.parse(s.next_run) > Date.now()) continue;
    const last = s.last_task ? board.task(s.last_task) : null;
    if (last && open.has(last.status)) continue; // the previous run is not over: no pile-up
    try { runSchedule(board, s, 'usuario'); } catch (error) { log(`programada #${s.id}: ${error.message}`); board.run('UPDATE schedules SET next_run = ? WHERE id = ?', nextRun({ every: 'every_hours', hours: 1 }).toISOString(), s.id); }
  }
}

// The end line of a task is turned into a phone notification by default. A schedule that was told not to notify marks
// the end line of its runs `quiet`: the line stays in the chat but is not pushed (src/shared/notes.mjs, buildNote).
export function scheduleEndMeta(board, task) {
  if (!task?.schedule_id) return {};
  const s = getSchedule(board, task.schedule_id);
  return s && !s.notify_mobile ? { quiet: true } : {};
}
