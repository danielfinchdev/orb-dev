// 3.7 (WS5): the agents' browser speaks one pipe protocol. The suite runs against the app's browser code (its Electron
// driver, src/main/browser-driver.mjs, over a stand-in webContents driving the local Edge or Chromium, headless) and,
// 3.8.1 (D2), against the engine's browser with its DevTools driver (src/engine/agent-browser.mjs, browser-cdp.mjs).
// Secret fields never leave the page.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import net from 'node:net';
import path from 'node:path';
import http from 'node:http';
import { spawn, execFileSync } from 'node:child_process';
import { browserKey } from '../src/core/browser-key.mjs';
import { createActions, servePipe, KEYS, dialogsHook } from '../src/core/browser-protocol.mjs';
import { electronDriver } from '../src/main/browser-driver.mjs';
import { createCdpBrowser } from '../src/engine/agent-browser.mjs';
import { connectCdp, readDevToolsActivePort } from '../src/engine/cdp.mjs';
import { translate } from '../src/core/i18n.mjs';

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (fn, what, ms = 15000) => { const end = Date.now() + ms; while (Date.now() < end) { try { const v = await fn(); if (v) return v; } catch { /* not yet */ } await wait(100); } throw new Error(`timeout: ${what}`); };

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
  '/popup': '<!doctype html><title>Popup</title><a href="/dos" target="_blank">Abrir en otra ventana</a>',
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

// ---- 3.8.1 (D2): the engine's browser (src/engine/agent-browser.mjs) with its DevTools driver, over pages of the local
// Edge or Chromium started headless with a DevTools port on a throwaway profile, as the hidden WebView2 windows of Tauri
// will be. Without --remote-allow-origins: Node's WebSocket sends no Origin, so it gets in; a web page would not.
async function launchChromium() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'orb-test-cdp-'));
  const child = spawn(EXE, ['--headless=new', '--remote-debugging-port=0', `--user-data-dir=${dir}`, '--no-first-run', '--no-default-browser-check', '--disable-extensions', '--disable-sync', 'about:blank'], { stdio: 'ignore' });
  const active = await until(() => readDevToolsActivePort(dir), 'DevToolsActivePort', 20000);
  return {
    ...active,
    // Closed through its own DevTools (Edge may hand over to a process of another id, which a kill by id would miss).
    async close() {
      try { const c = await connectCdp(active.ws, { timeoutMs: 3000 }); await Promise.race([c.send('Browser.close').catch(() => {}), wait(3000)]); c.close(); } catch { /* already gone */ }
      try { if (process.platform === 'win32') execFileSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' }); else child.kill('SIGKILL'); } catch { /* gone */ }
      await wait(500); try { fs.rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }); } catch { /* temp */ }
    }
  };
}
async function cdpHarness() {
  const chromium = await launchChromium();
  const control = await connectCdp(chromium.ws); // the app's side: makes and closes the pages
  const opened = [];
  const windows = {
    endpoint: async () => chromium.ws,
    open: async () => { const { targetId } = await control.send('Target.createTarget', { url: 'about:blank' }); opened.push(targetId); return targetId; },
    close: (targetId) => control.send('Target.closeTarget', { targetId })
  };
  const activity = [];
  const b = createCdpBrowser({ windows, onActivity: (tab, action) => activity.push(`${tab.agent}:${action}`) });
  await b.ready;
  return { pipe: b.pipe, token: b.token, chromium, control, opened, activity, b, async close() { b.shutdown(); control.close(); await chromium.close(); } };
}

test('navegador del motor (driver CDP): el mismo protocolo y los mismos secretos', { skip }, async (t) => {
  const h = await cdpHarness();
  try {
    await suite(t, h);
    assert.ok(h.activity.includes('claude:open') && h.activity.includes('claude:screenshot'), h.activity.join(' '));
    assert.equal(h.b.state().tabs.length, 0, 'close: sin páginas');
    // A page that opens a popup: it opens in the same page, never another window.
    const c = await connect(h.pipe, h.token, { agent: 'codex', session: 'conv-2', task: '7' });
    let r = await c.act('open', { url: `${base}/popup` });
    assert.equal(r.ok, true, r.error);
    const pages = async () => (await h.control.send('Target.getTargets')).targetInfos.filter((i) => i.type === 'page' && h.opened.includes(i.targetId));
    r = await c.act('click', { ref: 1 });
    await until(async () => (await c.act('snapshot')).result?.includes('Página: Dos'), 'la ventana emergente abre en la misma página', 10000);
    assert.equal((await pages()).length, 1, 'una sola página del agente');
    assert.deepEqual(h.b.state().tabs.map((x) => [x.agent, x.task]), [['codex', '7']]);
    // A task that ends closes its pages.
    h.b.closeTask('7');
    await until(async () => (await pages()).length === 0, 'página cerrada al terminar la tarea', 5000);
    c.end();
  } finally { await h.close(); }
});

test('CDP: una conexión con Origin (una página web) no entra; la del motor, sin Origin, sí', { skip }, async () => {
  const chromium = await launchChromium();
  try {
    const ok = await connectCdp(chromium.ws);
    assert.ok((await ok.send('Browser.getVersion')).product);
    ok.close();
    const refused = await new Promise((resolve) => {
      const ws = new WebSocket(chromium.ws, { headers: { origin: 'https://ejemplo.com' } });
      ws.addEventListener('open', () => { ws.close(); resolve(false); });
      ws.addEventListener('error', () => resolve(true));
    });
    assert.equal(refused, true, 'una página web no puede manejar el navegador de los agentes');
    await assert.rejects(connectCdp('ws://192.168.1.10:9222/devtools/browser/x'), /solo este equipo/);
  } finally { await chromium.close(); }
});
