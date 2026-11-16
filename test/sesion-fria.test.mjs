// Step 10: the warning for a Claude conversation left idle with a lot of context (its prompt cache is gone).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { coldSession, idleText, COLD_TOKENS, COLD_MINUTES } from '../src/shared/cold-session.mjs';

const now = Date.parse('2026-11-16T12:00:00Z');
const ago = (min) => new Date(now - min * 60_000).toISOString();

test('cold only for Claude, past 100k tokens, idle 70 minutes or more, and not while it works', () => {
  assert.equal(COLD_TOKENS, 100_000); assert.equal(COLD_MINUTES, 70);
  assert.equal(coldSession({ agent: 'claude', used: 150_000, lastAt: ago(70), now }).cold, true);
  assert.equal(coldSession({ agent: 'claude', used: 150_000, lastAt: ago(69), now }).cold, false);
  assert.equal(coldSession({ agent: 'claude', used: 100_000, lastAt: ago(300), now }).cold, false, 'exactly 100k is not past it');
  assert.equal(coldSession({ agent: 'claude', used: 100_001, lastAt: ago(300), now }).cold, true);
  assert.equal(coldSession({ agent: 'codex', used: 500_000, lastAt: ago(300), now }).cold, false);
  assert.equal(coldSession({ agent: 'claude', used: 150_000, lastAt: ago(300), now, busy: true }).cold, false);
});

test('unknown numbers never warn', () => {
  assert.equal(coldSession({ agent: 'claude', used: undefined, lastAt: ago(300), now }).cold, false);
  assert.equal(coldSession({ agent: 'claude', used: 200_000, lastAt: undefined, now }).cold, false);
  assert.equal(coldSession({ agent: 'claude', used: 200_000, lastAt: 'no es una fecha', now }).cold, false);
  assert.equal(coldSession({ agent: 'claude', used: 200_000, lastAt: now + 1000, now }).minutes, 0, 'a clock ahead never gives negative minutes');
});

test('the idle time reads as hours and minutes', () => {
  assert.equal(idleText(75), '1 h 15 min');
  assert.equal(idleText(120), '2 h');
  assert.equal(idleText(70), '1 h 10 min');
  assert.equal(idleText(45), '45 min');
});
