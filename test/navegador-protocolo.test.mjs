// 3.7 (WS5): the agents' browser speaks one pipe protocol. 3.8.1 (D2, D7): the suite runs against the engine's browser
// with its DevTools driver (src/engine/host-browser.mjs, agent-browser.mjs, browser-cdp.mjs), with a stand-in for the
// app's side (Rust's browser.rs) over pages of the local Edge, headless.
// Secret fields never leave the page.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import http from 'node:http';
import { browserKey } from '../src/core/browser-key.mjs';
import { createActions, servePipe, KEYS, dialogsHook } from '../src/core/browser-protocol.mjs';
import { createHostBrowser } from '../src/engine/host-browser.mjs';
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

// ---- 3.8.1 (D2, D7): the engine's browser as under Tauri (src/engine/host-browser.mjs). The app's side, which Rust does
// with hidden WebView2 windows (src-tauri/src/browser.rs), is played here by pages of a headless Edge: the same host.*
// calls and browserEvent messages, the DevTools events Rust listens to, and Orb's own events. Rust refuses a new window
// before it exists; Edge cannot, so this stand-in closes it as soon as it appears and counts it: the test checks that the
// agent's page is the only page left (a leak fails it). The refusals themselves are checked against the real WebView2 in
// test/tauri-navegador.e2e.mjs.
const EVENTS = ['Page.frameNavigated', 'Page.navigatedWithinDocument', 'Page.frameStartedLoading', 'Page.frameStoppedLoading', 'Page.loadEventFired', 'Page.javascriptDialogOpening', 'Page.screencastFrame', 'Runtime.executionContextsCleared', 'Runtime.executionContextDestroyed', 'Runtime.consoleAPICalled', 'Runtime.exceptionThrown', 'Log.entryAdded', 'Inspector.targetCrashed', 'Inspector.detached'];
async function hostHarness({ frameMs = 0, ...opts } = {}) {
  const { chromium } = await import('playwright-core');
  const pw = await chromium.launch({ executablePath: EXE, headless: true });
  const context = await pw.newContext({ viewport: { width: 1280, height: 800 } });
  const pages = new Map(); let next = 0; const popups = []; const pip = []; const frames = { inFlight: 0, maxInFlight: 0, delivered: 0, received: 0 };
  let hb = null;
  const event = (page, method, params) => hb?.event({ type: 'browserEvent', page, method, params });
  async function call(method, params = {}) {
    if (method === 'host.browser.open') {
      const id = ++next; const page = await context.newPage(); const cdp = await context.newCDPSession(page);
      pages.set(id, { page, cdp });
      for (const name of EVENTS) cdp.on(name, (p) => { if (name === 'Page.screencastFrame') frames.received++; event(id, name, p); });
      page.on('popup', async (p) => {
        popups.push(p);
        await p.waitForURL((u) => u.href !== 'about:blank', { timeout: 5000 }).catch(() => {});
        const url = p.url(); await p.close().catch(() => {});
        event(id, 'Orb.popup', { url });
      });
      page.on('load', async () => { event(id, 'Orb.title', { title: await page.title().catch(() => '') }); });
      return { page: id };
    }
    if (method === 'host.browser.cdp') return pages.get(params.page).cdp.send(params.method, params.params);
    if (method === 'host.browser.close') { const p = pages.get(params.page); pages.delete(params.page); await p?.page.close().catch(() => {}); return true; }
    if (method === 'host.pip.frame') {
      frames.inFlight++; frames.maxInFlight = Math.max(frames.maxInFlight, frames.inFlight);
      await wait(frameMs); frames.inFlight--; frames.delivered++; return true;
    }
    if (method.startsWith('host.pip.')) { pip.push([method, params.mode ?? params.state?.agent ?? null]); return true; }
    throw new Error(`host: ${method} desconocido`);
  }
  hb = createHostBrowser({ call, label: (a) => ({ claude: 'Claude', codex: 'Codex' })[a] ?? a, ...opts });
  await hb.ready;
  const pageCount = () => context.pages().filter((p) => !p.isClosed()).length;
  return { pipe: hb.pipe, token: hb.token, hb, pages, popups, pip, frames, pageCount, async close() { hb.shutdown(); await pw.close(); } };
}

test('navegador del motor (como en Tauri): el mismo protocolo y los mismos secretos', { skip }, async (t) => {
  const h = await hostHarness();
  try {
    await suite(t, h);
    assert.ok(h.pip.some(([m, a]) => m === 'host.pip.show' && a === 'normal'), 'la ventanita aparece al abrir una página');
    assert.ok(h.pip.some(([m, a]) => m === 'host.pip.state' && a === 'Claude'), 'con el nombre del agente');
    assert.equal(h.hb.state().tabs.length, 0, 'close: sin páginas');
    await until(() => h.pageCount() === 0, 'la página se cerró de verdad', 5000);
  } finally { await h.close(); }
});

test('navegador del motor: una ventana emergente abre en la misma página y no queda ninguna otra', { skip }, async () => {
  const h = await hostHarness();
  try {
    const c = await connect(h.pipe, h.token, { agent: 'codex', session: 'conv-2', task: '7' });
    let r = await c.act('open', { url: `${base}/popup` });
    assert.equal(r.ok, true, r.error);
    r = await c.act('click', { ref: 1 });
    await until(async () => (await c.act('snapshot')).result?.includes('Página: Dos'), 'la ventana emergente abre en la misma página', 10000);
    assert.equal(h.popups.length, 1, 'la página pidió una ventana');
    await until(() => h.pageCount() === 1, 'ninguna otra página abierta', 5000);
    await wait(500);
    assert.equal(h.pageCount(), 1, 'una sola página: la del agente');
    assert.ok(h.popups.every((p) => p.isClosed()), 'ninguna ventana emergente viva');
    assert.deepEqual(h.hb.state().tabs.map((x) => [x.agent, x.task]), [['codex', '7']]);
    // What the app refuses reaches the agent as console errors: a download, an address that is not a web page.
    const [id] = h.pages.keys();
    h.hb.event({ page: id, method: 'Orb.blocked', params: { kind: 'download', url: `${base}/archivo.zip` } });
    h.hb.event({ page: id, method: 'Orb.popup', params: { url: 'file:///C:/Windows/win.ini' } });
    r = await c.act('console', {});
    assert.match(r.result, /refused a download.*archivo\.zip/s);
    assert.match(r.result, /not http\(s\).*win\.ini/s);
    assert.match((await c.act('snapshot')).result, /Página: Dos/, 'la dirección file: no se abrió');
    // A task that ends closes its pages.
    h.hb.closeTask('7');
    await until(() => h.pageCount() === 0, 'página cerrada al terminar la tarea', 5000);
    c.end();
  } finally { await h.close(); }
});

test('navegador del motor: la ventanita recibe los fotogramas de uno en uno aunque la app vaya lenta', { skip }, async () => {
  const h = await hostHarness({ frameMs: 600 });
  PAGES['/anima'] = '<!doctype html><title>Anima</title><div id=b style="width:300px;height:300px;background:red"></div><script>let i=0;setInterval(()=>{b.style.background="hsl("+(i++*20)+",80%,50%)";b.textContent=i},16)</script>';
  try {
    const c = await connect(h.pipe, h.token);
    assert.equal((await c.act('open', { url: `${base}/anima` })).ok, true);
    await until(() => h.frames.delivered >= 3, 'fotogramas en la ventanita', 15000);
    await wait(1500);
    assert.equal(h.frames.maxInFlight, 1, 'nunca dos fotogramas a la vez hacia la app');
    // The page keeps at most two frames unacknowledged (a page animating at 60 fps would send ~300 in this time).
    await wait(4000);
    assert.ok(h.frames.received <= h.frames.delivered * 3 + 4, `recibidos ${h.frames.received}, entregados ${h.frames.delivered}`);
    // As a pill, no pictures.
    h.hb.pip('pildora');
    await wait(800);
    const at = h.frames.delivered; await wait(1500);
    assert.ok(h.frames.delivered <= at + 1, 'en píldora no hay fotogramas');
    c.end();
  } finally { delete PAGES['/anima']; await h.close(); }
});

// 3.8.2 (T3 3.11): «Señalar elemento» and the recording, from the little window's buttons.
test('navegador del motor: señalar un elemento y grabar lo que hace el agente', { skip }, async () => {
  const pointed = []; const saved = [];
  const h = await hostHarness({ onPointed: (p) => pointed.push(p), saveRecording: async (session, avi) => { saved.push({ session, avi }); return 'x.avi'; } });
  PAGES['/boton'] = '<!doctype html><title>Botón</title><body style="margin:0"><button id="enviar" style="position:absolute;left:600px;top:380px;width:120px;height:40px">Enviar pedido</button><p id="enviar2">otro</p><script>let i=0;setInterval(()=>{document.title="t"+(i++)},50)</script>';
  try {
    const c = await connect(h.pipe, h.token, { agent: 'claude', session: 'conv-9', task: '' });
    assert.equal((await c.act('open', { url: `${base}/boton` })).ok, true);
    h.hb.pip('grabar');
    assert.equal(h.hb.pip('point', { x: 660 / 1280, y: 400 / 800 }).pip, true);
    await until(() => pointed.length === 1, 'el elemento señalado', 10000);
    const [p] = pointed;
    assert.equal(p.session, 'conv-9', 'la conversación es la de la página, no algo que diga la página');
    assert.equal(p.selector, '#enviar'); assert.equal(p.tag, 'button'); assert.equal(p.text, 'Enviar pedido');
    assert.equal(p.png.readUInt32BE(0), 0x89504e47, 'una imagen PNG');
    assert.ok(p.png.readUInt32BE(16) <= 160 && p.png.readUInt32BE(20) <= 80, 'solo el elemento y un margen');
    h.hb.pip('point', { x: 2, y: 0.5 }); // outside the picture: nothing
    await c.act('scroll', { direction: 'down' });
    await wait(1500);
    h.hb.pip('parar');
    await until(() => saved.length === 1, 'la grabación guardada', 10000);
    const avi = saved[0].avi;
    assert.equal(saved[0].session, 'conv-9');
    assert.equal(avi.toString('latin1', 0, 4), 'RIFF'); assert.equal(avi.toString('latin1', 8, 12), 'AVI ');
    assert.ok(avi.includes(Buffer.from('MJPG')) && avi.includes(Buffer.from('idx1')));
    assert.equal(pointed.length, 1);
    c.end();
  } finally { delete PAGES['/boton']; await h.close(); }
});

test('navegador del motor: sin puerto de depuración; el navegador de Tauri solo se maneja por el canal del motor', () => {
  // The engine has no DevTools client of its own, and Rust starts the agents' browser without a DevTools port.
  const dir = new URL('../src/engine/', import.meta.url);
  const engine = fs.readdirSync(dir).filter((f) => f.endsWith('.mjs')).map((f) => fs.readFileSync(new URL(f, dir), 'utf8')).join('\n');
  assert.doesNotMatch(engine, /new WebSocket\(|DevToolsActivePort|remote-debugging/);
  const rust = fs.readFileSync(new URL('../src-tauri/src/browser.rs', import.meta.url), 'utf8');
  assert.match(rust, /CallDevToolsProtocolMethod/);
  assert.doesNotMatch(rust, /remote-debugging/);
});
