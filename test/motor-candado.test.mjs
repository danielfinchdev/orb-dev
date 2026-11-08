// 3.8.1 (review Tauri D-fix M3): the engine's lock (engine.mjs › holdWorkspace, approval-secret.mjs › exclusiveOpen) is a
// handle kept open with no sharing for the engine's whole life: while it lives nobody takes it (however old the file:
// a PC asleep or a long migration), nobody deletes it (a %TEMP% cleaner), and when the engine dies, however it dies,
// Windows lets it go.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { exclusiveOpen } from '../src/engine/approval-secret.mjs';

test('the engine lock: held while the process lives, never aged or deleted, free when it is killed', { skip: process.platform !== 'win32' }, async () => {
  const file = path.join(os.tmpdir(), `orb-motor-prueba-${process.pid}.lock`);
  const mod = new URL('../src/engine/approval-secret.mjs', import.meta.url).href;
  const child = spawn(process.execPath, ['--input-type=module', '-e', `const { exclusiveOpen } = await import(${JSON.stringify(mod)}); const fd = exclusiveOpen(${JSON.stringify(file)}); console.log(fd > 0 ? 'held' : 'no'); setInterval(() => {}, 1000);`], { stdio: ['ignore', 'pipe', 'inherit'] });
  try {
    const first = await new Promise((resolve) => child.stdout.once('data', (d) => resolve(String(d).trim())));
    assert.equal(first, 'held');
    const old = new Date(Date.now() - 24 * 3600_000);
    try { fs.utimesSync(file, old, old); } catch { /* its date need not change */ }
    assert.equal(exclusiveOpen(file), null, 'vivo (aunque el archivo sea viejo): no se toma');
    assert.throws(() => fs.rmSync(file), 'ni se borra');
    assert.throws(() => fs.renameSync(file, `${file}.x`), 'ni se mueve');
  } finally {
    child.kill();
    await new Promise((r) => (child.exitCode != null ? r() : child.once('exit', r)));
  }
  let fd = null;
  for (let i = 0; i < 50 && !(fd > 0); i++) { fd = exclusiveOpen(file); if (!(fd > 0)) await new Promise((r) => setTimeout(r, 100)); }
  assert.ok(fd > 0, 'muerto: se toma');
  fs.closeSync(fd); fs.rmSync(file, { force: true });
});
