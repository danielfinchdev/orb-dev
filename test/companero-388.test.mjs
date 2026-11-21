// The floating robot of the Orb theme (components/companion.jsx): grabbed and dropped inside the window, and the hop of
// the brand's robot (app.css). Read as text, like the other interface tests.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';

const read = (p) => fs.readFileSync(new URL(`../src/ui/${p}`, import.meta.url), 'utf8');
const companion = read('components/companion.jsx');
const css = read('app.css');

test('only the Orb theme has the companion, and it drags with pointer events and a transform', () => {
  assert.match(companion, /robotSkin\(/);
  assert.match(companion, /setPointerCapture/);
  assert.match(companion, /onPointerDown=\{press\} onPointerMove=\{dragTo\} onPointerUp=\{drop\}/);
  assert.match(companion, /translate3d\(/);
  assert.match(companion, /requestAnimationFrame/);
  assert.doesNotMatch(companion, /style\.(left|top)\b/);
});

test('a short press is still the click of before; a longer travel is a drag that does not click', () => {
  assert.match(companion, /DRAG_THRESHOLD = \d/);
  assert.match(companion, /Math\.hypot\(dx, dy\) < DRAG_THRESHOLD/);
  assert.match(companion, /if \(moved\.current\) \{ moved\.current = false; return; \} go\('chat'\)/);
});

test('the position is kept per device, clamped to the window and can be reset', () => {
  assert.match(companion, /localStorage\.getItem\(POS_KEY\)/);
  assert.match(companion, /localStorage\.setItem\(POS_KEY/);
  assert.match(companion, /function clampOffset/);
  assert.match(companion, /addEventListener\('resize', settle\)/);
  assert.match(companion, /onContextMenu/);
  assert.match(companion, /e\.key === 'Home'/);
});

test('no app-region in the companion nor in its rules', () => {
  assert.doesNotMatch(companion, /app-region|no-drag/);
  for (const line of css.split('\n').filter((l) => /\.companion\b|brand-hop/.test(l))) assert.doesNotMatch(line, /app-region/);
  assert.match(css, /\.side-brand:hover \.orb \{ animation: brand-hop/);
});

test('the .app-titlebar region rules are the ones of HEAD', () => {
  const rules = (s) => s.split('\n').filter((l) => /^\.app-titlebar\b/.test(l));
  let head;
  try { head = execFileSync('git', ['show', 'HEAD:src/ui/app.css'], { encoding: 'utf8', maxBuffer: 1 << 26 }); } catch { return; }
  assert.deepEqual(rules(css), rules(head));
});

test('11D: the companion rests in a 72 px box with room for the bubble, greets once with real data, and keeps its bubble inside the window', () => {
  assert.match(companion, /REST_RIGHT = 246/);
  assert.match(companion, /grid size-\[72px\]/);
  assert.match(companion, /<Robot size=\{56\}/);
  assert.match(companion, /let greeted = false/);
  assert.match(companion, /needsApproval/);
  assert.match(companion, /app\?\.config\?\.userName\?\.trim\(\)/);
  assert.match(companion, /GREETING_MS = 5200/);
  assert.match(companion, /\.right \+ 8 \+ BUBBLE_W <= window\.innerWidth - EDGE/);
  assert.match(companion, /motion-reduce:animate-none/);
  assert.match(companion, /data-motion=minima/);
  for (const lang of ['es', 'en']) {
    const loc = fs.readFileSync(new URL(`../src/shared/locales/${lang}/comp.mjs`, import.meta.url), 'utf8');
    for (const key of ['hello', 'helloAnon', 'helloAsk.one', 'helloAsk.many', 'helloAskAnon.one', 'helloAskAnon.many']) assert.ok(loc.includes(`'comp.companion.${key}'`), `${lang}: ${key}`);
  }
});
