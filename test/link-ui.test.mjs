// Magic Link's pure pieces (src/ui/lib/link.js): the devices' order and the countdown of a code.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as L from '../src/ui/lib/link.js';

test('dispositivos: primero los conectados y luego por último uso', () => {
  const list = L.sortDevices([{ id: 'a', lastSeen: '2026-01-01' }, { id: 'b', online: true, lastSeen: '2025-01-01' }, { id: 'c', lastSeen: '2026-06-01' }]);
  assert.deepEqual(list.map((d) => d.id), ['b', 'c', 'a']);
  assert.deepEqual(L.sortDevices(null), []);
});

test('la cuenta atrás del código', () => {
  assert.equal(L.countdown(1000 + 299_000, 1000), '4:59');
  assert.equal(L.countdown(0, 5000), '0:00');
});
