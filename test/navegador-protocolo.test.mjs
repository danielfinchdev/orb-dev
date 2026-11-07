// 3.7 (WS5): the agents' browser speaks one pipe protocol. The suite runs against the app's browser code (its Electron
// driver, src/main/browser-driver.mjs, over a stand-in webContents driving the local Edge or Chromium, headless). Secret
// fields never leave the page.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import net from 'node:net';
import http from 'node:http';
import { browserKey } from '../src/core/browser-key.mjs';
import { createActions, servePipe, KEYS, dialogsHook } from '../src/core/browser-protocol.mjs';
import { electronDriver } from '../src/main/browser-driver.mjs';
import { translate } from '../src/core/i18n.mjs';

// A local Chromium to drive: Edge on Windows, Chrome or Chromium elsewhere (the suite is skipped without one).
const EXE = [
  process.env.ORB_TEST_CHROMIUM,
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', 'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  '/opt/pw-browsers/chromium/chrome-linux/chrome', '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  '/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/google-chrome', '/usr/bin/microsoft-edge'
].find((f) => f && fs.existsSync(f));
const skip = EXE ? false : 'no hay Chromium ni Edge en este equipo';
const T = (key, vars) => translate('es', key, vars);
const SECRET = 'SuperSecreto123';

// The test site: a sign-in form (the page copies the password into its own text, and can show it), a confirm(), a
// console error, a second page that asks for a code and one with a CAPTCHA.
let site; let base;
const PAGES = {
  '/': `<!doctype html><title>Login</title><h1>Hola</h1>
    <input id=u name=user placeholder=Usuario><input id=p type=password placeholder=Clave>
    <button id=show onclick="p.type = p.type === 'password' ? 'text' : 'password'">Mostrar</button>
    <button id=ask onclick="out.textContent = 'respuesta ' + confirm('¿Seguro?')">Confirmar</button>
    <a href="/dos">Siguiente</a><div id=echo></div><div id=out></div>
    <script>p.addEventListener('input', () => { echo.textContent = 'eco ' + p.value; }); console.error('fallo de prueba');</script>`,
  '/dos': '<!doctype html><title>Dos</title><p>segunda página</p><input name=otp autocomplete=one-time-code placeholder=Código>',
  '/favicon.ico': ''
};
before(async () => {
  site = http.createServer((req, res) => { const body = PAGES[new URL(req.url, 'http://x').pathname]; res.writeHead(body != null ? 200 : 404, { 'content-type': 'text/html; charset=utf-8' }); res.end(body ?? 'no'); });
  await new Promise((r) => site.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${site.address().port}`;
});
after(() => site?.close());

// An agent's connection to the pipe: hello with the key of its conversation, then one request per line.
async function connect(pipe, token, who = { agent: 'claude', session: 'conv-1', task: '' }, key = null) {
  const socket = net.connect(pipe); socket.setEncoding('utf8');
  let buf = ''; let n = 0; const waiting = new Map(); let hello = null;
  const closed = new Promise((r) => socket.on('close', r));
  socket.on('data', (c) => { buf += c; let nl; while ((nl = buf.indexOf('\n')) >= 0) { const m = JSON.parse(buf.slice(0, nl)); buf = buf.slice(nl + 1); if (hello) { hello(m); hello = null; } else waiting.get(m.id)?.(m); } });
  socket.on('error', () => {});
  const helloReply = new Promise((r) => { hello = r; });
  await new Promise((r) => socket.on('connect', r));
  socket.write(`${JSON.stringify({ hello: key ?? browserKey(token, who), ...who })}\n`);
  const first = await Promise.race([helloReply, closed.then(() => null)]);
  return {
    ok: Boolean(first?.ok), closed,
    act: (action, args = {}) => new Promise((resolve) => { const id = ++n; waiting.set(id, resolve); socket.write(`${JSON.stringify({ id, action, args })}\n`); }),
    end: () => socket.end()
  };
}

// ---- the app's browser, with its own driver over a stand-in for Electron's webContents (a page of the local Chromium).
async function stubWebContents(page, context) {
  const cdp = await context.newCDPSession(page);
  await cdp.send('Page.enable');
  const main = (await cdp.send('Page.getFrameTree')).frameTree.frame.id;
  let ctxId = null; let loading = false; let history = 0; let chain = Promise.resolve();
  cdp.on('Page.frameNavigated', (e) => { if (!e.frame.parentId) { ctxId = null; history++; } });
  cdp.on('Page.frameStartedLoading', (e) => { if (e.frameId === main) loading = true; });
  cdp.on('Page.frameStoppedLoading', (e) => { if (e.frameId === main) loading = false; });
  const queue = (fn) => { chain = chain.then(fn).catch(() => {}); return chain; };
  const byElectron = Object.fromEntries(Object.values(KEYS).map((d) => [d.electron, d]));
  return {
    async executeJavaScriptInIsolatedWorld(_world, [{ code }]) {
      await chain;
      for (let i = 0; ; i++) {
        try {
          if (!ctxId) ctxId = (await cdp.send('Page.createIsolatedWorld', { frameId: main, worldName: 'electron-1717' })).executionContextId;
          const r = await cdp.send('Runtime.evaluate', { expression: code, contextId: ctxId, returnByValue: true, awaitPromise: true });
          if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? 'error');
          return r.result.value;
        } catch (error) { if (i >= 2 || !/context/i.test(error.message)) throw error; ctxId = null; }
      }
    },
    executeJavaScript: (code) => page.evaluate(code),
    loadURL: (url) => page.goto(url, { waitUntil: 'load' }).then(() => {}),
    isLoading: () => loading,
    sendInputEvent(ev) {
      queue(async () => {
        if (ev.type.startsWith('mouse')) await cdp.send('Input.dispatchMouseEvent', { type: { mouseMove: 'mouseMoved', mouseDown: 'mousePressed', mouseUp: 'mouseReleased' }[ev.type], x: ev.x, y: ev.y, button: ev.button ?? 'none', clickCount: ev.clickCount ?? 0 });
        else if (ev.type === 'char') await cdp.send('Input.dispatchKeyEvent', { type: 'char', text: ev.keyCode });
        else { const d = byElectron[ev.keyCode]; await cdp.send('Input.dispatchKeyEvent', { type: ev.type === 'keyDown' ? 'rawKeyDown' : 'keyUp', key: d.key, code: d.code, windowsVirtualKeyCode: d.vk }); }
      });
    },
    focus() {},
    insertText: (text) => queue(() => page.keyboard.insertText(text)),
    navigationHistory: { canGoBack: () => history > 1, goBack: () => { history -= 2; page.goBack().catch(() => {}); } },
    capturePage: async () => { await chain; const jpg = await page.screenshot({ type: 'jpeg', quality: 70 }); return { resize: () => ({ toJPEG: () => jpg }) }; },
    getURL: () => page.url(),
    startPainting() {}, stopPainting() {}, invalidate() {},
    forcefullyCrashRenderer: () => { page.close().catch(() => {}); }
  };
}
async function electronHarness() {
  const { chromium } = await import('playwright-core');
  const browser = await chromium.launch({ executablePath: EXE, headless: true });
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const token = 'e'.repeat(48);
  const tabs = new Map();
  const actions = createActions({ driver: electronDriver(T), T });
  async function create(key, who) {
    const page = await context.newPage();
    const wc = await stubWebContents(page, context);
    const tab = { key, ...who, win: { webContents: wc, isDestroyed: () => page.isClosed() }, users: 0, painting: true, console: [], dialogAnswer: { accept: false, text: '' } };
    page.on('console', (m) => { if (m.type() === 'error') tab.console.push({ level: 'error', message: m.text(), source: '', line: 0 }); });
    // Electron puts its alert/confirm/prompt in place on every page (dom-ready): the same here.
    page.on('domcontentloaded', () => { wc.executeJavaScript(dialogsHook(tab.dialogAnswer)).catch(() => {}); });
    tabs.set(key, tab);
    return tab;
  }
  const served = servePipe({ token, T, actions, pages: { get: (k) => tabs.get(k), dead: (t) => t.win.isDestroyed(), create, close: (t) => { tabs.delete(t.key); t.win.webContents.forcefullyCrashRenderer(); } } });
  await served.ready;
  return { pipe: served.pipe, token, profileDir: null, async close() { served.close(); await browser.close(); } };
}

async function suite(t, browser) {
  // A key for another conversation (or none) is cut off before any action.
  const forged = await connect(browser.pipe, browser.token, { agent: 'claude', session: 'conv-1', task: '' }, 'f'.repeat(64));
  assert.equal(forged.ok, false, 'clave falsa: conexión cortada');
  const c = await connect(browser.pipe, browser.token);
  assert.equal(c.ok, true);
  try {
    assert.match((await c.act('snapshot')).error, /no hay ninguna página abierta/);
    let r = await c.act('open', { url: `${base}/` });
    assert.equal(r.ok, true, r.error);
    assert.match(r.result, /Página: Login/);
    assert.match(r.result, /\[2\] input:password "Clave"/);
    assert.match(r.result, /La consola tiene 1 error/);

    r = await c.act('type', { ref: 1, text: 'ana@example.com' });
    assert.match(r.result, /\[1\] input:text "ana@example.com"/, 'un campo normal sí se ve');
    r = await c.act('type', { ref: 2, text: SECRET });
    assert.ok(!r.result.includes(SECRET), 'la contraseña nunca sale');
    assert.match(r.result, /input:password "Clave" \(relleno, oculto\)/);
    assert.match(r.result, /eco ••••/, 'ni copiada por la página en su texto');
    // «Mostrar contraseña»: the field becomes plain text, and is still secret in this page.
    r = await c.act('click', { ref: 3 });
    assert.ok(!r.result.includes(SECRET), 'tampoco al mostrarla');
    assert.match(r.result, /input:text "Clave" \(relleno, oculto\)/);
    // The screenshot blacks out those fields.
    r = await c.act('screenshot');
    assert.equal(r.ok, true, r.error);
    assert.ok(r.result.image.startsWith('/9j/'), 'una JPEG');
    assert.match(r.result.text, /tapados/);

    // The page's confirm(), answered as the agent said.
    r = await c.act('dialog', { accept: true });
    assert.match(r.result, /se aceptan/);
    r = await c.act('click', { ref: 4 });
    assert.match(r.result, /confirm\("¿Seguro\?"\) → aceptado/);
    assert.match(r.result, /respuesta true/);
    r = await c.act('console', {});
    assert.match(r.result, /fallo de prueba/);
    for (const key of ['Tab', 'ArrowDown', 'Space']) assert.equal((await c.act('press', { key })).ok, true, key);
    assert.match((await c.act('press', { key: 'F5' })).error, /tecla no permitida/);
    assert.equal((await c.act('scroll', { direction: 'down', amount: 100 })).ok, true);
    assert.equal((await c.act('wait', { text: 'Hola', ms: 2000 })).ok, true);

    // Another page, then back to the form.
    r = await c.act('open', { url: `${base}/dos` });
    assert.match(r.result, /Página: Dos/);
    r = await c.act('back');
    assert.equal(r.ok, true, r.error);
    assert.match(r.result, /Página: Login/);

    assert.match((await c.act('volar')).error, /acción no válida/);
    assert.match((await c.act('close')).result, /Navegador cerrado/);
    assert.match((await c.act('close')).result, /No había navegador abierto/);
  } finally { c.end(); }
}

test('navegador de la app (driver de Electron): el protocolo de las herramientas y los secretos', { skip }, async (t) => {
  const b = await electronHarness();
  try { await suite(t, b); } finally { await b.close(); }
});

