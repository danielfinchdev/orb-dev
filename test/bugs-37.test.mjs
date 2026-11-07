// 3.7 bug wave before release: a shared bot browses with the TALKER's profile; the owner's overview counts «today» in
// each person's own day; a bot does not start adb before the user used Android.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { tempHome } from './helpers.mjs';

test('bot compartido: navega con el perfil de quien habla', async () => {
  const { botBrowserAccess } = await import('../src/engine/bots.mjs');
  const board = { isOwnerPerson: (p) => !p || p === 'admin' };
  // The Admin's bot, the Admin talking: the default profile.
  assert.deepEqual(botBrowserAccess(board, { owner: 'admin', talker: 'admin' }), { profile: null });
  // The Admin's bot shared with María: María's own profile, never the Admin's cookies.
  assert.deepEqual(botBrowserAccess(board, { owner: 'admin', talker: 'maria' }), { profile: 'maria' });
  // María's own bot: her profile; the Admin talking to it uses the Admin's profile.
  assert.deepEqual(botBrowserAccess(board, { owner: 'maria', talker: 'maria' }), { profile: 'maria' });
  assert.deepEqual(botBrowserAccess(board, { owner: 'maria', talker: 'admin' }), { profile: null });
});

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

test('un bot no arranca adb si el usuario no ha usado Android', async () => {
  // pc_android (the «Equipo» tools) only runs adb after the user listed devices in Orb (connections.adb).
  const src = fs.readFileSync(new URL('../src/mcp/bot.mjs', import.meta.url), 'utf8');
  const i = src.indexOf("name: 'pc_android'");
  const body = src.slice(i, src.indexOf("name: 'pc_orb_check'"));
  assert.ok(body.indexOf("settingJson('connections.adb')") > 0 && body.indexOf("settingJson('connections.adb')") < body.indexOf('N.adbDevices('), 'mira antes de arrancar adb');
});
