// 3.8.3 (restructuring): the app's Rust side names some of the workspace's folders itself (it runs before the engine
// and outside it). Those names must be the ones src/platform/paths.mjs gives, the single source on the Node side.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from './helpers.mjs';
import { paths, CORE_DIR } from '../src/platform/paths.mjs';

const home = path.resolve('/orb');
const p = paths(home);
const rel = (from, to) => path.relative(from, to).split(path.sep);
const rust = (...f) => fs.readFileSync(path.join(ROOT, 'src-tauri', ...f), 'utf8');
const chain = (parts) => parts.map((x) => `.join("${x}")`).join('');

test('the Rust side uses the same names for core and its folders', () => {
  assert.equal(CORE_DIR, 'core');
  const desktop = rust('src', 'desktop.rs');
  assert.ok(desktop.includes(`let core = home${chain([CORE_DIR])};`), 'desktop.rs: core');
  assert.ok(desktop.includes(`core${chain(rel(p.core, p.secrets))}`) && desktop.includes(`core${chain(rel(p.core, p.data))}`), 'desktop.rs: secretos and datos');
  assert.ok(rust('src', 'engine.rs').includes(`h${chain([...rel(home, p.runs), 'motor-salida.log'])}`), 'engine.rs: the runs folder');
  assert.ok(rust('src', 'lib.rs').includes(`.join("${CORE_DIR}")`), 'lib.rs: core');
  assert.ok(rust('vault', 'src', 'machine.rs').includes(`dir.join("${path.basename(p.key)}")`), 'vault: the plain secret file');
});
