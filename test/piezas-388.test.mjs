// The shared pieces (components/ui, project dot, agent marks) follow the approved mock-up: heights, radii, the switch,
// the range, a stable project dot and no hand-written colours outside themes/pieces.css.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = (p) => fs.readFileSync(new URL(`../src/ui/${p}`, import.meta.url), 'utf8');
const files = ['components/ui/button.jsx', 'components/ui/basic.jsx', 'components/ui/overlay.jsx', 'components/ui/primitives.jsx', 'components/project-icon.jsx', 'components/agent-icon.jsx'];

test('buttons use the control heights of the tokens and the control radius', () => {
  const b = read('components/ui/button.jsx');
  assert.match(b, /rounded-ctl/);
  assert.match(b, /default: 'h-\(--ctl\) px-3'/);
  assert.match(b, /xs: 'h-\(--ctl-sm\)/);
  assert.match(b, /icon: 'size-\(--ctl\)'/);
  assert.match(b, /'icon-xs': 'size-\(--ctl-sm\)/);
  assert.match(b, /text-control/);
  for (const v of ['default', 'outline', 'ghost', 'soft', 'danger', 'destructive', 'secondary', 'link', 'warn']) assert.match(b, new RegExp(`${v}: '`), v);
});

test('inputs, cards and menus take their radii from the tokens, never a fixed pixel radius', () => {
  const all = files.map(read).join('\n');
  assert.doesNotMatch(all, /rounded-\[\d+px\]/);
  assert.match(read('components/ui/basic.jsx'), /h-\(--ctl\)/);
  assert.match(read('components/ui/basic.jsx'), /rounded-card/);
  assert.match(read('components/ui/overlay.jsx'), /rounded-card/);
  assert.match(read('components/ui/primitives.jsx'), /h-\(--ctl-sm\)/);
});

test('the switch is 32 x 18 with a 14 px thumb that slides and turns on in --primary-text', () => {
  const o = read('components/ui/overlay.jsx');
  const sw = o.slice(o.indexOf('export function Switch'), o.indexOf('export function Checkbox'));
  assert.match(sw, /h-\[18px\] w-8/);
  assert.match(sw, /data-\[state=checked\]:bg-primary-text/);
  assert.match(sw, /size-3\.5 data-\[state=checked\]:translate-x-3\.5/);
  assert.match(sw, /transition-transform/);
  assert.match(sw, /dark:data-\[state=unchecked\]:bg-foreground/);
});

test('Range exists and pieces.css draws the mock-up slider', () => {
  assert.match(read('components/ui/overlay.jsx'), /export function Range\(/);
  const css = read('themes/pieces.css');
  assert.match(css, /\.range \{[^}]*height: 16px/);
  assert.match(css, /::-webkit-slider-thumb \{[^}]*width: 14px; height: 14px/);
  assert.match(css, /var\(--primary-text\) var\(--v\)/);
});

test('a project dot is always the same for a name and differs between names', () => {
  const src = read('components/project-icon.jsx');
  const m = src.match(/export function projectGradient\(name\) \{[\s\S]*?\n\}\n/);
  assert.ok(m, 'projectGradient');
  const projectGradient = new Function(`${m[0].replace('export ', '')}; return projectGradient;`)();
  assert.equal(projectGradient('orb-dev'), projectGradient('orb-dev'));
  const names = ['orb-dev', 'erp-polo-group', 'kill', 'hello-world-destruccion', 'open-control-edge'];
  assert.equal(new Set(names.map(projectGradient)).size, names.length);
  assert.match(projectGradient('orb-dev'), /^linear-gradient\(\d+deg,hsl\(\d+ 95% 58%\),hsl\(\d+ 90% 52%\)\)$/);
  assert.match(src, /cn\('pj'/);
  assert.doesNotMatch(src, /initials\(name\)\}</, 'no initials inside the dot');
});

test('the agent mark has no background and is 12 px in rows', () => {
  const src = read('components/agent-icon.jsx');
  assert.match(src, /'ag size-3 shrink-0'/);
  assert.doesNotMatch(src, /\bbg-/);
});

test('no piece writes a colour by hand (the brand colours of the marks live in pieces.css)', () => {
  for (const f of files) assert.doesNotMatch(read(f), /#[0-9a-fA-F]{3,8}\b|\brgb\(|\boklch\(/, f);
  assert.match(read('themes/pieces.css'), /data-agent="claude"/);
});

test('the dialog has the scrim, header, body and footer of the mock-up and keeps its animations', () => {
  const o = read('components/ui/overlay.jsx');
  assert.match(o, /data-slot="dialog-overlay"/);
  assert.match(o, /data-slot="dialog-header"/);
  assert.match(o, /data-slot="dialog-footer"/);
  assert.match(o, /sm:max-w-\[440px\]/);
  assert.match(o, /data-\[state=open\]:zoom-in-95/);
  assert.match(o, /collisionPadding=\{12\} arrowPadding=\{TAIL_PAD\}/);
});

// `--primary` is neutral in Predeterminado and Cristal (the fill of the main button); the accent is --primary-text / --primary-soft / --ring.
const jsx = (dir) => fs.readdirSync(new URL(`../src/ui/${dir}`, import.meta.url), { withFileTypes: true }).flatMap((e) => {
  const rel = dir ? `${dir}/${e.name}` : e.name;
  return e.isDirectory() ? (rel === 'games' ? [] : jsx(rel)) : e.name.endsWith('.jsx') ? [rel] : [];
});

test('no view or component paints its accent with the neutral --primary', () => {
  for (const f of jsx('')) {
    const src = read(f);
    assert.doesNotMatch(src, /(?<![\w-])(?:text|accent|border|ring)-primary(?![\w-])/, `${f}: use primary-text, ring-ring or border-primary-text`);
    assert.doesNotMatch(src, /(?<![\w-])bg-primary\/(?:5|8|10|12|15)(?!\d)/, `${f}: use bg-primary-soft`);
  }
});

test('the active pill of the segmented control and of the tabs has no foreground-coloured outline', () => {
  assert.doesNotMatch(read('components/ui/primitives.jsx'), /shadow-\[[^\]]*var\(--foreground\)/);
  const trigger = read('components/ui/overlay.jsx').split('\n').find((l) => l.includes('data-slot="tabs-trigger"'));
  assert.doesNotMatch(trigger, /shadow-\[/);
  assert.match(read('themes/pieces.css'), /\[aria-selected="true"\][^{]*\{ box-shadow: 0 1px 2px rgb\(0 0 0 \/ 0\.08\); \}/);
});

test('the Select trigger carries the slot the Cristal fields are styled by', () => {
  assert.match(read('components/ui/overlay.jsx'), /Trigger data-slot="select-trigger"/);
  assert.match(read('themes/pieces.css'), /cristal"\] :is\([^)]*\[data-slot="select-trigger"\]/);
});
