// 3.8.8 step 11b (batch 5), interface: what the Programadas mock-up draws and Orb lacked (monthly, zone, one dialog to
// create and edit, unsaved changes, run now, phone notice, permission level), and where Orb's own options went
// («Más opciones»). Reads the code as text.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (f) => fs.readFileSync(path.join(root, f), 'utf8');
const view = read('src/ui/views/schedules.jsx');
const es = read('src/shared/locales/es/schedules.mjs');
const en = read('src/shared/locales/en/schedules.mjs');
const more = view.slice(view.indexOf('data-testid="schedule-more-options"'), view.indexOf('</details>'));

test('«Cada mes» takes its place among the frequencies, «Cada N horas» goes under «Más opciones»', () => {
  assert.match(view, /const EVERY = \['hourly', 'daily', 'weekly', 'monthly', 'once'\];/);
  assert.match(view, /itemTestId=\{\(k\) => `schedule-every-\$\{k\}`\}/);
  assert.match(view, /data-testid="schedule-month-day"/);
  assert.match(view, /month_day: monthDayOf\(v\)/);
  assert.match(view, /t\('schedules\.sum\.monthly'/);
  assert.match(view, /schedules\.monthDayHint/, 'the help text says what a month without that day does');
  assert.match(es, /'schedules\.monthDayHint': '[^']*último día/);
  assert.match(en, /'schedules\.monthDayHint': '[^']*last day/);
  assert.ok(more.includes('testid="schedule-every-hours"') && more.includes('data-testid="schedule-hours"'));
  assert.ok(more.includes('testid="schedule-same-chat"'), '«Ejecutar siempre en el mismo chat» is under «Más opciones»');
  assert.ok(!view.slice(0, view.indexOf('data-testid="schedule-more-options"')).includes('testid="schedule-same-chat"'));
});

test('«Más opciones» is a fold at the end of the dialog that opens by itself when the schedule uses one of its options', () => {
  assert.match(view, /<details className="border-border rounded-\(--r-md\) border px-3 py-2" data-testid="schedule-more-options" open=\{more\}/);
  assert.match(view, /useState\(\(\) => first\.every === 'every_hours' \|\| first\.same_chat\)/);
  assert.ok(view.indexOf('data-testid="schedule-more-options"') > view.indexOf('testid="schedule-notify"'), 'it comes last');
  assert.match(es, /'schedules\.moreOptions': 'Más opciones'/);
  assert.match(en, /'schedules\.moreOptions': 'More options'/);
});

test('zone: a select of the zones the runtime knows, Orb zone by default, sent as tz', () => {
  assert.match(view, /Intl\.supportedValuesOf\('timeZone'\)/);
  assert.match(view, /data-testid="schedule-tz"/);
  assert.match(view, /tz: v\.tz \|\| null/);
  assert.match(view, /import \{ nextLocalRun, isValidTz \} from '\.\.\/\.\.\/shared\/tz\.mjs';/, 'the next run comes from the engine rule, daylight-saving included');
  assert.match(view, /zoneOf\(s\)/, 'a row shows the zone of its own time');
});

test('one dialog creates and edits: unsaved changes, asks before discarding, run now', () => {
  assert.match(view, /function ScheduleDialog\(\{ schedule = null/);
  assert.match(view, /onEdit=\{openDialog\}/);
  assert.match(view, /onClick=\{\(\) => onEdit\(s\)\}/);
  assert.doesNotMatch(view, /editSchedule|newSchedule/, 'the two old forms are gone');
  assert.match(view, /data-testid="schedule-unsaved"/);
  assert.match(view, /: Boolean\(v\.title\.trim\(\) \|\| v\.description\.trim\(\)\)/, 'a new schedule with text typed asks before it is thrown away');
  assert.match(view, /\{dirty \? <Badge variant="warning"/);
  assert.match(view, /if \(!o\) requestClose\(\)/, 'the X, Escape and the overlay go through the same question');
  assert.match(view, /danger: true/);
  assert.match(view, /schedules\.discard\.body/);
  assert.match(view, /data-testid="schedule-dialog-run"/);
  assert.match(view, /call\('schedules\.run', \{ id: schedule\.id \}\)/);
  assert.match(view, /if \(dirty && !\(await confirm\(tr\('schedules\.runDirty\.title'\)/, 'with unsaved changes it warns before running what is saved');
  // an edit sends only what changed (a «once» schedule that already ran can still be renamed)
  assert.match(view, /for \(const \[watch, send\] of groups\) if \(changed\(\.\.\.watch\)\)/);
  assert.match(view, /method: 'schedules\.update'/);
  for (const l of [es, en]) for (const k of ['unsaved', 'discard.title', 'discard.body', 'discard.ok', 'discard.keep', 'runDirty.title', 'runDirty.body']) assert.ok(l.includes(`'schedules.${k}'`), k);
});

test('permission level: only «Lo seguro» and «Preguntar todo», never drawn on the phone page, with the real wait', () => {
  assert.match(view, /\{bridge\.mobile \? null : \(\s*<div[^>]*data-testid="schedule-permissions"/);
  assert.match(view, /data-testid="schedule-permission"/);
  assert.match(view, /\{ value: 'auto', label: tr\('schedules\.perm\.auto', \{ level \}\) \}, \{ value: 'preguntar'/);
  assert.match(view, /session\.askMode' : 'session\.autoMode'/, 'the label names the real level of Ajustes');
  assert.match(es, /'schedules\.perm\.auto': 'Como en Ajustes \(\{level\}\)'/);
  assert.match(en, /'schedules\.perm\.auto': 'As in Settings \(\{level\}\)'/);
  assert.match(view, /app\?\.approvalWaitMinutes/, 'the wait comes from the engine (rail paused = no limit)');
  assert.match(read('src/engine/api/index.mjs'), /approvalWaitMinutes: approvalWaitMinutes\(\)/);
  assert.doesNotMatch(view, /\{ value: 'auto', label: tr\('schedules\.perm\.auto'\) \}/);
  assert.match(view, /\{ value: 'auto', label: tr\('schedules\.perm\.auto', \{ level \}\) \}, \{ value: 'preguntar', label: tr\('schedules\.perm\.ask'\) \}/);
  assert.doesNotMatch(view, /value: 'total'|'ninguno'|value: 'none'/, 'no level that skips the guard');
  assert.match(view, /\.\.\.\(bridge\.mobile \? \{\} : \{ autonomy:/);
  assert.match(view, /approvalWaitMinutes/, 'the wait is the one of Ajustes, not a made-up one');
  assert.doesNotMatch(es, /30 min/);
});

test('phone notice: a switch that is on by default and says what it does', () => {
  assert.match(view, /testid="schedule-notify"/);
  assert.match(view, /notify: s \? Boolean\(s\.notify_mobile\) : true/);
  assert.match(es, /Apágalo para que esta programada no avise/);
  assert.match(en, /Turn it off so this schedule does not notify/);
  assert.match(view, /notify_mobile: v\.notify/);
  assert.match(es, /'schedules\.notifyLab': 'Aviso al móvil al terminar'/);
  assert.match(es, /'schedules\.notifyHint': '[^']*bien o mal, llega un aviso/);
  assert.match(en, /'schedules\.notifyHint': '[^']*a notice reaches the linked phone/);
});

test('every text the dialog uses exists in Spanish and English; colours follow UI 2.0', () => {
  const keys = new Set([...view.matchAll(/\btr?\('(schedules\.[\w.]+)'/g)].map((m) => m[1]));
  for (const every of ['hourly', 'daily', 'weekly', 'monthly', 'once']) keys.add(`schedules.every.${every}`);
  for (const k of keys) { assert.ok(es.includes(`'${k}'`), `es: ${k}`); assert.ok(en.includes(`'${k}'`), `en: ${k}`); }
  assert.doesNotMatch(view, /\btext-primary\b(?!-)/, 'the accent is --primary-text');
  assert.doesNotMatch(view, /<select\b/, 'menus of Orb, never the system select');
});

test('the files keep LF line endings', () => {
  for (const f of ['src/ui/views/schedules.jsx', 'src/domain/schedules/schedules.mjs', 'src/engine/api/work.mjs', 'test/programadas-11b-388.test.mjs', 'test/motor-11b-programadas-388.test.mjs']) assert.ok(!read(f).includes('\r'), f);
});

test('«Últimas ejecuciones» has its runs: the compact list of tasks keeps the schedule of each, and their result is read apart', () => {
  // the window's list of tasks is the compact feed: without schedule_id no run was ever listed
  const feeds = read('src/engine/feeds.mjs');
  const detailOnly = feeds.slice(feeds.indexOf('const TASK_DETAIL_ONLY'), feeds.indexOf('];', feeds.indexOf('const TASK_DETAIL_ONLY')));
  assert.ok(!detailOnly.includes("'schedule_id'"), 'schedule_id travels in the list');
  assert.ok(detailOnly.includes("'result'"), 'the texts stay out of the list');
  const view = read('src/ui/views/schedules.jsx');
  assert.ok(view.includes('const runs = tasks.filter((x) => x.schedule_id)'));
  assert.ok(view.includes("call('tasks.get', { id: x.id })"), 'the first line of a run comes from its detail');
  assert.ok(view.includes('resultOf(x) ||'));
});
