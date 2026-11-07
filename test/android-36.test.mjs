// 3.6, the Android app and the phone's page: the protocol they speak (and when they must update), the bots' reminders
// scheduled on the phone (src/ui/lib/reminder-notes.js) and the app lock's pieces (app-bridge.js, OrbNativePlugin.java).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from './helpers.mjs';
import { PROTOCOL, MIN_PROTOCOL, updateNeeded } from '../src/ui/lib/link-payload.js';
import { upcomingReminderNotes, REMINDER_IDS, HORIZON_MS } from '../src/ui/lib/reminder-notes.js';

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

test('recordatorios de las próximas 48 h, con el texto solo si la persona lo quiere ver', () => {
  const now = Date.parse('2026-11-04T10:00:00Z');
  const at = (h) => new Date(now + h * 3_600_000).toISOString();
  const list = [
    { id: 1, bot_id: 7, text: 'Cita de Ana con el dentista', next_run: at(2), enabled: true },
    { id: 2, bot_id: 7, text: 'Pasado el plazo', next_run: at(-1), enabled: true },
    { id: 3, bot_id: 8, text: 'Muy lejos', next_run: at(72), enabled: true },
    { id: 4, bot_id: 8, text: 'Apagado', next_run: at(3), enabled: false },
    { id: 5, bot_id: 8, text: 'Sin hora', next_run: null, enabled: true },
    { id: 6, bot_id: 8, text: 'Leo: llamar', next_run: at(1), enabled: 1 }
  ];
  const names = { 7: 'Agenda', 8: 'Casa' };
  const shown = upcomingReminderNotes(list, now, { preview: 'all', titleFor: (r) => names[r.bot_id], hidden: { title: 'Recordatorio', body: 'Tienes un recordatorio' } });
  assert.deepEqual(shown.map((n) => n.id), [REMINDER_IDS.first + 6, REMINDER_IDS.first + 1], 'en orden de hora, solo los próximos');
  assert.equal(shown[1].title, 'Agenda');
  assert.equal(shown[1].body, 'Cita de Ana con el dentista');
  assert.equal(shown[1].at, now + 2 * 3_600_000);
  for (const preview of ['chat', 'none', undefined]) {
    const hidden = upcomingReminderNotes(list, now, { preview, titleFor: (r) => names[r.bot_id], hidden: { title: 'Recordatorio', body: 'Tienes un recordatorio' } });
    assert.equal(hidden.length, 2);
    for (const n of hidden) { assert.equal(n.title, 'Recordatorio'); assert.equal(n.body, 'Tienes un recordatorio'); }
  }
  assert.ok(HORIZON_MS === 48 * 3_600_000);
  for (const n of shown) assert.ok(n.id >= REMINDER_IDS.first && n.id < REMINDER_IDS.first + REMINDER_IDS.size && n.id > 1000, 'aparte de los avisos del chat');
  assert.deepEqual(upcomingReminderNotes(null, now), []);
});

test('la app: bloqueo con huella del sistema, recordatorios y vista previa de cada persona', () => {
  const app = read('src/ui/lib/app-bridge.js');
  assert.match(app, /orb\.appLock = \{/);
  assert.match(app, /biometricAvailable/); assert.match(app, /biometricVerify/);
  assert.match(app, /persons\.prefs\.get/);
  assert.match(app, /bots\.reminders\.list/);
  assert.doesNotMatch(app, /config\?\.mobile\?\.preview \?\? 'chat';\n\s*const title/, 'el aviso del chat usa la preferencia de la persona');
  const java = read('android-app/android/app/src/main/java/dev/orb/app/OrbNativePlugin.java');
  assert.match(java, /public void biometricAvailable\(PluginCall call\)/);
  assert.match(java, /public void biometricVerify\(PluginCall call\)/);
  assert.match(read('android-app/android/app/src/main/AndroidManifest.xml'), /android\.permission\.USE_BIOMETRIC/);
  const { version } = JSON.parse(read('package.json'));
  assert.equal(JSON.parse(read('android-app/package.json')).version, version);
});
