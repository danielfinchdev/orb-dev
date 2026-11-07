// 3.5, the Android app (android-app/, src/ui/lib/app-bridge.js): what it reads from a QR or a typed code
// (src/ui/lib/link-payload.js), which bridge the page gets, which addresses it may use, and that the phone access lets
// the app's own page (another origin: http://localhost) in, with every message still sealed with the phone's key.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { fork } from 'node:child_process';
import { tempHome, ROOT, until } from './helpers.mjs';
import * as C from '../src/core/mobile-crypto.mjs';
import { parseLinkPayload, parseManual, orderBases, allowedBase, isPrivateHost, pairingSecret, pickBridge, normalAddress } from '../src/ui/lib/link-payload.js';

const PC = C.b64.enc(C.newKeyPair().pub);
const keyOf = (fn) => { try { fn(); } catch (e) { return e.key ?? e.message; } return null; };

test('QR v1 (3.2): la dirección, el código y la clave del PC', () => {
  const p = parseLinkPayload(`http://192.168.1.20:3131/#vincular=abc_DEF-123&pc=${PC}`);
  assert.deepEqual(p.urls, ['http://192.168.1.20:3131']);
  assert.equal(p.code, 'abc_DEF-123'); assert.equal(p.pc, PC); assert.equal(p.v, 1); assert.equal(p.via, 'qr');
  assert.equal(pairingSecret(p), 'abc_DEF-123', 'el código del QR se usa tal cual');
});

test('QR v2 (Magic Link): varias direcciones, nombre y papel; https primero, luego Tailscale, luego la wifi', () => {
  const others = ['http://192.168.1.20:3131', 'https://casa.tail1234.ts.net:3131', 'http://100.101.102.103:3131'].join(',');
  const p = parseLinkPayload(`http://192.168.1.20:3131/#vincular=c0de&pc=${PC}&v=2&n=Servidor&r=centro&a=${encodeURIComponent(others)}`);
  assert.deepEqual(p.urls, ['https://casa.tail1234.ts.net:3131', 'http://100.101.102.103:3131', 'http://192.168.1.20:3131']);
  assert.equal(p.v, 2); assert.equal(p.name, 'Servidor'); assert.equal(p.role, 'centro');
  // The same as JSON (link.mjs › parseQr also takes it).
  const j = parseLinkPayload(JSON.stringify({ v: 2, urls: ['http://100.64.0.7:3131', 'https://pc.tail.ts.net'], pc: PC, code: 'k', role: 'taller' }));
  assert.deepEqual(j.urls, ['https://pc.tail.ts.net', 'http://100.64.0.7:3131']);
  assert.equal(j.role, 'taller');
});

test('QR que no sirven: de otra cosa, de una versión vieja o a una dirección pública sin https', () => {
  assert.equal(keyOf(() => parseLinkPayload('hola')), 'app.linkBadQr');
  assert.equal(keyOf(() => parseLinkPayload('https://example.com/')), 'app.linkBadQr');
  assert.equal(keyOf(() => parseLinkPayload('{"v":2}')), 'app.linkBadQr');
  assert.equal(keyOf(() => parseLinkPayload('{roto')), 'app.linkBadQr');
  assert.equal(keyOf(() => parseLinkPayload('http://192.168.1.2:3131/#vincular=abc')), 'app.oldQr', 'sin la clave del PC (2.3)');
  assert.equal(keyOf(() => parseLinkPayload('http://192.168.1.2:3131/#vincular=abc&pc=corta')), 'app.oldQr');
  assert.equal(keyOf(() => parseLinkPayload(`http://8.8.8.8:3131/#vincular=abc&pc=${PC}`)), 'app.linkInsecure', 'http a una dirección pública: no');
  assert.equal(keyOf(() => parseLinkPayload(`orb://x/#vincular=abc&pc=${PC}`)), 'app.linkBadQr');
  // A public address with https is fine (tailscale serve, or a relay).
  assert.deepEqual(parseLinkPayload(`https://orb.example.com/#vincular=abc&pc=${PC}`).urls, ['https://orb.example.com']);
});

test('a mano: el enlace pegado, o el código corto con la dirección', () => {
  assert.equal(parseManual({ text: `  http://10.0.0.5:3131/#vincular=z&pc=${PC}  ` }).code, 'z');
  const p = parseManual({ code: 'abcd-efgh', address: '100.64.1.2' });
  assert.deepEqual(p.urls, ['http://100.64.1.2:3131'], 'el puerto de Orb por defecto');
  assert.equal(p.via, 'code'); assert.equal(p.pc, null);
  assert.equal(pairingSecret(p), 'corto:ABCDEFGH', 'el código corto, normalizado y marcado (link.mjs › pairAt)');
  assert.equal(keyOf(() => parseManual({ code: '', address: '100.64.1.2' })), 'app.linkNoCode');
  assert.equal(keyOf(() => parseManual({ code: 'ABCDEFGH', address: '' })), 'app.linkNoAddress');
  assert.equal(keyOf(() => parseManual({ code: 'ABCDEFGH', address: '1.1.1.1' })), 'app.linkInsecure');
  assert.equal(normalAddress('https://pc.tail.ts.net/'), 'https://pc.tail.ts.net');
});

test('solo direcciones privadas en http: Tailscale, la wifi de casa y este móvil', () => {
  for (const h of ['100.64.0.1', '100.127.255.254', '10.1.2.3', '172.16.0.1', '172.31.9.9', '192.168.0.10', '127.0.0.1', 'localhost', 'pc.tail1234.ts.net', 'home-server', 'nas.local', '::1', 'fd12:3456::1']) assert.ok(isPrivateHost(h), h);
  for (const h of ['100.63.0.1', '100.128.0.1', '172.32.0.1', '8.8.8.8', 'example.com', '192.169.0.1', '300.1.1.1']) assert.ok(!isPrivateHost(h), h);
  assert.ok(allowedBase('https://example.com'));
  assert.ok(!allowedBase('http://example.com'));
  assert.ok(!allowedBase('ftp://192.168.1.1'));
  assert.deepEqual(orderBases(['http://example.com', 'http://192.168.1.1:3131', 'http://192.168.1.1:3131', 'basura::']), ['http://192.168.1.1:3131'], 'sin repetidas ni públicas en http');
});

test('qué puente tiene la página: el de Electron, el de la app o el del navegador', () => {
  assert.equal(pickBridge({ hasOrb: true, native: false }), 'electron');
  assert.equal(pickBridge({ hasOrb: true, native: true }), 'electron', 'si ya hay uno, se queda');
  assert.equal(pickBridge({ native: true }), 'app');
  assert.equal(pickBridge({}), 'web');
});

test('la app de Android se compila aparte y no entra en el instalador del PC', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  assert.ok(pkg.build.files.includes('!android-app/**'));
  assert.match(pkg.scripts['android:build'], /android-build\.mjs/);
  const cap = JSON.parse(fs.readFileSync(path.join(ROOT, 'android-app', 'capacitor.config.json'), 'utf8'));
  assert.equal(cap.appId, 'dev.orb.app'); assert.equal(cap.appName, 'Orb');
  assert.equal(cap.server.androidScheme, 'http', 'la página de la app es http://localhost (el origen que el PC deja pasar)');
  const manifest = fs.readFileSync(path.join(ROOT, 'android-app', 'android', 'app', 'src', 'main', 'AndroidManifest.xml'), 'utf8');
  assert.match(manifest, /android:allowBackup="false"/);
  assert.match(manifest, /android\.intent\.action\.SEND/);
  assert.match(manifest, /network_security_config/);
  const ignore = fs.readFileSync(path.join(ROOT, '.gitignore'), 'utf8');
  for (const x of ['android-app/www/', '*.jks', '*.apk']) assert.ok(ignore.includes(x), x);
});

// The phone access with the app's page: another origin (http://localhost), let in with CORS; still sealed end to end.
let t; let engine; let n = 0; const pending = new Map(); let port;
const call = (method, params = {}) => new Promise((resolve, reject) => { const id = ++n; pending.set(id, { resolve, reject }); engine.send({ type: 'call', id, method, params }); });
const raw = (method, pathname, headers = {}, body = null) => new Promise((resolve, reject) => {
  const req = http.request({ host: '127.0.0.1', port, path: pathname, method, headers: { Host: `127.0.0.1:${port}`, ...headers } }, (r) => { let s = ''; r.on('data', (c) => { s += c; }); r.on('end', () => resolve({ status: r.statusCode, headers: r.headers, body: s })); });
  req.on('error', reject); if (body) req.write(body); req.end();
});

before(async () => {
  port = 20000 + Math.floor(Math.random() * 20000);
  t = tempHome({ mobile: { enabled: true, port } });
  if (!fs.existsSync(path.join(ROOT, 'src', 'renderer', 'index.html'))) throw new Error('compila antes la interfaz (npm run build)');
  engine = fork(path.join(ROOT, 'src', 'engine', 'engine.mjs'), [], { stdio: ['ignore', 'inherit', 'inherit', 'ipc'], env: { ...process.env, ORB_REMOTE_BIND: '127.0.0.1' } });
  engine.on('message', (m) => { if (m.type === 'reply') { const p = pending.get(m.id); pending.delete(m.id); m.ok ? p.resolve(m.result) : p.reject(new Error(m.error)); } });
  await new Promise((resolve, reject) => { engine.once('message', (m) => (m.type === 'started' && m.ok ? resolve() : reject(new Error(m.error)))); engine.send({ type: 'start', home: t.home, version: 'test' }); });
  await until(async () => (await call('remote.status')).running, 'servidor del móvil');
  await call('master.create', { password: 'contraseña del PC' }); // 3.8: linking needs it
});
after(() => { engine?.send({ type: 'shutdown' }); t?.cleanup(); });

test('el PC deja pasar la página de la app (CORS) y a nadie más; todo sigue cifrado', async () => {
  const pre = await raw('OPTIONS', '/api/call', { Origin: 'http://localhost', 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'content-type,x-orb-device' });
  assert.equal(pre.status, 204);
  assert.equal(pre.headers['access-control-allow-origin'], 'http://localhost');
  assert.match(pre.headers['access-control-allow-headers'], /X-Orb-Device/);
  assert.equal((await raw('OPTIONS', '/api/call', { Origin: 'https://atacante.example' })).status, 403);
  assert.equal((await raw('POST', '/api/call', { Origin: 'https://atacante.example', 'Content-Type': 'application/json' }, '{}')).status, 403, 'otra web: fuera');

  // Pair from the app's page with the QR, as web-bridge.js › pairWith does it.
  const { url } = await call('remote.pair', {});
  const q = parseLinkPayload(url);
  const pcPub = C.b64.dec(q.pc);
  // Both steps of linking (3.8, the master password never sent) from the app's page (its Origin).
  const allowed = [];
  const appFetch = async (u, init) => {
    const r = await raw('POST', new URL(u).pathname, { Origin: 'http://localhost', 'Content-Type': 'application/json' }, init.body);
    allowed.push(r.headers['access-control-allow-origin']);
    return new Response(r.body, { status: r.status });
  };
  const linked = await C.linkDevice({ base: 'http://app', pcPub, secret: pairingSecret(q), via: q.via, name: 'Pixel 9 (app)', kind: 'phone', v: 4, min: 2, password: 'contraseña del PC', fetch: appFetch });
  assert.deepEqual(allowed, ['http://localhost', 'http://localhost'], 'las respuestas llevan el permiso para la app');
  const { id, key } = linked;
  const req = C.seal(key, { t: Date.now(), m: 'me', b: null }, C.AAD.request(id));
  const me = await raw('POST', '/api/me', { Origin: 'http://localhost', 'Content-Type': 'application/json', 'X-Orb-Device': id }, JSON.stringify(req));
  assert.equal(me.status, 200);
  const msg = C.open(key, JSON.parse(me.body), C.AAD.response(id));
  assert.equal(msg.r, req.n); assert.equal(msg.result.device, 'Pixel 9 (app)');
  assert.ok(!me.body.includes('Pixel'), 'la respuesta va cifrada');
});
