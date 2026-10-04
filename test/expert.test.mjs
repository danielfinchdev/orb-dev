// Expert mode: the project's files, git and the machine's load, read-only, never outside the project, never secrets.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { tempHome } from './helpers.mjs';
import { tree, readFile, gitStatus, gitDiff, gitLog, systemStats } from '../src/engine/expert.mjs';

let t; let proj;
const g = (cwd, ...args) => execFileSync('git', ['-C', cwd, '-c', 'user.name=T', '-c', 'user.email=t@t', ...args], { stdio: 'pipe' });
before(() => {
  t = tempHome();
  proj = path.join(t.home, 'web');
  fs.mkdirSync(path.join(proj, 'src'), { recursive: true });
  fs.writeFileSync(path.join(proj, 'src', 'app.js'), 'console.log(1);\n');
  fs.writeFileSync(path.join(proj, 'README.md'), '# Web\n');
  g(proj, 'init', '-q'); g(proj, 'add', '.'); g(proj, 'commit', '-qm', 'inicio');
  fs.writeFileSync(path.join(proj, 'src', 'app.js'), 'console.log(2);\nconst key = "sk-abcdefghijklmnop";\n');
  fs.writeFileSync(path.join(proj, 'nuevo.txt'), 'hola\n');
  fs.writeFileSync(path.join(proj, '.env'), 'TOKEN=secreto\n');
  fs.writeFileSync(path.join(proj, 'logo.bin'), Buffer.from([1, 0, 2, 0, 3]));
  fs.writeFileSync(path.join(t.home, 'fuera.txt'), 'no deberías verme');
});
after(() => t.cleanup());

test('árbol de archivos: carpetas primero, sin .git, los secretos marcados', () => {
  const root = tree(proj);
  assert.deepEqual(root.entries.map((e) => e.name), ['src', '.env', 'logo.bin', 'nuevo.txt', 'README.md']);
  assert.equal(root.entries.find((e) => e.name === '.env').secret, true);
  assert.deepEqual(tree(proj, 'src').entries.map((e) => e.path), ['src/app.js']);
  assert.throws(() => tree(proj, '.git'), /interna/);
});

test('leer archivos: nunca fuera del proyecto ni secretos; binarios sin contenido; claves ocultas', () => {
  assert.match(readFile(proj, 'README.md').text, /# Web/);
  assert.match(readFile(proj, 'src/app.js').text, /\[secreto oculto\]/);
  assert.equal(readFile(proj, 'logo.bin').binary, true);
  assert.throws(() => readFile(proj, '.env'), /secretos/);
  assert.throws(() => readFile(proj, '../fuera.txt'), /fuera del proyecto/);
  assert.throws(() => readFile(proj, path.join(t.home, 'fuera.txt')), /no válida/);
  for (const trick of ['.env::$DATA', '.env.', '.env ', 'src/../.env.']) assert.throws(() => readFile(proj, trick), /no válida/, `nombre engañoso de Windows: ${trick}`);
  assert.throws(() => readFile(proj, '.GIT/config'), /interna|no existe/);
  if (process.platform !== 'win32') {
    fs.symlinkSync(path.join(t.home, 'fuera.txt'), path.join(proj, 'enlace.txt'));
    assert.throws(() => readFile(proj, 'enlace.txt'), /fuera del proyecto/, 'un enlace que sale del proyecto');
    fs.rmSync(path.join(proj, 'enlace.txt'));
  }
});

test('git: estado, cambios (sin secretos) e historial', async () => {
  const st = await gitStatus(proj);
  assert.equal(st.repo, true);
  const byPath = Object.fromEntries(st.files.map((f) => [f.path, f]));
  assert.equal(byPath['src/app.js'].state, 'cambiado');
  assert.equal(byPath['nuevo.txt'].state, 'nuevo');
  assert.equal(byPath['.env'].secret, true);
  const all = (await gitDiff(proj)).diff;
  assert.match(all, /\+console\.log\(2\);/);
  assert.match(all, /\+hola/, 'los archivos nuevos se ven enteros');
  assert.doesNotMatch(all, /TOKEN=secreto/);
  assert.doesNotMatch(all, /sk-abcdefghijklmnop/);
  await assert.rejects(gitDiff(proj, '.env'), /secretos/);
  await assert.rejects(gitDiff(proj, '../fuera.txt'), /sin cambios|no tiene cambios/);
  // Patterns never reach git as patterns: only exact names from the changes list.
  for (const pattern of ['.', '*', '[.]env', '.e*', ':(icase).ENV']) await assert.rejects(gitDiff(proj, pattern), /no tiene cambios/, pattern);
  assert.match((await gitDiff(proj, 'nuevo.txt')).diff, /\+hola/);
  assert.equal((await gitLog(proj))[0].subject, 'inicio');
});

test('un .env que ya estaba en git tampoco sale en el diff completo', async () => {
  g(proj, 'add', '-f', '.env'); g(proj, 'commit', '-qm', 'con env');
  fs.writeFileSync(path.join(proj, '.env'), 'TOKEN=otro\n');
  const all = (await gitDiff(proj)).diff;
  assert.doesNotMatch(all, /TOKEN=/);
  assert.match(all, /console\.log\(2\)/);
});

test('un proyecto dentro de un repositorio más grande solo ve lo suyo', async () => {
  const big = path.join(t.home, 'grande'); const sub = path.join(big, 'parte');
  fs.mkdirSync(sub, { recursive: true });
  fs.writeFileSync(path.join(big, 'otro.txt'), 'x'); fs.writeFileSync(path.join(sub, 'mio.txt'), 'y');
  g(big, 'init', '-q');
  assert.deepEqual((await gitStatus(sub)).files.map((f) => f.path), ['mio.txt']);
  assert.match((await gitDiff(sub)).diff, /\+y/);
});

test('carga del equipo', () => {
  systemStats(t.home);
  const s = systemStats(t.home);
  assert.ok(s.cores > 0 && s.memory.total > 0);
  assert.ok(s.cpu >= 0 && s.cpu <= 100);
});
