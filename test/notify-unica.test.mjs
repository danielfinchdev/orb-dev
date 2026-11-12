// Every notification goes through lib/notify.js: nothing else in the interface may import the toast library, and no
// promise may swallow its error with an empty catch.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const walk = (dir) => readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(join(dir, e.name)) : [join(dir, e.name)]));
const files = walk('src/ui').filter((f) => /\.(jsx?|mjs)$/.test(f));
const norm = (f) => f.split('\').join('/');

test('only lib/notify.js imports sonner', () => {
  const bad = files.filter((f) => norm(f) !== 'src/ui/lib/notify.js' && /from\s+['"]sonner['"]|require\(['"]sonner['"]\)/.test(readFileSync(f, 'utf8')));
  assert.deepEqual(bad, []);
});

test('no empty .catch(() => {}) left in the interface', () => {
  const bad = files.filter((f) => /\.catch\(\(\)\s*=>\s*\{\s*\}\)/.test(readFileSync(f, 'utf8')));
  assert.deepEqual(bad, []);
});

test('redact keeps the sentence and drops paths and secrets', async () => {
  const { redact } = await import('../src/ui/lib/redact.js');
  assert.equal(redact('No se pudo leer C:\Users\dani\secreto\notas.txt ahora'), 'No se pudo leer …/notas.txt ahora');
  assert.equal(redact('fallo en /home/dani/.ssh/id_rsa'), 'fallo en …/id_rsa');
  assert.ok(!redact('token sk-abcdefghijklmnop1234').includes('abcdefghij'));
  assert.ok(!redact('Bearer abc.def.ghi falló').includes('abc.def'));
  assert.ok(redact('x'.repeat(500)).length <= 240);
});
