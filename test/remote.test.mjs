// Phone access: pairing with a one-time QR and the phone's own key, every message encrypted end to end, replays and
// tampering refused, host/origin checks, the phone's limited actions, encrypted uploads and live events, notifications
// and revocation; the QR used once and too many tries cut. The server binds to loopback here (ORB_REMOTE_BIND) instead
// of the Wi-Fi or Tailscale address.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fork } from 'node:child_process';
import http from 'node:http';
import { tempHome, ROOT, until } from './helpers.mjs';
import * as C from '../src/core/mobile-crypto.mjs';
import { privateSource } from '../src/engine/remote.mjs';
import { parseLinkPayload, normalCode, normalAddress } from '../src/core/link-payload.mjs';
import { createPhone, TEST_MASTER } from './fixtures/phone-client.mjs';

let unlock = null;
let t; let engine; let n = 0; const pending = new Map(); let base; let port;
const call = (method, params = {}) => new Promise((resolve, reject) => { const id = ++n; pending.set(id, { resolve, reject }); engine.send({ type: 'call', id, method, params }); });

before(async () => {
  port = 20000 + Math.floor(Math.random() * 20000);
  t = tempHome({ mobile: { enabled: true, port } });
  if (!fs.existsSync(path.join(ROOT, 'src', 'renderer', 'index.html'))) throw new Error('compila antes la interfaz (npm run build)');
  engine = fork(path.join(ROOT, 'src', 'engine', 'engine.mjs'), [], { stdio: ['ignore', 'inherit', 'inherit', 'ipc'], env: { ...process.env, ORB_REMOTE_BIND: '127.0.0.1', ORB_FAKE_LOG: path.join(t.base, 'fake.jsonl') } });
  engine.on('message', (m) => { if (m.type === 'reply') { const p = pending.get(m.id); pending.delete(m.id); m.ok ? p.resolve(m.result) : p.reject(new Error(m.error)); } });
  await new Promise((resolve, reject) => { engine.once('message', (m) => (m.type === 'started' && m.ok ? resolve() : reject(new Error(m.error)))); engine.send({ type: 'start', home: t.home, version: 'test' }); });
  base = `http://127.0.0.1:${port}`;
  await until(async () => (await call('remote.status')).running, 'servidor del móvil');
  unlock = (await call('master.create', { password: TEST_MASTER })).unlock; // 3.8: phones link with the master password
});
after(() => { engine?.send({ type: 'shutdown' }); t?.cleanup(); });

// A phone, as the page does it (src/ui/lib/web-bridge.js).
function phone() {
  const me = { kp: C.newKeyPair(), id: null, key: null, pc: null };
  me.pairBody = (code, pcPub, { name = 'Android', at = Date.now(), v = 4 } = {}) => {
    const pub = C.b64.enc(me.kp.pub);
    return { step: 'start', pub, proof: C.seal(C.pairingKey(me.kp.priv, pcPub, code), { pub, name, t: at, v }, C.AAD.pair) };
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
// 3.8: two steps, the second with the master password's proof (src/core/mobile-crypto.mjs › linkDevice, by hand).
const postPair = (body) => fetch(`${base}/api/pair`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
const pair = async (p, q, { password = TEST_MASTER, ...opts } = {}) => {
  const res = await postPair(p.pairBody(q.code, q.pc, opts));
  if (res.status !== 200) return res.status;
  const c = C.open(C.pairingKey(p.kp.priv, q.pc, q.code), (await res.json()).box, C.AAD.pairChallenge);
  const ver = await C.verifierOf(password, c.kdf);
  const transcript = C.pakeTranscript({ via: 'qr', devPub: p.kp.pub, pcPub: q.pc, sid: c.sid, kdf: c.kdf });
  const K = C.pakeKey({ secret: q.code, dhDevice: C.sharedSecret(p.kp.priv, q.pc), dhPassword: C.sharedSecret(ver.priv, q.pc), transcript });
  const fin = await postPair({ step: 'finish', sid: c.sid, pub: C.b64.enc(p.kp.pub), mac: C.b64.enc(C.pakeMac(K, C.MAC_PHONE)) });
  if (fin.status !== 200) return fin.status;
  const data = await fin.json();
  assert.ok(C.sameBytes(C.b64.dec(data.mac), C.pakeMac(K, C.macPc(data.id))), 'el PC demuestra que es el del código');
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
  const manifest = await (await fetch(`${base}/manifest.webmanifest`)).json();
  assert.equal(manifest.display, 'standalone');
  // 3.8.1: the «maskable» icon fills the whole canvas (the phone crops it to its own shape).
  const maskable = manifest.icons.find((i) => i.purpose === 'maskable');
  assert.equal(maskable.src, '/icon-maskable.png');
  const icon = await fetch(`${base}${maskable.src}`);
  assert.equal(icon.status, 200);
  const { PNG } = (await import('pngjs')).default;
  const img = PNG.sync.read(Buffer.from(await icon.arrayBuffer()));
  for (const [x, y] of [[0, 0], [img.width - 1, 0], [0, img.height - 1], [img.width - 1, img.height - 1]]) assert.equal(img.data[(y * img.width + x) * 4 + 3], 255, `esquina ${x},${y} opaca`);
  assert.match(await (await fetch(`${base}/sw.js`)).text(), /showNotification/);
  // fetch() cannot change Host: a raw request plays the DNS-rebinding page.
  const status = await new Promise((resolve, reject) => http.get({ host: '127.0.0.1', port, path: '/api/me', headers: { Host: 'atacante.example' } }, (r) => { r.resume(); resolve(r.statusCode); }).on('error', reject));
  assert.equal(status, 421, 'DNS rebinding: otro nombre de host se rechaza');
  assert.equal((await fetch(`${base}/../../orb.json`)).status, 404);
  assert.equal((await fetch(`${base}/pip.html`)).status, 404, 'las páginas solo de escritorio no se sirven');
  assert.equal((await fetch(`${base}/icon.png`)).status, 200);
  assert.equal((await fetch(`${base}/robot/cabeza.png`)).status, 200, 'las imágenes del robot');
  assert.equal((await fetch(`${base}/robot/../orb.json`)).status, 404);
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
  assert.equal(await pair(p, q, { at: Date.now() + 30 * 60_000 }), 409, 'reloj del móvil adelantado: pide la hora del PC…');
  assert.equal(await pair(p, q), 200, '…y el mismo QR sigue sirviendo');
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
  // With quotes: base64 never has them, so a random run of letters in the ciphertext (an «Orb» by chance) does not count.
  assert.ok(!raw.includes('"assistantName"') && !raw.includes('"config"'), 'la respuesta no se puede leer por el camino');
  assert.equal((await p.post('/api/call', box)).status, 401, 'la misma petición dos veces (repetición)');
  // A request stamped far from the PC's time (a replay, or a phone whose clock is off): refused, but the phone stays
  // paired and gets the PC's time, so its next request, stamped with it, goes through.
  const late = await p.post('/api/call', p.box('call', { method: 'app.state' }, { at: Date.now() - 20 * 60_000 }));
  assert.equal(late.status, 409, 'una petición vieja');
  assert.ok(Math.abs((await late.json()).now - Date.now()) < 5000, 'con la hora del PC');
  assert.equal((await p.call('app.state')).ok, true, 'el móvil sigue vinculado');
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
  // 3.8.2 (D5): «Acceso total» only with the master password, from this PC.
  const made = await call('sessions.create', { agent: 'claude', project: 'desde-el-pc' });
  const total = await call('sessions.grantTotal', { id: made.id, unlock: (await call('master.unlock', { password: TEST_MASTER, purpose: 'fullAccess' })).unlock });
  const denied = async (method, params) => { const r = await p.call(method, params); assert.equal(r.ok, false, method); assert.equal(r.status, 403, method); };
  await denied('sessions.send', { id: total.id, text: 'hola' });
  for (const method of ['config.save', 'accounts.add', 'installer.start', 'remote.pair', 'remote.configure', 'projects.import', 'projects.createPr', 'agents.login', 'agents.loginCode', 'agents.install']) await denied(method, {});
  await denied('sessions.create', { agent: 'codex', permission: 'total' });
  await denied('sessions.send', { id: 'x', text: 'hola', images: [path.join(t.home, 'core', 'orb.json')] });
  // A picture uploaded from the phone: encrypted, and checked by its bytes.
  const upload = async (bytes) => {
    const auth = C.sealText(p.key, { t: Date.now(), m: 'upload' }, C.AAD.request(p.id));
    const res = await fetch(`${base}/api/upload`, { method: 'POST', headers: { 'X-Orb-Device': p.id, 'X-Orb-Auth': auth }, body: C.sealBytes(p.key, bytes, C.AAD.upload(p.id)) });
    assert.equal(res.status, 200);
    return C.open(p.key, await res.json(), C.AAD.response(p.id));
  };
  const png = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d4944415478da63f8ffff3f0005fe02fea7d6a0f10000000049454e44ae426082', 'hex');
  const up = await upload(new Uint8Array(png));
  // F2.6c (P7): the phone gets the picture's name, never the PC's folder; it sends that name back with its message.
  assert.match(up.result.path, /^\d+-[0-9a-f]{8}\.png$/);
  assert.equal(fs.readFileSync(path.join(t.home, 'core', 'adjuntos-movil', up.result.path)).equals(png), true);
  const withPicture = await p.call('sessions.send', { id: 'no-existe', text: 'hola', images: [up.result.path] });
  assert.notEqual(withPicture.status, 403, 'su propia imagen, por su nombre, sí');
  assert.ok(!String(withPicture.error ?? '').includes(t.home), 'los errores tampoco llevan la carpeta');
  assert.equal((await upload(new Uint8Array(Buffer.from('MZ ejecutable')))).status, 415);
});

// 3.8 (M4, B3), through the encrypted /api/call: no folder of the PC, and the brain of one conversation only.
test('el móvil no recibe carpetas del PC ni cambia el cerebro de las conversaciones nuevas', async () => {
  const p = globalThis.phone1;
  const state = (await p.call('app.state')).result;
  assert.equal(state.home, undefined); assert.equal(state.paths, undefined);
  assert.equal(state.activeProject?.path, undefined);
  const before = JSON.stringify((await call('app.state')).config.orchestrator);
  const refused = await p.call('chat.settings', { reasoning: 'low' });
  assert.equal(refused.ok, false); assert.equal(refused.status, 403);
  const { conversation } = (await p.call('chat.send', { text: 'hola desde el móvil', brain: { reasoning: 'low' } })).result;
  const changed = await p.call('chat.settings', { conversation, reasoning: 'high' });
  assert.equal(changed.ok, true, changed.error); assert.equal(changed.result.reasoning, 'high');
  assert.equal(JSON.stringify((await call('app.state')).config.orchestrator), before, 'lo de las nuevas sigue igual');
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
  // An app older than what this Orb still talks to is told to update (426, review F2.2 M1); the current one is not.
  const old = C.open(p.key, await (await p.post('/api/me', p.box('me', { v: 1 }))).json(), C.AAD.response(p.id));
  assert.equal(old.ok, false); assert.equal(old.status, 426); assert.equal(old.update, 'me');
  assert.match(old.error, /actualiza/i);
  assert.equal(C.open(p.key, await (await p.post('/api/me', p.box('me', { v: 3 }))).json(), C.AAD.response(p.id)).ok, true);
});

// 3.8.3: the streamed answer goes as deltas only to a client that asked for them (d: 1, the page of 3.8.3 on); a phone of
// 3.8.1–3.8.2 still gets the whole text in each state, as before (src/core/chat-stream.mjs).
test('respuesta en directo: deltas al cliente que los pide, el texto entero a los móviles anteriores', async () => {
  const p = globalThis.phone1;
  const open = async (extra) => {
    const ctrl = new AbortController();
    const auth = C.sealText(p.key, { t: Date.now(), m: 'events', ...extra }, C.AAD.request(p.id));
    const res = await fetch(`${base}/api/events`, { headers: { 'X-Orb-Device': p.id, 'X-Orb-Auth': auth }, signal: ctrl.signal });
    assert.equal(res.status, 200);
    const got = { states: [], bytes: 0, ctrl };
    (async () => {
      const reader = res.body.getReader(); let buf = '';
      try {
        for (;;) {
          const { value, done } = await reader.read(); if (done) return;
          buf += Buffer.from(value).toString(); let i;
          while ((i = buf.indexOf('\n\n')) >= 0) {
            const line = buf.slice(0, i); buf = buf.slice(i + 2);
            if (!line.startsWith('data: ')) continue;
            const e = C.openText(p.key, line.slice(6), C.AAD.event(p.id));
            if (e.e === 'chat:state') { got.states.push(e.p); got.bytes += line.length; }
          }
        }
      } catch { /* aborted */ }
    })();
    return got;
  };
  const old = await open({}); const fresh = await open({ d: 1 });
  const { streamText } = await import('../src/core/chat-stream.mjs');
  const { conversation } = (await p.call('chat.send', { text: 'STREAM_LARGO para el móvil' })).result;
  await until(() => old.states.some((s) => s.conversation === conversation && !s.busy) && fresh.states.some((s) => s.conversation === conversation && !s.busy), 'el final del turno en los dos', 30000);
  const mine = (got) => got.states.filter((s) => s.conversation === conversation);
  assert.ok(mine(old).every((s) => s.append === undefined && typeof s.partial === 'string'), 'el móvil anterior: siempre el texto entero');
  assert.ok(mine(fresh).some((s) => s.append !== undefined), 'el nuevo: deltas');
  let held = ''; const rebuilt = [];
  for (const s of mine(fresh)) { held = streamText(held, s); assert.notEqual(held, null, 'cada delta sigue al anterior'); if (s.busy) rebuilt.push(held); }
  const whole = mine(old).filter((s) => s.busy).map((s) => s.partial);
  assert.deepEqual(rebuilt, whole, 'el mismo texto, estado a estado');
  assert.ok(whole.at(-1).length > 1000, 'una respuesta larga');
  assert.ok(fresh.bytes * 2 < old.bytes, `menos bytes con deltas (${fresh.bytes} frente a ${old.bytes})`);
  old.ctrl.abort(); fresh.ctrl.abort();
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
  await assert.rejects(call('remote.revoke', { id: p.id }), /contraseña maestra/, '3.8: quitar un móvil pide la contraseña maestra');
  await call('remote.revoke', { id: p.id, unlock });
  assert.equal((await p.post('/api/call', p.box('call', { method: 'app.state' }))).status, 401, 'tras revocarlo ya no entra');
});

test('reabrir el acceso (cambio de red o de vía) conserva los móviles vinculados y el puerto', async () => {
  const p = phone(); assert.equal(await pair(p, await qr()), 200);
  const st = await call('remote.configure', { wifi: true }); // stop + start on the same port
  assert.equal(st.running, true);
  // A keep-alive connection to the server just closed can still be in fetch's pool for a moment (Windows hands over the
  // close late) and fail once with ECONNRESET; the phone's page retries the same way.
  const again = async (fn) => { for (let i = 0; ; i++) { try { return await fn(); } catch (error) { if (i >= 2 || !/fetch failed/.test(error.message)) throw error; await new Promise((r) => setTimeout(r, 150)); } } };
  assert.equal((await again(() => fetch(`${base}/`))).status, 200);
  assert.equal((await again(() => p.call('app.state'))).ok, true, 'el móvil sigue vinculado');
  assert.equal((await call('remote.enable', { enabled: false })).running, false);
  await assert.rejects(fetch(`${base}/`), 'apagado: nada escucha');
  assert.equal((await call('remote.enable', { enabled: true })).running, true);
});

test('solo redes privadas, Tailscale y este PC; QR v1 y v2; código corto', async () => {
  for (const ip of ['127.0.0.1', '::1', '::ffff:192.168.1.20', '10.0.0.5', '172.16.3.4', '172.31.0.1', '100.64.0.1', '100.127.255.254', 'fd7a:115c:a1e0::1']) assert.ok(privateSource(ip), ip);
  for (const ip of ['8.8.8.8', '172.32.0.1', '100.128.0.1', '192.169.0.1', '2001:db8::1', '', undefined]) assert.ok(!privateSource(ip), String(ip));
  const pc = C.b64.enc(C.newKeyPair().pub);
  const v1 = parseLinkPayload(`http://192.168.1.5:3131/#vincular=abc&pc=${encodeURIComponent(pc)}`);
  assert.deepEqual([v1.v, v1.urls, v1.code, v1.pc], [1, ['http://192.168.1.5:3131'], 'abc', pc]);
  const v2 = parseLinkPayload(`https://casa.ts.net:3131/#vincular=abc&pc=${encodeURIComponent(pc)}&v=2&n=Casa&a=${encodeURIComponent('http://100.64.0.2:3131')}`);
  assert.deepEqual([v2.v, v2.name], [2, 'Casa']);
  assert.deepEqual([...v2.urls].sort(), ['http://100.64.0.2:3131', 'https://casa.ts.net:3131']);
  assert.equal(normalCode('abcd-efgh'), 'ABCDEFGH');
  assert.equal(normalAddress('100.64.0.2'), 'http://100.64.0.2:3131');
  // The QR names this PC and its other addresses, never a role; the short code links too (one use).
  const q = await call('link.qr', { device: 'phone' });
  assert.match(q.code, /^[A-Z2-9]{4}-[A-Z2-9]{4}$/);
  assert.equal(q.payload.v, 4, 'protocolo 4 (3.8)');
  assert.equal(new URLSearchParams(new URL(q.url).hash.slice(1)).get('r'), null);
  const hello = await (await fetch(`${base}/api/hello`)).json();
  assert.ok(Array.isArray(hello.urls) && hello.urls.length >= 1, 'las direcciones de este PC');
  assert.equal(hello.role, undefined);
  const byCode = createPhone({ name: 'Con el código', kind: 'phone' });
  try {
    const me = await byCode.connect({ code: q.code.toLowerCase(), address: `127.0.0.1:${port}`, fp: q.pc });
    assert.equal(me.fp, q.pc);
    assert.ok((await call('link.devices')).some((d) => d.id === me.id && d.kind === 'phone'));
    await assert.rejects(createPhone().connect({ code: q.code, address: `127.0.0.1:${port}` }), 'el mismo código no sirve dos veces');
  } finally { byCode.stop(); }
});

// Last: it leaves this address without more tries for a while.
test('el QR ya usado no sirve y demasiados intentos se cortan', async () => {
  const q = await call('link.qr');
  const fresh = createPhone({ name: 'Otro', kind: 'browser' });
  try {
    await fresh.connect({ qr: q.url });
    await assert.rejects(fresh.connect({ qr: q.url }), (e) => e.status === 401, 'un solo uso');
    let last = 0;
    for (let i = 0; i < 12; i++) { last = (await fetch(`${base}/api/pair`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"pub":"x"}' })).status; }
    assert.equal(last, 429, 'demasiados intentos desde la misma dirección');
  } finally { fresh.stop(); }
});
