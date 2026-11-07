// 3.7 bug wave before release: the owner's overview counts «today» in each person's own day.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tempHome } from './helpers.mjs';

test('resumen de personas: «hoy» es el día de cada persona, como el que apunta el gasto', async () => {
  const t = tempHome();
  try {
    const { Board } = await import('../src/core/board.mjs');
    const P = await import('../src/core/persons.mjs');
    const { recordSpend } = await import('../src/core/budget.mjs');
    const board = new Board();
    const owner = board.ownerId();
    // A zone where it is almost always another day than in UTC at some hour: whatever the time, the two must agree.
    for (const tz of ['Pacific/Kiritimati', 'Pacific/Pago_Pago', 'Europe/Madrid']) {
      board.run('UPDATE persons SET tz = ? WHERE id = ?', tz, owner);
      board.run('DELETE FROM usage_ledger');
      recordSpend(board, { person: owner, account: 'claude', usage: { input_tokens: 7, output_tokens: 3 } });
      assert.equal(P.overview(board).find((p) => p.id === owner).today.tokens, 10, tz);
    }
    board.db.close();
  } finally { t.cleanup(); }
});
