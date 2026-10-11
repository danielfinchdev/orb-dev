// Monitoreo del equipo (2.7): Opti Bot tiene su propia conversación, sus propias herramientas (solo lectura y propuestas)
// y lo que quiere cambiar llega como tarjeta que el usuario aprueba o no; sin el interruptor de Ajustes no existe.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { tempHome, until, startEngine } from './helpers.mjs';

let t; let engine; let call;
before(async () => { t = tempHome(); engine = await startEngine(t.home); ({ call } = engine); });
after(async () => { await engine?.stop(); t.cleanup(); });

test('Opti Bot: apagado no existe; encendido revisa Orb con sus herramientas y propone con una tarjeta', async () => {
  await assert.rejects(call('opti.session'), /Activa el Monitoreo del equipo/);
  await call('config.save', { patch: { monitor: { enabled: true, agent: 'claude' } } });
  const s = await call('opti.session');
  assert.equal(s.permission, 'leer');
  assert.equal((await call('opti.session')).id, s.id, 'la misma conversación cada vez');
  assert.equal((await call('app.state')).optiSession, s.id, 'la app sabe cuál es (no la pone entre los chats)');
  const stats = await call('opti.stats');
  assert.ok(stats.memory.usedPct > 0 && stats.memory.totalGb > 0);
  await call('sessions.send', { id: s.id, text: 'OPTI_REVISA' });
  const card = await until(async () => (await call('sessions.items', { id: s.id })).find((i) => i.kind === 'opti_action'), 'tarjeta de Opti Bot', 20000);
  assert.equal(card.body.action, 'clean_temp'); assert.equal(card.body.status, 'pending');
  await until(async () => (await call('sessions.items', { id: s.id })).some((i) => i.role === 'assistant' && /Orb está bien/.test(typeof i.body === 'string' ? i.body : '')), 'respuesta con la comprobación de Orb', 20000);
  await call('opti.act', { item: card.id, decision: 'deny' });
  const after = (await call('sessions.items', { id: s.id })).find((i) => i.id === card.id);
  assert.equal(after.body.status, 'denied');
  await assert.rejects(call('opti.act', { item: card.id, decision: 'allow' }), /ya está respondida/);
});
