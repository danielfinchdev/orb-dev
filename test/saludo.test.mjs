// Saludo del chat (2.7): lo importante primero, sin bromas en Profesional, sin repetir la frase anterior y siempre con
// un texto que existe en los dos idiomas.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import es from '../src/core/locales/es.mjs';
import en from '../src/core/locales/en.mjs';
import { pickGreeting, pickSubtitle } from '../src/ui/lib/greeting.js';

const seq = (...values) => { let i = 0; return () => values[i++ % values.length]; };
const many = (opts) => Array.from({ length: 400 }, () => pickGreeting(opts).key);

test('Saludo: una tarea por aprobar va siempre primero, en singular o plural', () => {
  assert.deepEqual(pickGreeting({ tasks: [{ status: 'awaiting_approval' }] }), { key: 'greet.approvals.one', n: 1 });
  assert.equal(pickGreeting({ tasks: [{ status: 'awaiting_approval' }, { status: 'awaiting_approval' }] }).key, 'greet.approvals.many');
  assert.match(pickGreeting({ first: true }).key, /^greet\.first/);
});

test('Saludo: en Profesional no hay bromas y nunca repite la anterior', () => {
  assert.ok(new Set(many({})).has('greet.bits'), 'fuera de Profesional sí salen');
  const serious = new Set(many({ serious: true }));
  for (const k of ['greet.bits', 'greet.prod', 'greet.online', 'greet.circuits']) assert.ok(!serious.has(k), k);
  for (let i = 0; i < 50; i++) assert.notEqual(pickGreeting({ last: 'greet.morning', now: new Date(2026, 9, 12, 9), random: seq(0.6, 0) }).key, 'greet.morning');
  assert.notEqual(pickSubtitle({ last: 'chat.intro', random: () => 0 }), 'chat.intro');
});

test('Saludo: cada frase posible existe en es y en', () => {
  const tasks = [{ status: 'running' }, { status: 'limited' }, { status: 'done', updated_at: new Date(Date.now() - 864e5).toISOString() }];
  const keys = new Set([...many({}), ...many({ tasks, project: 'web' }), ...many({ tasks: [{ status: 'done' }] }), 'greet.approvals.one', 'greet.approvals.many']);
  for (const h of [3, 7, 10, 15, 22]) for (const d of [10, 11, 16]) keys.add(pickGreeting({ now: new Date(2026, 9, d, h), random: () => 0.6 }).key);
  for (const k of keys) assert.ok(es[k] && en[k], `falta ${k}`);
  for (let i = 0; i < 20; i++) { const s = pickSubtitle(); assert.ok(es[s] && en[s], s); }
});
