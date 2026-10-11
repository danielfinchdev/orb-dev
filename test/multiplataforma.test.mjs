// Proyectos multiplataforma (2.7): varias plataformas a la vez crean <nombre>-<plataforma> en cada categoría, unidos en
// un grupo con su carpeta común; las tareas pueden ir a cualquiera del grupo; una sola plataforma, como siempre.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { tempHome, startEngine } from './helpers.mjs';

let t; let engine; let call;
before(async () => { t = tempHome(); engine = await startEngine(t.home); ({ call } = engine); });
after(async () => { await engine?.stop(); t.cleanup(); });

test('tienda para Android, iOS y web: tres proyectos unidos con su carpeta común', async () => {
  const r = await call('projects.create', { name: 'tienda', categories: ['android', 'ios', 'web'] });
  assert.deepEqual(r.all, ['tienda-android', 'tienda-ios', 'tienda-web']);
  const list = await call('projects.list');
  for (const [name, cat] of [['tienda-android', 'android'], ['tienda-ios', 'ios'], ['tienda-web', 'web']]) {
    const p = list.find((x) => x.name === name);
    assert.ok(p, name); assert.equal(p.grupo, 'tienda');
    assert.equal(path.basename(path.dirname(p.path)), cat, `${name} en su categoría`);
    assert.ok(fs.existsSync(path.join(p.path, '.git')), 'con git');
  }
  assert.ok(fs.existsSync(path.join(t.home, 'comun', 'tienda', 'LEEME.md')), 'carpeta común');
  // A task may go to a sister of the active project (the assistant coordinates the group).
  await call('projects.setActive', { name: 'tienda-android' });
  const single = await call('projects.create', { name: 'blog' });
  assert.equal(single.name, 'blog'); assert.equal((await call('projects.list')).find((x) => x.name === 'blog').grupo ?? null, null);
  await assert.rejects(call('projects.create', { name: 'tienda', categories: ['android', 'windows'] }), /ya existe un proyecto llamado tienda-android/);
});
