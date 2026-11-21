// The Android games bundle swaps five desktop modules for small shims (android/web/build.mjs). A name the games
// import that a shim does not export is only a build warning, and then a crash on the phone when it is called.
// games.jsx is the desktop window and is not bundled: the phone has its own page (android/web/main.jsx).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from './helpers.mjs';

const GAMES = path.join(ROOT, 'src', 'ui', 'games');
const SHIMS = path.join(ROOT, 'android', 'web', 'shims');
const MODULES = ['i18n', 'store', 'music', 'utils', 'audio-context'];

const sources = () => fs.readdirSync(GAMES, { recursive: true })
  .filter((f) => /\.(jsx?|mjs)$/.test(String(f)) && path.basename(String(f)) !== 'games.jsx')
  .map((f) => fs.readFileSync(path.join(GAMES, String(f)), 'utf8'));

function importedFrom(module) {
  const names = new Set();
  const re = new RegExp(`import\\s*\\{([^}]*)\\}\\s*from\\s*['"]@/lib/${module}\\.js['"]`, 'g');
  for (const src of sources()) {
    for (const m of src.matchAll(re)) {
      for (const part of m[1].split(',')) {
        const name = part.trim().split(/\s+as\s+/)[0].trim();
        if (name) names.add(name);
      }
    }
  }
  return names;
}

function exportedBy(module) {
  const src = fs.readFileSync(path.join(SHIMS, `${module}.js`), 'utf8');
  const names = new Set();
  for (const m of src.matchAll(/export\s+(?:async\s+)?(?:const|let|function\*?|class)\s+([A-Za-z0-9_$]+)/g)) names.add(m[1]);
  for (const m of src.matchAll(/export\s*\{([^}]*)\}/g)) {
    for (const part of m[1].split(',')) {
      const name = part.trim().split(/\s+as\s+/).pop().trim();
      if (name) names.add(name);
    }
  }
  return names;
}

for (const module of MODULES) {
  test(`the Android shim of ${module}.js exports every name the games import`, () => {
    const have = exportedBy(module);
    const missing = [...importedFrom(module)].filter((n) => !have.has(n));
    assert.deepEqual(missing, []);
  });
}
