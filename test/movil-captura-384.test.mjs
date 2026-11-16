// PC screenshot for the phone: pc.screenshot, the sealed download route and its vector. The engine runs with a prepared
// JPEG instead of the real screen (ORB_FAKE_SCREENSHOT); the capture module itself is tested with an injected runner.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { tempHome, startEngine, until, ROOT } from './helpers.mjs';
import { createPhone, TEST_MASTER } from './fixtures/phone-client.mjs';
import * as C from '../src/shared/mobile-crypto.mjs';
import { HOST_METHODS, checkHostRequest } from '../src/engine/host/host.mjs';
import { createScreenshot, runHostScreenshot, SHOT_NAME } from '../src/engine/host/screenshot.mjs';
import { REMOTE_METHODS } from '../src/domain/security/permissions.mjs';

const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.from('captura de prueba'), Buffer.from([0xff, 0xd9])]);
let A; let t; let phone; let other; let a; let b; let jpg; let uploads;
before(async () => {
  const port = 20000 + Math.floor(Math.random() * 20000);
  t = tempHome({ mobile: { enabled: true, port, name: 'Casa' } });
  jpg = path.join(t.base, 'fake.jpg'); fs.writeFileSync(jpg, JPEG);
  A = await startEngine(t.home, { env: { ORB_REMOTE_BIND: '127.0.0.1', ORB_FAKE_SCREENSHOT: jpg } });
  await until(async () => (await A.call('remote.status')).running, 'acceso');
  await A.call('master.create', { password: TEST_MASTER });
  phone = createPhone({ name: 'Pixel' });
  const pa = await phone.connect({ qr: (await A.call('link.qr', {})).url });
  other = createPhone({ name: 'Tablet' });
  const pb = await other.connect({ qr: (await A.call('link.qr', {})).url });
  a = phone.raw(pa.id); b = other.raw(pb.id);
});
after(async () => { phone?.stop(); other?.stop(); await A?.stop?.(); t?.cleanup(); });

const header = (r, msg) => C.sealText(r.key, { t: Date.now(), m: 'download', ...msg }, C.AAD.request(r.id));
const get = (r, name, { auth = header(r, { name }), query = `name=${name}` } = {}) =>
  fetch(`${r.base}/api/download?${query}`, { headers: { 'X-Orb-Device': r.id, 'X-Orb-Auth': auth } });

let shot;
test('pc.screenshot is a phone method and returns only the file name, with a notice on the PC', async () => {
  assert.ok(REMOTE_METHODS.has('pc.screenshot'));
  const r = await phone.call(a.id, 'pc.screenshot', { path: 'C:\\x', anything: 1 });
  assert.match(r.path, SHOT_NAME);
  shot = r.path;
  await until(() => A.events.some((e) => e.event === 'notice' && e.payload.tone === 'warning' && e.payload.always === true && /Pixel.* a las \d/.test(e.payload.body)), 'aviso');
  assert.ok(fs.existsSync(path.join(t.home, 'core', 'capturas-movil', shot)) || fs.readdirSync(t.home, { recursive: true }).some((f) => f.endsWith(path.join('capturas-movil', shot))));
});

test('the device that took it downloads it sealed and bound to the name', async () => {
  const res = await get(a, shot);
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('content-type'), 'application/octet-stream');
  assert.equal(res.headers.get('cache-control'), 'no-store');
  const bytes = new Uint8Array(await res.arrayBuffer());
  assert.deepEqual(Buffer.from(C.openBytes(a.key, bytes, C.AAD.download(a.id, shot))), JPEG);
  assert.throws(() => C.openBytes(a.key, bytes, C.AAD.upload(a.id)));
  assert.throws(() => C.openBytes(a.key, bytes, C.AAD.download(a.id, '1-aaaaaaaa.jpg')));
  assert.equal((await get(a, shot)).status, 200); // a retry within the time limit
});

test('another device, an unregistered file and bad names get nothing', async () => {
  assert.equal((await get(b, shot)).status, 404);
  // a file in the captures folder that was never registered for download
  const dir = fs.readdirSync(t.home, { recursive: true }).map((f) => path.join(t.home, f)).find((f) => f.endsWith(path.join('capturas-movil', shot)));
  const loose = `${Date.now()}-deadbeef.jpg`; fs.writeFileSync(path.join(path.dirname(dir), loose), JPEG);
  assert.equal((await get(a, loose)).status, 404);
  const bad = ['../x.jpg', '..%2fx.jpg', '%2e%2e%2f%2e%2e%2fsecreto.jpg', '..%5cx.jpg', 'C%3A%5Cwindows%5Cwin.ini', '/etc/passwd', shot.toUpperCase(), shot.replace('.jpg', '.png'), `${shot}%00`, 'x'.repeat(300), '%EF%BC%8E%EF%BC%8E.jpg', ''];
  for (const n of bad) {
    let dec = n; try { dec = decodeURIComponent(n); } catch { /* keep */ }
    const res = await get(a, dec, { auth: header(a, { name: dec }), query: `name=${n}` });
    assert.ok([400, 401, 404].includes(res.status), `${n} -> ${res.status}`);
  }
  assert.equal((await fetch(`${a.base}/api/download`, { headers: { 'X-Orb-Device': a.id } })).status, 401);
});

test('a repeated header, another name inside it or the wrong purpose are refused', async () => {
  const auth = header(a, { name: shot });
  assert.equal((await get(a, shot, { auth })).status, 200);
  assert.equal((await get(a, shot, { auth })).status, 401);
  assert.equal((await get(a, shot, { auth: header(a, { name: '1-aaaaaaaa.jpg' }) })).status, 400); // not 401: that means «unlinked»
  assert.equal((await get(a, shot, { auth: header(a, {}) })).status, 400);
  assert.equal((await get(a, shot, { auth: C.sealText(a.key, { t: Date.now(), m: 'events', name: shot }, C.AAD.request(a.id)) })).status, 401);
  assert.equal((await get(a, shot, { auth: C.sealText(a.key, { t: Date.now() - 3_600_000, m: 'download', name: shot }, C.AAD.request(a.id)) })).status, 409);
});

test('a linked browser cannot take a screenshot; the capture sits in its own folder, never in uploads', async () => {
  const browser = createPhone({ name: 'Navegador', kind: 'browser' });
  try {
    const pq = await browser.connect({ qr: (await A.call('link.qr', { device: 'browser' })).url });
    const r = await browser.raw(pq.id);
    await assert.rejects(browser.call(r.id, 'pc.screenshot', {}), /solo se puede pedir desde un móvil enlazado/);
  } finally { browser.stop(); }
  const files = fs.readdirSync(t.home, { recursive: true });
  assert.ok(files.some((f) => f.endsWith(path.join('capturas-movil', shot))));
  assert.ok(!files.some((f) => f.endsWith(path.join('adjuntos-movil', shot))));
});

test('the capture module: Windows only, one every 5 s, one at a time, size cap', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'orb-shot-'));
  try {
    await assert.rejects(createScreenshot({ platform: 'linux', run: async () => {} })(dir), /solo funciona en Windows/);
    let clock = 1_000_000; const calls = [];
    const cap = createScreenshot({ platform: 'win32', now: () => clock, run: async (out) => { calls.push(out); fs.writeFileSync(out, JPEG); } });
    assert.match(await cap(dir), SHOT_NAME); assert.equal(calls.length, 1); assert.equal(path.dirname(calls[0]), dir);
    clock += 4000;
    await assert.rejects(cap(dir), /Espera un momento antes de otra captura/);
    assert.equal(calls.length, 1);
    clock += 2000;
    assert.match(await cap(dir), SHOT_NAME);
    clock += 6000;
    await assert.rejects(createScreenshot({ platform: 'win32', now: () => clock, run: async () => { throw new Error('C:\\secreto powershell'); } })(dir), (e) => !/secreto/.test(e.message));
    clock += 6000;
    const big = createScreenshot({ platform: 'win32', now: () => clock, run: async (out) => fs.writeFileSync(out, Buffer.alloc(10 * 1024 * 1024 + 1)) });
    await assert.rejects(big(dir), /demasiado grande/);
    assert.equal(fs.readdirSync(dir).length, 2); // the failed and the oversized ones left nothing behind
    clock += 6000; let release;
    const slow = createScreenshot({ platform: 'win32', now: () => clock, run: (out) => new Promise((r) => { release = () => { fs.writeFileSync(out, JPEG); r(); }; }) });
    const first = slow(dir); clock += 6000;
    await until(() => release, 'ejecutor');
    await assert.rejects(slow(dir), /Espera un momento/);
    release(); await first;
    // old captures are swept before a new one; at most 60 per hour
    const old = path.join(dir, '1-0123abcd.jpg'); fs.writeFileSync(old, JPEG); const past = new Date(Date.now() - 11 * 60_000); fs.utimesSync(old, past, past);
    clock += 6000;
    const fresh = await createScreenshot({ platform: 'win32', now: () => Date.now(), run: async (out) => fs.writeFileSync(out, JPEG) })(dir);
    assert.ok(!fs.existsSync(old) && fs.existsSync(path.join(dir, fresh)));
    let c2 = 5_000_000; const many = createScreenshot({ platform: 'win32', now: () => c2, run: async (out) => fs.writeFileSync(out, JPEG) });
    for (let i = 0; i < 60; i++) { await many(dir); c2 += 6000; }
    await assert.rejects(many(dir), /Demasiadas capturas seguidas/);
    c2 += 3_600_000; await many(dir);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('the default runner asks the app (host.screenshot) with the path, and no script is involved', async () => {
  const sent = [];
  const out = path.join(os.tmpdir(), 'capturas-movil', '1-0123abcd.jpg');
  await runHostScreenshot(out, async (...args) => { sent.push(args); return { bytes: 1 }; });
  assert.deepEqual(sent, [['host.screenshot', { path: out }, 20_000]]);
  await assert.rejects(runHostScreenshot('x', async () => { throw Object.assign(new Error('host: sin app'), { code: 'noApp' }); }), /necesita la app de Orb abierta/);
  const src = fs.readFileSync(path.join(ROOT, 'src', 'engine', 'host', 'screenshot.mjs'), 'utf8');
  assert.doesNotMatch(src, /powershell|execFile|child_process/i);
  assert.ok(HOST_METHODS.includes('host.screenshot'));
  const dir = path.join(os.tmpdir(), 'capturas-movil');
  const good = path.join(dir, '1731000000000-0123abcd.jpg');
  assert.deepEqual(checkHostRequest('host.screenshot', { path: good }, { isDir: () => true }), { path: good });
  for (const p of [path.join(dir, 'x.jpg'), path.join(dir, '1-0123ABCD.jpg'), path.join(os.tmpdir(), '1-0123abcd.jpg'), path.join(dir, '..', '1-0123abcd.jpg'), 'relativa/1-0123abcd.jpg']) {
    assert.throws(() => checkHostRequest('host.screenshot', { path: p }, { isDir: () => true }), undefined, p);
  }
  assert.throws(() => checkHostRequest('host.screenshot', { path: good }, { isDir: () => false }));
});

test('the download vector is deterministic and opens only with its own AAD', () => {
  const run = () => execFileSync(process.execPath, [path.join(ROOT, 'scripts', 'link-vector-descarga.mjs')], { encoding: 'utf8' });
  const out = run(); assert.equal(run(), out);
  const { binary, negatives } = JSON.parse(out);
  const key = new Uint8Array(Buffer.from(binary.key, 'hex')); const bytes = new Uint8Array(Buffer.from(binary.bytes, 'hex'));
  assert.equal(binary.aad, C.AAD.download(binary.deviceId, binary.name));
  assert.equal(Buffer.from(C.openBytes(key, bytes, binary.aad)).toString('hex'), binary.plaintext);
  assert.equal(binary.bytes.slice(0, 48), binary.nonce);
  assert.ok(negatives.length >= 2);
  for (const n of negatives) { assert.equal(n.throws, true); assert.throws(() => C.openBytes(key, bytes, n.aad)); }
});

test('the UI passes the notice flag on and notify() skips the repeat filter for it', () => {
  const read = (...p) => fs.readFileSync(path.join(ROOT, ...p), 'utf8');
  assert.match(read('src', 'ui', 'app', 'engine-events.js'), /always: payload\.always === true/);
  assert.match(read('src', 'ui', 'lib', 'notify.js'), /n\.always === true \? null : notices\.find/);
});
