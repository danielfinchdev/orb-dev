// 3.8.2, phase 1: the desktop touch-ups (the chat's bar with ⋯, «Renombrar» in the list, tooltips inside the window,
// the composer's folder chip, the cost line setting and the message's time, F5, the first run maximised and the foot of
// Ajustes). The screens are read as source, like mensajeria-orb.test.mjs; the pure helpers are run.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (...p) => fs.readFileSync(path.join(ROOT, 'src', 'ui', ...p), 'utf8');

test('the list ⋯ of a chat and of an agent conversation offers «Renombrar»', () => {
  const inbox = read('views', 'orb', 'inbox.jsx');
  assert.match(inbox, /export function renameChat\(item, t\)/);
  assert.match(inbox, /item\.kind === 'session' \? 'sessions\.update' : 'conversations\.update'/);
  // Both lists (the agent's conversation and the assistant's chat) carry the action.
  const actions = inbox.slice(inbox.indexOf('export function useOrbActions'), inbox.indexOf('export function renameChat'));
  assert.equal([...actions.matchAll(/^\s+rename,$/gm)].length, 2);
});
