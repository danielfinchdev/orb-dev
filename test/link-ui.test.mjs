// Magic Link's pure pieces (src/ui/lib/link.js): what a pasted link says, the devices' order, who may manage them and
// the countdown of a code.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as L from '../src/ui/lib/link.js';

test('enlazar: el texto del QR, o el código y la dirección en cualquier orden', () => {
  assert.deepEqual(L.parseLinkInput('http://100.64.0.2:3131/#vincular=abc&pc=xyz&v=2'), { qr: 'http://100.64.0.2:3131/#vincular=abc&pc=xyz&v=2' });
  assert.deepEqual(L.parseLinkInput('{"v":2,"urls":["http://a:1"],"pc":"x","code":"y"}').qr.startsWith('{'), true);
  assert.deepEqual(L.parseLinkInput('abcd-efgh 100.64.0.2:3131'), { code: 'ABCD-EFGH', address: 'http://100.64.0.2:3131' });
  assert.deepEqual(L.parseLinkInput('http://casa.ts.net:3131 ABCDEFGH'), { code: 'ABCD-EFGH', address: 'http://casa.ts.net:3131' });
  assert.deepEqual(L.parseLinkInput('ABCD-EFGH', '192.168.1.5:3131'), { code: 'ABCD-EFGH', address: 'http://192.168.1.5:3131' });
  assert.equal(L.parseLinkInput('ABCD-EFGH'), null, 'falta la dirección');
  assert.equal(L.parseLinkInput(''), null);
});

test('dispositivos: primero los conectados y luego por último uso', () => {
  const list = L.sortDevices([{ id: 'a', lastSeen: '2026-01-01' }, { id: 'b', online: true, lastSeen: '2025-01-01' }, { id: 'c', lastSeen: '2026-06-01' }]);
  assert.deepEqual(list.map((d) => d.id), ['b', 'c', 'a']);
  assert.deepEqual(L.sortDevices(null), []);
});

test('quién gestiona los enlaces: la app del PC siempre; un dispositivo solo si el Orb le deja', () => {
  assert.equal(L.canManageLinks({}), true);
  assert.equal(L.canManageLinks({ mobile: true }), false);
  assert.equal(L.canManageLinks({ mobile: true, access: { links: true } }), true);
});

test('la cuenta atrás del código', () => {
  assert.equal(L.countdown(1000 + 299_000, 1000), '4:59');
  assert.equal(L.countdown(0, 5000), '0:00');
});
