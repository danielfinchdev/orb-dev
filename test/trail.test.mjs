import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { sigmaFor, gaussian, magnify, nearestIndex, readingIndex, cardTop, gutterFits, collapse, tickCenter } from '../src/ui/lib/trail.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (...p) => fs.readFileSync(path.join(ROOT, ...p), 'utf8');

test('sigma follows the spacing within its bounds', () => {
  assert.equal(sigmaFor(10), 15);
  assert.equal(sigmaFor(2), 4 < 8 ? 4 : 8);
  assert.equal(sigmaFor(100), 22);
});

test('magnification peaks under the pointer and falls off on both sides', () => {
  const w = magnify(tickCenter(5), 11);
  assert.equal(Math.round(w[5]), 30);
  assert.ok(w[4] < w[5] && w[3] < w[4] && w[6] < w[5]);
  assert.ok(Math.abs(w[4] - w[6]) < 1e-9);
  assert.ok(w.every((x) => x >= 6 && x <= 30));
  assert.equal(gaussian(0), 1);
});

test('nearest index is clamped to the list', () => {
  assert.equal(nearestIndex(-20, 5), 0);
  assert.equal(nearestIndex(23, 5), 2);
  assert.equal(nearestIndex(999, 5), 4);
  assert.equal(nearestIndex(5, 0), -1);
});

test('reading index is the last message at or above the viewport top plus the offset', () => {
  assert.equal(readingIndex([300, 600, 900]), 0);
  assert.equal(readingIndex([-500, 20, 400]), 1);
  assert.equal(readingIndex([-500, -100, 24, 25]), 2);
  assert.equal(readingIndex([]), 0);
});

test('the card stays inside the rail', () => {
  assert.equal(cardTop(5, 60, 200), 0);
  assert.equal(cardTop(100, 60, 200), 70);
  assert.equal(cardTop(195, 60, 200), 140);
  assert.equal(cardTop(10, 300, 200), 0);
});

test('the rail needs a 56 px gutter beside the centred column', () => {
  assert.equal(gutterFits(768 + 111), false);
  assert.equal(gutterFits(768 + 112), true);
  assert.equal(gutterFits(500), false);
});

test('previews collapse whitespace and are capped', () => {
  assert.equal(collapse('  a \n\n b\t c '), 'a b c');
  assert.equal(collapse('x'.repeat(500)).length, 280);
});

test('both transcripts mount the trail and the locale keys exist in es and en', async () => {
  for (const f of ['chat.jsx', 'session.jsx']) {
    const src = read('src', 'ui', 'views', f);
    assert.match(src, /<ConversationTrail scrollRef=\{trail\.node\} \/>/, f);
    assert.match(src, /ref=\{trail\.ref\}/, f);
  }
  for (const lang of ['es', 'en']) {
    const m = (await import(`../src/shared/locales/${lang}/chat.mjs`)).default;
    for (const k of ['chat.trail.label', 'chat.trail.item', 'chat.trail.noReply']) assert.ok(m[k], `${lang} ${k}`);
  }
});

test('the pointer handler never sets React state per move', () => {
  const src = read('src', 'ui', 'components', 'conversation', 'trail.jsx');
  const body = /const onMove = [\s\S]*?\n  };/.exec(src)[0];
  assert.doesNotMatch(body, /set[A-Z]\w*\(/);
  assert.match(src, /requestAnimationFrame\(paint\)/);
});
