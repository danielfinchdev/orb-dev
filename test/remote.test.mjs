// Phone access: pairing with a one-time QR and the phone's own key, every message encrypted end to end, replays and
// tampering refused, host/origin checks, the phone's limited actions, encrypted uploads and live events, notifications
// and revocation. The server binds to loopback here (ORB_REMOTE_BIND) instead of the Wi-Fi or Tailscale address.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fork } from 'node:child_process';
import http from 'node:http';
import { tempHome, ROOT, until } from './helpers.mjs';
import * as C from '../src/core/mobile-crypto.mjs';

let t; let engine; let n = 0; const pending = new Map(); let base; let port;
const call = (method, params = {}) => new Promise((resolve, reject) => { const id = ++n; pending.set(id, { resolve, reject }); engine.send({ type: 'call', id, method, params }); });

before(async () => {
  port = 20000 + Math.floor(Math.random() * 20000);
  t = tempHome({ mobile: { enabled: true, port } });
  if (!fs.existsSync(path.join(ROOT, 'src', 'renderer', 'index.html'))) throw new Error('compila antes la interfaz (npm run build)');
  engine = fork(path.join(ROOT, 'src', 'engine', 'engine.mjs'), [], { stdio: ['ignore', 'inherit', 'inherit', 'ipc'], env: { ...process.env, ORB_REMOTE_BIND: '127.0.0.1' } });
  engine.on('message', (m) => { if (m.type === 'reply') { const p = pending.get(m.id); pending.delete(m.id); m.ok ? p.resolve(m.result) : p.reject(new Error(m.error)); } });
  await new Promise((resolve, reject) => { engine.once('message', (m) => (m.type === 'started' && m.ok ? resolve() : reject(new Error(m.error)))); engine.send({ type: 'start', home: t.home, version: 'test' }); });
  base = `http://127.0.0.1:${port}`;
  await until(async () => (await call('remote.status')).running, 'servidor del móvil');
});
after(() => { engine?.send({ type: 'shutdown' }); t?.cleanup(); });

// A phone, as the page does it (src/ui/lib/web-bridge.js).
function phone() {
  const me = { kp: C.newKeyPair(), id: null, key: null, pc: null };
  me.pairBody = (code, pcPub, { name = 'Android' } = {}) => {
    const pub = C.b64.enc(me.kp.pub);
    return { pub, proof: C.seal(C.pairingKey(me.kp.priv, pcPub, code), { pub, name, t: Date.now() }, C.AAD.pair) };
  };
  me.box = (kind, body, { at = Date.now() } = {}) => C.seal(me.key, { t: at, m: kind, b: body }, C.AAD.request(me.id));
  me.post = async (pathname, box, { id = me.id, headers = {} } = {}) => fetch(base + pathname, { method: 'POST', headers: { 'X-Orb-Device': id, 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(box) });
  me.call = async (method, params = {}) => {
    const box = me.box('call', { method, params });
    const res = await me.post('/api/call', box);
    assert.equal(res.status, 200);
    const msg = C.open(me.key, await res.json(), C.AAD.response(me.id));
    assert.equal(msg.r, box.n, 'la respuesta es de esta petición');
    return msg;
  };
  return me;
}
const qr = async (kind) => { const { url, pc } = await call('remote.pair', kind ? { kind } : {}); const h = new URLSearchParams(new URL(url).hash.slice(1)); return { code: h.get('vincular'), pc: C.b64.dec(h.get('pc')), fp: pc, url }; };
const pair = async (p, q, opts) => {
  const res = await fetch(`${base}/api/pair`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(p.pairBody(q.code, q.pc, opts)) });
  if (res.status !== 200) return res.status;
  const data = await res.json();
  p.key = C.sessionKey(p.kp.priv, q.pc); p.id = data.id;
  const ok = C.open(p.key, data.box, C.AAD.paired(data.id));
  assert.equal(ok.id, data.id); p.pc = ok.pc;
  return 200;
};

test('cifrado: lo sellado solo se abre con la misma clave, el mismo uso y sin tocarlo', () => {
  const a = C.newKeyPair(); const b = C.newKeyPair();
  const k1 = C.sessionKey(a.priv, b.pub); const k2 = C.sessionKey(b.priv, a.pub);
  assert.deepEqual(Buffer.from(k1), Buffer.from(k2), 'las dos partes llegan a la misma clave');
  const box = C.seal(k1, { hola: 'mundo' }, 'uso');
  assert.deepEqual(C.open(k2, box, 'uso'), { hola: 'mundo' });
  assert.throws(() => C.open(k2, box, 'otro uso'));
  const bad = { ...box, c: box.c.slice(0, -2) + (box.c.endsWith('A') ? 'BA' : 'AA') };
  assert.throws(() => C.open(k2, bad, 'uso'), 'manipulado');
  assert.throws(() => C.open(C.sessionKey(C.newKeyPair().priv, b.pub), box, 'uso'), 'otra clave');
  const bytes = new Uint8Array([1, 2, 3, 4]);
  assert.deepEqual([...C.openBytes(k2, C.sealBytes(k1, bytes, 'img'), 'img')], [1, 2, 3, 4]);
  assert.match(C.fingerprint(a.pub), /^[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}$/);
});

test('sirve la web app instalable y solo responde a su propio nombre', async () => {
  const page = await fetch(`${base}/`);
  assert.equal(page.status, 200);
  const html = await page.text();
  assert.match(html, /manifest\.webmanifest/);
  assert.match(html, /apple-touch-icon/);
  assert.match(page.headers.get('content-security-policy'), /script-src 'self'/);
  assert.equal((await (await fetch(`${base}/manifest.webmanifest`)).json()).display, 'standalone');
  assert.match(await (await fetch(`${base}/sw.js`)).text(), /showNotification/);
  // fetch() cannot change Host: a raw request plays the DNS-rebinding page.
  const status = await new Promise((resolve, reject) => http.get({ host: '127.0.0.1', port, path: '/api/me', headers: { Host: 'atacante.example' } }, (r) => { r.resume(); resolve(r.statusCode); }).on('error', reject));
  assert.equal(status, 421, 'DNS rebinding: otro nombre de host se rechaza');
  assert.equal((await fetch(`${base}/../../orb.json`)).status, 404);
  assert.equal((await fetch(`${base}/pip.html`)).status, 404, 'las páginas solo de escritorio no se sirven');
  assert.equal((await fetch(`${base}/icon.png`)).status, 200);
});

test('vincular: el QR sirve una vez, el código nunca viaja y el móvil comprueba que es su PC', async () => {
  const p = phone();
  assert.equal((await fetch(`${base}/api/call`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })).status, 401, 'sin vincular no hay acceso');
  assert.equal(await pair(p, { code: 'x'.repeat(24), pc: C.newKeyPair().pub }), 401, 'sin QR activo');
  const q = await qr();
  const st = await call('remote.status');
  assert.equal(q.fp, st.pc, 'la huella del QR es la de este PC');
  assert.equal(await pair(phone(), { ...q, code: 'otro-codigo-inventado' }), 401, 'código inventado');
  assert.equal(await pair(phone(), { ...q, pc: C.newKeyPair().pub }), 401, 'otra clave de PC (QR falso)');
  const body = JSON.stringify(p.pairBody(q.code, q.pc));
  assert.ok(!body.includes(q.code), 'el código del QR no viaja: solo su prueba');
  assert.equal(await pair(p, q), 200);
  assert.equal(await pair(phone(), q), 401, 'el mismo QR no sirve dos veces');
  globalThis.phone1 = p;
  const [device] = (await call('remote.status')).devices;
  assert.equal(device.name, 'Android');
});

test('todo va cifrado; repetir, retrasar o tocar un mensaje no sirve', async () => {
  const p = globalThis.phone1;
  const state = await p.call('app.state');
  assert.equal(state.ok, true);
  assert.equal(JSON.stringify(state.result.config).includes('fake-claude'), false, 'ni rutas de los programas ni secretos de conectores');
  assert.ok(state.result.config.accounts.every((a) => !('home' in a)));
  // What travels: only nonce + ciphertext, nothing readable.
  const box = p.box('call', { method: 'app.state', params: {} });
  const res = await p.post('/api/call', box);
  const raw = await res.text();
  assert.deepEqual(Object.keys(JSON.parse(raw)).sort(), ['c', 'n']);
  assert.ok(!raw.includes('assistantName') && !raw.includes('Orb'), 'la respuesta no se puede leer por el camino');
  assert.equal((await p.post('/api/call', box)).status, 401, 'la misma petición dos veces (repetición)');
  assert.equal((await p.post('/api/call', p.box('call', { method: 'app.state' }, { at: Date.now() - 20 * 60_000 }))).status, 401, 'una petición vieja');
  const tampered = p.box('call', { method: 'app.state' }); tampered.c = tampered.c.replace(/^./, (ch) => (ch === 'A' ? 'B' : 'A'));
  assert.equal((await p.post('/api/call', tampered)).status, 401, 'manipulada');
  const other = phone(); assert.equal(await pair(other, await qr()), 200);
  assert.equal((await p.post('/api/call', p.box('call', { method: 'app.state' }), { id: other.id })).status, 401, 'sellada para otro móvil');
  assert.equal((await p.post('/api/call', p.box('me', null))).status, 401, 'sellada para otra cosa');
  assert.equal((await p.post('/api/call', p.box('call', { method: 'app.state' }), { headers: { Origin: 'https://atacante.example' } })).status, 403, 'otro origen');
});

test('el móvil hace lo suyo y nada más (acciones del PC, acceso total, archivos del PC, imágenes)', async () => {
  const p = globalThis.phone1;
  await call('projects.create', { name: 'desde-el-pc' });
  const total = await call('sessions.create', { agent: 'claude', project: 'desde-el-pc', permission: 'total' });
  const denied = async (method, params) => { const r = await p.call(method, params); assert.equal(r.ok, false, method); assert.equal(r.status, 403, method); };
  await denied('sessions.send', { id: total.id, text: 'hola' });
  for (const method of ['config.save', 'accounts.add', 'installer.start', 'remote.pair', 'remote.configure', 'projects.import', 'projects.createPr', 'agents.login']) await denied(method, {});
  await denied('sessions.create', { agent: 'codex', permission: 'total' });
  await denied('sessions.send', { id: 'x', text: 'hola', images: [path.join(t.home, 'orb.json')] });
  // A picture uploaded from the phone: encrypted, and checked by its bytes.
  const upload = async (bytes) => {
    const auth = C.sealText(p.key, { t: Date.now(), m: 'upload' }, C.AAD.request(p.id));
    const res = await fetch(`${base}/api/upload`, { method: 'POST', headers: { 'X-Orb-Device': p.id, 'X-Orb-Auth': auth }, body: C.sealBytes(p.key, bytes, C.AAD.upload(p.id)) });
    assert.equal(res.status, 200);
    return C.open(p.key, await res.json(), C.AAD.response(p.id));
  };
  const png = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d4944415478da63f8ffff3f0005fe02fea7d6a0f10000000049454e44ae426082', 'hex');
  const up = await upload(new Uint8Array(png));
  assert.ok(up.result.path.includes(path.join('.orb', 'adjuntos-movil')));
  assert.equal(fs.readFileSync(up.result.path).equals(png), true);
  assert.equal((await upload(new Uint8Array(Buffer.from('MZ ejecutable')))).status, 415);
});

test('avisos: solo servicios de avisos conocidos', async () => {
  const p = globalThis.phone1;
  const send = async (subscription) => { const box = p.box('push', { subscription }); return C.open(p.key, await (await p.post('/api/push', box)).json(), C.AAD.response(p.id)); };
  const keys = { p256dh: Buffer.concat([Buffer.from([4]), Buffer.alloc(64, 7)]).toString('base64url'), auth: Buffer.alloc(16, 1).toString('base64url') };
  assert.equal((await send({ endpoint: 'https://atacante.example/push', keys })).ok, false, 'un servidor cualquiera no');
  assert.equal((await send({ endpoint: 'http://fcm.googleapis.com/fcm/send/x', keys })).ok, false, 'sin https no');
  assert.equal((await send({ endpoint: 'https://fcm.googleapis.com/fcm/send/abc', keys })).ok, true);
  assert.equal((await call('remote.status')).devices.find((d) => d.id === p.id).push, true);
  assert.equal((await send(null)).ok, true);
  assert.equal((await call('remote.status')).devices.find((d) => d.id === p.id).push, false);
  const me = C.open(p.key, await (await p.post('/api/me', p.box('me', null))).json(), C.AAD.response(p.id));
  assert.match(me.result.vapid, /^[A-Za-z0-9_-]{80,90}$/, 'la clave pública para suscribirse');
});

test('eventos en directo cifrados y revocar el acceso', async () => {
  const p = globalThis.phone1;
  const ctrl = new AbortController();
  const auth = C.sealText(p.key, { t: Date.now(), m: 'events' }, C.AAD.request(p.id));
  const res = await fetch(`${base}/api/events`, { headers: { 'X-Orb-Device': p.id, 'X-Orb-Auth': auth }, signal: ctrl.signal });
  assert.equal(res.status, 200);
  assert.equal((await fetch(`${base}/api/events`, { headers: { 'X-Orb-Device': p.id, 'X-Orb-Auth': auth } })).status, 401, 'la misma cabecera dos veces');
  const reader = res.body.getReader(); let text = '';
  await call('projects.create', { name: 'desde-el-movil' });
  const event = await until(async () => {
    const { value } = await reader.read(); text += Buffer.from(value ?? []).toString();
    for (const line of text.split('\n')) if (line.startsWith('data: ')) { const e = C.openText(p.key, line.slice(6), C.AAD.event(p.id)); if (e.e === 'board:changed') return e; }
    return null;
  }, 'evento en directo');
  assert.equal(event.e, 'board:changed');
  assert.ok(!text.includes('board:changed'), 'el evento no se lee por el camino');
  ctrl.abort();
  await call('remote.revoke', { id: p.id });
  assert.equal((await p.post('/api/call', p.box('call', { method: 'app.state' }))).status, 401, 'tras revocarlo ya no entra');
});
