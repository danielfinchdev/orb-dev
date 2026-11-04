// Scheduled tasks (2.3): "every Monday at 9 review the dependencies", "every night run the tests". A schedule creates a
// normal task when it is due (same approvals, usage limits and agents as any task). One created by the assistant needs the
// user's approval once before it runs on its own; one created by the user is approved already. A schedule never piles
// up work: while its last task is still open, the next run waits.
import { oneLine } from './safety.mjs';
import { tr } from './context.mjs';
import { AGENT_IDS as AGENTS } from './home.mjs';
import { nextLocalRun, systemTz } from './tz.mjs';
import { scopeSql } from './authz.mjs';

export const EVERY = ['hourly', 'every_hours', 'daily', 'weekly'];
const now = () => new Date();
const parseRow = (r) => r && { ...r, enabled: Boolean(r.enabled), approved: Boolean(r.approved), readonly: Boolean(r.readonly), weekdays: JSON.parse(r.weekdays || '[]') };

// every: hourly | every_hours (N hours, in `hours`) | daily (at at_time) | weekly (weekdays 0-6, Sunday = 0, at at_time).
// 3.6: the wall time is the schedule's person's (tz; default this machine's), right across daylight-saving changes.
export function nextRun({ every, at_time: at = '09:00', weekdays = [], hours = 6 }, from = now(), tz = null) {
  if (!EVERY.includes(every)) throw new Error(tr('msg.schedules.badEvery'));
  const time = /^\d{1,2}:\d{2}$/.test(String(at ?? '')) ? at : '09:00';
  const next = nextLocalRun({ every, time, weekdays: (weekdays?.length ? weekdays : every === 'weekly' ? [1] : []).map(Number), hours }, tz || systemTz(), new Date(from).getTime());
  if (!next) throw new Error(tr('msg.schedules.badEvery'));
  return next;
}
// The time zone of a schedule's person (null: this machine's).
export const tzOf = (board, person) => { try { return (person ? board.one('SELECT tz FROM persons WHERE id = ?', String(person))?.tz : board.one("SELECT tz FROM persons WHERE role = 'owner' AND deleted_at IS NULL LIMIT 1")?.tz) || null; } catch { return null; } };

export function describe(s) {
  const days = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'].map((d) => tr(`msg.schedules.day.${d}`));
  if (s.every === 'hourly') return tr('msg.schedules.hourly');
  if (s.every === 'every_hours') return tr('msg.schedules.everyHours', { n: s.hours ?? s.at_time });
  if (s.every === 'daily') return tr('msg.schedules.daily', { time: s.at_time });
  if (s.every === 'weekly') return tr('msg.schedules.weekly', { days: (s.weekdays.length ? s.weekdays : [1]).map((d) => days[d]).join(', '), time: s.at_time });
  return s.every;
}

// 3.6: principal: only that person's schedules and those of the projects shared with them.
export function listSchedules(board, { principal = null } = {}) {
  const s = principal ? scopeSql(principal, 'schedule', 'schedules') : { where: '1=1', args: [] };
  return board.all(`SELECT * FROM schedules WHERE ${s.where} ORDER BY id`, ...s.args).map(parseRow);
}
export const getSchedule = (board, id) => parseRow(board.one('SELECT * FROM schedules WHERE id = ?', Number(id)));

function validate(board, a) {
  if (!board.project(a.project)) throw new Error(tr('msg.schedules.noProject', { project: a.project }));
  if (!a.title || !a.description) throw new Error(tr('sys.board.titleAndDesc'));
  if (!EVERY.includes(a.every)) throw new Error(tr('sys.schedules.badEvery', { list: EVERY.join(', ') }));
  if (a.at_time && !/^([01]\d|2[0-3]):[0-5]\d$/.test(a.at_time)) throw new Error(tr('sys.schedules.badTime'));
  if (a.weekdays && (!Array.isArray(a.weekdays) || a.weekdays.some((d) => !Number.isInteger(d) || d < 0 || d > 6))) throw new Error(tr('sys.schedules.badWeekdays'));
  if (a.agent && a.agent !== 'any' && !AGENTS.includes(a.agent)) throw new Error(tr('sys.board.badAgent', { agent: a.agent, list: AGENTS.join(', ') }));
  board.checkAvailable(a.agent);
}

export function createSchedule(board, a, actor) {
  validate(board, a);
  // every_hours keeps its N in at_time's place ("6") so the table stays simple.
  const at = a.every === 'every_hours' ? String(Math.max(1, Math.min(168, Number(a.hours) || 6))) : a.at_time || '09:00';
  // 3.6: whose it is (a.person, given by the API or the coordinator's conversation; null: the owner).
  const person = a.person ?? null;
  const next = nextRun({ every: a.every, at_time: a.every === 'every_hours' ? '00:00' : at, weekdays: a.weekdays ?? [], hours: Number(at) }, now(), tzOf(board, person));
  const approved = actor === 'usuario' ? 1 : 0;
  const { lastInsertRowid } = board.run(`INSERT INTO schedules (project, title, description, agent, model, readonly, every, at_time, weekdays, enabled, approved, next_run, created_at, person_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?)`, board.project(a.project).name, oneLine(a.title, 120), String(a.description).slice(0, 8000), a.agent || 'any', a.model || null, Number(Boolean(a.readonly)), a.every, at, JSON.stringify(a.weekdays ?? []), approved, next.toISOString(), now().toISOString(), person);
  const s = getSchedule(board, Number(lastInsertRowid));
  board.notice(tr('msg.schedules.created', { title: s.title, when: describe({ ...s, hours: at }), project: s.project }) + (approved ? '' : tr('msg.schedules.needsApproval')), 'success', { person: board.isOwnerPerson?.(person) === false ? person : null });
  board.changed('schedules', person ? { person } : null);
  return s;
}

export function updateSchedule(board, id, patch) {
  const s = getSchedule(board, id); if (!s) throw new Error(tr('msg.schedules.noSchedule'));
  const fields = {};
  if (patch.enabled !== undefined) fields.enabled = Number(Boolean(patch.enabled));
  if (patch.approved) fields.approved = 1;
  if (patch.title !== undefined) fields.title = oneLine(patch.title, 120);
  if (patch.description !== undefined) fields.description = String(patch.description).slice(0, 8000);
  const keys = Object.keys(fields);
  if (keys.length) board.run(`UPDATE schedules SET ${keys.map((k) => `${k} = ?`).join(', ')} WHERE id = ?`, ...keys.map((k) => fields[k]), s.id);
  board.changed('schedules');
  return getSchedule(board, s.id);
}

export function removeSchedule(board, id) { board.run('DELETE FROM schedules WHERE id = ?', Number(id)); board.changed('schedules'); return true; }

// Creates the task of a schedule now (when due, or "Ejecutar ahora").
export function runSchedule(board, s, actor = 'usuario') {
  // 3.1: an agent that is no longer on this PC does not stop the schedule: this run goes to any available agent.
  const gone = s.agent && s.agent !== 'any' && board.availableAgents() && !board.availableAgents().includes(s.agent);
  const task = board.createTask({ project: s.project, title: tr('msg.schedules.runTitle', { title: s.title }), description: s.description, agent: gone ? 'any' : s.agent, model: gone ? null : s.model, readonly: s.readonly, schedule_id: s.id }, s.approved ? 'usuario' : actor);
  if (gone) board.event(task.id, 'orb', 'note', `${s.agent} no está disponible en este PC: la ejecución va a cualquier agente disponible`);
  const next = nextRun({ every: s.every, at_time: s.every === 'every_hours' ? '00:00' : s.at_time, weekdays: s.weekdays, hours: Number(s.at_time) }, now(), tzOf(board, s.person_id));
  board.run('UPDATE schedules SET last_run = ?, last_task = ?, next_run = ? WHERE id = ?', now().toISOString(), task.id, next.toISOString(), s.id);
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
