// Step 10: Ctrl+P (find a file) and Ctrl+Shift+F (find text) in the project: only inside it, never secrets, links or
// Orb's own folders, and the query is only data.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { findFiles, searchText, findRg, allowedPath, fileScore } from '../src/engine/host/project-search.mjs';

function project() {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'orb-find-'));
  const root = path.join(base, 'app'); const outside = path.join(base, 'fuera');
  const put = (rel, text) => { const f = path.join(root, rel); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, text); };
  put('src/main.js', 'const ruta = "hola mundo";\n-n es una opción\n');
  put('src/util/Paleta.jsx', 'export const Paleta = 1;\n');
  put('README.md', 'Proyecto de prueba. Hola Mundo\n');
  put('.env', 'TOKEN=hola-mundo-secreto\n');
  put('claves.pem', 'hola mundo');
  put('.claude/settings.json', '{"hola mundo": 1}');
  put('node_modules/dep/index.js', 'hola mundo');
  put('.git/config', 'hola mundo');
  put('.orb/estado.json', 'hola mundo');
  put('datos.bin', Buffer.from([104, 111, 108, 97, 0, 1, 2]).toString('latin1'));
  fs.mkdirSync(outside, { recursive: true });
  fs.writeFileSync(path.join(outside, 'secreto.txt'), 'hola mundo fuera');
  try { fs.symlinkSync(outside, path.join(root, 'enlace'), 'junction'); } catch { /* no links here: the check below still holds */ }
  return { base, root };
}

test('Ctrl+P finds files by words in the path, best match first, and never a secret, a link or an internal folder', async () => {
  const { base, root } = project();
  try {
    assert.deepEqual((await findFiles(root, 'paleta')).files, ['src/util/Paleta.jsx']);
    assert.deepEqual((await findFiles(root, 'main')).files, ['src/main.js']);
    assert.deepEqual((await findFiles(root, 'src util')).files, ['src/util/Paleta.jsx']);
    const all = (await findFiles(root, '.')).files;
    for (const hidden of ['.env', 'claves.pem', '.claude/settings.json', 'node_modules/dep/index.js', '.git/config', '.orb/estado.json', 'enlace/secreto.txt']) assert.ok(!all.includes(hidden), hidden);
    assert.deepEqual((await findFiles(root, '')).files, []);
    await assert.rejects(findFiles(root, 'a'.repeat(300)));
  } finally { fs.rmSync(base, { recursive: true, force: true }); }
});

test('Ctrl+Shift+F finds the text without case, skips secrets, links, binaries and internal folders; a dash or a regex is just text', async () => {
  const { base, root } = project();
  try {
    const found = (await searchText(root, 'hola mundo', { rg: null })).hits;
    assert.deepEqual(found.map((h) => h.file).sort(), ['README.md', 'src/main.js']);
    assert.equal(found.find((h) => h.file === 'src/main.js').line, 1);
    assert.equal((await searchText(root, 'Hola Mundo', { rg: null })).hits.map((h) => h.file).join(), 'README.md', 'a capital letter makes it case sensitive');
    assert.equal((await searchText(root, '-n es', { rg: null })).hits[0].line, 2, 'a query that starts with a dash is not an option');
    assert.deepEqual((await searchText(root, '.*', { rg: null })).hits, [], 'not a regular expression');
    assert.deepEqual((await searchText(root, 'x', { rg: null })).hits, [], 'one letter is too little');
    assert.deepEqual((await searchText(root, 'hola', { rg: null })).hits.filter((h) => /env|pem|settings|datos|enlace|node_modules|\.git|\.orb/.test(h.file)), []);
  } finally { fs.rmSync(base, { recursive: true, force: true }); }
});

test('a secret in a line is hidden before it is shown', async () => {
  const { base, root } = project();
  try {
    fs.writeFileSync(path.join(root, 'notas.txt'), 'usa sk-abcdefghijklmnop1234 para entrar\n');
    const hit = (await searchText(root, 'para entrar', { rg: null })).hits[0];
    assert.ok(!hit.text.includes('sk-abcdefghijklmnop1234'));
    assert.match(hit.text, /secreto oculto/);
  } finally { fs.rmSync(base, { recursive: true, force: true }); }
});

test('the helpers: allowed paths, ranking and where rg is looked for', () => {
  assert.equal(allowedPath('src/a.js'), true);
  for (const p of ['.env', 'a/.env.local', 'a/id_rsa', 'node_modules/x.js', 'a/.git/HEAD', '.claude/settings.local.json']) assert.equal(allowedPath(p), false, p);
  assert.ok(fileScore('src/main.js', ['main']) > fileScore('src/domain/maintenance.js', ['main']));
  assert.equal(fileScore('src/a.js', ['zzz']), 0);
  const dir = path.resolve('/herramientas/bin');
  const name = process.platform === 'win32' ? 'rg.exe' : 'rg';
  assert.equal(findRg({ PATH: `${dir}${path.delimiter}relativa` }, (f) => f === path.join(dir, name)), path.join(dir, name));
  assert.equal(findRg({ PATH: 'relativa' }, () => true), null, 'only absolute folders of the PATH');
  assert.equal(allowedPath('a.txt', 'C:/Users/x/keepass/proj'), false, 'a protected entry written as a path matches the absolute path too');
});
