// 3.6, the Android app and the phone's page: the protocol they speak (and when they must update), and what the app
// does on its own (app-bridge.js; 3.8.1: the Tauri app's OrbNativePlugin.kt).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from './helpers.mjs';
import { PROTOCOL, MIN_PROTOCOL, PAIR_PROTOCOL, updateNeeded } from '../src/shared/link-payload.mjs';

const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');

test('la página y la app hablan el protocolo del Orb y piden actualizar solo si hace falta', () => {
  // 3.8 (protocol 4): linking needs it (the master password); phones linked by 3.7 keep working (the same oldest one).
  assert.equal(PROTOCOL, 4);
  assert.equal(MIN_PROTOCOL, 2);
  assert.equal(PAIR_PROTOCOL, 4);
  assert.equal(updateNeeded({ v: 4, min: 2 }), null);
  assert.equal(updateNeeded({ v: 4, min: 4 }), null);
  assert.equal(updateNeeded(null), null, 'un Orb antiguo sin min');
  assert.deepEqual(updateNeeded({ v: 5, min: 5 }), { has: 4, need: 5 });
  const web = read('src/ui/lib/web-bridge.js');
  assert.match(web, /post\('\/api\/me', 'me', \{ v: L\.PROTOCOL \}[,)]/, '/api/me lleva la versión');
  assert.match(web, /needsUpdate/);
  assert.match(web, /me: \(\) => me/);
});

test('la app: sin bloqueo propio; su versión es la del paquete', () => {
  const app = read('src/ui/lib/app-bridge.js');
  assert.doesNotMatch(app, /appLock|biometric/, '3.8.0: sin bloqueo con PIN ni huella (llega con la contraseña maestra)');
  assert.doesNotMatch(app, /bots\.reminders\.list/);
  // 3.8.1: the reminders 3.7 left pointed at Capacitor's receiver, gone in the Tauri app: Android ignores them.
  assert.doesNotMatch(app, /50_000/);
  assert.doesNotMatch(app, /config\?\.mobile\?\.preview \?\? 'chat';\n\s*const title/, 'el aviso del chat usa la preferencia de la persona');
  const kt = read('src-tauri/gen/android/app/src/main/java/dev/orb/app/OrbNativePlugin.kt');
  assert.doesNotMatch(kt, /Biometric/);
  assert.doesNotMatch(read('src-tauri/gen/android/app/src/main/AndroidManifest.xml'), /USE_BIOMETRIC/);
  // The app's version is the package's (Tauri: versionName and versionCode = major·1 000 000 + minor·1000 + patch).
  assert.equal(JSON.parse(read('src-tauri/tauri.conf.json')).version, '../package.json');
});
