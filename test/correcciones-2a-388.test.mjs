// Fidelity fixes, second round, part A (read as text, like the other UI tests).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { orbProgress } from '../src/ui/lib/inbox.js';

const root = fileURLToPath(new URL('..', import.meta.url));
const read = (f) => fs.readFileSync(root + f, 'utf8');
const inbox = read('src/ui/views/orb/inbox.jsx');
const css = read('src/ui/app.css');

test('1: no layout of a row bolds an unread title or tints its time', () => {
  assert.doesNotMatch(inbox, /strong \?/);
  assert.doesNotMatch(inbox, /text-primary-text font-medium/);
  assert.match(inbox, /'shrink-0 text-caption tabular-nums', 'text-muted-foreground'/);
});

test('2: a running row shows its newest step in grey, «Trabajando…» only without one', () => {
  const t = (k) => k;
  assert.equal(orbProgress({ busy: true, step: 'Leyendo designer.mjs' }, t).text, 'Leyendo designer.mjs…');
  assert.equal(orbProgress({ busy: true }, t).text, 'chats.working');
  assert.doesNotMatch(inbox, /p\.tone === 'live' \? 'text-primary-text' : 'text-faint-foreground'\)\} data-testid="orb-progress"/);
});

test('3: the day card sits above «Fijados» and only exists when yesterday registered something', () => {
  const card = read('src/ui/components/day-digest.jsx');
  assert.match(card, /r\?\.due && !r\.empty/);
  assert.ok(inbox.indexOf('<DayDigestCard') < inbox.indexOf('data-testid="orb-pinned"'));
});

test('4: the title card of the Ficha is 75.4 px like the mock-up', () => {
  assert.match(read('src/ui/views/orb/info.jsx'), /mt-1 text-xs leading-\[1\.45\]">\{line\}/);
});

test('5: text, bubbles and box share their edges in both chats', () => {
  for (const f of ['src/ui/views/chat.jsx', 'src/ui/views/session.jsx']) {
    assert.match(read(f), /max-w-\[calc\(var\(--chat-max-width\)\+2\.5rem-var\(--sb-w\)\)\] flex-col[^"]*pr-\[calc\(1\.25rem-var\(--sb-w\)\)\] pl-5/, f);
  }
});

test('6: the scroll thumb lingers 600 ms at most', () => {
  assert.match(read('src/ui/lib/scroll-hint.js'), /IDLE_MS = 600;/);
});

test('7: narrow window: the queue card stacks, the filters wrap, the header drops its date', () => {
  const tasks = read('src/ui/views/tasks.jsx');
  assert.match(tasks, /qbar @container flex-row flex-wrap/);
  assert.match(tasks, /@max-\[17rem\]:w-full/);
  assert.match(tasks, /className="h-auto min-h-\(--ctl\) flex-wrap" data-testid="task-filters"/);
  assert.match(css, /container: bar \/ inline-size/);
  assert.match(css, /@container bar \(max-width: 560px\) \{ \.bar-clock-date \{ display: none; \} \}/);
});

test('8: the permission menu texts are short', () => {
  for (const l of ['es', 'en']) {
    const s = read(`src/shared/locales/${l}/auto.mjs`);
    for (const k of ['session.autoTip', 'session.askTip']) {
      const v = new RegExp(`'${k}': '([^']*)'`).exec(s)?.[1] ?? '';
      assert.ok(v.length > 0 && v.length <= 72, `${l} ${k} (${v.length})`);
    }
  }
});

test('9: the five places of God mode keep their names for the tooltip, never cut', () => {
  assert.match(inbox, /const iconsOnly = more\.length > 0;/);
  assert.match(inbox, /iconsOnly && 'sr-only'/);
  assert.match(inbox, /title=\{iconsOnly \? t\(label\) : undefined\}/);
});

test('10: the games picker matches the mock-up: body 6 px lower, 18.85 and 17.4 px lines; the badge needs a record', () => {
  const g = read('src/ui/games/games.jsx');
  assert.match(g, /'flex flex-col gap-3\.5 pt-1\.5', game && 'pb-1\.5'/);
  assert.match(g, /text-control leading-\[1\.45\] font-medium/);
  assert.match(g, /\{n > 0 \? <Badge /);
});

test('11: the 20 px fade is on the scroller itself, whose 24 px end padding keeps the last line clear', () => {
  assert.match(css, /\.chat-fade \{[^}]*calc\(100% - 20px\)/);
  assert.match(read('src/ui/views/chat.jsx'), /className="lazy-lines [^"]*py-6 /);
  assert.match(read('src/ui/views/session.jsx'), /className="lazy-lines [^"]*py-6 /);
});
