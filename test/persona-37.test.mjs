// 3.7 release gate: a copy whose name was already «X · 2» here is «X · 3», never «X · 2 · 2».
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { tempHome } from './helpers.mjs';
import { Board } from '../src/core/board.mjs';
import { createBot } from '../src/core/bots.mjs';
import { upsertBot } from '../src/core/replica.mjs';

const home = tempHome();
after(() => home.cleanup());

test('copias con el mismo nombre: «Asistente · 3», nunca «Asistente · 2 · 2»', () => {
  const board = new Board();
  const me = board.ownerId();
  createBot(board, { name: 'Asistente' }, { person: me });
  const row = (uid, name) => ({ uid, name, tools: '[]', accounts: '{}', exclusive: '[]' });
  const a = upsertBot(board, row('01a1a615-7a66-7dd4-9e65-82656a82cdd0', 'Asistente'), { person: me, home: 'srv', epoch: 0 });
  assert.equal(a.renamed, 'Asistente · 2');
  // The Server renamed the PC's own «Asistente» to «Asistente · 2» when it moved there: its copy here.
  const b = upsertBot(board, row('01a1a911-f194-7aab-84a1-2c83aa68f949', 'Asistente · 2'), { person: me, home: 'srv', epoch: 1 });
  assert.equal(b.renamed, 'Asistente · 3');
  // A name that is free stays as the home says.
  const c = upsertBot(board, row('01a1a915-0124-7904-998c-3c68fbbed0fb', 'Recados'), { person: me, home: 'srv', epoch: 0 });
  assert.equal(c.renamed, null);
});

