// Tareas on the PC as in the mock-up 03-tareas: filters are Orb's menus, the state tabs carry their counts, the rows' buttons
// are the 24 px ones, every call of an action is still there and the phone keeps its layout. Checked by reading the source.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';

const ROOT = join(import.meta.dirname, '..');
const read = (f) => readFileSync(join(ROOT, f), 'utf8');
const tasks = read('src/ui/views/tasks.jsx');
const pc = tasks.slice(tasks.indexOf('const PC_FILTERS'));
const rowActions = pc.slice(pc.indexOf('function RowActions'), pc.indexOf('// A row of the list'));

test('the project and agent filters are Orb menus, never the system select', () => {
  assert.doesNotMatch(tasks, /<select[\s>]/);
  assert.match(pc, /<Select value=\{project\}[^>]*data-testid="task-filter-project"/);
  assert.match(pc, /<Select value=\{agent\}[^>]*data-testid="task-filter-agent"/);
});

test('the state tabs are a segmented control with a counter and do not wrap', () => {
  for (const key of ['todas', 'encurso', 'aprobar', 'encola', 'incidencias', 'hechas']) assert.match(pc, new RegExp(`\\['${key}', 'tasks\\.filter\\.`), key);
  assert.match(pc, /<TabsList data-testid="task-filters">/);
  assert.match(pc, /<span className="n [^"]*tabular-nums">\{n\}<\/span>/);
});

test('the buttons of a row are the 24 px ones', () => {
  assert.ok((rowActions.match(/<Button size="xs"/g) ?? []).length >= 6);
  assert.match(rowActions, /<IconButton small /);
  assert.match(rowActions, /<MoreButton small /);
  assert.doesNotMatch(rowActions, /size="sm"|size="default"/);
});

test('the list and the panel use the pieces of the design system', () => {
  assert.match(pc, /<ListCard /);
  assert.match(pc, /<ListRow /);
  assert.match(pc, /<SectionLabel /);
  assert.match(pc, /<Empty /);
  assert.match(pc, /<ChatPanel /);
  assert.doesNotMatch(pc, /text-primary(?![-\w])/);
});

test('every action keeps its call, its parameters and its confirmation', () => {
  const actions = tasks.slice(tasks.indexOf('function taskActions'), tasks.indexOf('// A task read whole'));
  for (const piece of [
    "call('tasks.accept', { id: t.id })", "call('tasks.launchAnyway', { id: t.id })", "call('tasks.retry', { id: t.id })", "call('tasks.undo', { id: t.id })",
    "call('projects.merge', { name: t.project, branch: t.branch })", "call('tasks.discardBranch', { id: t.id })", "call('tasks.cancel', { id: t.id })",
    "call('tasks.reassign', { id: t.id, agent: v.agent,", "call('projects.createPr', { name: t.project, branch: t.branch, title: v.title, body: v.body })",
    "{ ok: tr('tasks.undo.ok'), danger: true }", "tr('tasks.undo.body')", "{ ok: tr('tasks.merge.ok'), danger: true }", "{ ok: tr('tasks.discard.ok'), danger: true }",
    "{ ok: tr('tasks.cancel.title'), cancel: tr('tasks.cancel.back'), danger: true }"
  ]) assert.ok(actions.includes(piece), piece);
  // approving and rejecting still go through the one place that signs exactly what is shown
  assert.match(pc, /onClick=\{run\(\(\) => approveTask\(t\)\)\}/);
  assert.match(pc, /onClick=\{run\(\(\) => rejectTask\(t\)\)\}/);
  const approval = read('src/ui/components/task-approval.jsx');
  assert.match(approval, /call\('tasks\.approve', \{ id: full\.id, decision: 'approved', hash: full\.previewHash \}\)/);
  assert.match(approval, /call\('tasks\.approve', \{ id: full\.id, decision: 'rejected', hash: full\.previewHash \}\)/);
  // «Deshacer» of a held task: the same confirmation as before
  const state = read('src/ui/components/task-state.jsx');
  assert.match(state, /confirm\(t\('tasks\.undo\.title'\), t\('tasks\.undo\.body'\), \{ ok: t\('tasks\.undo\.ok'\), danger: true \}\)/);
});

test('the phone and a linked browser keep their layout', () => {
  assert.match(tasks, /return fullPc\(\) \? <TasksPc route=\{route\} \/> : <TasksLegacy route=\{route\} \/>;/);
  assert.match(tasks, /if \(phone && route\.id != null\) return/);
  assert.match(tasks, /const FILTERS = \[/);
});

test('every data-testid the files had before is still there', () => {
  const files = ['src/ui/views/tasks.jsx', 'src/ui/components/task-approval.jsx', 'src/ui/components/task-changes.jsx', 'src/ui/components/task-state.jsx', 'src/ui/components/live-tasks.jsx'];
  for (const f of files) {
    let old; try { old = execFileSync('git', ['show', `d3324046:${f}`], { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }); } catch { continue; } // not a git checkout
    const now = read(f);
    for (const id of new Set([...old.matchAll(/data-testid="([^"]+)"/g)].map((m) => m[1]))) assert.ok(now.includes(`testid="${id}"`), `${f}: ${id}`);
  }
});

test('the texts the board adds exist in Spanish and in English', async () => {
  const { default: es } = await import('../src/shared/locales/es/tasks.mjs');
  const { default: en } = await import('../src/shared/locales/en/tasks.mjs');
  const used = new Set([...(tasks + read('src/ui/components/task-changes.jsx')).matchAll(/tr?\('((?:tasks|panel)\.[\w.]+)'/g)].map((m) => m[1]));
  for (const key of used) { assert.ok(key in es, `es ${key}`); assert.ok(key in en, `en ${key}`); }
});

test('step 6D: a held task cannot be accepted from its row, and the rows do not retry rejected or sensitive tasks', () => {
  assert.doesNotMatch(rowActions, /acceptHeld|task-row-accept/);
  assert.match(rowActions, /undoHeld\(tr, t\)/);
  const retry = rowActions.slice(rowActions.indexOf("['failed', 'blocked', 'limited']"));
  assert.match(retry, /^\['failed', 'blocked', 'limited'\]\.includes\(t\.status\) && !t\.sensitivity\?\.length\) return <Button[^\n]*task-row-retry/);
  assert.doesNotMatch(rowActions, /'cancelled'/);
});

test('step 6D: the panel of a held task keeps Retry, Reassign and Cancel, and its accept stays in the panel', () => {
  const detail = pc.slice(pc.indexOf('function TaskPanelDetail'), pc.indexOf('// The Cambios tab'));
  const held = detail.slice(detail.indexOf('{t.held ? (<>'), detail.indexOf('{!approval && !t.held'));
  assert.match(held, /<MoreActions items=\{more\}/);
  assert.match(held, /retryable \? <Button onClick=\{run\(retry\)\} data-testid="task-retry"/);
  assert.match(held, /acceptHeld\(tr, t\)[^\n]*task-held-accept/);
  assert.match(detail, /key: 'reassign'/);
  assert.match(detail, /key: 'cancel'/);
});

test('step 6D: the buttons of a list or panel are disabled while their action runs, so a double click cannot confirm twice', () => {
  assert.match(pc, /function useBusy\(\)/);
  assert.match(pc, /if \(lock\.current\) return undefined;/);
  assert.match(pc, /<TaskRow [^\n]*busy=\{busy\} run=\{run\} \/>/);
  const detail = pc.slice(pc.indexOf('function TaskPanelDetail'), pc.indexOf('// What a row of the list'));
  for (const piece of ['disabled={busy} onClick={run(merge)}', 'disabled={busy} onClick={run(discard)}', 'disabled={busy} onClick={run(undo)}', 'disabled={busy} onClick={run(cancel)}',
    'disabled={busy} onClick={run(() => approveTask(t))}', 'disabled={busy} onClick={run(() => rejectTask(t))}']) assert.ok(detail.includes(piece), piece);
  for (const piece of ['disabled={busy} onClick={run(() => undoHeld(tr, t))}', 'disabled={busy} onClick={run(() => approveTask(t))}', 'disabled={busy} onClick={run(() => rejectTask(t))}', 'disabled={busy} onClick={run(a.cancel)}']) assert.ok(rowActions.includes(piece), piece);
  // the confirmed calls are awaited so the lock lasts until they end
  for (const name of ['tasks.undo', 'projects.merge', 'tasks.discardBranch', 'tasks.cancel']) assert.ok(tasks.includes("await act(call('" + name + "'"), name);
});
