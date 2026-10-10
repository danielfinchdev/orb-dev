// 2.6: every window of a plan the agents report (session, weekly, weekly of one model) is kept for the usage panel of the
// context ring, shortest first, and the ones already over are dropped.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { tempHome } from './helpers.mjs';
import { Board } from '../src/core/board.mjs';
import { recordRate, rateWindows } from '../src/core/budget.mjs';

const t = tempHome();
after(() => t.cleanup());

test('el panel de uso guarda cada ventana del plan, la más corta primero', () => {
  const board = new Board();
  const hour = 3_600_000;
  recordRate(board, 'claude', { utilization: 0.28, resetAt: Date.now() + 50 * hour, window: 'seven_day', status: 'allowed' });
  recordRate(board, 'claude', { utilization: 0.04, resetAt: Date.now() + 4 * hour, window: 'five_hour', status: 'allowed' });
  recordRate(board, 'claude', { utilization: 0.3, resetAt: Date.now() + 50 * hour, window: 'seven_day_opus', status: 'allowed' });
  recordRate(board, 'claude', { utilization: 0.1, resetAt: Date.now() - 1000, window: 'viejo', status: 'allowed' });
  assert.deepEqual(rateWindows(board, 'claude').map((w) => [w.window, w.utilization]), [['five_hour', 0.04], ['seven_day', 0.28], ['seven_day_opus', 0.3]]);
  recordRate(board, 'claude', { utilization: 0.06, resetAt: Date.now() + 4 * hour, window: 'five_hour', status: 'allowed' });
  assert.equal(rateWindows(board, 'claude')[0].utilization, 0.06, 'la última lectura de cada ventana manda');
  assert.deepEqual(rateWindows(board, 'codex'), []);
});
