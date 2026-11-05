// 3.7 release gate (a real user against a real Orb Server): what that walk-through found and fixed.
// - a copy whose name was already «X · 2» here is «X · 3», never «X · 2 · 2»;
// - «Añadir Orb Server» › «Hacerlo a mano» also says how to link a server that already has Orb Server 3.7;
// - «Ver navegador del Server» has an address bar and «Atrás» (browser.live.input go / back), checked like the bots'.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { tempHome } from './helpers.mjs';
import { Board } from '../src/core/board.mjs';
import { createBot } from '../src/core/bots.mjs';
import { upsertBot } from '../src/core/replica.mjs';
import { serverInstallSteps } from '../src/core/server-install.mjs';
import { browserMethods } from '../src/engine/api-browser.mjs';
import { ctx } from '../src/core/context.mjs';
import { translate } from '../src/core/i18n.mjs';

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

test('«Hacerlo a mano»: con Orb Server ya instalado basta con enlazarlo', () => {
  const steps = serverInstallSteps({ code: 'ABCD-EFGH-JK', address: 'https://casa.example.ts.net:3131', fp: 'ab12-cd34-ef56', version: '3.7.0' });
  const linkOnly = steps.find((s) => s.key === 'msg.server.step.installed');
  assert.equal(linkOnly.cmd, "orb-server emparejar 'ABCD-EFGH-JK@https://casa.example.ts.net:3131#ab12-cd34-ef56'");
  assert.equal(steps.at(-1).key, 'msg.server.step.fallback', 'el código del servidor sigue al final');
  assert.notEqual(translate('es', 'msg.server.step.installed'), 'msg.server.step.installed');
  assert.notEqual(translate('en', 'msg.server.step.installed'), 'msg.server.step.installed');
  // Without a code there is nothing to link with.
  assert.ok(!serverInstallSteps({ version: '3.7.0' }).some((s) => s.key === 'msg.server.step.installed'));
});

test('navegador del Server en directo: la barra de direcciones y «Atrás» llegan al navegador; nada más', async () => {
  const board = new Board();
  const seen = [];
  ctx.serverBrowser = { live: { input: async (sid, who, p) => { seen.push({ sid, who, p }); return { ok: true, using: true, url: p.go ? 'https://correo.example.com/' : 'about:blank' }; } } };
  try {
    const api = browserMethods({ board, emit: () => {} });
    const who = { person: board.ownerId(), device: 'd1', role: 'owner' };
    const r = await api['browser.live.input']({ sid: 's1', go: 'correo.example.com' }, who);
    assert.equal(r.url, 'https://correo.example.com/');
    assert.equal(seen[0].p.go, 'correo.example.com'); assert.equal(seen[0].p.back, false);
    await api['browser.live.input']({ sid: 's1', back: true }, who);
    assert.equal(seen[1].p.back, true); assert.equal(seen[1].p.go, null);
    // Only text, and not too long.
    await assert.rejects(async () => api['browser.live.input']({ sid: 's1', go: { url: 'x' } }, who));
    await assert.rejects(async () => api['browser.live.input']({ sid: 's1', go: 'x'.repeat(2001) }, who));
    // «back» only when it is really true.
    await api['browser.live.input']({ sid: 's1', back: 'yes' }, who);
    assert.equal(seen.at(-1).p.back, false);
  } finally { delete ctx.serverBrowser; }
});

test('npm run servidor:instalar dice el código para enlazar que sacó el instalador', async () => {
  const { explain } = await import('../scripts/instalar-servidor.mjs');
  const out = 'SERVICIO=active\nADMIN=si\n  \x1b[1mCódigo: ABCD-EFGH\x1b[22m\n  Dirección: https://casa.example.ts.net:3131\n';
  const text = explain(out, 'srv');
  assert.match(text, /código ABCD-EFGH y dirección https:\/\/casa\.example\.ts\.net:3131/);
  assert.doesNotMatch(text, /\x1b/);
  assert.doesNotMatch(explain('SERVICIO=active\nADMIN=si\n', 'srv'), /código/);
});

test('Orb Server: editar o eliminar desde el PC un bot que se ejecuta en el Server', async () => {
  const { serverCeiling, SERVER_SETS } = await import('../src/server/server-product.mjs');
  const { ORB_SET } = await import('../src/core/policy.mjs');
  // What replica.mjs › forwardHere gives the app's write (bots.update, bots.delete…): an Orb's ceiling.
  const c = serverCeiling({ channel: 'forward', ceiling: ORB_SET });
  for (const m of ['bots.update', 'bots.delete', 'bots.memory.set', 'bots.send']) assert.ok(c.has(m), m);
  assert.ok(![...c].some((m) => /^(tasks|projects|sessions|chat)\./.test(m)), 'nada de programar');
  // A centre's forwarded call without its own ceiling keeps the phone's.
  assert.equal(serverCeiling({ channel: 'forward' }), SERVER_SETS.forward);
  assert.ok(!SERVER_SETS.forward.has('bots.delete'));
});
