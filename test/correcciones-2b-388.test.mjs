// Fidelity fixes, second round, part B: pure helpers by behaviour, the views by their source.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { zoneLabel, whenLabel } from '../src/ui/lib/zone-label.js';
import { shortDate, monthGrid, addDays, fromIso, toIso, inRange } from '../src/ui/lib/date-field.js';

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const schedules = read('src/ui/views/schedules.jsx');
const page = read('src/ui/views/project-page.jsx');
const whiteboard = read('src/ui/views/whiteboard.jsx');
const activity = read('src/ui/views/activity.jsx');

test('zoneLabel: Spanish translates the continent and spaces the city; English is left alone', () => {
  assert.equal(zoneLabel('Europe/Madrid', 'es'), 'Europa/Madrid');
  assert.equal(zoneLabel('America/Argentina/Buenos_Aires', 'es-ES'), 'América/Argentina/Buenos Aires');
  assert.equal(zoneLabel('Atlantic/Canary', 'es'), 'Atlántico/Canary');
  assert.equal(zoneLabel('Indian/Maldives', 'es'), 'Índico/Maldives');
  assert.equal(zoneLabel('Antarctica/Troll', 'es'), 'Antártida/Troll');
  assert.equal(zoneLabel('UTC', 'es'), 'UTC');
  assert.equal(zoneLabel('America/New_York', 'en'), 'America/New_York');
});

test('whenLabel: the engine wording reads as a sentence with an unpadded hour', () => {
  assert.equal(whenLabel('cada lunes a las 09:00'), 'Cada lunes a las 9:00');
  assert.equal(whenLabel('cada día a las 10:30'), 'Cada día a las 10:30');
  assert.equal(whenLabel(''), '');
});

test('programada: the dialog keeps the order summary, Solo lectura, Permisos and Más opciones last, and rows do not squash', () => {
  const at = (needle) => schedules.indexOf(needle);
  assert.ok(at('data-testid="schedule-summary"') < at('testid="schedule-readonly"'));
  assert.ok(at('testid="schedule-readonly"') < at('data-testid="schedule-permissions"'));
  assert.ok(at('data-testid="schedule-permissions"') < at('data-testid="schedule-more-options"'));
  assert.match(schedules, /<DialogBody className="flex flex-col gap-4 p-\[18px\] pr-\[calc\(18px-var\(--sb-w\)\)\] \[scrollbar-gutter:stable\] \[&>\*\]:shrink-0/, 'the body is a column whose children keep their height (a grid squashed the card)');
  assert.match(schedules, /max-h-\[calc\(100vh-50px\)\]/);
});

test('programada nueva: frequency at its content width, 80 px instructions, no clock icon, the zone as «Europa/Madrid (UTC+1)»', () => {
  assert.match(schedules, /<Segmented className="justify-self-start"/);
  assert.match(schedules, /<Textarea className="min-h-20"/);
  assert.match(schedules, /type="time" className="\[&::-webkit-calendar-picker-indicator\]:hidden"/);
  assert.match(schedules, /zoneLabel\(z, currentLocale\(\)\)\} \(\$\{offset\(z\)\}\)/);
  assert.match(schedules, /const tz = zoneLabel\(zone, currentLocale\(\)\)/, 'the summary names the zone the same way');
  assert.match(schedules, /nextOccurrence\(v, zone\)/, 'the next run is still computed with the IANA name');
});

test('lista de programadas: the zone and the wording of the timing follow the mock-up', () => {
  assert.match(schedules, /whenLabel\(s\.when\)\} \(\$\{zoneLabel\(zoneOf\(s\), currentLocale\(\)\)\}\)/);
});

test('proyecto: the first row of the summary cards keeps the rule under the title', () => {
  // the task rows and the chat rows: both open what they show, so both carry the pointer
  assert.equal(page.match(/'border-border cursor-pointer rounded-none border-t', compact \? 'px-0 py-2' : 'first:border-t-0'/g)?.length, 2);
});

test('pizarra: no picker in the header; the project list is in ⋯ and uses projects.setActive', () => {
  assert.doesNotMatch(whiteboard, /<Select /);
  assert.match(whiteboard, /<DropdownMenuLabel data-testid="project-picker">/);
  assert.match(whiteboard, /projects\.setActive/);
});

test('shortDate: hoy, ayer, day and month, with the year only when it is not this one', () => {
  const today = new Date(2026, 10, 18, 9);
  const labels = { today: 'hoy', yesterday: 'ayer' };
  assert.equal(shortDate('2026-11-18', { today, labels }), 'hoy');
  assert.equal(shortDate('2026-11-17', { today, labels }), 'ayer');
  assert.equal(shortDate('2026-11-05', { today, labels, locale: 'es' }), '5 nov');
  assert.match(shortDate('2025-03-02', { today, labels, locale: 'es' }), /^2 mar 2025$/);
  assert.equal(shortDate('', { today, labels }), '');
  assert.equal(shortDate('2026-02-31', { today, labels }), '');
});

test('date helpers: month grid, day steps and ranges', () => {
  const grid = monthGrid(2026, 10, 1); // November 2026 starts on a Sunday; weeks start on Monday
  assert.ok(grid.every((w) => w.length === 7));
  assert.deepEqual(grid[0].slice(0, 6), [null, null, null, null, null, null]);
  assert.equal(grid[0][6], '2026-11-01');
  assert.equal(grid.flat().filter(Boolean).length, 30);
  assert.equal(addDays('2026-11-30', 1), '2026-12-01');
  assert.equal(addDays('2026-01-01', -1), '2025-12-31');
  assert.equal(toIso(fromIso('2026-11-05')), '2026-11-05');
  assert.equal(fromIso('2026-13-01'), null);
  assert.equal(inRange('2026-11-05', '2026-11-06', ''), false);
  assert.equal(inRange('2026-11-05', '', '2026-11-05'), true);
});

test('actividad: two date fields with the same testids and the same ISO values; no native date input', () => {
  assert.doesNotMatch(activity, /type="date"/);
  assert.match(activity, /<DateField [^>]*onChange=\{\(from\) => set\(\{ from \}\)\} data-testid="activity-from"/);
  assert.match(activity, /<DateField [^>]*onChange=\{\(to\) => set\(\{ to \}\)\} data-testid="activity-to"/);
  const field = read('src/ui/components/date-field.jsx');
  for (const k of ['ArrowLeft', 'ArrowDown', 'PageUp']) assert.ok(field.includes(k), k);
  assert.match(field, /logbooks\.dateClear/);
});
