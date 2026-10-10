// Scheduled tasks (2.3): "every Monday at 9 review the dependencies", "every night run the tests". A schedule creates a
// normal task when it is due (same approvals, quota and agents as any task). One created by the assistant needs the
// user's approval once before it runs on its own; one created by the user is approved already. A schedule never piles
// up work: while its last task is still open, the next run waits.
import { oneLine } from './safety.mjs';
import { tr } from './context.mjs';

export const EVERY = ['hourly', 'every_hours', 'daily', 'weekly'];
const now = () => new Date();
const parseRow = (r) => r && { ...r, enabled: Boolean(r.enabled), approved: Boolean(r.approved), readonly: Boolean(r.readonly), weekdays: JSON.parse(r.weekdays || '[]') };

// every: hourly | every_hours (N hours, in `hours`) | daily (at at_time) | weekly (weekdays 0-6, Sunday = 0, at at_time).
export function nextRun({ every, at_time: at = '09:00', weekdays = [], hours = 6 }, from = now()) {
  const [h, m] = String(at || '09:00').split(':').map(Number);
  const base = new Date(from);
  if (every === 'hourly') { const d = new Date(base); d.setMinutes(0, 0, 0); d.setHours(d.getHours() + 1); return d; }
  if (every === 'every_hours') return new Date(base.getTime() + Math.max(1, Math.min(168, Number(hours) || 6)) * 3_600_000);
  const at0 = (d) => { const x = new Date(d); x.setHours(h || 0, m || 0, 0, 0); return x; };
  if (every === 'daily') { let d = at0(base); if (d <= base) d = at0(new Date(base.getTime() + 86_400_000)); return d; }
  if (every === 'weekly') {
    const days = (weekdays.length ? weekdays : [1]).map(Number);
    for (let i = 0; i <= 7; i++) { const d = at0(new Date(base.getTime() + i * 86_400_000)); if (days.includes(d.getDay()) && d > base) return d; }
  }
  throw new Error(tr('msg.schedules.badEvery'));
}

export function describe(s) {
  const days = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'].map((d) => tr(`msg.schedules.day.${d}`));
  if (s.every === 'hourly') return tr('msg.schedules.hourly');
  if (s.every === 'every_hours') return tr('msg.schedules.everyHours', { n: s.hours ?? s.at_time });
  if (s.every === 'daily') return tr('msg.schedules.daily', { time: s.at_time });
  if (s.every === 'weekly') return tr('msg.schedules.weekly', { days: (s.weekdays.length ? s.weekdays : [1]).map((d) => days[d]).join(', '), time: s.at_time });
  return s.every;
}

export function listSchedules(board) { return board.all('SELECT * FROM schedules ORDER BY id').map(parseRow); }
export const getSchedule = (board, id) => parseRow(board.one('SELECT * FROM schedules WHERE id = ?', Number(id)));

function validate(board, a) {
  if (!board.project(a.project)) throw new Error(tr('msg.schedules.noProject', { project: a.project }));
  if (!a.title || !a.description) throw new Error(tr('sys.board.titleAndDesc'));
  if (!EVERY.includes(a.every)) throw new Error(tr('sys.schedules.badEvery', { list: EVERY.join(', ') }));
  if (a.at_time && !/^([01]\d|2[0-3]):[0-5]\d$/.test(a.at_time)) throw new Error(tr('sys.schedules.badTime'));
  if (a.weekdays && (!Array.isArray(a.weekdays) || a.weekdays.some((d) => !Number.isInteger(d) || d < 0 || d > 6))) throw new Error(tr('sys.schedules.badWeekdays'));
}

export function createSchedule(board, a, actor) {
  validate(board, a);
  // every_hours keeps its N in at_time's place ("6") so the table stays simple.
  const at = a.every === 'every_hours' ? String(Math.max(1, Math.min(168, Number(a.hours) || 6))) : a.at_time || '09:00';
  const next = nextRun({ every: a.every, at_time: a.every === 'every_hours' ? '00:00' : at, weekdays: a.weekdays ?? [], hours: Number(at) });
  const approved = actor === 'usuario' ? 1 : 0;
  const { lastInsertRowid } = board.run(`INSERT INTO schedules (project, title, description, agent, model, readonly, every, at_time, weekdays, enabled, approved, next_run, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?)`, board.project(a.project).name, oneLine(a.title, 120), String(a.description).slice(0, 8000), a.agent || 'any', a.model || null, Number(Boolean(a.readonly)), a.every, at, JSON.stringify(a.weekdays ?? []), approved, next.toISOString(), now().toISOString());
  const s = getSchedule(board, Number(lastInsertRowid));
  board.addChat('system', tr('msg.schedules.created', { title: s.title, when: describe({ ...s, hours: at }), project: s.project }) + (approved ? '' : tr('msg.schedules.needsApproval')));
  board.changed('schedules');
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
  const task = board.createTask({ project: s.project, title: tr('msg.schedules.runTitle', { title: s.title }), description: s.description, agent: s.agent, model: s.model, readonly: s.readonly, schedule_id: s.id }, s.approved ? 'usuario' : actor);
  const next = nextRun({ every: s.every, at_time: s.every === 'every_hours' ? '00:00' : s.at_time, weekdays: s.weekdays, hours: Number(s.at_time) });
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
