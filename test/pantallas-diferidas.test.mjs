// 3.8.3 (restructuring): the window loads most screens the first time they open (main.jsx › deferred), by the name of
// an export of a module. A module split in two must keep exporting that name, or the screen draws nothing (React #306).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from './helpers.mjs';

const UI = path.join(ROOT, 'src', 'ui');
const file = (spec) => path.join(UI, spec.replace(/^@\//, ''));
const read = (f) => fs.readFileSync(f, 'utf8');
// Names a module exports, following `export { … } from` and `export *` one level into the files it re-exports.
function exportsOf(f, seen = new Set()) {
  if (seen.has(f)) return new Set(); seen.add(f);
  const code = read(f); const out = new Set();
  for (const m of code.matchAll(/^export (?:async )?(?:function|const|let|class) ([A-Za-z_$][\w$]*)/gm)) out.add(m[1]);
  for (const m of code.matchAll(/^export \{([^}]*)\}(?: from '([^']+)')?/gm)) for (const n of m[1].split(',')) { const name = n.trim().split(/\s+as\s+/).pop(); if (name) out.add(name); }
  for (const m of code.matchAll(/^export \* from '([^']+)'/gm)) for (const n of exportsOf(path.resolve(path.dirname(f), m[1]), seen)) out.add(n);
  return out;
}

test('every screen the window loads later is exported by the module it names', () => {
  const main = read(path.join(UI, 'main.jsx'));
  const loaders = new Map([...main.matchAll(/const (\w+) = \(\) => import\('([^']+)'\);/g)].map((m) => [m[1], m[2]]));
  const wanted = [];
  for (const m of main.matchAll(/deferred\((?:\(\) => import\('([^']+)'\)|(\w+)), '(\w+)'\)/g)) wanted.push([m[1] ?? loaders.get(m[2]), m[3]]);
  for (const m of main.matchAll(/lazy\(\(\) => import\('([^']+)'\)\.then\(\(m\) => \(\{ default: m\.(\w+) \}\)\)\)/g)) wanted.push([m[1], m[2]]);
  assert.ok(wanted.length >= 15, `screens found: ${wanted.length}`);
  const missing = wanted.filter(([spec, name]) => !spec || !exportsOf(file(spec)).has(name)).map(([spec, name]) => `${name} (${spec})`);
  assert.deepEqual(missing, []);
});
