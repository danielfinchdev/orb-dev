// 3.7 (WS5): the Server's browser without a Chromium: the human pace per site, the warning before mass actions (also
// through the MCP server of a bot), the live view's flow control with a slow link, its input and idle stop, the memory
// check before launching, the queue and idle close, Xvfb missing, the systemd scope and Chromium's checked download.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline';
import { spawn } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { tempHome, ROOT } from './helpers.mjs';
import { createPace, createMassGuard, memoryStore, siteRules, isDestructive, actionKind, isLocalHost } from '../src/core/browser-limits.mjs';
import { parseSnapshot, formatSnapshot } from '../src/core/browser-protocol.mjs';
import { createScreencast, frameWidth } from '../src/server/screencast.mjs';
import { createServerBrowser, memAvailableMB, startXvfb, scopeWrapper, FLAGS } from '../src/server/browser.mjs';
import { downloadChromium, CHROMIUM, ensureChromium } from '../src/server/browser-engine.mjs';

test('ritmo humano por web: pausa de 2–5 s, 300 acciones por hora, reglas por sitio y nada en las páginas locales', () => {
  let t = 1_000_000; const store = memoryStore();
  const pace = createPace({ store, now: () => t, random: () => 0.5 });
  assert.deepEqual(pace.take('tienda.example'), { wait: 0 }, 'la primera, ya');
  assert.equal(pace.take('tienda.example').wait, 3500, 'la siguiente espera su pausa (2–5 s)');
  t += 10_000;
  assert.equal(pace.take('tienda.example').wait, 0);
  assert.equal(pace.take('otra.example').wait, 0, 'cada web lleva su cuenta');
  assert.equal(pace.take('localhost').wait, 0); assert.equal(pace.take('192.168.1.20').wait, 0); assert.ok(isLocalHost('127.0.0.1'));
  // The hour's budget: a burst, then one every 12 s (300 an hour); far ahead, refused with when to come back.
  const fast = createPace({ store: memoryStore(), now: () => t, random: () => 0, sites: () => ({ default: { minMs: 0, maxMs: 0, burst: 3, perHour: 300 } }) });
  for (let i = 0; i < 3; i++) assert.equal(fast.take('red.example').wait, 0);
  assert.equal(fast.take('red.example').wait, 12_000, 'sin fichas: espera la siguiente');
  const r = fast.take('red.example');
  assert.equal(r.refuse, true); assert.ok(r.retryMs > 20_000);
  // A site's own rule wins (and covers its subdomains).
  assert.deepEqual(siteRules({ default: { minMs: 1000 }, 'banco.example': { minMs: 8000, maxMs: 9000, perHour: 20 } }, 'www2.banco.example'), { minMs: 8000, maxMs: 9000, perHour: 20, burst: 30 });
  assert.deepEqual(siteRules({}, 'x.example'), { minMs: 2000, maxMs: 5000, perHour: 300, burst: 30 });
});

test('acciones masivas: tras 50 iguales y destructivas, una tarjeta; luego espera, sí o no', () => {
  let t = 0; const store = memoryStore(); const status = new Map();
  const g = createMassGuard({ store, who: 'bot:1', now: () => t, approval: { get: (id) => status.get(id) ?? null } });
  const del = (n) => `[${n}] button "Eliminar publicación ${n}"`;
  assert.ok(isDestructive(del(1)) && !isDestructive('[1] button "Comprar"') && !isDestructive('[2] a "Ver perfil"'));
  assert.equal(actionKind(del(3)), actionKind(del(48)), 'la misma acción aunque cambie el número');
  for (let i = 0; i < 50; i++) { assert.equal(g.check('social.example', del(i)).ok, true); g.done('social.example', del(i)); t += 1000; }
  assert.equal(g.check('social.example', '[9] button "Me gusta"').ok, true, 'lo que no destruye no cuenta');
  assert.equal(g.check('otra.example', del(1)).ok, true, 'otra web, otra cuenta');
  const need = g.check('social.example', del(51));
  assert.equal(need.needsOk, true); assert.equal(need.count, 50);
  g.asked('social.example', del(51), 77); status.set(77, 'waiting');
  assert.equal(g.check('social.example', del(52)).waiting, true);
  status.set(77, 'done');
  assert.equal(g.check('social.example', del(52)).ok, true, 'con el sí, sigue');
  status.set(77, 'denied');
  assert.equal(g.check('social.example', del(53)).denied, true);
  t += 2 * 60 * 60_000;
  assert.equal(g.check('social.example', del(54)).ok, true, 'pasada la hora, cuenta de nuevo');
});

// A bot's MCP server against a stand-in browser that answers with the page as text.
function stubPipe(page) {
  const pipe = process.platform === 'win32' ? `\\\\.\\pipe\\orb-navegador-limites-${process.pid}-${Math.random().toString(16).slice(2)}` : path.join(os.tmpdir(), `orb-nav-lim-${process.pid}-${Date.now()}.sock`);
  const seen = [];
  const server = net.createServer((s) => {
    let buf = '';
    s.on('data', (c) => { buf += c; let nl; while ((nl = buf.indexOf('\n')) >= 0) { const m = JSON.parse(buf.slice(0, nl)); buf = buf.slice(nl + 1); if (!m.hello) seen.push(m); s.write(`${JSON.stringify(m.hello ? { ok: true } : { id: m.id, ok: true, result: page() })}\n`); } });
  });
  return { pipe, seen, ready: new Promise((r) => server.listen(pipe, r)), close: () => server.close() };
}
function mcp(home, env) {
  const child = spawn(process.execPath, [path.join(ROOT, 'src', 'mcp', 'server.mjs')], { env: { ...process.env, ORB_HOME: home, ...env }, stdio: ['pipe', 'pipe', 'inherit'], windowsHide: true });
  const replies = new Map(); let n = 0;
  readline.createInterface({ input: child.stdout }).on('line', (l) => { const m = JSON.parse(l); replies.get(m.id)?.(m); });
  const rpc = (method, params) => new Promise((r) => { const id = ++n; replies.set(id, r); child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`); });
  return { rpc, call: async (name, args) => { const r = (await rpc('tools/call', { name, arguments: args })).result; return { error: Boolean(r.isError), text: r.content[0].text }; }, close: () => { const gone = new Promise((r) => (child.exitCode != null ? r() : child.once('exit', r))); child.stdin.end(); return gone; } };
}

test('MCP de un bot: el clic de riesgo por número se reconoce, y la tarjeta de acciones masivas sale a la 51', async () => {
  const h = tempHome({ browser: { sites: { default: { minMs: 0, maxMs: 0, burst: 500, perHour: 5000 } } } });
  const { Board } = await import('../src/core/board.mjs');
  const B = await import('../src/core/bots.mjs');
  const { agentToken } = await import('../src/engine/sessions.mjs');
  const board = new Board();
  const bot = B.createBot(board, { name: 'Limpieza', role_text: 'ordena mis redes', tools: ['navegador'] });
  const page = () => formatSnapshot({ title: 'Mis publicaciones', url: 'https://social.example/yo', text: 'publicaciones', cut: false, scroll: { y: 0, height: 800, view: 800 },
    elements: ['[1] button "Eliminar publicación"', '[2] button "Comprar ahora"', '[3] a "Inicio" -> https://social.example/'] });
  const stub = stubPipe(page); await stub.ready;
  const who = `bot:${bot.id}`;
  const c = mcp(h.home, { ORB_AGENT: who, ORB_AGENT_TOKEN: agentToken(board, who), ORB_BROWSER_ONLY: '1', ORB_BROWSER_PIPE: stub.pipe, ORB_BROWSER_TOKEN: 'a'.repeat(64), ORB_SESSION: `bot-${bot.id}` });
  try {
    await c.rpc('initialize', {});
    assert.equal((await c.call('orb_browser_open', { url: 'https://social.example/yo' })).error, false);
    // «Comprar ahora» by its number needs the person's OK (before 3.7 the label was never read from the text).
    const buy = await c.call('orb_browser_click', { ref: 2 });
    assert.equal(buy.error, true); assert.match(buy.text, /bot_confirm/);
    for (let i = 0; i < 50; i++) assert.equal((await c.call('orb_browser_click', { ref: 1 })).error, false, `clic ${i + 1}`);
    const card = await c.call('orb_browser_click', { ref: 1 });
    assert.equal(card.error, true); assert.match(card.text, /Llevas 50 veces/);
    const req = board.all("SELECT id, kind, payload, status FROM bot_requests WHERE bot_id = ? AND kind = 'confirm'", bot.id).at(-1);
    assert.ok(req, 'la tarjeta pedida');
    const p = JSON.parse(req.payload);
    assert.match(p.detail, /condiciones de uso/); assert.match(p.detail, /no es asesoramiento legal/); assert.equal(p.url, 'https://social.example');
    assert.match((await c.call('orb_browser_click', { ref: 1 })).text, /Sigue pendiente/);
    board.run("UPDATE bot_requests SET status = 'done' WHERE id = ?", req.id);
    assert.equal((await c.call('orb_browser_click', { ref: 1 })).error, false, 'con el sí, sigue');
    assert.equal(stub.seen.filter((m) => m.action === 'click').length, 51, 'el navegador solo recibió los permitidos');
  } finally { await c.close(); stub.close(); h.cleanup(); }
});

test('MCP: orb_browser_vault_fill solo con la bóveda encendida, y solo devuelve ok o failed', async () => {
  const h = tempHome();
  const stub = stubPipe(() => 'ok'); await stub.ready;
  const off = mcp(h.home, { ORB_AGENT: 'claude', ORB_BROWSER_PIPE: stub.pipe, ORB_BROWSER_TOKEN: 'a'.repeat(64), ORB_SESSION: 's1' });
  const on = mcp(h.home, { ORB_AGENT: 'claude', ORB_BROWSER_PIPE: stub.pipe, ORB_BROWSER_TOKEN: 'a'.repeat(64), ORB_SESSION: 's2', ORB_BROWSER_VAULT: '1' });
  try {
    await off.rpc('initialize', {}); await on.rpc('initialize', {});
    assert.ok(!(await off.rpc('tools/list', {})).result.tools.some((x) => x.name === 'orb_browser_vault_fill'));
    assert.ok((await on.rpc('tools/list', {})).result.tools.some((x) => x.name === 'orb_browser_vault_fill'));
    assert.equal((await on.call('orb_browser_vault_fill', { site: 'example.com' })).text, 'ok');
    assert.deepEqual(stub.seen.at(-1), { id: stub.seen.at(-1).id, action: 'vault_fill', args: { site: 'example.com' } });
  } finally { await off.close(); await on.close(); stub.close(); h.cleanup(); }
});

test('la página como texto se lee de vuelta (dirección y elementos)', () => {
  const s = parseSnapshot(formatSnapshot({ title: 'T', url: 'https://a.example/x', text: 'hola', cut: false, scroll: { y: 0, height: 1, view: 1 }, elements: ['[1] button "Pagar"', '[2] a "Más"'] }, { notes: ['AVISO'] }));
  assert.deepEqual(s, { url: 'https://a.example/x', elements: ['[1] button "Pagar"', '[2] a "Más"'] });
  assert.equal(parseSnapshot('Navegador cerrado.'), null);
});

// ---- the live view against a stand-in CDP session: Chromium makes a picture each time the last one was acknowledged.
function stubCdp({ frameBytes = 30_000 } = {}) {
  const ev = new EventEmitter(); const sent = []; let on = false; let n = 0;
  const data = 'A'.repeat(Math.ceil(frameBytes * 4 / 3));
  const frame = () => { if (on) setTimeout(() => on && ev.emit('Page.screencastFrame', { data, sessionId: ++n, metadata: { deviceWidth: 1280, deviceHeight: 800 } }), 5); };
  return {
    sent,
    on: (e, fn) => ev.on(e, fn), off: (e, fn) => ev.off(e, fn),
    async send(method, params) {
      sent.push({ method, params });
      if (method === 'Page.startScreencast') { on = true; frame(); }
      if (method === 'Page.stopScreencast') on = false;
      if (method === 'Page.screencastFrameAck') frame();
      return {};
    }
  };
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

test('vista en directo: con 400 ms de ida y vuelta no pasa de 150 KB/s y nunca hay cola', async () => {
  const cdp = stubCdp({ frameBytes: 30_000 });
  let bytes = 0; let inflight = 0; let maxInflight = 0;
  const cast = createScreencast({ cdp, width: 390, dpr: 3, send: (f) => { bytes += f.data.length * 3 / 4; inflight++; maxInflight = Math.max(maxInflight, inflight); setTimeout(() => { inflight--; cast.ack(f.seq); }, 400); } });
  const size = await cast.start();
  assert.equal(size.width, 585, '390 × 1,5');
  const t0 = Date.now(); await sleep(2500); const secs = (Date.now() - t0) / 1000;
  await cast.stop();
  assert.equal(maxInflight, 1, 'una imagen en camino cada vez');
  assert.ok(bytes / secs <= 150 * 1024, `${Math.round(bytes / secs / 1024)} KB/s`);
  assert.ok(cast.stats().frames >= 4, 'llegan imágenes');
});

test('vista en directo: con enlace rápido y fotos grandes, el presupuesto de bytes manda y baja la calidad', async () => {
  const cdp = stubCdp({ frameBytes: 60_000 });
  let bytes = 0;
  const cast = createScreencast({ cdp, width: 1280, send: (f) => { bytes += f.data.length * 3 / 4; setTimeout(() => cast.ack(f.seq), 5); } });
  await cast.start();
  const t0 = Date.now(); await sleep(3000); const secs = (Date.now() - t0) / 1000;
  const st = cast.stats(); await cast.stop();
  // A full bucket (one second's worth) may go at the start; after that, the budget.
  assert.ok(bytes <= 150 * 1024 * (secs + 1), `${Math.round(bytes / 1024)} KB en ${secs.toFixed(1)} s`);
  assert.ok(st.quality < 50, 'calidad rebajada');
  assert.ok(cdp.sent.some((m) => m.method === 'Page.startScreencast' && m.params.quality === 40));
});

test('vista en directo: toques, texto y teclas llegan a la página; en segundo plano se para; a los 10 min sin uso, se cierra', async () => {
  const cdp = stubCdp(); let stopped = null;
  const cast = createScreencast({ cdp, width: 400, send: (f) => setTimeout(() => cast.ack(f.seq), 1), idleMs: 300, onStop: (r) => { stopped = r; } });
  await cast.start(); await sleep(50);
  await cast.input({ type: 'tap', x: 0.5, y: 0.25 });
  const mouse = cdp.sent.filter((m) => m.method === 'Input.dispatchMouseEvent');
  assert.deepEqual(mouse.map((m) => [m.params.type, m.params.x, m.params.y]), [['mouseMoved', 640, 200], ['mousePressed', 640, 200], ['mouseReleased', 640, 200]], 'en píxeles de la página');
  await cast.input({ type: 'text', text: 'código 123' });
  assert.deepEqual(cdp.sent.at(-1), { method: 'Input.insertText', params: { text: 'código 123' } });
  await cast.input({ type: 'key', key: 'Enter' });
  assert.equal(cdp.sent.at(-2).params.windowsVirtualKeyCode, 13);
  await assert.rejects(() => cast.input({ type: 'key', key: 'F12' }), /tecla/);
  await assert.rejects(() => cast.input({ type: 'tap', x: 2, y: 0 }), /posición/);
  await assert.rejects(() => cast.input({ type: 'text', text: 'x'.repeat(3000) }), /texto/);
  await cast.pause(true);
  const before = cast.stats().frames; await sleep(120);
  assert.equal(cast.stats().frames, before, 'en segundo plano, ninguna imagen');
  await cast.pause(false); await sleep(60);
  assert.ok(cast.stats().frames > before, 'al volver, sigue');
  await sleep(500);
  assert.equal(stopped, 'idle', 'sin usarla, se cierra sola');
  assert.equal(frameWidth(2000, 2), 1280, 'nunca más ancho que la página');
});

test('Server: sin 1,2 GB libres no abre Chromium (aviso claro); sin Xvfb, el error dice cómo instalarlo', async () => {
  assert.equal(memAvailableMB(() => 'MemTotal: 4000000 kB\nMemAvailable:    819200 kB\n'), 800);
  assert.equal(memAvailableMB(() => { throw new Error('no /proc'); }), null);
  const h = tempHome();
  let launched = 0;
  const sb = createServerBrowser({ root: path.join(h.base, 'b'), display: 'headless', executable: 'chrome', scope: false, readMeminfo: () => 'MemAvailable:   819200 kB', launchContext: async () => { launched++; throw new Error('no'); } });
  await sb.ready;
  const { browserKey } = await import('../src/core/browser-key.mjs');
  const s = net.connect(sb.pipe); s.setEncoding('utf8');
  const lines = []; s.on('data', (c) => lines.push(...c.split('\n').filter(Boolean).map((l) => JSON.parse(l))));
  const who = { agent: 'bot:1', session: 'b1', task: '' };
  await new Promise((r) => s.on('connect', r));
  s.write(`${JSON.stringify({ hello: browserKey(sb.token, who), ...who })}\n${JSON.stringify({ id: 1, action: 'open', args: { url: 'https://x.example' } })}\n`);
  const deadline = Date.now() + 5000; while (lines.length < 2 && Date.now() < deadline) await sleep(20);
  assert.equal(lines[1].ok, false);
  assert.match(lines[1].error, /poca memoria libre \(800 MB; hacen falta 1200 MB\)/);
  assert.equal(launched, 0, 'ni lo intenta');
  s.end(); await sb.shutdown();
  const T = (k) => k;
  await assert.rejects(() => startXvfb({ T, spawnImpl: () => { const e = new EventEmitter(); e.stdio = []; e.kill = () => {}; setImmediate(() => e.emit('error', Object.assign(new Error('spawn Xvfb ENOENT'), { code: 'ENOENT' }))); return e; } }), (e) => e.code === 'NO_XVFB' && e.message === 'sys.browser.noXvfb');
  h.cleanup();
});

test('Server: un Chromium a la vez con cola, cierre tras los minutos sin uso, banderas y su propio scope de systemd', async () => {
  const h = tempHome();
  const opened = []; const closedAt = [];
  // A stand-in Chromium (each launch, a context with pages and a CDP session).
  const launchContext = async (dir, options) => {
    opened.push({ dir: path.basename(dir), options });
    const ctxEv = new EventEmitter();
    const mkPage = () => { const p = new EventEmitter(); let closed = false; p.url = () => 'about:blank'; p.isClosed = () => closed; p.close = async () => { closed = true; p.emit('close'); }; p.title = async () => ''; p.goto = async () => {}; return p; };
    const pages = [mkPage()];
    return { pages: () => pages, newPage: async () => mkPage(), newCDPSession: async () => ({ send: async (m) => (m === 'Page.getFrameTree' ? { frameTree: { frame: { id: 'f' } } } : m === 'Page.createIsolatedWorld' ? { executionContextId: 1 } : m === 'Runtime.evaluate' ? { result: { value: { title: 'x', url: 'about:blank', text: '', cut: false, elements: [], scroll: { y: 0, height: 0, view: 0 } } } } : {}), on() {}, off() {} }),
      on: (e, fn) => ctxEv.on(e, fn), close: async () => { closedAt.push(path.basename(dir)); ctxEv.emit('close'); } };
  };
  const sb = createServerBrowser({ root: path.join(h.base, 'b'), display: 'headless', executable: 'chrome', scope: false, ownerId: () => 'dueno', readMeminfo: () => 'MemAvailable: 8000000 kB', launchContext, timings: { idleMs: 300, queueMs: 4000 } });
  await sb.ready;
  const { browserKey } = await import('../src/core/browser-key.mjs');
  const conn = async (who) => {
    const s = net.connect(sb.pipe); s.setEncoding('utf8'); const got = [];
    s.on('data', (c) => got.push(...c.split('\n').filter(Boolean).map((l) => JSON.parse(l))));
    await new Promise((r) => s.on('connect', r));
    s.write(`${JSON.stringify({ hello: browserKey(sb.token, who), ...who })}\n`);
    return { got, send: (m) => s.write(`${JSON.stringify(m)}\n`), end: () => s.end() };
  };
  const waitFor = async (fn, ms = 5000) => { const end = Date.now() + ms; while (!fn() && Date.now() < end) await sleep(20); return fn(); };
  try {
    const a = await conn({ agent: 'bot:1', session: 'a', task: '' });
    a.send({ id: 1, action: 'open', args: { url: 'https://uno.example' } });
    assert.ok(await waitFor(() => a.got.some((m) => m.id === 1)), 'Ana abre');
    assert.equal(a.got.find((m) => m.id === 1).ok, true);
    const b = await conn({ agent: 'bot:2', session: 'b', task: '', person: 'leo' });
    b.send({ id: 1, action: 'open', args: { url: 'https://dos.example' } });
    await sleep(400);
    assert.ok(!b.got.some((m) => m.id === 1), 'Leo espera su turno mientras el del dueño está en uso');
    assert.deepEqual(sb.state().instances.map((i) => i.person), ['dueno'], 'un solo Chromium');
    a.end();
    assert.ok(await waitFor(() => b.got.some((m) => m.id === 1)), 'en cuanto queda libre, le toca a Leo');
    assert.deepEqual(closedAt, ['dueno']);
    assert.deepEqual(sb.state().instances.map((i) => i.person), ['leo']);
    b.end();
    assert.ok(await waitFor(() => sb.state().instances.length === 0, 3000), 'tras los minutos sin uso, se cierra');
    assert.deepEqual(opened.map((o) => o.dir), ['dueno', 'leo'], 'un perfil por persona');
    for (const f of ['--renderer-process-limit=2', '--disable-dev-shm-usage', '--disable-gpu']) assert.ok(opened[0].options.args.includes(f), f);
    assert.deepEqual(FLAGS, ['--renderer-process-limit=2', '--disable-dev-shm-usage', '--disable-gpu']);
    assert.equal(opened[0].options.acceptDownloads, false);
    assert.ok(!Object.keys(opened[0].options.env).some((k) => /^ORB_/.test(k)), 'Chromium no recibe las claves de Orb');
  } finally { await sb.shutdown(); }
  const w = scopeWrapper('/opt/chrome dir/chrome', path.join(h.base, 'w'));
  const body = fs.readFileSync(w, 'utf8');
  assert.match(body, /systemd-run --user --scope --quiet --collect -p MemoryMax=1536M -- '\/opt\/chrome dir\/chrome' "\$@"/);
  assert.match(body, /echo 500 > \/proc\/self\/oom_score_adj/);
  h.cleanup();
});

test('Chromium del Server: la versión fijada y su huella; una descarga que no coincide nunca se usa', async () => {
  assert.equal(CHROMIUM.playwright, JSON.parse(fs.readFileSync(path.join(ROOT, 'node_modules', 'playwright-core', 'package.json'), 'utf8')).version, 'la de playwright-core');
  const pinned = JSON.parse(fs.readFileSync(path.join(ROOT, 'node_modules', 'playwright-core', 'browsers.json'), 'utf8')).browsers.find((b) => b.name === 'chromium');
  assert.equal(CHROMIUM.revision, pinned.revision); assert.equal(CHROMIUM.version, pinned.browserVersion);
  for (const b of Object.values(CHROMIUM.builds)) assert.match(b.sha256, /^[0-9a-f]{64}$/);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'orb-chromium-'));
  const body = Buffer.from('no soy chromium');
  const fetchImpl = async () => new Response(body);
  await assert.rejects(() => downloadChromium({ dir, key: 'linux-x64', fetchImpl, build: { ...CHROMIUM.builds['linux-x64'], size: body.length } }), (e) => e.code === 'BAD_HASH');
  assert.deepEqual(fs.readdirSync(dir), [], 'nada se queda ni se descomprime');
  await assert.rejects(() => downloadChromium({ dir, key: 'linux-x64', fetchImpl, build: { ...CHROMIUM.builds['linux-x64'], sha256: '' } }), (e) => e.code === 'NO_HASH');
  // A Chromium the owner names wins (and must exist).
  assert.equal(await ensureChromium({ config: { executablePath: process.execPath }, engines: {} }), process.execPath);
  await assert.rejects(() => ensureChromium({ config: { executablePath: path.join(dir, 'nada') }, engines: {} }), /no encuentro/);
  fs.rmSync(dir, { recursive: true, force: true });
});
