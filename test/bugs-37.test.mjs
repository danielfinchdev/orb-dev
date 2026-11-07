// 3.7 bug wave before release: «today» of the usage ledger is the owner's day (3.8: the settings' tz), not UTC's.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tempHome } from './helpers.mjs';

test('el gasto se apunta en el día del dueño (su zona horaria), no en el de UTC', async () => {
  const t = tempHome();
  try {
    const { Board } = await import('../src/core/board.mjs');
    const { ctx } = await import('../src/core/context.mjs');
    const { localDay } = await import('../src/core/tz.mjs');
    const { recordSpend } = await import('../src/core/budget.mjs');
    const board = new Board();
    // A zone where it is almost always another day than in UTC at some hour: whatever the time, the two must agree.
    for (const tz of ['Pacific/Kiritimati', 'Pacific/Pago_Pago', 'Europe/Madrid']) {
      ctx.config = { ...ctx.config, tz };
      const { day } = recordSpend(board, { account: 'claude', usage: { input_tokens: 7, output_tokens: 3 } });
      assert.equal(day, localDay(new Date(), tz), tz);
      assert.equal(board.one('SELECT day FROM usage_ledger ORDER BY id DESC LIMIT 1').day, day);
    }
    board.db.close();
  } finally { t.cleanup(); }
});
