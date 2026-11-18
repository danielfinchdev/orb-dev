// 3.8.8 paso 11b (tanda 3), interfaz de Tareas: la fila «Firma», la pestaña Cambios siempre visible con su estado vacío,
// «Abrir en el editor» un archivo y su línea, y «Antes» / «Después» con el archivo entero (se pide solo al elegir ese modo).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileRows, fileTooLong, firstChangeLine, MAX_FILE_LINES } from '../src/ui/lib/patch-rows.js';
import { emptyReason, diffOf } from '../src/ui/lib/changes-empty.js';
import es from '../src/shared/locales/es.mjs';
import en from '../src/shared/locales/en.mjs';

const read = (p) => fs.readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const tasks = read('src/ui/views/tasks.jsx');
const changes = read('src/ui/components/task-changes.jsx');
const tools = read('src/ui/components/project-tools.jsx');
const view = read('src/ui/components/patch-view.jsx');

test('Firma: la fila sale de tasks.get (approval) y pinta cada estado con sus palabras', () => {
  assert.match(tasks, /t\.approval \? <KvRow icon=\{BadgeCheck\} label=\{tr\('tasks\.sign'\)\}/);
  assert.match(tasks, /data-testid="task-sign"/);
  for (const k of ['verified', 'invalid', 'unknown', 'unsigned', 'none']) for (const l of [es, en]) assert.ok(l[`tasks.sign.${k}`], `tasks.sign.${k}`);
  assert.match(es['tasks.sign.verified'], /firma verificada/);
});

test('Cambios: la pestaña está siempre y su estado vacío dice el porqué real', () => {
  assert.match(tasks, /\{ value: 'changes', icon: FileDiff, label: tr\('tasks\.panel\.changes'\), testid: 'task-panel-tab-changes' \}/);
  assert.doesNotMatch(tasks, /\.\.\.\(diff \? \[\{ value: 'changes'/);
  assert.match(tasks, /<ChangesEmpty task=\{t\} raw=\{raw\} canUndo=\{canUndo\} \/>/);
  const task = (o) => ({ status: 'done', hasCheckpoint: true, undone: null, ...o });
  assert.equal(emptyReason(task({ status: 'running', hasCheckpoint: false }), null, false), 'notDone');
  assert.equal(emptyReason(task({ status: 'queued', hasCheckpoint: false }), null, false), 'notDone');
  assert.equal(emptyReason(task({ hasCheckpoint: false }), null, false), 'nophoto');
  assert.equal(emptyReason(task(), null, false), 'loading');
  assert.equal(emptyReason(task(), { available: true, files: [], more: 0 }, true), 'unchanged');
  assert.equal(emptyReason(task(), { available: false, reason: 'nogit', files: [] }, true), 'nogitUndo');
  assert.equal(emptyReason(task(), { available: false, reason: 'nogit', files: [] }, false), 'nogit');
  assert.equal(emptyReason(task(), { available: false, reason: 'gone', files: [] }, true), 'gone');
  assert.equal(emptyReason(task({ undone: { at: 'x' } }), { available: false, files: [] }, false), 'undone');
  assert.equal(diffOf({ available: true, files: [] }), null);
  // a finished task whose final photo failed cannot say «not finished»; one still waiting or running can
  const noAfter = { available: false, reason: 'notdone', files: [] };
  assert.equal(emptyReason(task({ status: 'done' }), noAfter, false), 'nophotoAfter');
  assert.equal(emptyReason(task({ status: 'failed' }), noAfter, false), 'nophotoAfter');
  for (const status of ['queued', 'awaiting_approval', 'waiting', 'running']) assert.equal(emptyReason(task({ status }), noAfter, false), 'notDone', status);
  // only secret-looking files changed: not «no changes»
  assert.equal(emptyReason(task(), { available: true, files: [], more: 0, hidden: 2 }, true), 'protected');
  assert.equal(emptyReason(task(), { available: true, files: [], more: 0, hidden: 0 }, true), 'unchanged');
  assert.equal(emptyReason(task(), { available: true, files: [], more: 0 }, true), 'unchanged');
  assert.match(changes, /empty\.protected\$\{raw\.hidden === 1/);
  for (const l of [es, en]) {
    assert.ok(l['tasks.changes.empty.nophotoAfter']);
    for (const k of ['protectedOne', 'protectedOther']) assert.ok(l[`tasks.changes.empty.${k}`].includes('{n}'), k);
  }
  for (const k of ['notDone', 'unchanged', 'nogit', 'nogitUndo', 'nophoto', 'gone', 'undone', 'error']) for (const l of [es, en]) assert.ok(l[`tasks.changes.empty.${k}`], k);
});

test('Abrir en el editor: un botón junto a «Visto» con el archivo y su primera línea cambiada', () => {
  // never for a deleted file; an isolated task not joined yet opens its own folder
  assert.match(changes, /fileProject && f\.status !== 'D' \? <OpenFileButton project=\{fileProject\} file=\{f\.path\} line=\{firstChangeLine\(f\.patch\)\} \/>/);
  assert.match(changes, /fileProject = proj && workdir \? \{ \.\.\.proj, path: workdir \} : proj/);
  assert.match(tasks, /workdir=\{t\.branch && t\.workdir \? t\.workdir : undefined\}/);
  assert.match(tools, /data-testid="open-file-in"/);
  assert.match(tools, /bridge\.openFileIn\(first, project\.path, file, line\)/);
  assert.match(read('src/ui/lib/tauri-bridge.js'), /openFileIn: .*'app\.openFileIn'/);
  const patch = ['diff --git a/s b/s', '--- a/s', '+++ b/s', '@@ -1,4 +1,5 @@', ' one', '-two', '+TWO', ' three'].join('\n');
  assert.equal(firstChangeLine(patch), 2);
  assert.equal(firstChangeLine(''), null);
});

test('Antes / Después enteros: se piden solo con el modo elegido y el archivo abierto', () => {
  assert.match(changes, /const wantFile = taskId != null && !f\.binary && \(side === 'before' \|\| whole\);/);
  assert.match(changes, /useWholeFile\(taskId, f\.path, wantFile\)/);
  assert.match(changes, /if \(!enabled\) return undefined;/);
  assert.match(changes, /call\('tasks\.diff', \{ id: taskId, file: path \}\)/);
  assert.match(changes, /data-testid="task-change-whole"/);
  assert.match(view, /export function FileView/);
  // the testids of today stay
  for (const id of ['task-changes-unified', 'task-changes-split', 'task-changes-after', 'task-changes-before', 'task-change-seen', 'task-changes-search']) assert.ok(changes.includes(id), id);
});

test('fileRows: el archivo entero con sus números y las líneas cambiadas marcadas', () => {
  const patch = ['@@ -1,3 +1,3 @@', ' one', '-two', '+2', ' three'].join('\n');
  const after = fileRows('one\n2\nthree\n', patch, 'after');
  assert.deepEqual(after.map((r) => [r.newNo, r.kind, r.body]), [[1, 'ctx', 'one'], [2, 'add', '2'], [3, 'ctx', 'three']]);
  const before = fileRows('one\ntwo\r\nthree\n', patch, 'before');
  assert.deepEqual(before.map((r) => [r.oldNo, r.kind, r.body]), [[1, 'ctx', 'one'], [2, 'del', 'two'], [3, 'ctx', 'three']]);
  assert.deepEqual(fileRows('', patch, 'after'), []);
});

test('fileRows: un archivo de más de 8000 líneas no se dibuja entero', () => {
  const lines = (n) => Array.from({ length: n }, (_, i) => `l${i}`).join('\n');
  assert.equal(MAX_FILE_LINES, 8000);
  assert.equal(fileRows(lines(8000), '', 'after').length, 8000);
  assert.equal(fileRows(lines(8001), '', 'after'), null);
  assert.equal(fileRows(`${lines(8000)}\n`, '', 'after').length, 8000);
  assert.equal(fileTooLong(`${lines(8001)}\n`), true);
  assert.match(changes, /fileTooLong\(wf\.file\[side\]\)/);
  for (const l of [es, en]) assert.ok(l['tasks.changes.fileLong']);
});

test('useTaskDiffRaw vacía lo cargado al cambiar de tarea', () => {
  assert.match(changes, /setRaw\(null\); \/\/ never the previous task/);
});

test('los textos nuevos están en español y en inglés', () => {
  for (const k of ['tasks.sign', 'tasks.changes.whole', 'tasks.changes.fileLoading', 'tasks.changes.fileFailed', 'tasks.changes.fileBig', 'tasks.changes.noBefore', 'tasks.changes.noAfter', 'tools.openFile', 'tools.openFileIn', 'msg.api.fileNotInDiff']) {
    assert.ok(es[k] && en[k], k);
  }
});
