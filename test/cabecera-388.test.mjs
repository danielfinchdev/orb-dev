// Orb UI 2.0, step 4B: the header every view shares, the window's own buttons, the open-chats strip and the 100 % zoom.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const read = (f) => fs.readFileSync(root + f, 'utf8');
const css = read('src/ui/app.css');
const rule = (selector) => { const m = css.match(new RegExp(`(?:^|\\n)${selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} \\{([^}]*)\\}`)); assert.ok(m, `app.css has the rule ${selector}`); return m[1]; };

test('every view shares one 56 px header: clock, title with its line, actions', () => {
  const page = read('src/ui/components/page.jsx');
  const bar = read('src/ui/components/chat-bar.jsx');
  assert.match(page, /export function AppBar/);
  assert.match(page, /<div className="bar-left">/);
  assert.match(page, /<div className="bar-center">/);
  assert.match(page, /<div className="bar-right">/);
  assert.match(page, /<h1 className="name">\{title\}<\/h1>\{meta \? <div className="sub">/);
  assert.match(page, /left=\{center \? title : <BarClock \/>\}/, 'the clock starts every page header');
  assert.match(page, /<WindowControlsSlot \/>/);
  // the chat's header is the same bar
  assert.match(bar, /<AppBar /);
  assert.match(bar, /left=\{<BarClock \/>\}/);
  assert.match(rule('.bar'), /height: 56px/);
  assert.match(rule('.bar'), /grid-template-columns: minmax\(150px, 1fr\) minmax\(0, auto\) minmax\(150px, 1fr\)/);
  assert.match(rule('.bar-center .name'), /font-size: 15px/);
  assert.match(rule('.bar .sub'), /font-size: 12px/);
  assert.match(rule('.bar-clock-time'), /font-size: 18px/);
  // the palette button is an icon button on the right of the actions
  assert.match(page, /<IconButton label=\{t\('palette\.open'\)\}[^>]*data-testid="open-palette"/);
});

test('the clock shows seconds under the pointer and opens a month calendar with arrows and «Hoy»', () => {
  const clock = read('src/ui/components/bar-clock.jsx');
  assert.match(clock, /onPointerEnter=\{\(\) => setHover\(true\)\}/);
  assert.match(clock, /second: '2-digit'/);
  assert.match(clock, /chat\.calendarPrev/);
  assert.match(clock, /chat\.calendarNext/);
  assert.match(clock, /chat\.calendarToday/);
  assert.match(read('src/shared/locales/es/chat.mjs'), /'chat\.calendarToday': 'Hoy'/);
  assert.match(read('src/ui/components/conversation/bar.jsx'), /export \{ BarClock \} from '@\/components\/bar-clock\.jsx'/);
  assert.match(rule('.orb-cal'), /width: 252px/);
});

test('the window buttons are 32 px, close turns red and the header keeps 120 px for them', () => {
  assert.match(rule('.win-control'), /width: var\(--ctl\); height: var\(--ctl\); border-radius: var\(--r-ctl\)/);
  assert.match(rule('.win-control.win-close:hover'), /background-color: var\(--destructive\)/);
  assert.match(rule('.win-controls'), /height: 56px/);
  assert.match(css, /html\.has-win-controls \.bar \{ padding-right: 120px; \}/);
  assert.match(css, /html\.has-win-controls \{ --wco-inset: 7\.5rem; \}/);
  assert.match(css, /\.app-titlebar \{ -webkit-app-region: drag/);
  assert.match(read('src/ui/components/window-controls.jsx'), /data-testid=\{`window-\$\{action\}`\}/);
});

test('the open chats strip is 56 px, carries the window buttons and keeps how tabs behave', () => {
  const tabs = read('src/ui/components/chat-tabs.jsx');
  assert.match(tabs, /className="tabs-strip theme-band app-titlebar" data-testid="chat-tabs"/);
  assert.match(tabs, /<WindowControlsSlot \/>/);
  assert.match(tabs, /<AgentIcon agent=\{item\.agent\} \/>/);
  assert.match(tabs, /<LoaderCircle[^>]*animate-spin motion-reduce:animate-none/);
  assert.match(tabs, /<IconButton small tabIndex=\{-1\} label=\{t\('tabs\.close'/);
  assert.match(tabs, /T\.toggleSplit/);
  assert.match(rule('.tabs-strip'), /height: 56px/);
  assert.match(rule('.tabs-strip'), /padding: 0 120px 0 10px/);
  assert.match(rule('.otab'), /height: var\(--ctl\)/);
  assert.match(rule('.otab[data-on="true"]'), /background: var\(--accent\)/);
  assert.match(css, /html\.has-win-controls:has\(\.tabs-strip\) \.bar \{ padding-right: 10px; \}/);
});

test('«Normal» is the real 100 % and Ajustes offers four sizes', () => {
  const rs = read('src-tauri/src/protocol.rs');
  assert.match(rs, /pub const ZOOM_BASE: f64 = 1\.0;/);
  const rows = read('src/ui/views/settings/rows.jsx');
  const sizes = rows.match(/export const sizes = \(\) => \[(.*)\];/)[1];
  assert.deepEqual([...sizes.matchAll(/value: '([\d.]+)'/g)].map((m) => m[1]), ['0.9', '1', '1.1', '1.25']);
  assert.match(read('src/ui/views/settings/general.jsx'), /const SIZES = sizes\(\);/);
  for (const [lang, labels] of [['es', ['Pequeño (90 %)', 'Normal (100 %)', 'Grande (110 %)', 'Muy grande (125 %)']], ['en', ['Small (90%)', 'Normal (100%)', 'Large (110%)', 'Extra large (125%)']]]) {
    const text = read(`src/shared/locales/${lang}/settings.mjs`);
    for (const l of labels) assert.ok(text.includes(`'${l}'`), `${lang}: ${l}`);
  }
});

test('every data-testid the header, the tabs and the window buttons had is still there', () => {
  const files = ['chat-bar', 'page', 'window-controls', 'chat-tabs', 'bar-clock', 'conversation/bar'].map((f) => read(`src/ui/components/${f}.jsx`)).join('\n');
  for (const id of ['chat-back', 'open-palette', 'page-back', 'chat-tabs', 'split-divider', 'tabs-empty', 'bar-calendar', 'bar-calendar-next', 'bar-calendar-title', 'bar-clock', 'bar-pause', 'bar-resume', 'bar-title', 'bar-title-project', 'bar-title-text', 'chat-compact']) {
    assert.ok(files.includes(`data-testid="${id}"`), id);
  }
  for (const frag of ['data-testid={testid}', 'data-testid={`window-${action}`}', 'data-testid={`pane-${side}`}']) assert.ok(files.includes(frag), frag);
});
