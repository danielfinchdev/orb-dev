// 3.6, the Android app and the phone's page: the protocol they speak (and when they must update) and the app lock's
// pieces (app-bridge.js, OrbNativePlugin.java).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from './helpers.mjs';
import { PROTOCOL, MIN_PROTOCOL, updateNeeded } from '../src/ui/lib/link-payload.js';

const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');

test('la página y la app hablan el protocolo del Orb y piden actualizar solo si hace falta', () => {
  // 3.7 apps keep working with a 3.8 PC: the same protocol and the same oldest one accepted.
  assert.equal(PROTOCOL, 3);
  assert.equal(MIN_PROTOCOL, 2);
  assert.equal(updateNeeded({ v: 3, min: 2 }), null);
  assert.equal(updateNeeded({ v: 3, min: 3 }), null);
  assert.equal(updateNeeded(null), null, 'un Orb antiguo sin min');
  assert.deepEqual(updateNeeded({ v: 4, min: 4 }), { has: 3, need: 4 });
  const web = read('src/ui/lib/web-bridge.js');
  assert.match(web, /post\('\/api\/me', 'me', \{ v: L\.PROTOCOL \}\)/, '/api/me lleva la versión');
  assert.match(web, /needsUpdate/);
  assert.match(web, /me: \(\) => me/);
});

test('la app: bloqueo con huella del sistema; los recordatorios de 3.7 se anulan una vez', () => {
  const app = read('src/ui/lib/app-bridge.js');
  assert.match(app, /orb\.appLock = \{/);
  assert.match(app, /biometricAvailable/); assert.match(app, /biometricVerify/);
  assert.doesNotMatch(app, /bots\.reminders\.list/);
  assert.match(app, /x\.id >= 50_000 && x\.id < 51_000/, '3.8: los recordatorios que dejó 3.7 en el móvil se anulan');
  assert.doesNotMatch(app, /config\?\.mobile\?\.preview \?\? 'chat';\n\s*const title/, 'el aviso del chat usa la preferencia de la persona');
  const java = read('android-app/android/app/src/main/java/dev/orb/app/OrbNativePlugin.java');
  assert.match(java, /public void biometricAvailable\(PluginCall call\)/);
  assert.match(java, /public void biometricVerify\(PluginCall call\)/);
  assert.match(read('android-app/android/app/src/main/AndroidManifest.xml'), /android\.permission\.USE_BIOMETRIC/);
  const { version } = JSON.parse(read('package.json'));
  assert.equal(JSON.parse(read('android-app/package.json')).version, version);
});
