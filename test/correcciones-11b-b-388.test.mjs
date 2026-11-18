// Fidelity fixes 11b (part B): read from the source, like the neighbouring *-388 tests.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const dialogs = read('src/ui/components/dialogs.jsx');
const overlay = read('src/ui/components/ui/overlay.jsx');
const page = read('src/ui/views/project-page.jsx');
const list = read('src/ui/views/projects-pc.jsx');
const schedules = read('src/ui/views/schedules.jsx');
const tasks = read('src/ui/views/tasks.jsx');
const actions = read('src/ui/components/project-actions.jsx');
const locale = async (l) => (await import(`../src/shared/locales/${l}/comp.mjs`)).default;

test('2: the project header keeps the right group wide and truncates the path with its full text in the title', () => {
  assert.match(page, /\[&\.bar\]:grid-cols-\[minmax\(max-content,1fr\)_minmax\(0,auto\)_minmax\(max-content,1fr\)\]!/);
  assert.match(page, /<span className="min-w-0 truncate" title=\{p\.path\}/);
  assert.match(page, /<span className="shrink-0">\{chatsN\}<\/span>/);
});

test('4: the body of a dialog that scrolls fades its bottom edge while more waits below', () => {
  assert.match(overlay, /export function DialogBody/);
  assert.match(overlay, /scrollHeight - el\.scrollTop - el\.clientHeight/);
  assert.match(overlay, /data-slot="dialog-more"/);
  assert.match(overlay, /linear-gradient\(to top, var\(--background\), transparent\)/);
  for (const [name, src] of [['dialogs', dialogs], ['schedules', schedules]]) assert.match(src, /<DialogBody /, name);
});

test('13a: small dialogs are 440 px, the wide ones keep their own size, and a dialog can leave out its ✕', () => {
  assert.match(dialogs, /size=\{d\.wide \? undefined : 'sm'\}/);
  assert.match(overlay, /size === 'sm' \? 'sm:max-w-\[440px\]'/);
  assert.match(dialogs, /showClose=\{!d\.noClose\}/);
  for (const fn of ['confirm', 'choose', 'form']) assert.match(dialogs, new RegExp(`export const ${fn} = .*noClose`), fn);
  // the schedule dialog is wide on purpose
  assert.match(schedules, /data-testid="schedule-dialog"/);
  assert.match(schedules, /sm:max-w-2xl/);
});

test('15: «Crear proyecto» has no subtitle, says «Crear» and shows where the folder goes under the category', async () => {
  const es = await locale('es');
  const en = await locale('en');
  assert.equal(es['comp.projects.newTitle'], 'Crear proyecto');
  assert.equal(es['comp.projects.create'], 'Crear');
  assert.equal(en['comp.projects.newTitle'], 'Create project');
  assert.equal(en['comp.projects.create'], 'Create');
  assert.match(es['comp.projects.folderHint'], /^Va a \{path\}$/);
  assert.ok(!('comp.projects.newDesc' in es) && !('comp.projects.newDesc' in en));
  const flow = actions.slice(actions.indexOf('export async function createProjectFlow'), actions.indexOf('export async function linkFolderFlow'));
  assert.ok(!flow.includes('newDesc'));
  assert.match(flow, /<CategoryField v=\{v\} set=\{set\} hint=\{folderHint\(v\)\} \/>/);
});

test('16: the section links are 13 px semibold and the «Nuevo proyecto» button and the rows follow the mock-up', () => {
  assert.equal((page.match(/text-info px-0 text-control font-semibold/g) ?? []).length, 4);
  assert.match(list, /className="gap-1\.5 \[&_svg:not\(\[class\*=size-\]\)\]:size-3\.5" data-testid="project-new"/);
  assert.match(list, /leading-\[17\.4px\]/);
});

test('17: the schedule dialog has normal-weight labels and «Permisos» outside «Más opciones»; the row shows the model', () => {
  assert.match(schedules, /\[&_label\]:font-normal/);
  const more = schedules.slice(schedules.indexOf('data-testid="schedule-more-options"'), schedules.indexOf('<FieldError>{error}</FieldError>\n          </DialogBody>'));
  assert.ok(!more.includes('schedule-permissions'));
  assert.ok(schedules.indexOf('schedule-readonly') < schedules.indexOf('schedule-permissions'));
  assert.ok(schedules.indexOf('schedule-permissions') < schedules.indexOf('schedule-more-options'));
  assert.match(schedules, /const brain = \(s\.model && modelsOf\(/);
});

test('18: the signature row is neutral; only an invalid one is coloured', () => {
  const row = tasks.slice(tasks.indexOf('data-testid="task-sign"'), tasks.indexOf('data-testid="task-sign"') + 260);
  assert.ok(!row.includes('text-success'));
  assert.match(row, /'invalid' \? 'text-warning-ink'/);
});
