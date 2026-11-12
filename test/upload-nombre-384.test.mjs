// The file name a phone sends to /api/upload is untrusted: sanitized for display, never part of the stored path.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { tempHome, startEngine, until } from './helpers.mjs';
import { createPhone, TEST_MASTER } from './fixtures/phone-client.mjs';
import * as C from '../src/shared/mobile-crypto.mjs';
import { sanitizeUploadName as s, IMAGE_NAME } from '../src/engine/transport/remote-calls.mjs';

test('normal names stay as they are', () => {
  for (const n of ['foto.jpg', 'notas.md', 'Informe final (2).pdf', 'ñandú café.txt', 'a.tar.gz']) assert.equal(s(n), n);
});

test('folders, drives and traversal are cut', () => {
  assert.equal(s('../../x.png'), 'x.png');
  assert.equal(s('..\\..\\a'), 'a');
  assert.equal(s('C:\\Windows\\a.png'), 'a.png');
  assert.equal(s('a/b/c.png'), 'c.png');
  assert.equal(s('C:a.png'), 'Ca.png');
  assert.equal(s('..'), 'archivo');
  assert.equal(s('a/..'), 'archivo');
  assert.equal(s('/etc/'), 'archivo');
});

test('characters Windows refuses and trailing dots or spaces go', () => {
  assert.equal(s('a<b>c:d"e|f?g*h.png'), 'abcdefgh.png');
  assert.equal(s('a\u0000b\u001f.txt'), 'ab.txt');
  assert.equal(s('name. . '), 'name');
  assert.equal(s('foto.jpg  '), 'foto.jpg');
});

test('reserved device names are neutralised, with or without extension', () => {
  for (const n of ['CON', 'nul.txt', 'COM1.png', 'lpt9', 'Aux.md', 'PRN']) {
    const out = s(n);
    assert.match(out, /^_/, n);
    assert.ok(!/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\.|$)/i.test(out), out);
  }
  assert.equal(s('console.txt'), 'console.txt');
  assert.equal(s('COM10.txt'), 'COM10.txt');
});

test('unicode: bidi, zero-width and decomposed forms', () => {
  assert.equal(s('foto\u202Egpj.exe'), 'fotogpj.exe');
  assert.equal(s('a\u200Bb\u200Dc\uFEFF.png'), 'abc.png');
  assert.equal(s('e\u0301.txt'), '\u00e9.txt'); // NFD to NFC
  assert.equal(s('🙂 selfie.jpg'), '🙂 selfie.jpg');
  assert.equal(s('\u202E'), 'archivo');
});

test('empty and non-string values fall back', () => {
  for (const v of ['', null, undefined, 42, {}, [], '...', '   ', '. . .', '\u0000']) assert.equal(s(v), 'archivo');
});

test('long names are bounded (base 80, extension 10)', () => {
  const out = s(`${'a'.repeat(500)}.jpg`);
  assert.equal(out, `${'a'.repeat(80)}.jpg`);
  assert.equal(s(`x.${'b'.repeat(500)}`), `x.${'b'.repeat(10)}`);
  assert.ok(s('😀'.repeat(300)).length <= 80 * 2);
});

let A; let t; let phone; let r;
before(async () => {
  const port = 20000 + Math.floor(Math.random() * 20000);
  t = tempHome({ mobile: { enabled: true, port, name: 'Casa' } });
  A = await startEngine(t.home, { env: { ORB_REMOTE_BIND: '127.0.0.1' } });
  await until(async () => (await A.call('remote.status')).running, 'acceso');
  await A.call('master.create', { password: TEST_MASTER });
  phone = createPhone({ name: 'Pixel' });
  const pa = await phone.connect({ qr: (await A.call('link.qr', {})).url });
  r = phone.raw(pa.id);
});
after(async () => { phone?.stop(); await A?.stop?.(); t?.cleanup(); });

const PNG = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d4944415478da63f8ffff3f0005fe02fea7d6a0f10000000049454e44ae426082', 'hex');
async function upload(name, bytes = PNG) {
  const auth = C.sealText(r.key, { t: Date.now(), m: 'upload', ...(name === undefined ? {} : { name }) }, C.AAD.request(r.id));
  const res = await fetch(`${r.base}/api/upload`, { method: 'POST', headers: { 'X-Orb-Device': r.id, 'X-Orb-Auth': auth }, body: C.sealBytes(r.key, new Uint8Array(bytes), C.AAD.upload(r.id)) });
  assert.equal(res.status, 200);
  return C.open(r.key, await res.json(), C.AAD.response(r.id));
}

test('the stored file never takes the client name; the response shows the sanitized one', async () => {
  const dir = path.join(t.home, 'core', 'adjuntos-movil');
  const out = await upload('..\\..\\evil/CON.png');
  assert.equal(out.result.name, '_CON.png');
  assert.match(out.result.path, IMAGE_NAME);
  assert.ok(fs.existsSync(path.join(dir, out.result.path)));
  for (const bad of [42, null, undefined, '', '../../x']) {
    const o = await upload(bad);
    assert.match(o.result.path, IMAGE_NAME);
    assert.ok(o.result.name.length > 0 && !/[\/]/.test(o.result.name));
  }
});

test('two uploads with the same name are two different files', async () => {
  const a = await upload('foto.png');
  const b = await upload('foto.png');
  assert.equal(a.result.name, 'foto.png');
  assert.notEqual(a.result.path, b.result.path);
  assert.ok(fs.existsSync(path.join(t.home, 'core', 'adjuntos-movil', a.result.path)));
  assert.ok(fs.existsSync(path.join(t.home, 'core', 'adjuntos-movil', b.result.path)));
});
