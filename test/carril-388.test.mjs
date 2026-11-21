import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (...p) => fs.readFileSync(path.join(ROOT, ...p), 'utf8');
const trail = read('src', 'ui', 'components', 'conversation', 'trail.jsx');

test('the rail is always drawn: no css hides it until the container is hovered', () => {
  const css = [read('src/ui/app.css'), ...fs.readdirSync(path.join(ROOT, 'src/ui/themes')).filter((f) => f.endsWith('.css')).map((f) => read('src/ui/themes', f))].join('\n');
  assert.doesNotMatch(css, /chat-trail"\][^{]*:not\(:hover\)/);
  assert.doesNotMatch(css, /chat-trail"\][^{]*\{[^}]*opacity:\s*0/);
  assert.match(trail, /const OPACITY = \{ rest: 0\.[3-9]/);
});

test('the rail overlays the margin and both conversations mount it', () => {
  assert.match(trail, /pointer-events-none absolute top-1\/2 left-2/);
  for (const f of ['session.jsx', 'chat.jsx']) {
    const src = read('src', 'ui', 'views', f);
    assert.match(src, /<ConversationTrail scrollRef=\{trail\.node\} \/>/, f);
  }
});

test('the reading tick is longer and ticks use muted token colours', () => {
  assert.match(trail, /READING_WIDTH/);
  assert.match(trail, /text-faint-foreground/);
  assert.match(trail, /var\(--foreground\)/);
});

test('the preview card is plain text: title on one line, reply on three at most', () => {
  const card = trail.slice(trail.indexOf('data-slot="trail-card"'));
  assert.match(card, /w-\[400px\]/);
  assert.match(card, /<p className="truncate font-medium">\{card\.title\}<\/p>/);
  assert.match(card, /line-clamp-3/);
  assert.doesNotMatch(trail, /dangerouslySetInnerHTML|innerHTML|Markdown/);
});

test('every tick is reachable by keyboard and shows the card on focus', () => {
  assert.match(trail, /<button key=\{i\} type="button" tabIndex=\{i === 0 \? 0 : -1\}/);
  assert.match(trail, /onFocus=\{\(\) => \{ focused\.current = i; show\(i\); \}\}/);
  assert.match(trail, /ArrowUp/);
  assert.match(trail, /ArrowDown/);
});

test('the rail and its rules carry no app-region', () => {
  assert.doesNotMatch(trail, /app-region/i);
  assert.doesNotMatch(read('src/ui/app.css').split('\n').filter((l) => /trail/.test(l)).join('\n'), /app-region/i);
});

test('the rail never measures per token or per scroll without passive', () => {
  assert.match(trail, /addEventListener\('scroll', schedule, \{ passive: true \}\)/);
  assert.match(trail, /requestAnimationFrame\(paint\)/);
});
