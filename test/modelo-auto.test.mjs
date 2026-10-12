// «Orb elige el modelo» (2.7): por la dificultad de la tarea y el nivel de gasto, el modelo ligero para lo sencillo, el
// equilibrado para lo habitual y el más potente para lo difícil (el más nuevo de cada tipo, Fable el último); el
// razonamiento alto no se elige solo si necesita aprobación; queda en la tarea y explicado en su historial.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { tempHome, until, startEngine } from './helpers.mjs';

let t; let engine; let call;
before(async () => {
  t = tempHome();
  engine = await startEngine(t.home, { env: { ORB_FAKE_TIERED: '1' } });
  ({ call } = engine);
  await call('projects.create', { name: 'web' });
  await call('projects.setActive', { name: 'web' });
  await call('agents.check', { agent: 'claude' }).catch(() => {});
  await until(async () => (await call('models.catalog')).find((a) => a.id === 'claude')?.models.some((m) => m.id === 'claude-haiku-4-5'), 'modelos de Claude', 20000);
});
after(async () => { await engine?.stop(); t.cleanup(); });

const picks = async () => (await call('models.guide')).find((a) => a.id === 'claude').picks;

// 3.1: a task that writes code never gets a light model (the guide shows tasks that write): Haiku stays for reading.
test('equilibrado: Sonnet 5.5 para lo sencillo y lo normal (nunca Haiku para escribir código) y Opus 5.5 (no Fable) para lo difícil', async () => {
  const p = await picks();
  assert.equal(p.simple.label, 'Sonnet 5.5'); assert.equal(p.simple.reasoning, 'low');
  assert.equal(p.normal.label, 'Sonnet 5.5'); assert.equal(p.normal.reasoning, 'medium');
  assert.equal(p.complejo.label, 'Opus 5.5');
  assert.equal(p.complejo.reasoning, 'medium', 'el alto espera aprobación: Orb no lo elige solo');
  const tiers = (await call('models.guide')).find((a) => a.id === 'claude').tiers;
  assert.ok(tiers.light.includes('Haiku 4.5') && tiers.heavy.includes('Fable 5.1') && tiers.balanced.includes('Sonnet 5.5'));
});

test('con máximo ahorro, lo difícil va al equilibrado; con máximo uso, lo normal al más potente', async () => {
  await call('config.save', { patch: { budget: { profile: 0 } } });
  let p = await picks();
  assert.equal(p.complejo.label, 'Sonnet 5.5'); assert.equal(p.normal.label, 'Sonnet 5.5', 'escribir código: nunca el ligero');
  await call('config.save', { patch: { budget: { profile: 4 }, policy: { highNeedsApproval: false } } });
  p = await picks();
  assert.equal(p.normal.label, 'Opus 5.5'); assert.equal(p.complejo.reasoning, 'high', 'sin aprobación, el alto sí');
  await call('config.save', { patch: { budget: { profile: 2 }, policy: { highNeedsApproval: true } } });
});

test('la tarea sin modelo se lanza con el elegido, que queda en ella y en su historial', async () => {
  const task = await call('tasks.create', { project: 'web', title: 'Rediseñar la portada', description: 'ESCRIBE la portada', agent: 'claude', level: 'complejo' });
  const done = await engine.taskDone(task.id, 30000);
  assert.equal(done.model, 'claude-opus-5-5');
  assert.ok(done.events.some((e) => e.kind === 'model.auto' && /Opus 5\.5 \(el más potente\) con razonamiento medio, para una tarea compleja/.test(e.detail)), JSON.stringify(done.events.map((e) => e.detail)));
  // A model chosen by hand is kept.
  const fixed = await call('tasks.create', { project: 'web', title: 'Texto', description: 'ESCRIBE un texto', agent: 'claude', model: 'claude-sonnet-5', level: 'simple' });
  assert.equal((await engine.taskDone(fixed.id, 30000)).model, 'claude-sonnet-5');
  // Turned off: the agent's default model, as before.
  await call('config.save', { patch: { budget: { autoModel: false } } });
  const plain = await call('tasks.create', { project: 'web', title: 'Otra', description: 'ESCRIBE otra cosa', agent: 'claude', level: 'complejo' });
  const off = await engine.taskDone(plain.id, 30000);
  assert.ok(!off.events.some((e) => e.kind === 'model.auto'));
});
