// 3.8: Orb has no bots. A new database gets none of their tables or triggers (a 3.7 one: test/migracion-38.test.mjs).
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { tempHome } from './helpers.mjs';
import { Board } from '../src/domain/tasks/board.mjs';
import { METHODS } from '../src/domain/security/permissions.mjs';

const t = tempHome();
after(() => t.cleanup());

test('una base nueva: sin tablas ni disparadores de las réplicas, y sin métodos ni eventos de bots', () => {
  const board = new Board();
  const names = (type) => board.all('SELECT name FROM sqlite_master WHERE type = ?', type).map((r) => r.name);
  assert.deepEqual(names('trigger'), []);
  for (const gone of ['bots', 'bot_groups', 'bot_reminders', 'memory_log', 'bot_changes', 'replica_cursor', 'bot_moves', 'link_persons', 'link_queue', 'link_seen', 'persons']) assert.ok(!names('table').includes(gone), gone);
  const c = board.createConversation({ title: 'Hola' });
  board.addChat('usuario', 'una línea', null, c.id);
  assert.equal(board.chat(c.id).length, 1);
  assert.deepEqual(Object.keys(METHODS).filter((m) => /^(bots|replica|templates|centro)\./.test(m)), []);
});
