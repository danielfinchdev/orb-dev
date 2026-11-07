// 3.6: time zones (src/core/tz.mjs). A PC in UTC runs Leo's schedules at his wall time in Europe/Madrid, also
// across both daylight-saving changes; 02:30 on the spring-forward night fires at 03:00; late runs say how late.
import test from 'node:test';
import assert from 'node:assert/strict';
import { zonedToUtc, utcToZoned, nextLocalRun, minutesLate, shouldFireLate, isValidTz, offsetAt, localDay } from '../src/core/tz.mjs';
import { translate } from '../src/core/i18n.mjs';

const MAD = 'Europe/Madrid';
const iso = (d) => d.toISOString();

test('zonedToUtc and utcToZoned round-trip, winter and summer', () => {
  assert.equal(iso(zonedToUtc('2026-01-15T09:00', MAD)), '2026-01-15T08:00:00.000Z');
  assert.equal(iso(zonedToUtc('2026-07-15T09:00', MAD)), '2026-07-15T07:00:00.000Z');
  assert.equal(iso(zonedToUtc('2026-07-15T09:00', 'UTC')), '2026-07-15T09:00:00.000Z');
  assert.equal(iso(zonedToUtc('2026-07-15T09:00', 'America/New_York')), '2026-07-15T13:00:00.000Z');
  const z = utcToZoned(new Date('2026-07-15T07:00:00Z'), MAD);
  assert.equal(z.iso, '2026-07-15T09:00:00'); assert.equal(z.weekday, 3);
  assert.equal(offsetAt(Date.parse('2026-07-15T07:00:00Z'), MAD), 2 * 3_600_000);
  assert.equal(localDay(new Date('2026-07-15T23:30:00Z'), MAD), '2026-07-16');
  assert.ok(isValidTz(MAD)); assert.ok(!isValidTz('Mars/Olympus')); assert.ok(!isValidTz(''));
});

test('spring forward: 02:30 does not exist and becomes 03:00; fall back: first occurrence', () => {
  // 2026-03-29: Madrid jumps from 02:00 CET to 03:00 CEST.
  const gap = zonedToUtc('2026-03-29T02:30', MAD);
  assert.equal(iso(gap), '2026-03-29T01:00:00.000Z');
  assert.equal(utcToZoned(gap, MAD).iso, '2026-03-29T03:00:00');
  // 2026-10-25: 03:00 CEST goes back to 02:00 CET; 02:30 happens twice → the first one (still summer time).
  assert.equal(iso(zonedToUtc('2026-10-25T02:30', MAD)), '2026-10-25T00:30:00.000Z');
});

test('daily 09:00 in Madrid seen from a PC in UTC, across both changes', () => {
  const rule = { every: 'daily', start: '2026-03-01T09:00' };
  const runs = []; let at = Date.parse('2026-03-27T12:00:00Z');
  for (let i = 0; i < 4; i++) { const d = nextLocalRun(rule, MAD, at); runs.push(iso(d)); at = d.getTime(); }
  assert.deepEqual(runs, ['2026-03-28T08:00:00.000Z', '2026-03-29T07:00:00.000Z', '2026-03-30T07:00:00.000Z', '2026-03-31T07:00:00.000Z']);
  const autumn = []; at = Date.parse('2026-10-23T12:00:00Z');
  for (let i = 0; i < 3; i++) { const d = nextLocalRun(rule, MAD, at); autumn.push(utcToZoned(d, MAD).iso.slice(11, 16)); at = d.getTime(); }
  assert.deepEqual(autumn, ['09:00', '09:00', '09:00']);
  assert.equal(iso(nextLocalRun(rule, MAD, Date.parse('2026-10-25T12:00:00Z'))), '2026-10-26T08:00:00.000Z');
  // The same rule for someone in UTC keeps 09:00 UTC.
  assert.equal(iso(nextLocalRun(rule, 'UTC', Date.parse('2026-03-29T00:00:00Z'))), '2026-03-29T09:00:00.000Z');
});

test('02:30 every day: the spring-forward night fires at 03:00, the next day at 02:30 again', () => {
  const rule = { every: 'daily', start: '2026-03-01T02:30' };
  const first = nextLocalRun(rule, MAD, Date.parse('2026-03-28T12:00:00Z'));
  assert.equal(utcToZoned(first, MAD).iso, '2026-03-29T03:00:00');
  const second = nextLocalRun(rule, MAD, first.getTime());
  assert.equal(utcToZoned(second, MAD).iso, '2026-03-30T02:30:00');
});

test('once, weekly, monthly (short months), yearly (29 February) and hourly', () => {
  assert.equal(iso(nextLocalRun({ every: 'once', start: '2026-05-01T10:00' }, MAD, Date.parse('2026-04-01T00:00:00Z'))), '2026-05-01T08:00:00.000Z');
  assert.equal(nextLocalRun({ every: 'once', start: '2026-05-01T10:00' }, MAD, Date.parse('2026-06-01T00:00:00Z')), null);
  // Weekly on Monday and Friday at 18:00, from a Wednesday.
  const w = nextLocalRun({ every: 'weekly', start: '2026-01-01T18:00', weekdays: [1, 5] }, MAD, Date.parse('2026-11-04T12:00:00Z'));
  assert.equal(utcToZoned(w, MAD).iso, '2026-11-06T18:00:00');
  // Monthly on the 31st: February takes its last day.
  const m = nextLocalRun({ every: 'monthly', start: '2026-01-31T08:00' }, MAD, Date.parse('2026-02-01T00:00:00Z'));
  assert.equal(utcToZoned(m, MAD).iso, '2026-02-28T08:00:00');
  const y = nextLocalRun({ every: 'yearly', start: '2028-02-29T08:00' }, MAD, Date.parse('2028-03-01T00:00:00Z'));
  assert.equal(utcToZoned(y, MAD).iso, '2029-02-28T08:00:00');
  assert.equal(iso(nextLocalRun({ every: 'hourly' }, MAD, Date.parse('2026-11-04T10:20:00Z'))), '2026-11-04T11:00:00.000Z');
  assert.equal(iso(nextLocalRun({ every: 'daily', time: '07:15' }, MAD, Date.parse('2026-11-04T12:00:00Z'))), '2026-11-05T06:15:00.000Z');
});

test('late runs say how late; repeating ones skip, one-offs fire', () => {
  const due = new Date('2026-11-04T08:00:00Z');
  assert.equal(minutesLate(due, Date.parse('2026-11-04T08:01:30Z')), 0);
  assert.equal(minutesLate(due, Date.parse('2026-11-04T08:17:00Z')), 17);
  assert.equal(translate('es', 'data.tz.late', { n: 17 }), 'con 17 min de retraso');
  assert.equal(translate('en', 'data.tz.late', { n: 17 }), '17 min late');
  assert.ok(shouldFireLate({ every: 'once' }));
  assert.ok(!shouldFireLate({ every: 'daily', skip_missed: true }));
  assert.ok(shouldFireLate({ every: 'daily', skip_missed: false }));
});
