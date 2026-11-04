// Magic Link (3.5): the triangle centre (server) · workshop (laptop) · window (phone), all on loopback with the fake
// agents. The workshop links to the centre with the short code, a phone-like client (src/core/link.mjs) links with the
// QR, the centre forwards the phone's taller.* calls and relays the workshop's events, the workshop going away gives a
// clear «offline» with Wake-on-LAN and a queue delivered when it comes back, replays are refused and revoking cuts access.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { tempHome, startEngine, until, ROOT } from './helpers.mjs';
import { createLink, parseQr, normalCode, normalAddress } from '../src/core/link.mjs';
import { magicPacket, normalMac, broadcastAddresses } from '../src/core/wol.mjs';
import { privateSource } from '../src/engine/remote.mjs';
import * as C from '../src/core/mobile-crypto.mjs';

let centro; let taller; let tCentro; let tTaller; let port; let base; let phone; let phoneDir;
const projects = async (e) => (await e.call('projects.list')).map((p) => p.name);

before(async () => {
  if (!fs.existsSync(path.join(ROOT, 'src', 'renderer', 'index.html'))) throw new Error('compila antes la interfaz (npm run build)');
  port = 20000 + Math.floor(Math.random() * 20000);
  tCentro = tempHome({ role: 'centro', mobile: { enabled: true, port, name: 'Servidor' } });
  tTaller = tempHome({ role: 'taller', mobile: { name: 'Portátil' } });
  const env = { ORB_REMOTE_BIND: '127.0.0.1', ORB_WOL_DRY: '1' };
  centro = await startEngine(tCentro.home, { env });
  taller = await startEngine(tTaller.home, { env });
  base = `http://127.0.0.1:${port}`;
  await until(async () => (await centro.call('remote.status')).running, 'acceso del centro');
  phoneDir = fs.mkdtempSync(path.join(os.tmpdir(), 'orb-movil-'));
  phone = createLink({ file: path.join(phoneDir, 'enlaces.json'), secret: crypto.randomBytes(32), identity: () => ({ name: 'Móvil de prueba', kind: 'phone' }) });
});
after(async () => {
  phone?.stop();
  await taller?.stop(); await centro?.stop();
  tTaller?.cleanup(); tCentro?.cleanup();
  try { fs.rmSync(phoneDir, { recursive: true, force: true }); } catch { /* temp */ }
});

test('Wake-on-LAN: el paquete mágico son 6 bytes FF y la MAC 16 veces', () => {
  const p = magicPacket('AA-BB-CC-DD-EE-0F');
  assert.equal(p.length, 102);
  assert.deepEqual([...p.subarray(0, 6)], [255, 255, 255, 255, 255, 255]);
  for (let i = 0; i < 16; i++) assert.deepEqual([...p.subarray(6 + i * 6, 12 + i * 6)], [0xaa, 0xbb, 0xcc, 0xdd, 0xee, 0x0f]);
  assert.equal(normalMac('aabbccddeeff'), 'aa:bb:cc:dd:ee:ff');
  assert.equal(normalMac('00:00:00:00:00:00'), null, 'la MAC vacía de las interfaces virtuales no sirve');
  assert.equal(normalMac('zz:bb'), null);
  assert.throws(() => magicPacket('no-es-una-mac'));
  assert.ok(broadcastAddresses().includes('255.255.255.255'));
});

test('solo redes privadas, Tailscale y este PC; QR v1 y v2; código corto', () => {
  for (const ip of ['127.0.0.1', '::1', '::ffff:192.168.1.20', '10.0.0.5', '172.16.3.4', '172.31.0.1', '100.64.0.1', '100.127.255.254', 'fd7a:115c:a1e0::1']) assert.ok(privateSource(ip), ip);
  for (const ip of ['8.8.8.8', '172.32.0.1', '100.128.0.1', '192.169.0.1', '2001:db8::1', '', undefined]) assert.ok(!privateSource(ip), String(ip));
  const v1 = parseQr('http://192.168.1.5:3131/#vincular=abc&pc=xyz');
  assert.deepEqual([v1.v, v1.urls, v1.code, v1.pc], [1, ['http://192.168.1.5:3131'], 'abc', 'xyz']);
  const v2 = parseQr(`https://casa.ts.net:3131/#vincular=abc&pc=xyz&v=2&n=Servidor&r=centro&a=${encodeURIComponent('http://100.64.0.2:3131/')}`);
  assert.deepEqual([v2.v, v2.name, v2.role, v2.urls], [2, 'Servidor', 'centro', ['https://casa.ts.net:3131', 'http://100.64.0.2:3131']]);
  assert.equal(normalCode('abcd-efgh'), 'ABCDEFGH');
  assert.equal(normalAddress('100.64.0.2'), 'http://100.64.0.2:3131');
});

test('el portátil se enlaza como taller del servidor con el código corto (un solo uso)', async () => {
  const q = await centro.call('link.qr', { device: 'orb', dev: true });
  assert.match(q.code, /^[A-Z2-9]{4}-[A-Z2-9]{4}$/);
  assert.equal(q.role, 'centro');
  assert.equal(q.payload.v, 2);
  assert.equal(new URLSearchParams(new URL(q.url).hash.slice(1)).get('r'), 'centro', 'el QR dice el papel');
  await assert.rejects(taller.call('link.connect', { code: 'AAAA-AAAA', address: `127.0.0.1:${port}` }), 'un código inventado no sirve');
  const peer = await taller.call('link.connect', { code: q.code.toLowerCase(), address: `127.0.0.1:${port}` });
  assert.equal(peer.role, 'centro');
  assert.equal(peer.name, 'Servidor');
  await assert.rejects(taller.call('link.connect', { code: q.code, address: `127.0.0.1:${port}` }), 'el mismo código no sirve dos veces');
  await until(async () => (await taller.call('link.peers')).some((p) => p.online), 'el taller conectado al centro');
  const devs = await until(async () => { const d = await centro.call('link.devices'); return d.find((x) => x.kind === 'orb' && x.online) && d; }, 'el centro ve al taller');
  const t = devs.find((x) => x.kind === 'orb');
  assert.equal(t.role, 'taller');
  assert.equal(t.name, 'Portátil');
  assert.equal(t.host, os.hostname());
  assert.equal(t.ip, '127.0.0.1');
  // enlaces.json is sealed: the taller's private key is not readable on disk.
  const raw = fs.readFileSync(path.join(tTaller.home, '.orb', 'datos', 'enlaces.json'), 'utf8');
  assert.ok(!raw.includes('priv') && !raw.includes(peer.id), 'enlaces.json va cifrado');
});

test('el móvil se enlaza con el QR y llega al taller a través del servidor', async () => {
  const q = await centro.call('link.qr');
  const peer = await phone.connect({ qr: q.url });
  assert.equal(peer.role, 'centro');
  const dev = (await centro.call('link.devices')).find((d) => d.id === peer.id);
  assert.equal(dev.kind, 'phone');
  assert.equal(dev.name, 'Móvil de prueba');
  await until(() => phone.peers()[0]?.online, 'eventos del móvil');
  const st = await phone.call(null, 'link.status');
  assert.equal(st.role, 'centro');
  assert.equal(st.taller.online, true);
  assert.ok(st.devices.every((d) => !('ip' in d)), 'el móvil no ve las direcciones');

  const relayed = [];
  phone.on('taller:board:changed', (p) => relayed.push(p));
  await taller.call('projects.create', { name: 'en-el-taller' });
  assert.ok((await phone.call(null, 'taller.projects.list')).some((p) => p.name === 'en-el-taller'), 'taller.<método>');
  assert.ok((await phone.call(null, 'projects.list', {}, { target: 'taller' })).some((p) => p.name === 'en-el-taller'), "target: 'taller'");
  assert.ok(!(await projects(centro)).includes('en-el-taller'), 'el proyecto es del taller, no del servidor');
  await until(() => relayed.length > 0, 'el servidor reenvía los eventos del taller');

  // The same limits as a phone: no settings, no total access, no pictures, nothing outside the list.
  for (const [method, params] of [['taller.config.save', {}], ['taller.accounts.add', {}], ['taller.sessions.create', { agent: 'claude', permission: 'total' }], ['taller.link.connect', { code: 'x' }], ['taller.sessions.send', { id: 'x', text: 'hola', images: ['C:\\x.png'] }]]) {
    await assert.rejects(phone.call(null, method, params), (e) => e.status === 403, method);
  }
  // And from the centre's own window too.
  assert.equal((await centro.call('taller.status')).online, true);
});

test('taller apagado: lo dice, ofrece despertarlo y lo encolado se hace al volver', async () => {
  await taller.stop();
  await until(async () => (await centro.call('link.status')).taller?.online === false, 'el centro ve el taller apagado');
  const e = await phone.call(null, 'taller.projects.list').then(() => null, (error) => error);
  assert.ok(e, 'falla');
  assert.equal(e.offline, true);
  assert.equal(e.status, 503);
  assert.ok(e.lastSeen, 'con la última vez que se vio');
  assert.match(e.message, /Portátil/);
  const st = await phone.call(null, 'taller.status');
  assert.equal(st.online, false);
  if (st.canWake) {
    const w = await phone.call(null, 'taller.wake');
    assert.ok(w.sent > 0 && w.macs > 0 && w.dry, 'paquetes de Wake-on-LAN preparados');
  } else await assert.rejects(phone.call(null, 'taller.wake'), (x) => x.status === 409, 'sin MAC no se puede despertar');
  await assert.rejects(phone.call(null, 'taller.queue', { method: 'config.save', params: {} }), (x) => x.status === 403, 'tampoco se encola lo que no se puede reenviar');
  const queued = await phone.call(null, 'taller.queue', { method: 'projects.create', params: { name: 'desde-la-cola' } });
  assert.equal(queued.queued, true);
  assert.equal((await phone.call(null, 'taller.status')).queued, 1);

  taller = await startEngine(tTaller.home, { env: { ORB_REMOTE_BIND: '127.0.0.1', ORB_WOL_DRY: '1' } });
  await until(async () => (await projects(taller)).includes('desde-la-cola'), 'la cola se entrega al volver', 30_000);
  const list = await phone.call(null, 'taller.queued');
  assert.equal(list.find((x) => x.id === queued.id)?.status, 'hecho');
  assert.equal((await phone.call(null, 'taller.status')).online, true);
});

test('una petición repetida se rechaza', async () => {
  const raw = phone.raw();
  const box = raw.box('call', { method: 'link.status', params: {} });
  assert.equal((await raw.post('/api/call', box)).status, 200);
  assert.equal((await raw.post('/api/call', box)).status, 401, 'repetición');
  const other = raw.box('link', { op: 'hello' });
  const r = await raw.post('/api/link', other);
  const msg = C.open(raw.key, await r.json(), C.AAD.response(raw.id));
  assert.equal(msg.ok, false, 'un móvil no puede hablar como un Orb');
  assert.ok(phone.peers()[0].online && !phone.peers()[0].revoked, 'el móvil sigue enlazado');
});

test('cerrar sesión a distancia corta el acceso al momento', async () => {
  const me = phone.peers()[0];
  await centro.call('link.rename', { id: me.id, name: 'Móvil de Ana' });
  assert.equal((await centro.call('link.devices')).find((d) => d.id === me.id).name, 'Móvil de Ana');
  await centro.call('link.revoke', { id: me.id });
  await until(() => !phone.peers()[0].online, 'el directo del móvil se cierra');
  await assert.rejects(phone.call(null, 'link.status'), (e) => e.revoked === true);
  assert.equal(phone.peers()[0].revoked, true);
  // The workshop too: its link stops at once and it is not reachable any more.
  const t = (await centro.call('link.devices')).find((d) => d.kind === 'orb');
  await centro.call('link.revoke', { id: t.id });
  await until(async () => (await taller.call('link.peers'))[0]?.revoked, 'el taller ve que el enlace se cerró');
  assert.equal((await centro.call('taller.status')).linked, false);
  // And forgetting it on the workshop removes it from its list.
  await taller.call('link.disconnect', { id: (await taller.call('link.peers'))[0].id });
  assert.deepEqual(await taller.call('link.peers'), []);
});

test('el QR ya usado no sirve y demasiados intentos se cortan', async () => {
  const q = await centro.call('link.qr');
  const fresh = createLink({ file: path.join(phoneDir, 'otro.json'), secret: crypto.randomBytes(32), identity: () => ({ name: 'Otro', kind: 'browser' }) });
  try {
    await fresh.connect({ qr: q.url });
    await assert.rejects(fresh.connect({ qr: q.url }), (e) => e.status === 401, 'un solo uso');
    let last = 0;
    for (let i = 0; i < 12; i++) { last = (await fetch(`${base}/api/pair`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"pub":"x"}' })).status; }
    assert.equal(last, 429, 'demasiados intentos desde la misma dirección');
  } finally { fresh.stop(); }
});
