// 3.8.3 (restructuring): the layers' import rules (docs/architecture.md). A cheap check over the import graph of src:
// each layer imports only the layers below it, and no new import cycle appears.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from './helpers.mjs';

const SRC = path.join(ROOT, 'src');
const files = [];
const walk = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const f = path.join(d, e.name); if (e.isDirectory()) { if (!['renderer', 'locales', 'public'].includes(e.name)) walk(f); } else if (/\.(mjs|js|jsx)$/.test(e.name)) files.push(f); } };
walk(SRC);
const rel = (f) => path.relative(SRC, f).split(path.sep).join('/');
const layerOf = (r) => r.split('/')[0];

// Every relative import (static, re-export or dynamic) of every file, resolved to a file of src.
const graph = new Map();
for (const f of files) {
  const code = fs.readFileSync(f, 'utf8');
  const deps = new Set();
  for (const m of code.matchAll(/(?:\bfrom\s*|\bimport\s*\(\s*|^\s*import\s+)['"](\.{1,2}\/[^'"]+)['"]/gm)) {
    const target = path.resolve(path.dirname(f), m[1]);
    if (target.startsWith(SRC) && fs.existsSync(target) && fs.statSync(target).isFile()) deps.add(rel(target));
  }
  graph.set(rel(f), deps);
}

// Which layers each layer may import (its own included). `core` is what is left of the old mixed folder.
const ALLOWED = {
  shared: ['shared'],
  platform: ['shared', 'platform'],
  core: ['shared', 'platform', 'core'],
  domain: ['shared', 'platform', 'core', 'domain'],
  agents: ['shared', 'platform', 'core', 'domain', 'agents'],
  mcp: ['shared', 'platform', 'core', 'domain', 'mcp', 'agents'],
  engine: ['shared', 'platform', 'core', 'domain', 'agents', 'engine', 'mcp'],
  ui: ['shared', 'ui'],
};
// The window's code may use only these files outside src/ui (pure, no Node).
const UI_SHARED = (r) => layerOf(r) === 'shared' || layerOf(r) === 'ui';
// Imports that break the rules and are still being moved (the list only shrinks).
const PENDING = new Set([
  'mcp/secret-run.mjs -> engine/agent-auth.mjs', 'mcp/server.mjs -> engine/logs.mjs',
]);
const pending = (edge) => PENDING.has(edge);

test('every file belongs to a known layer', () => {
  const unknown = [...graph.keys()].filter((r) => r.includes('/') && !ALLOWED[layerOf(r)]);
  assert.deepEqual(unknown, []);
});

test('each layer imports only the layers it may', () => {
  const bad = [];
  for (const [from, deps] of graph) {
    const allowed = ALLOWED[layerOf(from)];
    if (!allowed) continue;
    for (const to of deps) if (!allowed.includes(layerOf(to)) && !pending(`${from} -> ${to}`)) bad.push(`${from} -> ${to}`);
  }
  assert.deepEqual(bad, []);
});

test('the window imports only shared, pure modules', () => {
  const bad = [];
  for (const [from, deps] of graph) if (layerOf(from) === 'ui') for (const to of deps) if (!UI_SHARED(to) && !pending(`${from} -> ${to}`)) bad.push(`${from} -> ${to}`);
  assert.deepEqual(bad, []);
});

// Import cycles (Tarjan's strongly connected components); the static and dynamic imports both count.
function cycles() {
  let i = 0; const index = new Map(); const low = new Map(); const stack = []; const on = new Set(); const out = [];
  const visit = (v) => {
    index.set(v, i); low.set(v, i); i++; stack.push(v); on.add(v);
    for (const w of graph.get(v) ?? []) {
      if (!index.has(w)) { visit(w); low.set(v, Math.min(low.get(v), low.get(w))); } else if (on.has(w)) low.set(v, Math.min(low.get(v), index.get(w)));
    }
    if (low.get(v) === index.get(v)) { const c = []; let w; do { w = stack.pop(); on.delete(w); c.push(w); } while (w !== v); if (c.length > 1) out.push(c.sort().join(' | ')); }
  };
  for (const v of graph.keys()) if (!index.has(v)) visit(v);
  return out.sort();
}

// Cycles that existed before the restructuring and are still being untangled; none may be added.
const KNOWN_CYCLES = [];

test('no import cycles beyond the known ones', () => assert.deepEqual(cycles().filter((c) => !KNOWN_CYCLES.includes(c)), []));
