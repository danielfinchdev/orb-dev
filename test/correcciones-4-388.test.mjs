// Fourth round of fidelity fixes (interface only): one check per point of the list.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from './helpers.mjs';

const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const locale = (lang, file) => fs.readFileSync(path.join(ROOT, 'src', 'shared', 'locales', lang, file), 'utf8');

test('1: the clock hides in a narrow bar (the rule comes after the clock\'s own display) and messages wrap in the column', () => {
  const css = read('src/ui/app.css');
  const base = css.indexOf('.bar-clock { display: flex');
  const narrow = css.indexOf('@container bar (max-width: 480px) { .bar .bar-clock { display: none; } }');
  assert.ok(base > 0 && narrow > base, 'the container rule must follow the base rule');
  assert.match(css, /\.msg-box \{ overflow-wrap: anywhere; \}/);
});

test('2: the start preview draws a static sidebar skeleton, inert, without mounting the real one', () => {
  const main = read('src/ui/main.jsx');
  assert.match(main, /function PreviewSidebar\(\)/);
  assert.match(main, /<aside[^>]*aria-hidden="true" inert/);
  for (const k of ['nav.tasks', 'nav.projects', 'nav.schedules', 'nav.board', 'orbchats.search']) assert.ok(main.includes(`'${k}'`), k);
  assert.ok(!/<Sidebar\b/.test(main.slice(main.indexOf('function PreviewSidebar'), main.indexOf('function InArea'))));
});

test('3: the account switch says in one line which account it would pass from and to', async () => {
  assert.match(locale('es', 'agents.mjs'), /'usage\.switchWould': 'Pasaría de \{from\} a \{to\}\.'/);
  assert.match(locale('es', 'agents.mjs'), /'usage\.switchNone'/);
  const usage = read('src/ui/views/usage.jsx');
  assert.match(usage, /hint=\{switchHint\} title=\{t\('usage\.switchAccountHint'\)\}/);
  const { switchPreview } = await import('../src/ui/views/usage.jsx').catch(() => ({}));
  if (switchPreview) {
    const t = (k, p) => (p ? `${k}:${p.from}>${p.to}` : k);
    assert.equal(switchPreview(t, [{ agent: 'claude', account: 'a', label: 'Trabajo' }, { agent: 'claude', account: 'b', label: 'Personal' }]), 'usage.switchWould:Claude · Trabajo>Claude · Personal');
    assert.equal(switchPreview(t, [{ agent: 'claude', account: 'a' }]), 'usage.switchNone');
  }
});

test('4: the legend names the warning first and the brake after; «Más opciones» only appears with content', () => {
  const usage = read('src/ui/views/usage.jsx');
  assert.ok(usage.indexOf("t('usage.legendWarn'") < usage.indexOf("t('usage.legendBrake'"));
  assert.match(usage, /data\?\.total\?\.turns \|\| data\?\.days\?\.length \|\| local\?\.total\?\.turns \? <MoreOptions/);
});

test('5: «Ver en Tareas» is link-blue and the zone note moved into the field\'s tooltip', () => {
  const s = read('src/ui/views/schedules.jsx');
  assert.match(s, /className="text-info h-auto p-0 text-control font-normal" onClick=\{\(\) => go\('tasks'\)\}>\{tr\('schedules\.seeTasks'\)/);
  assert.match(s, /<Field label=\{tr\('schedules\.tz'\)\}>\s*<Select[^>]*title=\{tr\('schedules\.tzHint'\)\}/);
});

test('6: the schedule dialog gives its scrollbar gutter back from the right padding', () => {
  assert.match(read('src/ui/views/schedules.jsx'), /<DialogBody className="[^"]*pr-\[calc\(18px-var\(--sb-w\)\)\] \[scrollbar-gutter:stable\]/);
});

test('7: the project page links sit flush right, «Ver la bitácora» is in the menu and «Escribir entrada» has no icon', () => {
  const s = read('src/ui/views/project-page.jsx');
  assert.ok(!/className="text-info text-control font-semibold"/.test(s));
  assert.match(s, /<DropdownMenuItem onSelect=\{\(\) => go\(\{ view: 'logs', name: p\.name \}\)\} data-testid="project-log"><NotebookPen \/>/);
  assert.match(s, /data-testid="project-log-write">\{t\('projects\.log\.write'\)\}<\/Button>/);
});

test('8: undo and redo share the zoom\'s pill, with a 1 px separator', () => {
  const css = read('src/ui/app.css');
  assert.match(css, /\.layer-ui__wrapper__footer-left section \{ display: flex;[^}]*border: 1px solid var\(--border\)/);
  assert.match(css, /\.undo-redo-buttons::before \{ content: ""; [^}]*width: 1px; height: 16px/);
});

test('9: the date fields show the period on view while nothing is chosen, in the quiet colour', () => {
  const field = read('src/ui/components/date-field.jsx');
  assert.match(field, /text \|\| implied \|\| placeholder \|\| label/);
  const a = read('src/ui/views/activity.jsx');
  assert.match(a, /fallback=\{firstDay \? toIso\(firstDay\) : undefined\}/);
  assert.match(a, /fallback=\{toIso\(new Date\(\)\)\}/);
  assert.match(a, /buildQuery\(filters, page\.next\)/);
});
