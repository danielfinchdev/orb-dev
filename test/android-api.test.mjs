// 3.8 (F5b): Ajustes › Avanzado › Android through the engine's API (android.status / android.install): where adb is
// (core\herramientas\adb, or an android\adb-tools the user kept at the top of the workspace) and that the tests never
// download nor run it (ORB_NO_ADB).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { tempHome, startEngine } from './helpers.mjs';

test('android.status dice dónde está adb; android.install no descarga nada con ORB_NO_ADB', async () => {
  const t = tempHome();
  let e = await startEngine(t.home, { env: { ORB_NO_ADB: '1' } });
  try {
    const st = await e.call('android.status');
    assert.equal(st.dir, path.join(t.home, 'core', 'herramientas', 'adb'));
    assert.equal(st.ready, false);
    const r = await e.call('android.install');
    assert.equal(r.ready, false);
    assert.equal(r.state, 'off');
    assert.ok(!fs.existsSync(path.join(t.home, 'core', 'descargas')), 'nada descargado');
  } finally { await e.stop(); }
  // adb-tools kept at the top (Ordenar carpetas › Dejar donde está): used where it is.
  const kept = path.join(t.home, 'android', 'adb-tools');
  fs.mkdirSync(kept, { recursive: true });
  fs.writeFileSync(path.join(kept, process.platform === 'win32' ? 'adb.exe' : 'adb'), 'adb');
  e = await startEngine(t.home, { env: { ORB_NO_ADB: '1' } });
  try {
    const st = await e.call('android.status');
    assert.equal(st.dir, kept);
    assert.equal(st.ready, true);
  } finally { await e.stop(); t.cleanup(); }
});
