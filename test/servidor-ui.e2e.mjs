// 3.7 (WS4): Orb Server in the app, headless. The engine runs with the fake agents in a throwaway folder (real bots, chats
// and lists); the page gets a bridge of its own that sends every call to that engine and answers the Server's side (the
// linked Orb Server, its guide, the bots' homes, its state, its vault and its browser's pictures) with fixed data, so each
// screen can be drawn without a second machine. Checks the flows (Añadir Orb Server → the guide → move the bots → the
// report; unlink with its three choices; a copy of a bot whose Server does not answer, with what waits; «Pasar al PC»
// with a same-name merge; «Ver navegador del Server»; Ajustes › Orb Server › Contraseñas) and that the page never breaks.
// Screenshots → test-results/ws4/*.png: the PC (1440×900, light and dark), a phone browser (390×844) linked to the Server
// and the Android build (glass, light and dark).
// Run: node test/servidor-ui.e2e.mjs
import { chromium } from 'playwright-core';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { fork, execFileSync } from 'node:child_process';
import { tempHome, ROOT, until } from './helpers.mjs';

const OUT = path.join(ROOT, 'test-results', 'ws4'); fs.mkdirSync(OUT, { recursive: true });
const vite = (mode, outDir) => execFileSync(process.execPath, [path.join(ROOT, 'node_modules', 'vite', 'bin', 'vite.js'), 'build', ...(mode ? ['--mode', mode] : []), '--outDir', outDir, '--emptyOutDir', '--logLevel', 'warn'], { cwd: ROOT, stdio: 'inherit', windowsHide: true });
const wwwPc = fs.mkdtempSync(path.join(os.tmpdir(), 'orb-ws4-pc-'));
const wwwGlass = fs.mkdtempSync(path.join(os.tmpdir(), 'orb-ws4-glass-'));
vite(null, wwwPc); vite('android', wwwGlass);

// A plain static server for each build.
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2', '.json': 'application/json', '.webmanifest': 'application/manifest+json' };
function serve(dir) {
  const srv = http.createServer((req, res) => {
    const p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    let file = path.join(dir, p === '/' ? 'index.html' : p);
    if (!file.startsWith(dir) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(dir, 'index.html');
    res.writeHead(200, { 'content-type': TYPES[path.extname(file)] ?? 'application/octet-stream' });
    fs.createReadStream(file).pipe(res);
  });
  return new Promise((r) => srv.listen(0, '127.0.0.1', () => r({ srv, url: `http://127.0.0.1:${srv.address().port}/` })));
}

// ---- the engine (fake agents): four bots, a group, a second user, answers in their chats
const t = tempHome({ ui: { tourDone: true, mode: 'bots' } });
const child = fork(path.join(ROOT, 'src', 'engine', 'engine.mjs'), [], { stdio: ['ignore', 'inherit', 'inherit', 'ipc'], env: { ...process.env, ORB_FAKE_SCRIPT: path.join(ROOT, 'test', 'fixtures', 'guion-mensajeria.json') }, windowsHide: true });
let n = 0; const pending = new Map();
child.on('message', (m) => { if (m.type === 'reply') { const p = pending.get(m.id); pending.delete(m.id); if (p) (m.ok ? p.resolve(m.result) : p.reject(Object.assign(new Error(m.error), { reason: m.reason }))); } });
const call = (method, params = {}) => new Promise((resolve, reject) => { const id = ++n; pending.set(id, { resolve, reject }); child.send({ type: 'call', id, method, params: params ?? {} }); });
await new Promise((resolve, reject) => { const on = (m) => { if (m?.type !== 'started') return; child.off('message', on); m.ok ? resolve() : reject(new Error(m.error)); }; child.on('message', on); child.send({ type: 'start', home: t.home, version: '3.7.0' }); });

const jefe = await call('bots.create', { name: 'Jefe', avatar: { shape: 'gota', color: 'cielo' }, role_text: 'Reparte lo que pido y me avisa cuando está.', is_chief: true, tools: ['internet', 'recordatorios'] });
const agenda = await call('bots.create', { name: 'Agenda', avatar: { shape: 'capsula', color: 'melocoton' }, role_text: 'Llevas mi calendario y mis citas.', tools: ['recordatorios', 'calendario'] });
const compras = await call('bots.create', { name: 'Compras', avatar: { shape: 'mochi', color: 'menta' }, role_text: 'Comparas precios y preparas la compra. Nunca compras sin mi aprobación.', tools: ['internet', 'navegador'] });
const correo = await call('bots.create', { name: 'Correo', avatar: { shape: 'nube', color: 'agua' }, role_text: 'Me resumes el correo.', tools: ['correo'] });
await call('bots.groups.create', { name: 'Casa', members: [jefe.id, agenda.id] });
await call('inbox.pin', { kind: 'bot', id: jefe.id });
for (const [id, text] of [[compras.id, 'Prepara la lista de la compra de la semana'], [jefe.id, 'Hazme el plan de la semana'], [correo.id, '¿Hay algo importante en el correo?']]) {
  await call('bots.send', { id, text });
  await until(async () => (await call('inbox.list', { zone: 'bots' })).items.find((x) => x.kind === 'bot' && x.id === id)?.unread > 0, 'respuesta de ejemplo', 30000);
}
await call('persons.create', { name: 'María' });

// ---- a picture of a page of the Server's browser (a sign-in page of a made-up shop), for the live view
const exe = ['/opt/pw-browsers/chromium/chrome-linux/chrome'].find((f) => fs.existsSync(f));
const browser = await chromium.launch(exe ? { executablePath: exe, args: ['--no-sandbox'] } : { channel: process.platform === 'win32' ? 'msedge' : 'chrome', headless: true });
const framePage = await browser.newPage({ viewport: { width: 1000, height: 680 } });
await framePage.setContent(`<html><body style="margin:0;font-family:Segoe UI,Arial;background:#f3f4f6"><div style="background:#1f2937;color:#fff;padding:14px 28px;font-weight:600;font-size:20px">Tienda Ejemplo</div>
  <div style="max-width:380px;margin:60px auto;background:#fff;border-radius:12px;padding:28px;box-shadow:0 4px 18px #0002"><h2 style="margin:0 0 6px">Iniciar sesión</h2><p style="color:#555;margin:0 0 18px">Confirma que eres una persona para continuar.</p>
  <div style="border:1px solid #ccc;border-radius:6px;padding:14px;display:flex;gap:12px;align-items:center"><span style="width:22px;height:22px;border:2px solid #888;border-radius:3px;display:inline-block"></span>No soy un robot</div>
  <div style="margin-top:18px;background:#2563eb;color:#fff;text-align:center;padding:11px;border-radius:8px">Continuar</div></div></body></html>`);
const frame = (await framePage.screenshot({ type: 'jpeg', quality: 60 })).toString('base64');
await framePage.setViewportSize({ width: 390, height: 700 });
const frameMobile = (await framePage.screenshot({ type: 'jpeg', quality: 60 })).toString('base64');
await framePage.close();

// ---- the page's bridge: the engine for everything, the Server's side from here
function mockBridge(cfg) {
  const L = new Map();
  const fire = (e, p) => { for (const f of L.get(e) ?? []) f(p); for (const f of L.get('*') ?? []) f(e, p); };
  window.__fire = fire;
  window.__mock = cfg;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const ago = (min) => new Date(Date.now() - min * 60_000).toISOString();
  const SRV = { id: 'p-srv', name: 'casa-srv', online: true, version: '3.7.0', features: ['bots.home.v1', 'replica.v1', 'browser.live.v1', 'vault.v1'], lastSeen: ago(0) };
  const linked = () => window.__mock.server === 'linked';
  const onSrv = () => window.__mock.product === 'server';
  // Compras and Correo run on the Server (Correo's Server does not answer now, two messages wait); the others on the PC.
  const ON_SERVER = { Compras: { online: true }, Correo: { online: false, queued: 2 } };
  const decorate = (b) => {
    if (!b || typeof b !== 'object') return b;
    const s = linked() && ON_SERVER[b.name];
    if (onSrv()) return s ? { ...b, uid: `u-${b.id}`, home: 'srv', homeKind: 'here', homeHere: true, homeName: 'Este PC', homeOnline: true, readOnly: false, executor: true, homeState: 'active', queued: 0 }
      : { ...b, uid: `u-${b.id}`, home: 'pc', homeKind: 'orb', homeHere: false, homeName: 'Portátil', homeOnline: true, homeKnown: true, readOnly: true, executor: false, homeState: 'active', queued: 0 };
    if (!s) return { ...b, uid: `u-${b.id}`, home: 'pc', homeKind: 'here', homeHere: true, homeName: 'Este PC', homeOnline: true, readOnly: false, executor: true, homeState: 'active', queued: 0 };
    return { ...b, uid: `u-${b.id}`, home: 'srv', homeKind: 'server', homeHere: false, homeName: 'casa-srv', homeOnline: s.online, homeKnown: true, readOnly: true, executor: false, homeState: 'active', queued: s.queued ?? 0 };
  };
  const homes = () => (onSrv() ? [{ key: 'srv', name: 'Este PC', here: true, online: true, server: true, brains: ['claude', 'codex'] }, { key: 'pc', id: 'p-pc', name: 'Portátil', here: false, online: true, server: false, brains: ['claude', 'codex'] }]
    : linked() ? [{ key: 'pc', name: 'Este PC', here: true, online: true, server: false, brains: ['claude', 'codex'] }, { key: 'srv', id: 'p-srv', name: 'casa-srv', here: false, online: true, server: true, brains: ['claude', 'codex'] }]
      : [{ key: 'pc', name: 'Este PC', here: true, online: true, server: false, brains: ['claude', 'codex'] }]);
  const cmd = "curl -fsSL https://github.com/dani-orb/orb/releases/download/v3.7.0/install.sh -o /tmp/orb-install.sh && echo \"9c1e5b0d7f3a2c48e61b9d04a7f2c3e5d8b1a6f40c92e7d5b3a1f8e6c4d2b0a9  /tmp/orb-install.sh\" | sha256sum -c && bash /tmp/orb-install.sh --pair 'K7QM-4XTR@http://100.84.12.7:3131#3f9a4c1d2e7b'";
  const over = {
    'app.state': async (p) => { const r = await window.orbCall('app.state', p); return onSrv() ? { ...r, product: 'server' } : r; },
    'link.server.status': () => (linked() ? { linked: true, peer: SRV, skew: null, handoffs: [{ status: 'done' }, { status: 'done' }], code: { active: false } } : { linked: false, code: { active: false } }),
    'link.server.code': () => ({ code: 'K7QM-4XTR', expiresAt: Date.now() + 9 * 60_000 + 41_000, fp: '3f9a4c1d2e7b', address: 'http://100.84.12.7:3131', command: cmd, ready: true,
      steps: [{ key: 'msg.server.step.download', cmd: 'curl -fsSL https://github.com/dani-orb/orb/releases/download/v3.7.0/install.sh -o /tmp/orb-install.sh' }, { key: 'msg.server.step.check', cmd: 'echo "9c1e…b0a9  /tmp/orb-install.sh" | sha256sum -c' }, { key: 'msg.server.step.run', cmd: "bash /tmp/orb-install.sh --pair 'K7QM-4XTR@http://100.84.12.7:3131#3f9a4c1d2e7b'" }, { key: 'msg.server.step.fallback' }] }),
    'link.server.cancelCode': () => true,
    'link.server.guide': () => ({ peer: SRV, steps: [
      { id: 'agents', done: window.__mock.claude, agents: [{ agent: 'claude', label: 'Claude', installed: true, signedIn: window.__mock.claude }, { agent: 'codex', label: 'Codex', installed: false, signedIn: false }] },
      { id: 'bots', done: false, botsHere: 2 }, { id: 'vault', optional: true, available: true }, { id: 'browser', optional: true, available: true }] }),
    'link.server.persons': () => ({ peer: 'p-srv', here: [{ id: 'own', name: 'Ana', role: 'owner', fixed: true, mappedTo: 's-own' }, { id: 'maria', name: 'María', role: 'person', mappedTo: null }],
      there: [{ id: 's-own', name: 'Ana', fixed: true, mappedTo: 'own' }, { id: 's-maria', name: 'María', mappedTo: null }, { id: 's-leo', name: 'Leo', mappedTo: null }] }),
    'link.server.map': () => ({ ok: true }), 'link.server.unmap': () => ({ ok: true }),
    'link.server.login': () => ({ id: 'L1', url: 'https://claude.ai/oauth/authorize?code=true&client_id=orb', needsCode: true }),
    'link.server.loginState': () => ({ state: 'esperando' }), 'link.server.loginCancel': () => true,
    'bots.homes': homes,
    'bots.move': async (p) => { await sleep(window.__mock.moveMs ?? 700); const same = window.__mock.sameName; window.__mock.sameName = null; return { ok: true, id: p.id, uid: `u-${p.id}`, to: 'srv', sites: ['tienda.example', 'correo.example'], missing: { connectors: ['gmail'], ha: false }, sameName: same ?? null }; },
    'bots.unlink': async () => { await sleep(400); return { ok: true }; },
    'server.status': () => ({ version: '3.7.0', platform: 'linux', arch: 'x64', uptime: 3 * 86400 + 5000, memory: { rss: 78 * 1048576 }, admin: { helper: true, sudo: true },
      engines: [{ id: 'claude', label: 'Claude', installed: true, version: '2.1.40' }, { id: 'codex', label: 'Codex', installed: false }, { id: 'chromium', label: 'Chromium', installed: true, version: '153.0' }], update: { available: { version: '3.7.1' } } }),
    'vault.status': () => (window.__mock.vault === 'configured'
      ? { allowed: true, available: true, argon2: true, configured: true, server: 'vault.casa.lan', cloud: false, collection: 'Orb', items: 14, syncedAt: ago(25), approvals: [{ host: 'tienda.example', at: ago(60 * 26) }, { host: 'correo.example', at: ago(60 * 74) }] }
      : { allowed: true, available: true, argon2: true, configured: false }),
    'browser.live.start': () => { setTimeout(() => fire(onSrv() ? 'browser:live' : 'centro:browser:live', { sid: 's1', seq: 1, data: window.__mock.frame }), 250); return { sid: 's1' }; },
    'browser.live.input': () => ({ ok: true, using: false }), 'browser.live.stop': () => true
  };
  const post = {
    'bots.list': (r) => ({ ...r, bots: (r.bots ?? []).map(decorate) }),
    'bots.get': decorate,
    'bots.chat': (r, p) => (window.__mock.pendingFor === p.id ? { ...r, ...decorate({ name: 'Correo', id: p.id }), lines: [...(r.lines ?? []), { id: 99_001, role: 'usuario', body: '¿Me avisas si llega la factura de la luz?', meta: { pending: true }, at: ago(40) }, { id: 99_002, role: 'usuario', body: 'Y reenvíamela a mi correo del trabajo.', meta: { pending: true }, at: ago(38) }] } : r)
  };
  window.orb = {
    mobile: cfg.mobile, platform: 'win32',
    info: async () => ({}),
    on: (e, f) => { if (!L.has(e)) L.set(e, new Set()); L.get(e).add(f); return () => L.get(e)?.delete(f); },
    call: async (method, params = {}) => {
      const m = String(method); const bare = m.startsWith('centro.') ? m.slice(7) : m;
      if (over[bare] && (bare === m || !/^(bots|inbox)\./.test(bare))) return over[bare](params);
      const r = await window.orbCall(m, params);
      if (r && r.__error) throw Object.assign(new Error(r.__error), { reason: r.reason });
      return post[bare] ? post[bare](r, params) : r;
    },
    openExternal: async () => true,
    zoom: cfg.mobile ? undefined : async () => 1,
    moreApps: async () => []
  };
}

const errors = []; const shots = []; let step = 'inicio'; let last = null;
const watch = (page) => {
  page.on('pageerror', (e) => errors.push(`[${step}] ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error' && !/status of (409|404)|favicon|Failed to load resource/.test(m.text())) errors.push(`[${step}] ${m.text()}`); });
};
async function open(url, { mobile = false, dark = false, product = null, viewport = { width: 1440, height: 900 }, ua } = {}) {
  const ctx = await browser.newContext({ viewport, deviceScaleFactor: mobile ? 2 : 1, locale: 'es-ES', ...(ua ? { userAgent: ua, isMobile: true, hasTouch: true } : {}), colorScheme: dark ? 'dark' : 'light' });
  await ctx.exposeFunction('orbCall', async (m, p) => { try { return await call(m, p); } catch (e) { return { __error: e.message, reason: e.reason }; } });
  await ctx.addInitScript(mockBridge, { mobile, server: 'linked', vault: 'empty', claude: false, product, frame: mobile ? frameMobile : frame, moveMs: 700 });
  await ctx.addInitScript((d) => { try { localStorage.setItem('orb.theme', d ? 'oscuro' : 'claro'); localStorage.setItem('orb.testDay', new Date().toLocaleDateString('sv')); } catch { /* first */ } }, dark);
  const page = await ctx.newPage(); watch(page); last = page;
  await page.goto(url);
  return page;
}
const shot = async (page, name) => {
  const file = path.join(OUT, `${name}.png`);
  await page.waitForTimeout(400);
  await page.addStyleTag({ content: '[data-sonner-toaster] { visibility: hidden !important; } *, *::before, *::after { caret-color: transparent !important; }' }).then((h) => h.evaluate((el) => { el.id = 'no-toasts'; }));
  await page.screenshot({ path: file }); shots.push(file);
  await page.evaluate(() => document.getElementById('no-toasts')?.remove());
};
const mock = (page, patch) => page.evaluate((p) => Object.assign(window.__mock, p), patch);
const fire = (page, e, p) => page.evaluate(([a, b]) => window.__fire(a, b), [e, p]);
const navigate = (page, route) => fire(page, 'ui:navigate', route);

try {
  const pc = await serve(wwwPc);
  const glass = await serve(wwwGlass);
  // ---------------- the PC, light and dark ----------------
  for (const dark of process.env.ONLY === 'movil' ? [] : [false, true]) {
    const tag = `pc-${dark ? 'oscuro' : 'claro'}`;
    step = `${tag}: abrir`;
    const page = await open(pc.url, { dark });
    await mock(page, { server: 'none' });
    await page.getByTestId('bot-inbox').waitFor({ timeout: 30000 });

    step = `${tag}: añadir Orb Server`;
    await navigate(page, { view: 'settings', section: 'magiclink:server' });
    await fire(page, 'link:peers', {});
    await page.getByTestId('server-add-go').click();
    await page.getByTestId('server-code').waitFor();
    assert.match(await page.getByTestId('server-command').innerText(), /--pair 'K7QM-4XTR@/);
    await page.getByTestId('server-add').scrollIntoViewIfNeeded();
    await shot(page, `${tag}-01-anadir-server`);
    await page.getByTestId('server-manual').click();
    await page.getByTestId('server-steps').waitFor();
    await page.getByTestId('server-steps').scrollIntoViewIfNeeded();
    await shot(page, `${tag}-02-anadir-a-mano`);

    step = `${tag}: enlazado, la guía`;
    await mock(page, { server: 'linked' });
    await fire(page, 'link:peers', {});
    await page.getByTestId('server-guide').waitFor({ timeout: 10000 });
    await page.getByTestId('guide-agents').waitFor();
    await page.getByTestId('server-login-start-claude').click();
    await page.getByTestId('server-login-paste').waitFor();
    await shot(page, `${tag}-03-guia-claude`);
    await page.getByTestId('guide-step-bots').click();
    await page.getByTestId('bots-choice-all').waitFor();
    assert.equal(await page.locator('[data-testid^=bots-choice-]').count(), 3, 'tres opciones');
    await page.getByTestId('bots-choice-pick').click();
    await page.getByTestId('bots-pick-list').waitFor();
    await page.getByTestId('bots-pick-Agenda').click();
    await shot(page, `${tag}-04-guia-bots-elegir`);
    await page.getByTestId('bots-choice-all').click();
    await page.getByTestId('bots-move-go').click();
    await page.getByTestId('guide-bots-progress').waitFor();
    await shot(page, `${tag}-05-guia-pasando`);
    await page.getByTestId('guide-bots-report').waitFor({ timeout: 15000 });
    assert.match(await page.getByTestId('guide-bots-report').innerText(), /tienda\.example[\s\S]*gmail/);
    await shot(page, `${tag}-06-guia-informe`);
    await page.getByTestId('guide-step-persons').click();
    await page.getByTestId('map-row-María').waitFor();
    await shot(page, `${tag}-07-guia-usuarios`);
    await page.getByTestId('guide-step-vault').click();
    await page.getByTestId('guide-vault').waitFor();
    await page.keyboard.press('Escape');
    await page.getByTestId('server-guide').waitFor({ state: 'detached' });

    step = `${tag}: desenlazar`;
    await page.getByTestId('server-card').scrollIntoViewIfNeeded();
    await shot(page, `${tag}-08-server-enlazado`);
    await page.getByTestId('server-more').click();
    await page.getByTestId('server-unlink').click();
    await page.getByTestId('server-unlink-dialog').waitFor();
    assert.equal(await page.locator('[data-testid=server-unlink-dialog] [data-testid^=choice-]').count(), 3, 'traer, dejar, cancelar');
    await shot(page, `${tag}-09-desenlazar`);
    await page.getByTestId('choice-cancel').click();

    step = `${tag}: Ajustes › Orb Server`;
    await navigate(page, { view: 'settings', section: 'servidor' });
    await page.getByTestId('server-status').waitFor();
    await page.getByTestId('server-update-available').waitFor();
    await shot(page, `${tag}-10-ajustes-server`);
    await page.getByTestId('vault-card').scrollIntoViewIfNeeded();
    await page.getByTestId('vault-server').fill('https://vault.casa.lan');
    await page.getByTestId('vault-client-id').fill('user.4be1c2f0-9d3e-4a51-8b7c-2e0f1d6a9c33');
    await page.getByTestId('vault-client-secret').fill('secreto-de-prueba');
    await page.getByTestId('vault-password').fill('maestra-de-prueba');
    assert.equal(await page.getByTestId('vault-client-secret').getAttribute('type'), 'password');
    assert.equal(await page.getByTestId('vault-password').getAttribute('type'), 'password');
    await shot(page, `${tag}-11-contrasenas`);
    await mock(page, { vault: 'configured' });
    await navigate(page, { view: 'settings', section: 'datos' }).catch(() => {});
    await navigate(page, { view: 'settings', section: 'servidor:contrasenas' });
    await page.getByTestId('vault-sites').waitFor();
    await page.getByTestId('vault-card').scrollIntoViewIfNeeded();
    await shot(page, `${tag}-12-contrasenas-conectada`);
    await page.keyboard.press('Escape');

    step = `${tag}: la lista y la copia de un bot del Server`;
    await navigate(page, { view: 'bot-chat', id: compras.id });
    await page.getByTestId('replica-bar').waitFor();
    await page.getByTestId('login-expired').first().waitFor();
    assert.ok(await page.locator('[data-testid=home-badge][data-home=server]').count() >= 2, 'insignia Server en la lista');
    assert.ok(await page.locator('[data-testid=home-badge][data-home=here]').count() >= 1, 'insignia Este PC');
    await shot(page, `${tag}-13-bots-server`);
    await mock(page, { pendingFor: correo.id });
    await navigate(page, { view: 'bot-chat', id: correo.id });
    await page.locator('[data-testid=replica-bar][data-online="0"]').waitFor();
    await page.getByTestId('line-pending').first().waitFor();
    assert.ok(await page.locator('[data-testid=home-badge][data-offline="1"]').count() >= 1, 'sin conexión en la lista');
    await page.getByTestId('chat-queued').waitFor();
    await shot(page, `${tag}-14-bot-sin-conexion`);

    step = `${tag}: información, «Pasar al PC», navegador`;
    await mock(page, { claude: true });
    await page.evaluate(() => window.__fire('link:peers', {}));
    await navigate(page, { view: 'bot-chat', id: compras.id });
    await page.getByTestId('bot-chat-head').click();
    await page.getByTestId('info-move-here').waitFor();
    await page.getByTestId('info-browser-live').waitFor();
    await shot(page, `${tag}-15-info-bot-server`);
    await page.getByTestId('info-browser-live').click();
    await page.getByTestId('browser-live-dialog').waitFor();
    await page.waitForFunction(() => document.querySelector('[data-testid=browser-live] img')?.src?.startsWith('data:image/jpeg'));
    await shot(page, `${tag}-16-navegador-server`);
    await page.getByTestId('browser-live-close').click();
    await page.getByTestId('chat-info-close').click();

    step = `${tag}: menú de un bot del PC y unir dos del mismo nombre`;
    await navigate(page, { view: 'bot-chat', id: agenda.id });
    await page.getByTestId('chat-row-Agenda').click({ button: 'right' });
    await page.getByTestId('chat-move-srv').waitFor();
    await shot(page, `${tag}-17-menu-pasar`);
    await mock(page, { sameName: { uid: `u-${compras.id}`, name: 'Agenda' }, moveMs: 200 });
    await page.getByTestId('chat-move-srv').click();
    await page.getByTestId('merge-prompt').waitFor({ timeout: 8000 });
    await shot(page, `${tag}-18-unir`);
    await page.getByTestId('choice-both').click();

    step = `${tag}: nuevo bot`;
    await navigate(page, { view: 'bots', id: 'new' });
    await page.getByTestId('bot-create-where').waitFor();
    assert.equal(await page.getByTestId('bot-create-where-server').getAttribute('aria-checked'), 'true', 'el Server por defecto');
    await page.getByTestId('bot-create-name').fill('Viajes');
    await shot(page, `${tag}-19-nuevo-bot`);
    await page.keyboard.press('Escape');
    await page.context().close();
  }

  // ---------------- the phone (browser) and the Android build (glass), linked to the Server ----------------
  const UA = 'Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Mobile Safari/537.36';
  for (const [kind, url, themes] of [['movil', pc.url, [false]], ['glass', glass.url, [false, true]]]) {
    for (const dark of themes) {
      const tag = `${kind}-${dark ? 'oscuro' : 'claro'}`;
      step = `${tag}: abrir`;
      const page = await open(url, { mobile: true, dark, product: 'server', viewport: { width: 390, height: 844 }, ua: UA });
      await page.getByTestId('nav-menu').first().waitFor({ timeout: 30000 });
      await navigate(page, { view: 'bot-chats' });
      await page.getByTestId('bot-inbox').waitFor({ timeout: 30000 });
      await page.locator('[data-testid=home-badge]').first().waitFor();
      await shot(page, `${tag}-01-chats`);
      step = `${tag}: la copia de un bot del PC`;
      await page.getByTestId('chat-row-Agenda').click({ button: 'right' });
      await page.getByTestId('chat-sheet').waitFor();
      await shot(page, `${tag}-02-menu-pasar`);
      await page.keyboard.press('Escape');
      await navigate(page, { view: 'bot-chat', id: agenda.id });
      await page.getByTestId('replica-bar').waitFor();
      await shot(page, `${tag}-03-chat-copia`);
      step = `${tag}: Orb Server en ☰`;
      await navigate(page, { view: 'server', mode: 'bots' });
      await page.getByTestId('server-status').waitFor();
      await shot(page, `${tag}-04-server`);
      await page.getByTestId('vault-card').scrollIntoViewIfNeeded();
      await shot(page, `${tag}-05-contrasenas`);
      step = `${tag}: navegador del Server`;
      await page.getByTestId('server-browser-live').click();
      await page.waitForFunction(() => document.querySelector('[data-testid=browser-live] img')?.src?.startsWith('data:image/jpeg'));
      await shot(page, `${tag}-06-navegador`);
      await page.getByTestId('browser-live-close').click();
      await page.context().close();
    }
  }
  pc.srv.close(); glass.srv.close();
  assert.deepEqual(errors, [], `errores en la página:\n${errors.join('\n')}`);
  console.log(`✔ ${shots.length} capturas en ${OUT}`);
} catch (e) {
  console.error(`✘ ${step}: ${e.message}`);
  await last?.screenshot({ path: path.join(OUT, '_error.png') }).catch(() => {});
  if (errors.length) console.error(errors.join('\n'));
  process.exitCode = 1;
} finally {
  await browser.close().catch(() => {});
  try { child.send({ type: 'shutdown' }); } catch { /* gone */ }
  await new Promise((r) => setTimeout(r, 800));
  child.kill();
  t.cleanup();
  for (const d of [wwwPc, wwwGlass]) fs.rmSync(d, { recursive: true, force: true });
  process.exit(process.exitCode ?? 0);
}
