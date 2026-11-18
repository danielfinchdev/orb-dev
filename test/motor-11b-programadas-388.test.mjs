// 3.8.8 step 11b (batch 5), engine: «Cada mes», a zone per schedule, every field editable, the permission level of the
// runs and the phone notice when a run ends. A schedule made before these columns runs exactly as it did.
import { tempHome } from './helpers.mjs';
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { Board } from '../src/domain/tasks/board.mjs';
import { Sessions } from '../src/engine/sessions.mjs';
import { Orchestrator } from '../src/engine/orchestrator.mjs';
import { Scheduler } from '../src/engine/scheduler/index.mjs';
import { buildApi } from '../src/engine/api/index.mjs';
import { DESKTOP, principalOf } from '../src/domain/security/permissions.mjs';
import fs from 'node:fs';
import { buildNote } from '../src/shared/notes.mjs';
import { ctx } from '../src/platform/context.mjs';
import { createProject } from '../src/domain/projects/projects.mjs';
import { createSchedule, updateSchedule, runSchedule, runDue, getSchedule, listSchedules, nextRun, describe, scheduleEndMeta, clampAutonomy, validScheduleTz, EVERY } from '../src/domain/schedules/schedules.mjs';

const PHONE = principalOf({ device: { kind: 'phone', id: 'p1' } });
let t; let board; let api; let sessions;
const call = (method, params = {}, who = DESKTOP) => api.call(method, params, who);
const base = { project: 'web', title: 'Check', description: 'Check the build', agent: 'any' };
const iso = (d) => new Date(d).toISOString();

before(() => {
  t = tempHome(); board = new Board();
  const emit = () => {};
  sessions = new Sessions(board, { emit });
  const orchestrator = new Orchestrator(board, { emit });
  const scheduler = new Scheduler(board, sessions, { orchestrator, emit });
  api = buildApi({ board, sessions, orchestrator, scheduler, emit, log: () => {}, version: 'test', remoteRef: { current: null, link: null } });
  createProject(board, { name: 'web', category: 'web' }, 'usuario');
});
after(() => { try { sessions.stopAll(); board.db.close(); } catch { /* closed */ } t.cleanup(); });

test('monthly: months of 28, 29, 30 and 31 days, and the year change', () => {
  const rule = (day) => ({ every: 'monthly', at_time: '09:00', month_day: day });
  const at = (day, from) => iso(nextRun(rule(day), new Date(from), 'UTC'));
  assert.equal(at(15, '2026-01-10T00:00:00Z'), '2026-01-15T09:00:00.000Z');
  assert.equal(at(15, '2026-01-15T09:00:00Z'), '2026-02-15T09:00:00.000Z', 'at the exact time it is already spent');
  assert.equal(at(31, '2026-01-31T10:00:00Z'), '2026-02-28T09:00:00.000Z', '31 in a month of 28 days: its last day');
  assert.equal(at(31, '2028-01-31T10:00:00Z'), '2028-02-29T09:00:00.000Z', 'and in a leap year: the 29th');
  assert.equal(at(30, '2026-01-31T10:00:00Z'), '2026-02-28T09:00:00.000Z');
  assert.equal(at(30, '2028-01-31T10:00:00Z'), '2028-02-29T09:00:00.000Z');
  assert.equal(at(31, '2026-03-31T10:00:00Z'), '2026-04-30T09:00:00.000Z', 'a month of 30 days');
  assert.equal(at(31, '2026-04-30T10:00:00Z'), '2026-05-31T09:00:00.000Z', 'the day comes back when the month has it');
  assert.equal(at(29, '2026-02-01T00:00:00Z'), '2026-02-28T09:00:00.000Z', '29 in February 2026');
  assert.equal(at(29, '2028-02-01T00:00:00Z'), '2028-02-29T09:00:00.000Z');
  assert.equal(at(5, '2026-12-20T00:00:00Z'), '2027-01-05T09:00:00.000Z', 'across the new year');
  assert.equal(at(31, '2026-12-31T10:00:00Z'), '2027-01-31T09:00:00.000Z');
  assert.ok(EVERY.includes('monthly'));
});

test('monthly: create, describe, run and the next run after it', () => {
  const s = createSchedule(board, { ...base, every: 'monthly', at_time: '10:30', month_day: 31, tz: 'UTC' }, 'usuario');
  assert.equal(s.every, 'monthly'); assert.equal(s.month_day, 31); assert.equal(s.at_time, '10:30');
  assert.match(describe(s), /31/); assert.match(describe(s), /10:30/);
  const day = new Date(s.next_run);
  assert.equal(day.getUTCHours(), 10); assert.equal(day.getUTCMinutes(), 30);
  const task = runSchedule(board, s);
  const after1 = getSchedule(board, s.id);
  assert.equal(after1.last_task, task.id);
  assert.ok(Date.parse(after1.next_run) > Date.now());
  assert.throws(() => createSchedule(board, { ...base, every: 'monthly', at_time: '10:30', month_day: 32 }, 'usuario'), /month_day/);
  assert.throws(() => createSchedule(board, { ...base, every: 'monthly', at_time: '10:30', month_day: 0 }, 'usuario'), /month_day/);
  const noDay = createSchedule(board, { ...base, every: 'monthly', at_time: '10:30' }, 'usuario');
  assert.equal(noDay.month_day, 1, 'without a day: the first');
});

test('zone: the wall time is read in the schedule zone, also across both daylight-saving changes', () => {
  const daily = (time, zone, from) => iso(nextRun({ every: 'daily', at_time: time }, new Date(from), zone));
  assert.equal(daily('09:00', 'Asia/Tokyo', '2026-05-31T23:00:00Z'), '2026-06-01T00:00:00.000Z');
  assert.equal(daily('09:00', 'Pacific/Kiritimati', '2026-06-01T00:00:00Z'), '2026-06-01T19:00:00.000Z');
  // spring forward in New York (2026-03-08): 02:30 does not exist, so the run is at 03:00 (07:00Z)
  assert.equal(daily('02:30', 'America/New_York', '2026-03-07T12:00:00Z'), '2026-03-08T07:00:00.000Z');
  // the day after the wall time is kept: 02:30 EDT = 06:30Z
  assert.equal(daily('02:30', 'America/New_York', '2026-03-08T07:00:00Z'), '2026-03-09T06:30:00.000Z');
  // fall back (2026-11-01): 01:30 happens twice and runs once, the first time (EDT, 05:30Z); then the next day (EST)
  assert.equal(daily('01:30', 'America/New_York', '2026-10-31T12:00:00Z'), '2026-11-01T05:30:00.000Z');
  assert.equal(daily('01:30', 'America/New_York', '2026-11-01T05:30:00Z'), '2026-11-02T06:30:00.000Z');
  assert.equal(daily('01:30', 'America/New_York', '2026-11-01T06:00:00Z'), '2026-11-02T06:30:00.000Z', 'the second 01:30 does not run again');
  // Madrid: last Sunday of March / October
  assert.equal(daily('02:30', 'Europe/Madrid', '2026-03-28T12:00:00Z'), '2026-03-29T01:00:00.000Z');
  assert.equal(daily('02:30', 'Europe/Madrid', '2026-10-24T12:00:00Z'), '2026-10-25T00:30:00.000Z');
  // monthly in a zone
  assert.equal(iso(nextRun({ every: 'monthly', at_time: '09:00', month_day: 1 }, new Date('2026-06-15T00:00:00Z'), 'Asia/Tokyo')), '2026-07-01T00:00:00.000Z');
});

test('zone: stored per schedule, validated, and used for the next run; none keeps Orb zone', () => {
  assert.equal(validScheduleTz('Europe/Madrid'), true);
  assert.equal(validScheduleTz('UTC'), true);
  for (const bad of ['', '+01:00', 'Mars/Base', 'Europe/Madrid; x', '../x', 42, null]) assert.equal(validScheduleTz(bad), false, String(bad));
  assert.throws(() => createSchedule(board, { ...base, every: 'daily', at_time: '09:00', tz: 'Mars/Base' }, 'usuario'), /tz/);
  const own = createSchedule(board, { ...base, every: 'daily', at_time: '09:00', tz: 'Pacific/Kiritimati' }, 'usuario');
  assert.equal(own.tz, 'Pacific/Kiritimati');
  assert.equal(new Date(own.next_run).getUTCHours(), 19);
  const plain = createSchedule(board, { ...base, every: 'daily', at_time: '09:00' }, 'usuario');
  assert.equal(plain.tz, null);
  // after a run the next one is still in its own zone
  runSchedule(board, own);
  assert.equal(new Date(getSchedule(board, own.id).next_run).getUTCHours(), 19);
});

test('update: every field create takes, checked as create does; a patch of another field leaves the rest', async () => {
  const s = createSchedule(board, { ...base, every: 'weekly', at_time: '09:00', weekdays: [1] }, 'usuario');
  const out = updateSchedule(board, s.id, { title: 'Renamed', every: 'monthly', at_time: '07:15', month_day: 15, tz: 'Asia/Tokyo', readonly: true, same_chat: true, notify_mobile: true });
  assert.equal(out.title, 'Renamed'); assert.equal(out.every, 'monthly'); assert.equal(out.at_time, '07:15'); assert.equal(out.month_day, 15);
  assert.equal(out.tz, 'Asia/Tokyo'); assert.equal(out.readonly, true); assert.equal(out.same_chat, true); assert.equal(out.notify_mobile, true);
  const next = new Date(out.next_run);
  assert.equal(next.getUTCDate() === 14 || next.getUTCDate() === 15, true); assert.equal(next.getUTCHours(), 22); assert.equal(next.getUTCMinutes(), 15);
  const again = updateSchedule(board, s.id, { description: 'New text' });
  assert.equal(again.every, 'monthly'); assert.equal(again.tz, 'Asia/Tokyo'); assert.equal(again.next_run, out.next_run);
  assert.throws(() => updateSchedule(board, s.id, { at_time: '25:00' }), /at_time/);
  assert.throws(() => updateSchedule(board, s.id, { tz: 'Mars/Base' }), /tz/);
  assert.throws(() => updateSchedule(board, s.id, { every: 'sometimes' }), /every/);
  assert.throws(() => updateSchedule(board, s.id, { project: 'nope' }));
  assert.throws(() => updateSchedule(board, s.id, { title: '  ' }));
  assert.throws(() => updateSchedule(board, s.id, { month_day: 40 }), /month_day/);
  assert.equal(getSchedule(board, s.id).month_day, 15, 'a refused patch changes nothing');
  // back to every N hours and to «once»
  const hours = updateSchedule(board, s.id, { every: 'every_hours', hours: 4 });
  assert.equal(hours.every, 'every_hours'); assert.equal(hours.at_time, '4'); assert.equal(hours.month_day, null);
  const at = `${new Date(Date.now() + 3 * 86400e3).toISOString().slice(0, 10)}T08:00`;
  assert.equal(updateSchedule(board, s.id, { every: 'once', at_time: at }).every, 'once');
  assert.throws(() => updateSchedule(board, s.id, { every: 'once', at_time: '2020-01-01T08:00' }), /at_time/);
  // through the API: the same fields, the same checks
  const viaApi = await call('schedules.update', { id: s.id, every: 'daily', at_time: '06:00', tz: 'UTC', title: 'Via API' });
  assert.equal(viaApi.every, 'daily'); assert.equal(viaApi.tz, 'UTC'); assert.equal(viaApi.title, 'Via API');
  await assert.rejects(() => call('schedules.update', { id: s.id, every: 'nope' }));
  await assert.rejects(() => call('schedules.update', { id: s.id, tz: 'Mars/Base' }), /tz|zona/);
});

test('an old schedule (made before the new columns) behaves exactly as before', () => {
  const { lastInsertRowid } = board.run(`INSERT INTO schedules (project, title, description, agent, readonly, every, at_time, weekdays, enabled, approved, next_run, created_at)
    VALUES ('web', 'Old', 'old text', 'any', 0, 'daily', '09:00', '[]', 1, 1, ?, ?)`, new Date(Date.now() - 1000).toISOString(), new Date().toISOString());
  const old = getSchedule(board, Number(lastInsertRowid));
  assert.equal(old.tz, null); assert.equal(old.month_day, null); assert.equal(old.autonomy, null); assert.equal(old.notify_mobile, true, 'on, as the phone always got the end line');
  runDue(board);
  const ran = getSchedule(board, old.id);
  const task = board.task(ran.last_task);
  assert.equal(task.autonomy, 'auto', 'the global level');
  assert.ok(Date.parse(ran.next_run) > Date.now());
  assert.deepEqual(scheduleEndMeta(board, task), {}, 'the end line is pushed as it is today');
  assert.ok(listSchedules(board).every((x) => typeof x.notify_mobile === 'boolean'));
});

test('permission: only this PC window sets or loosens it; the phone and the agents only tighten', async () => {
  assert.equal(clampAutonomy(undefined, 'preguntar', false), 'preguntar');
  assert.equal(clampAutonomy('auto', 'preguntar', false), 'preguntar');
  assert.equal(clampAutonomy('auto', 'preguntar', true), null);
  assert.equal(clampAutonomy('preguntar', null, false), 'preguntar');
  // the PC window sets it on create and the run takes it
  const s = await call('schedules.create', { project: 'web', title: 'Ask', description: 'x', every: 'daily', at_time: '09:00', autonomy: 'preguntar' });
  assert.equal(s.autonomy, 'preguntar');
  assert.equal(board.task(runSchedule(board, getSchedule(board, s.id)).id).autonomy, 'preguntar');
  // the phone cannot loosen it, not on update and not by creating a loose one
  const kept = await call('schedules.update', { id: s.id, autonomy: 'auto' }, PHONE);
  assert.equal(kept.autonomy, 'preguntar');
  const nulled = await call('schedules.update', { id: s.id, autonomy: null }, PHONE);
  assert.equal(nulled.autonomy, 'preguntar');
  const fromPhone = await call('schedules.create', { project: 'web', title: 'Phone', description: 'x', every: 'daily', at_time: '09:00', autonomy: 'auto' }, PHONE);
  assert.equal(fromPhone.autonomy, null);
  assert.equal(board.task(runSchedule(board, getSchedule(board, fromPhone.id)).id).autonomy, 'auto', 'as today');
  // the phone may tighten
  const tight = await call('schedules.update', { id: fromPhone.id, autonomy: 'preguntar' }, PHONE);
  assert.equal(tight.autonomy, 'preguntar');
  // the PC window loosens it
  assert.equal((await call('schedules.update', { id: s.id, autonomy: 'auto' })).autonomy, null);
  // an agent (the MCP server) creates with the actor of the agent: no notice, no loosening
  const byAgent = createSchedule(board, { ...base, every: 'daily', at_time: '09:00', autonomy: 'auto', notify_mobile: true }, 'mcp:test');
  assert.equal(byAgent.autonomy, null); assert.equal(byAgent.notify_mobile, true, 'an agent cannot turn the notice off'); assert.equal(byAgent.approved, false);
  const tightAgent = createSchedule(board, { ...base, every: 'daily', at_time: '09:00', autonomy: 'preguntar' }, 'mcp:test');
  assert.equal(tightAgent.autonomy, 'preguntar');
  await assert.rejects(() => call('schedules.create', { project: 'web', title: 'Bad', description: 'x', every: 'daily', autonomy: 'total' }));
  await assert.rejects(() => call('schedules.create', { project: 'web', title: 'Bad', description: 'x', every: 'daily', autonomy: 'ninguno' }, PHONE));
});

test('permission: never above the global level (Ajustes) and the guard keeps asking for the sensitive', async () => {
  ctx.config.permissions = { mode: 'preguntar' };
  try {
    const s = await call('schedules.create', { project: 'web', title: 'Under global', description: 'x', every: 'daily', at_time: '09:00', autonomy: 'auto' });
    assert.equal(board.task(runSchedule(board, getSchedule(board, s.id)).id).autonomy, 'preguntar', 'the schedule cannot loosen Ajustes');
  } finally { ctx.config.permissions = { mode: 'auto' }; }
  // what needs approval is decided by the task as before: a schedule's run gets the status the same task made by hand gets
  for (const autonomy of [undefined, 'preguntar']) {
    const description = 'sube la web a producción, publica y borra la base de datos';
    const s = await call('schedules.create', { project: 'web', title: `Publish ${autonomy}`, description, every: 'daily', at_time: '09:00', ...(autonomy ? { autonomy } : {}) });
    const task = runSchedule(board, getSchedule(board, s.id));
    const byHand = board.createTask({ project: 'web', title: `Publish by hand ${autonomy}`, description, ...(autonomy ? { autonomy } : {}) }, 'usuario');
    assert.equal(board.task(task.id).status, byHand.status, `same approval as by hand (${autonomy ?? 'default'})`);
    assert.deepEqual(board.task(task.id).sensitivity, byHand.sensitivity);
  }
});

test('phone notice: on by default; off marks the end line quiet and the pusher drops it; never a second line', async () => {
  const chatCount = () => board.one('SELECT COUNT(*) AS n FROM chat').n;
  const chat = { kind: 'orb', id: null, name: 'Orb' };
  const pushed = (meta) => buildNote({ chat, line: { id: 1, role: 'system', body: 'ended', meta } }) != null;
  const on = createSchedule(board, { ...base, title: 'Nightly tests', every: 'daily', at_time: '03:00' }, 'usuario');
  assert.equal(on.notify_mobile, true, 'created without the field: on');
  const off = createSchedule(board, { ...base, title: 'Quiet one', every: 'daily', at_time: '03:00', notify_mobile: false }, 'usuario');
  assert.equal(off.notify_mobile, false);
  for (const status of ['done', 'failed']) {
    const a = { ...board.task(runSchedule(board, on).id), status };
    const b = { ...board.task(runSchedule(board, off).id), status };
    const before = chatCount();
    assert.deepEqual(scheduleEndMeta(board, a), {}, `no mark (${status})`);
    assert.deepEqual(scheduleEndMeta(board, b), { quiet: true }, `marked (${status})`);
    assert.equal(chatCount(), before, 'the mark writes no second line');
    assert.equal(pushed({ kind: 'task-end', task: a.id, status, ...scheduleEndMeta(board, a) }), true);
    assert.equal(pushed({ kind: 'task-end', task: b.id, status, ...scheduleEndMeta(board, b) }), false);
  }
  assert.deepEqual(scheduleEndMeta(board, { id: 1, status: 'done', schedule_id: null }), {}, 'a task of no schedule');
  // the PC window and the phone turn it off or on; an agent cannot
  assert.equal((await call('schedules.update', { id: on.id, notify_mobile: false }, PHONE)).notify_mobile, false);
  assert.equal((await call('schedules.update', { id: on.id, notify_mobile: true })).notify_mobile, true);
  assert.equal((await call('schedules.create', { project: 'web', title: 'Api', description: 'x', every: 'daily' }, PHONE)).notify_mobile, true, 'the app 3.8.7 sends no field');
  assert.equal(createSchedule(board, { ...base, every: 'daily', notify_mobile: false }, 'mcp:test').notify_mobile, true);
});

test('readonly: only this PC window takes it off; any other channel may only turn it on', async () => {
  const s = createSchedule(board, { ...base, title: 'RO', every: 'daily', readonly: true }, 'usuario');
  const kept = await call('schedules.update', { id: s.id, readonly: false, title: 'RO2' }, PHONE);
  assert.equal(kept.readonly, true, 'ignored, no error'); assert.equal(kept.title, 'RO2', 'the rest is saved');
  assert.equal((await call('schedules.update', { id: s.id, readonly: false })).readonly, false);
  assert.equal((await call('schedules.update', { id: s.id, readonly: true }, PHONE)).readonly, true);
});

test('runSchedule works out the next run first: a row with an unknown every creates no task', () => {
  const { lastInsertRowid } = board.run(`INSERT INTO schedules (project, title, description, agent, readonly, every, at_time, weekdays, enabled, approved, next_run, created_at)
    VALUES ('web', 'Broken', 'x', 'any', 0, 'sometimes', '09:00', '[]', 1, 1, ?, ?)`, new Date(Date.now() - 1000).toISOString(), new Date().toISOString());
  const count = () => board.one('SELECT COUNT(*) AS n FROM tasks').n;
  const before = count();
  assert.throws(() => runSchedule(board, getSchedule(board, Number(lastInsertRowid))));
  runDue(board); runDue(board);
  assert.equal(count(), before);
});

test('a corrupt tz on a stored row falls back to the owner zone', () => {
  const s = createSchedule(board, { ...base, title: 'Bad tz', every: 'daily', at_time: '09:00' }, 'usuario');
  board.run('UPDATE schedules SET tz = ? WHERE id = ?', 'Mars/Base', s.id);
  const task = runSchedule(board, getSchedule(board, s.id));
  assert.ok(task.id); assert.ok(Date.parse(getSchedule(board, s.id).next_run) > Date.now());
});

test('changing the project drops the «same chat» of the old one', () => {
  createProject(board, { name: 'api', category: 'web' }, 'usuario');
  const s = createSchedule(board, { ...base, title: 'Chat', every: 'daily', same_chat: true }, 'usuario');
  runSchedule(board, getSchedule(board, s.id));
  assert.ok(getSchedule(board, s.id).conversation_id != null);
  assert.ok(updateSchedule(board, s.id, { title: 'Chat 2' }).conversation_id != null, 'other edits keep it');
  assert.equal(updateSchedule(board, s.id, { project: 'api' }).conversation_id, null);
});

test('a task that joins a copy by hand inherits «preguntar»; only the user may choose another level', () => {
  assert.equal(board.createTask({ project: 'web', title: 'Ask', description: 'x', autonomy: 'preguntar' }, 'orb').autonomy, 'preguntar', 'any actor may tighten');
  assert.equal(board.createTask({ project: 'web', title: 'Loose', description: 'x', autonomy: 'auto' }, 'orb').autonomy, 'auto', 'unchanged: the global level');
  const prev = ctx.config.permissions; ctx.config.permissions = { ...prev, mode: 'preguntar' };
  try { assert.equal(board.createTask({ project: 'web', title: 'No up', description: 'x', autonomy: 'auto' }, 'orb').autonomy, 'preguntar', 'an orb actor cannot loosen'); } finally { ctx.config.permissions = prev; }
  const src = fs.readFileSync(new URL('../src/engine/scheduler/folders.mjs', import.meta.url), 'utf8');
  assert.ok(src.includes("...(task.autonomy === 'preguntar' ? { autonomy: 'preguntar' } : {})"), 'the join task passes the level on');
});
