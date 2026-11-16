// Step 10: favourite brains (model + reasoning + account) and the shortcuts that walk through them.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cleanBrain, parseFavorites, toggleFavorite, stepFavorite, isFavorite, MAX_FAVORITES } from '../src/shared/favorite-brains.mjs';
import { COMMANDS, resolve, matchCommand, normalizeCombo } from '../src/shared/keybindings.mjs';

const a = { agent: 'claude', model: 'opus', account: 'claude', reasoning: 'high' };
const b = { agent: 'codex', model: 'gpt-6', account: 'codex-pro', reasoning: 'low' };
const c = { agent: 'claude', model: 'sonnet', account: 'claude', reasoning: 'medium' };

test('a brain is cleaned: bad agents and models are refused, the account and reasoning have defaults', () => {
  assert.deepEqual(cleanBrain({ agent: 'claude', model: 'opus' }), { agent: 'claude', model: 'opus', account: 'claude', reasoning: 'medium' });
  assert.equal(cleanBrain({ agent: '../x y' }), null);
  assert.equal(cleanBrain({ agent: 'claude', model: 'a b; rm' }), null);
  assert.equal(cleanBrain(null), null);
  assert.equal(cleanBrain({ agent: 'claude', reasoning: 'max' }).reasoning, 'medium');
});

test('what storage holds is parsed without repeats, junk or more than the limit', () => {
  assert.deepEqual(parseFavorites('no json'), []);
  assert.deepEqual(parseFavorites('{"a":1}'), []);
  assert.deepEqual(parseFavorites([a, a, { agent: 5 }, b]), [a, b]);
  const many = Array.from({ length: 30 }, (_, i) => ({ agent: 'claude', model: `m${i}` }));
  assert.equal(parseFavorites(many).length, MAX_FAVORITES);
});

test('the star marks and unmarks; the same model with another reasoning is another favourite', () => {
  let list = toggleFavorite([], a);
  list = toggleFavorite(list, { ...a, reasoning: 'low' });
  assert.equal(list.length, 2);
  assert.ok(isFavorite(list, a));
  list = toggleFavorite(list, a);
  assert.equal(list.length, 1);
  assert.equal(toggleFavorite(list, { agent: '??' }), list);
});

test('Alt+] and Alt+[ go round the favourites', () => {
  const list = [a, b, c];
  assert.deepEqual(stepFavorite(list, a, 1), b);
  assert.deepEqual(stepFavorite(list, c, 1), a);
  assert.deepEqual(stepFavorite(list, a, -1), c);
  assert.deepEqual(stepFavorite(list, { agent: 'cursor', model: '' }, 1), a, 'not a favourite: forwards starts at the first');
  assert.deepEqual(stepFavorite(list, { agent: 'cursor', model: '' }, -1), c);
  assert.equal(stepFavorite([a], a, 1), null);
  assert.equal(stepFavorite([], a, 1), null);
});

test('the new commands are in the shortcut table without clashes', () => {
  assert.deepEqual(resolve([]).problems, []);
  const keys = Object.fromEntries(COMMANDS.map((x) => [x.id, x.key]));
  assert.equal(keys['brain.next'], 'Alt+]');
  assert.equal(keys['brain.prev'], 'Alt+[');
  assert.equal(keys['search.files'], 'Ctrl+P');
  assert.equal(keys['search.text'], 'Ctrl+Shift+F');
  for (const k of ['Alt+]', 'Alt+[', 'Ctrl+P', 'Ctrl+Shift+F']) assert.equal(normalizeCombo(k), k);
  const { table } = resolve([]);
  const ev = (o) => ({ key: o.key, code: o.code, ctrlKey: false, altKey: false, shiftKey: false, ...o });
  assert.equal(matchCommand(table, ev({ key: ']', code: 'BracketRight', altKey: true }), { view: 'chat' }), 'brain.next');
  assert.equal(matchCommand(table, ev({ key: ']', code: 'BracketRight', altKey: true }), { view: 'tasks' }), null, 'only in the chats');
  assert.equal(matchCommand(table, ev({ key: 'p', code: 'KeyP', ctrlKey: true }), { view: 'tasks' }), 'search.files');
  assert.equal(matchCommand(table, ev({ key: 'F', code: 'KeyF', ctrlKey: true, shiftKey: true }), { view: 'tasks' }), 'search.text');
});
