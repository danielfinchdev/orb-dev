// The periodic sweeps of the sessions and the assistant must not throw when the database is already closed (the file of a
// test, or the app, ended while the 60 s timer was still pending).
import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import { tempHome } from './helpers.mjs';
import { Board } from '../src/domain/tasks/board.mjs';
import { Sessions } from '../src/engine/sessions.mjs';
import { Orchestrator } from '../src/engine/orchestrator.mjs';

test('the 60 s sweeps survive a closed database', () => {
  const t = tempHome();
  mock.timers.enable({ apis: ['setInterval'] });
  try {
    const board = new Board();
    const logs = [];
    const sessions = new Sessions(board, { emit: () => {}, log: (m) => logs.push(m) });
    const orchestrator = new Orchestrator(board, { emit: () => {}, log: (m) => logs.push(m) });
    board.db.close();
    assert.doesNotThrow(() => mock.timers.tick(60_000));
    assert.ok(logs.length >= 2, 'both sweeps said why they skipped');
    sessions.stopAll(); orchestrator.stopAll();
  } finally { mock.timers.reset(); t.cleanup(); }
});
