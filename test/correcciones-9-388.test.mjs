// Ninth round of fidelity fixes: the task filters on a low laptop, the held card's path, «Ordenar carpetas» and an empty files.changed.
import './helpers.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from './helpers.mjs';
import { activitySentence } from '../src/ui/lib/activity.js';
import { shortPath } from '../src/shared/text.mjs';
import es from '../src/shared/locales/es.mjs';
import en from '../src/shared/locales/en.mjs';

const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const mk = (dict) => (k, v) => { let s = dict[k] ?? k; for (const [a, b] of Object.entries(v ?? {})) s = s.replaceAll(`{${a}}`, b); return s; };
const AGENTS = { claude: 'Claude', orb: 'Orb' };

test('1: the filter group scrolls instead of clipping, and keeps its right alignment', () => {
  const tasks = read('src/ui/views/tasks.jsx');
  const group = tasks.match(/<div className="([^"]*flex-\[1_1_440px\][^"]*)">/)?.[1] ?? '';
  assert.match(group, /overflow-x-auto/);
  assert.match(group, /\[scrollbar-width:none\]/);
  assert.match(group, /\[&>:first-child\]:ml-auto/);
  // justify-end overflows to the left, where nothing can scroll to it
  assert.doesNotMatch(group, /justify-end/);
});

test('2: the held card shows the folder cut in the middle, whole in the title', () => {
  const folder = 'C:\\Users\\danip\\AppData\\Local\\Temp\\orb-explora-Scxntq\\Proyectos\\blog';
  const short = shortPath(folder);
  assert.ok(short.length < folder.length && short.includes('…') && short.endsWith('blog'));
  for (const file of ['src/ui/views/tasks.jsx', 'src/ui/components/task-state.jsx']) {
    const src = read(file);
    assert.match(src, /folder: shortPath\(/, file);
    assert.match(src, /title=\{(?:t\.)?h(?:eld)?\.folder \|\| undefined\}/, file);
  }
  // the engine keeps the full folder in the text it stores
  assert.match(read('src/domain/tasks/board.mjs'), /\$\{h\.reasons\} en \$\{h\.folder\}/);
});

test('3: «Ordenar carpetas» marks what «Aplicar» does, and the MCP help is only for a server the user wrote', () => {
  const layout = read('src/ui/views/layout.jsx');
  // the initial choices are the plan's defaults, and «Aplicar» sends exactly them
  assert.match(layout, /Object\.fromEntries\(items\.map\(\(it\) => \[it\.id, it\.choice\]\)\)/);
  assert.match(layout, /value=\{shown\.some\(\(o\) => o\.value === choices\[it\.id\]\) \? choices\[it\.id\] : undefined\}/);
  assert.match(layout, /\{it\.project \? <> · \{t\('layout\.mcpProject'\)\}<\/> : null\}/);
  assert.match(es['layout.mcpProject'], /En core sigue funcionando/);
  assert.match(es['layout.mcpProject'], new RegExp(es['ext.edit']));
  assert.match(en['layout.mcpProject'], new RegExp(en['ext.edit']));
});

test('4: files.changed with no files reads «no cambió ningún archivo»', () => {
  const row = (detail) => ({ kind: 'files.changed', actor: 'orb', task: 7, title: 'Ordenar', detail, text: '' });
  for (const detail of ['ningún archivo', '', 'no files']) {
    assert.equal(activitySentence(mk(es), row(detail), 'es', AGENTS, 140), 'La tarea #7 «Ordenar» no cambió ningún archivo', detail);
    assert.equal(activitySentence(mk(en), row(detail), 'en', AGENTS, 140), 'Task #7 «Ordenar» changed no files', detail);
  }
  assert.match(activitySentence(mk(es), row('M src/a.js'), 'es', AGENTS, 140), /cambió archivos: src\/a\.js/);
});

test('1b: the state tabs wrap only in the narrow view; above it they scroll on one line, none squeezed', () => {
  const tabs = read('src/ui/views/tasks.jsx').match(/<TabsList className="([^"]*)" data-testid="task-filters"/)?.[1] ?? '';
  assert.match(tabs, /(^| )flex-nowrap( |$)/);
  assert.match(tabs, /@max-\[44rem\]\/tasks:flex-wrap/);
  assert.match(tabs, /\[&>\*\]:shrink-0/);
  assert.match(tabs, /(^| )px-1( |$)/);
});
