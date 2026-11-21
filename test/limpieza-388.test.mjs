// Cleanup after the UI 2.0 rewrite: no CSS for a theme that is not in SKINS, and no import of a file that is gone.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SKINS } from '../src/shared/appearance.mjs';

const UI = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'src', 'ui');

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { if (e.name !== 'public') walk(p, out); } else out.push(p);
  }
  return out;
}
const files = walk(UI);

test('no CSS or code targets a theme that is not in SKINS', () => {
  const seen = new Set();
  for (const f of files.filter((x) => /\.(css|jsx?|html)$/.test(x))) {
    const text = fs.readFileSync(f, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
    for (const m of text.matchAll(/data-skin(?:=|\s*=\s*)["']?([\w-]+)/g)) seen.add(`${m[1]}\t${path.relative(UI, f)}`);
    for (const m of text.matchAll(/\[data-skin=["']([\w-]+)["']\]/g)) seen.add(`${m[1]}\t${path.relative(UI, f)}`);
  }
  const stray = [...seen].filter((s) => !SKINS.includes(s.split('\t')[0]));
  assert.deepEqual(stray, []);
});

test('no scene-*.css or skin thumbnail is left behind', () => {
  const names = files.map((f) => path.basename(f));
  assert.deepEqual(names.filter((n) => /^scene-.*\.css$/.test(n) || /^skin-preview\./.test(n)), []);
});

test('every relative or @/ import of src/ui points at a file that exists', () => {
  const re = /(?:from\s*|import\s*\(?\s*|@import\s+(?:url\()?|import\s+)['"]((?:\.{1,2}\/|@\/)[^'"]+)['"]/g;
  const missing = [];
  for (const f of files.filter((x) => /\.(jsx?|mjs|css)$/.test(x))) {
    const text = fs.readFileSync(f, 'utf8');
    for (const m of text.matchAll(re)) {
      const spec = m[1].split('?')[0];
      const base = spec.startsWith('@/') ? path.join(UI, spec.slice(2)) : path.resolve(path.dirname(f), spec);
      const ok = [base, `${base}.js`, `${base}.jsx`, `${base}.mjs`, path.join(base, 'index.jsx'), path.join(base, 'index.js')].some((c) => fs.existsSync(c) && fs.statSync(c).isFile());
      if (!ok) missing.push(`${path.relative(UI, f)} -> ${spec}`);
    }
  }
  assert.deepEqual(missing, []);
});
