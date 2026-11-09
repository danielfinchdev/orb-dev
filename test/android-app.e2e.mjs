// 3.8.1: the Android app's page (the Tauri app's frontend, `vite build --mode android` → src/renderer-android) in a headless
// browser at phone size, served at the app's own origin (http://tauri.localhost) with Tauri's IPC and the Kotlin plugin
// «orb-native» played by a stand-in (what the real one answers, kept in this page's storage). Against a real engine with
// fake agents on loopback:
//   - linking from the scanned QR with the PC's master password (CORS from http://tauri.localhost; keys in the «Keystore»),
//   - opening linked after a restart (the keys read back), «Compartir con Orb» on start,
//   - Android's back (Tauri's «back-button»): a chat → Chats → «Pulsa otra vez» → to the background,
//   - a chat's notification while the app is in the background, with the call its «Responder» makes by itself; that call
//     sent as the app's NoteReceiver sends it (no Origin, sealed with the phone's keys) reaches the chat,
//   - a notification that opened the app goes to its chat.
// Screenshots in test-results/android-app-*.png. No window is opened (headless).
// Run: node test/android-app.e2e.mjs (it builds the page first).
import { chromium } from 'playwright-core';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fork, spawnSync } from 'node:child_process';
import { tempHome, ROOT, until } from './helpers.mjs';
import { TEST_MASTER } from './fixtures/e2e-flows.mjs';
import * as C from '../src/shared/mobile-crypto.mjs';

const OUT = path.join(ROOT, 'test-results'); fs.mkdirSync(OUT, { recursive: true });
const WWW = path.join(ROOT, 'src', 'renderer-android');
const built = spawnSync(process.execPath, [path.join(ROOT, 'scripts', 'android-web.mjs')], { cwd: ROOT, stdio: 'inherit', windowsHide: true });
assert.equal(built.status, 0, 'vite build --mode android');
const html = fs.readFileSync(path.join(WWW, 'index.html'), 'utf8');
assert.match(html, /connect-src 'self' ipc: http: https:;/, 'the page may reach the PC');

const port = 20000 + Math.floor(Math.random() * 20000);
const t = tempHome({ mobile: { enabled: true, port } });
const engine = fork(path.join(ROOT, 'src', 'engine', 'engine.mjs'), [], { stdio: ['ignore', 'inherit', 'inherit', 'ipc'], env: { ...process.env, ORB_REMOTE_BIND: '127.0.0.1' } });
let n = 0; const pending = new Map();
engine.on('message', (m) => { if (m.type === 'reply') { const p = pending.get(m.id); pending.delete(m.id); m.ok ? p.resolve(m.result) : p.reject(new Error(m.error)); } });
const call = (method, params = {}) => new Promise((resolve, reject) => { const id = ++n; pending.set(id, { resolve, reject }); engine.send({ type: 'call', id, method, params }); });
await new Promise((resolve, reject) => { engine.once('message', (m) => (m.type === 'started' && m.ok ? resolve() : reject(new Error(m.error)))); engine.send({ type: 'start', home: t.home, version: 'test' }); });
await until(async () => (await call('remote.status')).running, 'servidor del móvil');
await call('master.create', { password: TEST_MASTER });

// Tauri's IPC and the plugin «orb-native», as the app has them: invoke('plugin:orb-native|…'), channels for its events.
const stand = () => {
  const saved = (k, v) => { const all = JSON.parse(localStorage.getItem('__native') || '{}'); if (v === undefined) return all[k]; if (v === null) delete all[k]; else all[k] = v; localStorage.setItem('__native', JSON.stringify(all)); return v; };
  const callbacks = new Map(); let seq = 0;
  const listeners = {}; // 'plugin/event' → [{ id, index }]
  const log = [];
  window.__native = {
    log,
    // What Android does: an event of a plugin (back, a share, a notification that opened the app).
    emit(plugin, event, payload) { for (const h of listeners[`${plugin}/${event}`] ?? []) callbacks.get(h.id)?.({ index: h.index++, message: payload }); return (listeners[`${plugin}/${event}`] ?? []).length; },
    next: {} // what the next take_shared / take_note_action / scan_qr gives
  };
  let hidden = false;
  window.__native.hide = (v) => { hidden = v; document.dispatchEvent(new Event('visibilitychange')); };
  Object.defineProperty(document, 'visibilityState', { get: () => (hidden ? 'hidden' : 'visible'), configurable: true });
  window.__TAURI_INTERNALS__ = {
    metadata: { currentWindow: { label: 'main' }, currentWebview: { windowLabel: 'main', label: 'main' } },
    transformCallback(cb, once) { const id = ++seq; callbacks.set(id, (m) => { if (once) callbacks.delete(id); cb(m); }); return id; },
    unregisterCallback(id) { callbacks.delete(id); },
    convertFileSrc: (p) => p,
    async invoke(cmd, args = {}) {
      const m = /^plugin:([^|]+)\|(.+)$/.exec(cmd);
      if (!m) throw new Error(`no command ${cmd}`);
      const [, plugin, command] = m;
      log.push({ plugin, command, args: JSON.parse(JSON.stringify(args, (k, v) => (v && typeof v === 'object' && 'id' in v && typeof v.toJSON === 'function' ? `channel:${v.id}` : v))) });
      if (command === 'register_listener') { (listeners[`${plugin}/${args.event}`] ??= []).push({ id: args.handler.id, index: 0 }); return null; }
      if (command === 'remove_listener') { listeners[`${plugin}/${args.event}`] = (listeners[`${plugin}/${args.event}`] ?? []).filter((h) => h.id !== args.channelId); return null; }
      if (plugin !== 'orb-native') throw new Error(`no plugin ${plugin}`);
      const take = (k) => { const v = window.__native.next[k]; delete window.__native.next[k]; return v ?? {}; };
      switch (command) {
        case 'secure_get': { const v = saved(args.key); return v == null ? {} : { value: v }; }
        case 'secure_set': saved(args.key, args.value); return null;
        case 'secure_remove': saved(args.key, null); return null;
        case 'info': return { model: 'Pixel 9' };
        case 'minimize': return null;
        case 'take_shared': return take('shared');
        case 'take_note_action': return take('note');
        case 'scan_qr': return take('qr');
        case 'dictate': return { text: 'dictado' };
        case 'notify': case 'notify_clear': return null;
        case 'notify_permission': return { granted: true };
        default: throw new Error(`orb-native has no ${command}`);
      }
    }
  };
};

const exe = ['/opt/pw-browsers/chromium/chrome-linux/chrome', '/opt/pw-browsers/chromium-1194/chrome-linux/chrome'].find((f) => fs.existsSync(f));
// The page is routed here (no real address), so desktop Chrome/Edge would take it for a public site reaching loopback
// (Local Network Access); Android's WebView of the app does not ask. Off for this test.
const args = ['--disable-features=LocalNetworkAccessChecks,PrivateNetworkAccessSendPreflights,PrivateNetworkAccessRespectPreflightResults'];
const browser = await chromium.launch(exe ? { executablePath: exe, args: ['--no-sandbox', ...args] } : { channel: process.platform === 'win32' ? 'msedge' : 'chrome', args });
const ctxt = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, locale: 'es-ES' });
await ctxt.addInitScript(stand);
// The app's own origin, served from the built page (Tauri serves it from inside the APK).
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.json': 'application/json', '.webmanifest': 'application/manifest+json' };
await ctxt.route('http://tauri.localhost/**', (route) => {
  const rel = decodeURIComponent(new URL(route.request().url()).pathname).replace(/^\/+/, '') || 'index.html';
  const file = path.join(WWW, rel);
  if (!file.startsWith(WWW) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) return route.fulfill({ status: 404, body: '' });
  return route.fulfill({ status: 200, contentType: TYPES[path.extname(file)] ?? 'application/octet-stream', body: fs.readFileSync(file) });
});
const page = await ctxt.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => { if (m.type() === 'error' && !/status of (403|409)/.test(m.text())) errors.push(m.text()); });
const shot = (name) => page.screenshot({ path: path.join(OUT, `android-app-${name}.png`) });
const log = () => page.evaluate(() => window.__native.log);
let step = 'inicio';
try {
  step = 'enlazar';
  await page.goto('http://tauri.localhost/index.html');
  await page.waitForSelector('[data-testid=app-link-scan]', { timeout: 30000 });
  const { url, pc } = await call('remote.pair');
  await page.evaluate((qr) => { window.__native.next.qr = { value: qr }; }, url);
  await page.click('[data-testid=app-link-scan]');
  await page.waitForSelector('[data-testid=pair-fp]');
  assert.ok((await page.textContent('[data-testid=pair-fp]')).includes(pc), 'the PC\'s fingerprint, worked out on the phone');
  await shot('00-contrasena');
  await page.fill('[data-testid=pair-password-input]', TEST_MASTER);
  await page.keyboard.press('Enter');
  await page.waitForSelector('[data-testid=orb-inbox]', { timeout: 30000 });
  const devices = await call('link.devices');
  assert.equal(devices.length, 1); assert.equal(devices[0].name, 'Pixel 9 (app)');
  const stored = await page.evaluate(() => JSON.parse(JSON.parse(localStorage.getItem('__native'))['orb.movil']));
  assert.ok(stored.id && stored.priv && stored.pc && stored.urls?.[0]?.startsWith('http://127.0.0.1:'), 'the keys and the PC\'s addresses in the Keystore');
  assert.ok(!(await page.evaluate(() => localStorage.getItem('orb.movil'))), 'never in the page\'s own storage');
  await shot('01-chats');

  step = 'reabrir y compartir';
  await page.evaluate(() => localStorage.setItem('__next_shared', '1'));
  await ctxt.addInitScript(() => { if (localStorage.getItem('__next_shared') === '1') { localStorage.removeItem('__next_shared'); window.__native.next.shared = { text: 'Mira esto https://example.org' }; } });
  await page.reload();
  // Linked still (the keys read back) and straight to a chat with what was shared.
  await page.waitForSelector('[data-testid=chat-input]', { timeout: 30000 });
  assert.match(await page.inputValue('[data-testid=chat-input]'), /Mira esto https:\/\/example\.org/, 'what was shared waits in the chat');
  await shot('02-compartido');
  await page.fill('[data-testid=chat-input]', 'Hola desde la app');
  await page.keyboard.press('Enter');
  await page.waitForSelector('text=Recibido: ', { timeout: 30000 });

  step = 'atrás';
  assert.ok(await page.evaluate(() => window.__native.emit('app', 'back-button', { canGoBack: false })) >= 1, 'the page listens to Android\'s back');
  await page.waitForSelector('[data-testid=orb-inbox]');
  await page.evaluate(() => window.__native.emit('app', 'back-button', { canGoBack: false }));
  await page.waitForSelector('text=Pulsa otra vez para salir', { timeout: 5000 });
  await page.evaluate(() => window.__native.emit('app', 'back-button', { canGoBack: false }));
  await until(async () => (await log()).some((x) => x.command === 'minimize'), 'a segundo plano', 5000);

  step = 'aviso';
  const conv = (await call('conversations.list')).sort((a, b) => b.id - a.id)[0];
  assert.ok(conv?.id, 'the chat the app wrote in');
  await page.evaluate(() => { localStorage.setItem('orb.avisos', '1'); window.__native.hide(true); });
  const before = (await log()).length;
  await call('chat.send', { text: 'Otra cosa desde el PC', conversation: conv.id });
  await until(async () => (await log()).slice(before).some((x) => x.command === 'notify'), 'el aviso', 30000);
  const note = (await log()).slice(before).find((x) => x.command === 'notify').args;
  assert.equal(note.largeIcon, 'av_orb');
  assert.ok(note.id >= 20000 && note.id < 30000);
  assert.equal(note.group, `orb-conversation:${conv.id}`);
  const reply = note.actions.find((a) => a.id === 'reply');
  assert.deepEqual(reply.call, { method: 'chat.send', params: { conversation: conv.id }, text: 'text' });
  assert.equal(reply.input, true);
  for (const k of ['sending', 'sent', 'failed', 'err_offline']) assert.ok(note.words[k], k);
  assert.match(note.words.failed, /\{error\}/);
  // NoteReceiver: the same call, sealed with the phone's keys, without Origin (a native request), as PcCall.kt sends it.
  const key = C.sessionKey(C.b64.dec(stored.priv), C.b64.dec(stored.pc));
  const box = C.seal(key, { t: Date.now(), m: 'call', b: { method: reply.call.method, params: { ...reply.call.params, [reply.call.text]: 'Respuesta desde el aviso' } } }, C.AAD.request(stored.id));
  const res = await fetch(`${stored.urls[0]}/api/call`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Orb-Device': stored.id }, body: JSON.stringify(box) });
  assert.equal(res.status, 200);
  const msg = C.open(key, await res.json(), C.AAD.response(stored.id));
  assert.equal(msg.r, box.n); assert.equal(msg.ok, true);
  await until(async () => JSON.stringify(await call('chat.list', { conversation: conv.id })).includes('Respuesta desde el aviso'), 'la respuesta en el chat', 15000);

  step = 'abrir desde el aviso';
  await page.evaluate(() => window.__native.hide(false));
  await until(async () => (await log()).some((x) => x.command === 'notify_clear'), 'los avisos se quitan al volver', 5000);
  await page.evaluate(() => window.__native.emit('app', 'back-button', { canGoBack: false })); // leave «Pulsa otra vez»
  await page.evaluate((raw) => window.__native.emit('orb-native', 'note', { action: 'tap', note: raw }), note.note);
  await page.waitForSelector('[data-testid=chat-input]', { timeout: 10000 });
  await page.waitForSelector('text=Respuesta desde el aviso', { timeout: 10000 });
  await shot('03-desde-aviso');

  step = 'comandos';
  // Since the restart (linking already used scan_qr, info and secure_set above).
  const used = new Set((await log()).filter((x) => x.plugin === 'orb-native').map((x) => x.command));
  for (const c of ['secure_get', 'take_shared', 'take_note_action', 'notify', 'notify_clear', 'minimize', 'register_listener']) assert.ok(used.has(c), c);
  assert.deepEqual(errors, [], 'no errors in the page');
  console.log('android-app.e2e: OK');
} catch (e) {
  await shot(`fallo-${step.replace(/\s+/g, '-')}`).catch(() => {});
  console.error(`android-app.e2e falló en «${step}»:`, e);
  console.error('errores de la página:', errors);
  process.exitCode = 1;
} finally {
  await browser.close();
  engine.send({ type: 'shutdown' });
  setTimeout(() => { t.cleanup(); process.exit(); }, 1500);
}
