// «Sugerir el siguiente mensaje»: off by default, one cheap request when a turn ends cleanly, cancelled when the user types or sends,
// and only proposed (the box shows it grey; it is never sent by itself).
import { tempHome, until } from './helpers.mjs';
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { Board } from '../src/domain/tasks/board.mjs';
import { Sessions } from '../src/engine/sessions.mjs';
import { cleanSuggestion } from '../src/engine/suggest.mjs';
import { DEFAULT_CONFIG } from '../src/platform/config-file.mjs';
import { ctx } from '../src/platform/context.mjs';

let t; let board; let sessions; let events; let made; let reply; let hold;
before(() => {
  t = tempHome(); board = new Board(); events = [];
  sessions = new Sessions(board, { emit: (e, p) => events.push([e, p]) });
  sessions.suggest.fake = true; made = [];
  sessions.suggest.make = (agent, o) => {
    const live = { closed: false, close() { this.closed = true; }, async send() { made.push({ agent, o }); if (hold) await hold; return { final: reply, isError: false, usage: {} }; } };
    live.o = o; return live;
  };
});
after(() => { try { sessions.stopAll(); board.db.close(); } catch { /* closed */ } t.cleanup(); });

const suggestions = () => events.filter(([e]) => e === 'session:suggest').map(([, p]) => p);
const turn = (s, over = {}) => sessions.suggest.after(s.id, { request: 'haz la portada', result: { final: 'Hecho, la portada está lista.', isError: false }, ...over });
const chat = () => sessions.create({ kind: 'chat', agent: 'claude', permission: 'leer', title: 'x', cwd: t.home });

test('it is off by default, and a plain model answer becomes one clean line', () => {
  assert.equal(DEFAULT_CONFIG.suggestNext, false);
  assert.equal(cleanSuggestion('"Ahora añade los tests"\nporque sí'), 'Ahora añade los tests');
  assert.equal(cleanSuggestion('NINGUNO'), ''); assert.equal(cleanSuggestion('   '), ''); assert.equal(cleanSuggestion('x'.repeat(300)), '');
});

test('with the setting off nothing is asked; on, one cheap read-only request proposes the message', async () => {
  const s = chat(); reply = 'Ahora añade los tests'; made.length = 0; events.length = 0;
  ctx.config.suggestNext = false;
  assert.equal(turn(s), false); assert.equal(made.length, 0);
  ctx.config.suggestNext = true;
  assert.equal(turn(s), true);
  await until(() => suggestions().length === 1, 'sugerencia');
  assert.deepEqual(suggestions()[0], { id: s.id, text: 'Ahora añade los tests' });
  assert.equal(made.length, 1, 'one request per turn');
  const o = made[0].o;
  assert.equal(o.permission, 'leer'); assert.deepEqual(o.mcpServers, {}); assert.ok(o.model, 'a model chosen (the lightest)');
  assert.ok(o.tools.disallowed.includes('Read') && o.tools.disallowed.includes('Bash'), 'no tools at all');
});

test('a stopped or failed turn, a queued message or an active goal propose nothing', () => {
  const s = chat(); ctx.config.suggestNext = true; made.length = 0;
  assert.equal(turn(s, { stopped: true }), false);
  assert.equal(turn(s, { result: { final: 'x', isError: true } }), false);
  assert.equal(turn(s, { result: { final: 'x', limit: true } }), false);
  board.settingJson(`goal:${s.id}`, { status: 'active' }); assert.equal(turn(s), false); board.settingJson(`goal:${s.id}`, null);
  sessions.enqueue(s.id, 'luego');
  assert.equal(turn(s), false);
  assert.equal(made.length, 0);
});

test('typing (or sending) cancels the request: nothing is proposed afterwards', async () => {
  const s = chat(); ctx.config.suggestNext = true; reply = 'tarde'; events.length = 0;
  let release; hold = new Promise((r) => { release = r; });
  assert.equal(turn(s), true);
  await until(() => sessions.suggest.pending.has(s.id), 'petición en curso');
  const live = sessions.suggest.pending.get(s.id).live;
  assert.equal(sessions.suggest.cancel(s.id), true);
  release(); hold = null;
  await until(() => live.closed, 'proceso cerrado');
  await new Promise((r) => setTimeout(r, 50));
  assert.deepEqual(suggestions(), []);
  assert.equal(sessions.suggest.cancel(s.id), false, 'nothing left to cancel');
});
