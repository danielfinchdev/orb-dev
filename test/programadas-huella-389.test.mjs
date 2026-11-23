import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scheduleHash } from '../src/domain/schedules/schedules.mjs';

const base = { id: 1, project: 'web', title: 'T', description: 'd', agent: 'claude', every: 'every_hours', at_time: '6', weekdays: [], notify_mobile: true };

test('the fingerprint changes with what changes when or how a schedule runs', () => {
  const h = scheduleHash(base);
  assert.notEqual(scheduleHash({ ...base, notify_mobile: false }), h);
  assert.notEqual(scheduleHash({ ...base, at_time: '12' }), h, 'the hours of «every N hours» live in at_time');
  assert.equal(scheduleHash({ ...base }), h);
});

test('the missing-fingerprint message tells a phone user to update the app', async () => {
  const en = (await import('../src/shared/locales/en/msg.mjs')).default;
  const es = (await import('../src/shared/locales/es/msg.mjs')).default;
  assert.match(en['msg.schedules.needsHash'], /update the Orb app on the phone/);
  assert.match(es['msg.schedules.needsHash'], /actualiza la app de Orb en el móvil/);
});
