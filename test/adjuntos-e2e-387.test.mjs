// An attachment from the phone, end to end through the encrypted link as the app does it: upload, then cite the stored
// name in `images` of sessions.send / chat.send. Whatever the PC announces it accepts must go all the way (never a 403
// after the chip said «ready»); what it cannot carry is refused at the upload, before the user presses send.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { tempHome, startEngine, until } from './helpers.mjs';
import { createPhone, TEST_MASTER } from './fixtures/phone-client.mjs';
import * as C from '../src/shared/mobile-crypto.mjs';

let A; let t; let phone; let peer; let raw;
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(16)]);
const SAMPLES = {
  png: PNG,
  jpg: Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(16)]),
  gif: Buffer.concat([Buffer.from('GIF89a'), Buffer.alloc(16)]),
  webp: Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WEBP'), Buffer.alloc(16)]),
};
before(async () => {
  const port = 20000 + Math.floor(Math.random() * 20000);
  t = tempHome({ mobile: { enabled: true, port, name: 'Casa' } });
  A = await startEngine(t.home, { env: { ORB_REMOTE_BIND: '127.0.0.1' } });
  await until(async () => (await A.call('remote.status')).running, 'acceso');
  await A.call('master.create', { password: TEST_MASTER });
  await A.call('projects.create', { name: 'web' });
  phone = createPhone({ name: 'Pixel' });
  peer = await phone.connect({ qr: (await A.call('link.qr', {})).url });
  raw = phone.raw(peer.id);
});
after(async () => { phone?.stop(); await A?.stop?.(); t?.cleanup(); });

const me = async () => {
  const res = await raw.post('/api/me', raw.box('me', { v: 4 }));
  return C.open(raw.key, await res.json(), C.AAD.response(raw.id)).result;
};
const upload = async (bytes, name) => {
  const auth = C.sealText(raw.key, { t: Date.now(), m: 'upload', ...(name ? { name } : {}) }, C.AAD.request(raw.id));
  const res = await fetch(`${raw.base}/api/upload`, { method: 'POST', headers: { 'X-Orb-Device': raw.id, 'X-Orb-Auth': auth }, body: C.sealBytes(raw.key, new Uint8Array(bytes), C.AAD.upload(raw.id)) });
  return { status: res.status, ...C.open(raw.key, await res.json(), C.AAD.response(raw.id)) };
};
const call = (method, params) => phone.call(peer.id, method, params).then((result) => ({ status: 200, result }), (e) => ({ status: e.status, error: e }));

test('every kind the PC announces uploads and then passes the guard in sessions.send and chat.send (no 403)', async () => {
  const { types } = (await me()).uploads;
  assert.ok(types.length > 0);
  for (const kind of types) {
    assert.ok(SAMPLES[kind], `the announced kind «${kind}» has no sample here: add one, and make sure it can be sent`);
    const up = await upload(SAMPLES[kind]);
    assert.equal(up.ok, true, `${kind} upload`);
    const send = await call('sessions.send', { id: 'no-such-session', text: 'mira', images: [up.result.path], clientId: `c-${kind}` });
    assert.notEqual(send.status, 403, `sessions.send with a ${kind}: ${send.error?.message}`);
    const chat = await call('chat.send', { text: 'mira', images: [up.result.path], clientId: `d-${kind}` });
    assert.notEqual(chat.status, 403, `chat.send with a ${kind}: ${chat.error?.message}`);
  }
});

test('a PDF or a text file is not announced and is refused at the upload, so no message can end in a 403', async () => {
  const { types } = (await me()).uploads;
  for (const k of ['pdf', 'txt', 'md', 'csv', 'json']) assert.ok(!types.includes(k), `${k} announced but not sendable`);
  assert.equal((await upload(Buffer.from('%PDF-1.4\n1 0 obj<<>>endobj\n%%EOF'), 'a.pdf')).status, 415);
  assert.equal((await upload(Buffer.from('hola\n'), 'nota.txt')).status, 415);
  // a name that was never stored by an upload is the only way left to a 403
  const forged = await call('sessions.send', { id: 'x', text: 'mira', images: ['1731000000000-0123abcd.pdf'] });
  assert.equal(forged.status, 403);
});
