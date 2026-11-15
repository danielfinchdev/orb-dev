// Native mobile client support: what /api/me advertises, meta.client, uploads of PDF and text, tasks.create from a
// phone and the clientId de-duplication of chat.send and sessions.send. Through the encrypted link, as the app does it.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { tempHome, startEngine, until } from './helpers.mjs';
import { createPhone, TEST_MASTER } from './fixtures/phone-client.mjs';
import * as C from '../src/shared/mobile-crypto.mjs';
import { guardCall, sniffUpload } from '../src/engine/transport/remote-calls.mjs';
import { createDedupe, conversationKey } from '../src/engine/api/dedupe.mjs';
import { REMOTE_METHODS } from '../src/domain/security/permissions.mjs';

let A; let t; let port; let phone; let peer; let raw;
before(async () => {
  port = 20000 + Math.floor(Math.random() * 20000);
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

const me = async (body) => {
  const res = await raw.post('/api/me', raw.box('me', body));
  return { status: res.status, msg: C.open(raw.key, await res.json(), C.AAD.response(raw.id)) };
};
const upload = async (bytes, name) => {
  const auth = C.sealText(raw.key, { t: Date.now(), m: 'upload', ...(name ? { name } : {}) }, C.AAD.request(raw.id));
  const res = await fetch(`${raw.base}/api/upload`, { method: 'POST', headers: { 'X-Orb-Device': raw.id, 'X-Orb-Auth': auth }, body: C.sealBytes(raw.key, new Uint8Array(bytes), C.AAD.upload(raw.id)) });
  return C.open(raw.key, await res.json(), C.AAD.response(raw.id));
};

test('tasks.create con los parámetros del móvil pasa la guardia; «total» no', () => {
  const board = { one: () => null };
  const params = { project: 'web', title: 'Arreglar', description: 'detalle', agent: 'claude', model: 'sonnet', reasoning: 'high', mode: 'aislada', readonly: true, level: 'normal', clientId: 'abc-123' };
  assert.equal(guardCall(board, 'tasks.create', params), null);
  assert.notEqual(guardCall(board, 'tasks.create', { ...params, permission: 'total' }), null);
});

test('me anuncia los métodos remotos y lo que acepta la subida; los clientes viejos siguen igual', async () => {
  const { status, msg } = await me({ v: 4 });
  assert.equal(status, 200);
  assert.deepEqual(msg.result.methods, [...REMOTE_METHODS].sort());
  assert.ok(msg.result.methods.includes('tasks.create'));
  assert.ok(!msg.result.methods.includes('conversations.remove'));
  assert.ok(!msg.result.methods.includes('config.save'));
  assert.equal(msg.result.uploads.max, 10 * 1024 * 1024);
  for (const k of ['png', 'jpg', 'webp', 'gif']) assert.ok(msg.result.uploads.types.includes(k), k);
  for (const k of ['pdf', 'txt', 'md', 'csv', 'json', 'exe', 'html', 'svg', 'js', 'bat', 'ps1']) assert.ok(!msg.result.uploads.types.includes(k), k);
  assert.ok(msg.result.device && msg.result.pc, 'los campos de siempre siguen');
});

test('meta.client se guarda si es válido y se ignora si no', async () => {
  const client = async () => (await A.call('link.devices')).find((d) => d.id === peer.id).client;
  assert.equal(await client(), null, 'sin client al principio');
  await me({ v: 4, client: 'Android Nativo!' });
  assert.equal(await client(), null, 'inválido: se ignora');
  await me({ v: 4, client: 'x'.repeat(33) });
  assert.equal(await client(), null, 'demasiado largo');
  await me({ v: 4, client: 'android-native' });
  assert.equal(await client(), 'android-native');
  await me({ v: 4 });
  assert.equal(await client(), 'android-native', 'un cliente que no lo manda no lo borra');
});

test('subida: solo imágenes; PDF, texto, ejecutables, HTML y SVG no (415); un PDF no pasa como imagen', async () => {
  const png = await upload(Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(16)]));
  assert.equal(png.ok, true);
  assert.match(png.result.path, /^\d+-[0-9a-f]{8}\.png$/);
  assert.ok(fs.existsSync(path.join(t.home, 'core', 'adjuntos-movil', png.result.path)));
  // a PDF or a text file would upload fine and then fail on send (403), so the PC refuses them up front
  assert.equal((await upload(Buffer.from('%PDF-1.4\n1 0 obj<<>>endobj\n%%EOF'))).status, 415, 'pdf');
  assert.equal((await upload(Buffer.from('hola, mundo\n'), 'nota.txt')).status, 415, 'txt');
  assert.equal((await upload(Buffer.from('{"a":1}'), 'x.json')).status, 415, 'json');
  for (const bad of ['<!doctype html><script>1</script>', '<svg xmlns="http://www.w3.org/2000/svg"/>', '#!/bin/sh\nrm -rf /', '\x7fELF\x02\x01\x01']) {
    const r = await upload(Buffer.from(bad), 'a.txt');
    assert.equal(r.ok, false, bad); assert.equal(r.status, 415, bad);
  }
  assert.equal((await upload(Buffer.from([0x00, 0x01, 0x02, 0x03, 0x04]))).status, 415, 'binario con NUL');
  const asImage = await phone.call(peer.id, 'sessions.send', { id: 'x', text: 'mira', images: ['1731000000000-0123abcd.pdf'] }).catch((e) => e);
  assert.equal(asImage.status, 403, 'un PDF no es una imagen');
});

test('sniffUpload distingue por los primeros bytes, no por el nombre', () => {
  assert.equal(sniffUpload(Buffer.from('%PDF-1.7 ...'), 'png'), 'pdf');
  assert.equal(sniffUpload(Buffer.from('hola'), 'exe'), 'txt');
  assert.equal(sniffUpload(Buffer.from('MZ\u0090\u0000\u0003\u0000')), null);
  assert.equal(sniffUpload(Buffer.from('MZ Industries: informe de ventas\n')), 'txt', 'a text that starts with MZ is only text');
  assert.equal(sniffUpload(Buffer.from('%!PS-Adobe es solo texto aquí')), 'txt');
  assert.equal(sniffUpload(Buffer.from('#!/bin/sh\nls')), null);
  assert.equal(sniffUpload(Buffer.from('<html></html>')), null);
});

test('guardCall: images must be pictures inside the uploads folder, by name too', () => {
  const dir = path.join(t.home, 'core', 'adjuntos-movil');
  const board = { one: () => null };
  const pdf = path.join(dir, '1731000000000-0123abcd.pdf'); const png = path.join(dir, '1731000000000-0123abcd.png');
  for (const [method, extra] of [['sessions.send', { id: '1', text: 'x' }], ['tasks.followup', { id: 1, text: 'x' }]]) {
    assert.equal(guardCall(board, method, { ...extra, images: [png] }, { uploadsDir: dir }), null);
    assert.notEqual(guardCall(board, method, { ...extra, images: [pdf] }, { uploadsDir: dir }), null, `${method} pdf`);
    assert.notEqual(guardCall(board, method, { ...extra, images: [path.join(dir, 'notas.txt')] }, { uploadsDir: dir }), null);
  }
});

test('the dedupe key is stable for a conversation', () => {
  assert.equal(conversationKey(null), 'new'); assert.equal(conversationKey(undefined), 'new');
  assert.equal(conversationKey('7'), '7'); assert.equal(conversationKey(7), '7'); assert.equal(conversationKey('007'), '7');
  assert.equal(conversationKey('abc'), 'abc');
});

test('clientId: chat.send y sessions.send no duplican un reintento; sin clientId sí envían de nuevo', async () => {
  const first = await phone.call(peer.id, 'chat.send', { text: 'hola uno', clientId: 'msg-1' });
  const again = await phone.call(peer.id, 'chat.send', { text: 'hola uno', clientId: 'msg-1' });
  assert.deepEqual(again, first, 'mismo resultado');
  const conv = first.conversation;
  const users = async () => (await A.call('chat.list', { conversation: conv })).filter((l) => l.role === 'usuario').length;
  assert.equal(await users(), 1);
  await until(async () => (await A.call('chat.list', { conversation: conv })).some((l) => l.role === 'orb'), 'respuesta', 30_000);
  await phone.call(peer.id, 'chat.send', { conversation: conv, text: 'dos', clientId: 'msg-2' });
  await phone.call(peer.id, 'chat.send', { conversation: conv, text: 'dos', clientId: 'msg-2' });
  await until(async () => (await users()) >= 2, 'segundo mensaje');
  await new Promise((r) => setTimeout(r, 300));
  assert.equal(await users(), 2, 'el reintento no duplica');
  await phone.call(peer.id, 'chat.send', { conversation: conv, text: 'tres' });
  await phone.call(peer.id, 'chat.send', { conversation: conv, text: 'tres' });
  await until(async () => (await users()) >= 4, 'sin clientId se envían los dos', 30_000);

  const s = await A.call('sessions.create', { agent: 'claude', project: 'web' });
  const send = (extra) => phone.call(peer.id, 'sessions.send', { id: s.id, text: 'hola sesion', ...extra });
  const r1 = await send({ clientId: 'ses-1' });
  const r2 = await send({ clientId: 'ses-1' });
  assert.deepEqual(r2, r1);
});

test('createDedupe: caduca, no recuerda los fallos y ignora clientId inválidos', async () => {
  let now = 0; const d = createDedupe({ ttl: 1000, max: 3, clock: () => now });
  let runs = 0; const run = () => ++runs;
  assert.equal(d.once('a', 'id-1', run), 1); assert.equal(d.once('a', 'id-1', run), 1);
  assert.equal(d.once('b', 'id-1', run), 2, 'otro destino');
  assert.equal(d.once('a', 'mal id!', run), 3); assert.equal(d.once('a', 'mal id!', run), 4, 'inválido: no deduplica');
  assert.equal(d.once('a', undefined, run), 5);
  now = 2000; assert.equal(d.once('a', 'id-1', run), 6, 'caducado');
  const failing = () => Promise.reject(new Error('x'));
  await d.once('a', 'f1', failing).catch(() => {});
  await new Promise((r) => setImmediate(r));
  assert.equal(d.once('a', 'f1', () => 'ok'), 'ok', 'un fallo se puede reintentar');
  for (let i = 0; i < 10; i++) d.once('a', `n${i}`, run);
  assert.ok(d.size() <= 4, 'tope de entradas');
});
