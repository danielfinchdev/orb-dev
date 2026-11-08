// 3.5, the Android app (3.8.1: Tauri's Android app, src-tauri/gen/android; src/ui/lib/app-bridge.js): what it reads from
// a QR or a typed code (src/ui/lib/link-payload.js), which bridge the page gets, which addresses it may use, and that the
// phone access lets the app's own page (another origin: http://tauri.localhost) in, with every message still sealed with
// the phone's key.
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
  // The same as JSON (parseLinkPayload also takes it).
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
  assert.equal(pairingSecret(p), 'corto:ABCDEFGH', 'el código corto, normalizado y marcado');
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

test('qué puente tiene la página: el del escritorio, el de la app o el del navegador', () => {
  assert.equal(pickBridge({ hasOrb: true, native: false }), 'desktop');
  assert.equal(pickBridge({ hasOrb: true, native: true }), 'desktop', 'si ya hay uno, se queda');
  assert.equal(pickBridge({ native: true }), 'app');
  assert.equal(pickBridge({}), 'web');
});

test('la app de Android se compila aparte y no entra en el instalador del PC', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  // The PC's package carries src (without the window's sources), the engine's packages and package.json: never the app.
  const resources = fs.readFileSync(path.join(ROOT, 'scripts', 'tauri-resources.mjs'), 'utf8');
  assert.match(resources, /copy\(src, path\.join\(dest, 'src'\)/);
  assert.doesNotMatch(resources, /android|renderer-android/);
  assert.match(pkg.scripts['android:build'], /android-build\.mjs/);
  assert.equal(pkg.scripts.tauri, 'tauri', 'Gradle builds the Rust part through `npm run tauri`');
  assert.ok(!fs.existsSync(path.join(ROOT, 'android-app')), '3.8.1: the Capacitor app is gone');
  for (const dep of Object.keys({ ...pkg.dependencies, ...pkg.devDependencies })) assert.doesNotMatch(dep, /capacitor/, dep);
  const conf = JSON.parse(fs.readFileSync(path.join(ROOT, 'src-tauri', 'tauri.conf.json'), 'utf8'));
  assert.equal(conf.identifier, 'dev.orb.app', 'the same applicationId: the update installs over 3.8.0');
  assert.equal(conf.productName, 'Orb');
  const android = JSON.parse(fs.readFileSync(path.join(ROOT, 'src-tauri', 'tauri.android.conf.json'), 'utf8'));
  assert.equal(android.build.frontendDist, '../src/renderer-android');
  assert.match(android.build.beforeBuildCommand, /android-web\.mjs/);
  assert.equal(android.bundle.android.minSdkVersion, 24);
  assert.match(android.app.security.csp, /connect-src 'self' data: blob: ipc: http: https:;/, 'the page talks to the PC it is linked with');
  const manifest = fs.readFileSync(path.join(ROOT, 'src-tauri', 'gen', 'android', 'app', 'src', 'main', 'AndroidManifest.xml'), 'utf8');
  assert.match(manifest, /android:allowBackup="false"/);
  assert.match(manifest, /android\.intent\.action\.SEND/);
  assert.match(manifest, /network_security_config/);
  const ignore = fs.readFileSync(path.join(ROOT, '.gitignore'), 'utf8');
  for (const x of ['src/renderer-android/', '*.jks', '*.apk']) assert.ok(ignore.includes(x), x);
});

// The phone access with the app's page: another origin (3.8.1 http://tauri.localhost; 3.8.0's http://localhost until the
// phone updates), let in with CORS; still sealed end to end.
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
  const APP = 'http://tauri.localhost';
  const pre = await raw('OPTIONS', '/api/call', { Origin: APP, 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'content-type,x-orb-device' });
  assert.equal(pre.status, 204);
  assert.equal(pre.headers['access-control-allow-origin'], APP);
  const old = await raw('OPTIONS', '/api/call', { Origin: 'http://localhost', 'Access-Control-Request-Method': 'POST' });
  assert.equal(old.status, 403, 'una página de localhost (la app de 3.8.0 o la de un agente) no es la app (D8 B1)');
  assert.equal((await raw('OPTIONS', '/api/call', { Origin: 'capacitor://localhost' })).status, 403);
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
    const r = await raw('POST', new URL(u).pathname, { Origin: APP, 'Content-Type': 'application/json' }, init.body);
    allowed.push(r.headers['access-control-allow-origin']);
    return new Response(r.body, { status: r.status });
  };
  const linked = await C.linkDevice({ base: 'http://app', pcPub, secret: pairingSecret(q), via: q.via, name: 'Pixel 9 (app)', kind: 'phone', v: 4, min: 2, password: 'contraseña del PC', fetch: appFetch });
  assert.deepEqual(allowed, [APP, APP], 'las respuestas llevan el permiso para la app');
  const { id, key } = linked;
  const req = C.seal(key, { t: Date.now(), m: 'me', b: null }, C.AAD.request(id));
  const me = await raw('POST', '/api/me', { Origin: APP, 'Content-Type': 'application/json', 'X-Orb-Device': id }, JSON.stringify(req));
  assert.equal(me.status, 200);
  const msg = C.open(key, JSON.parse(me.body), C.AAD.response(id));
  assert.equal(msg.r, req.n); assert.equal(msg.result.device, 'Pixel 9 (app)');
  assert.ok(!me.body.includes('Pixel'), 'la respuesta va cifrada');
});

// 3.8.1: the small notification icon (status bar) is the short «o•» of the app icon, made by scripts/icono.mjs: a white
// silhouette on transparent (Android draws only its alpha), 24 dp in every density, the drawing in Material's 20 dp
// content area, and the «o» and the «•» apart even at mdpi and hdpi (H1c-fix: they touched there and read as a blob).
test('el icono pequeño de los avisos de Android: silueta blanca «o•» en todas las densidades', async () => {
  const { PNG } = (await import('pngjs')).default;
  const res = path.join(ROOT, 'src-tauri', 'gen', 'android', 'app', 'src', 'main', 'res');
  assert.ok(!fs.existsSync(path.join(res, 'drawable', 'ic_stat_orb.xml')), 'fuera el orbe con anillo de antes');
  const covered = {};
  for (const [density, k] of Object.entries({ mdpi: 1, hdpi: 1.5, xhdpi: 2, xxhdpi: 3, xxxhdpi: 4 })) {
    const img = PNG.sync.read(fs.readFileSync(path.join(res, `drawable-${density}`, 'ic_stat_orb.png')));
    assert.deepEqual([img.width, img.height], [24 * k, 24 * k], density);
    let seen = 0; const margin = Math.floor(2 * k); let out = 0;
    for (let y = 0; y < img.height; y++) for (let x = 0; x < img.width; x++) {
      const i = (y * img.width + x) * 4;
      if (!img.data[i + 3]) continue;
      seen++;
      assert.deepEqual([...img.data.subarray(i, i + 3)], [255, 255, 255], `${density}: solo blanco (${x},${y})`);
      if (x < margin || y < margin || x >= img.width - margin || y >= img.height - margin) out++;
    }
    assert.equal(out, 0, `${density}: dentro de los 20 dp útiles`);
    covered[density] = seen / (img.width * img.height);
    // Two shapes (the «o» and the orb), not one: the pixels that show (alpha ≥ 64), joined side by side.
    const on = (x, y) => x >= 0 && y >= 0 && x < img.width && y < img.height && img.data[(y * img.width + x) * 4 + 3] >= 64;
    const seenAt = new Set(); let shapes = 0;
    for (let y = 0; y < img.height; y++) for (let x = 0; x < img.width; x++) {
      if (!on(x, y) || seenAt.has(y * img.width + x)) continue;
      shapes++;
      const stack = [[x, y]];
      while (stack.length) { const [a, b] = stack.pop(); if (!on(a, b) || seenAt.has(b * img.width + a)) continue; seenAt.add(b * img.width + a); stack.push([a + 1, b], [a - 1, b], [a, b + 1], [a, b - 1]); }
    }
    assert.equal(shapes, 2, `${density}: la «o» y el «•» separados`);
  }
  // The same drawing in each density: the share it covers barely changes; and the orb is cut from the «o» (not a blob).
  const shares = Object.values(covered);
  assert.ok(Math.max(...shares) - Math.min(...shares) < 0.08, JSON.stringify(covered));
  assert.ok(shares.every((s) => s > 0.25 && s < 0.6), JSON.stringify(covered));
  // The app's notifications use it (3.8.1: Notes.kt, no notifications plugin).
  const notes = fs.readFileSync(path.join(ROOT, 'src-tauri', 'gen', 'android', 'app', 'src', 'main', 'java', 'dev', 'orb', 'app', 'Notes.kt'), 'utf8');
  assert.equal(notes.match(/setSmallIcon\(R\.drawable\.ic_stat_orb\)/g)?.length, 2);
});
