// Proyectos multiplataforma (3.8): la categoría multi crea UNA carpeta multi\<nombre> con un solo repositorio, una
// subcarpeta por plataforma y compartido\ para lo común; una sola plataforma, como siempre.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { tempHome, startEngine } from './helpers.mjs';
import { git } from '../src/core/workspace.mjs';

let t; let engine; let call;
before(async () => { t = tempHome(); engine = await startEngine(t.home); ({ call } = engine); });
after(async () => { await engine?.stop(); t.cleanup(); });

test('tienda para Android, iOS y web: una carpeta en multi, un repositorio, una subcarpeta por plataforma y compartido', async () => {
  const r = await call('projects.create', { name: 'tienda', category: 'multi', platforms: ['web', 'android', 'ios'] });
  assert.equal(r.name, 'tienda');
  assert.equal(r.path, fs.realpathSync(path.join(t.home, 'multi', 'tienda')));
  for (const sub of ['ios', 'android', 'web', 'compartido']) assert.ok(fs.statSync(path.join(r.path, sub)).isDirectory(), sub);
  assert.ok(!fs.existsSync(path.join(r.path, 'windows')), 'solo las plataformas elegidas');
  assert.match(fs.readFileSync(path.join(r.path, 'LEEME.md'), 'utf8'), /ios\/, android\/, web\/[\s\S]*compartido\//);
  assert.ok(fs.existsSync(path.join(r.path, '.git')), 'un solo repositorio');
  assert.ok(!fs.existsSync(path.join(r.path, 'android', '.git')));
  assert.match(git(r.path, 'ls-files').stdout, /compartido\/\.gitkeep/, 'las subcarpetas van en el primer commit');
  const list = await call('projects.list');
  const p = list.find((x) => x.name === 'tienda');
  assert.equal(p.category, 'multi'); assert.equal(p.grupo ?? null, null);
  assert.ok(!list.some((x) => /^tienda-/.test(x.name)), 'no se crea un proyecto por plataforma');
  assert.ok(!fs.existsSync(path.join(t.home, 'comun')), 'ya no hay carpeta comun');
  // Several platforms without saying multi is the same; one platform is a plain project.
  assert.equal((await call('projects.create', { name: 'juego', platforms: ['windows', 'linux'] })).path, fs.realpathSync(path.join(t.home, 'multi', 'juego')));
  const single = await call('projects.create', { name: 'blog', category: 'linux' });
  assert.equal(single.path, fs.realpathSync(path.join(t.home, 'linux', 'blog')));
  await assert.rejects(call('projects.create', { name: 'otra', category: 'multi', platforms: ['macos'] }), /plataforma/);
});
